import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { useAuth } from './contexts/useAuth'
import AuthPage from './pages/AuthPage'
import TripsPage from './pages/TripsPage'
import TripDetailPage from './pages/TripDetailPage'
import AccountPage from './pages/AccountPage'
import FriendsPage from './pages/FriendsPage'
import FlightsPage from './pages/FlightsPage'
import UpcomingTripPage from './pages/UpcomingTripPage'
import WhatsNew from './components/WhatsNew'
import WelcomeTour from './components/WelcomeTour'

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
    <>
    <WelcomeTour />
    <Routes>
      <Route path="/" element={<TripsPage />} />
      <Route path="/trips/upcoming" element={<UpcomingTripPage />} />
      <Route path="/trips/:id" element={<TripDetailPage />} />
      <Route path="/flights" element={<FlightsPage />} />
      <Route path="/friends" element={<FriendsPage />} />
      <Route path="/account" element={<AccountPage />} />
      
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
    </>
  )
}

// Understated, persistent footer link — shown on every screen. Pinned to the very
// bottom edge (z-40, above the z-30 bottom nav but below modals) so it sits in the
// nav's empty bottom band on tabbed pages and in the sign-in page's bottom padding;
// that wrapper is click-through, only the link is interactive. On the other signed-in
// pages (a trip) there is no band to sit in and, pinned, it floated over the page as
// you scrolled, so there it ends the page instead.
const TAB_PATHS = ['/', '/flights', '/friends', '/account']

function AppFooter() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const inNavBand = !user || TAB_PATHS.includes(pathname)
  return (
    <div className={inNavBand ? 'fixed inset-x-0 bottom-0 z-40 flex justify-center pointer-events-none' : 'flex justify-center'}
      style={{ paddingBottom: '4px', background: inNavBand ? undefined : '#0a0908' }}>
      <a
        href="https://ticketbooth.netlify.app/"
        target="_blank"
        rel="noopener noreferrer"
        className="pointer-events-auto text-[9px] tracking-wider transition-colors"
        style={{ color: '#5a5248' }}
        onMouseEnter={e => (e.currentTarget.style.color = '#d4b87a')}
        onMouseLeave={e => (e.currentTarget.style.color = '#5a5248')}>
        Report a bug or request a feature
      </a>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <AppFooter />
        <WhatsNew />
      </AuthProvider>
    </BrowserRouter>
  )
}