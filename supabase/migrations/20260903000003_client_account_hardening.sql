-- Client account hardening.
-- The client identity remains tied to exactly one metabolic client.
create unique index if not exists uq_metabolic_clients_client_user_id
  on public.metabolic_clients(client_user_id)
  where client_user_id is not null;

-- Keep client_user_id out of anonymous access paths.
revoke all on public.metabolic_clients from anon;
grant select, insert, update, delete on public.metabolic_clients to authenticated;
