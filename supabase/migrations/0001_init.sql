create extension if not exists pgcrypto;

create table if not exists public.emails (
  id uuid primary key,
  message_id text null,
  from_text text null,
  to_text text[] null,
  cc_text text[] null,
  bcc_text text[] null,
  subject text null,
  sent_at timestamptz null,
  body_text text null,
  body_html text null,
  attachments jsonb null,
  tsv tsvector null
);

create index if not exists emails_tsv_idx on public.emails using gin (tsv);
create index if not exists emails_sent_at_idx on public.emails (sent_at desc);
create index if not exists emails_from_idx on public.emails (from_text);

create or replace function public.emails_set_tsv()
returns trigger
language plpgsql
as $$
begin
  new.tsv :=
    to_tsvector(
      'simple',
      coalesce(new.subject, '') || ' ' ||
      coalesce(new.from_text, '') || ' ' ||
      coalesce(array_to_string(new.to_text, ' '), '') || ' ' ||
      coalesce(new.body_text, '')
    );
  return new;
end;
$$;

drop trigger if exists emails_set_tsv_trg on public.emails;
create trigger emails_set_tsv_trg
before insert or update of subject, from_text, to_text, body_text
on public.emails
for each row
execute function public.emails_set_tsv();

create table if not exists public.uploads (
  id uuid primary key,
  created_at timestamptz not null default now(),
  expected_total integer not null,
  processed integer not null default 0,
  errors integer not null default 0,
  status text not null default 'pending'
);

create table if not exists public.zip_progress (
  upload_id uuid not null references public.uploads(id) on delete cascade,
  storage_key text not null,
  processed_entries integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (upload_id, storage_key)
);

create or replace function public.search_emails(
  q text,
  p_from text default null,
  p_to text default null,
  p_subject text default null,
  p_after timestamptz default null,
  p_before timestamptz default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  from_text text,
  subject text,
  sent_at timestamptz,
  snippet text,
  rank real
)
language sql
stable
as $$
  select
    e.id,
    e.from_text,
    e.subject,
    e.sent_at,
    ts_headline(
      'simple',
      coalesce(e.body_text, ''),
      websearch_to_tsquery('simple', q),
      'MaxFragments=2,MaxWords=26,MinWords=8,ShortWord=3,FragmentDelimiter= … '
    ) as snippet,
    ts_rank_cd(e.tsv, websearch_to_tsquery('simple', q)) as rank
  from public.emails e
  where
    e.tsv @@ websearch_to_tsquery('simple', q)
    and (p_from is null or e.from_text ilike '%' || p_from || '%')
    and (p_subject is null or e.subject ilike '%' || p_subject || '%')
    and (p_to is null or array_to_string(e.to_text, ' ') ilike '%' || p_to || '%')
    and (p_after is null or e.sent_at >= p_after)
    and (p_before is null or e.sent_at < p_before)
  order by rank desc, e.sent_at desc nulls last
  limit p_limit
  offset p_offset;
$$;
