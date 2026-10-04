-- One-time sign-in passes: a member signed in to the Shubhora Business Suite opens the partner panel
-- without typing the password again. Each pass works once and only for two minutes.

create table link_tokens (
  token_hash  text primary key,
  member_id   bigint not null references members (id),
  next        text not null default 'dashboard',
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index link_tokens_expiry_idx on link_tokens (expires_at);
