import { kindsOfWork } from "@/lib/kinds";

const steps = [
  {
    title: "Pick a career",
    body: "Anything from ER nurse to UX designer. Each week is built from real job data, boring parts included.",
  },
  {
    title: "Live the week",
    body: "Meetings, small real tasks, the routine and the pressure. Your choices change how people treat you.",
  },
  {
    title: "See what fit",
    body: "Your energy in each moment, set against what the job is actually made of. No single score: you decide.",
  },
];

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
      <section className="py-16 sm:py-24">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-soft">
          Career simulator
        </p>
        <h1 className="mt-4 max-w-3xl font-serif text-5xl leading-[1.05] tracking-tight text-balance sm:text-7xl">
          Live a week in a job before you choose it.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft text-pretty">
          Pick any career and play through a sped-up work week, with a boss, coworkers and
          clients who remember what you did. At the end, see what the job is really made
          of, and how it suited you.
        </p>
      </section>

      <section aria-labelledby="how" className="border-t border-line py-12">
        <h2 id="how" className="font-mono text-xs uppercase tracking-[0.18em] text-ink-soft">
          How it works
        </h2>
        <ol className="mt-6 grid gap-8 sm:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.title}>
              <span className="font-mono text-sm text-accent-ink">0{i + 1}</span>
              <h3 className="mt-2 font-serif text-2xl tracking-tight">{step.title}</h3>
              <p className="mt-2 leading-relaxed text-ink-soft">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="kinds" className="border-t border-line py-12">
        <h2 id="kinds" className="max-w-2xl font-serif text-3xl tracking-tight text-balance">
          Every job is a mix of six kinds of work.
        </h2>
        <p className="mt-3 max-w-2xl leading-relaxed text-ink-soft">
          Your report shows which ones gave you energy, next to how much of each the job
          really needs.
        </p>
        <dl className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {kindsOfWork.map((kind) => (
            <div key={kind.code} className="border-t border-line-strong pt-3">
              <dt className="font-medium">{kind.name}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-ink-soft">{kind.body}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
