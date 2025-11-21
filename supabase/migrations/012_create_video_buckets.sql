-- Buckets for workout videos and thumbnails

-- Create buckets if they do not exist
insert into storage.buckets (id, name, public)
values ('videos', 'videos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('video-thumbnails', 'video-thumbnails', true)
on conflict (id) do nothing;

-- Policies for private video bucket
create policy "videos bucket - owners can upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'videos' and owner = auth.uid());

create policy "videos bucket - owners can read" on storage.objects
  for select to authenticated
  using (bucket_id = 'videos' and owner = auth.uid());

create policy "videos bucket - owners can delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'videos' and owner = auth.uid());

-- Policies for thumbnail bucket (public reads, authed writes)
create policy "video-thumbnails bucket - anyone can read" on storage.objects
  for select to public
  using (bucket_id = 'video-thumbnails');

create policy "video-thumbnails bucket - owners can upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'video-thumbnails' and owner = auth.uid());

create policy "video-thumbnails bucket - owners can delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'video-thumbnails' and owner = auth.uid());
