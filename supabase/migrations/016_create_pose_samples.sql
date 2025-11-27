-- Pose samples table for ML joint angle modeling
-- Stores time-series pose data captured during ARKit body tracking sessions

create table if not exists public.pose_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  session_id text not null,
  frame_timestamp double precision not null,
  exercise_mode text,
  phase text,
  rep_number integer,
  
  -- Core joint angles (degrees)
  left_elbow_deg numeric(6,2),
  right_elbow_deg numeric(6,2),
  left_shoulder_deg numeric(6,2),
  right_shoulder_deg numeric(6,2),
  left_knee_deg numeric(6,2),
  right_knee_deg numeric(6,2),
  left_hip_deg numeric(6,2),
  right_hip_deg numeric(6,2),
  
  -- Raw 3D positions for key joints (meters, JSONB for flexibility)
  joint_positions jsonb,
  
  -- Metadata
  fps_at_capture integer,
  created_at timestamptz not null default now()
);

-- Indexes for ML queries
create index if not exists pose_samples_session_idx on public.pose_samples(session_id);
create index if not exists pose_samples_user_session_idx on public.pose_samples(user_id, session_id);
create index if not exists pose_samples_exercise_idx on public.pose_samples(exercise_mode);
create index if not exists pose_samples_timestamp_idx on public.pose_samples(frame_timestamp);

-- Enable Row Level Security
alter table public.pose_samples enable row level security;

-- Policies: users manage their own rows
create policy "pose_samples read own" on public.pose_samples
  for select using (auth.uid() = user_id);
create policy "pose_samples insert own" on public.pose_samples
  for insert with check (auth.uid() = user_id);
