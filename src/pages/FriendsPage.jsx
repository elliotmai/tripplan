import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  listFriendships, fetchProfiles, findProfileByEmail,
  sendFriendRequest, acceptFriendRequest, removeFriendship,
  partitionFriendships, otherUid,
  FRIENDSHIP_SOURCE,
} from '../lib/friends'
import { UserPlus, Check, X, Mail, Users, Plane } from 'lucide-react'
import BottomNav from '../components/BottomNav'

export default function FriendsPage() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [friendships, setFriendships] = useState([])
  const [profiles, setProfiles] = useState({})    // uid → profile
  const [email, setEmail] = useState('')
  const [adding, setAdding] = useState(false)
  const [feedback, setFeedback] = useState(null)  // { type, text }

  useEffect(() => { if (user?.id) load() }, [user?.id])

  async function load() {
    setLoading(true)
    const fs = await listFriendships(user.id)
    const otherIds = fs.map(f => otherUid(f, user.id))
    const profs = await fetchProfiles(otherIds)
    setProfiles(Object.fromEntries(profs.map(p => [p.id, p])))
    setFriendships(fs)
    setLoading(false)
  }

  const { accepted, incoming, outgoing } = useMemo(
    () => partitionFriendships(friendships, user?.id),
    [friendships, user?.id],
  )

  async function handleAdd() {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) return
    setAdding(true); setFeedback(null)
    try {
      if (trimmed === user.email?.toLowerCase()) {
        setFeedback({ type: 'error', text: "That's you!" })
        return
      }
      const profile = await findProfileByEmail(trimmed)
      if (!profile) {
        setFeedback({ type: 'error', text: 'No Wander user with that email.' })
        return
      }
      const result = await sendFriendRequest(user.id, profile.id)
      const messages = {
        sent:              `Request sent to ${profile.full_name}.`,
        accepted:          `You're now friends with ${profile.full_name}!`,
        'already-friends': `You're already friends with ${profile.full_name}.`,
        self:              "That's you!",
      }
      setFeedback({
        type: result === 'sent' || result === 'accepted' ? 'success' : 'info',
        text: messages[result],
      })
      setEmail('')
      await load()
    } finally {
      setAdding(false)
    }
  }

  async function accept(id) {
    await acceptFriendRequest(id)
    await load()
  }

  async function remove(id, confirmText) {
    if (confirmText && !confirm(confirmText)) return
    await removeFriendship(id)
    await load()
  }

  return (
    <div className="min-h-screen pb-safe" style={{ background: '#0a0908' }}>

      {/* Header */}
      <div className="px-6 pt-12 pb-6"
        style={{ background: 'linear-gradient(180deg, #12100e 0%, transparent 100%)' }}>
        <p className="text-xs tracking-[0.2em] uppercase mb-1" style={{ color: '#5a5248' }}>Your</p>
        <h1 className="font-display text-4xl font-light" style={{ color: '#e8d5a3', fontStyle: 'italic' }}>
          Friends
        </h1>
      </div>

      <div className="px-6 space-y-4 pb-24">

        {/* Add by email */}
        <div className="glass rounded-2xl p-5 fade-in">
          <p className="text-xs tracking-widest uppercase mb-3" style={{ color: '#5a5248' }}>
            Add a Friend
          </p>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-2 px-4 py-3 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(212,184,122,0.15)' }}>
              <Mail size={14} style={{ color: '#5a5248', flexShrink: 0 }} />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="friend@email.com"
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: '#d4cfc8' }}
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={adding || !email}
              className="px-4 py-3 rounded-xl flex items-center justify-center transition-all active:scale-95"
              style={{
                background: adding || !email ? '#3d3830' : 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)',
                color: adding || !email ? '#5a5248' : '#0a0908',
              }}>
              <UserPlus size={16} />
            </button>
          </div>
          {feedback && (
            <p className="text-xs mt-2" style={{
              color: feedback.type === 'success' ? '#8aab8e'
                : feedback.type === 'error' ? '#c47c5a' : '#7a9ab5',
            }}>
              {feedback.text}
            </p>
          )}
        </div>

        {/* Incoming requests */}
        {incoming.length > 0 && (
          <Section title="Incoming requests" count={incoming.length}>
            {incoming.map((f, i) => {
              const uid = otherUid(f, user.id)
              const p = profiles[uid]
              return (
                <Row key={f.id}
                  profile={p}
                  source={f.source}
                  isLast={i === incoming.length - 1}>
                  <button onClick={() => accept(f.id)}
                    className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 transition-all active:scale-95"
                    style={{ background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
                    <Check size={11} /> Accept
                  </button>
                  <button onClick={() => remove(f.id)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center transition-all active:scale-95"
                    style={{ background: 'rgba(196,124,90,0.12)', color: '#c47c5a' }}
                    title="Decline">
                    <X size={11} />
                  </button>
                </Row>
              )
            })}
          </Section>
        )}

        {/* Friends list */}
        <Section
          title="Friends"
          count={accepted.length}
          empty={accepted.length === 0 && !loading
            ? 'No friends yet — add by email above, or invite someone to a trip.'
            : null}>
          {accepted.map((f, i) => {
            const uid = otherUid(f, user.id)
            const p = profiles[uid]
            return (
              <Row key={f.id}
                profile={p}
                source={f.source}
                isLast={i === accepted.length - 1}>
                <button onClick={() => remove(f.id, `Remove ${p?.full_name || 'this friend'}?`)}
                  className="text-xs px-2.5 py-1 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                  style={{ background: 'rgba(196,124,90,0.1)', color: '#c47c5a' }}>
                  Remove
                </button>
              </Row>
            )
          })}
        </Section>

        {/* Outgoing requests */}
        {outgoing.length > 0 && (
          <Section title="Pending sent" count={outgoing.length}>
            {outgoing.map((f, i) => {
              const uid = otherUid(f, user.id)
              const p = profiles[uid]
              return (
                <Row key={f.id}
                  profile={p}
                  source={f.source}
                  isLast={i === outgoing.length - 1}
                  muted>
                  <span className="text-xs" style={{ color: '#5a5248' }}>Pending</span>
                  <button onClick={() => remove(f.id)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center transition-all active:scale-95"
                    style={{ background: 'rgba(255,255,255,0.04)', color: '#5a5248' }}
                    title="Cancel request">
                    <X size={11} />
                  </button>
                </Row>
              )
            })}
          </Section>
        )}

        {loading && (
          <div className="space-y-3 pt-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 rounded-2xl shimmer" style={{ background: '#1c1916' }} />
            ))}
          </div>
        )}
      </div>

      <BottomNav active="friends" />
    </div>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function Section({ title, count, empty, children }) {
  return (
    <div className="glass rounded-2xl overflow-hidden fade-in">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <p className="text-xs tracking-widest uppercase" style={{ color: '#5a5248' }}>{title}</p>
        {count > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(212,184,122,0.1)', color: '#d4b87a' }}>
            {count}
          </span>
        )}
      </div>
      {empty ? (
        <p className="text-sm text-center py-8 px-5" style={{ color: '#5a5248' }}>{empty}</p>
      ) : children}
    </div>
  )
}

function Row({ profile, source, children, isLast, muted }) {
  const name = profile?.full_name || 'Unknown'
  const email = profile?.email || ''
  const initial = name[0]?.toUpperCase() || '?'
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 group"
      style={{
        borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.05)',
        opacity: muted ? 0.7 : 1,
      }}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center font-display text-base flex-shrink-0"
        style={{ background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" style={{ color: '#d4cfc8' }}>{name}</p>
        <p className="text-xs truncate flex items-center gap-1.5" style={{ color: '#5a5248' }}>
          {source === FRIENDSHIP_SOURCE.TRIP && (
            <>
              <Plane size={9} style={{ color: '#7a9ab5' }} />
              <span style={{ color: '#7a9ab5' }}>via trip</span>
              <span style={{ color: '#3d3830' }}>·</span>
            </>
          )}
          {email}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {children}
      </div>
    </div>
  )
}
