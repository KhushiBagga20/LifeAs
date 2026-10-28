import { LiveDemo } from "@/components/LiveDemo";
import { roleIds, roles, type Team } from "@/game/roles";

const steps = [
  { title: "Night", body: "Everyone goes inside. The crew picks a target. The Medic protects someone. The Undercover checks a neighbour." },
  { title: "Dawn", body: "The block wakes up to the news. Someone might be gone, and their role comes out." },
  { title: "Day", body: "The group chat lights up. Accuse, defend, bluff, point at whoever's been too quiet." },
  { title: "Vote", body: "Everyone votes, in public. Most votes leaves the block, unless the block skips." },
];

const teamStyle: Record<Team, { label: string; className: string }> = {
  block: { label: "Block", className: "text-block border-block" },
  crew: { label: "Crew", className: "text-crew border-crew" },
  solo: { label: "Solo", className: "text-amber border-amber" },
};

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 sm:px-6">
      <header className="flex h-16 items-center justify-between">
        <span className="font-display text-lg font-bold tracking-tight">
          BLOCK <span className="text-amber">C</span>
        </span>
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-soft">5–12 players · online</span>
      </header>

      <section className="grid items-center gap-10 py-10 sm:py-16 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber">A game of lies, neighbours and night shifts</p>
          <h1 className="mt-4 font-display text-5xl font-bold leading-[1.02] tracking-tight text-balance sm:text-7xl">
            Someone in Block C runs with a crew.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-soft text-pretty">
            Find them before they run the block. Play online with friends; AI neighbours fill the empty
            seats with their own personalities, hunches and lies, and an AI narrator tells the story of
            every night.
          </p>
        </div>
        <LiveDemo />
      </section>

      <section aria-labelledby="round" className="border-t border-line py-12">
        <h2 id="round" className="font-mono text-xs uppercase tracking-[0.2em] text-soft">
          How a round goes
        </h2>
        <ol className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => (
            <li key={step.title} className="rounded-xl border border-line bg-surface p-5">
              <span className="font-mono text-sm text-amber">0{i + 1}</span>
              <h3 className="mt-2 font-display text-2xl font-semibold tracking-tight">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-soft">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="roles" className="border-t border-line py-12">
        <h2 id="roles" className="font-display text-3xl font-semibold tracking-tight">
          Who&rsquo;s in the building
        </h2>
        <p className="mt-2 max-w-2xl leading-relaxed text-soft">
          Your role is secret. The crew know each other; everyone else has to work it out.
        </p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roleIds.map((id) => {
            const role = roles[id];
            const team = teamStyle[role.team];
            return (
              <li key={id} className="rounded-xl border border-line bg-surface p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-xl font-semibold">{role.name}</h3>
                  <span className={`rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${team.className}`}>
                    {team.label}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed">{role.blurb}</p>
                <p className="mt-3 text-sm leading-relaxed text-soft">
                  {role.night ? `At night: ${role.night}` : "No night action."} {role.goal}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      <footer className="border-t border-line py-8 text-sm text-soft">
        A work of fiction. Every neighbour is made up, and the AI ones are generated.
      </footer>
    </main>
  );
}
