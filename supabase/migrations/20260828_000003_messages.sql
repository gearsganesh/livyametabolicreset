-- Production message store. The original Claude prototype kept messages only
-- inside the browser's client object. This table makes the conversation durable
-- and available across devices.
create table if not exists public.metabolic_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.metabolic_clients(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete restrict,
  sender_role text not null check (sender_role in ('ADMIN','SUB_ADMIN','CLIENT')),
  body text not null check (length(trim(body)) between 1 and 10000),
  read_by uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists metabolic_messages_client_created_idx
  on public.metabolic_messages(client_id, created_at desc);

alter table public.metabolic_messages enable row level security;
revoke all on public.metabolic_messages from anon;
grant select, insert, update on public.metabolic_messages to authenticated;

drop policy if exists "LIVYA staff manage messages" on public.metabolic_messages;
drop policy if exists "LIVYA clients read own messages" on public.metabolic_messages;
drop policy if exists "LIVYA callers send own messages" on public.metabolic_messages;

create policy "LIVYA staff manage messages"
on public.metabolic_messages for all to authenticated
using ((select private.livya_is_staff()))
with check ((select private.livya_is_staff()) and sender_id = (select auth.uid()));

create policy "LIVYA clients read own messages"
on public.metabolic_messages for select to authenticated
using (exists (
  select 1 from public.metabolic_clients c
  where c.id = metabolic_messages.client_id
    and c.client_user_id = (select auth.uid())
));

create policy "LIVYA callers send own messages"
on public.metabolic_messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1 from public.metabolic_clients c
    where c.id = metabolic_messages.client_id
      and (
        c.client_user_id = (select auth.uid())
        or (select private.livya_is_staff())
      )
  )
);
