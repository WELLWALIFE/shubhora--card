# Shubhora Partner

The partner (binary plan) software for Shubhora Business Suite: member panel, admin panel,
daily closing, wallet, KYC, withdrawals, GST invoices and CA reports. Separate app and
database from the Shubhora website (`../wellwa-cards`); the website never mentions it.

Blueprint: https://claude.ai/artifact/8MZrFzsp3q46PsHG9gK2F2

## Run locally

```
npm install
npx tsx scripts/demo-data.ts     # sample team in .data/pg (local only)
npm run dev                      # http://localhost:3000
```

Without `DATABASE_URL` the app uses an on-disk PGlite database in `.data/pg`.
Production must set `DATABASE_URL` (PostgreSQL 15+), `OWNER_PASSWORD`, `PUBLIC_URL`.

## Layout

| Path | What |
| --- | --- |
| `src/server/engine/` | The plan. `matching.ts` (pure pair rules), `closing.ts` (daily closing), `payments.ts` (activation, renewal, refund, invoices), `members.ts` (registration, placement), `wallet.ts`, `settings.ts` (every plan number, versioned by date) |
| `src/server/migrations/` | SQL schema, applied in name order at start-up |
| `src/app/(member)/` | Member panel |
| `src/app/admin/(panel)/` | Admin panel |
| `src/app/actions/` | Server actions; every admin change is permission-checked and written to `audit_log` |
| `tests/` | Plan tests on a real in-process Postgres |
| `scripts/nightly-closing.ts` | Runs missing closings up to yesterday (schedule at 00:05 IST) |

## Rules for every change (people and AI)

1. `npm test` must pass before anything is deployed. If a plan test changes its expected
   number, that is a change to people's money: it needs the owner's written approval.
2. Migrations are forward-only. Never edit an applied `.sql` file; add `0003_….sql`.
3. The `ledger` and `audit_log` tables are append-only (database triggers refuse updates and
   deletes). Corrections are new ledger lines.
4. Plan numbers live in `plan_settings`, not in code. Change them from Admin → Plan settings
   with a future start date; past closings keep the rules they ran with.
5. Money is in paise (integers), BV in whole units, business dates are IST dates.
6. `/dev/session` works only with `NODE_ENV=development` and `DEV_SESSIONS=1`.

## Production

- Live at https://neuraledge.me/partners (built with NEXT_PUBLIC_BASE_PATH=/partners; Apache proxies /partners from the
  neuraledge.me vhost to :3002). partner.wellwalife.com 301-redirects there. To move to its own domain later: set
  NEXT_PUBLIC_BASE_PATH to empty in deploy.sh and the server .env.local, point a vhost at :3002, update PUBLIC_URL.
- Shubhora Business Suite link: every payment is queued in suite_sync and pushed to neuraledge `/api/link`
  (HMAC with SUITE_LINK_SECRET = LINK_SECRET on the Suite). `/suite` opens the member's Suite account via a one-time token.
- App: `/opt/shubhora-partner/app`, pm2 `shubhora-partner` on 127.0.0.1:3002 (memory capped 450 MB).
- Database: PostgreSQL 16 on the same box, localhost only, db `shubhora_partner`, role `partner`
  (tuning in `/var/lib/pgsql/data/conf.d/shubhora.conf`). Password lives only in the server's `.env.local`.
- The VPS runs cPanel/WHM, and cPanel **rewrites `pg_hba.conf`** during its nightly maintenance (upcp), keeping only
  its own `samerole` rules — on 21 Sep 2026 that cut the panel off from its database for a day. The role
  `shubhora_partner` (NOLOGIN) exists only so that `partner`, a member of it, matches `samerole`; never drop it, and
  never rely on hand-added `pg_hba.conf` lines. Check: `psql "$DATABASE_URL" -c 'select 1'` on the server.
- Apache: `/etc/apache2/conf.d/includes/shubhora-partner.conf`, included before the NeuralEdge domain vhosts.
  Let's Encrypt cert renewed by the existing certbot timer.
- Cron 18:35 UTC (00:05 IST): `server/nightly.sh` → closings, Red-ID expiry, backup.
- Backups: `/var/backups/shubhora-partner` (14 nightly, 10 pre-deploy). Same disk; copy off-server regularly.
- Deploy: `npm run deploy` (tests → build → backup → upload → restart → health check).
