# Deploy CeramicBot to Render

One-time, ~30 min. After this, every `git push` to `main` redeploys automatically.

## 1. Generate the secrets you'll paste into Render

Run locally and copy each value somewhere safe:

```bash
openssl rand -hex 32          # → ENCRYPTION_KEY (64 hex chars)
openssl rand -base64 64       # → SESSION_SECRET
```

Pick an admin password too. You'll need:

| Var               | Value                                                       |
| ----------------- | ----------------------------------------------------------- |
| `ENCRYPTION_KEY`  | the openssl rand -hex 32 output                             |
| `SESSION_SECRET`  | the openssl rand -base64 64 output                          |
| `ADMIN_PASSWORD`  | whatever you'll use to log in (change from `admin123`)      |
| `OPENAI_API_KEY`  | optional — without it, /ask returns a polite fallback       |

> `ENCRYPTION_KEY` is **load-bearing** — if you lose it after capturing real leads, the encrypted buyer names/phones become unrecoverable. Store it in a password manager.

## 2. Push the latest code to GitHub

Render reads `render.yaml` from the repo, so the branch you point it at must contain that file.

```bash
git push origin main
```

## 3. Connect the repo as a Render Blueprint

1. Render dashboard → **New +** → **Blueprint**
2. Connect your GitHub repo if you haven't, then pick **CeramicBot**
3. Render reads `render.yaml` and proposes:
   - Web Service: `ceramicbot` (free tier, Singapore region)
   - Postgres: `ceramicbot-db` (free tier, Postgres 16)
4. Click **Apply** — Render starts the first build.

The build takes ~3–5 min (npm install + Vite + esbuild). The first boot of the web service runs migrations against the empty database (`RUN_MIGRATIONS=true` is wired in `render.yaml`) and seeds the demo client row.

## 4. Set the secret env vars

Render only auto-creates the ones marked `sync: true` in the Blueprint. The four secrets you generated above need to be set manually:

1. In the Render dashboard, open the **ceramicbot** web service
2. **Environment** tab → **Add Environment Variable** for each of:
   - `ENCRYPTION_KEY`
   - `SESSION_SECRET`
   - `ADMIN_PASSWORD`
   - `OPENAI_API_KEY` *(optional)*
3. Save. Render auto-redeploys with the new env.

## 5. Verify

Your service URL is shown in the dashboard — something like `https://ceramicbot.onrender.com`.

- `https://ceramicbot.onrender.com/` → the public demo chat
- `https://ceramicbot.onrender.com/admin` → admin (log in with `admin` + your `ADMIN_PASSWORD`)
- `https://ceramicbot.onrender.com/widget.js` → the embed script

Walk a chat flow end-to-end → confirm the lead lands in the admin's Leads table.

## Quirks to know

- **Free tier sleeps after 15 minutes idle.** First request after sleep takes ~30–60 sec to wake. Upgrade to Starter ($7/mo) for always-on if you're showing live demos to prospects.
- **Database free tier expires after 30 days.** Upgrade when the first paying client lands, otherwise the DB gets deleted.
- **Region is Singapore.** Closest Render region to Morbi. Change in `render.yaml` if you want a different one.
- **HTTPS is automatic.** Render terminates TLS; the session cookie is correctly issued because we set `trust proxy: 1` and `cookie.secure: true` in production.

## Custom domain (later)

When you're ready to point `ceramicbot.aurexauto.com` (or wherever) at it:

1. In Render: web service → **Settings** → **Custom Domains** → add the domain
2. In your DNS: add a CNAME pointing at `ceramicbot.onrender.com`
3. Render handles cert provisioning (Let's Encrypt) automatically.

## Rolling out a new version

After deploy, any push to the branch named in `render.yaml` (`main` by default) triggers a fresh build + deploy. If a migration is needed, drop a new SQL file in `migrations/` (via `npm run db:generate`); the server will apply it on the next boot since `RUN_MIGRATIONS=true` stays on.

## If something goes wrong

- **Build fails:** Render shows the build log. Most common: missing env var. Check that the secrets in step 4 are set.
- **Server crashes on boot:** open the **Logs** tab. The actual error is usually in the last 10 lines.
- **"Database does not exist":** Render's Postgres takes a minute to provision; redeploy the web service once the DB is `Available`.
- **Cookie not set / admin can't log in:** make sure you're visiting `https://` not `http://` — `cookie.secure: true` in prod drops insecure cookies.
