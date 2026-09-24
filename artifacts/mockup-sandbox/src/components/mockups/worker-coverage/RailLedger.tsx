import { ArrowDown, ArrowUpRight, Check, Clock3, Info, ShieldCheck, WalletCards, X } from "lucide-react";
import type { ReactNode } from "react";
import type { BaoCoverageSummary } from "./_data";
import { baoCoverageSummary } from "./_data";

function hours(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `${String(value)} hrs`;
}

function deadline(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

const status = {
  covered: { label: "Coverage confirmed", Icon: Check, color: "text-[#226b55]", wash: "bg-[#e6f2eb]", line: "bg-[#4f9a7d]" },
  "not-covered": { label: "Not covered", Icon: X, color: "text-[#a34f45]", wash: "bg-[#f8e9e5]", line: "bg-[#c9796c]" },
  stale: { label: "Needs updating", Icon: Clock3, color: "text-[#7a6541]", wash: "bg-[#f5efdf]", line: "bg-[#b89753]" },
  unavailable: { label: "Unavailable", Icon: Clock3, color: "text-[#657078]", wash: "bg-[#edf0ef]", line: "bg-[#8d9a9d]" },
} as const;

const futureStatus = {
  met: { label: "Threshold met", Icon: Check, color: "text-[#226b55]" },
  below: { label: "Below threshold", Icon: X, color: "text-[#a34f45]" },
  pending: { label: "Pending", Icon: Clock3, color: "text-[#7b756a]" },
} as const;

function Shell({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <article
      aria-label={label}
      data-testid="card-dashboard-bao-worker-coverage"
      className="w-full min-w-0 overflow-hidden rounded-[18px] border border-[#d8e1dc] bg-[#fbfcf9] text-[#24332e] shadow-[0_12px_35px_rgba(38,67,54,0.08)]"
      style={{ fontFamily: "'DM Sans', ui-sans-serif, system-ui, sans-serif" }}
    >
      {children}
    </article>
  );
}

export function RailLedger() {
  const data = baoCoverageSummary;
  if (!data || data.state !== "available") {
    return (
      <Shell label="Coverage information unavailable">
        <div className="flex items-start gap-3 p-6 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#6d7d76]" />
          <div><p className="font-semibold">Coverage information is unavailable.</p><p className="mt-1 text-[#718078]">Please try again or contact the fund.</p></div>
        </div>
      </Shell>
    );
  }

  const current = status[data.current.coverage];
  const CurrentIcon = current.Icon;
  const href = `/workers/${encodeURIComponent(data.workerId)}/employment/monthly`;
  const balance = data.balance.available && data.balance.totals.length
    ? data.balance.totals.map((entry) => entry.currency === "USD" ? entry.formatted : `${entry.currency} ${entry.formatted}`).join(", ")
    : "Not available";

  return (
    <Shell>
      <header className="flex items-center justify-between border-b border-[#e1e8e3] px-5 py-4 sm:px-7">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[#dfeee6] text-[#31745c]"><ShieldCheck className="h-4 w-4" /></span>
          <div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#718078]">Benefits</p><h2 className="text-[16px] font-bold tracking-[-0.02em]">Coverage status</h2></div>
        </div>
        <span className="hidden text-[11px] font-medium text-[#8a9790] sm:block">BAO health coverage</span>
      </header>

      <div className="grid gap-0 md:grid-cols-[minmax(230px,0.82fr)_minmax(360px,1.55fr)]">
        <section className={`relative overflow-hidden border-b border-[#e1e8e3] p-5 sm:p-7 md:border-b-0 md:border-r`} aria-label="Current coverage decision">
          <div className={`absolute inset-x-0 top-0 h-1 md:inset-y-0 md:left-0 md:h-auto md:w-1 ${current.line}`} aria-hidden="true" />
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7b8a82]">Current decision</p>
          <p className="mt-7 text-[13px] font-medium text-[#718078]">Coverage month</p>
          <h3 className="mt-1 font-serif text-[28px] leading-[1.05] tracking-[-0.04em] text-[#263b33]">{data.current.coverageMonth.label}</h3>
          <p className="mt-2 text-xs leading-5 text-[#7b8a82]">Based on work completed in {data.current.workMonth.label}</p>
          <div className={`mt-7 inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-bold ${current.wash} ${current.color}`} role="status">
            <CurrentIcon className="h-4 w-4" aria-hidden="true" />{current.label}
          </div>
          <p className="mt-8 flex items-start gap-2 border-t border-[#e1e8e3] pt-4 text-xs leading-5 text-[#718078]">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />This is the active coverage decision. The details to the right explain its inputs.
          </p>
        </section>

        <section className="min-w-0 p-5 sm:p-7" aria-label="Coverage details and upcoming months">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[#e1e8e3] bg-[#f3f7f3] p-4">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[#7b8a82]"><Clock3 className="h-4 w-4 text-[#4f9a7d]" />Work hours</div>
              <p className="mt-4 text-xl font-bold tabular-nums text-[#29483b]">{hours(data.current.hours?.reported)}</p>
              <p className="mt-1 text-xs text-[#718078]">of {hours(data.current.hours?.required)} required</p>
            </div>
            <div className="rounded-xl border border-[#e1e8e3] bg-[#f3f7f3] p-4">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[#7b8a82]"><WalletCards className="h-4 w-4 text-[#4f9a7d]" />Balance</div>
              <p className="mt-4 break-words text-xl font-bold tabular-nums text-[#29483b]">{balance}</p>
              <p className="mt-1 text-xs text-[#718078]">Reported account balance</p>
            </div>
          </div>

          <div className="mt-8">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div><h3 className="text-sm font-bold text-[#294238]">Next on the horizon</h3><p className="mt-1 text-xs text-[#7b8a82]">Work hours flow forward into future coverage.</p></div>
              <ArrowDown className="h-4 w-4 text-[#8aa196]" aria-hidden="true" />
            </div>
            <div className="space-y-3">
              {data.future.map((period) => {
                const item = futureStatus[period.status];
                const ItemIcon = item.Icon;
                return (
                  <article key={`${period.workMonth.year}-${period.workMonth.month}`} className="rounded-xl border border-[#e1e8e3] bg-[#fffefa] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="text-[11px] font-bold uppercase tracking-[0.09em] text-[#8a9790]">Work month</p><h4 className="mt-1 text-sm font-bold">{period.workMonth.label}</h4></div>
                      <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-bold ${item.color}`}><ItemIcon className="h-3.5 w-3.5" />{item.label}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#edf1ee] pt-3 text-xs text-[#718078]">
                      <span className="tabular-nums">{hours(period.hours.reported)} / {hours(period.hours.required)}</span>
                      <ArrowUpRight className="h-3 w-3 text-[#9aaca2]" />
                      <span>Coverage in {period.coverageMonth.label}</span>
                      <span className="ml-auto text-[#8a9790]">Due {deadline(period.deadline)}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <footer className="mt-6 flex flex-col gap-2 border-t border-[#e1e8e3] pt-4 text-xs sm:flex-row sm:items-center sm:justify-between">
            <a href="#" onClick={(event) => event.preventDefault()} data-href={href} className="font-bold text-[#31745c] underline decoration-[#a6c7b5] underline-offset-4 hover:no-underline">View full monthly hours breakdown</a>
            <span className="text-[#8a9790]">Questions? Contact the fund.</span>
          </footer>
        </section>
      </div>
    </Shell>
  );
}
