import Link from "next/link";
import { jobZoneLabels } from "@/lib/career-labels";
import { getCareerProfile } from "@/lib/careers";
import { featuredCareers } from "@/lib/featured";
import { kindName } from "@/lib/kinds";

export async function FeaturedCareers() {
  const profiles = await Promise.all(featuredCareers.map((c) => getCareerProfile(c.code)));
  return (
    <ul className="mt-4 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
      {featuredCareers.map((career, i) => {
        const profile = profiles[i];
        if (!profile) return null;
        return (
          <li key={career.code} className="bg-paper">
            <Link href={`/careers/${career.code}`} className="group block h-full p-5 hover:bg-paper-2">
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-ink-soft">
                Mostly {kindName(career.kind)}
              </p>
              <h3 className="mt-2 font-serif text-2xl tracking-tight group-hover:text-accent-ink">
                {career.name}
              </h3>
              <p className="mt-1 text-sm text-ink-soft">{jobZoneLabels[profile.jobZone]}</p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
