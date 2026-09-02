# LIVYA Metabolic

LIVYA Metabolic is the metabolic and obesity-management application used by LIVYA. The original Claude-generated prototype was a single offline HTML application. The repository now keeps that clinical UI while moving identity, clinical data, files, and messaging onto Supabase and deploying the frontend through Vercel.

## Production architecture

- **Frontend:** existing single-page clinical UI in `index.html`
- **Hosting:** Vercel
- **Authentication:** Supabase Auth
- **Database:** Supabase Postgres
- **File storage:** private Supabase Storage bucket `metabolic-files`
- **Server-side privileged operations:** Supabase Edge Function `metabolic-api`
- **Browser credential:** Supabase publishable key only
- **Authorization:** Postgres Row Level Security plus server-side role checks
- **Messaging:** durable `metabolic_conversations` and `metabolic_messages` tables

The inherited browser model remains only as a UI compatibility/cache layer during this migration. It is not an authorization boundary and must never be treated as the source of truth for permissions.

## Production accounts

The application uses Supabase Auth accounts. Production authentication does not depend on the prototype demo-account or browser PBKDF2 flow.

Staff application roles are stored in `metabolic_profiles` and currently include `ADMIN` and `SUB_ADMIN`. Client identities are represented by `metabolic_clients.client_user_id`.

## Development

Install Node.js 22 or newer. The repository intentionally has no frontend dependency tree because the clinical UI is currently shipped as a static HTML application.

```bash
npm run check
npm run build
```

The original offline launchers remain available for UI-only development:

```text
Windows: start-windows.bat
Mac/Linux: start-mac-linux.command
```

## Vercel

Vercel runs:

```text
npm run build
```

which invokes `scripts/prepare-vercel.mjs` and produces `.vercel/output/static`.

The build injects the production Supabase adapters into a generated copy of the clinical HTML. No Supabase secret/service-role key may ever be committed or shipped to the browser.

## Supabase migrations

The migration directory is intentionally ordered and uses valid Supabase CLI timestamps:

```text
supabase/migrations/
  20260828000001_bootstrap_admin_profiles.sql
  20260828000002_production_rls.sql
  20260828000003_messages.sql
  20260828000004_recipe_share_policy_fix.sql
  20260828000005_storage_rls.sql
  20260828000006_message_read_receipts.sql
  20260828000007_conversation_rls.sql
```

The live project already had an older `metabolic_messages` table. Migration `000003` therefore upgrades it in place, backfills `client_id` and `sender_role`, preserves existing messages, and then enables the new authorization boundary.

Before applying migrations to a production database, inspect the live schema and take the normal database backup. Apply the migrations through the Supabase SQL Editor or Supabase CLI, then verify the resulting migration status.

## Security boundary

Every exposed clinical table must have RLS enabled and explicit policies for the operations it supports. Browser role checks are convenience logic only.

The production policy model is:

1. Supabase Auth establishes the caller identity.
2. `metabolic_profiles` establishes active staff roles.
3. Clients can access only rows tied to their `client_user_id`.
4. Staff access is controlled by the `private.livya_is_staff()` security-definer helper.
5. Storage access is restricted by Storage policies and signed URLs.
6. Client message read receipts use a narrowly scoped security-definer RPC instead of granting clients general message updates.
7. Unauthenticated (`anon`) access is revoked from clinical application tables.

## Repository checks

```bash
npm run audit
npm run verify
npm run check
```

GitHub Actions runs the production audit and Supabase migration verification on pushes to `main`.

If `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` repository secrets are configured, CI also runs `supabase migration list` against the linked production project. Without those secrets, CI still validates the repository migrations and production build.

## Important production rule

Never commit:

- `sb_secret_...`
- legacy `service_role` keys
- Supabase database passwords
- Edge Function service credentials
- `.env` files containing secrets

A Supabase publishable key may be present in browser configuration. RLS, Storage policies, and server-side authorization must provide the actual security boundary.

## Clinical note

LIVYA Metabolic organizes measurements and clinical records. It is not a diagnostic authority and does not replace clinician judgement. Clinical thresholds and derived findings must be reviewed and approved by the responsible clinical team before real-world use.
