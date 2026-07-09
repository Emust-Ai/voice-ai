import { forwardRef } from 'react'
import { cn } from '../../lib/utils'

const variants = {
  primary:
    'gradient-bg text-accent-foreground shadow-sm hover:shadow-accent hover:-translate-y-0.5 active:scale-[0.98] brightness-110',
  secondary:
    'bg-transparent border border-border text-foreground hover:bg-muted hover:border-accent/30 hover:shadow-sm',
  ghost:
    'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50',
}

const sizes = {
  sm: 'h-9 px-3 text-xs',
  md: 'h-11 px-5 text-sm',
  lg: 'h-13 px-8 text-base',
}

const Button = forwardRef(({ className, variant = 'primary', size = 'md', children, ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none',
      variants[variant],
      sizes[size],
      className
    )}
    {...props}
  >
    {children}
  </button>
))

Button.displayName = 'Button'
export default Button