-- Every "today" and week boundary is computed in the member's own
-- timezone (captured client-side at signup/login), not the server's.
alter table users add column if not exists timezone text not null default 'UTC';
