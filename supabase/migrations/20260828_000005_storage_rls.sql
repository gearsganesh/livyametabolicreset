-- Storage paths are generated as clients/<client-id>/<file-id>-<safe-name>.
-- Keep the object bucket private and make database RLS the source of truth.

insert into storage.buckets (id, name, public)
values ('metabolic-files', 'metabolic-files', false)
on conflict (id) do update set public = false;

drop policy if exists "LIVYA staff upload metabolic files" on storage.objects;
drop policy if exists "LIVYA staff manage metabolic files" on storage.objects;
drop policy if exists "LIVYA clients read visible metabolic files" on storage.objects;

create policy "LIVYA staff upload metabolic files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'metabolic-files'
  and (select private.livya_is_staff())
);

create policy "LIVYA staff manage metabolic files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'metabolic-files'
  and (select private.livya_is_staff())
);

create policy "LIVYA clients read visible metabolic files"
on storage.objects for select to authenticated
using (
  bucket_id = 'metabolic-files'
  and (
    (select private.livya_is_staff())
    or (
      (storage.foldername(name))[1] = (
        select c.id::text
        from public.metabolic_clients c
        where c.client_user_id = (select auth.uid())
          and c.status = 'ACTIVE'
        limit 1
      )
      and exists (
        select 1
        from public.metabolic_files f
        where f.storage_path = storage.objects.name
          and f.bucket_id = storage.objects.bucket_id
          and f.client_visible = true
          and f.status = 'ACTIVE'
      )
    )
  )
);
