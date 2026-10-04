-- Link each partner ID to its Shubhora Business Suite account (on the Shubhora software).
-- Every payment is queued here and pushed to the Suite, which extends that account's subscription.

alter table members add column suite_user_id text;
alter table members add column suite_email text;
create unique index members_suite_user_uq on members (suite_user_id) where suite_user_id is not null;

create table suite_sync (
  payment_id  bigint primary key references payments (id),
  member_id   bigint not null references members (id),
  status      text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts    int not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index suite_sync_pending_idx on suite_sync (status, created_at) where status <> 'done';

-- Queue every payment already recorded.
insert into suite_sync (payment_id, member_id)
  select id, member_id from payments where status = 'paid' on conflict do nothing;
