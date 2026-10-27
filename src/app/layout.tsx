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
    default: "LifeAs — step into the job",
    template: "%s · LifeAs",
  },
  description:
    "A playable profession simulator. Explore a 3D workplace, use its tools, and work alongside characters with their own goals.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <header className="border-b border-line">
          <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
            <Link href="/" className="font-serif text-xl tracking-tight">
              Life<em className="text-accent-ink">As</em>
            </Link>
            <nav aria-label="Main" className="flex gap-5 text-sm">
              <Link href="/careers" className="text-ink-soft hover:text-ink">
                Find a career
              </Link>
              <Link href="/about" className="text-ink-soft hover:text-ink">
                About
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-6 text-sm text-ink-soft sm:flex-row sm:justify-between sm:gap-6 sm:px-6">
            <p>
              A preview of what the work feels like. Not career advice, and not a test of
              whether you&rsquo;d be good at it.
            </p>
            <p className="shrink-0">
              Job data:{" "}
              <Link href="/about" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
                O*NET® database
              </Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
