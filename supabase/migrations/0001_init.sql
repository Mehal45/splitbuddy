-- Anmol Gas Agency: database for the live (multi-user) version.
-- Run once in Supabase: Dashboard -> SQL Editor -> paste this file -> Run.
--
-- Security model
--  * Every table has Row Level Security. People can only READ what their role allows.
--  * Nobody writes to tables directly. All changes go through the functions at the
--    bottom (security definer), which check the person's role and the business rules
--    (stock available, quantities, amounts) inside one transaction, and write an
--    audit-log line. A global advisory lock serialises stock-changing operations.
--  * Logins themselves (creating staff/driver/customer accounts) are made by the
--    app's server with the service-role key, never from the browser.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- types
do $$ begin
  create type app_role as enum ('owner', 'warehouse', 'driver', 'customer');
exception when duplicate_object then null; end $$;
do $$ begin
  create type cyl_state as enum ('full', 'empty', 'defective', 'testing');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tables
create table if not exists settings (
  id int primary key default 1 check (id = 1),
  agency_name text not null default 'Anmol Gas Agency',
  agency_tagline text not null default 'Bharat Gas Distributor, Bangalore',
  agency_gstin text not null default '',
  agency_address text not null default '',
  home_state text not null default 'Karnataka',
  hsn_code text not null default '2711',
  pending_approval_hours int not null default 10 check (pending_approval_hours between 1 and 72),
  empties_tolerance int not null default 2 check (empties_tolerance between 0 and 100),
  gps_max_distance_km numeric(6,2) not null default 0.5 check (gps_max_distance_km > 0 and gps_max_distance_km <= 50),
  updated_at timestamptz not null default now()
);
insert into settings (id) values (1) on conflict do nothing;

create table if not exists sizes (
  id text primary key,                    -- '14.2'
  label text not null,
  kg numeric(6,2) not null,
  domestic_price int,                     -- GST inclusive, null = not sold to domestic
  commercial_price int,
  purchase_price int not null,            -- GST inclusive
  purchase_gst int not null check (purchase_gst in (5, 18)),
  low_stock_threshold int not null default 0,
  active boolean not null default true,
  sort int not null default 0
);
insert into sizes (id, label, kg, domestic_price, commercial_price, purchase_price, purchase_gst, low_stock_threshold, sort) values
  ('5', '5 kg', 5, 335, 590, 548, 18, 20, 1),
  ('14.2', '14.2 kg', 14.2, 855, null, 782, 5, 60, 2),
  ('19', '19 kg', 19, null, 1750, 1560, 18, 40, 3),
  ('47.5', '47.5 kg', 47.5, null, 4365, 4000, 18, 15, 4)
on conflict do nothing;

create table if not exists plants (
  id text primary key, name text not null, gstin text not null default '', state text not null
);
insert into plants values
  ('pl1', 'Bharat Gas LPG Bottling Plant, Doddaballapur', '', 'Karnataka'),
  ('pl2', 'Bharat Gas LPG Bottling Plant, Hosur', '', 'Tamil Nadu')
on conflict do nothing;

create table if not exists trucks (
  id uuid primary key default gen_random_uuid(),
  reg_no text not null unique,
  model text not null default 'Truck',
  capacity int not null check (capacity between 1 and 1000),
  created_at timestamptz not null default now()
);

create table if not exists drivers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  license_no text not null default '',
  truck_id uuid not null unique references trucks(id)
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  business_name text not null default '',
  type text not null check (type in ('domestic', 'commercial')),
  category text not null default 'Household',
  gstin text not null default '',
  phone text not null,
  address text not null default '',
  area text not null default '',
  state text not null default 'Karnataka',
  lat double precision not null default 0,
  lng double precision not null default 0,
  credit_limit int not null default 0 check (credit_limit >= 0),
  deposit_cylinders jsonb not null default '{}',
  deposit_amount int not null default 0,
  payment_mode text not null default 'cod' check (payment_mode in ('cod', 'credit')),
  opening_outstanding numeric(12,2) not null default 0,
  opening_empties jsonb not null default '{}',
  source text not null default 'app',
  created_at timestamptz not null default now()
);

-- One row per login. id = Supabase auth user id.
create table if not exists profiles (
  id uuid primary key,
  name text not null,
  role app_role not null,
  phone text not null unique,
  manager boolean not null default false,
  driver_id uuid unique references drivers(id),
  customer_id uuid unique references customers(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (role <> 'driver' or driver_id is not null),
  check (role <> 'customer' or customer_id is not null)
);

-- Every cylinder that moves. Append only.
create table if not exists movements (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  user_id uuid,
  from_loc text not null,
  to_loc text not null,
  size text not null references sizes(id),
  state cyl_state not null,
  to_state cyl_state,
  qty int not null check (qty > 0),
  ref_type text not null,
  ref_id text,
  note text
);
create index if not exists movements_ts on movements (ts);
create index if not exists movements_from on movements (from_loc);
create index if not exists movements_to on movements (to_loc);

-- Running stock per location, kept in step with movements by a trigger.
create table if not exists stock (
  loc text not null, size text not null, state cyl_state not null, qty int not null default 0,
  primary key (loc, size, state)
);

create table if not exists counters (key text primary key, value int not null);

create table if not exists load_sheets (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  date date not null,
  ts timestamptz not null default now(),
  truck_id uuid not null references trucks(id),
  driver_id uuid not null references drivers(id),
  lines jsonb not null,
  created_by uuid not null
);

create table if not exists deliveries (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  date date not null,
  ts timestamptz not null default now(),
  truck_id uuid not null references trucks(id),
  driver_id uuid not null references drivers(id),
  customer_id uuid not null references customers(id),
  "full" jsonb not null default '{}',
  empty jsonb not null default '{}',
  payment jsonb,
  photo text not null,                    -- storage path in bucket "files"
  gps jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  invoice_id uuid
);
create index if not exists deliveries_date on deliveries (date);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  kind text not null check (kind in ('sale', 'purchase')),
  date date not null,
  ts timestamptz not null default now(),
  party_id text not null,
  party_name text not null,
  party_gstin text not null default '',
  place_of_supply text not null,
  interstate boolean not null,
  lines jsonb not null,
  taxable numeric(12,2) not null,
  cgst numeric(12,2) not null,
  sgst numeric(12,2) not null,
  igst numeric(12,2) not null,
  total numeric(12,2) not null,
  source text not null default 'app',
  delivery_id uuid
);
create index if not exists invoices_date on invoices (date);

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('invoice', 'expense')),
  owner_id uuid not null,
  name text not null,
  kind text not null check (kind in ('image', 'pdf')),
  path text not null,                     -- storage path in bucket "files"
  bytes int not null check (bytes between 1 and 1500000),
  uploaded_by uuid not null,
  ts timestamptz not null default now()
);
create index if not exists attachments_owner on attachments (owner_type, owner_id);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  date date not null,
  ts timestamptz not null default now(),
  amount int not null check (amount > 0),
  mode text not null check (mode in ('cash', 'upi', 'cheque', 'neft')),
  ref text,
  delivery_id uuid,
  source text not null default 'app'
);

create table if not exists reconciliations (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  ts timestamptz not null default now(),
  truck_id uuid not null references trucks(id),
  driver_id uuid not null references drivers(id),
  expected jsonb not null,
  actual jsonb not null,
  mismatch boolean not null,
  by uuid not null
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  date date not null,
  ts timestamptz not null default now(),
  category text not null,
  amount int not null check (amount between 1 and 1000000),
  mode text not null check (mode in ('cash', 'upi', 'bank')),
  paid_to text not null default '',
  note text not null default '',
  truck_id uuid references trucks(id),
  by uuid not null
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  ts timestamptz not null default now(),
  customer_id uuid not null references customers(id),
  lines jsonb not null,
  wanted_date date not null,
  slot text not null check (slot in ('morning', 'afternoon', 'evening')),
  note text not null default '',
  status text not null default 'new' check (status in ('new', 'accepted', 'delivered', 'rejected', 'cancelled')),
  placed_by uuid not null,
  handled_by uuid,
  handled_at timestamptz,
  reason text,
  delivery_id uuid
);

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  user_id text not null,
  action text not null,
  detail text not null
);

-- ---------------------------------------------------------------- stock trigger
create or replace function trg_stock() returns trigger language plpgsql as $$
begin
  insert into stock (loc, size, state, qty) values (new.from_loc, new.size, new.state, -new.qty)
    on conflict (loc, size, state) do update set qty = stock.qty - new.qty;
  insert into stock (loc, size, state, qty) values (new.to_loc, new.size, coalesce(new.to_state, new.state), new.qty)
    on conflict (loc, size, state) do update set qty = stock.qty + new.qty;
  return new;
end $$;
drop trigger if exists movements_stock on movements;
create trigger movements_stock after insert on movements for each row execute function trg_stock();

-- Append-only tables: no updates or deletes, even by mistake.
create or replace function trg_no_change() returns trigger language plpgsql as $$
begin raise exception 'This record cannot be changed or deleted.'; end $$;
drop trigger if exists movements_locked on movements;
create trigger movements_locked before update or delete on movements for each row execute function trg_no_change();
drop trigger if exists audit_locked on audit_log;
create trigger audit_locked before update or delete on audit_log for each row execute function trg_no_change();

-- ---------------------------------------------------------------- helpers
create or replace function my_role() returns app_role language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;
create or replace function is_owner() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(my_role() = 'owner', false)
$$;
create or replace function is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('owner', 'warehouse'), false)
$$;
create or replace function can_book_expenses() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and (role = 'owner' or (role = 'warehouse' and manager)))
$$;
create or replace function my_customer_id() returns uuid language sql stable security definer set search_path = public as $$
  select customer_id from profiles where id = auth.uid() and active and role = 'customer'
$$;
create or replace function my_driver_id() returns uuid language sql stable security definer set search_path = public as $$
  select driver_id from profiles where id = auth.uid() and active and role = 'driver'
$$;
create or replace function my_truck_id() returns uuid language sql stable security definer set search_path = public as $$
  select d.truck_id from drivers d join profiles p on p.driver_id = d.id where p.id = auth.uid() and p.active
$$;

create or replace function fail(msg text) returns void language plpgsql as $$
begin raise exception using message = msg, errcode = 'P0001'; end $$;

create or replace function require(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then perform fail(msg); end if; end $$;

create or replace function ist_today() returns date language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

create or replace function fy_of(d date) returns text language sql immutable as $$
  select case when extract(month from d) >= 4
    then to_char(d, 'YY') || '-' || to_char(d + interval '1 year', 'YY')
    else to_char(d - interval '1 year', 'YY') || '-' || to_char(d, 'YY') end
$$;

create or replace function next_no(series text, d date) returns text language plpgsql security definer set search_path = public as $$
declare k text := 'no:' || series || ':' || fy_of(d); v int;
begin
  insert into counters (key, value) values (k, 1) on conflict (key) do update set value = counters.value + 1 returning value into v;
  return series || '/' || fy_of(d) || '/' || lpad(v::text, 5, '0');
end $$;

create or replace function qty_at(p_loc text, p_size text, p_state cyl_state) returns int language sql stable security definer set search_path = public as $$
  select coalesce((select qty from stock where loc = p_loc and size = p_size and state = p_state), 0)
$$;

create or replace function add_move(p_from text, p_to text, p_size text, p_state cyl_state, p_qty int, p_ref_type text, p_ref_id text,
  p_note text default null, p_to_state cyl_state default null, p_ts timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_qty > 0 then
    insert into movements (ts, user_id, from_loc, to_loc, size, state, to_state, qty, ref_type, ref_id, note)
    values (p_ts, auth.uid(), p_from, p_to, p_size, p_state, p_to_state, p_qty, p_ref_type, p_ref_id, p_note);
  end if;
end $$;

create or replace function audit(p_action text, p_detail text) returns void language sql security definer set search_path = public as $$
  insert into audit_log (user_id, action, detail) values (coalesce(auth.uid()::text, 'anonymous'), p_action, left(p_detail, 300))
$$;

-- {size: qty} objects: known sizes, whole numbers 0..9999
create or replace function check_qty(j jsonb, what text) returns int language plpgsql stable security definer set search_path = public as $$
declare k text; v jsonb; total int := 0;
begin
  if j is null or jsonb_typeof(j) <> 'object' then perform fail(what || ': quantities are missing.'); end if;
  for k, v in select * from jsonb_each(j) loop
    perform require(exists (select 1 from sizes where id = k), 'Unknown cylinder size "' || k || '".');
    perform require(jsonb_typeof(v) = 'number' and (v::text ~ '^\d{1,4}$'), what || ': quantity for ' || k || ' kg must be a whole number from 0 to 9,999.');
    total := total + v::int;
  end loop;
  return total;
end $$;

create or replace function price_for(p_size text, p_type text) returns int language sql stable security definer set search_path = public as $$
  select case when p_type = 'domestic' then domestic_price else commercial_price end from sizes where id = p_size
$$;

-- GST-inclusive rates: back-calculate taxable value; CGST+SGST inside the state, IGST across states.
create or replace function invoice_totals(p_lines jsonb, p_interstate boolean) returns jsonb language plpgsql immutable as $$
declare l jsonb; gross numeric; base numeric; taxable numeric := 0; tax numeric := 0; total numeric := 0;
begin
  for l in select * from jsonb_array_elements(p_lines) loop
    gross := (l->>'qty')::numeric * (l->>'rate')::numeric;
    base := gross / (1 + (l->>'gstRate')::numeric / 100);
    taxable := taxable + base; tax := tax + (gross - base); total := total + gross;
  end loop;
  return jsonb_build_object('taxable', round(taxable, 2),
    'cgst', case when p_interstate then 0 else round(tax / 2, 2) end,
    'sgst', case when p_interstate then 0 else round(tax / 2, 2) end,
    'igst', case when p_interstate then round(tax, 2) else 0 end,
    'total', round(total, 2));
end $$;

-- ---------------------------------------------------------------- read rules (RLS)
alter table settings enable row level security;
alter table sizes enable row level security;
alter table plants enable row level security;
alter table trucks enable row level security;
alter table drivers enable row level security;
alter table customers enable row level security;
alter table profiles enable row level security;
alter table movements enable row level security;
alter table stock enable row level security;
alter table counters enable row level security;
alter table load_sheets enable row level security;
alter table deliveries enable row level security;
alter table invoices enable row level security;
alter table attachments enable row level security;
alter table payments enable row level security;
alter table reconciliations enable row level security;
alter table expenses enable row level security;
alter table orders enable row level security;
alter table audit_log enable row level security;

do $$ declare t text; begin
  foreach t in array array['settings','sizes','plants','trucks','drivers','customers','profiles','movements','stock','counters','load_sheets','deliveries','invoices','attachments','payments','reconciliations','expenses','orders','audit_log'] loop
    execute format('drop policy if exists read on %I', t);
    execute format('revoke insert, update, delete, truncate on %I from anon, authenticated', t);
    execute format('revoke all on %I from anon', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end $$;

create policy read on settings for select to authenticated using (my_role() is not null);
create policy read on sizes for select to authenticated using (my_role() is not null);
create policy read on plants for select to authenticated using (is_staff());
create policy read on trucks for select to authenticated using (is_staff() or id = my_truck_id());
create policy read on drivers for select to authenticated using (is_staff() or id = my_driver_id());
create policy read on customers for select to authenticated using (is_staff() or my_role() = 'driver' or id = my_customer_id());
create policy read on profiles for select to authenticated using (id = auth.uid() or is_staff());
create policy read on movements for select to authenticated using (
  is_staff()
  or (my_role() = 'driver' and (from_loc = 'TRUCK:' || my_truck_id() or to_loc = 'TRUCK:' || my_truck_id()))
  or (my_role() = 'customer' and (from_loc = 'CUST:' || my_customer_id() or to_loc = 'CUST:' || my_customer_id())));
create policy read on stock for select to authenticated using (
  is_staff() or (my_role() = 'driver' and loc = 'TRUCK:' || my_truck_id()) or (my_role() = 'customer' and loc = 'CUST:' || my_customer_id()));
create policy read on counters for select to authenticated using (false);
create policy read on load_sheets for select to authenticated using (is_staff() or truck_id = my_truck_id());
create policy read on deliveries for select to authenticated using (is_staff() or driver_id = my_driver_id() or customer_id = my_customer_id());
create policy read on invoices for select to authenticated using (is_staff() or (kind = 'sale' and (party_id = my_customer_id()::text or my_role() = 'driver')));
create policy read on attachments for select to authenticated using (
  (owner_type = 'invoice' and is_staff()) or (owner_type = 'expense' and can_book_expenses()));
create policy read on payments for select to authenticated using (is_staff() or my_role() = 'driver' or customer_id = my_customer_id());
create policy read on reconciliations for select to authenticated using (is_staff());
create policy read on expenses for select to authenticated using (can_book_expenses());
create policy read on orders for select to authenticated using (is_staff() or customer_id = my_customer_id());
create policy read on audit_log for select to authenticated using (is_owner());

-- ---------------------------------------------------------------- operations
-- Every operation: check role -> lock -> validate -> write -> audit. Errors come back as plain messages.

create or replace function op_lock() returns void language sql as $$ select pg_advisory_xact_lock(424242) $$;

create or replace function create_load_sheet(p_truck uuid, p_lines jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_driver uuid; v_id uuid := gen_random_uuid(); v_no text; k text; v int; total int; d date := ist_today();
begin
  perform require(is_staff(), 'Only warehouse staff and the owner can make load sheets.');
  perform op_lock();
  select id into v_driver from drivers where truck_id = p_truck;
  perform require(v_driver is not null, 'Truck not found.');
  total := check_qty(p_lines, 'Load sheet');
  perform require(total > 0, 'Add at least one cylinder.');
  for k, v in select key, value::int from jsonb_each(p_lines) loop
    perform require(v <= qty_at('WH', k, 'full'), 'Not enough full ' || k || ' kg cylinders at the warehouse.');
  end loop;
  v_no := next_no('LS', d);
  insert into load_sheets (id, no, date, truck_id, driver_id, lines, created_by) values (v_id, v_no, d, p_truck, v_driver, p_lines, auth.uid());
  for k, v in select key, value::int from jsonb_each(p_lines) loop
    perform add_move('WH', 'TRUCK:' || p_truck, k, 'full', v, 'load', v_id::text);
  end loop;
  perform audit('load_sheet', v_no || ': ' || total || ' cylinders');
  return jsonb_build_object('id', v_id, 'no', v_no);
end $$;

create or replace function submit_delivery(p_customer uuid, p_full jsonb, p_empty jsonb, p_payment jsonb, p_photo text, p_gps jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_driver uuid := my_driver_id(); v_truck uuid := my_truck_id(); v_id uuid := gen_random_uuid(); v_no text; k text; v int;
  d date := ist_today(); amt int; cash int; upi int; mode text;
begin
  perform require(v_driver is not null and v_truck is not null, 'Only drivers can record deliveries.');
  perform op_lock();
  perform require(exists (select 1 from customers where id = p_customer), 'Customer not found.');
  perform require(check_qty(p_full, 'Full cylinders') + check_qty(p_empty, 'Empty cylinders') > 0, 'Enter at least one cylinder.');
  for k, v in select key, value::int from jsonb_each(p_full) loop
    perform require(v <= qty_at('TRUCK:' || v_truck, k, 'full'), 'Not enough full ' || k || ' kg cylinders on the truck.');
  end loop;
  perform require(p_photo ~ ('^deliveries/' || auth.uid() || '/[A-Za-z0-9._-]{1,80}\.jpg$'), 'The acknowledgement photo is missing.');
  perform require(jsonb_typeof(p_gps->'lat') = 'number' and jsonb_typeof(p_gps->'lng') = 'number'
    and abs((p_gps->>'lat')::numeric) <= 90 and abs((p_gps->>'lng')::numeric) <= 180, 'Location is not valid.');
  if p_payment is not null and p_payment <> 'null'::jsonb then
    mode := p_payment->>'mode';
    perform require((p_payment->>'amount') ~ '^\d{1,8}$', 'Payment amount is not valid.');
    amt := (p_payment->>'amount')::int;
    perform require(amt > 0 and amt <= 10000000, 'Payment amount is not valid.');
    perform require(mode in ('cash', 'upi', 'split'), 'Payment mode must be cash, UPI or both.');
    if mode = 'split' then
      perform require((p_payment->>'cash') ~ '^\d{1,8}$' and (p_payment->>'upi') ~ '^\d{1,8}$', 'Cash and UPI parts must add up to the total collected.');
      cash := (p_payment->>'cash')::int; upi := (p_payment->>'upi')::int;
      perform require(cash > 0 and upi > 0 and cash + upi = amt, 'Cash and UPI parts must add up to the total collected.');
      p_payment := jsonb_build_object('amount', amt, 'mode', mode, 'cash', cash, 'upi', upi);
    else
      p_payment := jsonb_build_object('amount', amt, 'mode', mode);
    end if;
  else
    p_payment := null;
  end if;
  v_no := next_no('DL', d);
  insert into deliveries (id, no, date, truck_id, driver_id, customer_id, "full", empty, payment, photo, gps)
  values (v_id, v_no, d, v_truck, v_driver, p_customer, p_full, p_empty, p_payment, p_photo,
          jsonb_build_object('lat', (p_gps->>'lat')::numeric, 'lng', (p_gps->>'lng')::numeric, 'mocked', coalesce((p_gps->>'mocked')::boolean, false)));
  for k, v in select key, value::int from jsonb_each(p_full) loop
    perform add_move('TRUCK:' || v_truck, 'CUST:' || p_customer, k, 'full', v, 'delivery', v_id::text);
  end loop;
  for k, v in select key, value::int from jsonb_each(p_empty) loop
    perform add_move('CUST:' || p_customer, 'TRUCK:' || v_truck, k, 'empty', v, 'delivery', v_id::text);
  end loop;
  perform audit('delivery_submitted', v_no || coalesce(' · collected ₹' || amt, ' · nothing collected'));
  return jsonb_build_object('id', v_id, 'no', v_no);
end $$;

create or replace function create_sale_invoice(p_customer uuid, p_date date, p_ts timestamptz, p_full jsonb, p_empty jsonb, p_delivery uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare c customers; lines jsonb := '[]'; s record; q int; e int; inter boolean; t jsonb; v_id uuid := gen_random_uuid(); gst int;
begin
  select * into c from customers where id = p_customer;
  gst := case when c.type = 'domestic' then 5 else 18 end;
  for s in select id from sizes order by sort loop
    q := coalesce((p_full->>s.id)::int, 0); e := coalesce((p_empty->>s.id)::int, 0);
    if q > 0 or e > 0 then
      perform require(q = 0 or price_for(s.id, c.type) is not null, s.id || ' kg has no price for this customer type. Set it in Settings.');
      lines := lines || jsonb_build_object('size', s.id, 'qty', q, 'emptiesReturned', e, 'rate', coalesce(price_for(s.id, c.type), 0), 'gstRate', gst);
    end if;
  end loop;
  inter := c.state <> (select home_state from settings where id = 1);
  t := invoice_totals(lines, inter);
  insert into invoices (id, no, kind, date, ts, party_id, party_name, party_gstin, place_of_supply, interstate, lines, taxable, cgst, sgst, igst, total, delivery_id)
  values (v_id, next_no('AGA', p_date), 'sale', p_date, p_ts, c.id::text, coalesce(nullif(c.business_name, ''), c.name), c.gstin, c.state, inter, lines,
          (t->>'taxable')::numeric, (t->>'cgst')::numeric, (t->>'sgst')::numeric, (t->>'igst')::numeric, (t->>'total')::numeric, p_delivery);
  return v_id;
end $$;

create or replace function approve_delivery(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d deliveries; inv uuid; ord uuid; cash int := 0; upi int := 0;
begin
  perform require(is_staff(), 'Only warehouse staff and the owner can approve deliveries.');
  perform op_lock();
  select * into d from deliveries where id = p_id for update;
  perform require(found, 'Delivery not found.');
  perform require(d.status = 'pending', 'This delivery was already handled.');
  inv := create_sale_invoice(d.customer_id, d.date, d.ts, d."full", d.empty, d.id);
  update deliveries set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), invoice_id = inv where id = p_id;
  select id into ord from orders where customer_id = d.customer_id and status = 'accepted' order by ts limit 1;
  if ord is not null then update orders set status = 'delivered', delivery_id = d.id, handled_by = auth.uid(), handled_at = now() where id = ord; end if;
  if d.payment is not null then
    if d.payment->>'mode' = 'split' then cash := (d.payment->>'cash')::int; upi := (d.payment->>'upi')::int;
    elsif d.payment->>'mode' = 'cash' then cash := (d.payment->>'amount')::int;
    else upi := (d.payment->>'amount')::int; end if;
    if cash > 0 then insert into payments (customer_id, date, ts, amount, mode, ref, delivery_id) values (d.customer_id, d.date, d.ts, cash, 'cash', d.no, d.id); end if;
    if upi > 0 then insert into payments (customer_id, date, ts, amount, mode, ref, delivery_id) values (d.customer_id, d.date, d.ts, upi, 'upi', d.no, d.id); end if;
  end if;
  perform audit('delivery_approved', d.no);
end $$;

create or replace function reject_delivery(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d deliveries; k text; v int;
begin
  perform require(is_staff(), 'Only warehouse staff and the owner can reject deliveries.');
  perform require(length(trim(coalesce(p_reason, ''))) between 3 and 200, 'Give a reason (3 to 200 characters).');
  perform op_lock();
  select * into d from deliveries where id = p_id for update;
  perform require(found, 'Delivery not found.');
  perform require(d.status = 'pending', 'This delivery was already handled.');
  update deliveries set status = 'rejected', reject_reason = trim(p_reason), reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  for k, v in select key, value::int from jsonb_each(d."full") loop
    perform add_move('CUST:' || d.customer_id, 'TRUCK:' || d.truck_id, k, 'full', v, 'reversal', d.id::text, 'Rejected: ' || trim(p_reason));
  end loop;
  for k, v in select key, value::int from jsonb_each(d.empty) loop
    perform add_move('TRUCK:' || d.truck_id, 'CUST:' || d.customer_id, k, 'empty', v, 'reversal', d.id::text, 'Rejected: ' || trim(p_reason));
  end loop;
  perform audit('delivery_rejected', d.no || ': ' || trim(p_reason));
end $$;

create or replace function reconcile_truck(p_truck uuid, p_actual jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_driver uuid; s record; ex int; ac int; st cyl_state; mism boolean := false; v_id uuid := gen_random_uuid();
  expected jsonb := '{}'; tloc text := 'TRUCK:' || p_truck;
begin
  perform require(is_staff(), 'Only warehouse staff and the owner can count returned trucks.');
  perform op_lock();
  select id into v_driver from drivers where truck_id = p_truck;
  perform require(v_driver is not null, 'Truck not found.');
  for s in select id from sizes loop
    expected := expected || jsonb_build_object(s.id, jsonb_build_object('full', qty_at(tloc, s.id, 'full'), 'empty', qty_at(tloc, s.id, 'empty')));
    foreach st in array array['full', 'empty']::cyl_state[] loop
      ex := qty_at(tloc, s.id, st);
      perform require(coalesce(p_actual->s.id->>st::text, '0') ~ '^\d{1,4}$', 'Returned counts must be whole numbers from 0 to 9,999.');
      ac := coalesce((p_actual->s.id->>st::text)::int, 0);
      if ex <> ac then mism := true; end if;
      perform add_move(tloc, 'WH', s.id, st, least(ex, ac), 'return', v_id::text);
      if ex > ac then perform add_move(tloc, 'LOSS', s.id, st, ex - ac, 'return', v_id::text, 'Shortage at end of day'); end if;
      if ac > ex then perform add_move('LOSS', 'WH', s.id, st, ac - ex, 'return', v_id::text, 'Excess at end of day'); end if;
    end loop;
  end loop;
  insert into reconciliations (id, date, truck_id, driver_id, expected, actual, mismatch, by)
  values (v_id, ist_today(), p_truck, v_driver, expected, p_actual, mism, auth.uid());
  perform audit('reconciliation', (select reg_no from trucks where id = p_truck) || case when mism then ' · MISMATCH' else ' · matched' end);
  return jsonb_build_object('id', v_id, 'mismatch', mism);
end $$;

create or replace function create_purchase(p_plant text, p_full jsonb, p_empties jsonb, p_defective jsonb, p_testing jsonb, p_date date, p_attachments jsonb default '[]') returns jsonb
language plpgsql security definer set search_path = public as $$
declare pl plants; lines jsonb := '[]'; s sizes; q int; b int; inter boolean; t jsonb; v_id uuid := gen_random_uuid(); v_no text; k text; v int; a jsonb; n int;
begin
  perform require(is_staff(), 'Only warehouse staff and the owner can record plant receipts.');
  perform op_lock();
  select * into pl from plants where id = p_plant;
  perform require(found, 'Plant not found.');
  perform require(p_date <= ist_today() and p_date > ist_today() - 60, 'Date must be within the last 60 days.');
  perform check_qty(p_full, 'Received'); perform check_qty(p_empties, 'Empties sent');
  perform check_qty(coalesce(p_defective, '{}'), 'Defective sent'); perform check_qty(coalesce(p_testing, '{}'), 'Testing sent');
  for k, v in select key, value::int from jsonb_each(p_empties) loop perform require(v <= qty_at('WH', k, 'empty'), 'Not enough empty ' || k || ' kg cylinders at the warehouse.'); end loop;
  for k, v in select key, value::int from jsonb_each(coalesce(p_defective, '{}')) loop perform require(v <= qty_at('WH', k, 'defective'), 'Not enough defective ' || k || ' kg cylinders at the warehouse.'); end loop;
  for k, v in select key, value::int from jsonb_each(coalesce(p_testing, '{}')) loop perform require(v <= qty_at('WH', k, 'testing'), 'Not enough ' || k || ' kg cylinders due for testing at the warehouse.'); end loop;
  for s in select * from sizes order by sort loop
    q := coalesce((p_full->>s.id)::int, 0); b := coalesce((p_empties->>s.id)::int, 0);
    if q > 0 or b > 0 then lines := lines || jsonb_build_object('size', s.id, 'qty', q, 'emptiesReturned', b, 'rate', s.purchase_price, 'gstRate', s.purchase_gst); end if;
  end loop;
  perform require(jsonb_array_length(lines) > 0 or check_qty(coalesce(p_defective, '{}'), 'x') + check_qty(coalesce(p_testing, '{}'), 'x') > 0, 'Enter at least one cylinder.');
  inter := pl.state <> (select home_state from settings where id = 1);
  t := invoice_totals(lines, inter);
  v_no := next_no(case when pl.id = 'pl2' then 'HSR' else 'BPC' end, p_date);
  insert into invoices (id, no, kind, date, party_id, party_name, party_gstin, place_of_supply, interstate, lines, taxable, cgst, sgst, igst, total)
  values (v_id, v_no, 'purchase', p_date, pl.id, pl.name, pl.gstin, (select home_state from settings where id = 1), inter, lines,
          (t->>'taxable')::numeric, (t->>'cgst')::numeric, (t->>'sgst')::numeric, (t->>'igst')::numeric, (t->>'total')::numeric);
  for k, v in select key, value::int from jsonb_each(p_full) loop perform add_move('PLANT', 'WH', k, 'full', v, 'purchase', v_id::text); end loop;
  for k, v in select key, value::int from jsonb_each(p_empties) loop perform add_move('WH', 'PLANT', k, 'empty', v, 'purchase', v_id::text); end loop;
  for k, v in select key, value::int from jsonb_each(coalesce(p_defective, '{}')) loop perform add_move('WH', 'PLANT', k, 'defective', v, 'purchase', v_id::text); end loop;
  for k, v in select key, value::int from jsonb_each(coalesce(p_testing, '{}')) loop perform add_move('WH', 'PLANT', k, 'testing', v, 'purchase', v_id::text); end loop;
  n := 0;
  for a in select * from jsonb_array_elements(coalesce(p_attachments, '[]')) loop
    n := n + 1;
    perform require(n <= 5, 'At most 5 receipts per purchase.');
    perform add_attachment_row('invoice', v_id, a);
  end loop;
  perform audit('purchase', v_no || ' from ' || pl.name);
  return jsonb_build_object('id', v_id, 'no', v_no);
end $$;

create or replace function add_attachment_row(p_owner_type text, p_owner uuid, a jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := gen_random_uuid(); folder text := case when p_owner_type = 'invoice' then 'receipts' else 'expenses' end;
begin
  perform require(a->>'kind' in ('image', 'pdf'), 'Only JPG/PNG photos and PDF files can be attached.');
  perform require((a->>'path') ~ ('^' || folder || '/' || auth.uid() || '/[A-Za-z0-9._-]{1,80}\.(jpg|pdf)$'), 'Upload the file first.');
  perform require((a->>'bytes') ~ '^\d{1,7}$' and (a->>'bytes')::int between 1 and 1500000, 'That file is too large (max 1.5 MB).');
  insert into attachments (id, owner_type, owner_id, name, kind, path, bytes, uploaded_by)
  values (v_id, p_owner_type, p_owner, left(regexp_replace(coalesce(a->>'name', 'file'), '[^\w .()-]', '', 'g'), 80), a->>'kind', a->>'path', (a->>'bytes')::int, auth.uid());
  return v_id;
end $$;

create or replace function attach_receipt(p_invoice uuid, p_file jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; no text;
begin
  perform require(is_staff(), 'Only warehouse staff and the owner can attach receipts.');
  select i.no into no from invoices i where i.id = p_invoice and kind = 'purchase';
  perform require(no is not null, 'Receipts can only be attached to purchases.');
  perform require((select count(*) from attachments where owner_type = 'invoice' and owner_id = p_invoice) < 5, 'A purchase can have at most 5 receipts.');
  v := add_attachment_row('invoice', p_invoice, p_file);
  perform audit('receipt_attached', (p_file->>'name') || ' on ' || no);
  return v;
end $$;

create or replace function remove_attachment(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare a attachments;
begin
  perform require(is_owner(), 'Only the owner can remove receipts.');
  delete from attachments where id = p_id returning * into a;
  perform require(found, 'Receipt not found.');
  perform audit('receipt_removed', a.name);
  return a.path; -- the app deletes the file from storage
end $$;

create or replace function record_payment(p_customer uuid, p_amount int, p_mode text, p_ref text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require(is_staff(), 'Only warehouse staff and the owner can record payments.');
  perform require(exists (select 1 from customers where id = p_customer), 'Customer not found.');
  perform require(p_amount between 1 and 10000000, 'Payment must be a whole amount between ₹1 and ₹1 crore.');
  perform require(p_mode in ('cash', 'upi', 'cheque', 'neft'), 'Unknown payment mode.');
  insert into payments (customer_id, date, amount, mode, ref) values (p_customer, ist_today(), p_amount, p_mode, left(nullif(trim(p_ref), ''), 40));
  perform audit('payment', '₹' || p_amount || ' ' || p_mode || ' from ' || (select name from customers where id = p_customer));
end $$;

create or replace function change_state(p_size text, p_from cyl_state, p_to cyl_state, p_qty int, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require(is_staff(), 'Only warehouse staff and the owner can change stock state.');
  perform op_lock();
  perform require(exists (select 1 from sizes where id = p_size), 'Unknown size.');
  perform require(p_qty between 1 and 9999, 'Quantity must be 1 to 9,999.');
  perform require(p_from <> p_to, 'Pick two different states.');
  perform require(p_qty <= qty_at('WH', p_size, p_from), 'Not that many cylinders in that state at the warehouse.');
  perform add_move('WH', 'WH', p_size, p_from, p_qty, 'adjust', null, left(nullif(trim(p_note), ''), 200), p_to);
  perform audit('stock_state_change', p_qty || ' × ' || p_size || ' kg ' || p_from || ' → ' || p_to);
end $$;

create or replace function add_opening_stock(p_lines jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare k text; byst jsonb; st text; q int; total int := 0;
begin
  perform require(is_owner(), 'Only the owner can enter opening stock.');
  perform op_lock();
  for k, byst in select * from jsonb_each(p_lines) loop
    for st in select jsonb_object_keys(byst) loop
      perform require(st in ('full', 'empty', 'defective', 'testing'), 'Unknown state.');
      perform check_qty(jsonb_build_object(k, byst->st), 'Opening stock');
      q := (byst->>st)::int; total := total + q;
      perform add_move('OPENING', 'WH', k, st::cyl_state, q, 'opening', null, 'Opening stock entered');
    end loop;
  end loop;
  perform require(total > 0, 'Enter at least one cylinder.');
  perform audit('opening_stock', total || ' cylinders');
  return total;
end $$;

create or replace function set_customer_opening(p_customer uuid, p_outstanding int, p_held jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v int;
begin
  perform require(is_owner(), 'Only the owner can set opening balances.');
  perform op_lock();
  perform require(exists (select 1 from customers where id = p_customer), 'Customer not found.');
  perform require(p_outstanding between 0 and 10000000, 'Opening dues must be ₹0 to ₹1 crore.');
  perform check_qty(p_held, 'Cylinders already with customer');
  perform require(not exists (select 1 from movements where ref_type = 'opening' and to_loc = 'CUST:' || p_customer), 'Opening cylinders for this customer were already entered.');
  update customers set opening_outstanding = p_outstanding, opening_empties = p_held where id = p_customer;
  for k, v in select key, value::int from jsonb_each(p_held) loop
    perform add_move('OPENING', 'CUST:' || p_customer, k, 'empty', v, 'opening', null, 'Cylinders with customer before start');
  end loop;
  perform audit('customer_edited', 'Opening balance for ' || (select name from customers where id = p_customer));
end $$;

-- Owner adds or edits a customer. Login for the customer is created by the app server.
create or replace function upsert_customer(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_code text; phone10 text := right(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'), 10);
begin
  perform require(is_owner(), 'Only the owner can add or edit customers.');
  perform require(length(trim(coalesce(p->>'name', ''))) between 1 and 80, 'Contact name is required (max 80 characters).');
  perform require(phone10 ~ '^[6-9]\d{9}$', 'Phone must be a 10-digit Indian mobile number.');
  perform require(p->>'type' in ('domestic', 'commercial'), 'Pick domestic or commercial.');
  perform require(coalesce(p->>'gstin', '') = '' or (p->>'gstin') ~ '^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$', 'GSTIN format is not valid.');
  perform require(not exists (select 1 from customers where right(regexp_replace(phone, '\D', '', 'g'), 10) = phone10 and id is distinct from v_id), 'Another customer has this phone number.');
  if v_id is null then
    v_code := 'AGA-C' || lpad(((select count(*) from customers) + 1)::text, 3, '0');
    insert into customers (code, name, business_name, type, category, gstin, phone, address, area, state, lat, lng, credit_limit, deposit_cylinders, deposit_amount, payment_mode)
    values (v_code, trim(p->>'name'), left(trim(coalesce(p->>'businessName', '')), 120), p->>'type', left(coalesce(p->>'category', 'Household'), 40), coalesce(p->>'gstin', ''),
      trim(p->>'phone'), left(coalesce(p->>'address', ''), 300), left(coalesce(p->>'area', ''), 60), coalesce(p->>'state', 'Karnataka'),
      coalesce((p->>'lat')::double precision, 0), coalesce((p->>'lng')::double precision, 0), greatest(0, coalesce((p->>'creditLimit')::int, 0)),
      coalesce(p->'depositCylinders', '{}'), greatest(0, coalesce((p->>'depositAmount')::int, 0)), coalesce(p->>'paymentMode', 'cod'))
    returning id into v_id;
    perform audit('customer_added', trim(p->>'name') || ' (' || v_code || ')');
  else
    update customers set name = trim(p->>'name'), business_name = left(trim(coalesce(p->>'businessName', '')), 120), type = p->>'type',
      category = left(coalesce(p->>'category', 'Household'), 40), gstin = coalesce(p->>'gstin', ''), phone = trim(p->>'phone'),
      address = left(coalesce(p->>'address', ''), 300), area = left(coalesce(p->>'area', ''), 60), state = coalesce(p->>'state', 'Karnataka'),
      lat = coalesce((p->>'lat')::double precision, lat), lng = coalesce((p->>'lng')::double precision, lng),
      credit_limit = greatest(0, coalesce((p->>'creditLimit')::int, 0)), deposit_cylinders = coalesce(p->'depositCylinders', '{}'),
      deposit_amount = greatest(0, coalesce((p->>'depositAmount')::int, 0)), payment_mode = coalesce(p->>'paymentMode', 'cod')
    where id = v_id;
    perform require(found, 'Customer not found.');
    update profiles set phone = trim(p->>'phone'), name = trim(p->>'name') where customer_id = v_id;
    perform audit('customer_edited', trim(p->>'name'));
  end if;
  return v_id;
end $$;

create or replace function update_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s jsonb;
begin
  perform require(is_owner(), 'Only the owner can change settings.');
  perform require(length(trim(coalesce(p->>'agencyName', ''))) between 1 and 80, 'Agency name is required.');
  perform require(coalesce(p->>'agencyGstin', '') = '' or (p->>'agencyGstin') ~ '^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$', 'GSTIN format is not valid.');
  update settings set agency_name = trim(p->>'agencyName'), agency_tagline = left(coalesce(p->>'agencyTagline', ''), 120),
    agency_gstin = coalesce(p->>'agencyGstin', ''), agency_address = left(coalesce(p->>'agencyAddress', ''), 300),
    pending_approval_hours = (p->>'pendingApprovalHours')::int, empties_tolerance = (p->>'emptiesTolerance')::int,
    gps_max_distance_km = (p->>'gpsMaxDistanceKm')::numeric, updated_at = now() where id = 1;
  for s in select * from jsonb_array_elements(coalesce(p->'sizes', '[]')) loop
    perform require((s->>'purchasePrice')::int between 1 and 100000, 'Purchase price must be ₹1 to ₹1,00,000.');
    update sizes set domestic_price = nullif(s->>'domesticPrice', '')::int, commercial_price = nullif(s->>'commercialPrice', '')::int,
      purchase_price = (s->>'purchasePrice')::int, low_stock_threshold = greatest(0, (s->>'lowStockThreshold')::int), active = coalesce((s->>'active')::boolean, true)
    where id = s->>'id';
  end loop;
  perform audit('settings_changed', 'Settings updated');
end $$;

create or replace function set_manager(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  perform require(is_owner(), 'Only the owner can change who is a manager.');
  update profiles set manager = p_on where id = p_user and role = 'warehouse' returning name into n;
  perform require(n is not null, 'Warehouse staff member not found.');
  perform audit('team_changed', n || case when p_on then ' is now a warehouse manager' else ' is no longer a manager' end);
end $$;

create or replace function set_login_active(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  perform require(is_owner(), 'Only the owner can turn logins on or off.');
  perform require(p_user <> auth.uid(), 'You cannot turn off your own login.');
  update profiles set active = p_on where id = p_user and role <> 'owner' returning name into n;
  perform require(n is not null, 'Login not found.');
  perform audit('team_changed', n || case when p_on then ' can sign in again' else ' can no longer sign in' end);
end $$;

create or replace function add_expense(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date; amt int; v_id uuid := gen_random_uuid(); v_no text; a jsonb; n int := 0;
  cats text[] := array['Diesel / fuel','Salaries & wages','Loading / hamali','Truck repair & maintenance','Rent','Electricity & water','Phone & internet','Tea & food','Office & stationery','Tolls & parking','Bank charges','Other'];
begin
  perform require(can_book_expenses(), 'Only the owner and warehouse managers can book expenses.');
  perform require((p->>'date') ~ '^\d{4}-\d{2}-\d{2}$', 'Pick a valid date.');
  d := (p->>'date')::date;
  perform require(d <= ist_today(), 'An expense can''t be dated in the future.');
  perform require(d > ist_today() - 366, 'Date is more than a year ago.');
  perform require(p->>'category' = any(cats), 'Pick an expense type.');
  perform require((p->>'amount') ~ '^\d{1,7}$', 'Amount must be a whole number from ₹1 to ₹10,00,000.');
  amt := (p->>'amount')::int;
  perform require(amt between 1 and 1000000, 'Amount must be a whole number from ₹1 to ₹10,00,000.');
  perform require(p->>'mode' in ('cash', 'upi', 'bank'), 'Pick how it was paid.');
  perform require(length(coalesce(p->>'paidTo', '')) <= 80 and length(coalesce(p->>'note', '')) <= 200, 'Text is too long.');
  perform require(p->>'category' <> 'Other' or length(trim(coalesce(p->>'note', ''))) > 0, 'For ''Other'', write what the expense was for.');
  perform require(nullif(p->>'truckId', '') is null or exists (select 1 from trucks where id = (p->>'truckId')::uuid), 'Truck not found.');
  v_no := next_no('EX', d);
  insert into expenses (id, no, date, category, amount, mode, paid_to, note, truck_id, by)
  values (v_id, v_no, d, p->>'category', amt, p->>'mode', trim(coalesce(p->>'paidTo', '')), trim(coalesce(p->>'note', '')), nullif(p->>'truckId', '')::uuid, auth.uid());
  for a in select * from jsonb_array_elements(coalesce(p->'attachments', '[]')) loop
    n := n + 1; perform require(n <= 5, 'At most 5 bills per expense.');
    perform add_attachment_row('expense', v_id, a);
  end loop;
  perform audit('expense_added', v_no || ' · ' || (p->>'category') || ' · ₹' || amt || ' (' || (p->>'mode') || ')');
  return jsonb_build_object('id', v_id, 'no', v_no);
end $$;

create or replace function delete_expense(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e expenses;
begin
  perform require(is_owner(), 'Only the owner can delete an expense.');
  delete from expenses where id = p_id returning * into e;
  perform require(found, 'Expense not found.');
  delete from attachments where owner_type = 'expense' and owner_id = p_id;
  perform audit('expense_deleted', e.no || ' · ' || e.category || ' · ₹' || e.amount || ' dated ' || e.date);
end $$;

create or replace function place_order(p_customer uuid, p_lines jsonb, p_wanted date, p_slot text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c customers; k text; v int; total int := 0; v_id uuid := gen_random_uuid(); v_no text; open_n int;
begin
  perform require(is_owner() or my_customer_id() = p_customer, 'You can only place orders for your own account.');
  select * into c from customers where id = p_customer;
  perform require(found, 'Customer not found.');
  for k, v in select key, value::int from jsonb_each(p_lines) loop
    perform require(exists (select 1 from sizes where id = k and active) and price_for(k, c.type) is not null, 'That cylinder size isn''t available for your account.');
    perform require(v between 0 and 500, 'Order 1 to 500 cylinders per size.');
    total := total + v;
  end loop;
  perform require(total > 0, 'Add at least one cylinder.');
  perform require(p_wanted between ist_today() and ist_today() + 14, 'Pick a delivery date from today to 14 days ahead.');
  perform require(p_slot in ('morning', 'afternoon', 'evening'), 'Pick a delivery time.');
  perform require(length(coalesce(p_note, '')) <= 200, 'Note can be at most 200 characters.');
  select count(*) into open_n from orders where customer_id = p_customer and status in ('new', 'accepted');
  perform require(open_n < 3, 'You already have ' || open_n || ' orders on the way. Please wait for them or call the agency.');
  v_no := next_no('OR', ist_today());
  insert into orders (id, no, customer_id, lines, wanted_date, slot, note, placed_by)
  values (v_id, v_no, p_customer, (select jsonb_object_agg(key, value) from jsonb_each(p_lines) where value::int > 0), p_wanted, p_slot, trim(coalesce(p_note, '')), auth.uid());
  perform audit('order_placed', v_no || ' · ' || coalesce(nullif(c.business_name, ''), c.name));
  return jsonb_build_object('id', v_id, 'no', v_no);
end $$;

create or replace function handle_order(p_id uuid, p_action text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_id for update;
  perform require(found, 'Order not found.');
  if p_action = 'cancel' then
    perform require(is_owner() or my_customer_id() = o.customer_id, 'You can only cancel your own orders.');
    perform require(o.status = 'new', 'This order was already accepted. Please call the agency to change it.');
    update orders set status = 'cancelled', handled_by = auth.uid(), handled_at = now(), reason = 'Cancelled by customer' where id = p_id;
    perform audit('order_cancelled', o.no);
    return;
  end if;
  perform require(is_staff(), 'Only warehouse staff and the owner can handle orders.');
  if p_action = 'accept' then
    perform require(o.status = 'new', 'This order was already handled.');
    update orders set status = 'accepted', handled_by = auth.uid(), handled_at = now() where id = p_id;
    perform audit('order_accepted', o.no);
  elsif p_action = 'reject' then
    perform require(o.status in ('new', 'accepted'), 'This order is already closed.');
    perform require(length(trim(coalesce(p_reason, ''))) between 1 and 200, 'Give the customer a reason.');
    update orders set status = 'rejected', handled_by = auth.uid(), handled_at = now(), reason = trim(p_reason) where id = p_id;
    perform audit('order_rejected', o.no || ': ' || trim(p_reason));
  elsif p_action = 'delivered' then
    perform require(o.status = 'accepted', 'Only accepted orders can be marked delivered.');
    update orders set status = 'delivered', handled_by = auth.uid(), handled_at = now() where id = p_id;
    perform audit('order_delivered', o.no || ' marked delivered by hand');
  else
    perform fail('Unknown action.');
  end if;
end $$;

-- Sign-in / sign-out / view-as events (only these can be logged from the browser)
create or replace function log_event(p_action text, p_detail text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require(p_action in ('login', 'logout', 'view_as'), 'Not allowed.');
  perform require(my_role() is not null, 'Not signed in.');
  perform audit(p_action, left(coalesce(p_detail, ''), 200));
end $$;

-- Only signed-in people may call the operations; helpers stay private.
revoke execute on all functions in schema public from public, anon;
grant execute on function create_load_sheet, submit_delivery, approve_delivery, reject_delivery, reconcile_truck, create_purchase,
  attach_receipt, remove_attachment, record_payment, change_state, add_opening_stock, set_customer_opening, upsert_customer,
  update_settings, set_manager, set_login_active, add_expense, delete_expense, place_order, handle_order, log_event,
  my_role, is_owner, is_staff, can_book_expenses, my_customer_id, my_driver_id, my_truck_id, ist_today to authenticated;
