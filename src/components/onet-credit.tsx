import { getOnetMeta } from "@/lib/careers";

const link = "underline decoration-line-strong underline-offset-2 hover:decoration-ink";

// Attribution required by the O*NET® database licence (CC BY 4.0), in the wording O*NET asks
// for when the information has been modified.
export async function OnetCredit({ className = "" }: { className?: string }) {
  const { version } = await getOnetMeta();
  return (
    <p className={`text-sm leading-relaxed text-ink-soft ${className}`}>
      This page includes information from the{" "}
      <a className={link} href="https://www.onetcenter.org/database.html">
        O*NET {version} Database
      </a>{" "}
      by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used
      under the{" "}
      <a className={link} href="https://creativecommons.org/licenses/by/4.0/">
        CC BY 4.0
      </a>{" "}
      license. LifeAs has modified all or some of this information. USDOL/ETA has not approved,
      endorsed, or tested these modifications. O*NET® is a trademark of USDOL/ETA.
    </p>
  );
}
