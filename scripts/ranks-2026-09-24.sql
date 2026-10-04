-- Rank thresholds, revised 24 Sep 2026: ranks now count pairs of BOTH binaries (new + renewal), so every
-- threshold is doubled (first rank at 10 pairs). Rewards and instalments are unchanged.
-- Run: sudo -u postgres psql shubhora_partner -f scripts/ranks-2026-09-24.sql
begin;
update ranks set renewal_pairs = v.p from (values
  (1, 10), (2, 40), (3, 150), (4, 500), (5, 2000), (6, 6000), (7, 20000), (8, 60000), (9, 120000), (10, 200000)
) as v(level, p) where ranks.level = v.level;
select level, name, renewal_pairs as pairs_both_binaries, reward_paise / 100 as reward_rupees, instalments from ranks order by level;
commit;
