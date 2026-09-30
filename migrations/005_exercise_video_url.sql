-- A curated demo-video link per exercise, shown on Preview/Run so members
-- can check their form. Nullable: most custom (on-the-fly) exercises won't
-- have one, and that's fine — the UI just omits the link.
alter table exercises add column if not exists video_url text;
