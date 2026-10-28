// Block C as a flat picture: four floors of flats above the street door, a few lit windows and
// the one crew-red window. Used where the 3D courtyard can't run.

const windows = ["1010110101", "0110101101", "1101011010", "0101101011"].map((row, r) =>
  [...row].map((c, i) => (c === "1" ? (r === 2 && i === 6 ? "crew" : "lit") : "dark")),
);

export function Building({ className = "h-auto w-full max-w-md" }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 210" className={className} aria-hidden>
      <rect x="10" y="20" width="300" height="190" rx="4" className="fill-surface-2" />
      <rect x="10" y="12" width="300" height="10" rx="2" className="fill-surface" />
      {windows.map((row, r) =>
        row.map((state, c) => (
          <rect
            key={`${r}-${c}`}
            x={22 + c * 29}
            y={32 + r * 34}
            width="18"
            height="22"
            rx="2"
            className={state === "lit" ? "fill-amber" : state === "crew" ? "fill-crew" : "fill-bg"}
            opacity={state === "dark" ? 0.9 : state === "lit" ? 0.85 : 1}
          />
        )),
      )}
      <rect x="10" y="168" width="300" height="2" className="fill-surface" />
      <rect x="140" y="182" width="40" height="28" rx="2" className="fill-bg" />
      <text x="160" y="179" textAnchor="middle" className="fill-soft font-mono" fontSize="8" letterSpacing="2">
        BLOCK C
      </text>
    </svg>
  );
}
