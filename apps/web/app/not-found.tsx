import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 text-center">
      <p className="text-6xl font-bold text-text-muted mb-4">404</p>
      <h1 className="text-2xl font-bold text-text-primary mb-2">Page not found</h1>
      <p className="text-text-secondary mb-8 max-w-md">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Link
        href="/"
        className="bg-accent text-white font-bold text-sm px-6 py-2.5 rounded-xl hover:bg-accent/90 transition-colors"
      >
        Go home
      </Link>
    </div>
  );
}
