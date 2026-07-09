import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { motion } from 'framer-motion'
import { LayoutDashboard, MessageSquare, BarChart3, Users, LogOut, Zap } from 'lucide-react'
import { cn } from '../lib/utils'
import { fadeIn } from '../lib/animations'

const navItems = [
  { path: '/supervisor', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/supervisor/analytics', icon: BarChart3, label: 'Analytics', roles: ['admin', 'supervisor'] },
  { path: '/supervisor/admin', icon: Users, label: 'Users', roles: ['admin'] },
]

export default function Layout({ children }) {
  const { user, logout } = useAuth()
  const location = useLocation()

  const visibleItems = navItems.filter(
    item => !item.roles || item.roles.includes(user?.role)
  )

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-60 flex flex-col border-r border-border bg-card shadow-sm shrink-0">
        {/* Brand */}
        <div className="flex items-center gap-3 px-5 h-16 border-b border-border">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl gradient-bg shadow-accent">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-display text-lg leading-none text-foreground">ev24</span>
            <span className="block text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground">Supervisor</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {visibleItems.map(item => {
            const Icon = item.icon
            const isActive = location.pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group',
                  isActive
                    ? 'text-accent bg-accent/5'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="sidebar-indicator"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full gradient-bg"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <Icon className={cn('w-4.5 h-4.5 shrink-0', isActive && 'text-accent')} />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* User info */}
        <div className="px-4 py-4 border-t border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center text-white text-xs font-bold shrink-0">
              {user?.name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground truncate">{user?.name || 'User'}</div>
              <span className="inline-block rounded-full border border-accent/20 bg-accent/5 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-accent">
                {user?.role || 'agent'}
              </span>
            </div>
            <button
              onClick={logout}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col bg-background">
        <motion.div
          className="flex-1 overflow-hidden flex flex-col"
          initial="hidden"
          animate="visible"
          variants={fadeIn}
        >
          {children}
        </motion.div>
      </main>
    </div>
  )
}