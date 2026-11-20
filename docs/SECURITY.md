# Security notes

## Trust model: three kinds of information
1. **Verified on-chain facts**: token name/symbol/decimals/total supply and "contract code exists", read from BSC RPC. Shown under "On-chain".
2. **Third-party market data**: price, liquidity, market cap, volume from DexScreener. Shown under "Market data (third-party, may be delayed)". Can be stale or wrong; stale cached data is labelled.
3. **Admin-supplied information**: description, links, launch status. Shown under "provided by AGALIO admins". The bot does not verify these.

The bot never says a token is audited, safe, or legitimate. A contract is "official" **only** because an authorised admin configured it, never because someone posted it, forwarded it, or because the data looks right.

## What the bot never does
- Ask for, receive or store seed phrases / private keys / wallet credentials.
- Hold funds, sign, send transactions, or execute purchases.
- Announce a contract that is not exactly the configured official address. Forwarded messages carry no extra trust.

## Controls
| Area | Control |
|---|---|
| Secrets | Env vars only; `.env` git/docker-ignored; bot token, RPC URLs and webhook secret are redacted in logs and never printed to Telegram |
| Admin auth | Numeric Telegram user ID allow-list (env primary admins + DB admins). Fail-closed if lookup errors. Admin commands only in private chat |
| Admin input | Zod/explicit validation: addresses (EIP-55 checksum, no zero address), https-only URLs (no credentials, no localhost/private IPs, no whitespace), status enum, button keys, length limits, HTML template validation |
| Contract change | Requires `confirm` to replace; verifies bytecode on BSC unless `force`; audited |
| Output | All data placed in announcements is HTML-escaped; custom templates are validated (allowed tags only, balanced, https links) and a broken template falls back to the default |
| URLs | Validated on save **and** again at render time before a button is created |
| Idempotency | Redis `SET NX` + DB unique key on (group, message, contract); cooldown per chat |
| Callbacks | Query-id dedup, per-chat cooldown, per-user rate limit, unknown data ignored; the contract shown by COPY comes from the database, not callback data |
| Rate limiting | Per-user commands/buttons per minute (`USER_RATE_LIMIT_PER_MINUTE`); primary admins exempt |
| Network | Timeouts on RPC and market calls, bounded retries with backoff, honours `Retry-After`, RPC failover |
| Errors | Central handler; users only ever see safe messages; stack traces stay in logs |
| Audit | `AuditLog` for every admin change; `BotEvent` for errors, membership changes, RPC outages |
| Containers | Runs as non-root `node` user; DB/Redis not published; health port bound to 127.0.0.1 |
| Webhook | Secret-token header verified by grammY; HTTPS only; secret format enforced |

## Operational advice
- Keep the bot **not an admin** in the group, or grant only "send messages".
- Use a strong `POSTGRES_PASSWORD`; `chmod 600 .env`; firewall everything except SSH (and 80/443 for webhooks).
- Prefer a private BSC RPC for launch; keep a fallback.
- Limit `TELEGRAM_ADMIN_IDS` to people who need it. Admins should use Telegram 2FA; admin accounts are the main attack surface.
- Rotate the bot token (`/revoke` in BotFather) if you suspect exposure.
- Add the standard warning to your pinned message: *admins will never DM first; never share your seed phrase.*
- Review `AuditLog` periodically: `SELECT * FROM "AuditLog" ORDER BY "createdAt" DESC LIMIT 50;`

## Known limitations
- Telegram cannot guarantee that a scam clone posting a *similar* address is noticed by users; the bot only reacts to the exact official address.
- Holder count and audit status are not available from the data sources used, so they are never shown as facts.
- If an admin account is compromised, the attacker can change links and the contract (with `confirm`). Changes are audited but not blocked.
