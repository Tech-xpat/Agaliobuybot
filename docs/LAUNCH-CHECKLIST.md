# Launch-day checklist

## T-3 days: infrastructure
- [ ] VPS hardened (SSH keys only, firewall, unattended upgrades)
- [ ] `docker compose up -d --build` is running; `docker compose ps` all healthy
- [ ] `.env` is `chmod 600`, strong `POSTGRES_PASSWORD`, **no** secrets committed to git
- [ ] `BSC_RPC_URL` is a private/paid endpoint and `BSC_FALLBACK_RPC_URL` is a second provider
- [ ] `npm run setup` (run from a checkout with dev dependencies) reports env, DB, RPC, Telegram token OK, and `/status` in a private chat shows Database and RPC healthy
- [ ] Backups: `./scripts/backup.sh` works, cron installed, a restore has been rehearsed

## T-2 days: Telegram
- [ ] Bot created in BotFather, name/description/picture set, token stored only in `.env`
- [ ] Privacy mode **disabled**, bot removed and re-added to AGALIO NETWORK afterwards
- [ ] Bot has only "send messages" (or minimal admin rights)
- [ ] `TELEGRAM_GROUP_ID` and every admin's numeric ID verified
- [ ] Group link is correct: `TELEGRAM_GROUP_URL=https://t.me/agalionetwork`
- [ ] Each admin has tried `/status` in a **private** chat and sees ✅ for Database and RPC

## T-1 day: content (all by admin command, no redeploy)
- [ ] `/setdescription` written and reviewed (plain text)
- [ ] `/setlogo` sent; `/announcement` preview looks right on mobile and desktop
- [ ] Optional: `/setcommunity`, `/setwebsite`, `/setlink twitter|whitepaper|tokenomics|security`
- [ ] Optional: `/settemplate` customised and previewed
- [ ] `/setlaunchstatus PRE_LAUNCH` (or `TRADING_NOT_LIVE`)
- [ ] Do **not** set a buy URL yet unless you want it staged (it stays hidden until `TRADING_LIVE`)

## Contract deployment
- [ ] Contract deployed and verified on BscScan; address double-checked by two people
- [ ] `/setcontract 0x…` (the bot checks code exists) → `/setlaunchstatus CONTRACT_DEPLOYED`
- [ ] `/test` in the group looks right; delete the TEST message afterwards
- [ ] Post the contract in the group from an admin account → exactly **one** announcement appears
- [ ] Post a random other contract → **no** reaction
- [ ] Pin the official contract and warning ("admins never DM first, never share your seed phrase")

## Going live
- [ ] Liquidity added; pair visible on DexScreener (`/refresh` then `/status` shows market `ok`)
- [ ] `/setbuyurl https://…` (PancakeSwap swap URL for the AGALIO contract; template: `…outputCurrency={contract}`), opened by you and tested
- [ ] `/setcharturl` if you want a fixed chart link (otherwise the DexScreener pair URL is used automatically)
- [ ] `/setlaunchstatus TRADING_LIVE`
- [ ] `/announcement` preview shows BUY and LIVE CHART buttons, both open the right pages
- [ ] Post the contract once more to confirm the live card (mind the cooldown)

## During launch
- [ ] Watch `docker compose logs -f bot` for RPC / Telegram 429 errors
- [ ] `/status` every so often; use `/pause` if something looks wrong; `/resume` afterwards
- [ ] If a link is wrong: `/setbuyurl clear` or `/buttons buy off` immediately

## After launch
- [ ] Review `AuditLog` and `BotEvent` for unexpected changes
- [ ] Take a backup
- [ ] Rotate anything that was shared during setup
