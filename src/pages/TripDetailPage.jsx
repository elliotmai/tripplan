import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/AuthContext'
import { ensureTripFriendships } from '../lib/friends'
import { format, parseISO, eachDayOfInterval } from 'date-fns'
import { ArrowLeft, Pencil, MapPin, Calendar, Users, CalendarDays } from 'lucide-react'
import ItineraryTab from '../components/ItineraryTab'
import TravelersTab from '../components/TravelersTab'
import PollsTab from '../components/PollsTab'
import PhotosTab from '../components/PhotosTab'
import DatesTab from '../components/DatesTab'
import EditTripSheet from '../components/EditTripSheet'
import CalendarSubscribeSheet from '../components/CalendarSubscribeSheet'

const TABS = [
  { id: 'itinerary', label: 'Itinerary' },
  { id: 'dates',     label: 'Dates' },
  { id: 'travelers', label: 'Travelers' },
  { id: 'polls',     label: 'Polls' },
  { id: 'photos',    label: 'Photos' },
]

export default function TripDetailPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [trip, setTrip] = useState(null)
  const [members, setMembers] = useState([])
  const [travelDetails, setTravelDetails] = useState([])
  const [sharedLegs, setSharedLegs] = useState([])
  const [sharedAccoms, setSharedAccoms] = useState([])
  const [activeTab, setActiveTab] = useState('itinerary')
  const [loading, setLoading] = useState(true)
  const [showEdit, setShowEdit] = useState(false)
  const [showSubscribe, setShowSubscribe] = useState(false)
  const [pollUnreadCount, setPollUnreadCount] = useState(0)

  useEffect(() => { loadTrip() }, [id])
  useEffect(() => { if (user?.id) refreshPollUnread() }, [id, user?.id])

  async function refreshPollUnread() {
    if (!user?.id) return
    const [pollSnap, voteSnap] = await Promise.all([
      getDocs(query(collection(db, 'polls'),      where('trip_id', '==', id))),
      getDocs(query(collection(db, 'poll_votes'), where('trip_id', '==', id))),
    ])
    const myPollIds = new Set(
      voteSnap.docs.filter(d => d.data().user_id === user.id).map(d => d.data().poll_id)
    )
    setPollUnreadCount(pollSnap.docs.filter(d => !myPollIds.has(d.id)).length)
  }

  async function loadTrip() {
    setLoading(true)
    const [tripSnap, memSnap, detailSnap, legsSnap, accomsSnap] = await Promise.all([
      getDoc(doc(db, 'trips', id)),
      getDocs(query(collection(db, 'trip_members'), where('trip_id', '==', id))),
      getDocs(query(collection(db, 'travel_details'), where('trip_id', '==', id))),
      getDocs(query(collection(db, 'trip_legs'), where('trip_id', '==', id))),
      getDocs(query(collection(db, 'trip_accommodations'), where('trip_id', '==', id))),
    ])
    if (!tripSnap.exists()) { setLoading(false); return }
    setTrip({ id: tripSnap.id, ...tripSnap.data() })
    setTravelDetails(detailSnap.docs.map(d => ({ _docId: d.id, id: d.id, ...d.data() })))
    setSharedLegs(legsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    setSharedAccoms(accomsSnap.docs.map(d => ({ id: d.id, ...d.data() })))

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

    // Auto-friend every trip mate (idempotent — only writes friendship docs that
    // include the current user, so it stays inside the rules).
    if (user?.id && memberData.length > 1) {
      ensureTripFriendships(user.id, memberData.map(m => m.id), id).catch(() => {})
    }
  }

  const isOwner = members.find(m => m.id === user?.id)?.role === 'owner'
  const isMember = members.some(m => m.id === user?.id)

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

      {/* ── Hero header ── */}
      <div className="relative px-6 pt-12 pb-6"
        style={{ background: 'linear-gradient(180deg, #1c1916 0%, #12100e 60%, transparent 100%)' }}>

        <button onClick={() => navigate('/')}
          className="flex items-center gap-2 mb-6 transition-opacity active:opacity-60"
          style={{ color: '#5a5248' }}>
          <ArrowLeft size={16} />
          <span className="text-xs tracking-wider">All Trips</span>
        </button>

        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-5xl mb-3">{trip.cover_emoji || '✈️'}</div>
            <h1 className="font-display text-3xl font-light leading-tight"
              style={{ color: '#e8d5a3', fontStyle: 'italic' }}>
              {trip.name}
            </h1>
            <div className="flex items-center gap-1 mt-2" style={{ color: '#5a5248' }}>
              <MapPin size={12} />
              <span className="text-sm">{trip.destination}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-shrink-0 mt-1">
            <button
              onClick={() => setShowSubscribe(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs transition-all active:scale-95"
              style={{
                background: 'rgba(122,154,181,0.1)',
                border: '1px solid rgba(122,154,181,0.2)',
                color: '#7a9ab5',
              }}>
              <CalendarDays size={12} />
              Subscribe
            </button>
            {isMember && (
              <button
                onClick={() => setShowEdit(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs transition-all active:scale-95"
                style={{
                  background: 'rgba(212,184,122,0.1)',
                  border: '1px solid rgba(212,184,122,0.2)',
                  color: '#d4b87a',
                }}>
                <Pencil size={12} />
                Edit
              </button>
            )}
          </div>
        </div>

        {/* Date + member chips */}
        <div className="flex flex-wrap gap-2 mt-4">
          {trip.start_date && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs"
              style={{
                background: 'rgba(212,184,122,0.1)',
                color: '#d4b87a',
                border: '1px solid rgba(212,184,122,0.2)',
              }}>
              <Calendar size={10} />
              {format(parseISO(trip.start_date), 'MMM d')}
              {trip.end_date && ` – ${format(parseISO(trip.end_date), 'MMM d, yyyy')}`}
            </div>
          )}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs"
            style={{
              background: 'rgba(212,184,122,0.1)',
              color: '#d4b87a',
              border: '1px solid rgba(212,184,122,0.2)',
            }}>
            <Users size={10} />
            {members.length} traveler{members.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="sticky top-0 z-20 px-6 py-3"
        style={{
          background: 'rgba(10,9,8,0.95)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(212,184,122,0.08)',
        }}>
        <div className="flex gap-1">
          {TABS.map(tab => {
            const showPollBadge = tab.id === 'polls' && pollUnreadCount > 0
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex-1 py-2 rounded-xl text-xs font-medium tracking-wide transition-all relative"
                style={{
                  background: activeTab === tab.id ? 'rgba(212,184,122,0.15)' : 'transparent',
                  color: activeTab === tab.id ? '#d4b87a' : '#5a5248',
                  border: activeTab === tab.id ? '1px solid rgba(212,184,122,0.2)' : '1px solid transparent',
                }}>
                <span className="inline-flex items-center justify-center gap-1.5">
                  {tab.label}
                  {showPollBadge && (
                    <span
                      className="inline-flex items-center justify-center rounded-full text-[10px] font-semibold leading-none"
                      style={{
                        minWidth: 16, height: 16, padding: '0 5px',
                        background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)',
                        color: '#0a0908',
                      }}>
                      {pollUnreadCount}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="pb-8">
        {activeTab === 'itinerary' && (
          <ItineraryTab
            tripId={id}
            trip={trip}
            days={days}
            members={members}
            travelDetails={travelDetails}
            sharedLegs={sharedLegs}
            sharedAccoms={sharedAccoms}
            currentUser={user}
          />
        )}
        {activeTab === 'dates' && (
          <DatesTab
            tripId={id}
            trip={trip}
            members={members}
            currentUser={user}
            onTripUpdated={loadTrip}
          />
        )}
        {activeTab === 'travelers' && (
          <TravelersTab
            tripId={id}
            trip={trip}
            members={members}
            travelDetails={travelDetails}
            sharedLegs={sharedLegs}
            sharedAccoms={sharedAccoms}
            currentUser={user}
            onUpdate={loadTrip}
          />
        )}
        {activeTab === 'polls' && (
          <PollsTab tripId={id} currentUser={user} onPollsChanged={refreshPollUnread} />
        )}
        {activeTab === 'photos' && (
          <PhotosTab tripId={id} />
        )}
      </div>

      {/* ── Sheets ── */}
      {showEdit && (
        <EditTripSheet
          trip={trip}
          isOwner={isOwner}
          onClose={() => setShowEdit(false)}
          onSaved={loadTrip}
        />
      )}

      {showSubscribe && (
        <CalendarSubscribeSheet
          trip={trip}
          members={members}
          travelDetails={travelDetails}
          sharedLegs={sharedLegs}
          sharedAccoms={sharedAccoms}
          onClose={() => setShowSubscribe(false)}
        />
      )}
    </div>
  )
}