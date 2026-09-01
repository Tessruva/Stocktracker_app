# Watchlist — stock tracker with real background alerts + AI analysis

Two parts now:
- **The app** (this folder's root files) — installs to your Android home screen.
- **The server** (`/server`) — a small free backend that makes real background
  alerts and the AI analysis feature possible.

Why a server is required for these two features specifically: a phone browser
can't reliably wake itself up to check prices while your screen is off and the
app is closed — only a real Web Push message from a server can do that. And
the AI analysis needs an Anthropic API key, which should never sit in a phone
app where anyone could extract it — it has to live server-side.

Total cost: **$0/month** on the tiers used below, no credit card required for
any of them.

## The stack (all free tier)

| Piece | What it's for | Where |
|---|---|---|
| Finnhub | Live stock quotes | https://finnhub.io/register |
| Anthropic API | Powers the "Analyze" feature | https://console.anthropic.com |
| Upstash Redis | Stores your watchlist + push subscriptions | https://console.upstash.com |
| Render | Hosts the small server, 24/7, free | https://render.com |
| cron-job.org | Pings the server every few minutes so it checks your stocks even while you're not using the app | https://cron-job.org |

## Setup

### 1. Collect your API keys
- **Finnhub**: sign up, copy the API key from your dashboard.
- **Anthropic**: create a key at console.anthropic.com → API Keys.
- **VAPID keys** (for push notifications): on your own computer, run:
  ```
  npx web-push generate-vapid-keys
  ```
  Copy the public and private key it prints out.

### 2. Create the Upstash database
1. Sign up at console.upstash.com, create a **free Redis** database.
2. On the database's page, copy the **REST API** URL and Token (not the
   regular Redis connection string — the REST ones).

### 3. Deploy the server to Render
1. Push the `server/` folder to a new GitHub repo (or push this whole
   project and point Render at the `server` subfolder).
2. On render.com: **New → Web Service**, connect the repo.
   - Root directory: `server`
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: **Free**
3. Under **Environment**, add these variables (see `server/.env.example`
   for the full list):
   - `ACCESS_TOKEN` — make up any long random string, e.g. from
     `openssl rand -hex 24`
   - `CRON_SECRET` — a *different* random string
   - `FINNHUB_KEY`
   - `ANTHROPIC_API_KEY`
   - `ANTHROPIC_MODEL` — `claude-sonnet-5` (or another current model string)
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (any
     `mailto:you@example.com`)
4. Deploy. Render gives you a URL like `https://watchlist-server.onrender.com`.
   Visit `https://<that-url>/health` — you should see `{"ok":true}`.

### 4. Schedule the background check
1. Sign up free at cron-job.org.
2. Create a job that calls, every 5 minutes:
   `https://<your-render-url>/api/check?secret=<your CRON_SECRET>`
3. Save. That's your background alerting loop — it runs whether or not
   your phone is anywhere near the app.

   Note: Render's free tier spins a service down after ~15 minutes of no
   traffic and takes a few seconds to wake back up on the next request.
   Your 5-minute cron ping is frequent enough to keep it awake in practice;
   worst case, one check is delayed a few seconds while it wakes up.

### 5. Host and install the app itself
Same as before — GitHub Pages or Netlify Drop for the root files
(`index.html`, `style.css`, `app.js`, `db.js`, `sw.js`, `manifest.json`,
`icons/`). Don't upload the `server/` folder here — that goes to Render, not
your static host.

### 6. Connect the app to your server
1. Open the hosted app on your phone, tap the settings gear.
2. Enter your Render URL and the `ACCESS_TOKEN` you set in step 3.
3. Save — this also asks for notification permission and registers your
   phone for push. You should see "Background alerts are on for this
   device."
4. Add your stocks as before. Every add/edit/remove syncs to the server
   automatically, so the background check always has your latest levels.
5. Tap the browser menu → **Add to Home screen** to install it.

## Using the AI analysis feature

Type a ticker into "Quick analysis" and tap **Analyze**. It fetches live
data from Finnhub (price, day range, 52-week range, beta, P/E, dividend
yield) and asks Claude to turn that into:

- **Volatility** — a Low/Medium/High rating plus the specific number behind
  it (e.g. beta, or 52-week range as a % of price)
- **Entry zone** — a suggested low–high buy range
- **Exit target** — a suggested take-profit level
- **Stop-loss** — a suggested downside cut-off
- **Verdict** — Buy / Hold / Avoid, with a short rationale that names at
  least one risk

Tap **"Use these levels to add to watchlist"** to pre-fill the add-stock
form with the AI's numbers — you still review and confirm before it's
added.

**This is a starting point for your own research, not financial advice.**
It reasons from a handful of current data points, not deep fundamental or
technical analysis — treat the verdict as one input alongside your own
judgment, not a signal to act on directly.

## What changed from the first version

- Notifications now use real **Web Push** sent from your server — these
  wake the OS to show a notification even with the app fully closed and the
  phone asleep, unlike the old best-effort "Periodic Background Sync" which
  browsers only honor occasionally.
- The Finnhub key now lives on the server, not in the app — a bit more
  secure, and it also means the server can check your stocks on its own
  schedule independent of whether you have the app open.
- New: AI-assisted quick analysis per stock, described above.

## Files

```
index.html, style.css, app.js, db.js, sw.js, manifest.json, icons/   — the app
server/index.js       — Express server: quotes, watchlist sync, push, analysis
server/package.json   — dependencies (express, web-push, cors, dotenv)
server/.env.example   — every environment variable it needs, explained
```
