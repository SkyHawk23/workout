-- The Daily Lift — Phase 1 schema: family accounts, AI trainer, programs.
create extension if not exists pgcrypto;

create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  email text not null unique,
  password_hash text not null,
  display_name text not null,
  birth_year int,
  prefs jsonb not null default '{"view": "exercise", "rest": "manual", "secs": 90}',
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_users_household on users(household_id);

create table if not exists household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  code text not null unique,
  created_by uuid not null references users(id),
  expires_at timestamptz not null,
  used_by uuid references users(id)
);
create index if not exists idx_invites_household on household_invites(household_id);

create table if not exists trainer_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  goals jsonb not null default '[]',
  experience text,
  equipment jsonb not null default '{}',
  schedule jsonb not null default '{}', -- {days_per_week, session_minutes, preferred_days:[...]}
  limitations text default '',
  working_weights jsonb not null default '{}', -- {exercise_id: lb}
  trainer_notes text not null default '',
  tokens_used_month int not null default 0,
  tokens_month text, -- 'YYYY-MM', reset boundary for the monthly cap
  updated_at timestamptz not null default now()
);

create table if not exists exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  equipment text,
  is_bodyweight boolean not null default false,
  custom boolean not null default false,
  created_by uuid references users(id)
);

create table if not exists programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  start_date date not null,
  weeks int not null,
  status text not null check (status in ('active', 'completed', 'archived')),
  source text not null default 'ai',
  created_at timestamptz not null default now()
);
create index if not exists idx_programs_user on programs(user_id);

create table if not exists planned_sessions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references programs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  date date,
  title text not null,
  note text default '',
  exercises jsonb not null default '[]', -- [{exercise_id, name, cue, rest_s, sets:[{reps_min, reps_max, weight, rpe_target}]}]
  status text not null default 'planned' check (status in ('planned', 'done', 'skipped')),
  kind text not null default 'program', -- 'program' | 'quick'
  is_calibration boolean not null default false, -- week 1, no known working weight: RPE-driven
  revision int not null default 1,
  updated_at timestamptz not null default now()
);
create index if not exists idx_planned_sessions_user_date on planned_sessions(user_id, date);
create index if not exists idx_planned_sessions_program on planned_sessions(program_id);

create table if not exists session_changes (
  id uuid primary key default gen_random_uuid(),
  planned_session_id uuid not null references planned_sessions(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  reason text not null,
  before jsonb not null,
  after jsonb not null,
  created_at timestamptz not null default now(),
  undone boolean not null default false
);
create index if not exists idx_session_changes_session on session_changes(planned_session_id);
create index if not exists idx_session_changes_user on session_changes(user_id, created_at);

create table if not exists session_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique,
  user_id uuid not null references users(id) on delete cascade,
  planned_session_id uuid references planned_sessions(id) on delete set null,
  source text not null default 'web', -- 'web' | 'watch' (phase 2)
  started_at timestamptz not null,
  ended_at timestamptz,
  avg_hr int,
  max_hr int,
  calories int,
  notes text
);
create index if not exists idx_session_logs_user on session_logs(user_id, started_at);

create table if not exists set_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique,
  session_log_id uuid not null references session_logs(id) on delete cascade,
  exercise_id uuid not null references exercises(id),
  set_index int not null,
  reps int not null,
  weight numeric,
  rpe numeric,
  completed_at timestamptz not null default now()
);
create index if not exists idx_set_logs_session on set_logs(session_log_id);
create index if not exists idx_set_logs_exercise on set_logs(exercise_id);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')), -- Anthropic Messages API roles; tool_use/tool_result live inside content blocks
  content jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_messages_user on chat_messages(user_id, created_at);

-- Phase 2 (Garmin) reference — not built yet, but the table is cheap to add
-- now so session_logs.source='watch' has somewhere to point.
create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null default 'garmin',
  paired_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create index if not exists idx_devices_user on devices(user_id);
