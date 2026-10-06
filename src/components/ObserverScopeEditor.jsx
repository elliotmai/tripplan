import { useState, useEffect } from 'react'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { Check } from 'lucide-react'
import { normalizeScope, legKey, stayKey } from '../lib/observerScope'

const MODES = [
  { id: 'all', label: 'All' },
  { id: 'people', label: 'By person' },
  { id: 'items', label: 'Pick' },
  { id: 'none', label: 'None' },
]

const firstName = n => (n || '').split(' ')[0] || 'Unknown'

function legLabel(leg) {
  const route = [leg.from, leg.to].filter(Boolean).join(' → ') || 'Leg'
  const when = leg.depart_at ? leg.depart_at.slice(5, 10).replace('-', '/') : ''
  return [leg.number, route, when].filter(Boolean).join(' · ')
}

function stayLabel(accom) {
  const when = accom.check_in ? accom.check_in.slice(5).replace('-', '/') : ''
  return ['🏨 ' + (accom.name || accom.address || 'Stay'), when].filter(Boolean).join(' · ')
}

function eventLabel(e) {
  const when = e.date ? e.date.slice(5).replace('-', '/') : ''
  return [e.title || 'Event', when, e.time].filter(Boolean).join(' · ')
}

function Chip({ on, onClick, children }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs transition-all active:scale-95"
      style={{
        background: on ? 'rgba(122,154,181,0.2)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${on ? 'rgba(122,154,181,0.45)' : 'rgba(255,255,255,0.08)'}`,
        color: on ? '#a9c3d9' : '#7a7066',
      }}>
      {on && <Check size={10} />}{children}
    </button>
  )
}

function AreaPicker({ title, area, onChange, members, items, emptyText }) {
  const toggle = id => onChange({
    ...area, ids: area.ids.includes(id) ? area.ids.filter(x => x !== id) : [...area.ids, id],
  })
  return (
    <div className="space-y-2">
      <p className="text-xs tracking-widest uppercase" style={{ color: '#5a5248' }}>{title}</p>
      <div className="flex gap-1">
        {MODES.map(m => (
          <button key={m.id} onClick={() => onChange({ mode: m.id, ids: m.id === area.mode ? area.ids : [] })}
            className="flex-1 py-1.5 rounded-lg text-xs transition-all"
            style={{
              background: area.mode === m.id ? 'rgba(122,154,181,0.18)' : 'transparent',
              border: `1px solid ${area.mode === m.id ? 'rgba(122,154,181,0.35)' : 'rgba(255,255,255,0.06)'}`,
              color: area.mode === m.id ? '#a9c3d9' : '#5a5248',
            }}>
            {m.label}
          </button>
        ))}
      </div>

      {area.mode === 'people' && (
        <div className="flex flex-wrap gap-1.5">
          {members.map(m => (
            <Chip key={m.id} on={area.ids.includes(m.id)} onClick={() => toggle(m.id)}>
              {firstName(m.full_name)}
            </Chip>
          ))}
        </div>
      )}

      {area.mode === 'items' && (
        items == null
          ? <p className="text-xs" style={{ color: '#5a5248' }}>Loading…</p>
          : items.length === 0
            ? <p className="text-xs" style={{ color: '#5a5248' }}>{emptyText}</p>
            : (
              <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                {items.map(it => {
                  const on = area.ids.includes(it.key)
                  return (
                    <button key={it.key} onClick={() => toggle(it.key)}
                      className="w-full flex items-center gap-2 text-left text-xs py-1">
                      <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                        style={{
                          border: `1px solid ${on ? 'rgba(122,154,181,0.6)' : 'rgba(255,255,255,0.15)'}`,
                          background: on ? 'rgba(122,154,181,0.25)' : 'transparent',
                        }}>
                        {on && <Check size={10} style={{ color: '#a9c3d9' }} />}
                      </span>
                      <span className="truncate" style={{ color: on ? '#d4cfc8' : '#7a7066' }}>{it.label}</span>
                    </button>
                  )
                })}
              </div>
            )
      )}
    </div>
  )
}

// Edit what one observer can see. `legs` / `accoms` are the normalized lists
// from lib/travel.js; events are loaded here on demand.
export default function ObserverScopeEditor({ tripId, scope, members, legs = [], accoms = [], onSave, onCancel }) {
  const [draft, setDraft] = useState(() => normalizeScope(scope))
  const [events, setEvents] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    getDocs(query(collection(db, 'itinerary_events'), where('trip_id', '==', tripId))).then(snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      rows.sort((a, b) => `${a.date || ''}${a.time || ''}`.localeCompare(`${b.date || ''}${b.time || ''}`))
      if (!cancelled) setEvents(rows)
    })
    return () => { cancelled = true }
  }, [tripId])

  const travelItems = [
    ...[...legs]
      .sort((a, b) => (a.depart_at || '').localeCompare(b.depart_at || ''))
      .map(l => ({ key: legKey(l), label: legLabel(l) })),
    ...accoms.map(a => ({ key: stayKey(a), label: stayLabel(a) })),
  ]
  const eventItems = events?.map(e => ({ key: e.id, label: eventLabel(e) }))

  async function save() {
    setSaving(true)
    await onSave(draft)
    setSaving(false)
  }

  return (
    <div className="mt-2 p-3 rounded-xl space-y-4"
      style={{ background: 'rgba(122,154,181,0.05)', border: '1px solid rgba(122,154,181,0.15)' }}>
      <AreaPicker title="Travel" area={draft.travel} members={members}
        items={travelItems} emptyText="No legs or stays yet."
        onChange={travel => setDraft(d => ({ ...d, travel }))} />
      <AreaPicker title="Events" area={draft.events} members={members}
        items={eventItems} emptyText="No events yet."
        onChange={evts => setDraft(d => ({ ...d, events: evts }))} />
      <p className="text-xs" style={{ color: '#5a5248' }}>
        “By person” includes anything added for them later. “Pick” is a fixed list.
        Observers never see polls, ideas, photos or history.
      </p>
      <div className="flex justify-end gap-3">
        <button onClick={onCancel} className="text-xs" style={{ color: '#5a5248' }}>Cancel</button>
        <button onClick={save} disabled={saving}
          className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1"
          style={{ background: 'rgba(122,154,181,0.15)', color: '#7a9ab5' }}>
          {saving ? '…' : <><Check size={12} />Save</>}
        </button>
      </div>
    </div>
  )
}
