-- Admin activations with any terms (owner's call, 24 Sep 2026): a leader's free entry with no BV, a free entry that
-- still carries full BV, a part payment with part BV, several months at once. Every one is a payments row (the record),
-- plus these columns so reports show exactly what was given.
alter table payments add column if not exists admin_mode text;          -- e.g. 'free-0bv', 'free-full-bv', 'paid-full', 'custom'
alter table payments add column if not exists bv_given int;             -- the BV this payment put into the binary
alter table payments add column if not exists months int not null default 1;   -- subscription months this payment covers
alter table payments add column if not exists app_plan boolean not null default true;  -- Shubhora app plan given with it
