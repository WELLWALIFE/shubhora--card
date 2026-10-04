-- Shubhora plan from 20 Sep 2026: ₹2,499 a month incl. 18% GST (₹2,117.80 + ₹381.20), renewal the same.
--   Two binaries (new sale, renewal): 2,500 BV per sale, every pair 1:1 (2,500 BV each side), ₹500 a pair,
--   capped at 10 pairs (₹5,000) a day in each binary. No company ceiling.
--   New-sale income: no own-subscription condition once the ID is green.
--   Renewal income: own subscription active; in the 3 grace days it is held — paid if the member renews in
--   time, forfeited otherwise.
--   No cash direct income, no sponsor bonus. Each direct sale gives the sponsor 21 Shubhora AI credits
--   (10% of ₹2,117.80 at ₹10 a credit). Rank rewards on renewal pairs only, no directs condition.
alter table incomes add column if not exists hold_reason text;
alter table incomes add column if not exists forfeited_at timestamptz;
create index if not exists incomes_grace_idx on incomes (member_id) where hold_reason = 'grace' and held and released_at is null and forfeited_at is null;

update ranks set green_directs = 0;

insert into plan_settings (effective_from, values, note)
select date '2026-09-20',
       p.values || '{"subscriptionBasePaise":211780,"gstBp":1800,"bvPerSubscription":2500,"pairBv":2500,"firstPairRatio":false,"pairIncomePaise":50000,"dailyCapPaise":500000,"binaryCeilingPaise":0,"directBonusBp":0,"directBonusCredits":21,"sponsorBonusBp":0,"renewalGraceDays":3,"renewalGraceHold":true,"lapseStopsNewDays":0,"redExpiryDays":0}'::jsonb,
       'Shubhora plan ₹2,499/month incl. GST: 2,500 BV, 1:1 pairs, ₹500 a pair, 10 pairs a day; 21 credits per direct sale; renewal grace hold'
from (select values from plan_settings order by effective_from desc, id desc limit 1) p;
