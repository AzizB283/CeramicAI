# Wire CeramicBot to WhatsApp Business (Meta Cloud API)

One-time setup, ~30 min if your Meta WhatsApp Business app is already created.
This connects a real WhatsApp number so buyers can message your number and
talk to the bot (instead of just the web widget).

> **Prerequisites you must already have:**
> - A Meta Developer account
> - A WhatsApp Business app with a phone number provisioned
> - The CeramicBot service deployed on Render (or any HTTPS host)
> - Admin login for CeramicBot

If you don't have the Meta side ready yet, set that up first — Meta's
documentation is the authoritative source: https://developers.facebook.com/docs/whatsapp/cloud-api/get-started

---

## 1. Gather the four values from Meta

Open your app in the Meta Developer dashboard → **WhatsApp** → **API setup**:

| Value                   | Where to find it                                                                 |
| ----------------------- | -------------------------------------------------------------------------------- |
| **Phone Number ID**     | Under "From" — the long number (e.g. `109876543210987`). NOT the phone number itself. |
| **Permanent Access Token** | Create a System User (Business Settings → System Users), give it the WhatsApp app, generate a token with `whatsapp_business_messaging` + `whatsapp_business_management` scopes. **Do NOT use the 24-hour temporary token** — it'll silently expire and your bot will stop replying. |
| **App Secret**          | App Settings → Basic → App Secret (click "Show")                                 |
| **Verify Token**        | You make this one up. Any random string. Used so Meta and your server agree they're talking to each other. E.g. `openssl rand -hex 16` |

Keep these four values handy. They never leave the Meta dashboard except into CeramicBot — don't paste them anywhere else.

---

## 2. Paste them into CeramicBot

Open your CeramicBot admin: `https://your-app.onrender.com/admin/integrations`

Fill in the form — order matters:

1. **Verify Token** — paste your random string
2. **Phone Number ID** — from Meta
3. **Access Token** — paste the permanent token (it's stored encrypted)
4. **App Secret** — paste the app secret (also encrypted)
5. Click **Save WhatsApp Config**
6. Click **Test Config** — should say "WhatsApp config looks good"

Copy the **Webhook URL** shown at the top (e.g. `https://your-app.onrender.com/api/whatsapp/demo`). You'll paste this back into Meta next.

---

## 3. Configure the webhook on Meta's side

Back in the Meta Developer dashboard → **WhatsApp** → **Configuration**:

1. Click **Edit** next to "Callback URL"
2. **Callback URL:** paste the Webhook URL from CeramicBot
3. **Verify token:** paste the same random string you used in step 2 above
4. Click **Verify and save**

Meta calls your webhook with `?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`. CeramicBot checks the verify token, and if it matches, echoes the challenge back. Meta accepts and saves.

If this step fails:
- Double-check the Verify Token matches *exactly* in both places (no leading/trailing spaces)
- Make sure your Render service is up and reachable at the URL
- Check the Render Logs tab — the server logs `unknown client` if the slug doesn't match

---

## 4. Subscribe to the `messages` event

Still in **WhatsApp → Configuration**:

1. Scroll to **Webhook fields**
2. Click **Manage**
3. Toggle on **messages**
4. Save

This is what tells Meta to forward incoming WhatsApp messages to your webhook. Without this, the GET verify passes but no messages ever arrive.

---

## 5. Test end-to-end

1. From any phone, send a WhatsApp message to the number you configured (e.g. "hi")
2. You should get the bot's welcome reply within a few seconds
3. Tap a chip ("Retailer / Tile Shop Owner"), keep walking the flow
4. When you finish (catalog + name + city), the lead should appear in `/admin/leads` with `channel: "whatsapp"` and the buyer's phone captured automatically

If nothing happens:
- **Render Logs tab** is your friend. Look for `[WhatsApp]` entries.
- `invalid signature` means the App Secret in CeramicBot doesn't match Meta's — re-save it.
- `unknown client` means the slug in your webhook URL doesn't match any `ceramic_clients.slug`. For the demo it should be `demo`.
- No logs at all means Meta isn't reaching your server — usually the webhook URL or subscription is wrong.

---

## Quirks to know

- **Render's free tier sleeps after 15 min idle.** First WhatsApp message after sleep takes 30-60 sec to wake the server, so Meta may retry the delivery and your buyer might see a delay. Upgrade to Starter ($7/mo) for always-on once you're showing live demos.
- **In-memory sessions.** Each buyer's mid-flow state lives in the server's memory. When Render restarts (during deploy or after sleep), in-progress conversations reset to the welcome step. Acceptable for the demo; production would move sessions to Postgres.
- **WhatsApp button caps.** Meta limits interactive replies to **3 buttons** or **10 list rows**. The bot's UI gracefully picks the right type based on chip count.
- **24-hour window.** Meta lets you reply freely within 24 hours of the buyer's last message. After that, you'd need a "template message" (pre-approved by Meta). Day 2/5/10 follow-ups will need templates; that's a later slice.
- **No price quoting in copy.** The bot is configured to never quote prices, lead times, or MOQs — only to capture the lead and tell the buyer "our team will share pricing". Per spec §7.

---

## Multi-tenant note

CeramicBot's WhatsApp webhook is multi-tenant by design: the URL is `/api/whatsapp/<slug>` where `slug` identifies the factory. The demo client has `slug=demo`. When you onboard a second factory, they get their own slug, their own Meta app (with their own number), and their own webhook URL like `/api/whatsapp/shree-tiles`.

The admin UI today only edits the demo client's WhatsApp config (single-tenant for the demo). Adding a "switch active factory" picker is a small slice for when the second client signs.
