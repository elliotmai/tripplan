import { useMemo, useState } from 'react'
import {
  collection, query, where, getDocs,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { generateTravelICS, downloadTravelICS } from '../lib/ical'
import {
  normalizeLegs, normalizeAccommodations, legsForMember, accomsForMember,
  membersWithTravel, SOURCES,
} from '../lib/travel'
import {
  Edit2, UserPlus, Plus, Trash2, ChevronDown, ChevronUp,
  CalendarDays, Check, X, Plane, Building2, Users,
} from 'lucide-react'
import TimezonePicker from './TimezonePicker'

// ─── constants ────────────────────────────────────────────────────────────────

const TRANSPORT_OPTIONS = [
  { value: 'flight', label: 'Flight', icon: '✈️' },
  { value: 'train',  label: 'Train',  icon: '🚂' },
  { value: 'bus',    label: 'Bus',    icon: '🚌' },
  { value: 'car',    label: 'Car',    icon: '🚗' },
  { value: 'ferry',  label: 'Ferry',  icon: '⛴️' },
  { value: 'subway', label: 'Subway', icon: '🚇' },
  { value: 'taxi',   label: 'Taxi',   icon: '🚕' },
  { value: 'walk',   label: 'Walking', icon: '🚶' },
  { value: 'other',  label: 'Other',  icon: '🛸' },
]
const TRANSPORT_MAP = Object.fromEntries(TRANSPORT_OPTIONS.map(t => [t.value, t]))

const BLANK_LEG_FORM = {
  transport: 'flight', number: '', from: '', to: '',
  depart_at: '', arrive_at: '', depart_tz: '', arrive_tz: '',
  notes: '', traveler_ids: [],
}

const BLANK_ACCOM_FORM = {
  name: '', address: '', check_in: '', check_out: '',
  notes: '', traveler_ids: [],
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDT(dt, tz) {
  if (!dt) return null
  try {
    return new Date(dt).toLocaleString('en-US', {
      timeZone: tz || undefined,
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZoneName: tz ? 'short' : undefined,
    })
  } catch { return dt }
}

function formatDate(dStr) {
  if (!dStr) return null
  try {
    return new Date(dStr + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch { return dStr }
}

function durationLabel(from, to) {
  try {
    const mins = Math.round((new Date(to) - new Date(from)) / 60000)
    if (mins < 0) return null
    const h = Math.floor(mins / 60), m = mins % 60
    return h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}`.trim() : `${m}m`
  } catch { return null }
}

function travelersLabel(item, currentUserId, members) {
  const ids = item.traveler_ids || []
  if (!ids.length) return null
  if (ids.length === 1) {
    const m = members.find(mm => mm.id === ids[0])
    return m ? m.full_name.split(' ')[0] : '1 traveler'
  }
  const names = ids
    .map(id => members.find(m => m.id === id)?.full_name?.split(' ')[0])
    .filter(Boolean)
  return names.slice(0, 3).join(', ') + (names.length > 3 ? ' +more' : '')
}

// ─── Traveler multi-picker ────────────────────────────────────────────────────

function TravelerPicker({ selectedIds, members, onChange }) {
  const allIds = members.map(m => m.id)
  const isAll = selectedIds.length === allIds.length && allIds.length > 0
  const isNone = selectedIds.length === 0

  function toggleAll() {
    onChange(isAll ? [] : allIds)
  }

  function toggleMember(id) {
    if (selectedIds.includes(id)) onChange(selectedIds.filter(i => i !== id))
    else onChange([...selectedIds, id])
  }

  return (
    <div>
      <p className="text-xs mb-2" style={{ color: '#5a5248' }}>Travelers *</p>
      <div className="flex gap-2 mb-2">
        <button type="button" onClick={toggleAll}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
          style={{
            background: isAll ? 'rgba(212,184,122,0.18)' : 'rgba(255,255,255,0.04)',
            border: isAll ? '1px solid rgba(212,184,122,0.35)' : '1px solid rgba(255,255,255,0.08)',
            color: isAll ? '#d4b87a' : '#5a5248',
          }}>
          {isAll && <Check size={10} />}Everyone
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {members.map(m => {
          const selected = selectedIds.includes(m.id)
          const initial = m.full_name?.[0]?.toUpperCase() || '?'
          return (
            <button key={m.id} type="button" onClick={() => toggleMember(m.id)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs transition-all"
              style={{
                background: selected ? 'rgba(212,184,122,0.15)' : 'rgba(255,255,255,0.04)',
                border: selected ? '1px solid rgba(212,184,122,0.35)' : '1px solid rgba(255,255,255,0.08)',
                color: selected ? '#d4b87a' : '#5a5248',
              }}>
              <span className="w-4 h-4 rounded-full flex items-center justify-center font-medium flex-shrink-0"
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
      {isNone && (
        <p className="text-xs mt-2" style={{ color: '#c47c5a' }}>Select at least one traveler.</p>
      )}
    </div>
  )
}

// ─── Leg modal (add / edit) ───────────────────────────────────────────────────

function LegModal({ initial, members, onSave, onClose, saving, mode }) {
  const [form, setForm] = useState(initial)

  function update(field, val) { setForm(prev => ({ ...prev, [field]: val })) }

  const canSave = form.traveler_ids.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-lg rounded-t-3xl slide-up overflow-hidden"
        style={{ background: '#1c1916', border: '1px solid rgba(212,184,122,0.14)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>

        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <div>
            <h2 className="font-display text-2xl font-light" style={{ color: '#e8d5a3', fontStyle: 'italic' }}>
              {mode === 'edit' ? 'Edit flight / transport' : 'Add flight / transport'}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: '#5a5248' }}>
              Attach to one or more travelers
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.06)' }}>
            <X size={14} style={{ color: '#5a5248' }} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 pb-8 space-y-5">

          <TravelerPicker
            selectedIds={form.traveler_ids}
            members={members}
            onChange={ids => update('traveler_ids', ids)}
          />

          <div>
            <p className="text-xs mb-2" style={{ color: '#5a5248' }}>Transport</p>
            <div className="flex flex-wrap gap-1.5">
              {TRANSPORT_OPTIONS.map(t => (
                <button key={t.value} onClick={() => update('transport', t.value)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all"
                  style={{
                    background: form.transport === t.value ? 'rgba(212,184,122,0.18)' : 'rgba(255,255,255,0.04)',
                    border: form.transport === t.value ? '1px solid rgba(212,184,122,0.35)' : '1px solid rgba(255,255,255,0.06)',
                    color: form.transport === t.value ? '#d4b87a' : '#5a5248',
                  }}>
                  <span>{t.icon}</span> {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <InlineField label="From">
              <input value={form.from} onChange={e => update('from', e.target.value)}
                placeholder="City / Airport / Station"
                className="w-full bg-transparent text-xs outline-none" style={{ color: '#d4cfc8' }} />
            </InlineField>
            <InlineField label="To">
              <input value={form.to} onChange={e => update('to', e.target.value)}
                placeholder="City / Airport / Station"
                className="w-full bg-transparent text-xs outline-none" style={{ color: '#d4cfc8' }} />
            </InlineField>
          </div>

          {['flight', 'train', 'bus', 'ferry', 'subway'].includes(form.transport) && (
            <InlineField label={form.transport === 'flight' ? 'Flight number' : form.transport === 'train' ? 'Train number' : 'Route / Line'}>
              <input value={form.number} onChange={e => update('number', e.target.value)}
                placeholder={form.transport === 'flight' ? 'e.g. BA123' : form.transport === 'train' ? 'e.g. ICE 607' : 'e.g. Line 4'}
                className="w-full bg-transparent text-xs outline-none" style={{ color: '#d4cfc8' }} />
            </InlineField>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <InlineField label="Departs">
                <input type="datetime-local" value={form.depart_at}
                  onChange={e => update('depart_at', e.target.value)}
                  className="w-full bg-transparent text-xs outline-none"
                  style={{ color: '#d4cfc8', background: 'transparent' }} />
              </InlineField>
              <InlineField label="Departure timezone">
                <TimezonePicker value={form.depart_tz} onChange={v => update('depart_tz', v)} />
              </InlineField>
            </div>
            <div className="space-y-2">
              <InlineField label="Arrives">
                <input type="datetime-local" value={form.arrive_at}
                  onChange={e => update('arrive_at', e.target.value)}
                  className="w-full bg-transparent text-xs outline-none"
                  style={{ color: '#d4cfc8', background: 'transparent' }} />
              </InlineField>
              <InlineField label="Arrival timezone">
                <TimezonePicker value={form.arrive_tz || form.depart_tz} onChange={v => update('arrive_tz', v)} />
              </InlineField>
            </div>
          </div>

          <InlineField label="Notes (optional)">
            <input value={form.notes} onChange={e => update('notes', e.target.value)}
              placeholder="Seat, booking ref, terminal…"
              className="w-full bg-transparent text-xs outline-none" style={{ color: '#d4cfc8' }} />
          </InlineField>

          <button onClick={() => onSave(form)} disabled={saving || !canSave}
            className="w-full py-3 rounded-2xl text-sm font-medium transition-all active:scale-95"
            style={{
              background: (saving || !canSave) ? '#3d3830' : 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)',
              color: (saving || !canSave) ? '#5a5248' : '#0a0908',
            }}>
            {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Add transport'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Accommodation modal ──────────────────────────────────────────────────────

function AccommodationModal({ initial, members, onSave, onClose, saving, mode }) {
  const [form, setForm] = useState(initial)

  function update(field, val) { setForm(prev => ({ ...prev, [field]: val })) }
  const canSave = form.traveler_ids.length > 0 && (form.name.trim() || form.address.trim())

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-lg rounded-t-3xl slide-up overflow-hidden"
        style={{ background: '#1c1916', border: '1px solid rgba(212,184,122,0.14)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>

        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <div>
            <h2 className="font-display text-2xl font-light" style={{ color: '#e8d5a3', fontStyle: 'italic' }}>
              {mode === 'edit' ? 'Edit accommodation' : 'Add accommodation'}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: '#5a5248' }}>
              One stay can be shared across travelers; a traveler can have many.
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.06)' }}>
            <X size={14} style={{ color: '#5a5248' }} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 pb-8 space-y-5">

          <TravelerPicker
            selectedIds={form.traveler_ids}
            members={members}
            onChange={ids => update('traveler_ids', ids)}
          />

          <InlineField label="Name">
            <input value={form.name} onChange={e => update('name', e.target.value)}
              placeholder="Hotel / Airbnb name"
              className="w-full bg-transparent text-xs outline-none" style={{ color: '#d4cfc8' }} />
          </InlineField>

          <InlineField label="Address">
            <input value={form.address} onChange={e => update('address', e.target.value)}
              placeholder="Full address"
              className="w-full bg-transparent text-xs outline-none" style={{ color: '#d4cfc8' }} />
          </InlineField>

          <div className="grid grid-cols-2 gap-3">
            <InlineField label="Check-in">
              <input type="date" value={form.check_in} onChange={e => update('check_in', e.target.value)}
                className="w-full bg-transparent text-xs outline-none"
                style={{ color: '#d4cfc8', background: 'transparent' }} />
            </InlineField>
            <InlineField label="Check-out">
              <input type="date" value={form.check_out} onChange={e => update('check_out', e.target.value)}
                className="w-full bg-transparent text-xs outline-none"
                style={{ color: '#d4cfc8', background: 'transparent' }} />
            </InlineField>
          </div>

          <InlineField label="Notes (optional)">
            <input value={form.notes} onChange={e => update('notes', e.target.value)}
              placeholder="Booking ref, host contact…"
              className="w-full bg-transparent text-xs outline-none" style={{ color: '#d4cfc8' }} />
          </InlineField>

          <button onClick={() => onSave(form)} disabled={saving || !canSave}
            className="w-full py-3 rounded-2xl text-sm font-medium transition-all active:scale-95"
            style={{
              background: (saving || !canSave) ? '#3d3830' : 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)',
              color: (saving || !canSave) ? '#5a5248' : '#0a0908',
            }}>
            {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Add accommodation'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Export modal ─────────────────────────────────────────────────────────────

function ExportTravelModal({ allLegs, allAccoms, members, trip, onClose }) {
  const eligible = membersWithTravel(members, allLegs, allAccoms)
  const [selected, setSelected] = useState(new Set(eligible.map(m => m.id)))
  const [exported, setExported] = useState(false)

  function toggle(id) {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  function doExport() {
    if (!selected.size) return
    const ids = [...selected]
    const filteredLegs = allLegs.filter(l => l.traveler_ids?.some(id => ids.includes(id)))
    const filteredAccoms = allAccoms.filter(a => a.traveler_ids?.some(id => ids.includes(id)))
    downloadTravelICS({ legs: filteredLegs, accommodations: filteredAccoms, trip })
    setExported(true)
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
              Export Travel Details
            </h2>
            <p className="text-xs mt-0.5" style={{ color: '#5a5248' }}>
              Choose whose journey to include in the .ics file
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.06)' }}>
            <X size={14} style={{ color: '#5a5248' }} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 pb-8 space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-xs tracking-widest uppercase" style={{ color: '#5a5248' }}>Travelers</p>
            <div className="flex gap-3">
              <button onClick={() => setSelected(new Set(eligible.map(m => m.id)))}
                className="text-xs" style={{ color: '#d4b87a' }}>All</button>
              <button onClick={() => setSelected(new Set())}
                className="text-xs" style={{ color: '#5a5248' }}>None</button>
            </div>
          </div>

          {eligible.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: '#5a5248' }}>
              No travelers have added journey details yet.
            </p>
          )}

          <div className="space-y-2">
            {eligible.map(member => {
              const legCount = legsForMember(allLegs, member.id).length
              const accomCount = accomsForMember(allAccoms, member.id).length
              const checked = selected.has(member.id)
              const initial = member.full_name?.[0]?.toUpperCase() || '?'
              const summaryParts = []
              if (legCount > 0) summaryParts.push(`${legCount} leg${legCount !== 1 ? 's' : ''}`)
              if (accomCount > 0) summaryParts.push(`${accomCount} stay${accomCount !== 1 ? 's' : ''}`)

              return (
                <button key={member.id} onClick={() => toggle(member.id)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all text-left"
                  style={{
                    background: checked ? 'rgba(212,184,122,0.08)' : 'rgba(255,255,255,0.03)',
                    border: checked ? '1px solid rgba(212,184,122,0.25)' : '1px solid rgba(255,255,255,0.06)',
                  }}>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center font-display text-lg flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
                    {initial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: checked ? '#d4cfc8' : '#5a5248' }}>
                      {member.full_name}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: '#3d3830' }}>
                      {summaryParts.length > 0 ? summaryParts.join(' · ') : 'No details'}
                    </p>
                  </div>
                  <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{
                      background: checked ? '#d4b87a' : 'rgba(255,255,255,0.06)',
                      border: checked ? 'none' : '1px solid rgba(255,255,255,0.1)',
                    }}>
                    {checked && <Check size={11} color="#0a0908" strokeWidth={3} />}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="space-y-2 pt-1">
            <button onClick={doExport} disabled={selected.size === 0}
              className="w-full py-4 rounded-2xl font-medium tracking-wider transition-all active:scale-95 flex items-center justify-center gap-2"
              style={{
                background: exported
                  ? 'rgba(138,171,142,0.2)'
                  : selected.size === 0 ? '#2a2621'
                    : 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)',
                color: exported ? '#8aab8e' : selected.size === 0 ? '#3d3830' : '#0a0908',
                cursor: selected.size === 0 ? 'default' : 'pointer',
              }}>
              {exported
                ? <><Check size={15} /> Exported!</>
                : <><CalendarDays size={15} /> Export Travel to Calendar</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TravelersTab({
  tripId, trip, members, travelDetails = [], sharedLegs = [], sharedAccoms = [],
  currentUser, onUpdate,
}) {
  const [expandedUser, setExpandedUser] = useState(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState('')
  const [showExport, setShowExport] = useState(false)

  // modal state
  const [legModal, setLegModal] = useState(null)        // { mode, initial, target }
  const [accomModal, setAccomModal] = useState(null)
  const [saving, setSaving] = useState(false)

  const isOwner = members.find(m => m.id === currentUser?.id)?.role === 'owner'

  const allLegs = useMemo(
    () => normalizeLegs({ legacyDetails: travelDetails, sharedLegs, members }),
    [travelDetails, sharedLegs, members]
  )
  const allAccoms = useMemo(
    () => normalizeAccommodations({ legacyDetails: travelDetails, sharedAccoms, members }),
    [travelDetails, sharedAccoms, members]
  )

  const hasAnyTravel = allLegs.length > 0 || allAccoms.length > 0

  // ── invite ─────────────────────────────────────────────────────────────────

  async function inviteMember() {
    setInviting(true); setInviteMsg('')
    const snap = await getDocs(
      query(collection(db, 'profiles'), where('email', '==', inviteEmail.trim().toLowerCase()))
    )
    if (snap.empty) { setInviteMsg('No user found with that email.'); setInviting(false); return }
    const profile = { id: snap.docs[0].id, ...snap.docs[0].data() }
    if (members.find(m => m.id === profile.id)) {
      setInviteMsg(`${profile.full_name} is already in this trip.`)
      setInviting(false); return
    }
    await addDoc(collection(db, 'trip_members'), {
      trip_id: tripId, user_id: profile.id, role: 'member', created_at: serverTimestamp(),
    })
    setInviteMsg(`${profile.full_name} added!`)
    setInviteEmail(''); setInviting(false); onUpdate()
  }

  // ── add leg / accommodation ────────────────────────────────────────────────

  function openAddLeg(prefilledTravelerId) {
    setLegModal({
      mode: 'add',
      initial: {
        ...BLANK_LEG_FORM,
        depart_tz: trip?.timezone || '',
        arrive_tz: trip?.timezone || '',
        traveler_ids: prefilledTravelerId ? [prefilledTravelerId] : [],
      },
      target: null,
    })
  }

  function openAddAccom(prefilledTravelerId) {
    setAccomModal({
      mode: 'add',
      initial: {
        ...BLANK_ACCOM_FORM,
        traveler_ids: prefilledTravelerId ? [prefilledTravelerId] : [],
      },
      target: null,
    })
  }

  // ── edit leg ───────────────────────────────────────────────────────────────

  function openEditLeg(leg) {
    setLegModal({
      mode: 'edit',
      initial: {
        transport: leg.transport || 'flight',
        number:    leg.number || '',
        from:      leg.from || '',
        to:        leg.to || '',
        depart_at: leg.depart_at || '',
        arrive_at: leg.arrive_at || '',
        depart_tz: leg.depart_tz || '',
        arrive_tz: leg.arrive_tz || '',
        notes:     leg.notes || '',
        traveler_ids: leg.traveler_ids || [],
      },
      target: leg,
    })
  }

  function openEditAccom(accom) {
    setAccomModal({
      mode: 'edit',
      initial: {
        name:      accom.name || '',
        address:   accom.address || '',
        check_in:  accom.check_in || '',
        check_out: accom.check_out || '',
        notes:     accom.notes || '',
        traveler_ids: accom.traveler_ids || [],
      },
      target: accom,
    })
  }

  // ── save handlers ──────────────────────────────────────────────────────────

  async function saveLeg(form) {
    setSaving(true)
    const target = legModal?.target
    const payload = {
      trip_id: tripId,
      traveler_ids: form.traveler_ids,
      transport: form.transport,
      number: form.number || '',
      from: form.from || '',
      to: form.to || '',
      depart_at: form.depart_at || '',
      arrive_at: form.arrive_at || '',
      depart_tz: form.depart_tz || '',
      arrive_tz: form.arrive_tz || '',
      notes: form.notes || '',
      updated_at: serverTimestamp(),
    }

    try {
      if (legModal.mode === 'add') {
        await addDoc(collection(db, 'trip_legs'), {
          ...payload, created_by: currentUser.id, created_at: serverTimestamp(),
        })
      } else if (target?._source === SOURCES.SHARED) {
        await updateDoc(doc(db, 'trip_legs', target._docId), payload)
      } else if (target?._source === SOURCES.LEGACY) {
        // Lazy migration: write to trip_legs, then strip from legacy doc
        await addDoc(collection(db, 'trip_legs'), {
          ...payload, created_by: currentUser.id, created_at: serverTimestamp(),
        })
        await stripLegacyLeg(target._legacyDocId, target._legacyIdx)
      }
    } finally {
      setSaving(false)
      setLegModal(null)
      onUpdate()
    }
  }

  async function saveAccom(form) {
    setSaving(true)
    const target = accomModal?.target
    const payload = {
      trip_id: tripId,
      traveler_ids: form.traveler_ids,
      name: form.name || '',
      address: form.address || '',
      check_in: form.check_in || '',
      check_out: form.check_out || '',
      notes: form.notes || '',
      updated_at: serverTimestamp(),
    }

    try {
      if (accomModal.mode === 'add') {
        await addDoc(collection(db, 'trip_accommodations'), {
          ...payload, created_by: currentUser.id, created_at: serverTimestamp(),
        })
      } else if (target?._source === SOURCES.SHARED) {
        await updateDoc(doc(db, 'trip_accommodations', target._docId), payload)
      } else if (target?._source === SOURCES.LEGACY) {
        await addDoc(collection(db, 'trip_accommodations'), {
          ...payload, created_by: currentUser.id, created_at: serverTimestamp(),
        })
        await clearLegacyAccom(target._legacyDocId)
      }
    } finally {
      setSaving(false)
      setAccomModal(null)
      onUpdate()
    }
  }

  // ── delete handlers ────────────────────────────────────────────────────────

  async function deleteLeg(leg) {
    if (!confirm('Delete this transport leg?')) return
    if (leg._source === SOURCES.SHARED) {
      await deleteDoc(doc(db, 'trip_legs', leg._docId))
    } else if (leg._source === SOURCES.LEGACY) {
      await stripLegacyLeg(leg._legacyDocId, leg._legacyIdx)
    }
    onUpdate()
  }

  async function deleteAccom(accom) {
    if (!confirm('Delete this accommodation?')) return
    if (accom._source === SOURCES.SHARED) {
      await deleteDoc(doc(db, 'trip_accommodations', accom._docId))
    } else if (accom._source === SOURCES.LEGACY) {
      await clearLegacyAccom(accom._legacyDocId)
    }
    onUpdate()
  }

  async function stripLegacyLeg(docId, idx) {
    // Remove a single leg from the legs[] array of a legacy travel_details doc.
    const detail = travelDetails.find(d => d._docId === docId)
    if (!detail) return
    const remaining = (detail.legs || []).filter((_, i) => i !== idx)
    await updateDoc(doc(db, 'travel_details', docId), {
      legs: remaining, updated_at: serverTimestamp(),
    })
  }

  async function clearLegacyAccom(docId) {
    await updateDoc(doc(db, 'travel_details', docId), {
      accommodation: '', accommodation_address: '', updated_at: serverTimestamp(),
    })
  }

  // ── permissions ────────────────────────────────────────────────────────────

  function canEditItem(item) {
    if (item._source === SOURCES.SHARED) {
      return item.created_by === currentUser?.id
    }
    if (item._source === SOURCES.LEGACY) {
      return item._legacyOwnerId === currentUser?.id
    }
    return false
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="px-6 pt-4 space-y-4">

      {hasAnyTravel && (
        <button
          onClick={() => setShowExport(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-xs transition-all"
          style={{
            background: 'rgba(212,184,122,0.07)',
            border: '1px solid rgba(212,184,122,0.15)',
            color: '#d4b87a',
          }}>
          <CalendarDays size={13} />Export travel to calendar
        </button>
      )}

      {/* Top-level add buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => openAddLeg(currentUser?.id)}
          className="flex items-center justify-center gap-2 px-3 py-3 rounded-2xl text-xs transition-all"
          style={{
            background: 'rgba(212,184,122,0.08)',
            border: '1px dashed rgba(212,184,122,0.3)',
            color: '#d4b87a',
          }}>
          <Plane size={13} />Add flight / transport
        </button>
        <button onClick={() => openAddAccom(currentUser?.id)}
          className="flex items-center justify-center gap-2 px-3 py-3 rounded-2xl text-xs transition-all"
          style={{
            background: 'rgba(122,154,181,0.08)',
            border: '1px dashed rgba(122,154,181,0.3)',
            color: '#7a9ab5',
          }}>
          <Building2 size={13} />Add accommodation
        </button>
      </div>

      {/* Invite */}
      {isOwner && (
        <div className="glass rounded-2xl p-5 fade-in">
          <h3 className="font-display text-lg font-light mb-3" style={{ color: '#e8d5a3' }}>Invite a Traveler</h3>
          <div className="flex gap-2">
            <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
              placeholder="friend@email.com"
              className="flex-1 px-4 py-3 rounded-xl text-sm outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(212,184,122,0.15)', color: '#d4cfc8' }} />
            <button onClick={inviteMember} disabled={inviting || !inviteEmail}
              className="px-4 py-3 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
              <UserPlus size={16} />
            </button>
          </div>
          {inviteMsg && (
            <p className="text-xs mt-2" style={{ color: inviteMsg.includes('added') ? '#8aab8e' : '#c47c5a' }}>
              {inviteMsg}
            </p>
          )}
        </div>
      )}

      {/* Per-member cards */}
      {members.map(member => {
        const memberLegs = legsForMember(allLegs, member.id)
        const memberAccoms = accomsForMember(allAccoms, member.id)
        const hasItems = memberLegs.length > 0 || memberAccoms.length > 0
        const isExpanded = expandedUser === member.id

        return (
          <div key={member.id} className="glass rounded-2xl overflow-hidden fade-in">

            <div className="flex items-center justify-between p-5"
              style={{ borderBottom: (hasItems && isExpanded) ? '1px solid rgba(212,184,122,0.08)' : 'none' }}>
              <button
                className="flex items-center gap-3 flex-1 min-w-0 text-left"
                onClick={() => hasItems && setExpandedUser(isExpanded ? null : member.id)}
                disabled={!hasItems}>
                <div className="w-10 h-10 rounded-full flex items-center justify-center font-display text-lg flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
                  {member.full_name?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate" style={{ color: '#d4cfc8' }}>{member.full_name}</p>
                  <p className="text-xs capitalize" style={{ color: '#5a5248' }}>
                    {member.role}
                    {memberLegs.length > 0 && (
                      <span style={{ color: '#3d3830' }}> · {memberLegs.length} leg{memberLegs.length !== 1 ? 's' : ''}</span>
                    )}
                    {memberAccoms.length > 0 && (
                      <span style={{ color: '#3d3830' }}> · {memberAccoms.length} stay{memberAccoms.length !== 1 ? 's' : ''}</span>
                    )}
                    {!hasItems && (
                      <span style={{ color: '#3d3830' }}> · no details yet</span>
                    )}
                  </p>
                </div>
              </button>

              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                {hasItems && (
                  <button onClick={() => setExpandedUser(isExpanded ? null : member.id)}
                    style={{ color: '#5a5248' }}>
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                )}
              </div>
            </div>

            {hasItems && isExpanded && (
              <div className="px-5 pb-5 pt-4 space-y-5 slide-up">
                {memberLegs.length > 0 && (
                  <div>
                    <p className="text-xs tracking-widest uppercase mb-3" style={{ color: '#5a5248' }}>Journey</p>
                    <JourneyTimeline
                      legs={memberLegs}
                      members={members}
                      currentUser={currentUser}
                      onEdit={leg => canEditItem(leg) && openEditLeg(leg)}
                      onDelete={leg => canEditItem(leg) && deleteLeg(leg)}
                      canEditFn={canEditItem}
                    />
                  </div>
                )}
                {memberAccoms.length > 0 && (
                  <div>
                    <p className="text-xs tracking-widest uppercase mb-3" style={{ color: '#5a5248' }}>Stays</p>
                    <div className="space-y-2">
                      {memberAccoms.map((accom, i) => (
                        <AccommodationRow
                          key={i}
                          accom={accom}
                          members={members}
                          currentUser={currentUser}
                          onEdit={() => canEditItem(accom) && openEditAccom(accom)}
                          onDelete={() => canEditItem(accom) && deleteAccom(accom)}
                          canEdit={canEditItem(accom)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button onClick={() => openAddLeg(member.id)}
                    className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs"
                    style={{ background: 'rgba(255,255,255,0.04)', color: '#5a5248', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <Plus size={11} />Flight for {member.full_name?.split(' ')[0]}
                  </button>
                  <button onClick={() => openAddAccom(member.id)}
                    className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs"
                    style={{ background: 'rgba(255,255,255,0.04)', color: '#5a5248', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <Plus size={11} />Stay for {member.full_name?.split(' ')[0]}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Modals */}
      {legModal && (
        <LegModal
          initial={legModal.initial}
          mode={legModal.mode}
          members={members}
          saving={saving}
          onSave={saveLeg}
          onClose={() => setLegModal(null)}
        />
      )}
      {accomModal && (
        <AccommodationModal
          initial={accomModal.initial}
          mode={accomModal.mode}
          members={members}
          saving={saving}
          onSave={saveAccom}
          onClose={() => setAccomModal(null)}
        />
      )}
      {showExport && (
        <ExportTravelModal
          allLegs={allLegs}
          allAccoms={allAccoms}
          members={members}
          trip={trip}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  )
}

// ─── JourneyTimeline (view mode) ──────────────────────────────────────────────

function JourneyTimeline({ legs, members, currentUser, onEdit, onDelete, canEditFn }) {
  // Sort legs by depart_at
  const sorted = [...legs].sort((a, b) => {
    const at = a.depart_at || ''
    const bt = b.depart_at || ''
    return at.localeCompare(bt)
  })

  return (
    <div className="space-y-0">
      {sorted.map((leg, idx) => {
        const transport = TRANSPORT_MAP[leg.transport] || TRANSPORT_MAP.other
        const isLast = idx === sorted.length - 1
        const sharedNames = (leg.traveler_ids || [])
          .filter(id => id !== currentUser?.id)
          .map(id => members.find(m => m.id === id)?.full_name?.split(' ')[0])
          .filter(Boolean)

        const editable = canEditFn(leg)

        return (
          <div key={idx} className="relative group">
            <div className="flex items-start gap-3">
              <div className="flex flex-col items-center flex-shrink-0" style={{ width: 28 }}>
                <div className="w-3 h-3 rounded-full flex-shrink-0 mt-0.5"
                  style={{ background: idx === 0 ? '#8aab8e' : '#d4b87a', border: '2px solid #1c1916', zIndex: 1 }} />
                <div className="flex-1 w-px mt-1" style={{ background: 'rgba(212,184,122,0.15)', minHeight: 40 }} />
              </div>
              <div className="flex-1 pb-3 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: '#d4cfc8' }}>{leg.from || '—'}</p>
                    {leg.depart_at && (
                      <p className="text-xs" style={{ color: '#5a5248' }}>
                        {formatDT(leg.depart_at, leg.depart_tz)}
                      </p>
                    )}
                  </div>
                  {editable && (
                    <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => onEdit(leg)}
                        className="w-6 h-6 rounded-lg flex items-center justify-center"
                        style={{ color: '#7a9ab5', background: 'rgba(122,154,181,0.1)' }} title="Edit">
                        <Edit2 size={10} />
                      </button>
                      <button onClick={() => onDelete(leg)}
                        className="w-6 h-6 rounded-lg flex items-center justify-center"
                        style={{ color: '#c47c5a', background: 'rgba(196,124,90,0.1)' }} title="Delete">
                        <Trash2 size={10} />
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 my-2 flex-wrap">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
                    style={{ background: 'rgba(212,184,122,0.08)', border: '1px solid rgba(212,184,122,0.15)', color: '#b5aea4' }}>
                    <span>{transport.icon}</span>
                    <span>{transport.label}</span>
                    {leg.number && <span className="font-mono" style={{ color: '#d4b87a' }}>{leg.number}</span>}
                  </div>
                  {leg.depart_at && leg.arrive_at && (
                    <span className="text-xs" style={{ color: '#3d3830' }}>
                      {durationLabel(leg.depart_at, leg.arrive_at)}
                    </span>
                  )}
                  {sharedNames.length > 0 && (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(122,154,181,0.1)', color: '#7a9ab5' }}>
                      <Users size={9} />with {sharedNames.slice(0, 2).join(', ')}{sharedNames.length > 2 ? ` +${sharedNames.length - 2}` : ''}
                    </span>
                  )}
                </div>
                {leg.notes && <p className="text-xs mb-1" style={{ color: '#5a5248' }}>{leg.notes}</p>}
              </div>
            </div>

            {(isLast || sorted[idx + 1]?.from !== leg.to) && (
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center flex-shrink-0" style={{ width: 28 }}>
                  <div className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ background: isLast ? '#c47c5a' : '#d4b87a', border: '2px solid #1c1916' }} />
                  {!isLast && <div className="w-px" style={{ height: 8, background: 'rgba(212,184,122,0.15)' }} />}
                </div>
                <div className="flex-1 pb-3 min-w-0">
                  <p className="text-sm font-medium" style={{ color: '#d4cfc8' }}>{leg.to || '—'}</p>
                  {leg.arrive_at && (
                    <p className="text-xs" style={{ color: '#5a5248' }}>
                      {formatDT(leg.arrive_at, leg.arrive_tz || leg.depart_tz)}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Accommodation row ────────────────────────────────────────────────────────

function AccommodationRow({ accom, members, currentUser, onEdit, onDelete, canEdit }) {
  const sharedNames = (accom.traveler_ids || [])
    .filter(id => id !== currentUser?.id)
    .map(id => members.find(m => m.id === id)?.full_name?.split(' ')[0])
    .filter(Boolean)

  return (
    <div className="rounded-xl px-4 py-3 group"
      style={{ background: 'rgba(122,154,181,0.06)', border: '1px solid rgba(122,154,181,0.15)' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="text-base flex-shrink-0 mt-0.5">🏨</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium" style={{ color: '#d4cfc8' }}>{accom.name || 'Accommodation'}</p>
            {accom.address && <p className="text-xs mt-0.5" style={{ color: '#5a5248' }}>{accom.address}</p>}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {(accom.check_in || accom.check_out) && (
                <span className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(212,184,122,0.08)', color: '#d4b87a' }}>
                  {formatDate(accom.check_in) || '?'} – {formatDate(accom.check_out) || '?'}
                </span>
              )}
              {sharedNames.length > 0 && (
                <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(122,154,181,0.1)', color: '#7a9ab5' }}>
                  <Users size={9} />with {sharedNames.slice(0, 2).join(', ')}{sharedNames.length > 2 ? ` +${sharedNames.length - 2}` : ''}
                </span>
              )}
            </div>
            {accom.notes && <p className="text-xs mt-1.5" style={{ color: '#5a5248' }}>{accom.notes}</p>}
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={onEdit}
              className="w-6 h-6 rounded-lg flex items-center justify-center"
              style={{ color: '#7a9ab5', background: 'rgba(122,154,181,0.1)' }} title="Edit">
              <Edit2 size={10} />
            </button>
            <button onClick={onDelete}
              className="w-6 h-6 rounded-lg flex items-center justify-center"
              style={{ color: '#c47c5a', background: 'rgba(196,124,90,0.1)' }} title="Delete">
              <Trash2 size={10} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── small helpers ────────────────────────────────────────────────────────────

function InlineField({ label, children }) {
  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px' }}>
      <p className="text-xs mb-1" style={{ color: '#5a5248' }}>{label}</p>
      {children}
    </div>
  )
}
