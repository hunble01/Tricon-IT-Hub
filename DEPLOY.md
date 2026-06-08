# Deploying Tricon IT Hub to a VPS

Production deploy: one VPS, one `docker compose` command. The stack (Postgres +
Redis + API + Web + Caddy) is fully containerized and isolated on its own Docker
network, so it **coexists with other apps** on the same host.

Prereqs: a Linux VPS with **Docker + Docker Compose v2**, SSH access, and (ideally)
a domain. ~1.5 GB RAM free is comfortable.

---

## 0. Recon — what's already on the box (run on the VPS)

Before deploying, check for the one real conflict (ports 80/443) and see the
existing Docker footprint:

```bash
# What's listening on the public web ports?
sudo ss -tlnp | grep -E ':80 |:443 ' || echo "80/443 are free"
# Existing containers / networks (make sure names don't clash)
docker ps -a
docker network ls
free -h            # confirm spare memory
```

- **80/443 free** → use the bundled Caddy (default). Continue normally.
- **Something already there** (another app's Nginx/Caddy) → skip to
  *"Behind an existing reverse proxy"* below.

---

## 1. Get the code on the server

```bash
cd ~                       # or wherever you keep apps (separate folder is fine)
git clone <your-repo-url> tricon-it-hub
cd tricon-it-hub
```

(No git remote yet? `scp`/`rsync` the project folder up instead.)

## 2. Configure secrets

```bash
cp .env.prod.example .env.prod
nano .env.prod
```

Fill in **every `CHANGE_ME`**. Critical:

- `PUBLIC_ORIGIN` / `SITE_ADDRESS` — your domain (`https://hub.example.com` /
  `hub.example.com`) or, with no domain, `http://YOUR_IP` / `:80`.
- `POSTGRES_PASSWORD` + `DATABASE_URL` — same strong password in both.
- `JWT_SECRET` — `openssl rand -base64 48`.
- `OPENAI_API_KEY` + `ANTHROPIC_API_KEY` — **use freshly rotated keys**, not any
  that were ever pasted into a chat.
- `CORS_ORIGIN` — your public origin.
- Leave `AUTH_DISABLED=false` and `NEXT_PUBLIC_AUTH_DISABLED=false` (login is ON
  in production).

## 3. (Domain only) Point DNS at the server

Create an **A record**: `hub.example.com → YOUR_SERVER_IP`. Wait for it to
resolve (`dig +short hub.example.com`). Caddy needs this to issue HTTPS.

## 4. Launch

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

First run builds the images (a few minutes), applies DB migrations
(`tricon-migrate` runs once), then starts everything. Check status:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
```

## 5. Seed the first admin (first deploy only)

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml \
  run --rm -w /app migrate pnpm --filter @tricon/db seed
```

Then open your site and **log in** with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
— and change that password immediately. (To also import the onboarding workbook,
swap `seed` for `import:onboarding` and make sure the seed file is present.)

You're live. Visit `https://hub.example.com` (or `http://YOUR_IP`) from any
device — your computer no longer needs to be on.

---

## Behind an existing reverse proxy

If another app already owns 80/443, don't run the bundled Caddy. Instead expose
the web/api to localhost only and route from your existing proxy:

1. In `docker-compose.prod.yml`, **delete the `caddy:` service**, and add
   loopback-only port mappings so nothing is exposed publicly:
   ```yaml
   web:
     ports: ["127.0.0.1:8082:3000"]
   api:
     ports: ["127.0.0.1:8083:4000"]
   ```
2. Point your existing proxy at them. Example **Nginx** server block:
   ```nginx
   server {
     server_name hub.example.com;
     location /api/ { proxy_pass http://127.0.0.1:8083; }
     location /    { proxy_pass http://127.0.0.1:8082; }
   }
   ```
   (Then `certbot --nginx -d hub.example.com` for HTTPS.)
   Existing **Caddy**? Add a site block: `reverse_proxy /api/* 127.0.0.1:8083`
   and `reverse_proxy 127.0.0.1:8082`.
3. Set `PUBLIC_ORIGIN`/`CORS_ORIGIN` to the same public URL your proxy serves.

---

## Redeploying after code changes

```bash
git pull
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

New migrations apply automatically (the `migrate` one-shot re-runs on each
`up`). Data persists in the `tricon_pg_data` volume.

## Backups (recommended)

```bash
docker exec tricon-postgres pg_dump -U tricon tricon_it_hub | gzip > backup-$(date +%F).sql.gz
```

## Troubleshooting

- **`web` build fails on env** — `PUBLIC_ORIGIN` must be set; it's baked into the
  client bundle at build time.
- **HTTPS not issuing** — DNS must resolve to the server and ports 80+443 must be
  open in the VPS firewall *and* the provider's security group.
- **API unhealthy** — `docker compose -f docker-compose.prod.yml logs api`; usually
  a bad `DATABASE_URL` (must use host `postgres`) or a missing key.
- **Migrations** — re-run manually:
  `docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm -w /app migrate pnpm --filter @tricon/db exec prisma migrate deploy`
