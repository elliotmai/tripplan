import { useState } from 'react'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { geocodeCity } from '../lib/weather'
import { X, Smile } from 'lucide-react'

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
  const [form, setForm] = useState({
    name:         trip.name        || '',
    destination:  trip.destination || '',
    start_date:   trip.start_date  || '',
    end_date:     trip.end_date    || '',
    cover_emoji:  trip.cover_emoji || '✈️',
  })
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')
  const [showPicker, setShowPicker]   = useState(false)
  const [pickerCat, setPickerCat]     = useState(0)
  const [customInput, setCustomInput] = useState('')

  function handleCustomInput(val) {
    setCustomInput(val)
    const match = val.match(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/u)
    if (match) { setForm({ ...form, cover_emoji: match[0] }); setCustomInput(match[0]) }
  }

  async function handleSave() {
    if (!form.name.trim() || !form.destination.trim()) { setError('Name and destination are required.'); return }
    setSaving(true); setError('')

    // Re-geocode only if destination changed
    let lat = trip.lat, lon = trip.lon
    if (form.destination.trim() !== trip.destination.trim()) {
      const geo = await geocodeCity(form.destination)
      if (geo) { lat = geo.lat; lon = geo.lon }
    }

    await updateDoc(doc(db, 'trips', trip.id), {
      name:         form.name,
      destination:  form.destination,
      start_date:   form.start_date  || null,
      end_date:     form.end_date    || null,
      cover_emoji:  form.cover_emoji,
      lat, lon,
      updated_at:   serverTimestamp(),
    })

    setSaving(false)
    onSaved()
    onClose()
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

            {/* Presets */}
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
          </div>

          <button onClick={handleSave} disabled={saving}
            className="w-full py-4 rounded-2xl font-medium tracking-wider transition-all active:scale-95"
            style={{ background: saving ? '#3d3830' : 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
            {saving ? 'Saving…' : 'Save Changes'}
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
