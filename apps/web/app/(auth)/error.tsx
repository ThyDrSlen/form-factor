'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Auth Error]', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-8 max-w-md w-full">
        <h2 className="text-xl font-bold text-text-primary mb-2">Authentication Error</h2>
        <p className="text-sm text-text-secondary mb-6">
          Something went wrong during authentication.
        </p>
        {process.env.NODE_ENV === 'development' && (
          <pre className="bg-panel rounded-xl p-3 text-xs text-red-400 text-left overflow-auto mb-4 max-h-32">
            {error.message}
          </pre>
        )}
        <div className="flex gap-3 justify-center">
          <button
            type="button"
            onClick={reset}
            className="bg-accent text-white font-bold text-sm px-6 py-2.5 rounded-xl hover:bg-accent/90 transition-colors"
          >
            Try again
          </button>
          <Link
            href="/sign-in"
            className="bg-panel text-text-primary font-bold text-sm px-6 py-2.5 rounded-xl hover:bg-edge transition-colors"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
