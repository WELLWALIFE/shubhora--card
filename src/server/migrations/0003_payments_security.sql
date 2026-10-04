-- Online payment orders, admin two-step login, two-person approval for manual money,
-- credit notes for refunds.

create table pay_orders (
  order_id     text primary key,
  member_id    bigint not null references members (id),
  kind         text not null check (kind in ('activation', 'renewal')),
  amount_paise bigint not null,
  status       text not null default 'created' check (status in ('created', 'paid', 'failed')),
  payment_id   text,
  created_at   timestamptz not null default now(),
  paid_at      timestamptz
);
create index pay_orders_member_idx on pay_orders (member_id, created_at desc);

alter table admins add column totp_secret text;
alter table admins add column totp_enabled boolean not null default false;
alter table sessions add column verified boolean not null default true;

create table approvals (
  id           bigserial primary key,
  kind         text not null check (kind in ('wallet_adjust')),
  member_id    bigint references members (id),
  payload      jsonb not null,
  reason       text not null,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by bigint not null references admins (id),
  requested_at timestamptz not null default now(),
  decided_by   bigint references admins (id),
  decided_at   timestamptz,
  decision_note text
);
create index approvals_status_idx on approvals (status, id);

alter table payments add column credit_note_no text unique;
