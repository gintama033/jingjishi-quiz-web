create table if not exists public.questions (
  id text primary key,
  bank_id text not null,
  subject text not null,
  source text not null,
  chapter text,
  point text,
  type text not null check (type in ('single', 'multiple')),
  stem text not null,
  options jsonb not null,
  answer jsonb not null,
  analysis text not null default ''
);

create table if not exists public.practice_sessions (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  session_id uuid not null default gen_random_uuid(),
  subject text not null,
  mode text not null check (mode in ('chapter', 'mixed', 'mock', 'past-paper')),
  question_ids text[] not null default '{}',
  current_index integer not null default 0 check (current_index >= 0),
  answers jsonb not null default '{}'::jsonb,
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, subject, mode)
);

create table if not exists public.practice_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  session_id uuid not null,
  question_id text not null references public.questions(id) on delete restrict,
  subject text not null,
  mode text not null check (mode in ('chapter', 'mixed', 'mock', 'past-paper')),
  selected_answer jsonb not null,
  is_correct boolean not null,
  answered_at timestamptz not null default now(),
  unique (user_id, session_id, question_id)
);

create index if not exists questions_bank_id_idx on public.questions (bank_id, id);
create index if not exists practice_attempts_user_date_idx on public.practice_attempts (user_id, answered_at desc);

alter table public.questions enable row level security;
alter table public.practice_sessions enable row level security;
alter table public.practice_attempts enable row level security;

grant select on public.questions to authenticated;
grant select, insert, update, delete on public.practice_sessions to authenticated;
grant select, insert on public.practice_attempts to authenticated;

drop policy if exists questions_read_authenticated on public.questions;
create policy questions_read_authenticated on public.questions
  for select to authenticated using (true);

drop policy if exists sessions_own_rows on public.practice_sessions;
create policy sessions_own_rows on public.practice_sessions
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists attempts_read_own on public.practice_attempts;
create policy attempts_read_own on public.practice_attempts
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists attempts_insert_own on public.practice_attempts;
create policy attempts_insert_own on public.practice_attempts
  for insert to authenticated with check (auth.uid() = user_id);
