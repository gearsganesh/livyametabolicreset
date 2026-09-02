-- Conversations are part of the production messaging boundary.
-- Staff can manage all conversations. Clients can only read their own
-- conversation and cannot directly alter assignment metadata.

alter table public.metabolic_conversations enable row level security;
revoke all on public.metabolic_conversations from anon;
grant select, insert, update, delete on public.metabolic_conversations to authenticated;

drop policy if exists "LIVYA staff manage conversations" on public.metabolic_conversations;
drop policy if exists "LIVYA clients read own conversation" on public.metabolic_conversations;

create policy "LIVYA staff manage conversations"
on public.metabolic_conversations for all to authenticated
using ((select private.livya_is_staff()))
with check ((select private.livya_is_staff()));

create policy "LIVYA clients read own conversation"
on public.metabolic_conversations for select to authenticated
using (
  exists (
    select 1
    from public.metabolic_clients c
    where c.id = metabolic_conversations.client_id
      and c.client_user_id = (select auth.uid())
      and c.status = 'ACTIVE'
  )
);
