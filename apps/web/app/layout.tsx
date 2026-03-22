import type { Metadata } from 'next';
import { Lexend } from 'next/font/google';
import './globals.css';

const lexend = Lexend({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'Form Factor — Real-time Form Coaching',
  description:
    'Real-time form coaching from your phone camera. Form Factor counts reps, flags faults, and logs sets automatically.',
  openGraph: {
    title: 'Form Factor',
    description: 'Real-time form coaching from your phone camera.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${lexend.variable} dark`}>
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
