# Palpitae

Sistema de palpites para campeonatos de futebol no mundo todo.

Os usuários podem fazer login via google ou facebook, e fazer seus palpites para os jogos do campeonato. O sistema irá calcular a pontuação dos usuários com base nos resultados dos jogos, e exibir um ranking dos melhores palpites.

Todo usuário poderá comprar um plano para ter acesso ao cadastro de grupos de palpites, onde os usuários poderão criar grupos para competir entre si, e convidar seus amigos para participar.

---

## API — Setup local

The API runs on [Cloudflare Workers](https://developers.cloudflare.com/workers/) with [Hono](https://hono.dev/) and [D1](https://developers.cloudflare.com/d1/) (SQLite).

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
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
