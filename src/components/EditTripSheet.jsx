import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  doc, updateDoc, deleteDoc, collection, query, where, getDocs,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { geocodeCity } from '../lib/weather'
import { X, Smile, Trash2, AlertTriangle } from 'lucide-react'
import TimezonePicker from './TimezonePicker'
import { nearestTimezone } from '../lib/timezones'

const PRESET_EMOJIS = [
  '✈️','🏝️','🗻','🌆','🏔️','🏖️','🌍','🗼','🎡','🚂',
  '⛵','🏕️','🌸','🎭','🍜','🏯','🌋','🏜️','🛸','🚁',
  '🌊','🏛️','🎪','🍣','🥂','🎿','🤿','🧗','🛶','🌺',
]

const EMOJI_CATEGORIES = [
  { label: 'Travel',     emojis: ['✈️','🚂','🚢','🚁','🛸','🚡','🛺','🚤','⛵','🛥️','🚀','🛩️','🚃','🚌','🏎️','🚓','🛻','🚜','🏍️','🛵','🚲','🛴','🛹','🛼','🚀','🛶','🚣','🏇','🚵','🤿'] },
  { label: 'Places',     emojis: ['🏝️','🗻','🌆','🏔️','🏖️','🌍','🗼','🎡','🏕️','🌋','🏜️','🏛️','🗽','🗿','🏯','🏰','🎠','🎢','🎪','⛩️','🕌','🛕','⛪','🕍','🏟️','🌃','🌉','🌁','🌄','🌅'] },
  { label: 'Nature',     emojis: ['🌸','🌺','🌻','🌹','🌷','🍀','🌿','🍃','🌴','🌵','🌾','🍄','🌊','🌈','⛄','🌙','☀️','⭐','🌤️','⛅','🌦️','🌧️','⛈️','❄️','🌬️','🌀','🌪️','🔥','💧','🌏'] },
  { label: 'Food',       emojis: ['🍜','🍣','🥂','🍕','🍔','🌮','🍱','🍛','🥘','🍲','🥗','🍤','🦞','🦀','🥩','🍗','🧀','🥞','🧇','🥐','🥖','🧆','🥙','🌯','🍦','🍰','🎂','🍩','🍫','🥃'] },
  { label: 'Activities', emojis: ['🎿','🤿','🧗','🛶','🏄','🚵','🪂','🏊','🧘','🤸','🏋️','⛷️','🛷','🏇','🚣','🏌️','🎾','⛳','🎣','🤺','🥊','🥋','🎽','🛹','🏆','🎖️','🥇','🎯','🎱','🎮'] },
  { label: 'Objects',    emojis: ['📸','🎭','🎨','🎬','🎤','🎧','🎼','📷','🔭','🔬','💎','👑','🗺️','🧭','⌚','💼','🎒','👜','🧳','☂️','🌂','🎁','🏮','🪔','🕯️','💡','🔦','📚','📖','✏️'] },
]

export default function EditTripSheet({ trip, onClose, onSaved }) {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name:         trip.name        || '',
    destination:  trip.destination || '',
    start_date:   trip.start_date  || '',
    end_date:     trip.end_date    || '',
    cover_emoji:  trip.cover_emoji || '✈️',
    timezone:     trip.timezone    || nearestTimezone(null),
  })
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')
  const [showPicker, setShowPicker]   = useState(false)
  const [pickerCat, setPickerCat]     = useState(0)
  const [customInput, setCustomInput] = useState('')
  const [showDelete, setShowDelete]   = useState(false)
  const [deleting, setDeleting]       = useState(false)

  function handleCustomInput(val) {
    setCustomInput(val)
    const match = val.match(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/u)
    if (match) { setForm({ ...form, cover_emoji: match[0] }); setCustomInput(match[0]) }
  }

  async function handleSave() {
    if (!form.name.trim() || !form.destination.trim()) { setError('Name and destination are required.'); return }
    setSaving(true); setError('')

    let lat = trip.lat, lon = trip.lon
    if (form.destination.trim() !== trip.destination.trim()) {
      const geo = await geocodeCity(form.destination)
      if (geo) { lat = geo.lat; lon = geo.lon }
    }

    await updateDoc(doc(db, 'trips', trip.id), {
      name:        form.name,
      destination: form.destination,
      start_date:  form.start_date  || null,
      end_date:    form.end_date    || null,
      cover_emoji: form.cover_emoji,
      timezone:    form.timezone    || null,
      lat, lon,
      updated_at:  serverTimestamp(),
    })

    setSaving(false)
    onSaved()
    onClose()
  }

  // Cascade-delete the trip plus the bits whose rules let us reach across users:
  // trip_members, date_polls (and their availability docs). Per-user content
  // (events, polls, photos, legs, accoms) becomes invisible orphans because
  // every list query in the app filters by trip_id.
  async function handleDelete() {
    setDeleting(true)
    try {
      const [memSnap, datePollSnap, dateAvailSnap] = await Promise.all([
        getDocs(query(collection(db, 'trip_members'),      where('trip_id', '==', trip.id))),
        getDocs(query(collection(db, 'date_polls'),        where('trip_id', '==', trip.id))),
        getDocs(query(collection(db, 'date_availability'), where('trip_id', '==', trip.id))),
      ])
      await Promise.all([
        ...memSnap.docs.map(d       => deleteDoc(d.ref)),
        ...dateAvailSnap.docs.map(d => deleteDoc(d.ref)),
        ...datePollSnap.docs.map(d  => deleteDoc(d.ref)),
      ])
      await deleteDoc(doc(db, 'trips', trip.id))
      navigate('/')
    } catch (e) {
      setError(e.message?.replace('Firebase: ', '') || 'Could not delete trip.')
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-lg rounded-t-3xl slide-up overflow-hidden"
        style={{ background: '#1c1916', border: '1px solid rgba(212,184,122,0.14)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <h2 className="font-display text-2xl font-light" style={{ color: '#e8d5a3', fontStyle: 'italic' }}>Edit Trip</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.06)' }}>
            <X size={14} style={{ color: '#5a5248' }} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 pb-8 space-y-5">
          {error && (
            <div className="px-4 py-3 rounded-xl text-sm"
              style={{ background: 'rgba(196,124,90,0.15)', border: '1px solid rgba(196,124,90,0.3)', color: '#c47c5a' }}>
              {error}
            </div>
          )}

          {/* Emoji */}
          <div>
            <p className="text-xs tracking-widest uppercase mb-3" style={{ color: '#5a5248' }}>Cover Emoji</p>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-4xl flex-shrink-0"
                style={{ background: 'rgba(212,184,122,0.12)', border: '2px solid rgba(212,184,122,0.3)' }}>
                {form.cover_emoji}
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(212,184,122,0.15)' }}>
                  <span className="text-xs" style={{ color: '#5a5248' }}>Type:</span>
                  <input value={customInput} onChange={e => handleCustomInput(e.target.value)}
                    placeholder="Paste or type any emoji…"
                    className="flex-1 bg-transparent text-sm outline-none" style={{ color: '#d4cfc8' }} />
                </div>
                <button onClick={() => setShowPicker(!showPicker)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs w-full transition-all"
                  style={{
                    background: showPicker ? 'rgba(212,184,122,0.15)' : 'rgba(255,255,255,0.04)',
                    border: showPicker ? '1px solid rgba(212,184,122,0.3)' : '1px solid rgba(212,184,122,0.12)',
                    color: showPicker ? '#d4b87a' : '#5a5248',
                  }}>
                  <Smile size={12} />{showPicker ? 'Hide picker' : 'Browse emoji'}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 mb-2">
              {PRESET_EMOJIS.map(e => (
                <button key={e} onClick={() => { setForm({ ...form, cover_emoji: e }); setCustomInput('') }}
                  className="w-9 h-9 rounded-xl text-lg flex items-center justify-center transition-all active:scale-90"
                  style={{
                    background: form.cover_emoji === e ? 'rgba(212,184,122,0.2)' : 'rgba(255,255,255,0.04)',
                    border: form.cover_emoji === e ? '1px solid rgba(212,184,122,0.4)' : '1px solid transparent',
                    transform: form.cover_emoji === e ? 'scale(1.15)' : 'scale(1)',
                  }}>{e}</button>
              ))}
            </div>

            {showPicker && (
              <div className="rounded-2xl overflow-hidden slide-up"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(212,184,122,0.1)' }}>
                <div className="flex overflow-x-auto gap-1 p-2" style={{ scrollbarWidth: 'none' }}>
                  {EMOJI_CATEGORIES.map((cat, i) => (
                    <button key={i} onClick={() => setPickerCat(i)}
                      className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs transition-all"
                      style={{
                        background: pickerCat === i ? 'rgba(212,184,122,0.2)' : 'transparent',
                        color: pickerCat === i ? '#d4b87a' : '#5a5248',
                        border: pickerCat === i ? '1px solid rgba(212,184,122,0.25)' : '1px solid transparent',
                      }}>{cat.label}</button>
                  ))}
                </div>
                <div className="grid p-3 gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(2.5rem, 1fr))' }}>
                  {EMOJI_CATEGORIES[pickerCat].emojis.map(e => (
                    <button key={e} onClick={() => { setForm({ ...form, cover_emoji: e }); setCustomInput(''); setShowPicker(false) }}
                      className="w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-all active:scale-90 hover:scale-110"
                      style={{
                        background: form.cover_emoji === e ? 'rgba(212,184,122,0.2)' : 'transparent',
                        border: form.cover_emoji === e ? '1px solid rgba(212,184,122,0.35)' : '1px solid transparent',
                      }}>{e}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Text fields */}
          <div className="space-y-4">
            <Field label="Trip Name *">
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Summer in Japan"
                className="w-full bg-transparent text-sm outline-none" style={{ color: '#d4cfc8' }} />
            </Field>
            <Field label="Destination *">
              <input value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })}
                placeholder="City or country"
                className="w-full bg-transparent text-sm outline-none" style={{ color: '#d4cfc8' }} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Start Date">
                <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })}
                  className="w-full bg-transparent text-sm outline-none" style={{ color: '#d4cfc8', background: 'transparent' }} />
              </Field>
              <Field label="End Date">
                <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })}
                  className="w-full bg-transparent text-sm outline-none" style={{ color: '#d4cfc8', background: 'transparent' }} />
              </Field>
            </div>
            <Field label="Destination Timezone">
              <TimezonePicker
                value={form.timezone}
                onChange={v => setForm({ ...form, timezone: v })}
              />
            </Field>
          </div>

          <button onClick={handleSave} disabled={saving}
            className="w-full py-4 rounded-2xl font-medium tracking-wider transition-all active:scale-95"
            style={{ background: saving ? '#3d3830' : 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>

          {/* Danger zone */}
          <div className="pt-4 mt-2" style={{ borderTop: '1px solid rgba(196,124,90,0.15)' }}>
            <p className="text-xs tracking-widest uppercase mb-2" style={{ color: '#5a5248' }}>
              Danger Zone
            </p>
            <button onClick={() => setShowDelete(true)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm transition-all active:scale-95"
              style={{
                background: 'rgba(196,124,90,0.08)',
                border: '1px solid rgba(196,124,90,0.25)',
                color: '#c47c5a',
              }}>
              <Trash2 size={13} /> Delete this trip
            </button>
          </div>
        </div>

        {showDelete && (
          <DeleteTripModal
            tripName={trip.name}
            deleting={deleting}
            onCancel={() => setShowDelete(false)}
            onConfirm={handleDelete}
          />
        )}
      </div>
    </div>
  )
}

function DeleteTripModal({ tripName, deleting, onCancel, onConfirm }) {
  const [confirmText, setConfirmText] = useState('')
  const armed = confirmText.trim().toLowerCase() === (tripName || '').trim().toLowerCase()

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center"
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
              <p className="font-medium text-sm" style={{ color: '#e8d5a3' }}>Delete trip</p>
              <p className="text-xs mt-0.5" style={{ color: '#5a5248' }}>This cannot be undone</p>
            </div>
          </div>
          <button onClick={onCancel} style={{ color: '#5a5248' }}><X size={16} /></button>
        </div>

        <p className="text-sm mb-5" style={{ color: '#b5aea4' }}>
          The trip, all members, and date polls will be deleted permanently.
          Everyone in this trip will lose access immediately.
        </p>

        <p className="text-xs tracking-widest uppercase mb-2" style={{ color: '#5a5248' }}>
          Type <span style={{ color: '#c47c5a' }}>{tripName}</span> to confirm
        </p>
        <input
          autoFocus
          value={confirmText}
          onChange={e => setConfirmText(e.target.value)}
          placeholder={tripName}
          className="w-full px-4 py-3 rounded-xl text-sm outline-none mb-4"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(196,124,90,0.3)',
            color: '#d4cfc8',
          }}
        />

        <div className="flex gap-3">
          <button onClick={onCancel}
            className="flex-1 py-3 rounded-xl text-sm"
            style={{ background: 'rgba(255,255,255,0.05)', color: '#5a5248' }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={!armed || deleting}
            className="flex-1 py-3 rounded-xl text-sm font-medium transition-all active:scale-95"
            style={{
              background: !armed || deleting ? '#3d3830' : 'rgba(196,124,90,0.85)',
              color: !armed || deleting ? '#5a5248' : '#fff',
            }}>
            {deleting ? 'Deleting…' : 'Delete trip'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '10px' }}>
      <p className="text-xs tracking-widest uppercase mb-2" style={{ color: '#5a5248' }}>{label}</p>
      {children}
    </div>
  )
}
