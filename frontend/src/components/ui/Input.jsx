import { forwardRef } from 'react'
import { cn } from '../../lib/utils'

const Input = forwardRef(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-12 w-full rounded-xl border border-border bg-transparent px-4 text-sm text-foreground placeholder:text-muted-foreground/50 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2',
      className
    )}
    {...props}
  />
))

Input.displayName = 'Input'
export default Input