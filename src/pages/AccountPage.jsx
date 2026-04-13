import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, getDocs, getDoc, doc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../contexts/AuthContext'
import { format, parseISO } from 'date-fns'
import {
  User, MapPin, Plane, LogOut, Trash2,
  Check, ChevronRight, Globe,
  AlertTriangle, X,
} from 'lucide-react'
import BottomNav from '../components/BottomNav'

// ─── stat card ────────────────────────────────────────────────────────────────
function StatCard({ icon, value, label, small }) {
  return (
    <div className="flex flex-col items-center justify-center py-5 rounded-2xl gap-1"
      style={{ background: 'rgba(212,184,122,0.07)', border: '1px solid rgba(212,184,122,0.12)' }}>
      <span className="text-xl mb-1">{icon}</span>
      <p className={small ? 'text-lg font-medium' : 'font-display text-3xl font-light'}
        style={{ color: '#e8d5a3', lineHeight: 1.1 }}>
        {value}
      </p>
      <p className="text-xs tracking-wider uppercase" style={{ color: '#5a5248' }}>{label}</p>
    </div>
  )
}

// ─── section wrapper ──────────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div className="glass rounded-2xl overflow-hidden">
      {title && (
        <p className="text-xs tracking-widest uppercase px-5 pt-5 pb-3" style={{ color: '#5a5248' }}>
          {title}
        </p>
      )}
      {children}
    </div>
  )
}

// ─── inline editable field ────────────────────────────────────────────────────
function EditField({ label, value, placeholder, onChange, icon }) {
  return (
    <div className="flex items-center gap-3 px-5 py-4"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="flex-shrink-0" style={{ color: '#5a5248' }}>{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs" style={{ color: '#5a5248' }}>{label}</p>
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm outline-none mt-0.5"
          style={{ color: '#d4cfc8' }}
        />
      </div>
    </div>
  )
}

// ─── delete confirmation modal ────────────────────────────────────────────────
function DeleteModal({ onConfirm, onClose, loading }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function handleConfirm() {
    if (!password) { setError('Please enter your password.'); return }
    setError('')
    try {
      await onConfirm(password)
    } catch (e) {
      setError(e.message?.replace('Firebase: ', '').replace(/ \(auth\/.*\)\.?/, '') || 'Incorrect password.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-lg rounded-t-3xl p-6 pb-10 slide-up"
        style={{ background: '#1c1916', border: '1px solid rgba(196,124,90,0.25)' }}>
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(196,124,90,0.15)' }}>
              <AlertTriangle size={18} style={{ color: '#c47c5a' }} />
            </div>
            <div>
              <p className="font-medium text-sm" style={{ color: '#e8d5a3' }}>Delete Account</p>
              <p className="text-xs mt-0.5" style={{ color: '#5a5248' }}>This cannot be undone</p>
            </div>
          </div>
          <button onClick={onClose} style={{ color: '#5a5248' }}><X size={16} /></button>
        </div>

        <p className="text-sm mb-5" style={{ color: '#b5aea4' }}>
          Your account, profile, and travel details will be permanently deleted.
          Trips you own will remain but you'll be removed as a member.
        </p>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl text-xs"
            style={{ background: 'rgba(196,124,90,0.15)', border: '1px solid rgba(196,124,90,0.3)', color: '#c47c5a' }}>
            {error}
          </div>
        )}

        <div className="mb-4">
          <p className="text-xs tracking-widest uppercase mb-2" style={{ color: '#5a5248' }}>
            Confirm with your password
          </p>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            autoFocus
            className="w-full px-4 py-3 rounded-xl text-sm outline-none"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(196,124,90,0.3)',
              color: '#d4cfc8',
            }}
            onKeyDown={e => e.key === 'Enter' && handleConfirm()}
          />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-3 rounded-xl text-sm"
            style={{ background: 'rgba(255,255,255,0.05)', color: '#5a5248' }}>
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={loading || !password}
            className="flex-1 py-3 rounded-xl text-sm font-medium transition-all active:scale-95"
            style={{ background: loading ? '#3d3830' : 'rgba(196,124,90,0.8)', color: '#fff' }}>
            {loading ? 'Deleting…' : 'Delete my account'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── main page ────────────────────────────────────────────────────────────────
export default function AccountPage() {
  const { user, signOut, updateProfileData, deleteAccount } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    full_name: '',
    home_airport: '',
    home_city: '',
  })
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [stats, setStats] = useState(null)
  const [recentTrips, setRecentTrips] = useState([])
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Seed form from user profile
  useEffect(() => {
    if (user) {
      setForm({
        full_name: user.full_name || user.user_metadata?.full_name || '',
        home_airport: user.home_airport || '',
        home_city: user.home_city || '',
      })
    }
  }, [user?.id])

  // Load travel stats
  useEffect(() => {
    if (user) loadStats()
  }, [user?.id])

  async function loadStats() {
    if (!user?.id) return

    // 1. All trips this user is a member of
    const myMemSnap = await getDocs(
      query(collection(db, 'trip_members'), where('user_id', '==', user.id))
    )
    const myMemberships = myMemSnap.docs.map(d => d.data())
    const tripIds = myMemberships.map(m => m.trip_id)

    if (!tripIds.length) {
      setStats({ trips: 0, upcoming: 0, partners: 0, topPartners: [] })
      return
    }

    // 2. Fetch trip docs
    const tripDocs = await Promise.all(tripIds.map(id => getDoc(doc(db, 'trips', id))))
    const trips = tripDocs.filter(d => d.exists()).map(d => ({ id: d.id, ...d.data() }))

    const today = new Date().toISOString().slice(0, 10)
    const upcoming = trips.filter(t => t.start_date && t.start_date >= today)
    const past = trips.filter(t => t.end_date && t.end_date < today)

    // 3. Find all co-members across all trips
    const allMemberSnaps = await Promise.all(
      tripIds.map(tid =>
        getDocs(query(collection(db, 'trip_members'), where('trip_id', '==', tid)))
      )
    )

    // Count how many shared trips each partner has with current user
    const partnerCount = {} // userId → count
    allMemberSnaps.forEach(snap => {
      snap.docs.forEach(d => {
        const uid = d.data().user_id
        if (uid === user.id) return
        partnerCount[uid] = (partnerCount[uid] || 0) + 1
      })
    })

    const partnerIds = Object.keys(partnerCount)

    // 4. Fetch profiles for top partners (sorted by shared trip count)
    const sortedPartnerIds = partnerIds
      .sort((a, b) => partnerCount[b] - partnerCount[a])
      .slice(0, 3)

    const topPartnerProfiles = await Promise.all(
      sortedPartnerIds.map(async uid => {
        const snap = await getDoc(doc(db, 'profiles', uid))
        const profile = snap.exists() ? snap.data() : { full_name: 'Unknown' }
        return { ...profile, id: uid, sharedTrips: partnerCount[uid] }
      })
    )

    // 5. Recent trips for the list
    const sorted = [
      ...upcoming.sort((a, b) => (a.start_date || '').localeCompare(b.start_date || '')),
      ...past.sort((a, b) => (b.end_date || '').localeCompare(a.end_date || '')).slice(0, 3),
    ]
    setRecentTrips(sorted.slice(0, 5))

    setStats({
      trips: trips.length,
      upcoming: upcoming.length,
      partners: partnerIds.length,
      topPartners: topPartnerProfiles,
    })
  }

  function handleChange(field, value) {
    setForm(p => ({ ...p, [field]: value }))
    setDirty(true)
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await updateProfileData(form)
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(password) {
    setDeleting(true)
    await deleteAccount(password) // throws on wrong password
    setDeleting(false)
    // Auth state change will redirect to login automatically
  }

  const initials = form.full_name
    ? form.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : user?.email?.[0]?.toUpperCase() || '?'

  return (
    <div className="min-h-screen pb-safe" style={{ background: '#0a0908' }}>
      {/* Header */}
      <div className="px-6 pt-12 pb-6"
        style={{ background: 'linear-gradient(180deg, #12100e 0%, transparent 100%)' }}>
        <p className="text-xs tracking-[0.2em] uppercase mb-1" style={{ color: '#5a5248' }}>Your</p>
        <h1 className="font-display text-4xl font-light" style={{ color: '#e8d5a3', fontStyle: 'italic' }}>
          Account
        </h1>
      </div>

      <div className="px-6 space-y-4 pb-6">

        {/* Avatar + name hero */}
        <div className="flex items-center gap-4 fade-in">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center font-display text-2xl flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
            {initials}
          </div>
          <div>
            <p className="font-display text-xl font-light" style={{ color: '#e8d5a3' }}>
              {form.full_name || 'Traveller'}
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#5a5248' }}>{user?.email}</p>
            {user?.created_at?.seconds && (
              <p className="text-xs mt-0.5" style={{ color: '#3d3830' }}>
                Member since {format(new Date(user.created_at.seconds * 1000), 'MMMM yyyy')}
              </p>
            )}
          </div>
        </div>

        {/* Stats grid */}
        {stats && (
          <div className="space-y-3 fade-in">
            <div className="grid grid-cols-2 gap-3">
              <StatCard icon="✈️" value={stats.trips} label="Total trips" />
              <StatCard icon="🗓️" value={stats.upcoming} label="Upcoming" />
              <StatCard icon="🤝" value={stats.partners} label="Travel partners" />
              <StatCard icon="🌍" value={stats.topPartners.length > 0 ? stats.topPartners[0].full_name?.split(' ')[0] : '—'} label="Top partner" small />
            </div>

            {/* Top 3 partners */}
            {stats.topPartners.length > 0 && (
              <Section title="Top Travel Partners">
                {stats.topPartners.map((partner, i) => (
                  <div key={partner.id}
                    className="flex items-center gap-3 px-5 py-3.5"
                    style={{ borderBottom: i < stats.topPartners.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                    {/* Rank */}
                    <span className="font-display text-lg font-light flex-shrink-0 w-5 text-center"
                      style={{ color: i === 0 ? '#d4b87a' : i === 1 ? '#b5aea4' : '#5a5248' }}>
                      {i + 1}
                    </span>
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full flex items-center justify-center font-display text-sm flex-shrink-0"
                      style={{ background: i === 0 ? 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)' : 'rgba(255,255,255,0.07)', color: i === 0 ? '#0a0908' : '#b5aea4' }}>
                      {partner.full_name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: '#d4cfc8' }}>{partner.full_name}</p>
                      <p className="text-xs" style={{ color: '#5a5248' }}>
                        {partner.sharedTrips} trip{partner.sharedTrips !== 1 ? 's' : ''} together
                      </p>
                    </div>
                    {i === 0 && (
                      <span className="text-base flex-shrink-0">🏆</span>
                    )}
                  </div>
                ))}
              </Section>
            )}
          </div>
        )}

        {/* Recent trips */}
        {recentTrips.length > 0 && (
          <Section title="Recent Trips">
            {recentTrips.map((trip, i) => {
              const today = new Date().toISOString().slice(0, 10)
              const isPast = trip.end_date && trip.end_date < today
              const isActive = trip.start_date <= today && trip.end_date >= today
              return (
                <button key={trip.id}
                  onClick={() => navigate(`/trips/${trip.id}`)}
                  className="w-full flex items-center gap-3 px-5 py-3.5 text-left transition-all active:opacity-70"
                  style={{ borderBottom: i < recentTrips.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                  <span className="text-xl flex-shrink-0">{trip.cover_emoji || '✈️'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: isPast ? '#5a5248' : '#d4cfc8' }}>
                      {trip.name}
                    </p>
                    <p className="text-xs" style={{ color: '#3d3830' }}>
                      {trip.destination}
                      {trip.start_date && ` · ${format(parseISO(trip.start_date), 'MMM d')}`}
                    </p>
                  </div>
                  {isActive && (
                    <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: 'rgba(138,171,142,0.2)', color: '#8aab8e' }}>
                      Now
                    </span>
                  )}
                  <ChevronRight size={14} style={{ color: '#3d3830', flexShrink: 0 }} />
                </button>
              )
            })}
          </Section>
        )}

        {/* Profile editor */}
        <Section title="Profile">
          <EditField
            label="Full Name"
            value={form.full_name}
            placeholder="Your name"
            onChange={v => handleChange('full_name', v)}
            icon={<User size={14} />}
          />
          <EditField
            label="Home City"
            value={form.home_city}
            placeholder="e.g. London, New York"
            onChange={v => handleChange('home_city', v)}
            icon={<Globe size={14} />}
          />
          <EditField
            label="Home Airport (IATA code)"
            value={form.home_airport}
            placeholder="e.g. LHR, JFK, LAX"
            onChange={v => handleChange('home_airport', v.toUpperCase().slice(0, 4))}
            icon={<Plane size={14} />}
          />

          {/* Save button */}
          <div className="px-5 py-4">
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="w-full py-3 rounded-xl text-sm font-medium transition-all active:scale-95 flex items-center justify-center gap-2"
              style={{
                background: saved
                  ? 'rgba(138,171,142,0.2)'
                  : dirty
                    ? 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)'
                    : 'rgba(255,255,255,0.04)',
                color: saved ? '#8aab8e' : dirty ? '#0a0908' : '#3d3830',
                cursor: dirty ? 'pointer' : 'default',
              }}>
              {saving ? 'Saving…' : saved ? <><Check size={14} /> Saved</> : 'Save Changes'}
            </button>
          </div>
        </Section>

        {/* Account actions */}
        <Section title="Account">
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-5 py-4 text-left transition-all active:opacity-70"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <LogOut size={16} style={{ color: '#5a5248', flexShrink: 0 }} />
            <span className="text-sm" style={{ color: '#d4cfc8' }}>Sign Out</span>
          </button>

          <button
            onClick={() => setShowDelete(true)}
            className="w-full flex items-center gap-3 px-5 py-4 text-left transition-all active:opacity-70">
            <Trash2 size={16} style={{ color: '#c47c5a', flexShrink: 0 }} />
            <span className="text-sm" style={{ color: '#c47c5a' }}>Delete Account</span>
          </button>
        </Section>

        {/* App version */}
        <p className="text-center text-xs pb-2" style={{ color: '#2a2621' }}>
          wander · v1.0
        </p>
      </div>

      <BottomNav active="account" />

      {showDelete && (
        <DeleteModal
          loading={deleting}
          onConfirm={handleDelete}
          onClose={() => setShowDelete(false)}
        />
      )}
    </div>
  )
}