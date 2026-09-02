-- Client read receipts must not grant clients UPDATE access to the whole
-- message row. A SECURITY DEFINER function changes only read_by after checking
-- that the caller owns the client conversation.
create or replace function public.metabolic_mark_message_read(message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.metabolic_messages m
  set read_by = array(
    select distinct x
    from unnest(coalesce(m.read_by, '{}'::uuid[]) || array[auth.uid()]) x
  )
  where m.id = metabolic_mark_message_read.message_id
    and exists (
      select 1
      from public.metabolic_clients c
      where c.id = m.client_id
        and c.client_user_id = auth.uid()
        and c.status = 'ACTIVE'
    );
end;
$$;

revoke all on function public.metabolic_mark_message_read(uuid) from public;
grant execute on function public.metabolic_mark_message_read(uuid) to authenticated;
