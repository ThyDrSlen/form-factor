import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { formatDate } from '@/lib/utils';
import { updateProfile } from '@/lib/actions';

export default async function ProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/sign-in');

  const { data: profile } = await supabase
    .from('profiles')
    .select('user_id, username, display_name, avatar_url, bio, is_private, created_at')
    .eq('user_id', user.id)
    .maybeSingle();

  const [followersResult, followingResult] = await Promise.all([
    supabase
      .from('follows')
      .select('follower_id', { count: 'exact', head: true })
      .eq('following_id', user.id)
      .eq('status', 'accepted'),
    supabase
      .from('follows')
      .select('following_id', { count: 'exact', head: true })
      .eq('follower_id', user.id)
      .eq('status', 'accepted'),
  ]);

  const { count: workoutCount } = await supabase
    .from('workout_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  const displayName = profile?.display_name || profile?.username || user.email?.split('@')[0] || 'User';

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Profile</h1>

      <div className="bg-card border border-line rounded-2xl p-6 mb-4">
        {/* Avatar + Name */}
        <div className="flex items-center gap-4 mb-6">
          <div className="h-16 w-16 rounded-full bg-panel border border-line flex items-center justify-center text-2xl font-bold text-accent">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-xl font-bold text-text-primary">{displayName}</h2>
            {profile?.username && (
              <p className="text-sm text-text-muted">@{profile.username}</p>
            )}
            {profile?.bio && (
              <p className="text-sm text-text-secondary mt-1">{profile.bio}</p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-panel rounded-xl p-4 text-center">
            <span className="text-2xl font-bold text-text-primary">{workoutCount ?? 0}</span>
            <span className="text-xs text-text-muted block mt-1">Workouts</span>
          </div>
          <div className="bg-panel rounded-xl p-4 text-center">
            <span className="text-2xl font-bold text-text-primary">{followersResult.count ?? 0}</span>
            <span className="text-xs text-text-muted block mt-1">Followers</span>
          </div>
          <div className="bg-panel rounded-xl p-4 text-center">
            <span className="text-2xl font-bold text-text-primary">{followingResult.count ?? 0}</span>
            <span className="text-xs text-text-muted block mt-1">Following</span>
          </div>
        </div>

        {/* Details */}
        <div className="space-y-3 text-sm">
          <div className="flex justify-between py-2 border-b border-line">
            <span className="text-text-secondary">Email</span>
            <span className="text-text-primary">{user.email}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-line">
            <span className="text-text-secondary">Account visibility</span>
            <span className="text-text-primary">{profile?.is_private ? 'Private' : 'Public'}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-text-secondary">Member since</span>
            <span className="text-text-primary">
              {profile?.created_at ? formatDate(profile.created_at) : formatDate(user.created_at)}
            </span>
          </div>
        </div>
      </div>

      {/* Edit Profile */}
      <div className="bg-card border border-line rounded-2xl p-6">
        <h3 className="font-bold text-text-primary mb-4">Edit Profile</h3>
        <form action={updateProfile} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-text-secondary mb-1.5">
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              defaultValue={profile?.username ?? ''}
              className="w-full bg-panel border border-line rounded-xl px-4 py-3 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors"
              placeholder="username"
            />
          </div>

          <div>
            <label htmlFor="display_name" className="block text-sm font-medium text-text-secondary mb-1.5">
              Display Name
            </label>
            <input
              id="display_name"
              name="display_name"
              type="text"
              defaultValue={profile?.display_name ?? ''}
              className="w-full bg-panel border border-line rounded-xl px-4 py-3 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors"
              placeholder="Your display name"
            />
          </div>

          <div>
            <label htmlFor="bio" className="block text-sm font-medium text-text-secondary mb-1.5">
              Bio
            </label>
            <textarea
              id="bio"
              name="bio"
              rows={3}
              defaultValue={profile?.bio ?? ''}
              className="w-full bg-panel border border-line rounded-xl px-4 py-3 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors resize-none"
              placeholder="Tell us about yourself"
            />
          </div>

          <button
            type="submit"
            className="bg-accent text-white font-bold text-sm px-6 py-2.5 rounded-xl hover:bg-accent/90 transition-colors"
          >
            Save Changes
          </button>
        </form>
      </div>
    </div>
  );
}
