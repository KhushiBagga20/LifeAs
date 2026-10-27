import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export default function Home() {
  return <div className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
    <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-soft">LifeAs · a world you work in</p>
    <h1 className="mt-6 max-w-3xl font-serif text-5xl leading-[1.05] tracking-tight sm:text-7xl">Don’t just read<br />about the job.<br /><em className="text-accent-ink">Step into it.</em></h1>
    <p className="mt-8 max-w-xl text-lg leading-relaxed text-ink-soft">Be the character. Walk into the workplace. Use the tools, make something, and work alongside people with their own jobs to do.</p>
    <section className="mt-12 grid gap-8 rounded-xl border border-line-strong bg-paper-2 p-6 sm:grid-cols-[1fr_auto] sm:p-10" aria-labelledby="world-one">
      <div><p className="font-mono text-xs uppercase tracking-[0.15em] text-ink-soft">World 01 / playable prototype</p><h2 id="world-one" className="mt-3 font-serif text-3xl">Fieldwork Studio</h2><p className="mt-3 max-w-lg leading-relaxed text-ink-soft">Your first day as a graphic designer. A client brief, an empty page, a print deadline. Build the poster yourself and carry it from your desk to the client.</p><p className="mt-4 text-sm text-ink-soft">3D workplace · keyboard or click to move · three characters</p></div>
      <Link href="/play" className="flex h-fit items-center justify-center gap-4 self-end rounded-lg bg-accent px-6 py-4 font-medium text-on-accent">Enter the studio <ArrowUpRight size={18} /></Link>
    </section>
    <p className="mt-6 max-w-2xl text-sm leading-relaxed text-ink-soft">The studio works without a key using local character behaviours. Connect an AI provider to give each coworker independent decisions, conversation and memory. This first world is a prototype of the larger profession simulator.</p>
    <Link href="/careers" className="mt-10 inline-block text-sm text-ink-soft underline underline-offset-4">Browse the occupational data behind LifeAs →</Link>
  </div>;
}
