-- Admin users, sessions, audit trail, visibility flags, KYC, withdrawals, support, news.

create table admins (
  id            bigserial primary key,
  username      text not null unique,
  name          text not null,
  password_hash text not null,
  role          text not null check (role in ('owner', 'accounts', 'kyc', 'support', 'viewer', 'ca')),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table sessions (
  token_hash  text primary key,
  kind        text not null check (kind in ('member', 'admin')),
  subject_id  bigint not null,
  acting_admin bigint,                 -- set when an admin logs in as a member
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  ip          text,
  user_agent  text
);
create index sessions_subject_idx on sessions (kind, subject_id);

create table login_attempts (
  key        text not null,
  at         timestamptz not null default now()
);
create index login_attempts_idx on login_attempts (key, at);

-- Every admin action that changes data. Append-only.
create table audit_log (
  id         bigserial primary key,
  admin_id   bigint references admins (id),
  member_id  bigint references members (id),
  action     text not null,
  reason     text,
  detail     jsonb,
  at         timestamptz not null default now()
);
create index audit_member_idx on audit_log (member_id, id);
create trigger audit_no_update before update or delete on audit_log
  for each row execute function ledger_append_only();

-- Show / hide switches. key examples: 'member.menu.wallet', 'feature.withdrawals'.
create table flags (
  key        text primary key,
  enabled    boolean not null,
  label      text not null,
  grp        text not null,
  updated_at timestamptz not null default now(),
  updated_by bigint references admins (id)
);

insert into flags (key, enabled, label, grp) values
  ('member.menu.team',        true,  'Team and tree',              'Member menu'),
  ('member.menu.income',      true,  'Income reports',             'Member menu'),
  ('member.menu.wallet',      true,  'Wallet',                     'Member menu'),
  ('member.menu.grow',        true,  'Referral links',             'Member menu'),
  ('member.menu.kyc',         true,  'KYC',                        'Member menu'),
  ('member.menu.support',     true,  'Support',                    'Member menu'),
  ('member.menu.downloads',   true,  'Downloads',                  'Member menu'),
  ('feature.registration',    true,  'New registrations',          'Features'),
  ('feature.withdrawals',     true,  'Withdrawal requests',        'Features'),
  ('feature.online_payment',  true,  'Online activation payment',  'Features'),
  ('feature.epins',           false, 'E-pins',                     'Features'),
  ('feature.ranks',           false, 'Ranks and rewards',          'Features'),
  ('feature.maintenance',     false, 'Maintenance mode',           'Features');

create table kyc (
  member_id     bigint primary key references members (id),
  pan           text,
  pan_name      text,
  aadhaar_last4 text,
  bank_name     text,
  account_name  text,
  account_no    text,
  ifsc          text,
  nominee       text,
  address       text,
  gstin         text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason text,
  submitted_at  timestamptz not null default now(),
  reviewed_at   timestamptz,
  reviewed_by   bigint references admins (id)
);

create table withdrawals (
  id            bigserial primary key,
  member_id     bigint not null references members (id),
  amount_paise  bigint not null check (amount_paise > 0),
  status        text not null default 'requested' check (status in ('requested', 'approved', 'paid', 'rejected')),
  bank_snapshot jsonb not null,
  utr           text,
  reject_reason text,
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    bigint references admins (id)
);
create index withdrawals_status_idx on withdrawals (status, id);

create table tickets (
  id         bigserial primary key,
  member_id  bigint not null references members (id),
  subject    text not null,
  status     text not null default 'open' check (status in ('open', 'answered', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table ticket_messages (
  id         bigserial primary key,
  ticket_id  bigint not null references tickets (id),
  from_admin bigint references admins (id),
  body       text not null,
  at         timestamptz not null default now()
);

create table announcements (
  id         bigserial primary key,
  title      text not null,
  body       text not null,
  publish_at timestamptz not null default now(),
  active     boolean not null default true,
  created_by bigint references admins (id)
);
