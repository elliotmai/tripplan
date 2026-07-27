import { useState, useEffect } from 'react'
import {
  collection, query, where, getDocs,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { logActivity, fieldDiff, fieldSummaryLines } from '../lib/activity'
import { fetchWeatherForTrip } from '../lib/weather'
import { openInMaps } from '../lib/maps'
import { useAuth } from '../contexts/AuthContext'
import { formatTemp, isHour12, formatClock } from '../lib/format'
import { downloadICS, downloadCombinedICS } from '../lib/ical'
import { normalizeLegs, normalizeAccommodations } from '../lib/travel'
import { format } from 'date-fns'
import {
  Plus, Clock, MapPin, Trash2, ChevronDown, ArrowRight,
  Pencil, X, Check, CalendarDays, Users,
} from 'lucide-react'
import TimezonePicker from './TimezonePicker'
import { localTimezone } from '../lib/timezones'

// ─── constants ────────────────────────────────────────────────────────────────

const EVENT_TYPES = [
  { value: 'activity', label: 'Activity', color: '#8aab8e', emoji: '🎯' },
  { value: 'food', label: 'Food & Drink', color: '#d4b87a', emoji: '🍽️' },
  { value: 'transport', label: 'Transport', color: '#c47c5a', emoji: '🚌' },
  { value: 'accommodation', label: 'Stay', color: '#7a9ab5', emoji: '🏨' },
  { value: 'note', label: 'Note', color: '#5a5248', emoji: '📝' },
]

const TRANSPORT_META = {
  flight: { icon: '✈️', color: '#7a9ab5' },
  train: { icon: '🚂', color: '#8aab8e' },
  bus: { icon: '🚌', color: '#c47c5a' },
  car: { icon: '🚗', color: '#d4b87a' },
  ferry: { icon: '⛴️', color: '#7ab5b0' },
  subway: { icon: '🚇', color: '#9a8ab5' },
  taxi: { icon: '🚕', color: '#d4b87a' },
  walk: { icon: '🚶', color: '#8aab8e' },
  other: { icon: '🛸', color: '#9a8ab5' },
}

// Default times used to slot check-ins / check-outs into the day's order when
// no explicit time was provided on the accommodation.
const DEFAULT_CHECKIN_TIME = '16:00'  // 4:00 PM
const DEFAULT_CHECKOUT_TIME = '11:00'  // 11:00 AM

// assigned_to is now an array of member IDs, or [] for "none", or ['__all__'] sentinel for "everyone"
// We store the actual IDs always — '__all__' is only a UI concept resolved before saving.
const BLANK_FORM = {
  title: '', time: '', end_time: '', location: '', notes: '',
  type: 'activity',
  assignees: [],
  assignAll: false,
  timezone: '',
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// `dt` is a wall-clock string ("2024-06-15T14:30") already expressed in the
// leg's own zone, so we read the HH:MM straight off it. Passing it through
// `new Date()` would re-interpret it in the *browser's* zone and shift the time.
function formatTime(dt, hour12 = true) {
  if (!dt) return null
  const timePart = dt.slice(11, 16)
  if (!/^\d{2}:\d{2}$/.test(timePart)) return null
  return formatClock(timePart, hour12 ? '12' : '24')
}

// Format a HH:MM string (e.g. "16:00") as "4:00 PM" or "16:00".
function formatHM(hm, hour12 = true) {
  if (!hm) return ''
  return formatClock(hm.slice(0, 5), hour12 ? '12' : '24')
}

function formatTimeRange(start, end, hour12 = true) {
  if (!start) return null
  const tf = hour12 ? '12' : '24'
  const s = formatClock(start.slice(0, 5), tf)
  if (!end) return s
  return `${s} – ${formatClock(end.slice(0, 5), tf)}`
}

// Convert the stored assigned_to field (legacy string | array | null) → { assignees, assignAll }
function parseAssigned(raw, allMemberIds) {
  if (!raw || (Array.isArray(raw) && raw.length === 0)) {
    return { assignees: [], assignAll: false }
  }
  // Legacy: single string ID
  if (typeof raw === 'string') {
    return { assignees: [raw], assignAll: false }
  }
  if (Array.isArray(raw)) {
    if (raw[0] === '__all__') return { assignees: allMemberIds, assignAll: true }
    return { assignees: raw, assignAll: false }
  }
  return { assignees: [], assignAll: false }
}

// Convert form state back to what we store in Firestore
function serializeAssigned(assignAll, assignees, allMemberIds) {
  if (assignAll) return ['__all__']
  if (assignees.length === 0) return []
  return assignees
}

// ─── Build per-date travel cards ──────────────────────────────────────────────
// Takes the unified legs array (from normalizeLegs) — each entry already carries
// traveler_names so we don't need to look anything up.

function buildTravelByDate(legs, hour12 = true) {
  const byDate = {}
  function push(dateStr, card) {
    if (!dateStr) return
    if (!byDate[dateStr]) byDate[dateStr] = []
    byDate[dateStr].push(card)
  }
  legs.forEach(leg => {
    const firstNames = (leg.traveler_names || []).map(n => n.split(' ')[0])
    const name = firstNames.length === 0 ? 'Someone'
      : firstNames.length === 1 ? firstNames[0]
        : firstNames.length === 2 ? firstNames.join(' & ')
          : `${firstNames[0]} +${firstNames.length - 1}`
    const meta = TRANSPORT_META[leg.transport] || TRANSPORT_META.other
    const depDate = leg.depart_at?.slice(0, 10)
    const arrDate = leg.arrive_at?.slice(0, 10)
    const sameDay = depDate && arrDate && depDate === arrDate
    if (leg.depart_at) {
      push(depDate, { kind: 'depart', name, transport: leg.transport, number: leg.number, from: leg.from, to: leg.to, depart_time: formatTime(leg.depart_at, hour12), arrive_time: sameDay ? formatTime(leg.arrive_at, hour12) : null, meta, _sortAt: leg.depart_at })
    }
    if (leg.arrive_at && !sameDay) {
      push(arrDate, { kind: 'arrive', name, transport: leg.transport, number: leg.number, from: leg.from, to: leg.to, depart_time: null, arrive_time: formatTime(leg.arrive_at, hour12), meta, _sortAt: leg.arrive_at })
    }
  })
  Object.keys(byDate).forEach(d => {
    byDate[d].sort((a, b) => (a._sortAt || '').localeCompare(b._sortAt || ''))
  })
  return byDate
}

// ─── Build per-date accommodation cards ──────────────────────────────────────
// Each accommodation with check_in / check_out dates produces one card per night
// it covers: kind 'checkin' on the arrival day, 'stay' on intermediate nights,
// and 'checkout' on the departure day. Accommodations without dates (legacy)
// are skipped here — they still appear in the Travelers tab.

function buildAccomsByDate(accoms) {
  const byDate = {}
  function push(dateStr, card) {
    if (!dateStr) return
    if (!byDate[dateStr]) byDate[dateStr] = []
    byDate[dateStr].push(card)
  }

  accoms.forEach(accom => {
    if (!accom.check_in || !accom.check_out) return
    const start = accom.check_in.slice(0, 10)
    const end = accom.check_out.slice(0, 10)
    if (!start || !end || end < start) return

    const firstNames = (accom.traveler_names || []).map(n => n.split(' ')[0])
    const travelerName = firstNames.length === 0 ? 'Someone'
      : firstNames.length === 1 ? firstNames[0]
        : firstNames.length === 2 ? firstNames.join(' & ')
          : `${firstNames[0]} +${firstNames.length - 1}`

    // Generate every date from check_in to check_out (inclusive)
    const dates = []
    const cur = new Date(start + 'T12:00:00')
    const last = new Date(end + 'T12:00:00')
    while (cur <= last) {
      dates.push(format(cur, 'yyyy-MM-dd'))
      cur.setDate(cur.getDate() + 1)
    }

    const explicitCheckinTime = accom.check_in_time || ''
    const explicitCheckoutTime = accom.check_out_time || ''

    dates.forEach((dateStr, idx) => {
      let kind = 'stay'
      if (idx === 0) kind = 'checkin'
      else if (idx === dates.length - 1) kind = 'checkout'

      // Attach a sort time only to boundary days (check-in / check-out).
      // Middle "stay" nights have no time — they render as context cards above
      // the chronological list.
      let time = ''
      let timeIsDefault = false
      if (kind === 'checkin') {
        time = explicitCheckinTime || DEFAULT_CHECKIN_TIME
        timeIsDefault = !explicitCheckinTime
      } else if (kind === 'checkout') {
        time = explicitCheckoutTime || DEFAULT_CHECKOUT_TIME
        timeIsDefault = !explicitCheckoutTime
      }

      push(dateStr, {
        kind,
        name: accom.name,
        address: accom.address,
        travelerName,
        notes: accom.notes,
        time,
        timeIsDefault,
      })
    })
  })

  return byDate
}

// ─── Assignee picker component ────────────────────────────────────────────────

function AssigneePicker({ assignAll, assignees, onChange, members }) {
  // onChange({ assignAll, assignees })
  const allIds = members.map(m => m.id)

  function toggleAll() {
    if (assignAll) {
      onChange({ assignAll: false, assignees: [] })
    } else {
      onChange({ assignAll: true, assignees: allIds })
    }
  }

  function toggleNone() {
    onChange({ assignAll: false, assignees: [] })
  }

  function toggleMember(id) {
    if (assignAll) {
      // switching from All → deselect this one person
      const next = allIds.filter(i => i !== id)
      onChange({ assignAll: false, assignees: next })
    } else {
      const has = assignees.includes(id)
      const next = has ? assignees.filter(i => i !== id) : [...assignees, id]
      // If all selected, flip to assignAll
      const newAll = next.length === allIds.length
      onChange({ assignAll: newAll, assignees: next })
    }
  }

  const isNone = !assignAll && assignees.length === 0

  return (
    <div>
      <p className="text-xs mb-2" style={{ color: '#5a5248' }}>Assign to</p>

      {/* Quick-select row */}
      <div className="flex gap-2 mb-2">
        <button
          type="button"
          onClick={toggleAll}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
          style={{
            background: assignAll ? 'rgba(212,184,122,0.18)' : 'rgba(255,255,255,0.04)',
            border: assignAll ? '1px solid rgba(212,184,122,0.35)' : '1px solid rgba(255,255,255,0.08)',
            color: assignAll ? '#d4b87a' : '#5a5248',
          }}>
          {assignAll && <Check size={10} />}
          Everyone
        </button>
        <button
          type="button"
          onClick={toggleNone}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
          style={{
            background: isNone ? 'rgba(90,82,72,0.25)' : 'rgba(255,255,255,0.04)',
            border: isNone ? '1px solid rgba(90,82,72,0.4)' : '1px solid rgba(255,255,255,0.08)',
            color: isNone ? '#b5aea4' : '#5a5248',
          }}>
          {isNone && <Check size={10} />}
          No one
        </button>
      </div>

      {/* Member chips */}
      <div className="flex flex-wrap gap-1.5">
        {members.map(m => {
          const selected = assignAll || assignees.includes(m.id)
          const initial = m.full_name?.[0]?.toUpperCase() || '?'
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => toggleMember(m.id)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs transition-all"
              style={{
                background: selected ? 'rgba(212,184,122,0.15)' : 'rgba(255,255,255,0.04)',
                border: selected ? '1px solid rgba(212,184,122,0.35)' : '1px solid rgba(255,255,255,0.08)',
                color: selected ? '#d4b87a' : '#5a5248',
              }}>
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-xs flex-shrink-0 font-medium"
                style={{
                  background: selected
                    ? 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)'
                    : 'rgba(255,255,255,0.08)',
                  color: selected ? '#0a0908' : '#5a5248',
                  fontSize: '9px',
                }}>
                {initial}
              </span>
              {m.full_name?.split(' ')[0]}
              {selected && <Check size={9} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Shared form fields ───────────────────────────────────────────────────────

function EventFormFields({ form, setForm, members }) {
  return (
    <>
      <input
        autoFocus
        placeholder="Event title *"
        value={form.title}
        onChange={e => setForm({ ...form, title: e.target.value })}
        className="w-full bg-transparent text-sm outline-none"
        style={{ color: '#e8d5a3', borderBottom: '1px solid rgba(212,184,122,0.2)', paddingBottom: '8px' }}
      />

      {/* Time + type row */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-xs mb-1" style={{ color: '#5a5248' }}>Start time</p>
          <input type="time" value={form.time}
            onChange={e => setForm({ ...form, time: e.target.value })}
            className="w-full bg-transparent text-xs outline-none"
            style={{ color: '#b5aea4', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' }} />
        </div>
        <div>
          <p className="text-xs mb-1" style={{ color: '#5a5248' }}>End time</p>
          <input type="time" value={form.end_time}
            onChange={e => setForm({ ...form, end_time: e.target.value })}
            className="w-full bg-transparent text-xs outline-none"
            style={{ color: '#b5aea4', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' }} />
        </div>
        <div>
          <p className="text-xs mb-1" style={{ color: '#5a5248' }}>Type</p>
          <select value={form.type}
            onChange={e => setForm({ ...form, type: e.target.value })}
            className="w-full bg-transparent text-xs outline-none"
            style={{ color: '#b5aea4', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px', background: 'transparent' }}>
            {EVENT_TYPES.map(t => (
              <option key={t.value} value={t.value} style={{ background: '#1c1916' }}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Timezone — only relevant when a time is set */}
      {form.time && (
        <div>
          <p className="text-xs mb-1" style={{ color: '#5a5248' }}>Timezone</p>
          <TimezonePicker
            value={form.timezone}
            onChange={v => setForm({ ...form, timezone: v })}
          />
        </div>
      )}

      <input placeholder="Location (optional)" value={form.location}
        onChange={e => setForm({ ...form, location: e.target.value })}
        className="w-full bg-transparent text-xs outline-none"
        style={{ color: '#b5aea4', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' }} />

      {/* Multi-assignee picker */}
      <AssigneePicker
        assignAll={form.assignAll}
        assignees={form.assignees}
        members={members}
        onChange={({ assignAll, assignees }) => setForm({ ...form, assignAll, assignees })}
      />

      <textarea placeholder="Notes (optional)" value={form.notes}
        onChange={e => setForm({ ...form, notes: e.target.value })}
        rows={2} className="w-full bg-transparent text-xs outline-none resize-none"
        style={{ color: '#b5aea4', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' }} />
    </>
  )
}

function EventAddForm({ form, setForm, members, saving, onSave, onCancel }) {
  return (
    <div className="rounded-xl p-4 space-y-3 mt-2"
      style={{ background: 'rgba(212,184,122,0.06)', border: '1px solid rgba(212,184,122,0.15)' }}>
      <EventFormFields form={form} setForm={setForm} members={members} />
      <div className="flex gap-2 pt-1">
        <button onClick={onSave} disabled={saving || !form.title.trim()}
          className="flex-1 py-2 rounded-xl text-xs font-medium"
          style={{ background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
          {saving ? 'Saving…' : 'Add Event'}
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded-xl text-xs"
          style={{ color: '#5a5248', background: 'rgba(255,255,255,0.04)' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function EventEditForm({ form, setForm, members, saving, onSave, onCancel }) {
  return (
    <div className="rounded-xl p-4 space-y-3 slide-up"
      style={{ background: 'rgba(122,154,181,0.06)', border: '1px solid rgba(122,154,181,0.2)' }}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs tracking-widest uppercase" style={{ color: '#7a9ab5' }}>Edit Event</p>
        <button onClick={onCancel} style={{ color: '#5a5248' }}><X size={12} /></button>
      </div>
      <EventFormFields form={form} setForm={setForm} members={members} />
      <div className="flex gap-2 pt-1">
        <button onClick={onSave} disabled={saving || !form.title.trim()}
          className="flex-1 py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5"
          style={{ background: saving ? '#3d3830' : 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
          {saving ? 'Saving…' : <><Check size={11} />Save Changes</>}
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded-xl text-xs"
          style={{ color: '#5a5248', background: 'rgba(255,255,255,0.04)' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Event row (view mode) ────────────────────────────────────────────────────

function EventItem({ event, members, onEdit, onDelete, canEdit }) {
  const { user } = useAuth()
  const typeInfo = EVENT_TYPES.find(t => t.value === event.type) || EVENT_TYPES[0]
  const timeLabel = formatTimeRange(event.time, event.end_time, isHour12(user?.time_format))
  const allIds = members.map(m => m.id)
  const { assignees, assignAll } = parseAssigned(event.assigned_to, allIds)

  // Build label for assignees
  let assigneeLabel = null
  if (assignAll || assignees.length === allIds.length) {
    assigneeLabel = { text: 'Everyone', icon: <Users size={9} /> }
  } else if (assignees.length === 0) {
    assigneeLabel = null
  } else if (assignees.length === 1) {
    const m = members.find(m => m.id === assignees[0])
    assigneeLabel = m ? { text: m.full_name.split(' ')[0] } : null
  } else {
    // Show up to 3 initials
    const names = assignees
      .map(id => members.find(m => m.id === id)?.full_name?.split(' ')[0])
      .filter(Boolean)
    assigneeLabel = { text: names.slice(0, 3).join(', ') + (names.length > 3 ? ' +more' : '') }
  }

  return (
    <div className="flex items-start gap-3 px-3 py-3 rounded-xl group"
      style={{ background: 'rgba(255,255,255,0.03)' }}>
      <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: typeInfo.color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium" style={{ color: '#d4cfc8' }}>{event.title}</p>
          {canEdit && (
            <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={onEdit}
                className="w-6 h-6 rounded-lg flex items-center justify-center"
                style={{ color: '#7a9ab5', background: 'rgba(122,154,181,0.1)' }}
                title="Edit">
                <Pencil size={10} />
              </button>
              <button onClick={onDelete}
                className="w-6 h-6 rounded-lg flex items-center justify-center"
                style={{ color: '#c47c5a', background: 'rgba(196,124,90,0.1)' }}
                title="Delete">
                <Trash2 size={10} />
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
          {timeLabel && (
            <span className="flex items-center gap-1 text-xs" style={{ color: '#5a5248' }}>
              <Clock size={9} />{timeLabel}
            </span>
          )}
          {event.location && (
            <button onClick={() => openInMaps(event.location)}
              className="flex items-center gap-1 text-xs transition-opacity active:opacity-60"
              style={{ color: '#7a9ab5' }} title="Open in Maps">
              <MapPin size={9} /><span className="underline decoration-dotted underline-offset-2">{event.location}</span>
            </button>
          )}
          {assigneeLabel && (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(212,184,122,0.1)', color: '#d4b87a' }}>
              {assigneeLabel.icon}
              {assigneeLabel.text}
            </span>
          )}
        </div>
        {event.notes && <p className="text-xs mt-1" style={{ color: '#5a5248' }}>{event.notes}</p>}
      </div>
    </div>
  )
}

// ─── Export modal ─────────────────────────────────────────────────────────────

function ExportModal({ events, members, allLegs, allAccoms, trip, scope, onClose }) {
  const scopeEvents = scope === 'all' ? events : events.filter(e => e.date === scope)
  const usedTypes = [...new Set(scopeEvents.map(e => e.type))]
  const allMemberIds = members.map(m => m.id)

  const usedAssigneeIds = [...new Set(
    scopeEvents.flatMap(e => {
      const { assignees, assignAll } = parseAssigned(e.assigned_to, allMemberIds)
      return assignAll ? allMemberIds : assignees
    })
  )]
  const hasUnassigned = scopeEvents.some(e => {
    const { assignees, assignAll } = parseAssigned(e.assigned_to, allMemberIds)
    return !assignAll && assignees.length === 0
  })

  const [selTypes, setSelTypes] = useState(new Set(usedTypes))
  const [selPeople, setSelPeople] = useState(new Set(['__unassigned__', ...usedAssigneeIds]))
  const [exported, setExported] = useState(null)  // null | 'itinerary' | 'combined'

  // Trip-level export only includes travel data
  const hasTravelData = scope === 'all' && (allLegs.length > 0 || allAccoms.length > 0)

  function toggleType(v) {
    setSelTypes(prev => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n })
  }
  function togglePerson(v) {
    setSelPeople(prev => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n })
  }

  const filtered = scopeEvents.filter(e => {
    if (!selTypes.has(e.type)) return false
    const { assignees, assignAll } = parseAssigned(e.assigned_to, allMemberIds)
    if (!assignAll && assignees.length === 0) return selPeople.has('__unassigned__')
    const ids = assignAll ? allMemberIds : assignees
    return ids.some(id => selPeople.has(id))
  })

  function doExport(type) {
    if (!filtered.length) return
    const label = scope === 'all'
      ? trip.name
      : `${trip.name} – ${format(new Date(scope + 'T12:00:00'), 'MMM d')}`

    if (type === 'combined') {
      downloadCombinedICS({ events: filtered, legs: allLegs, accommodations: allAccoms, trip })
    } else {
      downloadICS(filtered, label, trip)
    }
    setExported(type)
    setTimeout(onClose, 1200)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-lg rounded-t-3xl slide-up overflow-hidden"
        style={{ background: '#1c1916', border: '1px solid rgba(212,184,122,0.14)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>

        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <div>
            <h2 className="font-display text-2xl font-light" style={{ color: '#e8d5a3', fontStyle: 'italic' }}>
              Export to Calendar
            </h2>
            <p className="text-xs mt-0.5" style={{ color: '#5a5248' }}>
              {scope === 'all' ? 'All trip events' : format(new Date(scope + 'T12:00:00'), 'EEEE, MMM d')}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.06)' }}>
            <X size={14} style={{ color: '#5a5248' }} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 pb-8 space-y-6">

          {/* Event types */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs tracking-widest uppercase" style={{ color: '#5a5248' }}>Event Types</p>
              <div className="flex gap-3">
                <button onClick={() => setSelTypes(new Set(usedTypes))} className="text-xs" style={{ color: '#d4b87a' }}>All</button>
                <button onClick={() => setSelTypes(new Set())} className="text-xs" style={{ color: '#5a5248' }}>None</button>
              </div>
            </div>
            <div className="space-y-2">
              {EVENT_TYPES.filter(t => usedTypes.includes(t.value)).map(type => {
                const count = scopeEvents.filter(e => e.type === type.value).length
                const checked = selTypes.has(type.value)
                return (
                  <button key={type.value} onClick={() => toggleType(type.value)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
                    style={{
                      background: checked ? `${type.color}12` : 'rgba(255,255,255,0.03)',
                      border: checked ? `1px solid ${type.color}35` : '1px solid rgba(255,255,255,0.06)',
                    }}>
                    <span className="text-base">{type.emoji}</span>
                    <span className="flex-1 text-sm text-left" style={{ color: checked ? '#d4cfc8' : '#5a5248' }}>
                      {type.label}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(255,255,255,0.06)', color: '#5a5248' }}>{count}</span>
                    <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                      style={{ background: checked ? type.color : 'rgba(255,255,255,0.06)', border: checked ? 'none' : '1px solid rgba(255,255,255,0.1)' }}>
                      {checked && <Check size={11} color="#0a0908" strokeWidth={3} />}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Assignee filter */}
          {(usedAssigneeIds.length > 0 || hasUnassigned) && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs tracking-widest uppercase" style={{ color: '#5a5248' }}>Include Events For</p>
                <div className="flex gap-3">
                  <button onClick={() => setSelPeople(new Set(['__unassigned__', ...usedAssigneeIds]))}
                    className="text-xs" style={{ color: '#d4b87a' }}>All</button>
                  <button onClick={() => setSelPeople(new Set())}
                    className="text-xs" style={{ color: '#5a5248' }}>None</button>
                </div>
              </div>
              <div className="space-y-2">
                {hasUnassigned && (() => {
                  const count = scopeEvents.filter(e => { const { assignees, assignAll } = parseAssigned(e.assigned_to, allMemberIds); return !assignAll && assignees.length === 0 }).length
                  const checked = selPeople.has('__unassigned__')
                  return (
                    <button onClick={() => togglePerson('__unassigned__')}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
                      style={{ background: checked ? 'rgba(212,184,122,0.08)' : 'rgba(255,255,255,0.03)', border: checked ? '1px solid rgba(212,184,122,0.2)' : '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0"
                        style={{ background: 'rgba(255,255,255,0.08)', color: '#5a5248' }}>—</div>
                      <span className="flex-1 text-sm text-left" style={{ color: checked ? '#d4cfc8' : '#5a5248' }}>Unassigned</span>
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)', color: '#5a5248' }}>{count}</span>
                      <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                        style={{ background: checked ? '#d4b87a' : 'rgba(255,255,255,0.06)', border: checked ? 'none' : '1px solid rgba(255,255,255,0.1)' }}>
                        {checked && <Check size={11} color="#0a0908" strokeWidth={3} />}
                      </div>
                    </button>
                  )
                })()}
                {usedAssigneeIds.map(uid => {
                  const member = members.find(m => m.id === uid)
                  const name = member?.full_name || 'Unknown'
                  const initial = name[0]?.toUpperCase() || '?'
                  const count = scopeEvents.filter(e => {
                    const { assignees, assignAll } = parseAssigned(e.assigned_to, allMemberIds)
                    return assignAll ? true : assignees.includes(uid)
                  }).length
                  const checked = selPeople.has(uid)
                  return (
                    <button key={uid} onClick={() => togglePerson(uid)}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
                      style={{ background: checked ? 'rgba(212,184,122,0.08)' : 'rgba(255,255,255,0.03)', border: checked ? '1px solid rgba(212,184,122,0.2)' : '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
                        {initial}
                      </div>
                      <span className="flex-1 text-sm text-left" style={{ color: checked ? '#d4cfc8' : '#5a5248' }}>{name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)', color: '#5a5248' }}>{count}</span>
                      <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                        style={{ background: checked ? '#d4b87a' : 'rgba(255,255,255,0.06)', border: checked ? 'none' : '1px solid rgba(255,255,255,0.1)' }}>
                        {checked && <Check size={11} color="#0a0908" strokeWidth={3} />}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Export buttons */}
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between px-1">
              <p className="text-xs" style={{ color: '#5a5248' }}>
                {filtered.length === 0 ? 'No events match your filters' : `${filtered.length} event${filtered.length !== 1 ? 's' : ''} selected`}
              </p>
              {filtered.length > 0 && <p className="text-xs" style={{ color: '#3d3830' }}>→ .ics file</p>}
            </div>

            {/* Itinerary only */}
            <button onClick={() => doExport('itinerary')} disabled={filtered.length === 0}
              className="w-full py-3.5 rounded-2xl font-medium tracking-wider transition-all active:scale-95 flex items-center justify-center gap-2"
              style={{
                background: exported === 'itinerary' ? 'rgba(138,171,142,0.2)' : filtered.length === 0 ? '#2a2621' : 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)',
                color: exported === 'itinerary' ? '#8aab8e' : filtered.length === 0 ? '#3d3830' : '#0a0908',
                cursor: filtered.length === 0 ? 'default' : 'pointer',
              }}>
              {exported === 'itinerary'
                ? <><Check size={14} /> Exported!</>
                : <><CalendarDays size={14} /> Export Itinerary ({filtered.length} event{filtered.length !== 1 ? 's' : ''})</>
              }
            </button>

            {/* Combined itinerary + travel (only when trip-level export and travel data exists) */}
            {hasTravelData && (
              <button onClick={() => doExport('combined')} disabled={filtered.length === 0}
                className="w-full py-3.5 rounded-2xl font-medium tracking-wider transition-all active:scale-95 flex items-center justify-center gap-2"
                style={{
                  background: exported === 'combined' ? 'rgba(138,171,142,0.2)' : filtered.length === 0 ? '#2a2621' : 'rgba(122,154,181,0.15)',
                  border: filtered.length === 0 ? 'none' : '1px solid rgba(122,154,181,0.3)',
                  color: exported === 'combined' ? '#8aab8e' : filtered.length === 0 ? '#3d3830' : '#7a9ab5',
                  cursor: filtered.length === 0 ? 'default' : 'pointer',
                }}>
                {exported === 'combined'
                  ? <><Check size={14} /> Exported!</>
                  : <><CalendarDays size={14} /> Export Itinerary + Travel (all in one)</>
                }
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ItineraryTab({
  tripId, trip, days, members,
  travelDetails = [], sharedLegs = [], sharedAccoms = [],
  currentUser,
}) {
  const [events, setEvents] = useState([])
  const [weather, setWeather] = useState([])
  const [expandedDay, setExpandedDay] = useState(0)
  const [showAddForm, setShowAddForm] = useState(null)
  const [addForm, setAddForm] = useState({ ...BLANK_FORM, timezone: trip.timezone || '' })
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [exportScope, setExportScope] = useState(null)

  const tempUnit = currentUser?.temp_unit || 'C'
  const hour12 = isHour12(currentUser?.time_format)

  // Readable label for an assigned_to value, used in the change log.
  const assignedLabel = raw => {
    const { assignees, assignAll } = parseAssigned(raw, members.map(m => m.id))
    if (assignAll) return 'Everyone'
    if (!assignees.length) return 'No one'
    return assignees.map(id => members.find(m => m.id === id)?.full_name?.split(' ')[0] || '?').join(', ')
  }

  // Fields tracked in the trip change log for an itinerary event.
  const EVENT_FIELDS = [
    { key: 'title',       label: 'Title' },
    { key: 'time',        label: 'Start time' },
    { key: 'end_time',    label: 'End time' },
    { key: 'type',        label: 'Type', format: v => (EVENT_TYPES.find(t => t.value === v)?.label || v || '—') },
    { key: 'location',    label: 'Location' },
    { key: 'assigned_to', label: 'Assigned to', format: assignedLabel },
    { key: 'notes',       label: 'Notes' },
  ]

  const allLegs = normalizeLegs({ legacyDetails: travelDetails, sharedLegs, members })
  const allAccoms = normalizeAccommodations({ legacyDetails: travelDetails, sharedAccoms, members })
  const travelByDate = buildTravelByDate(allLegs, hour12)
  const accomsByDate = buildAccomsByDate(allAccoms)
  const allMemberIds = members.map(m => m.id)

  useEffect(() => {
    loadEvents()
    if (trip.lat && trip.lon && trip.start_date && trip.end_date) {
      fetchWeatherForTrip(trip.lat, trip.lon, trip.start_date, trip.end_date).then(w => setWeather(w || []))
    }
  }, [tripId])

  async function loadEvents() {
    const snap = await getDocs(query(
      collection(db, 'itinerary_events'),
      where('trip_id', '==', tripId)
    ))
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    items.sort((a, b) => {
      const dateCmp = (a.date || '').localeCompare(b.date || '')
      if (dateCmp !== 0) return dateCmp
      if (a.time && !b.time) return -1
      if (!a.time && b.time) return 1
      return (a.time || '').localeCompare(b.time || '')
    })
    setEvents(items)
  }

  async function addEvent(date) {
    if (!addForm.title.trim()) return
    setSaving(true)
    const payload = {
      trip_id: tripId,
      date,
      title: addForm.title,
      time: addForm.time || null,
      end_time: addForm.end_time || null,
      location: addForm.location || null,
      notes: addForm.notes || null,
      type: addForm.type,
      assigned_to: serializeAssigned(addForm.assignAll, addForm.assignees, allMemberIds),
      timezone: addForm.timezone || trip.timezone || localTimezone() || null,
      created_by: currentUser.id,
      created_at: serverTimestamp(),
    }
    const ref = await addDoc(collection(db, 'itinerary_events'), payload)
    await logActivity(tripId, currentUser, {
      action: 'create', entity: 'event',
      summary: `Added event “${payload.title}”`,
      details: [`Day: ${date}`, ...fieldSummaryLines(payload, EVENT_FIELDS)],
      undo: { ops: [{ op: 'delete', collection: 'itinerary_events', docId: ref.id }] },
    })
    setAddForm({ ...BLANK_FORM, timezone: trip.timezone || '' })
    setShowAddForm(null)
    setSaving(false)
    loadEvents()
  }

  async function saveEdit(id) {
    if (!editForm.title.trim()) return
    const before = events.find(e => e.id === id)
    setSaving(true)
    const after = {
      title: editForm.title,
      time: editForm.time || null,
      end_time: editForm.end_time || null,
      location: editForm.location || null,
      notes: editForm.notes || null,
      type: editForm.type,
      assigned_to: serializeAssigned(editForm.assignAll, editForm.assignees, allMemberIds),
    }
    await updateDoc(doc(db, 'itinerary_events', id), {
      ...after,
      timezone: editForm.timezone || trip.timezone || localTimezone() || null,
      updated_at: serverTimestamp(),
    })
    const { lines, prev } = fieldDiff(before, after, EVENT_FIELDS)
    if (lines.length) {
      await logActivity(tripId, currentUser, {
        action: 'update', entity: 'event',
        summary: `Edited event “${after.title}”`,
        details: lines,
        undo: { ops: [{ op: 'update', collection: 'itinerary_events', docId: id, data: prev }] },
      })
    }
    setSaving(false)
    setEditingId(null)
    loadEvents()
  }

  async function deleteEvent(id) {
    const before = events.find(e => e.id === id)
    await deleteDoc(doc(db, 'itinerary_events', id))
    if (before) {
      const { id: _i, ...data } = before
      await logActivity(tripId, currentUser, {
        action: 'delete', entity: 'event',
        summary: `Deleted event “${before.title || 'event'}”`,
        details: [...(before.date ? [`Day: ${before.date}`] : []), ...fieldSummaryLines(before, EVENT_FIELDS)],
        undo: { ops: [{ op: 'set', collection: 'itinerary_events', docId: id, data }] },
      })
    }
    if (editingId === id) setEditingId(null)
    loadEvents()
  }

  function startEdit(event) {
    const { assignees, assignAll } = parseAssigned(event.assigned_to, allMemberIds)
    setEditForm({
      title: event.title || '',
      time: event.time || '',
      end_time: event.end_time || '',
      location: event.location || '',
      notes: event.notes || '',
      type: event.type || 'activity',
      assignees,
      assignAll,
      timezone: event.timezone || trip.timezone || '',
    })
    setEditingId(event.id)
    setShowAddForm(null)
  }

  return (
    <div className="px-6 pt-4 space-y-3">
      {days.length === 0 && (
        <div className="text-center py-16">
          <p className="text-sm" style={{ color: '#5a5248' }}>Add dates to your trip to see the itinerary.</p>
        </div>
      )}

      {/* Whole-trip export */}
      {days.length > 0 && events.length > 0 && (
        <button
          onClick={() => setExportScope('all')}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-xs mb-1 transition-all"
          style={{ background: 'rgba(212,184,122,0.07)', border: '1px solid rgba(212,184,122,0.15)', color: '#d4b87a' }}>
          <CalendarDays size={13} />Export all events to calendar
        </button>
      )}

      {days.map((day, idx) => {
        const dateStr = format(day, 'yyyy-MM-dd')
        const dayEvents = events.filter(e => e.date === dateStr)
        const dayWeather = weather.find(w => w.date === dateStr)
        const dayTravel = travelByDate[dateStr] || []
        const dayAccoms = accomsByDate[dateStr] || []
        // Middle "stay" nights have no time — render as context cards above
        // the chronological list. Check-ins and check-outs are interleaved
        // with travel + events using their (real or default) time.
        const dayStays = dayAccoms.filter(a => a.kind === 'stay')
        const dayCheckins = dayAccoms.filter(a => a.kind === 'checkin')
        const dayCheckouts = dayAccoms.filter(a => a.kind === 'checkout')
        const totalItems = dayEvents.length + dayTravel.length + dayAccoms.length
        const isOpen = expandedDay === idx

        // Merge travel + events + check-ins + check-outs into one chronological
        // list. Travel cards carry a full ISO timestamp in _sortAt; events and
        // accommodation cards carry HH:MM. Missing times sort to the bottom.
        const chronoItems = []
        dayTravel.forEach((card, ci) => {
          const t = (card._sortAt || '').slice(11, 16) || '99:99'
          chronoItems.push({ kind: 'travel', card, _sort: t, _key: `t-${ci}` })
        })
        dayEvents.forEach(event => {
          chronoItems.push({ kind: 'event', event, _sort: event.time || '99:99', _key: `e-${event.id}` })
        })
        dayCheckins.forEach((card, ci) => {
          chronoItems.push({ kind: 'checkin', card, _sort: card.time || '99:99', _key: `ci-${ci}` })
        })
        dayCheckouts.forEach((card, ci) => {
          chronoItems.push({ kind: 'checkout', card, _sort: card.time || '99:99', _key: `co-${ci}` })
        })
        chronoItems.sort((a, b) => a._sort.localeCompare(b._sort))

        return (
          <div key={dateStr} className="glass rounded-2xl overflow-hidden fade-in"
            style={{ animationDelay: `${idx * 0.04}s` }}>

            {/* ── Day header ── */}
            <button onClick={() => setExpandedDay(isOpen ? -1 : idx)}
              className="w-full flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-4">
                <div className="text-center flex-shrink-0 w-8">
                  <p className="text-xs uppercase tracking-widest leading-none" style={{ color: '#5a5248' }}>
                    {format(day, 'EEE')}
                  </p>
                  <p className="font-display text-2xl font-light leading-tight" style={{ color: '#e8d5a3' }}>
                    {format(day, 'd')}
                  </p>
                  <p className="text-xs leading-none" style={{ color: '#5a5248' }}>{format(day, 'MMM')}</p>
                </div>
                <div>
                  <p className="text-xs font-medium" style={{ color: '#d4cfc8' }}>Day {idx + 1}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {dayWeather && (
                      <span className="flex items-center gap-1 text-xs" style={{ color: '#5a5248' }}>
                        <span>{dayWeather.icon}</span>
                        <span style={{ color: '#b5aea4' }}>{formatTemp(dayWeather.maxTemp, tempUnit)}</span>
                        <span>/</span>
                        <span>{formatTemp(dayWeather.minTemp, tempUnit)}</span>
                      </span>
                    )}
                    {dayEvents.length > 0 && (
                      <span className="text-xs" style={{ color: '#5a5248' }}>
                        · {dayEvents.length} event{dayEvents.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {dayTravel.length > 0 && (
                      <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full"
                        style={{ background: 'rgba(122,154,181,0.15)', color: '#7a9ab5' }}>
                        {[...new Set(dayTravel.map(t => t.meta.icon))].join('')} {dayTravel.length} travel
                      </span>
                    )}
                    {dayAccoms.length > 0 && (
                      <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full"
                        style={{ background: 'rgba(138,171,142,0.15)', color: '#8aab8e' }}>
                        🏨 {dayAccoms.length} stay{dayAccoms.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {totalItems === 0 && !dayWeather && (
                      <span className="text-xs" style={{ color: '#3d3830' }}>Empty</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {dayWeather && (
                  <div className="flex flex-col items-end">
                    <span className="text-xs" style={{ color: '#5a5248' }}>{dayWeather.label}</span>
                    {dayWeather.precipProb > 20 && (
                      <span className="text-xs" style={{ color: '#7a9ab5' }}>💧{dayWeather.precipProb}%</span>
                    )}
                  </div>
                )}
                <ChevronDown size={14} style={{
                  color: '#5a5248',
                  transform: isOpen ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s',
                }} />
              </div>
            </button>

            {/* ── Expanded body ── */}
            {isOpen && (
              <div className="px-5 pb-5 space-y-2 slide-up">

                {dayWeather && (
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <span className="text-xl">{dayWeather.icon}</span>
                    <div>
                      <p className="text-sm" style={{ color: '#d4cfc8' }}>{dayWeather.label}</p>
                      <p className="text-xs" style={{ color: '#5a5248' }}>
                        {formatTemp(dayWeather.maxTemp, tempUnit)} high · {formatTemp(dayWeather.minTemp, tempUnit)} low
                        {dayWeather.precipProb > 20 ? ` · ${dayWeather.precipProb}% rain` : ''}
                      </p>
                    </div>
                  </div>
                )}

                {/* Middle "stay" nights: context cards above the chronological list */}
                {dayStays.length > 0 && (
                  <div className="space-y-1.5">
                    {dayStays.map((card, ci) => <AccommodationCard key={`s-${ci}`} card={card} />)}
                  </div>
                )}

                {/* Travel, events, check-ins and check-outs, interleaved by time */}
                {chronoItems.length > 0 && (
                  <div className="space-y-1.5">
                    {chronoItems.map(item => {
                      if (item.kind === 'travel') {
                        return <TravelCard key={item._key} card={item.card} />
                      }
                      if (item.kind === 'checkin') {
                        return <AccommodationCard key={item._key} card={item.card} />
                      }
                      if (item.kind === 'checkout') {
                        return <CheckoutLine key={item._key} card={item.card} />
                      }
                      // event
                      return editingId === item.event.id ? (
                        <EventEditForm
                          key={item._key}
                          form={editForm}
                          setForm={setEditForm}
                          members={members}
                          saving={saving}
                          onSave={() => saveEdit(item.event.id)}
                          onCancel={() => setEditingId(null)}
                        />
                      ) : (
                        <EventItem
                          key={item._key}
                          event={item.event}
                          members={members}
                          onEdit={() => startEdit(item.event)}
                          onDelete={() => deleteEvent(item.event.id)}
                          canEdit={true}
                        />
                      )
                    })}
                  </div>
                )}

                {totalItems === 0 && showAddForm !== dateStr && (
                  <p className="text-xs text-center py-3" style={{ color: '#3d3830' }}>No events yet.</p>
                )}

                {showAddForm === dateStr ? (
                  <EventAddForm
                    form={addForm}
                    setForm={setAddForm}
                    members={members}
                    saving={saving}
                    onSave={() => addEvent(dateStr)}
                    onCancel={() => { setShowAddForm(null); setAddForm({ ...BLANK_FORM, timezone: trip.timezone || '' }) }}
                  />
                ) : (
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={() => {
                        setShowAddForm(dateStr)
                        setEditingId(null)
                        setAddForm({ ...BLANK_FORM, timezone: trip.timezone || '' })
                      }}
                      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs transition-all"
                      style={{ color: '#5a5248', border: '1px dashed rgba(212,184,122,0.2)' }}>
                      <Plus size={12} />Add event
                    </button>
                    {dayEvents.length > 0 && (
                      <button
                        onClick={() => setExportScope(dateStr)}
                        className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl text-xs transition-all"
                        style={{ color: '#5a5248', border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)' }}
                        title="Export this day to calendar">
                        <CalendarDays size={12} />Export
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {exportScope && (
        <ExportModal
          events={events}
          members={members}
          allLegs={allLegs}
          allAccoms={allAccoms}
          trip={trip}
          scope={exportScope}
          onClose={() => setExportScope(null)}
        />
      )}
    </div>
  )
}

// ─── Travel card ──────────────────────────────────────────────────────────────

function TravelCard({ card }) {
  const c = card.meta.color
  const hasRoute = card.from || card.to
  return (
    <div className="px-3 py-2.5 rounded-xl" style={{ background: `${c}12`, border: `1px solid ${c}28` }}>
      <div className="flex items-center gap-2">
        <span className="text-base flex-shrink-0">{card.meta.icon}</span>
        <span className="text-xs font-medium flex-1 min-w-0 truncate" style={{ color: '#d4cfc8' }}>{card.name}</span>
        {card.number && (
          <span className="text-xs px-1.5 py-0.5 rounded font-mono flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.06)', color: '#b5aea4' }}>
            {card.number}
          </span>
        )}
      </div>
      {hasRoute && (
        <div className="flex items-start gap-2 mt-2 ml-6">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate" style={{ color: '#b5aea4' }}>{card.from || '—'}</p>
            {card.depart_time && (
              <p className="text-xs flex items-center gap-1 mt-0.5" style={{ color: '#5a5248' }}>
                <Clock size={8} />{card.depart_time}
              </p>
            )}
          </div>
          <ArrowRight size={10} style={{ color: '#3d3830', flexShrink: 0, marginTop: 2 }} />
          <div className="flex-1 min-w-0 text-right">
            <p className="text-xs font-medium truncate" style={{ color: '#b5aea4' }}>{card.to || '—'}</p>
            {card.arrive_time && (
              <p className="text-xs flex items-center justify-end gap-1 mt-0.5" style={{ color: '#5a5248' }}>
                <Clock size={8} />{card.arrive_time}
              </p>
            )}
          </div>
        </div>
      )}
      {!hasRoute && (card.depart_time || card.arrive_time) && (
        <div className="flex items-center gap-2 mt-1 ml-6">
          {card.depart_time && <span className="flex items-center gap-1 text-xs" style={{ color: '#5a5248' }}><Clock size={8} />{card.depart_time}</span>}
          {card.depart_time && card.arrive_time && <ArrowRight size={8} style={{ color: '#3d3830' }} />}
          {card.arrive_time && <span className="flex items-center gap-1 text-xs" style={{ color: '#5a5248' }}><Clock size={8} />{card.arrive_time}</span>}
        </div>
      )}
    </div>
  )
}

// ─── Accommodation card ──────────────────────────────────────────────────────

const ACCOM_KIND_META = {
  checkin: { icon: '🏨', label: 'Check in', color: '#7a9ab5' },
  stay: { icon: '🛏️', label: 'Staying at', color: '#8aab8e' },
  checkout: { icon: '🚪', label: 'Check out', color: '#c47c5a' },
}

function AccommodationCard({ card }) {
  const { user } = useAuth()
  const meta = ACCOM_KIND_META[card.kind] || ACCOM_KIND_META.stay
  const c = meta.color
  const timeLabel = card.time ? formatHM(card.time, isHour12(user?.time_format)) : ''
  return (
    <div className="px-3 py-2.5 rounded-xl" style={{ background: `${c}12`, border: `1px solid ${c}28` }}>
      <div className="flex items-start gap-2">
        <span className="text-base flex-shrink-0">{meta.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase tracking-wider" style={{ color: c }}>{meta.label}</span>
            {timeLabel && (
              <span className="flex items-center gap-1 text-xs"
                style={{ color: card.timeIsDefault ? '#5a5248' : '#b5aea4' }}
                title={card.timeIsDefault ? 'Default check-in time — edit the accommodation to set your own' : undefined}>
                <Clock size={9} />{timeLabel}
              </span>
            )}
            <span className="text-xs" style={{ color: '#5a5248' }}>· {card.travelerName}</span>
          </div>
          <p className="text-xs font-medium truncate mt-0.5" style={{ color: '#d4cfc8' }}>
            {card.name || 'Accommodation'}
          </p>
          {card.address && (
            <button onClick={() => openInMaps(card.address || card.name)}
              className="text-xs flex items-center gap-1 mt-0.5 truncate text-left transition-opacity active:opacity-60"
              style={{ color: '#7a9ab5' }} title="Open in Maps">
              <MapPin size={8} /><span className="underline decoration-dotted underline-offset-2 truncate">{card.address}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Thin one-line strip used for checkouts — less visual weight than a card,
// since "leaving the hotel" is usually just a side-note to the rest of the day.
function CheckoutLine({ card }) {
  const { user } = useAuth()
  const meta = ACCOM_KIND_META.checkout
  const timeLabel = card.time ? formatHM(card.time, isHour12(user?.time_format)) : ''
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs">
      <span className="text-xs flex-shrink-0">{meta.icon}</span>
      <span className="uppercase tracking-wider flex-shrink-0" style={{ color: meta.color }}>{meta.label}</span>
      {timeLabel && (
        <span className="flex items-center gap-1 flex-shrink-0"
          style={{ color: card.timeIsDefault ? '#5a5248' : '#b5aea4' }}
          title={card.timeIsDefault ? 'Default check-out time — edit the accommodation to set your own' : undefined}>
          <Clock size={9} />{timeLabel}
        </span>
      )}
      <span className="truncate" style={{ color: '#b5aea4' }}>
        {card.name || 'Accommodation'}
      </span>
      <span className="flex-shrink-0" style={{ color: '#5a5248' }}>· {card.travelerName}</span>
    </div>
  )
}