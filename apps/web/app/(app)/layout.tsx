import { Nav } from '@/components/layout/nav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </>
  );
}
