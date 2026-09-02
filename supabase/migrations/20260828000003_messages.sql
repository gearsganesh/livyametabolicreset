-- LIVYA production message store.
--
-- The live Supabase project already contains an older metabolic_messages
-- shape (conversation_id, sender_id, body, read_at, created_at). This migration
-- upgrades that table in place instead of attempting to recreate it, preserving
-- existing messages and making the schema match the production browser adapter.

alter table public.metabolic_messages
  add column if not exists client_id uuid,
  add column if not exists sender_role text,
  add column if not exists read_by uuid[] not null default '{}',
  add column if not exists local_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Recover the client relationship from the existing conversation records.
update public.metabolic_messages m
set client_id = c.client_id
from public.metabolic_conversations c
where c.id = m.conversation_id
  and m.client_id is null;

-- Existing rows must be attributable to a client before the new authorization
-- boundary is enabled. Fail the migration rather than silently creating an
-- inaccessible or cross-client message.
do $$
begin
  if exists (select 1 from public.metabolic_messages where client_id is null) then
    raise exception 'LIVYA message migration: one or more messages have no resolvable client_id';
  end if;
end;
$$;

-- Derive the immutable sender role from the authenticated identity model.
update public.metabolic_messages m
set sender_role = 'CLIENT'
where sender_role is null
  and exists (
    select 1
    from public.metabolic_clients c
    where c.client_id_user_id = m.sender_id
  );

-- Correct the column name used by the live clients table if the FK exposes
-- client_user_id, which is the production schema.
update public.metabolic_messages m
set sender_role = 'CLIENT'
where sender_role is null
  and exists (
    select 1
    from public.metabolic_clients c
    where c.client_user_id = m.sender_id
  );

update public.metabolic_messages m
set sender_role = case
  when p.role = 'ADMIN' then 'ADMIN'
  when p.role = 'SUB_ADMIN' then 'SUB_ADMIN'
  else null
end
from public.metabolic_profiles p
where m.sender_role is null
  and p.user_id = m.sender_id;

do $$
begin
  if exists (
    select 1 from public.metabolic_messages
    where sender_role is null
       or sender_role not in ('ADMIN','SUB_ADMIN','CLIENT')
  ) then
    raise exception 'LIVYA message migration: one or more messages have no resolvable sender role';
  end if;
end;
$$;

-- Existing IDs become stable local IDs. Legacy read_at is retained and copied
-- into metadata because the old schema did not record which user read a message.
update public.metabolic_messages
set local_id = coalesce(local_id, id::text),
    metadata = case
      when read_at is not null and not (metadata ? 'legacy_read_at')
        then metadata || jsonb_build_object('legacy_read_at', read_at)
      else metadata
    end;

alter table public.metabolic_messages
  alter column client_id set not null,
  alter column sender_role set not null;

alter table public.metabolic_messages
  drop constraint if exists metabolic_messages_sender_role_check;
alter table public.metabolic_messages
  add constraint metabolic_messages_sender_role_check
  check (sender_role in ('ADMIN','SUB_ADMIN','CLIENT'));

alter table public.metabolic_messages
  drop constraint if exists metabolic_messages_body_length_check;
alter table public.metabolic_messages
  add constraint metabolic_messages_body_length_check
  check (length(trim(body)) between 1 and 10000);

-- Add the expected foreign key only if the live database does not already have it.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'metabolic_messages_client_id_fkey'
      and conrelid = 'public.metabolic_messages'::regclass
  ) then
    alter table public.metabolic_messages
      add constraint metabolic_messages_client_id_fkey
      foreign key (client_id)
      references public.metabolic_clients(id)
      on delete cascade;
  end if;
end;
$$;

create unique index if not exists metabolic_messages_local_id_uidx
  on public.metabolic_messages(local_id)
  where local_id is not null;

create index if not exists metabolic_messages_client_created_idx
  on public.metabolic_messages(client_id, created_at desc);

-- The application now uses client_id, not conversation_id, for authorization.
alter table public.metabolic_messages enable row level security;
revoke all on public.metabolic_messages from anon;
grant select, insert on public.metabolic_messages to authenticated;

drop policy if exists "LIVYA staff manage messages" on public.metabolic_messages;
drop policy if exists "LIVYA clients read own messages" on public.metabolic_messages;
drop policy if exists "LIVYA callers send own messages" on public.metabolic_messages;

create policy "LIVYA staff manage messages"
on public.metabolic_messages for all to authenticated
using ((select private.livya_is_staff()))
with check ((select private.livya_is_staff()) and sender_id = (select auth.uid()));

create policy "LIVYA clients read own messages"
on public.metabolic_messages for select to authenticated
using (
  exists (
    select 1
    from public.metabolic_clients c
    where c.id = metabolic_messages.client_id
      and c.client_user_id = (select auth.uid())
  )
);

create policy "LIVYA callers send own messages"
on public.metabolic_messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1
    from public.metabolic_clients c
    where c.id = metabolic_messages.client_id
      and (
        c.client_user_id = (select auth.uid())
        or (select private.livya_is_staff())
      )
  )
);
