import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { KindsChart } from "@/components/kinds-chart";
import { OnetCredit } from "@/components/onet-credit";
import { contextGroups, jobZoneLabels, shortTitle } from "@/lib/career-labels";
import { getCareerProfile, getOnetMeta } from "@/lib/careers";
import { featuredCareers } from "@/lib/featured";
import { kindName } from "@/lib/kinds";

const TOP_TASKS = 8;

export function generateStaticParams() {
  return featuredCareers.map((c) => ({ code: c.code }));
}

export async function generateMetadata({ params }: PageProps<"/careers/[code]">): Promise<Metadata> {
  const profile = await getCareerProfile(decodeURIComponent((await params).code));
  return profile
    ? { title: profile.title, description: profile.description }
    : { title: "Career not found" };
}

export default function CareerPage({ params }: PageProps<"/careers/[code]">) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
      <Suspense fallback={<CareerSkeleton />}>
        <Career params={params} />
      </Suspense>
    </div>
  );
}

async function Career({ params }: Pick<PageProps<"/careers/[code]">, "params">) {
  const code = decodeURIComponent((await params).code);
  const [profile, meta] = await Promise.all([getCareerProfile(code), getOnetMeta()]);
  if (!profile) notFound();

  const tasks = profile.tasks.slice(0, TOP_TASKS);
  const rated = tasks.some((t) => t.frequency != null);
  const context = new Map(profile.context.map((c) => [c.id, c]));
  const zone = meta.jobZones[String(profile.jobZone)];

  return (
    <article className="py-12 sm:py-16">
      <header className="max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-soft">
          {profile.highPoints.length ? `Mostly ${kindName(profile.highPoints[0])}` : "Career"}
        </p>
        <h1 className="mt-3 font-serif text-4xl leading-tight tracking-tight text-balance sm:text-6xl">
          {profile.title}
        </h1>
        {profile.commonTitles.length > 0 && (
          <p className="mt-3 text-ink-soft">Also called {profile.commonTitles.slice(0, 4).map(shortTitle).join(", ")}</p>
        )}
        <p className="mt-6 text-lg leading-relaxed">{profile.description}</p>
      {code === "27-1024.00" && <div className="mt-6"><Link href="/play" className="inline-block rounded-lg bg-accent px-5 py-3 font-medium text-on-accent">Enter the 3D design studio →</Link><p className="mt-2 text-sm text-ink-soft">Playable 3D prototype · walk, design, review and print</p></div>}
      </header>

      <Section title="Interest emphasis in this career">
        <p className="mb-6 max-w-2xl leading-relaxed text-ink-soft">
          Relative emphasis across six O*NET® interest areas, calculated by normalising the
          ratings above their minimum. These percentages do not measure working time.
        </p>
        <KindsChart kinds={profile.kinds} />
      </Section>

      <Section title="The most important tasks">
        <ol className="max-w-3xl divide-y divide-line border-y border-line">
          {tasks.map((task) => (
            <li key={task.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-6">
              <span className="flex-1 leading-relaxed">{task.text}</span>
              {task.frequency != null && (
                <span className="shrink-0 font-mono text-xs text-ink-soft sm:w-40 sm:text-right">
                  {meta.taskFrequency[String(Math.round(task.frequency))]}
                </span>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-ink-soft">
          {rated
            ? `How often workers do each one, on average. ${profile.tasks.length} tasks in total.`
            : "The O*NET database doesn’t rate how important or frequent these tasks are yet."}
        </p>
      </Section>

      <Section title="What the days are like">
        {profile.context.length === 0 ? (
          <p className="max-w-2xl text-ink-soft">
            The O*NET database doesn’t have working-conditions data for this job yet.
          </p>
        ) : (
          <>
            <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
              {contextGroups.map((group) => (
                <div key={group.title}>
                  <h3 className="font-mono text-xs uppercase tracking-[0.18em] text-ink-soft">{group.title}</h3>
                  <dl className="mt-3 divide-y divide-line border-y border-line">
                    {group.items.map((item) => {
                      const c = context.get(item.id);
                      if (!c) return null;
                      const answer = meta.context[item.id]?.categories[String(c.modal.category)];
                      return (
                        <div key={item.id} className="flex items-baseline justify-between gap-4 py-2.5">
                          <dt className="text-sm">{item.label}</dt>
                          <dd className="text-right text-sm">
                            {answer}
                            <span className="ml-2 tabular-nums text-ink-soft">{Math.round(c.modal.percent)}%</span>
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm text-ink-soft">
              The most common answer from workers in this job, and the share who gave it.
            </p>
          </>
        )}
      </Section>

      <Section title="Getting there">
        <div className="max-w-2xl">
          <p className="font-medium">{jobZoneLabels[profile.jobZone]}</p>
          {zone && (
            <>
              <p className="mt-2 leading-relaxed text-ink-soft">{zone.education}</p>
              <p className="mt-2 leading-relaxed text-ink-soft">{zone.training}</p>
            </>
          )}
          <p className="mt-3 text-sm text-ink-soft">
            Based on US training paths. Requirements differ by country.
          </p>
        </div>
      </Section>

      {profile.related.length > 0 && (
        <Section title="Related careers">
          <ul className="flex flex-wrap gap-2">
            {profile.related.map((r) => (
              <li key={r.code}>
                <Link
                  href={`/careers/${r.code}`}
                  className="inline-block rounded-full border border-line-strong px-3 py-1.5 text-sm hover:bg-paper-2"
                >
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <OnetCredit className="mt-16 max-w-3xl border-t border-line pt-6" />
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-14 border-t border-line pt-8">
      <h2 className="mb-6 font-serif text-2xl tracking-tight sm:text-3xl">{title}</h2>
      {children}
    </section>
  );
}

function CareerSkeleton() {
  return (
    <div aria-hidden className="animate-pulse py-12 sm:py-16">
      <div className="h-3 w-32 rounded bg-paper-3" />
      <div className="mt-4 h-12 w-3/4 rounded bg-paper-3 sm:h-16" />
      <div className="mt-8 h-4 w-full max-w-3xl rounded bg-paper-2" />
      <div className="mt-2 h-4 w-5/6 max-w-3xl rounded bg-paper-2" />
      <div className="mt-14 h-px w-full bg-line" />
      <div className="mt-8 h-7 w-64 rounded bg-paper-3" />
      <div className="mt-6 space-y-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-5 rounded bg-paper-2" style={{ width: `${40 + ((i * 17) % 50)}%` }} />
        ))}
      </div>
    </div>
  );
}
