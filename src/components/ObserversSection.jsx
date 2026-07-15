import { useState, useEffect } from 'react'
import {
  collection, query, where, getDocs, addDoc, deleteDoc, doc, getDoc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { Eye, Plus, Check, Trash2, UserPlus, Sparkles } from 'lucide-react'

// Observers are people who can view a trip without travelling on it. BCC-style:
// you only ever see the observers *you* added, and observers never see each
// other. That privacy is enforced here in the UI (see the note in the rules).
export default function ObserversSection({ tripId, members = [], currentUser, friends = [], onMembersChanged }) {
  const [observers, setObservers] = useState([])   // {docId, user_id, name, email} added by me
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => { load() }, [tripId, currentUser?.id])

  async function load() {
    if (!currentUser?.id) return
    const snap = await getDocs(query(
      collection(db, 'trip_observers'),
      where('trip_id', '==', tripId),
      where('added_by', '==', currentUser.id),   // BCC: only the ones I added
    ))
    const rows = await Promise.all(snap.docs.map(async d => {
      const data = d.data()
      const p = await getDoc(doc(db, 'profiles', data.user_id))
      return {
        docId: d.id,
        user_id: data.user_id,
        name: p.exists() ? (p.data().full_name || 'Unknown') : 'Unknown',
        email: p.exists() ? p.data().email : '',
      }
    }))
    rows.sort((a, b) => a.name.localeCompare(b.name))
    setObservers(rows)
  }

  // Add a resolved profile as an observer. Returns an error string, or '' on success.
  async function addProfile(profile) {
    if (profile.id === currentUser.id) return "You can't observe your own trip."
    if (members.some(m => m.id === profile.id)) return `${profile.full_name} is already a traveller.`
    if (observers.some(o => o.user_id === profile.id)) return `${profile.full_name} is already observing.`
    await addDoc(collection(db, 'trip_observers'), {
      trip_id: tripId, user_id: profile.id, added_by: currentUser.id, created_at: serverTimestamp(),
    })
    return ''
  }

  async function addByEmail() {
    const addr = email.trim().toLowerCase()
    if (!addr) return
    setBusy(true); setMsg('')
    const snap = await getDocs(query(collection(db, 'profiles'), where('email', '==', addr)))
    if (snap.empty) { setMsg('No user found with that email.'); setBusy(false); return }
    const profile = { id: snap.docs[0].id, ...snap.docs[0].data() }
    const err = await addProfile(profile)
    setMsg(err || `${profile.full_name} can now view this trip.`)
    if (!err) setEmail('')
    setBusy(false); load()
  }

  async function addFriend(friend) {
    setBusy(true); setMsg('')
    const err = await addProfile({ id: friend.id, full_name: friend.full_name })
    setMsg(err || `${friend.full_name} can now view this trip.`)
    setBusy(false); load()
  }

  async function removeObserver(docId) {
    await deleteDoc(doc(db, 'trip_observers', docId)); load()
  }

  // Observer → traveller: drop the observer record and add a membership.
  async function promote(o) {
    await deleteDoc(doc(db, 'trip_observers', o.docId))
    await addDoc(collection(db, 'trip_members'), {
      trip_id: tripId, user_id: o.user_id, role: 'member', created_at: serverTimestamp(),
    })
    setMsg(`${o.name} is now a traveller.`)
    load(); onMembersChanged?.()
  }

  const observerIds = new Set(observers.map(o => o.user_id))
  const friendCandidates = friends.filter(f => !observerIds.has(f.id) && !members.some(m => m.id === f.id))

  return (
    <div className="glass rounded-2xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <Eye size={15} style={{ color: '#7a9ab5' }} />
          <span className="text-sm" style={{ color: '#d4cfc8' }}>Observers</span>
          {observers.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(122,154,181,0.15)', color: '#7a9ab5' }}>{observers.length}</span>
          )}
        </div>
        <Plus size={16} style={{ color: '#5a5248', transform: open ? 'rotate(45deg)' : 'none', transition: 'transform .2s' }} />
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-3 slide-up">
          <p className="text-xs" style={{ color: '#5a5248' }}>
            Observers can view this trip but aren’t travelling. They can’t see each other,
            and other travellers won’t see the observers you add.
          </p>

          {observers.map(o => (
            <div key={o.docId} className="flex items-center justify-between gap-2 group">
              <div className="min-w-0">
                <p className="text-sm truncate" style={{ color: '#d4cfc8' }}>{o.name}</p>
                {o.email && <p className="text-xs truncate" style={{ color: '#5a5248' }}>{o.email}</p>}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => promote(o)} className="flex items-center gap-1 text-xs" style={{ color: '#d4b87a' }} title="Make a traveller">
                  <UserPlus size={12} />Make traveller
                </button>
                <button onClick={() => removeObserver(o.docId)} style={{ color: '#c47c5a' }} title="Remove observer">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}

          {friendCandidates.length > 0 && (
            <div>
              <p className="text-xs tracking-widest uppercase mb-2 flex items-center gap-1.5" style={{ color: '#5a5248' }}>
                <Sparkles size={10} style={{ color: '#7a9ab5' }} />From your friends
              </p>
              <div className="flex flex-wrap gap-1.5">
                {friendCandidates.map(f => (
                  <button key={f.id} onClick={() => addFriend(f)} disabled={busy}
                    className="flex items-center gap-1.5 pl-1 pr-3 py-1 rounded-full text-xs transition-all active:scale-95"
                    style={{ background: 'rgba(122,154,181,0.08)', border: '1px solid rgba(122,154,181,0.2)', color: '#7a9ab5' }}>
                    <span className="w-5 h-5 rounded-full flex items-center justify-center font-medium flex-shrink-0"
                      style={{ background: 'rgba(122,154,181,0.9)', color: '#0a0908', fontSize: '10px' }}>
                      {f.full_name?.[0]?.toUpperCase() || '?'}
                    </span>
                    {f.full_name?.split(' ')[0]}
                    <Plus size={10} />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && email && addByEmail()}
              placeholder={friendCandidates.length ? 'Or add by email' : 'Add observer by email'}
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: '#d4cfc8', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' }} />
            <button onClick={addByEmail} disabled={busy || !email}
              className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1"
              style={{ background: 'rgba(122,154,181,0.15)', color: '#7a9ab5' }}>
              {busy ? '…' : <><Check size={12} />Add</>}
            </button>
          </div>

          {msg && (
            <p className="text-xs" style={{ color: /view this trip|a traveller/.test(msg) ? '#8aab8e' : '#c47c5a' }}>{msg}</p>
          )}
        </div>
      )}
    </div>
  )
}