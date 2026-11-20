# Branding assets

Drop the AGALIO logo here as `logo.png` (square PNG/JPG, at least 512x512, under 5 MB).

The bot resolves the logo in this order:

1. A Telegram `file_id` saved by an admin via `/setlogo` (reply to a photo in a private chat).
2. An HTTPS image URL saved via `/setlogo https://...`.
3. `AGALIO_LOGO_PATH` (default `assets/logo.png`), if the file exists.
4. No logo: the announcement is sent as plain text.

No application code needs to change when the logo is replaced.
