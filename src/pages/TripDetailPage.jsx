import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/AuthContext'
import { format, parseISO, eachDayOfInterval } from 'date-fns'
import { ArrowLeft, Pencil, MapPin, Calendar, Users } from 'lucide-react'
import ItineraryTab from '../components/ItineraryTab'
import TravelersTab from '../components/TravelersTab'
import PollsTab from '../components/PollsTab'
import PhotosTab from '../components/PhotosTab'
import EditTripSheet from '../components/EditTripSheet'

const TABS = [
  { id: 'itinerary', label: 'Itinerary' },
  { id: 'travelers', label: 'Travelers' },
  { id: 'polls', label: 'Polls' },
  { id: 'photos', label: 'Photos' },
]

export default function TripDetailPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [trip, setTrip] = useState(null)
  const [members, setMembers] = useState([])
  const [travelDetails, setTravelDetails] = useState([])
  const [activeTab, setActiveTab] = useState('itinerary')
  const [loading, setLoading] = useState(true)
  const [showEdit, setShowEdit] = useState(false)

  useEffect(() => { loadTrip() }, [id])

  async function loadTrip() {
    setLoading(true)
    const [tripSnap, memSnap, detailSnap] = await Promise.all([
      getDoc(doc(db, 'trips', id)),
      getDocs(query(collection(db, 'trip_members'), where('trip_id', '==', id))),
      getDocs(query(collection(db, 'travel_details'), where('trip_id', '==', id))),
    ])
    if (!tripSnap.exists()) { setLoading(false); return }
    setTrip({ id: tripSnap.id, ...tripSnap.data() })
    setTravelDetails(detailSnap.docs.map(d => ({ id: d.id, ...d.data() })))

    const memberData = await Promise.all(
      memSnap.docs.map(async d => {
        const m = d.data()
        const profileSnap = await getDoc(doc(db, 'profiles', m.user_id))
        return profileSnap.exists()
          ? { ...profileSnap.data(), id: m.user_id, role: m.role }
          : { id: m.user_id, full_name: 'Unknown', role: m.role }
      })
    )
    setMembers(memberData)
    setLoading(false)
  }

  const isOwner = members.find(m => m.id === user?.id)?.role === 'owner'

  const days = trip?.start_date && trip?.end_date
    ? eachDayOfInterval({ start: parseISO(trip.start_date), end: parseISO(trip.end_date) })
    : []

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0908' }}>
      <div className="text-4xl" style={{ animation: 'pulse 2s infinite' }}>✈️</div>
    </div>
  )
  if (!trip) return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: '#0a0908' }}>
      <p style={{ color: '#5a5248' }}>Trip not found.</p>
      <button onClick={() => navigate('/')} className="mt-4 text-sm" style={{ color: '#d4b87a' }}>← Back</button>
    </div>
  )

  return (
    <div className="min-h-screen" style={{ background: '#0a0908' }}>

      {/* Hero header */}
      <div className="relative px-6 pt-12 pb-6"
        style={{ background: 'linear-gradient(180deg, #1c1916 0%, #12100e 60%, transparent 100%)' }}>
        <button onClick={() => navigate('/')}
          className="flex items-center gap-2 mb-6 transition-opacity active:opacity-60"
          style={{ color: '#5a5248' }}>
          <ArrowLeft size={16} /><span className="text-xs tracking-wider">All Trips</span>
        </button>

        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-5xl mb-3">{trip.cover_emoji || '✈️'}</div>
            <h1 className="font-display text-3xl font-light leading-tight"
              style={{ color: '#e8d5a3', fontStyle: 'italic' }}>{trip.name}</h1>
            <div className="flex items-center gap-1 mt-2" style={{ color: '#5a5248' }}>
              <MapPin size={12} /><span className="text-sm">{trip.destination}</span>
            </div>
          </div>

          {/* Edit button — owners only */}
          {isOwner && (
            <button
              onClick={() => setShowEdit(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs transition-all active:scale-95 flex-shrink-0 mt-1"
              style={{ background: 'rgba(212,184,122,0.1)', border: '1px solid rgba(212,184,122,0.2)', color: '#d4b87a' }}
            >
              <Pencil size={12} />
              Edit
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {trip.start_date && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs"
              style={{ background: 'rgba(212,184,122,0.1)', color: '#d4b87a', border: '1px solid rgba(212,184,122,0.2)' }}>
              <Calendar size={10} />
              {format(parseISO(trip.start_date), 'MMM d')} – {format(parseISO(trip.end_date), 'MMM d, yyyy')}
            </div>
          )}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs"
            style={{ background: 'rgba(212,184,122,0.1)', color: '#d4b87a', border: '1px solid rgba(212,184,122,0.2)' }}>
            <Users size={10} />{members.length} traveler{members.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="sticky top-0 z-20 px-6 py-3"
        style={{ background: 'rgba(10,9,8,0.95)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(212,184,122,0.08)' }}>
        <div className="flex gap-1">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className="flex-1 py-2 rounded-xl text-xs font-medium tracking-wide transition-all"
              style={{
                background: activeTab === tab.id ? 'rgba(212,184,122,0.15)' : 'transparent',
                color: activeTab === tab.id ? '#d4b87a' : '#5a5248',
                border: activeTab === tab.id ? '1px solid rgba(212,184,122,0.2)' : '1px solid transparent',
              }}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="pb-8">
        {activeTab === 'itinerary' && (
          <ItineraryTab
            tripId={id} trip={trip} days={days}
            members={members} travelDetails={travelDetails}
            currentUser={user}
          />
        )}
        {activeTab === 'travelers' && (
          <TravelersTab tripId={id} trip={trip} members={members} currentUser={user} onUpdate={loadTrip} />
        )}
        {activeTab === 'polls' && <PollsTab tripId={id} currentUser={user} />}
        {activeTab === 'photos' && <PhotosTab tripId={id} />}
      </div>

      {/* Edit sheet */}
      {showEdit && (
        <EditTripSheet
          trip={trip}
          onClose={() => setShowEdit(false)}
          onSaved={loadTrip}
        />
      )}
    </div>
  )
}