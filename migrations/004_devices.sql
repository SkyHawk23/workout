-- Phase 1 already stubbed out a `devices` table as Garmin groundwork (see
-- migrations/001_init.sql, "Phase 2 (Garmin) reference"). That table is
-- unused by any code so far (empty in production), so it's safe to reshape
-- in place rather than starting a second table.
alter table devices alter column user_id drop not null;
alter table devices alter column paired_at drop not null;
alter table devices alter column paired_at drop default;
alter table devices drop column if exists kind;
alter table devices add column if not exists name text not null default 'Garmin watch';
alter table devices add column if not exists token_hash text unique;     -- sha256 of the device token; null until paired
alter table devices add column if not exists pair_code text unique;      -- 6 chars, e.g. "K7M4QX" (shown on-watch as 3+3)
alter table devices add column if not exists pair_secret_hash text;      -- sha256 of the watch's poll secret
alter table devices add column if not exists pair_expires_at timestamptz;
alter table devices add column if not exists revoked_at timestamptz;
alter table devices add column if not exists created_at timestamptz not null default now();
-- idx_devices_user (on user_id) already exists from 001_init.sql.

-- IP rate limiting for the unauthenticated pair-start action (10/hour).
-- Rows are cheap and short-lived; pair-start opportunistically deletes
-- anything older than a day.
create table if not exists pair_attempts (
  id uuid primary key default gen_random_uuid(),
  ip text not null,
  created_at timestamptz not null default now()
);
create index if not exists pair_attempts_ip_idx on pair_attempts (ip, created_at);
