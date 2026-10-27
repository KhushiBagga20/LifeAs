import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-20 sm:px-6">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber">Wrong door</p>
      <h1 className="mt-4 font-display text-4xl font-bold tracking-tight sm:text-5xl">Nobody lives here.</h1>
      <p className="mt-4 max-w-xl leading-relaxed text-soft">
        The link may be old, or the room has closed. Head back to the street and start or join a game.
      </p>
      <Link href="/" className="mt-8 inline-block rounded-lg bg-amber px-5 py-3 font-medium text-on-amber hover:opacity-90">
        Back to Block C
      </Link>
    </main>
  );
}
