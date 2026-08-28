-- A global recipe share has no client_id. The first RLS version joined
-- metabolic_clients before checking share_all_clients, which made global shares
-- invisible to clients. Keep the database as the authorization boundary.
drop policy if exists "LIVYA clients read shared recipes" on public.metabolic_recipes;
create policy "LIVYA clients read shared recipes"
on public.metabolic_recipes for select to authenticated
using (
  exists (
    select 1
    from public.metabolic_recipe_shares s
    where s.recipe_id = metabolic_recipes.id
      and s.share_all_clients = true
  )
  or exists (
    select 1
    from public.metabolic_recipe_shares s
    join public.metabolic_clients c on c.id = s.client_id
    where s.recipe_id = metabolic_recipes.id
      and c.client_user_id = (select auth.uid())
  )
);
