import { useState, useEffect } from 'react'
import {
  collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, arrayUnion, arrayRemove,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { format } from 'date-fns'
import {
  Plus, ThumbsUp, MessageCircle, Trash2, X, Check, Send, ExternalLink,
  Pencil, CalendarPlus,
} from 'lucide-react'

// Lightweight, low-friction idea board. Polls are for formal decisions; this is
// the scratchpad where anyone can toss out an idea, others upvote the ones they
// like, and a short comment thread hangs off each. Sorted by votes so the ideas
// the group is excited about float to the top. Once the group lands on an idea,
// "Add to trip" drops it straight into the itinerary as a scheduled event.

// Mirrors ItineraryTab's EVENT_TYPES, so an idea's category is the same value as
// the itinerary event type it becomes when added to the trip.
const CATEGORIES = [
  { id: 'activity',      label: 'Activity',     emoji: '🎯' },
  { id: 'food',          label: 'Food & Drink', emoji: '🍽️' },
  { id: 'transport',     label: 'Transport',    emoji: '🚌' },
  { id: 'accommodation', label: 'Stay',         emoji: '🏨' },
  { id: 'note',          label: 'Note',         emoji: '📝' },
]
const catOf = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[0]
const isCategory = id => CATEGORIES.some(c => c.id === id)

const BLANK = { title: '', note: '', links: [''], category: 'activity', date: '', time: '' }

// Ideas used to carry a single `url`; they now hold a `links` array. Read both so
// pre-existing ideas keep showing their link.
function ideaLinks(idea) {
  if (Array.isArray(idea.links)) return idea.links.filter(Boolean)
  if (idea.url) return [idea.url]
  return []
}

// Short label for a link chip — the bare hostname, or "Link" if it won't parse.
function linkLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'Link' }
}

export default function BrainstormTab({ tripId, trip = {}, days = [], members = [], currentUser, readOnly = false }) {
  const [ideas, setIdeas]         = useState([])
  const [comments, setComments]   = useState({})   // ideaId -> [comment]
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState(BLANK)
  const [saving, setSaving]       = useState(false)
  const [openThread, setOpenThread] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm]   = useState(BLANK)
  const [schedulingId, setSchedulingId] = useState(null)  // idea being added to the trip
  const [addedId, setAddedId]     = useState(null)         // idea just added — for a brief confirmation

  const nameOf = id =>
    members.find(m => m.id === id)?.full_name?.split(' ')[0] || 'Someone'

  useEffect(() => { load() }, [tripId])

  async function load() {
    const [ideaSnap, commentSnap] = await Promise.all([
      getDocs(query(collection(db, 'brainstorm_ideas'),    where('trip_id', '==', tripId))),
      getDocs(query(collection(db, 'brainstorm_comments'), where('trip_id', '==', tripId))),
    ])
    const list = ideaSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    list.sort((a, b) =>
      (b.liked_by?.length || 0) - (a.liked_by?.length || 0) ||
      (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0)
    )
    const byIdea = {}
    commentSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.created_at?.seconds || 0) - (b.created_at?.seconds || 0))
      .forEach(c => { (byIdea[c.idea_id] ||= []).push(c) })
    setIdeas(list)
    setComments(byIdea)
  }

  async function addIdea() {
    if (!form.title.trim()) return
    setSaving(true)
    await addDoc(collection(db, 'brainstorm_ideas'), {
      trip_id: tripId,
      title: form.title.trim(),
      note: form.note.trim(),
      links: form.links.map(l => l.trim()).filter(Boolean),
      url: '',   // superseded by links[]; cleared so legacy readers don't double up
      category: form.category,
      date: form.date || '',
      time: form.time || '',
      created_by: currentUser.id,
      liked_by: [currentUser.id],   // proposing an idea counts as a vote for it
      created_at: serverTimestamp(),
    })
    setForm(BLANK); setShowForm(false); setSaving(false); load()
  }

  function startEdit(idea) {
    const links = ideaLinks(idea)
    setEditForm({
      title: idea.title || '',
      note: idea.note || '',
      links: links.length ? links : [''],
      category: isCategory(idea.category) ? idea.category : 'activity',
      date: idea.date || '',
      time: idea.time || '',
    })
    setEditingId(idea.id)
    setShowForm(false)
    setOpenThread(null)
    setSchedulingId(null)
  }

  async function saveEdit() {
    if (!editForm.title.trim()) return
    setSaving(true)
    await updateDoc(doc(db, 'brainstorm_ideas', editingId), {
      title: editForm.title.trim(),
      note: editForm.note.trim(),
      links: editForm.links.map(l => l.trim()).filter(Boolean),
      url: '',   // superseded by links[]
      category: editForm.category,
      date: editForm.date || '',
      time: editForm.time || '',
      updated_at: serverTimestamp(),
    })
    setEditingId(null); setSaving(false); load()
  }

  async function toggleLike(idea) {
    const mine = idea.liked_by?.includes(currentUser.id)
    // optimistic
    setIdeas(prev => prev.map(i => i.id !== idea.id ? i : {
      ...i,
      liked_by: mine
        ? i.liked_by.filter(x => x !== currentUser.id)
        : [...(i.liked_by || []), currentUser.id],
    }))
    await updateDoc(doc(db, 'brainstorm_ideas', idea.id), {
      liked_by: mine ? arrayRemove(currentUser.id) : arrayUnion(currentUser.id),
    })
  }

  async function deleteIdea(id) {
    await deleteDoc(doc(db, 'brainstorm_ideas', id))
    await Promise.all(
      (comments[id] || []).map(c => deleteDoc(doc(db, 'brainstorm_comments', c.id)))
    )
    load()
  }

  // Drop an idea into the itinerary as a scheduled event on the chosen day.
  async function addToTrip(idea, date, time) {
    const notesParts = [idea.note, ...ideaLinks(idea)].filter(Boolean)
    await addDoc(collection(db, 'itinerary_events'), {
      trip_id: tripId,
      date,
      title: idea.title,
      time: time || null,
      end_time: null,
      location: null,
      notes: notesParts.length ? notesParts.join('\n') : null,
      type: isCategory(idea.category) ? idea.category : 'activity',
      assigned_to: [],
      timezone: trip.timezone || null,
      created_by: currentUser.id,
      created_at: serverTimestamp(),
    })
    setSchedulingId(null)
    setAddedId(idea.id)
    setTimeout(() => setAddedId(prev => (prev === idea.id ? null : prev)), 2500)
  }

  async function addComment(ideaId, text) {
    if (!text.trim()) return
    await addDoc(collection(db, 'brainstorm_comments'), {
      trip_id: tripId, idea_id: ideaId, text: text.trim(),
      created_by: currentUser.id, created_at: serverTimestamp(),
    })
    load()
  }

  async function deleteComment(id) {
    await deleteDoc(doc(db, 'brainstorm_comments', id)); load()
  }

  return (
    <div className="px-6 pt-4 space-y-4">
      {!readOnly && (
        <button onClick={() => { setShowForm(!showForm); setEditingId(null) }}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm"
          style={{ background: 'rgba(212,184,122,0.08)', border: '1px dashed rgba(212,184,122,0.25)', color: '#d4b87a' }}>
          <Plus size={14} />Float an Idea
        </button>
      )}

      {showForm && !readOnly && (
        <IdeaForm
          form={form} setForm={setForm} saving={saving} trip={trip} mode="add"
          onSave={addIdea}
          onCancel={() => { setShowForm(false); setForm(BLANK) }}
        />
      )}

      {ideas.length === 0 && !showForm && (
        <div className="text-center py-16 fade-in">
          <div className="text-5xl mb-4">💭</div>
          <p className="font-display text-xl font-light" style={{ color: '#e8d5a3' }}>No ideas yet</p>
          <p className="text-sm mt-2" style={{ color: '#5a5248' }}>
            Toss out places, activities, or anything you're dreaming up — the group upvotes the best.
          </p>
        </div>
      )}

      <div className="grid gap-3">
        {ideas.map(idea => {
          if (editingId === idea.id && !readOnly) {
            return (
              <IdeaForm
                key={idea.id}
                form={editForm} setForm={setEditForm} saving={saving} trip={trip} mode="edit"
                onSave={saveEdit}
                onCancel={() => setEditingId(null)}
              />
            )
          }

          const cat      = catOf(idea.category)
          const liked    = idea.liked_by?.includes(currentUser.id)
          const likes    = idea.liked_by?.length || 0
          const thread   = comments[idea.id] || []
          const canEdit  = idea.created_by === currentUser.id && !readOnly
          const open     = openThread === idea.id
          const scheduling = schedulingId === idea.id
          const justAdded  = addedId === idea.id

          return (
            <div key={idea.id} className="glass rounded-2xl p-5 fade-in">
              <div className="flex items-start gap-4">
                {/* Vote pill */}
                <button onClick={() => toggleLike(idea)} disabled={readOnly}
                  className="flex flex-col items-center justify-center rounded-xl px-3 py-2 flex-shrink-0 transition-all active:scale-95"
                  style={{
                    minWidth: 48,
                    background: liked ? 'rgba(212,184,122,0.15)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${liked ? 'rgba(212,184,122,0.35)' : 'rgba(255,255,255,0.06)'}`,
                    color: liked ? '#d4b87a' : '#5a5248',
                  }}
                  title={liked ? 'Remove your vote' : 'Upvote this idea'}>
                  <ThumbsUp size={14} />
                  <span className="text-xs font-semibold mt-1">{likes}</span>
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        <span className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(255,255,255,0.05)', color: '#8a7f70' }}>
                          {cat.emoji} {cat.label}
                        </span>
                        {idea.date && (
                          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                            style={{ background: 'rgba(122,154,181,0.12)', color: '#7a9ab5' }}>
                            <CalendarPlus size={10} />{formatWhen(idea.date, idea.time)}
                          </span>
                        )}
                      </div>
                      <p className="font-medium text-sm" style={{ color: '#d4cfc8' }}>{idea.title}</p>
                      {idea.note && (
                        <p className="text-xs mt-1.5 whitespace-pre-wrap" style={{ color: '#5a5248' }}>{idea.note}</p>
                      )}
                      {ideaLinks(idea).length > 0 && (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                          {ideaLinks(idea).map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs max-w-full" style={{ color: '#7a9ab5' }}>
                              <ExternalLink size={11} className="flex-shrink-0" />
                              <span className="truncate">{linkLabel(url)}</span>
                            </a>
                          ))}
                        </div>
                      )}
                      <p className="text-xs mt-2" style={{ color: '#3d3830' }}>
                        Suggested by {nameOf(idea.created_by)}
                      </p>
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => startEdit(idea)} style={{ color: '#7a9ab5' }} title="Edit">
                          <Pencil size={12} />
                        </button>
                        <button onClick={() => deleteIdea(idea.id)} style={{ color: '#c47c5a' }} title="Delete">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-4 mt-3">
                    <button onClick={() => setOpenThread(open ? null : idea.id)}
                      className="flex items-center gap-1.5 text-xs" style={{ color: '#5a5248' }}>
                      <MessageCircle size={12} />
                      {thread.length ? `${thread.length} comment${thread.length !== 1 ? 's' : ''}` : 'Comment'}
                    </button>
                    {!readOnly && (
                      <button
                        onClick={() => { setSchedulingId(scheduling ? null : idea.id); setOpenThread(null) }}
                        className="flex items-center gap-1.5 text-xs"
                        style={{ color: justAdded ? '#8aab8e' : scheduling ? '#d4b87a' : '#5a5248' }}
                        title="Add this idea to the itinerary">
                        {justAdded ? <><Check size={12} />Added to trip</> : <><CalendarPlus size={12} />Add to trip</>}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {scheduling && !readOnly && (
                <AddToTripRow
                  idea={idea} trip={trip} days={days}
                  onAdd={(date, time) => addToTrip(idea, date, time)}
                  onCancel={() => setSchedulingId(null)}
                />
              )}

              {open && (
                <Thread
                  thread={thread} nameOf={nameOf} currentUserId={currentUser.id} readOnly={readOnly}
                  onAdd={text => addComment(idea.id, text)}
                  onDelete={deleteComment}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Compact "Jun 14 · 4:00 PM" label for an idea's proposed slot.
function formatWhen(date, time) {
  if (!date) return ''
  let label = date
  try { label = format(new Date(date + 'T12:00:00'), 'MMM d') } catch { /* keep raw */ }
  if (!time) return label
  const [h, m] = time.split(':').map(Number)
  if (Number.isNaN(h)) return label
  const ampm = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${label} · ${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

// Inline row for scheduling an idea into the itinerary. Defaults to the idea's
// own date/time when it has them, and bounds the picker to the trip's dates.
function AddToTripRow({ idea, trip, days, onAdd, onCancel }) {
  const fallback = days[0] ? format(days[0], 'yyyy-MM-dd') : ''
  const [date, setDate] = useState(idea.date || fallback)
  const [time, setTime] = useState(idea.time || '')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!date || busy) return
    setBusy(true)
    await onAdd(date, time)
    // parent unmounts this row on success; no need to reset busy
  }

  return (
    <div className="mt-4 pt-4 space-y-3 slide-up" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <p className="text-xs" style={{ color: '#8a7f70' }}>Add to the itinerary — pick a day and time.</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs tracking-widest uppercase mb-1.5" style={{ color: '#5a5248' }}>Day *</p>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            min={trip.start_date || undefined} max={trip.end_date || undefined}
            className="w-full bg-transparent text-xs outline-none"
            style={{ color: '#d4cfc8', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px', colorScheme: 'dark' }} />
        </div>
        <div>
          <p className="text-xs tracking-widest uppercase mb-1.5" style={{ color: '#5a5248' }}>Time</p>
          <input type="time" value={time} onChange={e => setTime(e.target.value)}
            className="w-full bg-transparent text-xs outline-none"
            style={{ color: '#d4cfc8', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px', colorScheme: 'dark' }} />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy || !date}
          className="flex-1 py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5"
          style={{ background: !date ? '#3d3830' : 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
          {busy ? 'Adding…' : <><CalendarPlus size={12} />Add to itinerary</>}
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded-xl text-xs"
          style={{ color: '#5a5248', background: 'rgba(255,255,255,0.04)' }}>Cancel</button>
      </div>
    </div>
  )
}

function Thread({ thread, nameOf, currentUserId, readOnly, onAdd, onDelete }) {
  const [text, setText] = useState('')
  const submit = () => { onAdd(text); setText('') }
  return (
    <div className="mt-4 pt-4 space-y-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      {thread.map(c => (
        <div key={c.id} className="flex items-start gap-2 group">
          <div className="flex-1 min-w-0">
            <p className="text-xs" style={{ color: '#8a7f70' }}>
              <span style={{ color: '#d4b87a' }}>{nameOf(c.created_by)}</span> · {c.text}
            </p>
          </div>
          {c.created_by === currentUserId && !readOnly && (
            <button onClick={() => onDelete(c.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: '#c47c5a' }}>
              <X size={11} />
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <div className="flex items-center gap-2">
          <input value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }}
            placeholder="Add a comment…"
            className="flex-1 bg-transparent text-xs outline-none"
            style={{ color: '#d4cfc8', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' }} />
          <button onClick={submit} disabled={!text.trim()} style={{ color: text.trim() ? '#d4b87a' : '#3d3830' }}>
            <Send size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

function IdeaForm({ form, setForm, saving, trip = {}, mode = 'add', onSave, onCancel }) {
  const editing = mode === 'edit'
  return (
    <div className="glass rounded-2xl p-5 space-y-4 slide-up"
      style={editing ? { border: '1px solid rgba(122,154,181,0.25)' } : undefined}>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-light" style={{ color: editing ? '#7a9ab5' : '#e8d5a3' }}>
          {editing ? 'Edit idea' : 'New idea'}
        </h3>
        <button onClick={onCancel} style={{ color: '#5a5248' }}><X size={14} /></button>
      </div>

      <div>
        <p className="text-xs tracking-widest uppercase mb-2" style={{ color: '#5a5248' }}>Category</p>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map(c => (
            <button key={c.id} type="button" onClick={() => setForm({ ...form, category: c.id })}
              className="text-xs px-3 py-1.5 rounded-full transition-all"
              style={{
                background: form.category === c.id ? 'rgba(212,184,122,0.15)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${form.category === c.id ? 'rgba(212,184,122,0.3)' : 'transparent'}`,
                color: form.category === c.id ? '#d4b87a' : '#8a7f70',
              }}>
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Idea title */}
      <div>
        <p className="text-xs tracking-widest uppercase mb-2" style={{ color: '#5a5248' }}>Idea *</p>
        <input type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
          placeholder="e.g. Sunrise hike up Mt. Batur" className="w-full bg-transparent text-sm outline-none"
          style={{ color: '#d4cfc8', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }} />
      </div>

      {/* Optional date + time */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs tracking-widest uppercase mb-2" style={{ color: '#5a5248' }}>Date</p>
          <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
            min={trip.start_date || undefined} max={trip.end_date || undefined}
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: '#d4cfc8', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px', colorScheme: 'dark' }} />
        </div>
        <div>
          <p className="text-xs tracking-widest uppercase mb-2" style={{ color: '#5a5248' }}>Time</p>
          <input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })}
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: '#d4cfc8', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px', colorScheme: 'dark' }} />
        </div>
      </div>

      {/* Multiline note */}
      <div>
        <p className="text-xs tracking-widest uppercase mb-2" style={{ color: '#5a5248' }}>Note</p>
        <textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })}
          placeholder="Why it could be great (optional)" rows={3}
          className="w-full bg-transparent text-sm outline-none resize-y"
          style={{ color: '#d4cfc8', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }} />
      </div>

      {/* Links (one or more) */}
      <div>
        <p className="text-xs tracking-widest uppercase mb-2" style={{ color: '#5a5248' }}>Links</p>
        <div className="space-y-2">
          {form.links.map((link, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="url" value={link}
                onChange={e => setForm({ ...form, links: form.links.map((l, idx) => idx === i ? e.target.value : l) })}
                placeholder="https://… (optional)" className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: '#d4cfc8', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }} />
              {form.links.length > 1 && (
                <button type="button" title="Remove link"
                  onClick={() => setForm({ ...form, links: form.links.filter((_, idx) => idx !== i) })}
                  style={{ color: '#c47c5a' }}>
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button"
          onClick={() => setForm({ ...form, links: [...form.links, ''] })}
          className="flex items-center gap-1.5 text-xs mt-2" style={{ color: '#7a9ab5' }}>
          <Plus size={11} />Add another link
        </button>
      </div>

      <div className="flex gap-2">
        <button onClick={onSave} disabled={saving || !form.title.trim()}
          className="flex-1 py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5"
          style={{ background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
          {saving ? 'Saving…' : editing ? <><Check size={12} />Save Changes</> : <><Check size={12} />Add Idea</>}
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded-xl text-xs"
          style={{ color: '#5a5248', background: 'rgba(255,255,255,0.04)' }}>Cancel</button>
      </div>
    </div>
  )
}
