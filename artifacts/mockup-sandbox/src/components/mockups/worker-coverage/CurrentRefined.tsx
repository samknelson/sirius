import { useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Clock3, Info, WalletCards } from "lucide-react";
import { baoCoverageSummary } from "./_data";

export function CurrentRefined() {
  const [showHistory, setShowHistory] = useState(false);
  const current = baoCoverageSummary.current;
  const progress = Math.min(100, ((current.hours?.reported ?? 0) / (current.hours?.required || 1)) * 100);

  return (
    <main className="min-h-[100dvh] bg-[#f4f1eb] p-4 text-[#27313a] sm:p-8" style={{ fontFamily: "'DM Sans', ui-sans-serif, system-ui, sans-serif" }}>
      <section className="mx-auto w-full max-w-3xl overflow-hidden rounded-[22px] border border-[#d9d4ca] bg-[#fbfaf7] shadow-[0_18px_55px_rgba(44,50,51,0.10)]">
        <header className="flex items-start justify-between gap-4 border-b border-[#e5e0d7] px-5 py-5 sm:px-7">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#7c847e]">
              <span className="h-2 w-2 rounded-full bg-[#4f8d75]" />
              Benefits overview
            </div>
            <h1 className="text-[21px] font-semibold tracking-[-0.02em] text-[#27313a]">Coverage</h1>
            <p className="mt-1 text-[13px] text-[#7c847e]">Your coverage status, hours, and upcoming months</p>
          </div>
          <button
            type="button"
            onClick={() => setShowHistory((value) => !value)}
            className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-[#d8d4cb] bg-[#fffdf9] px-3 py-2 text-xs font-semibold text-[#53615e] transition hover:border-[#8ba797] hover:bg-[#f0f6f2]"
            aria-expanded={showHistory}
          >
            History <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showHistory ? "rotate-180" : ""}`} />
          </button>
        </header>

        <div className="space-y-5 p-5 sm:p-7">
          <div className="rounded-[16px] border border-[#cbded2] bg-[#edf6f0] p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#648274]">Current coverage</p>
                <p className="mt-1.5 text-lg font-semibold tracking-[-0.02em]">{current.coverageMonth.label}</p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full bg-[#d7eadf] px-3 py-2 text-xs font-bold text-[#27634a]">
                <Check className="h-4 w-4" strokeWidth={2.5} /> Coverage confirmed
              </span>
            </div>
            <div className="mt-5 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#d2e4d8]">
                <div className="h-full rounded-full bg-[#4f8d75] transition-all" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-xs font-bold tabular-nums text-[#3d715b]">{Math.round(progress)}%</span>
            </div>
            <p className="mt-2 text-xs text-[#648274]">Your November hours requirement is complete.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Work month" value={current.workMonth.label} />
            <Metric label="Work hours" value={`${current.hours?.reported ?? "—"} hrs`} detail={`of ${current.hours?.required ?? "—"} hrs required`} />
            <Metric label="Balance" value={baoCoverageSummary.balance.totals[0]?.formatted ?? "—"} detail="No balance due" icon={<WalletCards className="h-4 w-4 text-[#668d7b]" />} />
          </div>

          <section className="rounded-[16px] border border-[#e1ddd5] bg-[#fffdf9] p-4 sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[15px] font-bold">Upcoming work months</h2>
                <p className="mt-1 text-xs leading-5 text-[#7c847e]">A quick look at hours that support future coverage.</p>
              </div>
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#9aa19b]" />
            </div>
            <div className="divide-y divide-[#ece8e1]">
              {baoCoverageSummary.future.map((period) => {
                const met = period.status === "met";
                return (
                  <article key={period.workMonth.label} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <div className={`grid h-9 w-9 place-items-center rounded-xl ${met ? "bg-[#e4f0e8] text-[#4f8d75]" : "bg-[#f7eee2] text-[#b27845]"}`}>
                        {met ? <Check className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{period.workMonth.label}</p>
                        <p className="text-xs text-[#858c86]">Coverage for {period.coverageMonth.label}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-xs font-bold ${met ? "text-[#3f765e]" : "text-[#a86d3d]"}`}>{met ? "Threshold met" : "In progress"}</p>
                      <p className="mt-1 text-xs tabular-nums text-[#858c86]">{period.hours.reported} / {period.hours.required} hrs</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {showHistory && (
            <div className="rounded-[14px] border border-[#ddd8ce] bg-[#f5f1e9] px-4 py-3 text-xs text-[#65706b]">
              <span className="font-semibold text-[#414c48]">Recent update:</span> November hours were received and confirmed on Dec 04, 2026.
            </div>
          )}

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e5e0d7] pt-4">
            <button type="button" onClick={() => setShowHistory(true)} className="group inline-flex items-center gap-1.5 text-xs font-bold text-[#3f765e] hover:text-[#2e5e49]">
              View full monthly hours breakdown <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </button>
            <span className="text-xs text-[#8a908a]">Questions? Contact the fund.</span>
          </footer>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-[14px] border border-[#e1ddd5] bg-[#fffdf9] p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#8a908a]">{icon}{label}</div>
      <p className="mt-2 text-sm font-semibold leading-5">{value}</p>
      {detail && <p className="mt-1 text-xs text-[#8a908a]">{detail}</p>}
    </div>
  );
}