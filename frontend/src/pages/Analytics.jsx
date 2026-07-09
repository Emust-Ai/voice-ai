import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../services/api'
import { motion } from 'framer-motion'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts'
import { BarChart3, TrendingUp, AlertTriangle, Phone, MessageSquare, Clock } from 'lucide-react'
import Card from '../components/ui/Card'
import { SectionLabel } from '../components/ui/Badge'
import { fadeInUp, stagger } from '../lib/animations'

const COLORS = ['#22c55e', '#eab308', '#ef4444', '#6366f1', '#ec4899', '#06b6d4']

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <motion.div variants={fadeInUp}>
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <div className={`flex items-center justify-center w-11 h-11 rounded-xl ${color}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-foreground">{value ?? '—'}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}

const tooltipStyle = {
  contentStyle: {
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: '12px',
    fontSize: '12px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.07)',
  },
  itemStyle: { color: '#0F172A' },
  labelStyle: { color: '#64748B' },
}

export default function Analytics() {
  const { token } = useAuth()
  const [stats, setStats] = useState(null)
  const [scorecards, setScorecards] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    Promise.all([
      api.get('/api/analytics/stats'),
      api.get('/api/analytics/scorecards', { params: { limit: 200 } }),
    ])
      .then(([statsRes, scRes]) => {
        setStats(statsRes.data)
        setScorecards(scRes.data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  const scoresOverTime = scorecards
    .filter(s => s.ai_performance_score != null)
    .slice(-50)
    .map(s => ({
      date: new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      score: Math.round(s.ai_performance_score),
    }))

  const statusCounts = {}
  scorecards.forEach(s => {
    const status = s.resolution_status || 'unknown'
    statusCounts[status] = (statusCounts[status] || 0) + 1
  })
  const statusChartData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }))

  const scoreBuckets = [0, 0, 0, 0, 0]
  scorecards.forEach(s => {
    if (s.ai_performance_score != null) {
      const idx = Math.min(Math.floor(s.ai_performance_score / 20), 4)
      scoreBuckets[idx]++
    }
  })
  const scoreDistData = [
    { range: '0–20', count: scoreBuckets[0] },
    { range: '21–40', count: scoreBuckets[1] },
    { range: '41–60', count: scoreBuckets[2] },
    { range: '61–80', count: scoreBuckets[3] },
    { range: '81–100', count: scoreBuckets[4] },
  ]

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
          <SectionLabel label="Analytics" pulse />
          <h1 className="font-display text-3xl text-foreground mt-2">Performance Overview</h1>
        </motion.div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard icon={Phone} label="Total Conversations" value={stats?.total_conversations} color="bg-blue-50 text-blue-600" />
          <StatCard icon={TrendingUp} label="Resolved" value={stats?.resolved_count} color="bg-green-50 text-green-600" />
          <StatCard icon={AlertTriangle} label="Escalations" value={stats?.escalation_count} color="bg-red-50 text-red-600" />
          <StatCard icon={BarChart3} label="Avg Score" value={stats?.avg_score?.toFixed(1)} color="bg-accent/10 text-accent" />
          <StatCard icon={Clock} label="Avg Duration (s)" value={stats?.avg_duration_seconds} color="bg-amber-50 text-amber-600" />
          <StatCard icon={MessageSquare} label="Avg Exchanges" value={stats?.avg_exchanges} color="bg-purple-50 text-purple-600" />
          <StatCard icon={AlertTriangle} label="Flagged" value={stats?.flagged_count} color="bg-orange-50 text-orange-600" />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <motion.div variants={fadeInUp}>
            <Card className="p-5" hover={false}>
              <h3 className="text-sm font-semibold text-foreground mb-4">Scores Over Time</h3>
              {scoresOverTime.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={scoresOverTime}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="date" tick={{ fill: '#64748B', fontSize: 10 }} />
                    <YAxis domain={[0, 100]} tick={{ fill: '#64748B', fontSize: 10 }} />
                    <Tooltip {...tooltipStyle} />
                    <Line type="monotone" dataKey="score" stroke="#0052FF" strokeWidth={2} dot={{ r: 3, fill: '#0052FF' }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center text-muted-foreground py-12 text-sm">No score data yet</div>
              )}
            </Card>
          </motion.div>

          <motion.div variants={fadeInUp}>
            <Card className="p-5" hover={false}>
              <h3 className="text-sm font-semibold text-foreground mb-4">Score Distribution</h3>
              {scoreDistData.some(d => d.count > 0) ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={scoreDistData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="range" tick={{ fill: '#64748B', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#64748B', fontSize: 10 }} />
                    <Tooltip {...tooltipStyle} />
                    <Bar dataKey="count" fill="#0052FF" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center text-muted-foreground py-12 text-sm">No score data yet</div>
              )}
            </Card>
          </motion.div>

          <motion.div variants={fadeInUp}>
            <Card className="p-5" hover={false}>
              <h3 className="text-sm font-semibold text-foreground mb-4">Resolution Status</h3>
              {statusChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={statusChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label={({ name, value }) => `${name}: ${value}`}>
                      {statusChartData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip {...tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center text-muted-foreground py-12 text-sm">No data yet</div>
              )}
            </Card>
          </motion.div>
        </div>

        {/* Scorecards table */}
        <motion.div variants={fadeInUp}>
          <Card className="overflow-hidden" hover={false}>
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Recent Scorecards</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b border-border">
                    <th className="text-left px-5 py-3 font-medium">Date</th>
                    <th className="text-left px-5 py-3 font-medium">Caller</th>
                    <th className="text-left px-5 py-3 font-medium">Channel</th>
                    <th className="text-left px-5 py-3 font-medium">Status</th>
                    <th className="text-right px-5 py-3 font-medium">Score</th>
                    <th className="text-right px-5 py-3 font-medium">Exchanges</th>
                    <th className="text-right px-5 py-3 font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {scorecards.length === 0 ? (
                    <tr><td colSpan={7} className="text-center text-muted-foreground py-12">No scorecards yet</td></tr>
                  ) : (
                    scorecards.map(sc => (
                      <tr key={sc.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-5 py-3 text-muted-foreground">{new Date(sc.created_at).toLocaleDateString()}</td>
                        <td className="px-5 py-3 font-medium text-foreground">{sc.caller_name || sc.caller_number || '—'}</td>
                        <td className="px-5 py-3">
                          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                            {sc.channel === 'voice' ? <Phone className="w-3.5 h-3.5 text-blue-500" /> : <MessageSquare className="w-3.5 h-3.5 text-purple-500" />}
                            {sc.channel}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`capitalize text-sm ${
                            sc.resolution_status === 'resolved' ? 'text-green-600' :
                            sc.resolution_status === 'escalated' ? 'text-red-600' :
                            'text-muted-foreground'
                          }`}>
                            {sc.resolution_status || 'unknown'}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                            sc.ai_performance_score >= 80 ? 'text-green-600 bg-green-50 border-green-200' :
                            sc.ai_performance_score >= 50 ? 'text-yellow-600 bg-yellow-50 border-yellow-200' :
                            'text-red-600 bg-red-50 border-red-200'
                          }`}>
                            {sc.ai_performance_score != null ? Math.round(sc.ai_performance_score) : '—'}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right text-muted-foreground">{sc.exchange_count ?? '—'}</td>
                        <td className="px-5 py-3 text-right text-muted-foreground">{sc.duration_seconds ? `${sc.duration_seconds}s` : '—'}</td>
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