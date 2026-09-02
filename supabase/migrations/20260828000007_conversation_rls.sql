-- Conversations are part of the production messaging boundary.
-- Staff can manage all conversations. Clients can only read their own
-- conversation and cannot directly alter assignment metadata.

alter table public.metabolic_conversations enable row level security;
revoke all on public.metabolic_conversations from anon;
grant select, insert, update, delete on public.metabolic_conversations to authenticated;

drop policy if exists "LIVYA staff manage conversations" on public.metabolic_conversations;
drop policy if exists "LIVYA clients read own conversation" on public.metabolic_conversations;

action -- placeholder
