-- Manual payments: a member pays by UPI / bank / cash / cheque and sends the proof; staff check and approve.
alter table files drop constraint files_kind_check;
alter table files add constraint files_kind_check check (kind in ('photo', 'kyc_pan', 'kyc_bank', 'kyc_aadhaar_front', 'kyc_aadhaar_back', 'ticket', 'download', 'company', 'payment'));

create table payment_requests (
  id            bigserial primary key,
  member_id     bigint not null references members (id),     -- the ID being activated or renewed
  submitted_by  bigint not null references members (id),     -- who sent the proof (self or an upline)
  kind          text not null check (kind in ('activation', 'renewal')),
  amount_paise  bigint not null check (amount_paise > 0),
  method        text not null check (method in ('upi', 'bank', 'cash', 'cheque')),
  reference     text not null,
  paid_on       date not null,
  file_id       text references files (id),
  note          text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason text,
  payment_id    bigint references payments (id),
  decided_by    bigint references admins (id),
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index payment_requests_status_idx on payment_requests (status, id);
create index payment_requests_member_idx on payment_requests (member_id, id desc);
create unique index payment_requests_ref_uq on payment_requests (upper(reference)) where status <> 'rejected';
