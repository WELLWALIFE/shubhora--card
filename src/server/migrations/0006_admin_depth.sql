-- Deeper admin and member tools: files (photos, KYC documents, downloads), notes, login history,
-- password help requests, company details, sponsor/placement changes.

create table files (
  id           text primary key,                 -- random id, also the file name on disk
  member_id    bigint references members (id),
  kind         text not null check (kind in ('photo', 'kyc_pan', 'kyc_bank', 'kyc_aadhaar_front', 'kyc_aadhaar_back', 'ticket', 'download', 'company')),
  name         text not null,
  mime         text not null,
  size_bytes   int not null,
  created_by_admin bigint references admins (id),
  created_at   timestamptz not null default now()
);
create index files_member_idx on files (member_id, kind);

alter table members add column photo_file text references files (id);
alter table members add column last_login_at timestamptz;
alter table members add column last_login_ip text;
alter table kyc add column pan_file text references files (id);
alter table kyc add column bank_file text references files (id);
alter table kyc add column aadhaar_front_file text references files (id);
alter table kyc add column aadhaar_back_file text references files (id);
alter table ticket_messages add column file_id text references files (id);

create table member_notes (
  id         bigserial primary key,
  member_id  bigint not null references members (id),
  admin_id   bigint references admins (id),
  body       text not null,
  pinned     boolean not null default false,
  at         timestamptz not null default now()
);
create index member_notes_idx on member_notes (member_id, id desc);

create table login_events (
  id         bigserial primary key,
  kind       text not null check (kind in ('member', 'admin')),
  subject_id bigint,
  login_text text not null,
  ok         boolean not null,
  note       text,
  ip         text,
  user_agent text,
  at         timestamptz not null default now()
);
create index login_events_idx on login_events (kind, subject_id, id desc);
create index login_events_at_idx on login_events (at desc);

create table password_requests (
  id          bigserial primary key,
  member_id   bigint references members (id),
  login_text  text not null,
  mobile      text,
  message     text,
  status      text not null default 'open' check (status in ('open', 'done', 'rejected')),
  created_at  timestamptz not null default now(),
  handled_by  bigint references admins (id),
  handled_at  timestamptz
);
create index password_requests_open_idx on password_requests (status, id);

create table downloads (
  id          bigserial primary key,
  title       text not null,
  description text,
  category    text not null default 'General',
  file_id     text not null references files (id),
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);

-- Company details used on invoices, the support page and offline payment instructions.
create table company_settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now(),
  updated_by bigint references admins (id)
);
insert into company_settings (key, value) values
  ('legal_name', 'Wellwa Life India Pvt Ltd'), ('brand_name', 'Shubhora'), ('address', ''), ('state_code', ''),
  ('gstin', ''), ('pan', ''), ('sac', '998314'), ('support_email', ''), ('support_phone', ''), ('support_whatsapp', ''),
  ('grievance_name', ''), ('grievance_email', ''), ('grievance_phone', ''),
  ('bank_account_name', ''), ('bank_account_no', ''), ('bank_ifsc', ''), ('bank_name', ''), ('upi_id', '')
on conflict do nothing;

-- Record of sponsor / placement moves (also written to audit_log).
create table tree_moves (
  id          bigserial primary key,
  member_id   bigint not null references members (id),
  kind        text not null check (kind in ('sponsor', 'placement')),
  from_id     bigint,
  to_id       bigint,
  leg         char(1),
  reason      text not null,
  admin_id    bigint references admins (id),
  at          timestamptz not null default now()
);

insert into flags (key, enabled, label, grp) values
  ('member.menu.subscription', true, 'Subscription and renewals', 'Member menu'),
  ('member.menu.rank', true, 'Rank page', 'Member menu'),
  ('feature.forgot_password', true, 'Forgot password requests', 'Features'),
  ('feature.photo_upload', true, 'Profile photo upload', 'Features')
on conflict do nothing;
