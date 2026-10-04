-- FRESH START — partner panel (PostgreSQL shubhora_partner). Irreversible; a dump is taken by the command that runs it.
-- Removes every member except the company root and everything that hangs off them: tree, closings, incomes, wallet
-- ledger, payments, KYC, withdrawals, tickets, sessions, link tokens. Keeps plan settings, company settings, flags,
-- ranks, announcements, downloads and the admin logins.
begin;

-- everything that belongs to members (children first is not needed: TRUNCATE … CASCADE handles it)
truncate table
  closings, closing_lines, bv_events, incomes, ledger, payments, pay_orders, payment_requests, approvals,
  invoice_counters, kyc, withdrawals, tickets, ticket_messages, member_ranks, reward_instalments, suite_sync,
  files, member_notes, login_events, password_requests, tree_moves, link_tokens, sessions, login_attempts, audit_log
  cascade;
do $$ begin
  begin execute 'truncate table suite_credit_sync cascade'; exception when undefined_table then null; end;
end $$;

-- root's own binary state stays; everyone else's goes
delete from binary_state where member_id in (select id from members where parent_id is not null);
-- the members, except the company root
delete from members where parent_id is not null;
update members set username = 'Shubhora' where parent_id is null and (username is null or username = '');

-- ID numbers start again right after the root's
do $$ declare root_code text; num bigint; begin
  select code into root_code from members where parent_id is null limit 1;
  num := nullif(regexp_replace(root_code, '\D', '', 'g'), '')::bigint;
  if num is not null then execute format('alter sequence member_code_seq restart with %s', num + 1); end if;
end $$;

commit;

select 'members' what, count(*) n from members
union all select 'incomes', count(*) from incomes
union all select 'ledger', count(*) from ledger
union all select 'payments', count(*) from payments
union all select 'sessions', count(*) from sessions;
