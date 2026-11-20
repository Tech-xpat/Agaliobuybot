# Deploying AGALIO BuyBot on Railway (beginner guide)

Everything runs on Railway: the bot, PostgreSQL and Redis. `railway.json` in the repo already tells Railway to build the Dockerfile, run migrations before each deploy, and health-check `/healthz`.

## 0. Collect these first
- Bot token from @BotFather (privacy mode disabled, see README section 2)
- Your numeric Telegram user ID, and the group's numeric chat ID (README 2.4)
- A BSC RPC URL (a free public one works for testing; use a private one for launch)

## 1. Put the code on GitHub
1. Create a **private** repository on github.com.
2. Unzip `agalio-buybot.zip`, then in that folder: `git init && git add . && git commit -m "init"`, add the remote GitHub shows you, `git push -u origin main`.
3. Check that `.env` is NOT in the repo (it is git-ignored).

## 2. Create the project
1. railway.com → sign up (GitHub login) → **New Project** → **Deploy from GitHub repo** → pick your repo.
2. Railway creates one service and starts building. It will fail or crash until variables exist. That is expected.

## 3. Add the databases
In the project canvas: **+ New** → **Database** → **Add PostgreSQL**. Repeat for **Add Redis**. You now have three boxes: your bot, Postgres, Redis.

## 4. Set the bot's variables
Click the bot service → **Variables** → **Raw Editor** and paste (fill the blanks; keep the `${{ }}` parts exactly, and make sure the names in them match your database service names):

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_GROUP_ID=
TELEGRAM_ADMIN_IDS=
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
BSC_RPC_URL=
BSC_FALLBACK_RPC_URL=
BOT_MODE=polling
NODE_ENV=production
```
Optional: `AGALIO_TOKEN_NAME`, `AGALIO_TOKEN_SYMBOL`, `ANNOUNCEMENT_COOLDOWN_SECONDS`. Leave `AGALIO_CONTRACT_ADDRESS` empty until the contract exists; set it later with `/setcontract`.

## 5. Deploy
Click **Deploy** (or push a commit). Open **Deployments → View logs**. Success looks like:
- pre-deploy: Prisma applies the migration
- `HTTP server listening`, `Bot identity verified`, `Long polling started`

## 6. Test
1. In Telegram, open a private chat with your bot → `/start`, then `/status`. You should see Database ✅, Redis ✅, RPC ✅.
2. `/setcontract 0x...` (or, before deployment of the token, test with any real deployed BEP-20 using `/setcontract <address> force`), `/test`, then post the contract in the group.
3. Set content: `/setdescription`, `/setlogo`, `/setlaunchstatus`, etc. (README section 6).

## 7. Optional: switch to webhook mode
Polling is fine. During a redeploy Railway may run the old and new copy together for a moment, which can log a harmless `409 Conflict` for a few seconds. To avoid it:
1. Bot service → **Settings → Networking → Generate Domain**.
2. Variables: `BOT_MODE=webhook`, `WEBHOOK_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}`, `WEBHOOK_SECRET=<random 32+ chars, letters/digits/_/- only>`.
3. Redeploy and watch for `Webhook registered`.

## Troubleshooting
- **Build fails**: open the build log; make sure the repo root contains `Dockerfile`, `package-lock.json`, `prisma/`.
- **`Invalid environment configuration`**: the log lists exactly which variable is wrong.
- **Prisma can't connect**: check `DATABASE_URL=${{Postgres.DATABASE_URL}}` (service name must match the box name).
- **Redis connection errors (`ENOTFOUND` / `EAI_AGAIN`) on `redis.railway.internal`**: append `?family=0` to the Redis URL: `REDIS_URL=${{Redis.REDIS_URL}}?family=0`. The bot keeps working on an in-memory fallback meanwhile.
- **Deploy marked unhealthy**: the health check needs the database to answer; check Postgres is running.
- **Bot silent in the group**: privacy mode, group ID, or contract not set (`/status`).
- **Costs**: Railway bills by usage; check the plan and usage page.
