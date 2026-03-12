import { useModalStore } from '@/app/store'

const GUIDE_CONTENT = `
**Packages** — Account size (e.g. $10k–$200k) and entry fee. Users choose one to start a challenge.

**Targets** — Profit % to reach in each phase (e.g. 8% in Phase 1, 5% in Phase 2).

**Challenges** — One or two evaluation phases. Pass = hit target without breaching daily loss or max drawdown.

**Fee** — What the user pays to participate. Often one-time per attempt; discounts and free retries are configurable.

**Rewards** — When funded, traders get a profit split (e.g. 80% to trader). Payouts follow a schedule (e.g. bi-weekly) with min/max limits.

**Rules** — Daily loss limit (e.g. 5%), max drawdown (e.g. 10%), calendar days, and optional min trading days. Breach = fail that phase.
`.trim()

export function GuideModal() {
  const closeModal = useModalStore((state) => state.closeModal)

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm text-text-muted whitespace-pre-line">
        {GUIDE_CONTENT.split('\n').map((line, i) => (
          <p key={i} className={line.startsWith('**') ? 'font-medium text-text mt-2 first:mt-0' : 'mt-1'}>
            {line.replace(/\*\*(.*?)\*\*/g, '$1')}
          </p>
        ))}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => closeModal('funded-guide')}
          className="rounded-lg border border-border bg-surface-2 px-4 py-2 text-sm font-medium text-text hover:bg-surface-2/80"
        >
          Close
        </button>
      </div>
    </div>
  )
}
