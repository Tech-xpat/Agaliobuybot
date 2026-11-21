# AGALIO BUYBOT

Telegram launch-announcement bot for **AGALIO NETWORK** (<https://t.me/agalionetwork>) on **BNB Smart Chain (chain ID 56)**.

When a member posts the **official AGALIO contract address** in the configured group, the bot posts a formatted token card with inline buttons (Buy, Live Chart, Copy Contract, Token Details, Community, BscScan, and optional links).

**What it is not:** it never trades, never holds funds, never asks for seed phrases or private keys, never claims a token is audited or safe, and ignores every other contract address posted in the group.

- Stack: Node.js 20+/TypeScript, grammY, ethers v6, PostgreSQL + Prisma 6, Redis + BullMQ, Docker Compose.
- Data provenance is always labelled in the announcement: **on-chain facts** (read from BSC RPC), **third-party market data** (DexScreener), **admin-supplied info**.
- Missing data is shown as `Data currently unavailable`, never as zeros or invented figures.

---

## 1. How it behaves

| Situation | Result |
|---|---|
| Official contract in a message (alone, in text, with emojis, forwarded, edited) | One announcement, as a reply to that message |
| Any other valid contract / invalid address | Ignored |
| Same message again (edit, redelivery, restart) | Ignored (Redis + unique DB constraint) |
| Another match within the cooldown (default 60 s) | Ignored |
| Admin ran `/pause` | Ignored |
| No pair on DexScreener yet | Contract + on-chain facts shown, market fields say unavailable, no BUY button |
| DexScreener or BSC RPC down | Announcement still posts with placeholders (stale market data is flagged) |
| Redis down | Falls back to in-memory dedup/cooldown; logs a warning; bot keeps running |

**Buttons.** Every button needs a working destination, otherwise it is not shown:

- **BUY AGALIO**: only when launch status is `TRADING_LIVE` **and** a valid https buy URL is set. URL may contain `{contract}`.
- **LIVE CHART**: configured chart URL, or the real pair URL DexScreener returned. Hidden if neither exists.
- **COPY CONTRACT**: callback that posts the contract in a `<code>` block (tap to copy). Telegram buttons cannot write to the clipboard, so this is the closest possible behaviour. Rate-limited per chat so it cannot spam the group.
- **TOKEN DETAILS**: callback that posts a detailed card.
- **HOLDERS / COMMUNITY**: only if a community URL is set.
- **BSC SCAN**: always available once a contract is set.
- Optional: Website, X/Twitter, Telegram, Tokenomics, Whitepaper, Security Info (each only when its URL is set). Any button can be switched off with `/buttons`.

**Group replies (no commands needed):**

- `ca` / `wen ca` / `contract address` → replies with **only** the contract address (tap to copy).
- Ask for one thing at a time and the bot answers just that: `price`, `mc` / `market cap`, `fdv`, `liquidity`, `volume`, `holders`, `supply`, `decimals` (also combinable, e.g. `price and mc`), plus the link requests `website`, `twitter`, `whitepaper`, `tokenomics`, `chart`, `how to buy`, `socials`. Only whole-message requests match, so ordinary chat never triggers the bot.
- Pasting the official contract address still posts the full announcement card; `/token` shows the full card on demand.

**Buy alerts:** the bot watches the token's DEX pools (PancakeSwap V2/V3-style `Swap` events, read from BSC logs through your RPC) and posts a card in the group for every buy: amount spent (with USD value), tokens received, buyer wallet, price, market cap, liquidity, and TX / chart / buy buttons (the buy button follows the same `TRADING_LIVE` rule as the announcement). Sells are ignored. Pools come from DexScreener's best pair plus the on-chain PancakeSwap V2 token/WBNB pair. Configure with `BUY_ALERT_ENABLED`, `BUY_ALERT_MIN_USD` (dust filter), `BUY_ALERT_POLL_SECONDS` and `BUY_ALERT_MAX_PER_SCAN` (flood control: the biggest buys get cards, the rest are summarised in one line). `/pause` also pauses buy alerts. On the first run it starts from the current block and never replays history; the last scanned block and de-duplication live in Redis. Use a reliable (ideally paid) `BSC_RPC_URL`: public endpoints limit `eth_getLogs`.

**Launch statuses:** `PRE_LAUNCH`, `CONTRACT_DEPLOYED`, `TRADING_NOT_LIVE`, `TRADING_LIVE`, `PAUSED`, `ANNOUNCEMENT_ONLY`. The bot only says trading is live when an admin sets `TRADING_LIVE`. It cannot detect a launch on its own for that purpose.

---

## 2. Telegram setup (do this first)

### 2.1 Create the bot with BotFather
1. Open <https://t.me/BotFather> → `/newbot` → choose a name (e.g. *AGALIO BuyBot*) and a username ending in `bot`.
2. Copy the token (`123456789:AA…`). **This is a secret.** Put it only in `.env`. If it ever leaks, use `/revoke` in BotFather.
3. Optional polish: `/setdescription`, `/setabouttext`, `/setuserpic` (the group logo works well).

### 2.2 Disable privacy mode (required)
By default bots in groups only see commands. The bot must see ordinary messages to find the contract address.
1. BotFather → `/setprivacy` → select your bot → **Disable**.
2. If the bot is already in the group, **remove it and add it again**; Telegram applies privacy mode when the bot joins.
3. Alternative: making the bot a group admin also lets it see all messages.

### 2.3 Add it to AGALIO NETWORK
1. Add the bot to the group.
2. Permissions: it only needs to **send messages**. Making it an administrator is optional; if you do, grant **nothing else** (no delete, ban, pin, invite, or add-admin rights).
3. If the group restricts members from sending links/media, make sure the bot can still post messages with inline buttons and photos.

### 2.4 Find the numeric IDs you need
- **Your user ID** (for `TELEGRAM_ADMIN_IDS`): message <https://t.me/userinfobot>, or `@RawDataBot`.
- **Group chat ID** (for `TELEGRAM_GROUP_ID`): add `@RawDataBot` temporarily to the group, read the `chat.id` (supergroups look like `-1001234567890`), then remove it. Alternatively forward a group message to `@getidsbot`.

Admins are authorised **by numeric user ID only**, never by username or display name.

---

## 3. Local development

Requirements: Node.js ≥ 20, PostgreSQL 14+, Redis 6+.

```bash
git clone <your repo> agalio-buybot && cd agalio-buybot
cp .env.example .env            # fill in TELEGRAM_*, DATABASE_URL, REDIS_URL, BSC_RPC_URL
npm ci
npx prisma generate
npx prisma migrate deploy       # applies prisma/migrations/*
npm run setup                   # optional: validates env, DB, RPC, Telegram token, privacy mode
npm run dev                     # long polling, auto-reload
```

Quick DB/Redis for development: `docker compose up -d postgres redis` (then use `localhost` URLs in `.env`; the compose file does not publish those ports by default, so add `ports:` entries to the services or run your own instances).

Run in production mode locally: `npm run build && npm start`.

### Test, lint, typecheck
```bash
npm run typecheck
npm run lint
npm test                 # unit tests; integration tests are skipped unless the env vars below are set
```
Integration tests use a **real** PostgreSQL and Redis but mocked Telegram, BSC and DexScreener (no network, no real tokens, no transactions):
```bash
createdb agalio_test && psql agalio_test -f prisma/migrations/20260101000000_init/migration.sql
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/agalio_test \
TEST_REDIS_URL=redis://localhost:6379 \
npm test
```
> The integration suite **truncates all tables** in `TEST_DATABASE_URL`. Never point it at a real database.

---

## 4. Docker Compose deployment (recommended)

The stack: `postgres`, `redis`, a one-shot `migrate` job (`prisma migrate deploy`), and `bot`. Restart policies, health checks and log rotation are configured.

```bash
cp .env.example .env
# edit .env: TELEGRAM_BOT_TOKEN, TELEGRAM_GROUP_ID, TELEGRAM_ADMIN_IDS,
#            POSTGRES_PASSWORD (strong!), BSC_RPC_URL (+ BSC_FALLBACK_RPC_URL)
docker compose build
docker compose up -d
docker compose logs -f bot
```
`DATABASE_URL` and `REDIS_URL` are overridden inside the compose network automatically; you can leave the localhost values in `.env`.

Health: `GET http://127.0.0.1:3000/healthz` returns 200 when the database responds (used by the Docker `HEALTHCHECK`). The port is bound to localhost only.

Logo: put `logo.png` in `assets/` **before building**, or send the logo to the bot with `/setlogo` (stores a Telegram `file_id`, no rebuild needed).

### Polling vs webhook
- **Polling (default, `BOT_MODE=polling`)**: no public URL needed. The bot deletes any previously registered webhook on start.
- **Webhook (`BOT_MODE=webhook`)**: set `WEBHOOK_URL=https://bot.example.com` and `WEBHOOK_SECRET` (`openssl rand -hex 32`). Put a TLS reverse proxy (Caddy/nginx) in front that forwards `POST /telegram/webhook` to `127.0.0.1:3000`. The bot verifies Telegram's secret header and registers the webhook itself. Polling is never started in webhook mode, so the two cannot run together. Run only **one** instance per bot token.

Caddy example:
```
bot.example.com {
    reverse_proxy /telegram/webhook 127.0.0.1:3000
}
```

---

## 5. VPS deployment guide (Ubuntu 22.04/24.04)

```bash
# 1. base hardening
adduser deploy && usermod -aG sudo deploy
# (copy your SSH key to deploy, then disable password and root SSH login in /etc/ssh/sshd_config)
sudo ufw allow OpenSSH && sudo ufw enable        # polling needs NO inbound ports
# webhook mode also: sudo ufw allow 80,443/tcp

# 2. Docker
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker deploy
# log out/in

# 3. app
git clone <your repo> ~/agalio-buybot && cd ~/agalio-buybot
cp .env.example .env && chmod 600 .env && nano .env
docker compose up -d --build
docker compose ps && docker compose logs -f bot
```
The containers have `restart: unless-stopped`, so they come back after reboots (Docker itself is enabled at boot by default).

### Updating
```bash
cd ~/agalio-buybot
./scripts/backup.sh                 # always back up first
git pull
docker compose up -d --build        # rebuilds; the migrate service applies new migrations before the bot starts
docker compose logs -f bot
```

### Backups & restore
```bash
./scripts/backup.sh                 # writes backups/agalio-<timestamp>.dump, prunes after 14 days
# cron (daily 03:15):  15 3 * * * cd /home/deploy/agalio-buybot && ./scripts/backup.sh >> backup.log 2>&1
# restore into an empty database:
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < backups/agalio-XXXX.dump
```
Copy backups off the server. Redis holds only caches, dedup keys and job queues; losing it is harmless (the database prevents duplicate announcements).

### Logs
Structured JSON (pino) on stdout, rotated by Docker (10 MB × 5). Secrets (bot token, RPC keys, webhook secret) are redacted. Pretty-print: `docker compose logs bot | npx pino-pretty` (install `pino-pretty` separately).

---

## 6. Using the bot

### Everyone: just type `CA`
No slash commands needed. In AGALIO NETWORK (or in a private chat with the bot) anyone can type a short request such as `ca`, `CA?`, `wen ca`, `what's the ca`, `drop ca pls`, `contract address` and the bot replies with the token card: contract, on-chain facts, market data, and buttons. Only messages that are *entirely* such a request trigger it, so normal chat containing "ca" is ignored. It is rate limited (once per user per minute, once per chat per 30 s) and respects pause. Posting the official contract address itself still triggers the announcement too. Add or change trigger words in `src/detection/keyword-detector.ts`.

### Admins: the button panel
Open a private chat with the bot and send `/start` (or any message). You get a panel of buttons: **Status, Preview, Contract, Launch status, Links, Buttons, Description, Logo, Template, Admins, Test post, Refresh data, Pause/Resume**. You only type when a value is needed (a URL, the contract address, the description): the bot asks, you reply, it validates and saves, and every change is audited. Risky actions ask for a confirming tap (replacing the contract, a contract with no on-chain code, posting a test to the group). Every button press re-checks that you are an admin and in a private chat, so pressing panel buttons from the group, or as a non-admin, does nothing.

### Optional slash-command shortcuts (admins, private chat)
The same actions exist as commands for power users:

| Command | Purpose |
|---|---|
| `/status` | DB, Redis, RPC health, market-data status, current config (hosts only, no secrets) |
| `/setcontract 0x… [confirm] [force]` | Set the **official** contract. Verifies on-chain code exists (`force` to override for pre-deploy), requires `confirm` to replace an existing one |
| `/setlaunchstatus <STATUS>` | `PRE_LAUNCH`, `CONTRACT_DEPLOYED`, `TRADING_NOT_LIVE`, `TRADING_LIVE`, `PAUSED`, `ANNOUNCEMENT_ONLY` |
| `/setbuyurl <https://…\|clear>` | Buy URL, may contain `{contract}` |
| `/setcharturl`, `/setcommunity`, `/setwebsite` | Same format |
| `/setlink twitter\|whitepaper\|tokenomics\|security <url\|clear>` | Optional link buttons |
| `/setdescription <text>` | Token description (plain text, max 800 chars, escaped when posted) |
| `/setlogo` | Reply to a photo, send a photo with this caption, or `/setlogo https://…`, or `/setlogo clear` |
| `/buttons [key on\|off]` | List / enable / disable buttons |
| `/settemplate <HTML>` / `/resettemplate` | Customise the whole announcement without code changes |
| `/announcement` | Preview in your private chat |
| `/test` | Post a labelled TEST announcement in the group |
| `/refresh` | Bypass caches, re-read chain + market data |
| `/pause` / `/resume` | Stop / restart automatic announcements |
| `/admins`, `/addadmin <id>`, `/removeadmin <id>` | Manage extra admins (primary admins from `TELEGRAM_ADMIN_IDS` only) |

Public: `/start`, `/help`, `/token`, `/contract` (rate-limited in groups).

**Template placeholders** (values are HTML-escaped for you): `{{name}} {{symbol}} {{contract}} {{chain}} {{status}} {{status_note}} {{decimals}} {{total_supply}} {{price}} {{market_cap}} {{fdv}} {{liquidity}} {{volume_24h}} {{price_change_24h}} {{holders}} {{dex}} {{pair}} {{pair_created}} {{market_note}} {{description}}`.
Allowed tags: `b i u s code pre a(href="https://…") blockquote tg-spoiler`. Templates must contain `{{contract}}`; invalid HTML is rejected on save, and a broken template can never be sent.

---

## 7. Configuration reference

See `.env.example` (fully commented). Startup **fails fast** with a list of problems if required values are missing or malformed; there are no silent defaults for secrets.

`AGALIO_*` values only **seed** the database on the first start. After that the database is the source of truth, so restarts never overwrite admin changes. Change them with the admin commands.

---

## 8. Architecture

```
src/
  index.ts / app.ts       process entry, wiring, health + webhook HTTP server, graceful shutdown
  config/                 env validation (zod), constants, validators
  bot/                    grammY bot: commands/, handlers/, keyboards/, middlewares/, messages/, filters/
  blockchain/             bsc.provider (failover, retries, health), contract.service (BEP-20 reads), token.service (cache), address.validator
  market-data/            provider interface, DexScreener provider, caching MarketService (stale fallback)
  announcements/          templates, builder (escaping, provenance sections), service (send, logo, fallback)
  detection/              pure contract detector + message processor (match → dedup → cooldown)
  admin/                  guard (ID based), service (validate → change → audit)
  database/               Prisma client + repositories
  queue/                  Redis clients, BullMQ jobs/workers (market refresh, RPC health, prune, retries)
  services/               cache (Redis with memory fallback), logger (redacting), url validation
prisma/                   schema.prisma + SQL migration
tests/                    unit/, integration/, fixtures/
```

External dependencies:
- **Telegram Bot API** via grammY.
- **BSC JSON-RPC**: configurable primary + fallback (`BSC_RPC_URL`, `BSC_FALLBACK_RPC_URL`). Public endpoints are rate limited; use a private provider for launch day.
- **DexScreener** `GET {base}/token-pairs/v1/bsc/{tokenAddress}` (<https://docs.dexscreener.com/api/reference>). Only BSC pairs where AGALIO is the *base* token are used; the highest-liquidity pair wins. DexScreener has no holder count, so `Holders` shows unavailable.
- **PancakeSwap V2 factory** (optional, informational): `ContractService.findV2Pair` can look up a pair on-chain. It is not used to build buy links. Verify the factory/WBNB constants in `src/config/constants.ts` on BscScan before relying on it.

Adding another market provider: implement `MarketDataProvider` (`src/market-data/market.provider.ts`) and add it to the array passed to `MarketService` in `app.ts`. Nothing else changes.

An **admin dashboard** is intentionally not included: the bot is fully functional without it, and the repositories/services are separated from Telegram so a Next.js dashboard can reuse them later.

---

## 9. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Bot ignores the contract | Privacy mode still on (re-add after disabling); `TELEGRAM_GROUP_ID` wrong; contract not set (`/status`); bot paused; cooldown active; address differs from the official one (even one character) |
| `Invalid environment configuration` at start | Read the listed variables; the message names each problem |
| `409 Conflict: terminated by other getUpdates` | Another instance is polling with the same token (old container, dev machine). Stop it |
| Polling does nothing after switching from webhook | The bot clears webhooks on start; check logs for the real error |
| Announcement says `Data currently unavailable` | No DEX pair yet, or DexScreener/RPC down. `/status` and `/refresh` show which |
| No BUY button | Status is not `TRADING_LIVE`, or no valid https buy URL (`/setbuyurl`) |
| No chart button | No chart URL and DexScreener has no pair yet |
| `/setcontract` says no contract code | Not deployed yet or wrong address. Use `force` only for a pre-deploy announcement |
| RPC errors / timeouts | Add `BSC_FALLBACK_RPC_URL`; use a paid endpoint for launch; check `/status` |
| Photo not shown | Logo missing/invalid; bot falls back to text and clears a bad `file_id`. Re-send with `/setlogo` |
| Buttons "do nothing" for old announcements | Callback data is validated; stale or unknown data is ignored by design |
| Redis warning in logs | Bot continues with in-memory fallback; restore Redis for shared dedup and persistent retry jobs |
| Admin command "not authorized" | Your numeric ID is not in `TELEGRAM_ADMIN_IDS`/admin table (usernames are not used) |

---

## 10. What was verified

Executed in the build environment: TypeScript compile, ESLint, production build, and **135 tests** (unit + integration against a real PostgreSQL 16 and Redis 7 with Telegram/BSC/DexScreener mocked).

**Not verified (cannot be from the build environment), so check them yourself:**
- Connecting to the real Telegram API with a real bot token / real group.
- Real BSC RPC and real DexScreener responses (parsing is tested against payloads shaped like DexScreener's documented schema).
- `docker compose build/up` (Docker was unavailable) and `prisma migrate deploy` (Prisma's schema-engine binary could not be downloaded). The SQL migration was hand-written to match `schema.prisma` and was applied with `psql`; the integration tests then ran against it. Run `npx prisma migrate dev --create-only` on a dev DB once and confirm Prisma reports no drift.
- Deployment to any VPS.

Run `npm run setup` on the target machine; it checks the environment, DB, RPC endpoints, the Telegram token and privacy mode.

Deploying on Railway instead of a VPS: [docs/RAILWAY.md](docs/RAILWAY.md) (`railway.json` is included).

See also: [docs/SECURITY.md](docs/SECURITY.md) and [docs/LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md).
