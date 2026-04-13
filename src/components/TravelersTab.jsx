import { useState, useEffect } from 'react'
import {
  collection, query, where, getDocs,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { downloadTravelICS } from '../lib/ical'
import { Edit2, UserPlus, Plus, Trash2, ArrowRight, ChevronDown, ChevronUp, CalendarDays, Check, X } from 'lucide-react'

// ─── constants ────────────────────────────────────────────────────────────────

const TRANSPORT_OPTIONS = [
  { value: 'flight', label: 'Flight', icon: '✈️' },
  { value: 'train', label: 'Train', icon: '🚂' },
  { value: 'bus', label: 'Bus', icon: '🚌' },
  { value: 'car', label: 'Car', icon: '🚗' },
  { value: 'ferry', label: 'Ferry', icon: '⛴️' },
  { value: 'subway', label: 'Subway', icon: '🚇' },
  { value: 'taxi', label: 'Taxi', icon: '🚕' },
  { value: 'walk', label: 'Walking', icon: '🚶' },
  { value: 'other', label: 'Other', icon: '🛸' },
]
const TRANSPORT_MAP = Object.fromEntries(TRANSPORT_OPTIONS.map(t => [t.value, t]))

const BLANK_LEG = { transport: 'flight', number: '', from: '', to: '', depart_at: '', arrive_at: '', notes: '' }
const BLANK_DETAILS = { legs: [], accommodation: '', accommodation_address: '', notes: '' }

function newLeg() { return { ...BLANK_LEG, _id: Math.random().toString(36).slice(2) } }

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDT(dt) {
  if (!dt) return null
  try {
    return new Date(dt).toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return dt }
}

function durationLabel(from, to) {
  try {
    const mins = Math.round((new Date(to) - new Date(from)) / 60000)
    if (mins < 0) return null
    const h = Math.floor(mins / 60), m = mins % 60
    return h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}`.trim() : `${m}m`
  } catch { return null }
}

// ─── Export Modal ─────────────────────────────────────────────────────────────

function ExportTravelModal({ travelDetails, members, trip, onClose }) {
  const membersWithDetails = members.filter(m => travelDetails[m.id])
  const [selected, setSelected] = useState(new Set(membersWithDetails.map(m => m.id)))
  const [exported, setExported] = useState(false)

  function toggle(id) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function doExport() {
    if (!selected.size) return
    const detailsArr = Object.values(travelDetails)
    downloadTravelICS(detailsArr, members, [...selected], trip.name, trip)
    setExported(true)
    setTimeout(onClose, 1200)
  }

  // Count legs per member
  function legCount(memberId) {
    return (travelDetails[memberId]?.legs || []).length
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-lg rounded-t-3xl slide-up overflow-hidden"
        style={{ background: '#1c1916', border: '1px solid rgba(212,184,122,0.14)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
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

          {/* Select all / none */}
          <div className="flex items-center justify-between">
            <p className="text-xs tracking-widest uppercase" style={{ color: '#5a5248' }}>Travelers</p>
            <div className="flex gap-3">
              <button onClick={() => setSelected(new Set(membersWithDetails.map(m => m.id)))}
                className="text-xs" style={{ color: '#d4b87a' }}>All</button>
              <button onClick={() => setSelected(new Set())}
                className="text-xs" style={{ color: '#5a5248' }}>None</button>
            </div>
          </div>

          {membersWithDetails.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: '#5a5248' }}>
              No travelers have added journey details yet.
            </p>
          )}

          {/* Member rows */}
          <div className="space-y-2">
            {membersWithDetails.map(member => {
              const detail = travelDetails[member.id]
              const legs = detail?.legs || []
              const hasAccom = !!(detail?.accommodation || detail?.accommodation_address)
              const checked = selected.has(member.id)
              const initial = member.full_name?.[0]?.toUpperCase() || '?'

              // Build a mini summary of what will be exported
              const summaryParts = []
              if (legs.length > 0) summaryParts.push(`${legs.length} leg${legs.length !== 1 ? 's' : ''}`)
              if (hasAccom) summaryParts.push('accommodation')

              return (
                <button key={member.id} onClick={() => toggle(member.id)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all text-left"
                  style={{
                    background: checked ? 'rgba(212,184,122,0.08)' : 'rgba(255,255,255,0.03)',
                    border: checked ? '1px solid rgba(212,184,122,0.25)' : '1px solid rgba(255,255,255,0.06)',
                  }}>
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full flex items-center justify-center font-display text-lg flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
                    {initial}
                  </div>

                  {/* Name + summary */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: checked ? '#d4cfc8' : '#5a5248' }}>
                      {member.full_name}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: '#3d3830' }}>
                      {summaryParts.length > 0 ? summaryParts.join(' · ') : 'No details'}
                    </p>
                  </div>

                  {/* Leg transport icons */}
                  {legs.length > 0 && (
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      {[...new Set(legs.map(l => TRANSPORT_MAP[l.transport]?.icon || '🛸'))].map((icon, i) => (
                        <span key={i} className="text-sm">{icon}</span>
                      ))}
                    </div>
                  )}

                  {/* Checkbox */}
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

          {/* What gets exported note */}
          {selected.size > 0 && (
            <div className="px-4 py-3 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-xs" style={{ color: '#5a5248' }}>
                Each journey leg becomes a calendar event with transport details. Accommodation is added as a multi-day event where dates can be inferred.
              </p>
            </div>
          )}

          {/* Export button */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between px-1">
              <p className="text-xs" style={{ color: '#5a5248' }}>
                {selected.size === 0
                  ? 'Select at least one traveler'
                  : `Exporting details for ${selected.size} traveler${selected.size !== 1 ? 's' : ''}`}
              </p>
              {selected.size > 0 && <p className="text-xs" style={{ color: '#3d3830' }}>→ .ics file</p>}
            </div>
            <button
              onClick={doExport}
              disabled={selected.size === 0}
              className="w-full py-4 rounded-2xl font-medium tracking-wider transition-all active:scale-95 flex items-center justify-center gap-2"
              style={{
                background: exported
                  ? 'rgba(138,171,142,0.2)'
                  : selected.size === 0
                    ? '#2a2621'
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

// ─── main component ───────────────────────────────────────────────────────────

export default function TravelersTab({ tripId, trip, members, currentUser, onUpdate }) {
  const [detailsByUser, setDetailsByUser] = useState({})
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(BLANK_DETAILS)
  const [expandedUser, setExpandedUser] = useState(null)
  const [saving, setSaving] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState('')
  const [showExport, setShowExport] = useState(false)

  useEffect(() => { loadDetails() }, [tripId])

  async function loadDetails() {
    const snap = await getDocs(
      query(collection(db, 'travel_details'), where('trip_id', '==', tripId))
    )
    const map = {}
    snap.docs.forEach(d => { map[d.data().user_id] = { _docId: d.id, ...d.data() } })
    setDetailsByUser(map)
  }

  // ── leg helpers ──────────────────────────────────────────────────────────────

  function updateLeg(idx, field, value) {
    const legs = [...form.legs]
    legs[idx] = { ...legs[idx], [field]: value }
    setForm({ ...form, legs })
  }

  function addLeg() { setForm({ ...form, legs: [...form.legs, newLeg()] }) }

  function removeLeg(idx) { setForm({ ...form, legs: form.legs.filter((_, i) => i !== idx) }) }

  function moveLeg(idx, dir) {
    const legs = [...form.legs]
    const to = idx + dir
    if (to < 0 || to >= legs.length) return
      ;[legs[idx], legs[to]] = [legs[to], legs[idx]]
    setForm({ ...form, legs })
  }

  function handleLegFromChange(idx, value) {
    const legs = [...form.legs]
    legs[idx] = { ...legs[idx], from: value }
    if (idx > 0 && !legs[idx - 1].to) legs[idx - 1] = { ...legs[idx - 1], to: value }
    setForm({ ...form, legs })
  }

  function handleLegToChange(idx, value) {
    const legs = [...form.legs]
    legs[idx] = { ...legs[idx], to: value }
    if (idx < legs.length - 1 && !legs[idx + 1].from) legs[idx + 1] = { ...legs[idx + 1], from: value }
    setForm({ ...form, legs })
  }

  // ── save ─────────────────────────────────────────────────────────────────────

  async function saveDetails(userId) {
    setSaving(true)
    const cleanLegs = form.legs.map(({ _id, ...rest }) => rest)
    const payload = {
      legs: cleanLegs,
      accommodation: form.accommodation,
      accommodation_address: form.accommodation_address,
      notes: form.notes,
      trip_id: tripId,
      user_id: userId,
      updated_at: serverTimestamp(),
    }
    const existing = detailsByUser[userId]
    if (existing) {
      await updateDoc(doc(db, 'travel_details', existing._docId), payload)
    } else {
      await addDoc(collection(db, 'travel_details'), { ...payload, created_at: serverTimestamp() })
    }
    setSaving(false)
    setEditingId(null)
    setExpandedUser(userId)
    loadDetails()
  }

  function startEditing(member) {
    const existing = detailsByUser[member.id]
    if (existing) {
      setForm({
        legs: (existing.legs || []).map(l => ({ ...BLANK_LEG, ...l, _id: Math.random().toString(36).slice(2) })),
        accommodation: existing.accommodation || '',
        accommodation_address: existing.accommodation_address || '',
        notes: existing.notes || '',
      })
    } else {
      setForm({ ...BLANK_DETAILS, legs: [newLeg()] })
    }
    setEditingId(member.id)
    setExpandedUser(null)
  }

  // ── invite ───────────────────────────────────────────────────────────────────

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
      trip_id: tripId, user_id: profile.id, role: 'member', created_at: serverTimestamp()
    })
    setInviteMsg(`${profile.full_name} added!`)
    setInviteEmail(''); setInviting(false); onUpdate()
  }

  const isOwner = members.find(m => m.id === currentUser.id)?.role === 'owner'
  const hasAnyDetails = Object.keys(detailsByUser).length > 0

  // ── render ───────────────────────────────────────────────────────────────────

  return (
    <div className="px-6 pt-4 space-y-4">

      {/* Export + Invite row */}
      <div className="flex gap-3">
        {/* Export to calendar — only if any details exist */}
        {hasAnyDetails && (
          <button
            onClick={() => setShowExport(true)}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-xs transition-all flex-1"
            style={{
              background: 'rgba(212,184,122,0.07)',
              border: '1px solid rgba(212,184,122,0.15)',
              color: '#d4b87a',
            }}>
            <CalendarDays size={13} />Export travel to calendar
          </button>
        )}
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
        const details = detailsByUser[member.id]
        const isEditing = editingId === member.id
        const canEdit = member.id === currentUser.id || isOwner
        const isExpanded = expandedUser === member.id
        const legs = details?.legs || []

        return (
          <div key={member.id} className="glass rounded-2xl overflow-hidden fade-in">

            {/* ── Member header ── */}
            <div className="flex items-center justify-between p-5"
              style={{ borderBottom: (isEditing || (details && isExpanded)) ? '1px solid rgba(212,184,122,0.08)' : 'none' }}>
              <button
                className="flex items-center gap-3 flex-1 min-w-0 text-left"
                onClick={() => !isEditing && details && setExpandedUser(isExpanded ? null : member.id)}
                disabled={isEditing || !details}>
                <div className="w-10 h-10 rounded-full flex items-center justify-center font-display text-lg flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
                  {member.full_name?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate" style={{ color: '#d4cfc8' }}>{member.full_name}</p>
                  <p className="text-xs capitalize" style={{ color: '#5a5248' }}>
                    {member.role}
                    {legs.length > 0 && !isEditing && (
                      <span style={{ color: '#3d3830' }}> · {legs.length} leg{legs.length !== 1 ? 's' : ''}</span>
                    )}
                    {!details && !isEditing && canEdit && (
                      <span style={{ color: '#3d3830' }}> · no details yet</span>
                    )}
                  </p>
                </div>
              </button>

              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                {details && !isEditing && (
                  <button onClick={() => setExpandedUser(isExpanded ? null : member.id)}
                    style={{ color: '#5a5248' }}>
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                )}
                {canEdit && !isEditing && (
                  <button onClick={() => startEditing(member)}
                    className="w-8 h-8 rounded-xl flex items-center justify-center"
                    style={{ background: 'rgba(255,255,255,0.05)', color: '#5a5248' }}>
                    <Edit2 size={12} />
                  </button>
                )}
                {isEditing && (
                  <button onClick={() => setEditingId(null)}
                    className="px-3 py-1.5 rounded-xl text-xs"
                    style={{ background: 'rgba(255,255,255,0.05)', color: '#5a5248' }}>
                    Cancel
                  </button>
                )}
              </div>
            </div>

            {/* ── View mode ── */}
            {!isEditing && details && isExpanded && (
              <div className="px-5 pb-5 pt-4 space-y-4 slide-up">
                {legs.length > 0 && (
                  <div>
                    <p className="text-xs tracking-widest uppercase mb-3" style={{ color: '#5a5248' }}>Journey</p>
                    <JourneyTimeline legs={legs} />
                  </div>
                )}
                {(details.accommodation || details.accommodation_address) && (
                  <InfoRow icon="🏨" label="Accommodation">
                    {[details.accommodation, details.accommodation_address].filter(Boolean).join(' · ')}
                  </InfoRow>
                )}
                {details.notes && <InfoRow icon="📝" label="Notes">{details.notes}</InfoRow>}
              </div>
            )}

            {/* ── Edit mode ── */}
            {isEditing && (
              <div className="px-5 pb-5 pt-4 space-y-5 slide-up">

                {/* Journey legs */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs tracking-widest uppercase" style={{ color: '#5a5248' }}>Journey Legs</p>
                    <button onClick={addLeg}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs transition-all"
                      style={{ background: 'rgba(212,184,122,0.1)', border: '1px solid rgba(212,184,122,0.2)', color: '#d4b87a' }}>
                      <Plus size={11} />Add leg
                    </button>
                  </div>

                  {form.legs.length === 0 && (
                    <button onClick={addLeg}
                      className="w-full py-6 rounded-xl text-sm flex flex-col items-center gap-2 transition-all"
                      style={{ border: '1px dashed rgba(212,184,122,0.2)', color: '#5a5248' }}>
                      <Plus size={16} style={{ color: '#3d3830' }} />
                      Add your first leg
                    </button>
                  )}

                  <div className="space-y-3">
                    {form.legs.map((leg, idx) => (
                      <LegEditor
                        key={leg._id}
                        leg={leg}
                        idx={idx}
                        total={form.legs.length}
                        onUpdate={(field, val) => {
                          if (field === 'from') handleLegFromChange(idx, val)
                          else if (field === 'to') handleLegToChange(idx, val)
                          else updateLeg(idx, field, val)
                        }}
                        onRemove={() => removeLeg(idx)}
                        onMove={dir => moveLeg(idx, dir)}
                      />
                    ))}
                  </div>
                </div>

                {/* Accommodation */}
                <div className="rounded-xl p-4 space-y-3"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <p className="text-xs tracking-widest uppercase" style={{ color: '#5a5248' }}>Accommodation</p>
                  <InlineField label="Name">
                    <input value={form.accommodation}
                      onChange={e => setForm({ ...form, accommodation: e.target.value })}
                      placeholder="Hotel / Airbnb name"
                      className="w-full bg-transparent text-xs outline-none" style={{ color: '#d4cfc8' }} />
                  </InlineField>
                  <InlineField label="Address">
                    <input value={form.accommodation_address}
                      onChange={e => setForm({ ...form, accommodation_address: e.target.value })}
                      placeholder="Full address"
                      className="w-full bg-transparent text-xs outline-none" style={{ color: '#d4cfc8' }} />
                  </InlineField>
                </div>

                {/* Notes */}
                <div>
                  <p className="text-xs tracking-widest uppercase mb-2" style={{ color: '#5a5248' }}>Notes</p>
                  <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                    rows={2} placeholder="Dietary needs, preferences, contact info…"
                    className="w-full bg-transparent text-xs outline-none resize-none"
                    style={{ color: '#d4cfc8', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px' }} />
                </div>

                <button onClick={() => saveDetails(member.id)} disabled={saving}
                  className="w-full py-3 rounded-2xl text-sm font-medium transition-all active:scale-95"
                  style={{ background: saving ? '#3d3830' : 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
                  {saving ? 'Saving…' : 'Save Travel Details'}
                </button>
              </div>
            )}
          </div>
        )
      })}

      {/* Export modal */}
      {showExport && (
        <ExportTravelModal
          travelDetails={detailsByUser}
          members={members}
          trip={trip}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  )
}

// ─── LegEditor ────────────────────────────────────────────────────────────────

function LegEditor({ leg, idx, total, onUpdate, onRemove, onMove }) {
  const transport = TRANSPORT_MAP[leg.transport] || TRANSPORT_MAP.other
  const [open, setOpen] = useState(true)

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>

      <div className="flex items-center gap-2 px-3 py-2.5"
        style={{ borderBottom: open ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
        <span className="text-base flex-shrink-0">{transport.icon}</span>
        {!open && (
          <div className="flex-1 min-w-0">
            <p className="text-xs truncate" style={{ color: '#d4cfc8' }}>
              {leg.from || '?'} → {leg.to || '?'}
              {leg.number && <span style={{ color: '#5a5248' }}> · {leg.number}</span>}
            </p>
          </div>
        )}
        {open && (
          <p className="flex-1 text-xs font-medium" style={{ color: '#d4b87a' }}>
            Leg {idx + 1} — {transport.label}
          </p>
        )}
        <div className="flex items-center gap-1 flex-shrink-0">
          {total > 1 && idx > 0 && <button onClick={() => onMove(-1)} className="w-6 h-6 rounded flex items-center justify-center text-xs" style={{ color: '#5a5248' }}>↑</button>}
          {total > 1 && idx < total - 1 && <button onClick={() => onMove(1)} className="w-6 h-6 rounded flex items-center justify-center text-xs" style={{ color: '#5a5248' }}>↓</button>}
          <button onClick={() => setOpen(!open)} className="w-6 h-6 rounded flex items-center justify-center" style={{ color: '#5a5248' }}>
            {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          <button onClick={onRemove} className="w-6 h-6 rounded flex items-center justify-center" style={{ color: '#5a5248' }}>
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {open && (
        <div className="px-3 py-3 space-y-3">
          <div>
            <p className="text-xs mb-1.5" style={{ color: '#5a5248' }}>Transport</p>
            <div className="flex flex-wrap gap-1.5">
              {TRANSPORT_OPTIONS.map(t => (
                <button key={t.value} onClick={() => onUpdate('transport', t.value)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all"
                  style={{
                    background: leg.transport === t.value ? 'rgba(212,184,122,0.18)' : 'rgba(255,255,255,0.04)',
                    border: leg.transport === t.value ? '1px solid rgba(212,184,122,0.35)' : '1px solid rgba(255,255,255,0.06)',
                    color: leg.transport === t.value ? '#d4b87a' : '#5a5248',
                  }}>
                  <span>{t.icon}</span> {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <InlineField label="From">
              <input value={leg.from} onChange={e => onUpdate('from', e.target.value)}
                placeholder="City / Airport / Station"
                className="w-full bg-transparent text-xs outline-none" style={{ color: '#d4cfc8' }} />
            </InlineField>
            <InlineField label="To">
              <input value={leg.to} onChange={e => onUpdate('to', e.target.value)}
                placeholder="City / Airport / Station"
                className="w-full bg-transparent text-xs outline-none" style={{ color: '#d4cfc8' }} />
            </InlineField>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {['flight', 'train', 'bus', 'ferry', 'subway'].includes(leg.transport) && (
              <InlineField label={leg.transport === 'flight' ? 'Flight number' : leg.transport === 'train' ? 'Train number' : 'Route / Line'}>
                <input value={leg.number} onChange={e => onUpdate('number', e.target.value)}
                  placeholder={leg.transport === 'flight' ? 'e.g. BA123' : leg.transport === 'train' ? 'e.g. ICE 607' : 'e.g. Line 4'}
                  className="w-full bg-transparent text-xs outline-none" style={{ color: '#d4cfc8' }} />
              </InlineField>
            )}
            <div className="grid grid-cols-2 gap-2">
              <InlineField label="Departs">
                <input type="datetime-local" value={leg.depart_at}
                  onChange={e => onUpdate('depart_at', e.target.value)}
                  className="w-full bg-transparent text-xs outline-none"
                  style={{ color: '#d4cfc8', background: 'transparent' }} />
              </InlineField>
              <InlineField label="Arrives">
                <input type="datetime-local" value={leg.arrive_at}
                  onChange={e => onUpdate('arrive_at', e.target.value)}
                  className="w-full bg-transparent text-xs outline-none"
                  style={{ color: '#d4cfc8', background: 'transparent' }} />
              </InlineField>
            </div>
          </div>

          <InlineField label="Notes (optional)">
            <input value={leg.notes} onChange={e => onUpdate('notes', e.target.value)}
              placeholder="Seat, booking ref, terminal…"
              className="w-full bg-transparent text-xs outline-none" style={{ color: '#d4cfc8' }} />
          </InlineField>
        </div>
      )}
    </div>
  )
}

// ─── JourneyTimeline (view mode) ──────────────────────────────────────────────

function JourneyTimeline({ legs }) {
  function pad(n) { return String(n).padStart(2, '0') }

  return (
    <div className="space-y-0">
      {legs.map((leg, idx) => {
        const transport = TRANSPORT_MAP[leg.transport] || TRANSPORT_MAP.other
        const isLast = idx === legs.length - 1

        return (
          <div key={idx} className="relative">
            <div className="flex items-start gap-3">
              <div className="flex flex-col items-center flex-shrink-0" style={{ width: 28 }}>
                <div className="w-3 h-3 rounded-full flex-shrink-0 mt-0.5"
                  style={{ background: idx === 0 ? '#8aab8e' : '#d4b87a', border: '2px solid #1c1916', zIndex: 1 }} />
                <div className="flex-1 w-px mt-1" style={{ background: 'rgba(212,184,122,0.15)', minHeight: 40 }} />
              </div>
              <div className="flex-1 pb-3 min-w-0">
                <p className="text-sm font-medium" style={{ color: '#d4cfc8' }}>{leg.from || '—'}</p>
                {leg.depart_at && <p className="text-xs" style={{ color: '#5a5248' }}>{formatDT(leg.depart_at)}</p>}
                <div className="flex items-center gap-2 my-2">
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
                </div>
                {leg.notes && <p className="text-xs mb-1" style={{ color: '#5a5248' }}>{leg.notes}</p>}
              </div>
            </div>

            {(isLast || legs[idx + 1]?.from !== leg.to) && (
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center flex-shrink-0" style={{ width: 28 }}>
                  <div className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ background: isLast ? '#c47c5a' : '#d4b87a', border: '2px solid #1c1916' }} />
                  {!isLast && <div className="w-px" style={{ height: 8, background: 'rgba(212,184,122,0.15)' }} />}
                </div>
                <div className="flex-1 pb-3 min-w-0">
                  <p className="text-sm font-medium" style={{ color: '#d4cfc8' }}>{leg.to || '—'}</p>
                  {leg.arrive_at && <p className="text-xs" style={{ color: '#5a5248' }}>{formatDT(leg.arrive_at)}</p>}
                </div>
              </div>
            )}
          </div>
        )
      })}
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

function InfoRow({ icon, label, children }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-base flex-shrink-0 mt-0.5">{icon}</span>
      <div>
        <p className="text-xs uppercase tracking-wider" style={{ color: '#5a5248' }}>{label}</p>
        <p className="text-xs mt-0.5" style={{ color: '#b5aea4' }}>{children}</p>
      </div>
    </div>
  )
}