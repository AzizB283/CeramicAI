# CeramicBot

AI WhatsApp & web chat bot for **ceramic factories & exporters** in Morbi — a
product by [Aurex Auto](https://aurexauto.com). Qualifies buyers, shares catalogs,
captures leads, and alerts the owner instantly.

Built on the same engine as the sibling **clinic-connect** project, re-purposed
from appointment booking to B2B buyer qualification.

## Quick start

```bash
npm install
npm run dev        # → http://localhost:5173
```

This is **Phase 1**: a frontend-only chat demo (no backend, no WhatsApp, no DB)
used to win the first clients. Two modes — **Factory** (domestic) and **Export**
(international, with sample + priority-distributor flows).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the demo locally |
| `npm run build` | Typecheck + production build → `client/dist/` |
| `npm run preview` | Serve the production build |
| `npm run check` | TypeScript typecheck |

## Layout

- `client/` — Phase 1 web demo (React + Vite + Tailwind)
- `shared/` — conversation flows + types (used by both phases)
- `server/` — Phase 2 backend (empty stub; forks clinic-connect)

See **`CLAUDE.md`** for the full engineering guide, conventions, and the Phase 2
roadmap. Product spec: `CeramicBot_Build_Spec_AurexAuto.docx`.
