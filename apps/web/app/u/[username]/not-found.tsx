import Link from 'next/link';

export default function UserNotFound() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <p className="mb-4 text-5xl font-bold text-text-muted">404</p>
      <h1 className="mb-2 text-xl font-bold text-text-primary">User not found</h1>
      <p className="mb-8 text-text-secondary">
        This profile doesn&apos;t exist or may have been removed.
      </p>
      <Link
        href="/"
        className="rounded-xl bg-accent px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-accent/90"
      >
        Go home
      </Link>
    </div>
  );
}
