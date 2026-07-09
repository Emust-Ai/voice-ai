import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ConversationDetail from './pages/ConversationDetail'
import Analytics from './pages/Analytics'
import Admin from './pages/Admin'
import Layout from './components/Layout'

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center min-h-screen bg-background"><div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" /></div>
  if (!user) return <Navigate to="/supervisor/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/supervisor" replace />
  return children
}

function AppRoutes() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/supervisor/login" element={<Login />} />
      <Route path="/supervisor" element={<ProtectedRoute><Layout><Dashboard /></Layout></ProtectedRoute>} />
      <Route path="/supervisor/conversation/:id" element={<ProtectedRoute><Layout><ConversationDetail /></Layout></ProtectedRoute>} />
      <Route path="/supervisor/analytics" element={<ProtectedRoute roles={['admin', 'supervisor']}><Layout><Analytics /></Layout></ProtectedRoute>} />
      <Route path="/supervisor/admin" element={<ProtectedRoute roles={['admin']}><Layout><Admin /></Layout></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/supervisor" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
