-- Ranks and cash rewards. Ranks are earned on lifetime renewal pairs made while the member
-- was eligible (green, own subscription active), plus a minimum number of green directs.
-- Rewards are paid through the daily closing as income (so TDS applies), one-time or in
-- monthly instalments, within a monthly reward pool cap.

create table ranks (
  level          int primary key,
  name           text not null,
  renewal_pairs  int not null check (renewal_pairs > 0),
  green_directs  int not null check (green_directs >= 0),
  reward_paise   bigint not null check (reward_paise >= 0),
  instalments    int not null default 1 check (instalments between 1 and 120),
  active         boolean not null default true,
  updated_at     timestamptz not null default now()
);

insert into ranks (level, name, renewal_pairs, green_directs, reward_paise, instalments) values
  (1,  'Starter',     5,      2,  100000,    1),
  (2,  'Builder',     20,     3,  300000,    1),
  (3,  'Achiever',    75,     4,  1000000,   1),
  (4,  'Rising Star', 250,    6,  2500000,   1),
  (5,  'Leader',      1000,   8,  7500000,   1),
  (6,  'Master',      3000,   10, 20000000,  10),
  (7,  'Visionary',   10000,  12, 60000000,  20),
  (8,  'Legend',      30000,  15, 150000000, 30),
  (9,  'Royal',       60000,  18, 250000000, 40),
  (10, 'Crown',       100000, 21, 500000000, 50);

create table member_ranks (
  member_id     bigint not null references members (id),
  level         int not null references ranks (level),
  rank_name     text not null,               -- name at the time it was earned
  achieved_on   date not null,
  closing_id    bigint references closings (id),
  reward_paise  bigint not null,
  instalments   int not null,
  primary key (member_id, level)
);
create index member_ranks_date_idx on member_ranks (achieved_on);

create table reward_instalments (
  id            bigserial primary key,
  member_id     bigint not null references members (id),
  level         int not null,
  seq           int not null,
  due_on        date not null,
  amount_paise  bigint not null,
  status        text not null check (status in ('awaiting_approval', 'pending', 'paid', 'skipped', 'cancelled')),
  paid_closing_id bigint references closings (id),
  income_id     bigint references incomes (id),
  note          text,
  decided_by    bigint references admins (id),
  unique (member_id, level, seq)
);
create index reward_instalments_due_idx on reward_instalments (status, due_on);

alter table incomes drop constraint incomes_kind_check;
alter table incomes add constraint incomes_kind_check check (kind in ('direct', 'match_new', 'match_renewal', 'sponsor', 'rank_reward'));

update flags set enabled = true where key = 'feature.ranks';
