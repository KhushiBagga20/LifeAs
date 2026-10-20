import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FeaturedCareers } from "@/components/featured-careers";
import { OnetCredit } from "@/components/onet-credit";
import { SearchForm } from "@/components/search-form";
import { jobZoneLabels, shortTitle } from "@/lib/career-labels";
import { findCareers } from "@/lib/careers";
import { kindName } from "@/lib/kinds";

export const metadata: Metadata = { title: "Find a career" };

export default function CareersPage({ searchParams }: PageProps<"/careers">) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="font-serif text-4xl tracking-tight sm:text-5xl">Find a career</h1>
      <Suspense fallback={<SearchForm />}>
        <Results searchParams={searchParams} />
      </Suspense>
      <OnetCredit className="mt-16 max-w-3xl border-t border-line pt-6" />
    </div>
  );
}

async function Results({ searchParams }: Pick<PageProps<"/careers">, "searchParams">) {
  const { q } = await searchParams;
  const query = (typeof q === "string" ? q : "").trim().slice(0, 100);
  const matches = query ? await findCareers(query) : [];

  return (
    <>
      <div className="mt-8">
        <SearchForm defaultValue={query} label="Search about 900 careers" />
      </div>

      {!query && (
        <section className="mt-12">
          <h2 className="text-sm font-medium text-ink-soft">Or start with one of these</h2>
          <FeaturedCareers />
        </section>
      )}

      {query && matches.length === 0 && (
        <section className="mt-12 max-w-2xl" aria-live="polite">
          <h2 className="font-serif text-2xl tracking-tight">No careers match “{query}”</h2>
          <p className="mt-3 leading-relaxed text-ink-soft">
            Try the everyday name of the job (“chef” rather than “culinary artist”), or a broader
            one (“designer”, “engineer”). Very new jobs may not be in the database yet.
          </p>
          <h3 className="mt-10 text-sm font-medium text-ink-soft">Or start with one of these</h3>
          <FeaturedCareers />
        </section>
      )}

      {matches.length > 0 && (
        <section className="mt-10" aria-live="polite">
          <h2 className="text-sm text-ink-soft">
            {matches.length === 20 ? "Top 20 matches" : `${matches.length} ${matches.length === 1 ? "match" : "matches"}`}{" "}
            for “{query}”
          </h2>
          <ol className="mt-4 divide-y divide-line border-y border-line">
            {matches.map((m) => (
              <li key={m.code}>
                <Link href={`/careers/${m.code}`} className="group block py-5 sm:py-6">
                  <h3 className="font-serif text-xl tracking-tight group-hover:text-accent-ink sm:text-2xl">
                    {m.title}
                  </h3>
                  {m.matchedTitle && <p className="mt-1 text-sm text-ink-soft">Matched “{shortTitle(m.matchedTitle)}”</p>}
                  <p className="mt-2 line-clamp-2 max-w-3xl leading-relaxed text-ink-soft">{m.description}</p>
                  <p className="mt-3 font-mono text-xs text-ink-soft">
                    {m.highPoint ? `Mostly ${kindName(m.highPoint)} · ` : ""}
                    {jobZoneLabels[m.jobZone]}
                  </p>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
