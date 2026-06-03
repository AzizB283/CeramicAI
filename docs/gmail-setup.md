# Gmail Inbox Ingest — Google Cloud Setup (one-time)

CeramicBot reads an exporter's Gmail inbox to turn buyer inquiries into leads +
draft replies. This is a one-time setup per Google Cloud project. It reuses the
same OAuth approach as the clinic-connect Calendar integration — if you already
have a project, just enable the Gmail API and add the scopes.

## 1. Enable the Gmail API

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Library**.
2. Search for **Gmail API** and click **Enable** (same project you use for any other Google integration).

## 2. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen.**
2. User type **External** (unless you have a Workspace org and only internal users connect).
3. Fill in the app name, support email, and developer contact.
4. **Scopes** → add these three:
   - `https://www.googleapis.com/auth/gmail.readonly` — read the inbox
   - `https://www.googleapis.com/auth/gmail.send` — send replies (used in Slice 2)
   - `https://www.googleapis.com/auth/gmail.modify` — mark read / label
5. **Test users:** while the app is in "Testing" (unverified), add each exporter's
   Gmail address as a Test User. Only test users can complete the OAuth flow until
   the app is verified by Google. (Verification is only needed for wide public use.)

## 3. Create an OAuth 2.0 Client ID

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID.**
2. Application type: **Web application**.
3. **Authorized redirect URIs** — add the callback for each environment:
   - Local dev: `http://localhost:5000/api/admin/email/callback`
   - Production: `https://<your-app>.onrender.com/api/admin/email/callback`
   (Must exactly match `${APP_BASE_URL}/api/admin/email/callback`.)
4. Create it, then copy the **Client ID** and **Client secret**.

## 4. Put the credentials in the app

Add to `.env.local` (dev) or the platform env (Render, prod):

```bash
GOOGLE_CLIENT_ID=<your client id>
GOOGLE_CLIENT_SECRET=<your client secret>
APP_BASE_URL=http://localhost:5000   # or your production URL
```

`APP_BASE_URL` builds the redirect URI, so it must match what you registered in
step 3. If unset it defaults to `http://localhost:5000`.

## 5. Connect a mailbox

1. Start the server (`npm run dev:server`) and log into the admin panel.
2. **Integrations → Connect Gmail** → complete the Google consent screen with the
   exporter's account (must be a Test User while unverified).
3. After redirect you should see **Connected as `<address>` ✓**. The poller then
   sweeps that inbox every 5 minutes; **Check now** triggers it immediately.

## Notes

- No new credentials are needed beyond the Client ID/Secret — the same Google
  Cloud project can also host other Google integrations.
- Tokens are stored AES-GCM encrypted at rest (same `v2:` format as the WhatsApp
  credentials). The refresh token is the durable credential; `googleapis`
  refreshes the access token automatically.
- Slice 1 only reads/ingests + drafts replies. Sending replies via `gmail.send`
  is Slice 2 — but the consent above already requests the send scope, so the
  exporter only authorizes once.
