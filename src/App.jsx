import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import AuthPage from './pages/AuthPage'
import TripsPage from './pages/TripsPage'
import TripDetailPage from './pages/TripDetailPage'
import AccountPage from './pages/AccountPage'

function AppRoutes() {
  const { user, loading } = useAuth()

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0908' }}>
      <div style={{ color: '#d4b87a', fontFamily: 'Cormorant Garamond, serif', fontSize: '2.5rem', fontStyle: 'italic', fontWeight: 300 }}>
        wander
      </div>
    </div>
  )

  if (!user) return <AuthPage />

  return (
    <Routes>
      <Route path="/"          element={<TripsPage />} />
      <Route path="/trips/:id" element={<TripDetailPage />} />
      <Route path="/account"   element={<AccountPage />} />
      <Route path="*"          element={<Navigate to="/" />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
