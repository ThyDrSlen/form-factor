'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { signOut } from '@/lib/actions';

const navItems = [
  { href: '/workouts', label: 'Workouts' },
  { href: '/food', label: 'Food' },
  { href: '/coach', label: 'Coach' },
  { href: '/profile', label: 'Profile' },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-line bg-card/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="mx-auto max-w-5xl flex items-center justify-between px-6 h-14">
        <Link href="/workouts" className="text-lg font-bold text-text-primary">
          Form Factor
        </Link>

        <div className="flex items-center gap-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                pathname === item.href
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-secondary hover:text-text-primary hover:bg-panel'
              )}
            >
              {item.label}
            </Link>
          ))}
          <form action={signOut}>
            <button
              type="submit"
              className="px-3 py-1.5 text-sm text-text-secondary hover:text-red-400 transition-colors"
            >
              Sign Out
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}
