-- Shubhora ₹1,999 plan (incl. 18% GST: ₹1,694.07 + ₹304.93).
--   750 BV per subscription, ₹300 per pair of 750 BV each side, daily cap ₹5,000.
--   Direct Sale Bonus is paid as 15 Shubhora AI credits to the sponsor, not cash.
--   Red IDs are never removed.
-- Direct-bonus credits are queued here and pushed to the Suite once each (ref is the idempotency key).
create table suite_credit_sync (
  ref              text primary key,
  member_id        bigint not null references members (id),
  source_member_id bigint references members (id),
  credits          int not null check (credits > 0),
  status           text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts         int not null default 0,
  last_error       text,
  created_at       timestamptz not null default now(),
  done_at          timestamptz
);
create index suite_credit_sync_pending_idx on suite_credit_sync (status, created_at) where status <> 'done';

-- New plan version from 20 Sep 2026, on top of the version in force (only where a plan exists already).
insert into plan_settings (effective_from, values, note)
select date '2026-09-20',
       p.values || '{"subscriptionBasePaise":169407,"gstBp":1800,"bvPerSubscription":750,"pairBv":750,"pairIncomePaise":30000,"dailyCapPaise":500000,"directBonusBp":0,"directBonusCredits":15,"redExpiryDays":0}'::jsonb,
       'Shubhora plan ₹1,999 incl. GST: 750 BV, ₹300 per pair, direct bonus as 15 AI credits'
from (select values from plan_settings order by effective_from desc, id desc limit 1) p
where not exists (select 1 from plan_settings where effective_from = date '2026-09-20');
