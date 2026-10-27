import { kindsOfWork } from "@/lib/kinds";
import type { CareerProfile } from "@/lib/onet/types";

const percent = (share: number) => `${Math.round(share * 100)}%`;

// One series, so one colour; kinds keep the same order on every career so pages compare.
// Values are labelled at the bar tips; hover or focus adds the raw O*NET® score, and the
// table below carries every value without hovering.
export function KindsChart({ kinds }: { kinds: CareerProfile["kinds"] }) {
  const max = Math.max(...kindsOfWork.map((k) => kinds[k.code].share));
  const domain = Math.max(0.5, Math.ceil(max * 10) / 10);
  const ticks = [0, domain / 2, domain];

  return (
    <figure className="max-w-2xl">
      <div className="relative">
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-28 right-12 sm:left-32">
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute inset-y-0 w-px bg-line"
              style={{ left: `${(t / domain) * 100}%` }}
            />
          ))}
        </div>
        <ul className="relative space-y-1">
          {kindsOfWork.map((kind) => {
            const { share, score } = kinds[kind.code];
            return (
              <li key={kind.code} className="grid grid-cols-[7rem_1fr] items-center sm:grid-cols-[8rem_1fr]">
                <span className="text-sm">{kind.name}</span>
                <div
                  tabIndex={0}
                  aria-label={`${kind.name}: ${percent(share)}, O*NET interest score ${score} of 7`}
                  className="group relative flex h-9 items-center rounded-sm pr-12 outline-offset-2"
                >
                  <div className="relative h-full flex-1">
                    <div
                      className="absolute left-0 top-1/2 h-4 -translate-y-1/2 rounded-r-[4px] bg-series-1 transition-[filter] group-hover:brightness-110 group-focus-visible:brightness-110"
                      style={{ width: `${(share / domain) * 100}%` }}
                    />
                    <span
                      className="absolute top-1/2 ml-1 -translate-y-1/2 bg-paper px-1 text-sm tabular-nums text-ink-soft"
                      style={{ left: `${(share / domain) * 100}%` }}
                    >
                      {percent(share)}
                    </span>
                  </div>
                  <div
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full left-0 z-10 mb-1 rounded-md border border-line bg-paper-3 px-3 py-2 text-sm opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                  >
                    <span className="font-semibold tabular-nums">{percent(share)}</span>
                    <span className="text-ink-soft">
                      {" "}
                      {kind.name} · interest score {score} of 7
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <div aria-hidden className="relative ml-28 mr-12 h-5 sm:ml-32">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute top-1 -translate-x-1/2 font-mono text-xs tabular-nums text-ink-soft"
              style={{ left: `${(t / domain) * 100}%` }}
            >
              {percent(t)}
            </span>
          ))}
        </div>
      </div>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-ink-soft">View as a table</summary>
        <table className="mt-3 w-full max-w-md text-left">
          <thead className="text-ink-soft">
            <tr className="border-b border-line">
              <th className="py-2 font-medium">Kind of work</th>
              <th className="py-2 text-right font-medium">Interest share</th>
              <th className="py-2 text-right font-medium">O*NET score (1–7)</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {kindsOfWork.map((kind) => (
              <tr key={kind.code} className="border-b border-line">
                <td className="py-2">{kind.name}</td>
                <td className="py-2 text-right">{percent(kinds[kind.code].share)}</td>
                <td className="py-2 text-right">{kinds[kind.code].score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
