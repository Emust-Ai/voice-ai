import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../services/api'
import { motion } from 'framer-motion'
import { Users, UserPlus, ToggleLeft, ToggleRight } from 'lucide-react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Card from '../components/ui/Card'
import { SectionLabel } from '../components/ui/Badge'
import { fadeInUp, stagger } from '../lib/animations'

const ROLES = ['admin', 'supervisor', 'agent']

export default function Admin() {
  const { token } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'agent' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [creating, setCreating] = useState(false)

  const fetchUsers = () => {
    api.get('/api/auth/users')
      .then(res => setUsers(res.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!token) return
    fetchUsers()
  }, [token])

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setCreating(true)
    try {
      await api.post('/api/auth/register', form)
      setSuccess(`User ${form.email} created successfully`)
      setForm({ email: '', password: '', name: '', role: 'agent' })
      fetchUsers()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create user')
    } finally {
      setCreating(false)
    }
  }

  const handleToggleActive = async (user) => {
    try {
      await api.put(`/api/auth/users/${user.id}`, { is_active: !user.is_active })
      fetchUsers()
    } catch (_) {}
  }

  const handleUpdateRole = async (user, newRole) => {
    try {
      await api.put(`/api/auth/users/${user.id}`, { role: newRole })
      fetchUsers()
    } catch (_) {}
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <motion.div
        className="max-w-6xl mx-auto"
        initial="hidden"
        animate="visible"
        variants={stagger}
      >
        {/* Section label */}
        <motion.div className="mb-6" variants={fadeInUp}>
          <SectionLabel label="Administration" pulse />
          <h1 className="font-display text-3xl text-foreground mt-2">User Management</h1>
        </motion.div>

        {/* Create user form */}
        <motion.div variants={fadeInUp}>
          <Card className="p-6 mb-6">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-5">
              <UserPlus className="w-4 h-4 text-accent" />
              Create User
            </h3>
            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm mb-4">{error}</div>
            )}
            {success && (
              <div className="rounded-xl bg-green-50 border border-green-200 text-green-700 px-4 py-3 text-sm mb-4">{success}</div>
            )}
            <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <Input
                type="text"
                placeholder="Full name"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                required
              />
              <Input
                type="email"
                placeholder="Email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                required
              />
              <Input
                type="password"
                placeholder="Password"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                required
              />
              <select
                value={form.role}
                onChange={e => setForm({ ...form, role: e.target.value })}
                className="h-12 rounded-xl border border-border bg-transparent px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 transition-all"
              >
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <Button type="submit" disabled={creating} size="md">
                {creating ? 'Creating...' : 'Create User'}
              </Button>
            </form>
          </Card>
        </motion.div>

        {/* Users table */}
        <motion.div variants={fadeInUp}>
          <Card className="overflow-hidden" hover={false}>
            <div className="px-5 py-4 border-b border-border flex items-center gap-2">
              <Users className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-semibold text-foreground">Users ({users.length})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b border-border">
                    <th className="text-left px-5 py-3 font-medium">Name</th>
                    <th className="text-left px-5 py-3 font-medium">Email</th>
                    <th className="text-left px-5 py-3 font-medium">Role</th>
                    <th className="text-center px-5 py-3 font-medium">Active</th>
                    <th className="text-left px-5 py-3 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr><td colSpan={5} className="text-center text-muted-foreground py-12">No users found</td></tr>
                  ) : (
                    users.map(u => (
                      <tr key={u.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-5 py-3 font-medium text-foreground">{u.name}</td>
                        <td className="px-5 py-3 text-muted-foreground">{u.email}</td>
                        <td className="px-5 py-3">
                          <select
                            value={u.role}
                            onChange={e => handleUpdateRole(u, e.target.value)}
                            className="rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                          >
                            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </td>
                        <td className="px-5 py-3 text-center">
                          <button
                            onClick={() => handleToggleActive(u)}
                            className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all ${
                              u.is_active
                                ? 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'
                                : 'bg-muted text-muted-foreground border border-border hover:bg-muted'
                            }`}
                          >
                            {u.is_active ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                            {u.is_active ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </motion.div>
      </motion.div>
    </div>
  )
}