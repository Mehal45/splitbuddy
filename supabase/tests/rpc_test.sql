-- Functional + security test for 0001_init.sql. Run on a scratch database after stub_supabase.sql:
--   psql -d test -f stub_supabase.sql -f ../migrations/0001_init.sql -f rpc_test.sql
-- Every check raises an exception on failure, so the script stops at the first problem.
\set ON_ERROR_STOP 1
\set QUIET 1

create schema if not exists t;
grant usage on schema t to authenticated;
create or replace function t.ok(cond boolean, what text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'TEST FAILED: %', what; end if; raise notice 'ok  %', what; end $$;
create or replace function t.fails(stmt text, expect text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then
    if sqlerrm ilike '%' || expect || '%' then raise notice 'ok  refused: %', sqlerrm; return; end if;
    raise exception 'TEST FAILED: % -> wrong error: %', stmt, sqlerrm;
  end;
  raise exception 'TEST FAILED: should have been refused: %', stmt;
end $$;
create or replace function t.q(l text, z text, st cyl_state) returns int language sql security definer as $$ select public.qty_at(l, z, st) $$;
grant execute on all functions in schema t to authenticated;

-- People (the app server creates these with the service-role key)
insert into trucks (id, reg_no, model, capacity) values ('11111111-0000-0000-0000-000000000001', 'KA-01-AB-1234', 'Tata 407', 80);
insert into drivers (id, name, phone, truck_id) values ('22222222-0000-0000-0000-000000000001', 'Ravi', '9845000001', '11111111-0000-0000-0000-000000000001');
insert into customers (id, code, name, business_name, type, phone, area) values
  ('33333333-0000-0000-0000-000000000001', 'AGA-C001', 'Sharma', 'Sharma Tiffins', 'commercial', '9845000002', 'Jayanagar'),
  ('33333333-0000-0000-0000-000000000002', 'AGA-C002', 'Other Co', 'Other Co', 'commercial', '9845000003', 'Hebbal');
insert into profiles (id, name, role, phone, manager, driver_id, customer_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Owner', 'owner', '9845000010', false, null, null),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Staff', 'warehouse', '9845000011', false, null, null),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Manager', 'warehouse', '9845000012', true, null, null),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'Ravi', 'driver', '9845000001', false, '22222222-0000-0000-0000-000000000001', null),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'Sharma', 'customer', '9845000002', false, null, '33333333-0000-0000-0000-000000000001');

-- ---------------- owner
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select t.ok(my_role() = 'owner', 'owner recognised');
select add_opening_stock('{"19": {"full": 100, "empty": 20}, "14.2": {"full": 50}}');
select t.ok(t.q('WH', '19', 'full') = 100, 'opening stock lands in the warehouse (stock trigger)');
select t.fails($q$select add_opening_stock('{"19": {"full": 10000}}')$q$, '9,999');
select t.fails($q$select add_opening_stock('{"99": {"full": 1}}')$q$, 'Unknown cylinder size');
select t.fails($q$insert into movements (from_loc, to_loc, size, state, qty, ref_type) values ('PLANT','WH','19','full',5,'x')$q$, 'permission denied');
select t.fails($q$update customers set credit_limit = 999999$q$, 'permission denied');
select t.fails($q$delete from audit_log$q$, 'permission denied');
select set_customer_opening('33333333-0000-0000-0000-000000000001', 5000, '{"19": 3}');
select t.fails($q$select set_customer_opening('33333333-0000-0000-0000-000000000001', 5000, '{"19": 3}')$q$, 'already entered');

-- ---------------- plain warehouse staff
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000002', false);
select t.ok(is_staff() and not can_book_expenses(), 'staff is staff but cannot book expenses');
select create_load_sheet('11111111-0000-0000-0000-000000000001', '{"19": 12}');
select t.ok(t.q('TRUCK:11111111-0000-0000-0000-000000000001', '19', 'full') = 12, 'load sheet moves 12 to the truck');
select t.fails($q$select create_load_sheet('11111111-0000-0000-0000-000000000001', '{"19": 500}')$q$, 'Not enough full');
select t.fails($q$select add_expense('{"date":"2026-01-01","category":"Rent","amount":100,"mode":"cash"}')$q$, 'Only the owner and warehouse managers');
select t.ok((select count(*) from expenses) = 0, 'staff cannot read expenses');
select t.ok((select count(*) from audit_log) = 0, 'staff cannot read the audit log');
select t.fails($q$select add_opening_stock('{"19": {"full": 1}}')$q$, 'Only the owner');
select t.fails($q$select set_manager('aaaaaaaa-0000-0000-0000-000000000002', true)$q$, 'Only the owner');
select create_purchase('pl1', '{"19": 30}', '{"19": 10}', '{}', '{}', ist_today(), '[]');
select t.ok(t.q('WH', '19', 'full') = 118 and t.q('WH', '19', 'empty') = 10, 'plant receipt: +30 full, -10 empty');
select t.ok((select round(total) from invoices where kind = 'purchase') = 30 * 1560 + 10 * 0, 'purchase invoice total at GST-inclusive rate');

-- ---------------- driver
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000004', false);
select t.ok((select count(*) from customers) = 2, 'driver can see customers to deliver to');
select t.ok((select count(*) from invoices where kind = 'purchase') = 0, 'driver cannot see plant purchases (can see sales to collect dues)');
select t.ok((select count(*) from stock) = (select count(*) from stock where loc like 'TRUCK:%'), 'driver sees only own truck stock');
select t.fails($q$select submit_delivery('33333333-0000-0000-0000-000000000001', '{"19": 2}', '{"19": 2}', '{"amount": 100, "mode": "cash"}', 'deliveries/someone-else/x.jpg', '{"lat": 12.9, "lng": 77.5}')$q$, 'photo');
select t.fails($q$select submit_delivery('33333333-0000-0000-0000-000000000001', '{"19": 50}', '{}', null, 'deliveries/aaaaaaaa-0000-0000-0000-000000000004/a.jpg', '{"lat": 12.9, "lng": 77.5}')$q$, 'Not enough full');
select t.fails($q$select submit_delivery('33333333-0000-0000-0000-000000000001', '{"19": 2}', '{}', '{"amount": 3500, "mode": "split", "cash": 1000, "upi": 2000}', 'deliveries/aaaaaaaa-0000-0000-0000-000000000004/a.jpg', '{"lat": 12.9, "lng": 77.5}')$q$, 'add up');
select submit_delivery('33333333-0000-0000-0000-000000000001', '{"19": 2}', '{"19": 2}', '{"amount": 3500, "mode": "split", "cash": 1500, "upi": 2000}', 'deliveries/aaaaaaaa-0000-0000-0000-000000000004/a.jpg', '{"lat": 12.9, "lng": 77.5, "mocked": false}');
select t.ok(t.q('TRUCK:11111111-0000-0000-0000-000000000001', '19', 'full') = 10 and t.q('TRUCK:11111111-0000-0000-0000-000000000001', '19', 'empty') = 2, 'delivery moves 2 full off, 2 empties on');
select t.fails($q$select approve_delivery((select id from deliveries limit 1))$q$, 'Only warehouse staff');
select t.fails($q$select create_load_sheet('11111111-0000-0000-0000-000000000001', '{"19": 1}')$q$, 'Only warehouse staff');

-- ---------------- customer
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000005', false);
select t.ok((select count(*) from customers) = 1, 'customer sees only themselves');
select t.ok((select count(*) from deliveries) = 1, 'customer sees own delivery');
select t.fails($q$select place_order('33333333-0000-0000-0000-000000000002', '{"19": 1}', ist_today(), 'morning', '')$q$, 'own account');
select t.fails($q$select place_order('33333333-0000-0000-0000-000000000001', '{"14.2": 1}', ist_today(), 'morning', '')$q$, 'isn''t available');
select place_order('33333333-0000-0000-0000-000000000001', '{"19": 2}', ist_today() + 1, 'evening', 'Back gate');
select place_order('33333333-0000-0000-0000-000000000001', '{"19": 1}', ist_today(), 'morning', '');
select place_order('33333333-0000-0000-0000-000000000001', '{"19": 1}', ist_today(), 'morning', '');
select t.fails($q$select place_order('33333333-0000-0000-0000-000000000001', '{"19": 1}', ist_today(), 'morning', '')$q$, 'orders on the way');
select handle_order((select id from orders order by ts desc limit 1), 'cancel');
select t.fails($q$select handle_order((select id from orders where status = 'new' limit 1), 'accept')$q$, 'Only warehouse staff');

-- ---------------- manager approves, expenses
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000003', false);
select handle_order((select id from orders where status = 'new' order by ts limit 1), 'accept');
select approve_delivery((select id from deliveries limit 1));
select t.ok((select status from deliveries limit 1) = 'approved', 'manager approved the delivery');
select t.ok((select count(*) from payments) = 2 and (select sum(amount) from payments) = 3500, 'split payment saved as cash + UPI');
select t.ok((select total from invoices where kind = 'sale') = 3500.00, 'sale invoice: 2 × ₹1,750');
select t.ok((select cgst + sgst from invoices where kind = 'sale') = 533.90, 'GST 18% back-calculated: ₹533.90');
select t.ok((select status from orders where status in ('delivered') limit 1) = 'delivered', 'approval closes the accepted order');
select t.fails($q$select approve_delivery((select id from deliveries limit 1))$q$, 'already handled');
select add_expense('{"date": "2026-01-01", "category": "Diesel / fuel", "amount": 2500, "mode": "upi", "paidTo": "IOC"}'::jsonb || jsonb_build_object('date', ist_today()::text));
select t.fails($q$select add_expense(jsonb_build_object('date', (ist_today() + 1)::text, 'category', 'Rent', 'amount', 1, 'mode', 'cash'))$q$, 'future');
select t.fails($q$select add_expense(jsonb_build_object('date', ist_today()::text, 'category', 'Other', 'amount', 1, 'mode', 'cash'))$q$, 'write what');
select t.fails($q$select delete_expense((select id from expenses limit 1))$q$, 'Only the owner');
select t.ok((select count(*) from expenses) = 1, 'manager sees expenses');
select reconcile_truck('11111111-0000-0000-0000-000000000001', '{"19": {"full": 9, "empty": 2}}');
select t.ok((select mismatch from reconciliations limit 1), 'shortage of 1 flagged as mismatch');
select t.ok(t.q('TRUCK:11111111-0000-0000-0000-000000000001', '19', 'full') = 0 and t.q('LOSS', '19', 'full') = 1, 'truck emptied, 1 to LOSS');

-- ---------------- owner again: audit trail and deletes
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select delete_expense((select id from expenses limit 1));
select t.ok((select count(*) from audit_log where action = 'expense_deleted') = 1, 'deleting an expense is logged');
select t.ok((select count(*) from audit_log) >= 10, 'owner sees the full audit log');
select t.fails($q$select set_login_active('aaaaaaaa-0000-0000-0000-000000000001', false)$q$, 'own login');

-- ---------------- signed out
select set_config('request.jwt.claim.sub', '', false);
select t.ok((select count(*) from customers) = 0 and (select count(*) from settings) = 0, 'signed-out user reads nothing');
select t.fails($q$select place_order('33333333-0000-0000-0000-000000000001', '{"19": 1}', ist_today(), 'morning', '')$q$, 'own account');
reset role;
\echo ALL DATABASE TESTS PASSED
