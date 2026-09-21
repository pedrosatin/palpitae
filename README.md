# Palpitae

A prediction game for football tournaments worldwide.

Users sign in with Google and submit predictions for a competition's matches. The
system scores each prediction against the real results and ranks users on a
leaderboard. Any authenticated user can create a prediction group and invite
friends to compete against each other.

## Stack

The API runs on [Cloudflare Workers](https://developers.cloudflare.com/workers/)
with [Hono](https://hono.dev/), backed by [D1](https://developers.cloudflare.com/d1/)
(SQLite) and scheduled crons that handle fixture discovery, live-match polling,
scoring, and round reminder emails. The web app is [React](https://react.dev/)
and [React Router](https://reactrouter.com/) on [Vite](https://vitejs.dev/),
deployed to Cloudflare Pages with server-rendered prerendering.

Auth is Google OAuth 2.0 (PKCE) with HMAC-signed JWT session cookies.
Observability is split between server-side events sent to Cloudflare Analytics
Engine (`logEvent`) and client-side click tracking through GA4 (`trackEvent`).

Architecture decisions are recorded as ADRs in
[`docs/architecture/decisions.md`](docs/architecture/decisions.md).

## Repository layout

```
api/    Cloudflare Worker (Hono): REST API, D1 migrations, cron jobs
web/    React app (Vite): UI, Cloudflare Pages functions
docs/   Architecture decisions, schema, observability and analytics conventions
```

## API setup

### Prerequisites

- [Node.js](https://nodejs.org/) 24+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/): `npm install -g wrangler`
- A Cloudflare account (`wrangler login`)

### First-time setup

```bash
cd api
npm install

# 1. Create the D1 database and copy the database_id into wrangler.toml
wrangler d1 create palpitae

# 2. Apply the schema migration locally
wrangler d1 migrations apply palpitae --local

# 3. Set up local secrets (Wrangler uses .dev.vars instead of .env — see note below)
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your Google OAuth credentials and a JWT secret
```

> **Why `.dev.vars` and not `.env`?**
> Cloudflare Workers have no `process.env`. Environment values are injected as *bindings* (accessible via `env.JWT_SECRET` in handler code). Wrangler reads `.dev.vars` locally to simulate those bindings during `wrangler dev`. Production secrets are set via `wrangler secret put <KEY>` and never stored in files.

### Running

```bash
# Start local dev server (http://localhost:8787)
wrangler dev

# Run tests
npm test

# Type-check
npm run typecheck
```

### Deploying

```bash
# Set production secrets (one-time, stored encrypted in Cloudflare)
wrangler secret put JWT_SECRET
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET

# Apply migration to production D1
wrangler d1 migrations apply palpitae --remote

# Deploy the Worker
npm run deploy
```

## Web setup

### Prerequisites

- [Node.js](https://nodejs.org/) 24+

### First-time setup

```bash
cd web
npm install
```

### Running

```bash
# Start local dev server
npm run dev

# Run tests
npm test

# Type-check
npm run type-check
```

### Building and deploying

```bash
# Builds the client bundle, an SSR bundle for prerendering, and prerenders
# static routes into dist/
npm run build
```

The `dist/` output, together with the Pages functions under `web/functions/`,
is deployed to Cloudflare Pages via Wrangler.

## License

MIT, see [LICENSE](LICENSE).
