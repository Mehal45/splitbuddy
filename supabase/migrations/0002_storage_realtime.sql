-- File storage (delivery photos, plant receipts, expense bills) and live updates.
-- Run after 0001_init.sql in the Supabase SQL Editor.

-- Private bucket: files are only reachable through short-lived signed links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('files', 'files', false, 1500000, array['image/jpeg', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 1500000, allowed_mime_types = array['image/jpeg', 'application/pdf'];

-- Paths look like  <folder>/<uploader's user id>/<random>.jpg|pdf
drop policy if exists "files: upload into own folder" on storage.objects;
create policy "files: upload into own folder" on storage.objects for insert to authenticated
with check (
  bucket_id = 'files'
  and (storage.foldername(name))[2] = auth.uid()::text
  and (
    ((storage.foldername(name))[1] = 'deliveries' and public.my_role() = 'driver')
    or ((storage.foldername(name))[1] = 'receipts' and public.is_staff())
    or ((storage.foldername(name))[1] = 'expenses' and public.can_book_expenses())
  )
);

drop policy if exists "files: read by role" on storage.objects;
create policy "files: read by role" on storage.objects for select to authenticated
using (
  bucket_id = 'files' and (
    ((storage.foldername(name))[1] = 'deliveries' and (
      public.is_staff()
      or (storage.foldername(name))[2] = auth.uid()::text
      or exists (select 1 from public.deliveries d where d.photo = name and d.customer_id = public.my_customer_id())))
    or ((storage.foldername(name))[1] = 'receipts' and public.is_staff())
    or ((storage.foldername(name))[1] = 'expenses' and public.can_book_expenses())
  )
);

drop policy if exists "files: owner deletes" on storage.objects;
create policy "files: owner deletes" on storage.objects for delete to authenticated
using (bucket_id = 'files' and public.is_owner());

-- Live updates: the app listens to these tables (row rules above still apply).
do $$
declare t text;
begin
  foreach t in array array['deliveries', 'orders', 'load_sheets', 'reconciliations', 'invoices', 'payments', 'expenses', 'movements', 'customers', 'trucks', 'profiles', 'settings', 'sizes', 'attachments'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
