-- Core schema for the partner (binary) software.
-- Money is stored in paise (bigint). BV is stored in whole BV units.
-- Business dates are IST calendar dates.

create table plan_settings (
  id             bigserial primary key,
  effective_from date not null,
  values         jsonb not null,
  note           text,
  created_by     bigint,
  approved_by    bigint,
  created_at     timestamptz not null default now()
);
create index plan_settings_eff_idx on plan_settings (effective_from);

create sequence member_code_seq start 100001;

create table members (
  id              bigserial primary key,
  code            text not null unique,
  name            text not null,
  mobile          text not null,
  email           text,
  pan             text,
  password_hash   text not null,
  status          text not null default 'red' check (status in ('red', 'green')),
  green_kind      text check (green_kind in ('paid', 'offline', 'complimentary')),
  green_at        timestamptz,
  green_date      date,
  blocked         boolean not null default false,
  income_hold     boolean not null default false,
  withdraw_block  boolean not null default false,
  show_balance    boolean not null default true,
  sponsor_id      bigint references members (id),
  parent_id       bigint references members (id),
  leg             char(1) check (leg in ('L', 'R')),
  depth           int not null default 0,
  sub_valid_until date,
  created_at      timestamptz not null default now(),
  constraint members_slot_uq unique (parent_id, leg),
  constraint members_leg_chk check ((parent_id is null) = (leg is null))
);
create unique index members_mobile_uq on members (mobile);
create unique index members_pan_uq on members (upper(pan)) where pan is not null;
create unique index members_single_root on members ((parent_id is null)) where parent_id is null;
create index members_sponsor_idx on members (sponsor_id);
create index members_parent_idx on members (parent_id);

create table closings (
  id           bigserial primary key,
  closing_date date not null unique,
  settings_id  bigint not null references plan_settings (id),
  posted_at    timestamptz not null default now(),
  posted_by    bigint,
  summary      jsonb not null
);

create table payments (
  id            bigserial primary key,
  member_id     bigint not null references members (id),
  kind          text not null check (kind in ('activation', 'renewal')),
  method        text not null check (method in ('online', 'offline', 'complimentary')),
  base_paise    bigint not null,
  gst_paise     bigint not null,
  total_paise   bigint not null,
  reference     text,
  reason        text,
  status        text not null default 'paid' check (status in ('paid', 'refunded')),
  paid_at       timestamptz not null default now(),
  business_date date not null,
  period_from   date not null,
  period_to     date not null,
  invoice_no    text unique,
  created_by    bigint,
  refunded_at   timestamptz,
  refund_reason text
);
create unique index payments_online_ref_uq on payments (reference) where method = 'online';
create index payments_member_idx on payments (member_id);

create table bv_events (
  id          bigserial primary key,
  member_id   bigint not null references members (id),
  bin         text not null check (bin in ('new', 'renewal')),
  bv          int not null,
  payment_id  bigint references payments (id),
  reverses_id bigint references bv_events (id),
  event_date  date not null,
  void        boolean not null default false,
  closing_id  bigint references closings (id),
  created_at  timestamptz not null default now()
);
create index bv_events_open_idx on bv_events (event_date) where closing_id is null;

create table binary_state (
  member_id       bigint not null references members (id),
  bin             text not null check (bin in ('new', 'renewal')),
  carry_left      bigint not null default 0,
  carry_right     bigint not null default 0,
  total_left      bigint not null default 0,
  total_right     bigint not null default 0,
  first_pair_done boolean not null default false,
  pairs_total     bigint not null default 0,
  primary key (member_id, bin)
);

create table closing_lines (
  closing_id    bigint not null references closings (id),
  member_id     bigint not null references members (id),
  bin           text not null,
  open_left     bigint not null,
  open_right    bigint not null,
  in_left       bigint not null,
  in_right      bigint not null,
  pairs         int not null,
  paid_pairs    int not null,
  flushed_pairs int not null,
  close_left    bigint not null,
  close_right   bigint not null,
  amount_paise  bigint not null,
  reason        text,
  primary key (closing_id, member_id, bin)
);

create table incomes (
  id               bigserial primary key,
  member_id        bigint not null references members (id),
  closing_id       bigint not null references closings (id),
  kind             text not null check (kind in ('direct', 'match_new', 'match_renewal', 'sponsor')),
  gross_paise      bigint not null,
  source_member_id bigint references members (id),
  bv_event_id      bigint references bv_events (id),
  held             boolean not null default false,
  released_at      timestamptz,
  note             text
);
create index incomes_member_idx on incomes (member_id, closing_id);

-- Wallet ledger: append-only. Balance = sum(amount_paise).
create table ledger (
  id            bigserial primary key,
  member_id     bigint not null references members (id),
  entry         text not null check (entry in (
                  'income', 'tds', 'admin_charge', 'withdrawal', 'withdrawal_reversal',
                  'manual_credit', 'manual_debit', 'clawback')),
  amount_paise  bigint not null,
  fy            text not null,
  income_id     bigint references incomes (id),
  closing_id    bigint references closings (id),
  withdrawal_id bigint,
  note          text,
  created_by    bigint,
  created_at    timestamptz not null default now()
);
create index ledger_member_idx on ledger (member_id, id);

create function ledger_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'ledger is append-only';
end $$;
create trigger ledger_no_update before update or delete on ledger
  for each row execute function ledger_append_only();

create table invoice_counters (
  fy   text primary key,
  last bigint not null default 0
);
