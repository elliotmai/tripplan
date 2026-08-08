import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/AuthContext'

/**
 * DROP-IN FOR THE WANDER (tripplan) PROJECT — copy to src/pages/.
 *
 * Resolves a link from Our Den:
 *   /trips/upcoming?members=alice@x.com,bob@y.com
 * → the couple's soonest upcoming trip they're BOTH on, then redirects to it.
 *
 * Secure: only a signed-in member of the link can use it (no key needed, because
 * Wander does the lookup with its own auth + data). Matches Wander's schema —
 * profiles.email, trip_members.{user_id,trip_id}, trips.start_date.
 */
export default function UpcomingTripPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [status, setStatus] = useState('resolving') // resolving | forbidden | none | error

  useEffect(() => {
    if (user?.id) resolve()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  async function resolve() {
    try {
      const emails = (params.get('members') || '')
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(Boolean)
      const me = (user.email || '').toLowerCase()

      // Only someone named in the link may follow it.
      if (emails.length < 2 || !emails.includes(me)) return setStatus('forbidden')

      // email → uid (use our own id for self; look the partner up by email).
      const uids = []
      for (const email of emails) {
        if (email === me) { uids.push(user.id); continue }
        const snap = await getDocs(query(collection(db, 'profiles'), where('email', '==', email)))
        if (snap.empty) return setStatus('none')
        uids.push(snap.docs[0].id)
      }

      // Each member's trip ids, then the intersection.
      const sets = []
      for (const uid of uids) {
        const snap = await getDocs(query(collection(db, 'trip_members'), where('user_id', '==', uid)))
        sets.push(new Set(snap.docs.map(d => d.data().trip_id)))
      }
      const shared = [...sets[0]].filter(id => sets.every(s => s.has(id)))
      if (!shared.length) return setStatus('none')

      // Load shared trips, keep the ones that haven't ended, pick the soonest —
      // so a trip already underway wins over the next one after it. An open-ended
      // trip never counts as past, same rule TripsPage uses.
      const today = new Date().toISOString().slice(0, 10)
      const trips = []
      for (const id of shared) {
        const s = await getDoc(doc(db, 'trips', id))
        const t = s.exists() ? s.data() : null
        if (t?.start_date && (!t.end_date || t.end_date >= today)) trips.push({ id, start_date: t.start_date })
      }
      if (!trips.length) return setStatus('none')

      trips.sort((a, b) => a.start_date.localeCompare(b.start_date))
      navigate(`/trips/${trips[0].id}`, { replace: true })
    } catch (e) {
      console.error('upcoming resolve failed', e)
      setStatus('error')
    }
  }

  const message = {
    resolving: 'Finding your next trip together…',
    forbidden: "This link isn't for your account.",
    none: "No upcoming trips you're both on yet.",
    error: 'Something went wrong finding your trip.',
  }[status]

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: '1.25rem',
      background: '#0a0908', padding: '2rem', textAlign: 'center',
    }}>
      <div style={{ color: '#d4b87a', fontFamily: 'Cormorant Garamond, serif', fontSize: '2.25rem', fontStyle: 'italic', fontWeight: 300 }}>
        wander
      </div>
      <p style={{ color: '#a89a86', fontFamily: 'system-ui, sans-serif', fontSize: '.95rem' }}>{message}</p>
      {status !== 'resolving' && (
        <button
          onClick={() => navigate('/')}
          style={{
            border: '1px solid rgba(212,184,122,.4)', color: '#d4b87a', background: 'transparent',
            borderRadius: '999px', padding: '.6rem 1.4rem', fontSize: '.85rem', cursor: 'pointer',
          }}
        >
          Go to your trips
        </button>
      )}
    </div>
  )
}
