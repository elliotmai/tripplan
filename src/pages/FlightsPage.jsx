import { useState, useEffect, useMemo } from 'react'
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/AuthContext'
import { normalizeLegs } from '../lib/travel'
import { toTrackableFlights, isFlightActiveNow } from '../lib/flightTracking'
import { formatWithTZ, wallClockToInstant } from '../lib/timezones'
import { Users } from 'lucide-react'
import BottomNav from '../components/BottomNav'
import FlightMap from '../components/FlightMap'

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// A trip is "currently happening" when today falls within its date window.
// Both bounds are required — without dates we can't place it on the calendar.
function isHappening(trip, today) {
  if (!trip.start_date || !trip.end_date) return false
  return trip.start_date <= today && today <= trip.end_date
}

// Query a collection for many trip_ids using batched `in` filters (max 30 each).
async function byTripIds(coll, tripIds) {
  const results = []
  for (const c of chunk(tripIds, 30)) {
    const snap = await getDocs(query(collection(db, coll), where('trip_id', 'in', c)))
    snap.docs.forEach(d => results.push({ id: d.id, ...d.data() }))
  }
  return results
}

export default function FlightsPage() {
  const { user } = useAuth()
  const [flights, setFlights] = useState([])       // all trackable flights in in-progress trips
  const [activeTrips, setActiveTrips] = useState([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => { if (user?.id) load() }, [user?.id])

  // Re-evaluate the "active right now" window every minute so flights appear as
  // they take off and drop off after landing — without re-querying Firestore.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Only these get polled — flights whose scheduled window includes now.
  const activeFlights = useMemo(
    () => flights.filter(f => isFlightActiveNow(f, now)),
    [flights, now]
  )

  async function load() {
    setLoading(true)

    // 1. Trips the user belongs to.
    const memSnap = await getDocs(query(collection(db, 'trip_members'), where('user_id', '==', user.id)))
    const allTripIds = [...new Set(memSnap.docs.map(d => d.data().trip_id))]
    if (!allTripIds.length) { setActiveTrips([]); setFlights([]); setLoading(false); return }

    // 2. Trip docs → keep only the ones happening right now.
    const today = new Date().toISOString().slice(0, 10)
    const tripDocs = (await Promise.all(allTripIds.map(id => getDoc(doc(db, 'trips', id)))))
      .filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }))
      .filter(t => isHappening(t, today))
    setActiveTrips(tripDocs)
    const tripIds = tripDocs.map(t => t.id)
    if (!tripIds.length) { setFlights([]); setLoading(false); return }

    // 3. Legs / legacy details / members for just those trips.
    const [sharedLegs, legacyDetails, allMembers] = await Promise.all([
      byTripIds('trip_legs', tripIds),
      byTripIds('travel_details', tripIds),
      byTripIds('trip_members', tripIds),
    ])

    // 4. Resolve member profiles (names) once, for the whole set.
    const memberIds = [...new Set(allMembers.map(m => m.user_id))]
    const profileSnaps = await Promise.all(memberIds.map(id => getDoc(doc(db, 'profiles', id))))
    const nameById = {}
    profileSnaps.forEach(s => { nameById[s.id] = s.exists() ? (s.data().full_name || 'Unknown') : 'Unknown' })

    // 5. Per trip: normalize legs (attaches traveler names) → enriched flights.
    const tripById = Object.fromEntries(tripDocs.map(t => [t.id, t]))
    const out = []
    for (const tid of tripIds) {
      const trip = tripById[tid]
      if (!trip) continue
      const members = allMembers
        .filter(m => m.trip_id === tid)
        .map(m => ({ id: m.user_id, full_name: nameById[m.user_id] || 'Unknown' }))
      const legs = normalizeLegs({
        legacyDetails: legacyDetails.filter(d => d.trip_id === tid),
        sharedLegs: sharedLegs.filter(l => l.trip_id === tid),
        members,
      })
      out.push(...toTrackableFlights(legs, {
        tripId: tid, tripName: trip.name, tripEmoji: trip.cover_emoji,
      }))
    }

    setFlights(out)
    setLoading(false)
  }

  return (
    <div className="flex flex-col" style={{ background: '#0a0908', height: '100dvh' }}>
      <div className="px-6 pt-12 pb-4 flex-shrink-0"
        style={{ background: 'linear-gradient(180deg, #12100e 0%, transparent 100%)' }}>
        <p className="text-xs tracking-[0.2em] uppercase mb-1" style={{ color: '#5a5248' }}>Live</p>
        <h1 className="font-display text-4xl font-light" style={{ color: '#e8d5a3', fontStyle: 'italic' }}>Flights</h1>
      </div>

      <div className="flex-1 min-h-0" style={{ paddingBottom: 'calc(5.5rem + env(safe-area-inset-bottom, 0px))' }}>
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-4xl" style={{ animation: 'pulse 2s infinite' }}>📡</div>
          </div>
        ) : activeTrips.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center px-8 text-center">
            <div className="text-5xl mb-4">🧳</div>
            <p className="font-display text-xl font-light" style={{ color: '#e8d5a3' }}>No trips in progress</p>
            <p className="text-sm mt-2 max-w-xs" style={{ color: '#5a5248' }}>
              Live flight tracking shows up here while one of your trips is underway.
            </p>
          </div>
        ) : activeFlights.length === 0 ? (
          <NoActiveFlights flights={flights} now={now} />
        ) : (
          <FlightMap flights={activeFlights} embedded />
        )}
      </div>

      <BottomNav active="flights" />
    </div>
  )
}

// Shown when trips are in progress but nothing is in its flight window right now.
// Lists what's coming up so the tab still tells you something useful.
function NoActiveFlights({ flights, now }) {
  const upcoming = flights
    .map(f => {
      const dep = f.depart_at ? wallClockToInstant(f.depart_at, f.depart_tz) : null
      return { ...f, _dep: dep ? dep.getTime() : null }
    })
    .filter(f => f._dep && f._dep > now)
    .sort((a, b) => a._dep - b._dep)
    .slice(0, 6)

  return (
    <div className="h-full flex flex-col items-center justify-center px-8 text-center overflow-y-auto py-10">
      <div className="text-5xl mb-4">🛫</div>
      <p className="font-display text-xl font-light" style={{ color: '#e8d5a3' }}>No flights in the air right now</p>
      <p className="text-sm mt-2 max-w-xs" style={{ color: '#5a5248' }}>
        {upcoming.length
          ? 'Live tracking starts automatically around each departure.'
          : 'Nothing scheduled from here. Live tracking appears while a flight is en route.'}
      </p>

      {upcoming.length > 0 && (
        <div className="w-full max-w-sm mt-6 space-y-2">
          <p className="text-xs tracking-[0.2em] uppercase mb-1 text-left" style={{ color: '#5a5248' }}>Coming up</p>
          {upcoming.map((f, i) => (
            <div key={`${f.number}-${i}`} className="flex items-center gap-3 px-4 py-3 rounded-xl text-left"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <span className="text-lg flex-shrink-0">{f.tripEmoji || '✈️'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono" style={{ color: '#d4b87a' }}>{f.number}</span>
                  <span className="text-xs truncate" style={{ color: '#5a5248' }}>{f.tripName}</span>
                </div>
                <div className="text-xs" style={{ color: '#5a5248' }}>
                  {formatWithTZ(f.depart_at, f.depart_tz, { year: false })}
                  {[f.from, f.to].filter(Boolean).length ? ` · ${[f.from, f.to].filter(Boolean).join(' → ')}` : ''}
                </div>
                {f.travelers.length > 0 && (
                  <div className="flex items-center gap-1 text-xs mt-0.5" style={{ color: '#7a9ab5' }}>
                    <Users size={9} />{f.travelers.join(', ')}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}