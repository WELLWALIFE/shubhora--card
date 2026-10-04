-- Accounts now start inside the Shubhora app (one account = card + partner account, from 22 Sep 2026):
--   username     the app username, the partner's public name (sponsors are shown by username only)
--   mobile       may arrive after registration (Google sign-ups), so it is no longer required
--   suite_origin true for IDs the app registered — they log in through the app, never with a partner password
-- Price: Shubhora Growth ₹2,999 a month incl. 18% GST (₹2,541.53 + ₹457.47). BV, pairs and pair income unchanged.
alter table members add column if not exists username text;
create unique index if not exists members_username_uq on members (lower(username)) where username is not null;
alter table members add column if not exists suite_origin boolean not null default false;
alter table members alter column mobile drop not null;
drop index if exists members_mobile_uq;
create unique index if not exists members_mobile_uq on members (mobile) where mobile is not null;

insert into plan_settings (effective_from, values, note)
select date '2026-09-22',
       p.values || '{"subscriptionBasePaise":254153}'::jsonb,
       'Shubhora Growth ₹2,999/month incl. GST from 22 Sep 2026 (₹2,541.53 + GST); BV 2,500, pairs and income unchanged'
from (select values from plan_settings order by effective_from desc, id desc limit 1) p;
