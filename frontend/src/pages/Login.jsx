import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { motion } from 'framer-motion'
import { Zap } from 'lucide-react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { fadeInUp, stagger } from '../lib/animations'

export default function Login() {
  const { login, user } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (user) {
    window.location.href = '/supervisor'
    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      window.location.href = '/supervisor'
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Background decoration */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-accent/3 blur-[150px]" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-accent-secondary/3 blur-[150px]" />
      </div>

      <motion.div
        className="w-full max-w-sm relative"
        initial="hidden"
        animate="visible"
        variants={stagger}
      >
        {/* Brand */}
        <motion.div className="text-center mb-8" variants={fadeInUp}>
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl gradient-bg shadow-accent mb-4">
            <Zap className="w-7 h-7 text-white" />
          </div>
          <h1 className="font-display text-3xl text-foreground">
            ev24 <span className="gradient-text">Supervisor</span>
          </h1>
          <p className="text-muted-foreground text-sm mt-2">
            Sign in to the command center
          </p>
        </motion.div>

        {/* Form */}
        <motion.form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-border bg-card p-6 space-y-5 shadow-lg"
          variants={fadeInUp}
        >
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Email
            </label>
            <Input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@ev24.com"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Password
            </label>
            <Input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <Button type="submit" disabled={loading} className="w-full h-12" size="lg">
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Signing in...
              </span>
            ) : (
              'Sign in'
            )}
          </Button>
        </motion.form>
      </motion.div>
    </div>
  )
}