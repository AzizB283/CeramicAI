# Plan: Super-admin panel + per-factory scoped logins

**Date:** 2026-05-29
**Goal:** Turn the single-tenant admin into a two-role multi-tenant system:
- **Super-admin** (Aurex Auto): create/manage factories, **and enter any factory's
  admin panel to manage their config on their behalf** (help a client who's stuck).
- **Factory admin** (the client): log into a panel scoped to *their* factory only.

**Decisions (from user):**
- Aurex-only onboarding — no factory self-serve signup.
- Factories get their own scoped logins (full auth rework, not just a picker).
- **Super-admin CAN access/manage a factory's admin panel** (products, catalogues,
  branding, WhatsApp config). This is the deliberate difference from clinic-ai,
  which forbade it for GDPR — see "Impersonation & the PII boundary" below.
- This document is the plan; **no code yet** until reviewed.

## Resolved decisions
- Aurex-only onboarding (no self-serve).
- Factories get their own scoped logins.
- Super-admin **can** impersonate a factory and manage its full panel.
- Buyer-lead PII: **full access while impersonating + audit log** (option A).
- Impersonation lives on the **server session** (`actingClientId`), not a
  client-sent header — server is the source of truth.
- Roles: `"superadmin"` / `"factory"` (no "doctor"). Usernames globally unique.
- Passwords handed off out-of-band (returned once on create/reset; no email/link).

## Resolved decisions (round 2)
1. **Multiple admins per factory** — YES, allowed, all equal (clinic-ai parity).
   Super-admin adds/removes them on the factory detail page.
2. **Slug is IMMUTABLE after create** — only `name`/owner/active are editable.
   The create form lets super-admin set the slug; after that it's locked (it's
   the WhatsApp webhook URL + embed `data-client`, breaking it = breaking live
   integrations). Enforce on the server: `PATCH /clients/:id` rejects `slug`.
3. **Suspending a factory takes the BOT OFFLINE too** (hard stop). When
   `active=false`:
   - admin login for that factory's users is blocked,
   - **the buyer-facing bot returns a "service unavailable" message** instead of
     running the flow. This touches the buyer-facing path — see Phase 4b below.
4. **WhatsApp creds ARE editable while impersonating** — super-admin gets the
   full panel including the WhatsApp integration page (encrypted tokens). Audited.
5. **Demo client** — shows in `/superadmin` like any factory, flagged with a
   "demo" badge (derived from slug `demo`), not hidden. (Default choice; flag if
   you'd rather hide it.)
6. **Audit visibility** — a "Recent super-admin activity" panel is **out of scope
   for v1**; `superadmin_actions` is DB-only for now (queryable, not surfaced in
   UI). (Default choice; easy to add a read-only view later.)

## How this matches clinic-ai (the proven blueprint we're porting)

Researched `/home/tops/Documents/Projects/DEMO/clinic-ai-automation`. We mirror
its structure 1:1 where it fits, and extend it for impersonation:

| clinic-ai | CeramicBot equivalent |
| --- | --- |
| `admin_users` table, `role` text col ("superadmin"\|"admin"\|"doctor") | `admin_users`, role ("superadmin"\|"factory") — no doctor role |
| `clinics` tenant root | `ceramic_clients` (already exists) |
| `clinicId` nullable (NULL for superadmin) | `clientId` nullable (NULL for superadmin) |
| `requireSuperAdmin` middleware → 403 | same, copy verbatim |
| `app.use("/api/superadmin", requireSuperAdmin)` prefix guard | same |
| Routes: list/create clinics, add admin, reset pw, suspend, embed-domains | same set, ceramic-flavored |
| Username globally unique; bcrypt(12); plaintext pw returned once on create/reset | same |
| seed creates superadmin from env, prints once | same |
| **No impersonation** (super can't enter a clinic) — GDPR | **WE ADD impersonation**, but gate buyer-lead PII |
| superadmin redirected away from `/admin` | superadmin CAN enter `/admin` while impersonating |

---

## Current state (what blocks multi-tenancy today)

The **data layer is already multi-tenant** and stays as-is:
- `ceramic_clients` is the tenant root; `ceramic_leads/followups/catalogues/products`
  all carry `client_id`.
- `storage.ts` enforces scoping via `scope()` / `withClientId()` / `runWithClient()`.
- `TENANT_MODE=multi` makes every storage call throw unless wrapped in
  `runWithClient(clientId, …)`.
- WhatsApp webhook already routes by slug (`/api/whatsapp/:slug`).

The **admin/auth surface** is what's single-tenant:
1. `server/auth.ts` — one admin user from `ADMIN_USERNAME`/`ADMIN_PASSWORD` env,
   hashed at boot. No users table, no roles, no client association.
2. `server/routes/admin.ts` — **every handler calls `ensureDemoClient()`** and
   operates on that one row. ~12 call sites.
3. `server/seed.ts` — `ensureDemoClient()` caches a single client id.
4. `server/routes/chat.ts` — web chat is pinned to `ensureDemoClient()` too
   (the WhatsApp path is already slug-based; the web path is not).
5. Client: `use-auth.ts` / `login.tsx` know only `{ username }`, always
   redirect to `/admin`.

**Key de-risking fact:** the buyer-facing bot (chat/public/whatsapp) resolves its
tenant independently of the admin session. So the auth rework touches the admin
panel only — it cannot break a live buyer conversation. The one exception we
*choose* to also fix: making web chat slug-aware (Phase 4) so a second factory's
embedded widget talks to the right tenant.

---

## Target model

Two roles on one session (clinic-ai uses 3 — we drop "doctor"):
```
session.user = {
  id: string,              // admin_users.id
  username: string,
  name: string | null,
  role: "superadmin" | "factory",
  clientId: string | null, // NULL for superadmin; the factory's id for factory admins
}
```
Plus a separate session field for impersonation (NOT on `user`, so it's
obviously distinct and easy to clear):
```
session.actingClientId?: string  // set only when a superadmin enters a factory panel
```

- **Factory admin:** `role="factory"`, `clientId` set. Admin routes scope to
  `session.user.clientId`. Structurally cannot see another factory.
- **Super-admin:** `role="superadmin"`, `clientId=null`. Lists/creates factories
  via `/api/superadmin/*`. To manage a factory's config, it **starts an
  impersonation session** (sets `session.actingClientId`) and uses the *same*
  `/api/admin/*` routes the factory admin uses — scoped to the acting client.

(We match clinic-ai's `role` values — `"superadmin"` / `"factory"` instead of
`"admin"`/`"doctor"`. Username is globally unique, exactly like clinic-ai.)

---

## Impersonation & the PII boundary (the key extension over clinic-ai)

Clinic-ai forbade super-admin from entering a clinic because clinics hold
**patient medical PII** — a GDPR minefield. CeramicBot is different:

- The factory's **config** (products, catalogues, branding, WhatsApp setup) is
  exactly what you'd help a stuck client with. **Super-admin gets full access.**
- The factory's **buyer leads** contain PII (buyer name + phone, AES-encrypted at
  rest). **DECIDED — option A (full access + audit log):** while impersonating, a
  super-admin sees everything the factory admin sees, **including leads**. Every
  impersonation session and every PII-bearing read while impersonating is written
  to a `superadmin_actions` audit table, so there's an accountability trail.
  (We are Aurex / the data processor; full access is acceptable with logging.)

Impersonation is **explicit** (you click "Manage" on a factory), **visible** (a
persistent "You are managing <Factory> as super-admin — Exit" banner across
`/admin`), and **logged** (`superadmin_actions` rows). The audit table is now a
**required** part of Phase 1, not optional.

---

## Phase 1 — Schema: `admin_users` (+ optional `superadmin_actions`)

New table in `shared/schema.ts` + migration `0004_admin_users.sql`. Mirrors
clinic-ai's `admin_users` minus the doctor bits:

```ts
export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").references(() => ceramicClients.id), // NULL for superadmin
  username: text("username").notNull().unique(),       // globally unique
  password: text("password").notNull(),                // bcrypt hash (match clinic-ai col name)
  name: text("name"),
  role: text("role").notNull().default("factory"),     // "superadmin" | "factory"
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => [ index("idx_admin_users_client_id").on(t.clientId) ]);
```

**Required** audit table (option A is decided): `superadmin_actions`
```ts
export const superadminActions = pgTable("superadmin_actions", {
  id: serial("id").primaryKey(),
  superadminId: uuid("superadmin_id").notNull().references(() => adminUsers.id),
  clientId: uuid("client_id").references(() => ceramicClients.id), // target factory
  action: text("action").notNull(),   // "impersonate_start" | "impersonate_stop" | "view_leads" | "edit_products" | ...
  detail: text("detail"),              // optional human-readable context
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => [ index("idx_superadmin_actions_client").on(t.clientId) ]);
```
We log: every `impersonate_start`/`stop`, and any read of a PII-bearing endpoint
(the leads list/detail) while impersonating. Config edits can be logged too but
are lower-stakes; **decision: log impersonate start/stop + all leads reads**
(keeps the table small and focused on the sensitive surface).

**Bootstrap (in `seed.ts`, matching clinic-ai's seed):**
- If no `role="superadmin"` exists, create one from `SUPERADMIN_USERNAME` /
  `SUPERADMIN_PASSWORD` env (defaults `superadmin` / generated), bcrypt(12),
  print once to stdout, never to a file.
- Ensure the existing demo client has a `role="factory"` admin user bound to it,
  seeded from the current `ADMIN_USERNAME`/`ADMIN_PASSWORD` env — so today's
  demo login keeps working unchanged after the migration.

Idempotent migration (`CREATE TABLE IF NOT EXISTS`), 0003 style. Run
`npm run db:generate` for the snapshot.

---

## Phase 2 — Auth rework (DB-backed, role-aware) — mirrors clinic-ai

**`server/auth.ts`:**
- Replace env `verifyAdmin` with a DB lookup: fetch `admin_users` by username,
  bcrypt-compare `password`, return the row (or null). Keep constant-time
  compare-on-miss so we don't leak which usernames exist.
- Extend the `declare module "express-session"` augmentation: `user` gains
  `id`/`name`/`role`/`clientId`; add `actingClientId?: string`.
- `requireAuth` unchanged.
- Add `requireSuperAdmin(req,res,next)` → 401 if no user, 403 unless
  `role==="superadmin"` (copy clinic-ai's middleware verbatim).
- Add `effectiveClientId(req): string` helper (Phase 3).

**`server/routes/auth.ts`:**
- `/login` stores the full user on the session; returns `{ username, role }`.
- `/me` returns `{ username, name, role, clientId, actingClientId }` so the
  client can route + render the impersonation banner.
- `/logout` clears everything (unchanged).

`bcryptjs` already a dep. No new packages.

---

## Phase 3 — Tenant resolution in admin routes (with impersonation)

Replace all `await ensureDemoClient()` in `server/routes/admin.ts` (~12 sites)
with one resolver:

```ts
function effectiveClientId(req): string {
  const u = req.session.user!;
  if (u.role === "factory") return u.clientId!;          // locked to own factory
  // superadmin: must be impersonating a specific factory to use /api/admin/*
  const acting = req.session.actingClientId;
  if (!acting) throw new HttpError(403, "Start a factory session first");
  return acting;
}
```

- Factory admins: client id comes **only from the session**, never from input —
  structurally can't touch another tenant.
- Super-admin: must explicitly start impersonation. New endpoints on the
  superadmin router (Phase 5): `POST /api/superadmin/impersonate/:clientId`
  (sets `session.actingClientId`) and `POST /api/superadmin/impersonate/stop`
  (clears it). The super UI calls these on "Manage" / "Exit".
- Wrap handler bodies in `runWithClient(effectiveClientId(req), …)` — standardize
  all ~12 sites.
- **Leads endpoints (PII):** allowed for an impersonating super-admin (option A),
  but each `GET /api/admin/leads` and `GET /api/admin/leads/:id` writes a
  `superadmin_actions` row (`action="view_leads"`) when `role==="superadmin"`.
  Factory admins read their own leads with no audit row.

**Why session-based impersonation, not a header:** putting `actingClientId` on
the server session (not a client-sent header) means the client can't forge which
tenant it's acting on — the server is the source of truth, set only via the
guarded impersonate endpoint. Safer than the header approach I floated earlier.

---

## Phase 4 — Make web chat slug-aware (so factory #2's widget works)

`server/routes/chat.ts` currently calls `ensureDemoClient()`. Change
`POST /api/chat/session` to accept a `client` slug (the embed already passes
`?client=<slug>` to the widget and `/chat` page):
- Resolve via `storage.getClientBySlug(slug)`, fall back to demo when absent
  (keeps the bare demo working).
- Store the resolved `clientId` on the chat session so subsequent
  `/message` calls stay on the right tenant.
- `public.ts` `widget-config` already takes `?client=` — verify it honors it
  (currently it calls `ensureDemoClient()` — needs the same slug treatment).

This is additive (demo path unchanged).

---

## Phase 4b — Suspension kill-switch (buyer-facing)

Because suspending a factory now takes its **bot offline** (decision 3), the
buyer-facing entrypoints must check `client.active`:
- **Web chat** (`POST /api/chat/session`): after resolving the client by slug, if
  `!client.active`, return a terminal snapshot with a single bot message
  ("This service is currently unavailable. Please contact us directly.") and do
  NOT start a flow. Existing in-flight sessions: check `active` on each
  `/message` too, so a suspend mid-conversation stops it.
- **WhatsApp webhook** (`POST /api/whatsapp/:slug`): if the resolved client is
  inactive, ack Meta with 200 (so they stop retrying) but skip the bot reply
  (or send the unavailable message once). Don't process the inbound flow.
- **`widget-config`**: can still return branding (harmless), or optionally signal
  `{ active: false }` so the embed could hide itself. Minor; decide at build.

Copy text for the unavailable message: keep it neutral and non-alarming — the
buyer shouldn't see "suspended". One line, configurable later.

**Revised de-risking note:** the auth rework is still admin-only, BUT decision 3
(suspend = bot offline) deliberately adds a small buyer-facing guard. It's a
single `active` check at each entrypoint, defaulting to today's behavior when
`active=true` (which all existing rows are). Low risk, but no longer "zero
buyer-facing change".

---

## Phase 5 — Super-admin API — mirrors clinic-ai's `superadmin.ts`

New `server/routes/superadmin.ts`, mounted exactly like clinic-ai:
`app.use("/api/superadmin", requireSuperAdmin, superadminRouter)` — the prefix
guard means no route here can ship unguarded.

Endpoints (clinic-ai parity + ceramic flavor + impersonation):
- `GET /api/superadmin/clients` → list all factories with usage counts
  (name, slug, mode, active, leadCount, productCount, catalogueCount, adminCount).
  Cross-tenant read (like `getDueFollowups` — intentionally unscoped, super-only).
- `GET /api/superadmin/clients/:id` → one factory + its admin users.
- `POST /api/superadmin/clients` → **create factory + first admin in one op**
  (clinic-ai's flagship endpoint):
  1. generate unique slug from a `slugBase` (retry on collision, like
     `buildClinicSlug`),
  2. insert `ceramic_clients` row (name, slug, mode, owner…),
  3. check `adminUsername` is globally unique,
  4. bcrypt(12) the provided password, insert `admin_users` row
     (`role="factory"`, `clientId=newClient.id`),
  5. return `{ client, admin: { username, password } }` — **plaintext password
     returned ONCE** for out-of-band handoff (never emailed, never in GET).
- `PATCH /api/superadmin/clients/:id` → toggle active / edit name / owner.
- `POST /api/superadmin/clients/:id/admins` → add another factory admin.
- `POST /api/superadmin/admins/:id/reset-password` → new password, returned once.
  Guard: refuse to reset a `role="superadmin"` account (anti-lockout, exactly
  like clinic-ai's `role != 'superadmin'` filter).
- **`POST /api/superadmin/impersonate/:clientId`** → set `session.actingClientId`
  (after verifying the client exists). *New vs clinic-ai.*
- **`POST /api/superadmin/impersonate/stop`** → clear it. *New vs clinic-ai.*

New storage methods: `listAllClients()` (with counts), `getClientWithAdmins()`,
`createAdminUser()`, `getAdminUserByUsername()`, `resetAdminPassword()`. The
cross-tenant ones bypass `scope()` deliberately, reachable only behind
`requireSuperAdmin`.

---

## Phase 6 — Client UI — mirrors clinic-ai's superadmin panel

- **`use-auth.ts`:** `AuthUser` gains `name`, `role` ("superadmin"|"factory"),
  `clientId`, `actingClientId`; expose `isSuperAdmin`, `isImpersonating`.
- **`login.tsx`:** redirect by role — `superadmin → /superadmin`,
  `factory → /admin`.
- **New `superadmin-layout.tsx`** (port clinic-ai's: simple header, logo, user,
  logout, no sidebar — distinct chrome from the factory `/admin`).
- **`/superadmin` (clients list page):** table of factories (name, slug, mode,
  leads, active) + "Create factory" dialog (name, slugBase, mode, owner,
  adminUsername, adminPassword → on success shows a copyable credentials card).
- **`/superadmin/clients/:id` (detail page):** factory info, suspend/reactivate,
  admins list with per-admin "Reset password", "Add admin", and a prominent
  **"Manage this factory's panel"** button → calls `impersonate/:id` then
  navigates to `/admin`.
- **Impersonation banner:** a persistent bar across all `/admin` pages when
  `actingClientId` is set: "Managing <Factory> as super-admin — Exit" → calls
  `impersonate/stop`, returns to `/superadmin`.
- **Route guards (port clinic-ai's `App.tsx` logic):**
  - `/superadmin/*` requires `role==="superadmin"`, else redirect `/`.
  - `/admin/*`: factory admins as today; a superadmin may enter **only while
    impersonating** (else redirect to `/superadmin`).
- **No client-sent acting header needed** — impersonation lives on the server
  session, so `apiRequest` is unchanged. (Simpler + safer than the earlier
  header idea.)

---

## What we are NOT doing (explicit scope cuts)

- No factory self-serve signup, email verification, or billing.
- No granular permissions within a factory (one "factory" role; multiple admins
  per factory allowed, all equal — matches clinic-ai).
- No password-reset *links* — passwords handed off out-of-band (clinic-ai model).
- No per-factory custom domains (slug-based routing only).
- No "doctor"-style third role.

---

## Build order & rough effort

1. Phase 1 schema + bootstrap (incl. `superadmin_actions` audit table) (≈2.5h)
2. Phase 2 auth rework (≈3h — the fiddly part; sessions + tests)
3. Phase 3 admin route tenant resolution + impersonation resolver + leads audit (≈3h)
4. Phase 4 slug-aware web chat (≈1.5h)
   4b. Suspension kill-switch at chat + whatsapp entrypoints (≈1h)
5. Phase 5 superadmin API (list/create/suspend/admins/reset/impersonate) (≈2.5h)
6. Phase 6 client UI: superadmin panel + impersonation banner (≈4h)

Total ≈ 2–2.5 days. Each phase is independently typecheckable; existing tests
(`admin.test.ts`, `chat.test.ts`, `whatsapp.test.ts`) need updating as the
auth/session shape changes — budget for that in Phase 2/3.

## Risks / things to confirm at review
- **Existing demo login must keep working** through the migration — bootstrap a
  `role="factory"` user bound to the demo client from current env creds. Verify
  before deploy.
- **Sessions in Postgres** (`connect-pg-simple`) store serialized user objects —
  changing the shape invalidates live sessions (everyone re-logs-in once). Fine.
- **`ENCRYPTION_KEY` unchanged** — `admin_users` stores only a bcrypt hash, no PII.
- **`actingClientId` only honored for `role="superadmin"`** — factory admins are
  always locked to `session.user.clientId`. Enforce in `effectiveClientId()`.
- **Impersonation is the deliberate divergence from clinic-ai** — the PII
  boundary (option A vs B) must be decided before Phase 3, since it changes the
  Leads endpoint guard.
