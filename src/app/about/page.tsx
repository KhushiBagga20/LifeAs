import type { Metadata } from "next";
import { OnetCredit } from "@/components/onet-credit";
import { getOnetMeta } from "@/lib/careers";

export const metadata: Metadata = { title: "About and sources" };

export default async function AboutPage() {
  const meta = await getOnetMeta();
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="font-serif text-4xl tracking-tight sm:text-5xl">About and sources</h1>

      <section className="mt-10 space-y-4 text-lg leading-relaxed">
        <p>
          LifeAs lets you try a career before you choose it: a sped-up work week with coworkers who
          remember what you did, followed by an honest look at what the job is made of and how it
          suited you.
        </p>
        <p className="text-ink-soft">
          It’s a preview of what the work feels like. It isn’t career advice, and it isn’t a test
          of whether you’d be good at a job.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-8">
        <h2 className="font-serif text-2xl tracking-tight">Where the job data comes from</h2>
        <div className="mt-4 space-y-4 leading-relaxed text-ink-soft">
          <p>
            Every career is built from the O*NET® {meta.version} database ({meta.release}), the US
            Department of Labor’s survey-based database of occupations. It records what workers in
            each job actually do, how often, under what conditions, and how much preparation it
            takes.
          </p>
          <p>
            LifeAs uses {meta.occupations} occupations that have task and interest data. We trim the
            data and turn the interest ratings into relative interest shares (not percentages of working time). We take the
            most common answer for each working condition, and we write our own plain labels for
            the conditions and preparation levels.
          </p>
          <p>
            The data is from the US. Tasks and working conditions mostly travel well; pay, licences
            and training paths differ between countries, so LifeAs doesn’t show them yet.
          </p>
        </div>
      </section>

      <OnetCredit className="mt-12 border-t border-line pt-6" />
    </div>
  );
}
