import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/AuthContext'
import { format, parseISO, differenceInDays } from 'date-fns'
import { Plus, MapPin, Calendar, ChevronRight } from 'lucide-react'
import NewTripModal from '../components/NewTripModal'
import BottomNav from '../components/BottomNav'

export default function TripsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)

  useEffect(() => { if (user?.id) loadTrips() }, [user?.id])

  async function loadTrips() {
    setLoading(true)
    const memSnap = await getDocs(
      query(collection(db, 'trip_members'), where('user_id', '==', user.id))
    )
    const tripIds = memSnap.docs.map(d => d.data().trip_id)
    if (!tripIds.length) { setTrips([]); setLoading(false); return }

    // Fetch each trip doc (Firestore 'in' supports up to 30 items)
    const chunks = []
    for (let i = 0; i < tripIds.length; i += 30) chunks.push(tripIds.slice(i, i + 30))
    const tripDocs = []
    for (const chunk of chunks) {
      const snaps = await Promise.all(chunk.map(id => getDoc(doc(db, 'trips', id))))
      snaps.forEach(s => s.exists() && tripDocs.push({ id: s.id, ...s.data() }))
    }
    tripDocs.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0))
    setTrips(tripDocs)
    setLoading(false)
  }

  const today = new Date().toISOString().slice(0, 10)
  const upcoming = trips.filter(t => !t.end_date || t.end_date >= today)
  const past = trips.filter(t => t.end_date && t.end_date < today)

  return (
    <div className="min-h-screen pb-safe" style={{ background: '#0a0908' }}>
      <div className="px-6 pt-12 pb-6" style={{ background: 'linear-gradient(180deg, #12100e 0%, transparent 100%)' }}>
        <div className="flex items-end justify-between mb-1">
          <div>
            <p className="text-xs tracking-[0.2em] uppercase mb-1" style={{ color: '#5a5248' }}>
              Hello, {user.user_metadata?.full_name?.split(' ')[0] || 'traveller'}
            </p>
            <h1 className="font-display text-4xl font-light" style={{ color: '#e8d5a3', fontStyle: 'italic' }}>Your Trips</h1>
          </div>
          <button onClick={() => setShowNew(true)}
            className="w-11 h-11 rounded-2xl flex items-center justify-center transition-all active:scale-95"
            style={{ background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)' }}>
            <Plus size={20} color="#0a0908" strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <div className="px-6 space-y-8">
        {loading ? (
          <div className="space-y-4 pt-2">
            {[1, 2, 3].map(i => <div key={i} className="h-32 rounded-2xl shimmer" style={{ background: '#1c1916' }} />)}
          </div>
        ) : trips.length === 0 ? (
          <div className="text-center py-20 fade-in">
            <div className="text-6xl mb-4">✈️</div>
            <p className="font-display text-2xl font-light mb-2" style={{ color: '#e8d5a3' }}>No trips yet</p>
            <p className="text-sm mb-6" style={{ color: '#5a5248' }}>Plan your first adventure together</p>
            <button onClick={() => setShowNew(true)}
              className="px-6 py-3 rounded-xl text-sm font-medium"
              style={{ background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
              Create a Trip
            </button>
          </div>
        ) : (
          <>
            {upcoming.length > 0 && (
              <section className="fade-in">
                <h2 className="text-xs tracking-[0.2em] uppercase mb-4" style={{ color: '#5a5248' }}>Upcoming</h2>
                <div className="space-y-3">
                  {upcoming.map(trip => <TripCard key={trip.id} trip={trip} onClick={() => navigate(`/trips/${trip.id}`)} />)}
                </div>
              </section>
            )}
            {past.length > 0 && (
              <section className="fade-in">
                <h2 className="text-xs tracking-[0.2em] uppercase mb-4" style={{ color: '#5a5248' }}>Past</h2>
                <div className="space-y-3">
                  {past.map(trip => <TripCard key={trip.id} trip={trip} onClick={() => navigate(`/trips/${trip.id}`)} past />)}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <BottomNav active="trips" />
      {showNew && <NewTripModal onClose={() => setShowNew(false)} onCreated={loadTrips} />}
    </div>
  )
}

function TripCard({ trip, onClick, past }) {
  const days = trip.start_date && trip.end_date
    ? differenceInDays(parseISO(trip.end_date), parseISO(trip.start_date)) + 1 : null
  return (
    <button onClick={onClick}
      className="w-full text-left rounded-2xl p-5 glass transition-all active:scale-98 flex items-center gap-4"
      style={{ opacity: past ? 0.65 : 1 }}>
      <div className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 text-3xl"
        style={{ background: 'rgba(212,184,122,0.1)' }}>
        {trip.cover_emoji || '✈️'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-display text-xl font-light truncate" style={{ color: '#e8d5a3' }}>{trip.name}</p>
        <div className="flex items-center gap-1 mt-0.5" style={{ color: '#5a5248' }}>
          <MapPin size={11} /><span className="text-xs truncate">{trip.destination}</span>
        </div>
        <div className="flex items-center gap-3 mt-2">
          {trip.start_date && (
            <span className="text-xs flex items-center gap-1" style={{ color: '#5a5248' }}>
              <Calendar size={10} />
              {format(parseISO(trip.start_date), 'MMM d')}
              {trip.end_date && ` – ${format(parseISO(trip.end_date), 'MMM d')}`}
            </span>
          )}
          {days && <span className="text-xs" style={{ color: '#5a5248' }}>{days}d</span>}
        </div>
      </div>
      <ChevronRight size={16} style={{ color: '#3d3830', flexShrink: 0 }} />
    </button>
  )
}