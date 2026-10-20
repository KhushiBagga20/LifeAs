import Link from "next/link";
import { SearchForm } from "@/components/search-form";

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-soft">Not found</p>
      <h1 className="mt-4 max-w-2xl font-serif text-4xl leading-tight tracking-tight text-balance sm:text-5xl">
        There’s no page here.
      </h1>
      <p className="mt-4 max-w-xl leading-relaxed text-ink-soft">
        The link may be old, or the career may not be in this version of the job data. Try
        searching for it instead.
      </p>
      <div className="mt-10">
        <SearchForm />
      </div>
      <p className="mt-10 text-sm">
        <Link href="/" className="underline decoration-line-strong underline-offset-2 hover:decoration-ink">
          Back to the home page
        </Link>
      </p>
    </div>
  );
}
