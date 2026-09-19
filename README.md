# Waifu Market — Telegram Mini App

A card-grid marketplace UI for your bot's characters: image, name, series,
rarity, seller, price in VɎ, and a Buy button with a confirm step. Built
with React + Vite + `@tma.js/sdk-react`.

## How it's wired to the bot

The bot now runs a small HTTP API (`api_server.py`) inside the same
process as the bot itself, started as a background thread from
`bot.py`'s `main()`. It shares the exact same SQLite database - no
second service, no shared volume, nothing extra to keep in sync.

- **`/sell [ID] [price]`** in the bot lists one of a player's cards.
  It shows up in `GET /api/market/listings` immediately.
- **`/cancelsell [listing ID]`** (or the button under the `/sell`
  confirmation) pulls a listing back.
- Buying in the Mini App calls `POST /api/market/buy`, which moves VɎ
  buyer → seller and the card seller → buyer in one transaction.
- Every authenticated call is verified against Telegram's signed
  `initData` (see `api_server.py`'s `verify_init_data`) - the API
  checks the request is really from the Telegram user it claims to be,
  using your bot token. Nothing trusts a user id sent from the browser.
- Character photos are proxied through `GET /api/market/image/{file_id}`
  so the browser can display them without ever seeing your bot token.

## Local development

By default (`VITE_API_BASE_URL` unset) the app runs against the mock
catalog in `src/data/characters.js` - useful for iterating on layout
without a live backend:

```bash
cd waifu-market
npm install
npm run dev -- --host
```

Once the bot + API are deployed, point the Mini App at the real thing:

```bash
cp .env.example .env
# edit .env: VITE_API_BASE_URL=https://<your-railway-domain>
npm run dev -- --host      # or npm run build for production
```

## Deploying for real

**1. Give the bot's Railway service a public domain.**
The API server binds to `$PORT` (Railway sets this automatically) on
`0.0.0.0`. In Railway: your bot service → **Settings** → **Networking**
→ **Generate Domain**. You'll get something like
`https://waifu-bot-production.up.railway.app` - that's your
`VITE_API_BASE_URL`.

**2. Add the new Python dependencies** to whatever `requirements.txt`
the bot's Railway service installs from:
```
fastapi
uvicorn
```
(`httpx` and `pydantic` come along as dependencies of those / already
present via `python-telegram-bot`.)

**3. Build and deploy the Mini App itself** (the React frontend) to
Vercel/Netlify as before - see the build command (`npm run build`) and
output dir (`dist`) notes below. Set the `VITE_API_BASE_URL` environment
variable in that platform's dashboard to your Railway domain from step 1.

**4. Lock down CORS (optional but recommended).** Once the Mini App has
its permanent URL, set `MINI_APP_URL` in the bot's Railway environment
variables to that exact URL, so the API only accepts requests from your
Mini App instead of any website.

**5. Point the bot's menu button at the Mini App**, same as before -
BotFather → your bot → Bot Settings → Menu Button → paste the Mini
App's URL.

## Build

```bash
npm run build
```

Output goes to `dist/` - deploy that folder to Vercel/Netlify (build
command `npm run build`, output dir `dist`), or as a `serve dist` static
service on Railway.

## Project layout

```
waifu-market/
├─ index.html
├─ .env.example
├─ src/
│  ├─ main.jsx              # SDK init()
│  ├─ App.jsx                # state: catalog, balance, filters, purchase flow
│  ├─ hooks/useTelegram.js   # user info, haptics, theme
│  ├─ api/marketApi.js       # real API calls, falls back to mock data
│  ├─ data/characters.js     # mock catalog (dev-only fallback)
│  ├─ data/rarities.js       # rarity name -> color mapping
│  └─ components/            # Header, FilterBar, CharacterCard, CardGrid,
│                             # BuyConfirmSheet, Toast
```

## Still to do together

- No "my listings" view in the Mini App yet (cancel currently only works
  from the bot, via `/cancelsell` or the button under `/sell`).
- No pagination - `get_active_listings()` returns everything active,
  fine for a small market, worth revisiting if it grows large.
- CORS is wide open (`*`) until `MINI_APP_URL` is set - fine for testing,
  tighten it before sharing the bot widely.
