import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "LifeAs — live a week in a job before you choose it",
    template: "%s · LifeAs",
  },
  description:
    "A career simulator. Play a sped-up work week in any job, with AI coworkers who remember what you did, then see what the job is really made of.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <header className="border-b border-line">
          <div className="mx-auto flex h-14 w-full max-w-5xl items-center px-4 sm:px-6">
            <Link href="/" className="font-serif text-xl tracking-tight">
              Life<em className="text-accent-ink">As</em>
            </Link>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line">
          <p className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-ink-soft sm:px-6">
            A preview of what the work feels like. Not career advice, and not a test of
            whether you&rsquo;d be good at it.
          </p>
        </footer>
      </body>
    </html>
  );
}
