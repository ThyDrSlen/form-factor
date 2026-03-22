import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

interface PageProps {
  params: Promise<{ username: string }>;
}

type PublicProfilePageData = {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  is_private: boolean;
  created_at: string | null;
  workout_count: number | null;
  follower_count: number | null;
  following_count: number | null;
};

function isPublicProfilePageData(value: unknown): value is PublicProfilePageData {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.username === 'string' &&
    typeof candidate.is_private === 'boolean' &&
    (typeof candidate.created_at === 'string' || candidate.created_at === null)
  );
}

async function getPublicProfilePageData(username: string): Promise<PublicProfilePageData | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc('get_public_profile_page', { profile_username: username.toLowerCase() })
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data == null) {
    return null;
  }

  return isPublicProfilePageData(data) ? data : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { username } = await params;
  const profile = await getPublicProfilePageData(username);

  if (!profile) {
    return { title: 'User not found — Form Factor' };
  }

  if (profile.is_private) {
    return {
      title: `@${profile.username} — Form Factor`,
      description: 'This account is private.',
      openGraph: {
        title: `@${profile.username} — Form Factor`,
        description: 'This account is private.',
        type: 'profile',
      },
    };
  }

  const name = profile.display_name || profile.username;

  return {
    title: `${name} — Form Factor`,
    description: profile.bio || `${name}'s fitness profile on Form Factor`,
    openGraph: {
      title: `${name} — Form Factor`,
      description: profile.bio || `${name}'s fitness profile on Form Factor`,
      type: 'profile',
    },
  };
}

export default async function PublicProfilePage({ params }: PageProps) {
  const { username } = await params;
  const profile = await getPublicProfilePageData(username);

  if (!profile) {
    notFound();
  }

  if (profile.is_private) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Link
          href="/"
          className="mb-8 inline-block text-sm text-text-secondary transition-colors hover:text-text-primary"
        >
          &larr; Home
        </Link>
        <div className="rounded-2xl border border-line bg-card p-8 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full border border-line bg-panel text-3xl font-bold text-accent">
            {profile.username.charAt(0).toUpperCase()}
          </div>
          <h1 className="text-xl font-bold text-text-primary">@{profile.username}</h1>
          <p className="mt-4 text-text-secondary">This account is private.</p>
        </div>
      </div>
    );
  }

  if (!profile.created_at) {
    notFound();
  }

  const displayName = profile.display_name || profile.username;
  const memberSince = new Date(profile.created_at).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  const workoutCount = Number(profile.workout_count ?? 0);
  const followerCount = Number(profile.follower_count ?? 0);
  const followingCount = Number(profile.following_count ?? 0);

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <Link
        href="/"
        className="mb-8 inline-block text-sm text-text-secondary transition-colors hover:text-text-primary"
      >
        &larr; Home
      </Link>

      <div className="rounded-2xl border border-line bg-card p-6">
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-full border border-line bg-panel text-3xl font-bold text-accent">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">{displayName}</h1>
            <p className="text-sm text-text-muted">@{profile.username}</p>
            {profile.bio && <p className="mt-1 text-sm text-text-secondary">{profile.bio}</p>}
          </div>
        </div>

        <div className="mb-6 grid grid-cols-3 gap-4">
          <div className="rounded-xl bg-panel p-4 text-center">
            <span className="text-2xl font-bold text-text-primary">{workoutCount}</span>
            <span className="mt-1 block text-xs text-text-muted">Workouts</span>
          </div>
          <div className="rounded-xl bg-panel p-4 text-center">
            <span className="text-2xl font-bold text-text-primary">{followerCount}</span>
            <span className="mt-1 block text-xs text-text-muted">Followers</span>
          </div>
          <div className="rounded-xl bg-panel p-4 text-center">
            <span className="text-2xl font-bold text-text-primary">{followingCount}</span>
            <span className="mt-1 block text-xs text-text-muted">Following</span>
          </div>
        </div>

        <div className="border-t border-line pt-4 text-sm">
          <div className="flex justify-between py-2">
            <span className="text-text-secondary">Member since</span>
            <span className="text-text-primary">{memberSince}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
