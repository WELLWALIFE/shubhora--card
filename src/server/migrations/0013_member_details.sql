-- Sign-up now asks date of birth and gender (direct-selling rules: adults only; the agreement is accepted in the app).
alter table members add column if not exists dob date;
alter table members add column if not exists gender text check (gender in ('male', 'female', 'other'));
alter table members add column if not exists agreed_at timestamptz;
