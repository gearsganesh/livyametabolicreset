# LIVYA Metabolic — Production Audit

Audit date: 2026-08-28
Branch: `production-hardening`

## Scope

Reviewed the repository structure, current `main` source tree, recent Supabase integration commits, Vercel build path, Supabase browser bridge, persistence adapter, Storage helper, Edge Function, and the original prototype documentation.

## Findings

### P0 — Prototype authentication is still embedded in the application

`index.html` remains the original Claude-generated single-file application and still contains the prototype authentication/data model. `supabase-bridge.js` intercepts the login form and makes Supabase Auth authoritative, but this is an overlay rather than a clean production authentication boundary.

**Action:** keep Supabase Auth as the only production authentication authority and remove prototype account/password creation code from the shipped application in a later controlled refactor. The current branch must not reintroduce demo-account UI or local password authentication.

### P0 — Supabase schema and RLS are not versioned in the repository

The repository references tables such as `metabolic_profiles`, `metabolic_clients`, `metabolic_reports`, `metabolic_checkins`, `metabolic_notes`, `metabolic_programs`, `metabolic_diet_plans`, `metabolic_recipes`, and `metabolic_files`, but there is no SQL migration/test suite in the repository that defines or verifies them.

**Action:** add a reproducible Supabase migration set and RLS tests after confirming the live project schema. Do not invent policies from the frontend alone.

### P0 — Messages are not connected to Supabase

The original application has a client/staff messaging model, but the production persistence/hydration bridge contains no message table integration. Messages therefore remain a browser-side feature rather than a shared production record.

**Action:** identify the live message schema, then add authenticated hydration, writes, read state, and RLS.

### P0 — Deletes are not synchronized by the generic persistence bridge

The write-through adapter primarily performs upserts. Removing a client/report/check-in/note/recipe from the local model does not automatically remove or soft-delete the corresponding Supabase row.

**Action:** implement explicit production delete/soft-delete operations per entity and connect the existing UI actions to them. Prefer soft deletion for clinical records where appropriate.

### P1 — Client hydration over-fetches recipe data

The bridge fetches all active recipes and then stores sharing metadata locally. A client can therefore receive recipe records that are intended to remain library-only. UI filtering is not sufficient confidentiality because the browser already has the data.

**Action:** fetch only recipes a client is entitled to see, ideally by a server/RLS policy rather than by a client-side filter.

### P1 — Client hydration over-fetches programme data

The bridge fetches the full programme library even for clients. Client-visible programme data should be restricted to programmes actually assigned to that client unless the product explicitly requires otherwise.

**Action:** scope programme queries by assignment for client sessions and enforce the same rule in RLS.

### P1 — Audit log persistence is not idempotent

`persistAudit()` takes the first local audit entries and inserts them again on later saves. There is no stable source-event identifier used for deduplication.

**Action:** give audit events stable IDs and upsert them, or write audit events only at the action boundary rather than replaying the local audit array.

### P1 — The current app still uses localStorage as a mutable application database

The production bridge keeps the original local DB as the UI view model. This is acceptable as a migration compatibility layer, but it must not become an authorization boundary. A user can alter browser storage and JavaScript state.

**Action:** treat Supabase Auth + RLS as authoritative. Local state is a cache/view model only.

### P1 — Production documentation is stale

`README.md` and `docs/build-notes.md` still describe the app as an offline prototype with PBKDF2 browser authentication and local-only storage.

**Action:** update production documentation after the backend contract is finalized.

### P2 — Build pipeline contains migration-era patching

The repository previously used GitHub Actions to patch `index.html` and the login UI after commits. The Vercel build script already injects the production bridge, so these patch workflows are migration leftovers and create hidden source/build divergence.

**Action completed on this branch:** removed both obsolete patch workflows.

### P2 — Supabase publishable key is committed to source

This is not itself a secret. Supabase documents publishable keys as safe for browser code when RLS and least-privilege grants are correctly configured. The important missing control is the database policy layer, not hiding the publishable key.

## Validation still required against the live Supabase project

1. Confirm both existing Auth users have an `ACTIVE` row in `metabolic_profiles` with the expected roles.
2. Confirm the profile SELECT policy allows an authenticated user to read their own profile.
3. Confirm every exposed production table has RLS enabled.
4. Confirm SELECT/INSERT/UPDATE/DELETE policies for administrator, sub-admin, and client access.
5. Confirm Storage policies for `metabolic-files`.
6. Confirm the `metabolic-api` Edge Function is deployed from this repository and has its server secret configured.
7. Confirm the Vercel production deployment is using the current `main` build and the dedicated Supabase project.

## Current priority order

1. Make Supabase Auth the only login authority and remove prototype auth from shipped code.
2. Verify/fix `metabolic_profiles` and RLS so login cannot fail after Auth succeeds.
3. Version the database schema and RLS tests in this repository.
4. Connect messages to Supabase.
5. Implement reliable delete/soft-delete synchronization.
6. Restrict client hydration at the database layer.
7. Replace the local-storage view-model bridge with smaller domain adapters as each module is hardened.
