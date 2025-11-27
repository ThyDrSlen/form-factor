-- Observability for audio cues and session metrics

create table if not exists public.cue_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  session_id text not null,
  cue text not null,
  mode text,
  phase text,
  rep_count integer,
  reason text,
  throttled boolean default false,
  dropped boolean default false,
  latency_ms numeric,
  created_at timestamptz not null default now()
);

create index if not exists cue_events_user_id_idx on public.cue_events(user_id);
create index if not exists cue_events_session_idx on public.cue_events(session_id);

create table if not exists public.session_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  session_id text not null,
  start_at timestamptz default now(),
  end_at timestamptz,
  avg_fps numeric,
  min_fps numeric,
  avg_latency_ms numeric,
  cues_total integer,
  cues_spoken integer,
  cues_dropped_repeat integer,
  cues_dropped_disabled integer,
  created_at timestamptz not null default now()
);

create unique index if not exists session_metrics_session_idx on public.session_metrics(session_id);

alter table public.cue_events enable row level security;
alter table public.session_metrics enable row level security;

-- Policies: users manage their own rows
create policy "cue_events read own" on public.cue_events
  for select using (auth.uid() = user_id);
create policy "cue_events insert own" on public.cue_events
  for insert with check (auth.uid() = user_id);

create policy "session_metrics read own" on public.session_metrics
  for select using (auth.uid() = user_id);
create policy "session_metrics insert own" on public.session_metrics
  for insert with check (auth.uid() = user_id);
create policy "session_metrics update own" on public.session_metrics
  for update using (auth.uid() = user_id);
