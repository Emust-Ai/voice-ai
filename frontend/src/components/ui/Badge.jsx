import { cn } from '../../lib/utils'

export function SectionLabel({ label, pulse, className }) {
  return (
    <div className={cn('inline-flex items-center gap-3 rounded-full border border-accent/30 bg-accent/5 px-5 py-2', className)}>
      <span className={cn('h-2 w-2 rounded-full bg-accent', pulse && 'animate-pulse-dot')} />
      <span className="font-mono text-xs uppercase tracking-[0.15em] text-accent">{label}</span>
    </div>
  )
}

export function StatusBadge({ status, className }) {
  const colors = {
    active: 'bg-green-500',
    paused: 'bg-yellow-500',
    ended: 'bg-gray-400',
    takeover: 'bg-red-500',
  }

  const labels = {
    active: 'Active',
    paused: 'Paused',
    ended: 'Ended',
    takeover: 'Takeover',
  }

  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium', className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', colors[status] || 'bg-gray-400')} />
      {labels[status] || status}
    </span>
  )
}

export function ScoreBadge({ score, className }) {
  const color = score >= 80 ? 'text-green-600 bg-green-50 border-green-200'
    : score >= 50 ? 'text-yellow-600 bg-yellow-50 border-yellow-200'
    : 'text-red-600 bg-red-50 border-red-200'

  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold', color, className)}>
      {score != null ? Math.round(score) : '—'}
    </span>
  )
}