# LIVYA Metabolic

LIVYA Metabolic is the metabolic and obesity-management application used by LIVYA. The original Claude-generated prototype was a single offline HTML application; the current repository is being hardened into the production application backed by Supabase Auth, Postgres, Storage, Edge Functions, and Vercel.

## Production stack

- **Frontend:** existing single-page clinical UI in `index.html`
- **Hosting:** Vercel
- **Authentication:** Supabase Auth
- **Database:** Supabase Postgres
- **File storage:** Supabase Storage bucket `metabolic-files`
- **Server-side privileged operations:** Supabase Edge Function `metabolic-api`
- **Public browser credential:** Supabase publishable key only
- **Authorization:** Supabase Row Level Security plus application role checks

The browser-side local model is a compatibility/cache layer inherited from the prototype. It is **not** an authorization boundary and must never be treated as the source of truth for permissions.

## Production accounts

The application uses Supabase Auth accounts. There are no production demo accounts and there is no production PBKDF2/browser-password flow.

Current staff accounts are managed in **Supabase → Authentication → Users**. Application roles are stored in `metabolic_profiles` and are checked after authentication.

## Local development

The original offline launcher is still available for UI development:

```text
Windows: start-windows.bat
Mac/Linux: start-mac-linux.command
```

For a production-authenticated build, serve the site over HTTP and ensure the Supabase project configured in `supabase-config.js` is the intended development/project backend.

## Vercel build

Vercel runs:

```text
node scripts/prepare-vercel.mjs
```

The build creates a Build Output API static deployment under `.vercel/output/static`, copies the production Supabase adapters, and injects them into the generated HTML. The Supabase publishable key is safe to ship to the browser only because database and Storage access must be protected by RLS and least-privilege grants.

## Supabase files

```text
supabase/
  functions/
    metabolic-api/
      deno.json
      index.ts

supabase-config.js
supabase-bridge.js
supabase-persistence.js
supabase-storage.js
```

### `supabase-bridge.js`

Owns the production authentication bridge and background hydration. Supabase Auth is authoritative for sign-in. Bulk database hydration must never be allowed to keep the login button stuck.

### `supabase-persistence.js`

Provides the temporary write-through adapter between the inherited local UI model and the Supabase tables. This is a migration layer, not the final domain architecture.

### `supabase-storage.js`

Provides authenticated file upload/download/delete helpers and routes privileged client-account operations through the Edge Function.

### `metabolic-api`

Validates the caller's Supabase JWT and active `metabolic_profiles` row before serving requests. Administrator-only account creation/status changes use a server-side secret key and never expose that key to the browser.

## Important production rule: RLS

Every exposed application table must have Row Level Security enabled and explicit policies for the required operations. UI role checks alone are not security because browser state can be modified by the user.

Before production use, verify:

1. `metabolic_profiles` lets a signed-in user read their own profile.
2. Administrator and sub-admin access matches the intended clinic rules.
3. Client access is restricted to that client's own records.
4. Inactive profiles cannot read or modify clinical data.
5. Storage policies restrict objects to the intended staff/client access.
6. Delete policies exist only where the product permits deletion.
7. RLS tests cover both allowed and denied access.

See `docs/production-audit.md` for the current hardening list.

## Current hardening status

The repository is being migrated in stages because the original application contains a large amount of tightly coupled prototype UI and data logic.

Completed on the `production-hardening` branch:

- removed obsolete login-cleanup GitHub Actions workflow
- removed obsolete Supabase bridge patch workflow
- documented the production architecture and security boundary
- hardened the `metabolic-api` Edge Function runtime-key lookup for current and legacy Supabase environments
- improved Edge Function HTTP status handling for authentication, authorization, validation, and server errors

Still required before declaring the application fully production-hardened:

- remove the prototype authentication implementation from shipped application code
- version the live Supabase schema and RLS policies in migrations
- add RLS tests
- connect messages to Supabase
- synchronize deletes/soft-deletes
- prevent clients from receiving unshared recipe/program data
- make audit events idempotent
- verify Storage policies and bucket restrictions
- verify the deployed Edge Function version and secrets

## Repository documentation

- `docs/production-audit.md` — current production audit and priority list
- `docs/build-notes.md` — historical prototype architecture and clinical design notes
- `samples/` — development-only sample reports and diet sheets

## Security note

Never commit a Supabase secret/service-role key. A browser build may contain the `sb_publishable_...` key, but it must never contain an `sb_secret_...` or legacy `service_role` key.

## Clinical note

LIVYA Metabolic organizes measurements and clinical records. It is not a diagnostic authority and does not replace clinician judgement. Clinical thresholds and derived findings must be reviewed and approved by the responsible clinical team before real-world use.
