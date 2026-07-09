import { cn } from '../../lib/utils'

export default function Card({ className, hover = true, featured, children, ...props }) {
  if (featured) {
    return (
      <div className={cn('rounded-xl bg-gradient-to-br from-accent via-accent-secondary to-accent p-[2px]', className)} {...props}>
        <div className="h-full w-full rounded-[calc(12px-2px)] bg-card">
          {children}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card p-6 shadow-md',
        hover && 'transition-all duration-300 hover:shadow-xl hover:-translate-y-0.5',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}