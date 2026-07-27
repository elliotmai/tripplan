import { useState, useEffect } from 'react'
import {
  collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, arrayUnion, arrayRemove,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { logActivity, fieldDiff, fieldSummaryLines } from '../lib/activity'
import { format } from 'date-fns'
import {
  Plus, ThumbsUp, MessageCircle, Trash2, X, Check, Send, ExternalLink,
  Pencil, CalendarPlus, ChevronDown, ChevronUp,
} from 'lucide-react'

// Ideas + Polls, unified. The idea board is the low-friction scratchpad where
// anyone floats a place/activity and the group upvotes the best. When it's time
// to actually decide, you bundle a few ideas into a poll ("A, B or C on
// Saturday?") and everyone votes. Both live on one tab because they're two steps
// of the same flow: dream it up, then decide.

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

// Fields tracked in the change log for an idea.
const IDEA_FIELDS = [
  { key: 'title',    label: 'Title' },
  { key: 'note',     label: 'Note' },
  { key: 'category', label: 'Category', format: v => catOf(v).label },
  { key: 'date',     label: 'Date' },
  { key: 'time',     label: 'Time' },
  { key: 'links',    label: 'Links', format: v => (Array.isArray(v) ? v.filter(Boolean).join(', ') : (v || '')) },
]

function ideaLinks(idea) {
  if (Array.isArray(idea.links)) return idea.links.filter(Boolean)
  if (idea.url) return [idea.url]
  return []
}

function linkLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'Link' }
}

export default function IdeasTab({
  tripId, trip = {}, days = [], members = [], currentUser,
  readOnly = false, onPollsChanged,
}) {
  // Ideas
  const [ideas, setIdeas]         = useState([])
  const [comments, setComments]   = useState({})   // ideaId -> [comment]
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState(BLANK)
  const [saving, setSaving]       = useState(false)
  const [openThread, setOpenThread] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm]   = useState(BLANK)
  const [schedulingId, setSchedulingId] = useState(null)
  const [addedId, setAddedId]     = useState(null)

  // Polls
  const [polls, setPolls]         = useState([])
  const [votes, setVotes]         = useState([])
  const [expandedPoll, setExpandedPoll] = useState(null)
  const [showPollForm, setShowPollForm] = useState(false)

  const nameOf = id =>
    members.find(m => m.id === id)?.full_name?.split(' ')[0] || 'Someone'

  useEffect(() => { load(); loadPolls() }, [tripId])

  // ── Ideas data ────────────────────────────────────────────────────────────
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
    const payload = {
      trip_id: tripId,
      title: form.title.trim(),
      note: form.note.trim(),
      links: form.links.map(l => l.trim()).filter(Boolean),
      url: '',
      category: form.category,
      date: form.date || '',
      time: form.time || '',
      created_by: currentUser.id,
      liked_by: [currentUser.id],
      created_at: serverTimestamp(),
    }
    const ref = await addDoc(collection(db, 'brainstorm_ideas'), payload)
    await logActivity(tripId, currentUser, {
      action: 'create', entity: 'idea',
      summary: `Floated the idea “${payload.title}”`,
      details: fieldSummaryLines(payload, IDEA_FIELDS),
      undo: { ops: [{ op: 'delete', collection: 'brainstorm_ideas', docId: ref.id }] },
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
    const before = ideas.find(i => i.id === editingId)
    setSaving(true)
    const after = {
      title: editForm.title.trim(),
      note: editForm.note.trim(),
      links: editForm.links.map(l => l.trim()).filter(Boolean),
      category: editForm.category,
      date: editForm.date || '',
      time: editForm.time || '',
    }
    await updateDoc(doc(db, 'brainstorm_ideas', editingId), {
      ...after, url: '', updated_at: serverTimestamp(),
    })
    const { lines, prev } = fieldDiff(before, after, IDEA_FIELDS)
    if (lines.length) {
      await logActivity(tripId, currentUser, {
        action: 'update', entity: 'idea',
        summary: `Edited the idea “${after.title}”`,
        details: lines,
        undo: { ops: [{ op: 'update', collection: 'brainstorm_ideas', docId: editingId, data: prev }] },
      })
    }
    setEditingId(null); setSaving(false); load()
  }

  async function toggleLike(idea) {
    const mine = idea.liked_by?.includes(currentUser.id)
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
    const before = ideas.find(i => i.id === id)
    const thread = comments[id] || []
    await deleteDoc(doc(db, 'brainstorm_ideas', id))
    await Promise.all(thread.map(c => deleteDoc(doc(db, 'brainstorm_comments', c.id))))
    // Undo restores the idea and every comment that hung off it.
    const ops = []
    if (before) {
      const { id: _i, ...ideaData } = before
      ops.push({ op: 'set', collection: 'brainstorm_ideas', docId: id, data: ideaData })
    }
    thread.forEach(c => {
      const { id: cid, ...cData } = c
      ops.push({ op: 'set', collection: 'brainstorm_comments', docId: cid, data: cData })
    })
    await logActivity(tripId, currentUser, {
      action: 'delete', entity: 'idea',
      summary: `Deleted the idea “${before?.title || 'idea'}”`,
      details: [
        ...fieldSummaryLines(before, IDEA_FIELDS),
        ...(thread.length ? [`${thread.length} comment${thread.length !== 1 ? 's' : ''} removed`] : []),
      ],
      undo: ops.length ? { ops } : null,
    })
    load()
  }

  async function addToTrip(idea, date, time) {
    const notesParts = [idea.note, ...ideaLinks(idea)].filter(Boolean)
    const payload = {
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
    }
    const ref = await addDoc(collection(db, 'itinerary_events'), payload)
    await logActivity(tripId, currentUser, {
      action: 'create', entity: 'event',
      summary: `Added “${idea.title}” to the itinerary`,
      details: [`Day: ${date}`, ...(time ? [`Time: ${time}`] : []), 'From an idea'],
      undo: { ops: [{ op: 'delete', collection: 'itinerary_events', docId: ref.id }] },
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

  // ── Polls data ────────────────────────────────────────────────────────────
  async function loadPolls() {
    const [pollSnap, voteSnap] = await Promise.all([
      getDocs(query(collection(db, 'polls'), where('trip_id', '==', tripId))),
      getDocs(query(collection(db, 'poll_votes'), where('trip_id', '==', tripId))),
    ])
    const pollList = pollSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const withOptions = await Promise.all(pollList.map(async poll => {
      const optSnap = await getDocs(query(collection(db, 'poll_options'), where('poll_id', '==', poll.id)))
      return { ...poll, poll_options: optSnap.docs.map(d => ({ id: d.id, ...d.data() })) }
    }))
    withOptions.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0))
    setPolls(withOptions)
    setVotes(voteSnap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  // Create a poll out of chosen ideas (and/or free-text options).
  async function createPoll({ question, options, day }) {
    setSaving(true)
    const pollRef = await addDoc(collection(db, 'polls'), {
      trip_id: tripId,
      question: question.trim(),
      day: day || '',
      created_by: currentUser.id,
      created_at: serverTimestamp(),
    })
    const optRefs = await Promise.all(options.map(o =>
      addDoc(collection(db, 'poll_options'), {
        poll_id: pollRef.id,
        text: o.text,
        ...(o.idea_id ? { idea_id: o.idea_id } : {}),
      })
    ))
    await logActivity(tripId, currentUser, {
      action: 'create', entity: 'poll',
      summary: `Started the poll “${question.trim()}”`,
      details: [
        ...(day ? [`Day: ${day}`] : []),
        `Options: ${options.map(o => o.text).join(', ')}`,
      ],
      undo: {
        ops: [
          { op: 'delete', collection: 'polls', docId: pollRef.id },
          ...optRefs.map(r => ({ op: 'delete', collection: 'poll_options', docId: r.id })),
        ],
      },
    })
    setShowPollForm(false); setSaving(false)
    loadPolls(); onPollsChanged?.()
  }

  async function vote(pollId, optionId) {
    const existing = votes.filter(v => v.poll_id === pollId && v.user_id === currentUser.id)
    await Promise.all(existing.map(v => deleteDoc(doc(db, 'poll_votes', v.id))))
    await addDoc(collection(db, 'poll_votes'), {
      poll_id: pollId, option_id: optionId, user_id: currentUser.id,
      trip_id: tripId, created_at: serverTimestamp(),
    })
    loadPolls(); onPollsChanged?.()
  }

  async function deletePoll(poll) {
    const pollVotes = votes.filter(v => v.poll_id === poll.id)
    const options = poll.poll_options || []
    await Promise.all([
      ...pollVotes.map(v => deleteDoc(doc(db, 'poll_votes', v.id))),
      ...options.map(o => deleteDoc(doc(db, 'poll_options', o.id))),
    ])
    await deleteDoc(doc(db, 'polls', poll.id))
    // Undo re-creates the poll, its options and everyone's votes.
    const ops = [
      { op: 'set', collection: 'polls', docId: poll.id, data: {
        trip_id: poll.trip_id, question: poll.question, day: poll.day || '',
        created_by: poll.created_by, created_at: poll.created_at,
      } },
      ...options.map(o => ({ op: 'set', collection: 'poll_options', docId: o.id, data: {
        poll_id: o.poll_id, text: o.text, ...(o.idea_id ? { idea_id: o.idea_id } : {}),
      } })),
      ...pollVotes.map(v => ({ op: 'set', collection: 'poll_votes', docId: v.id, data: {
        poll_id: v.poll_id, option_id: v.option_id, user_id: v.user_id,
        trip_id: v.trip_id, created_at: v.created_at,
      } })),
    ]
    await logActivity(tripId, currentUser, {
      action: 'delete', entity: 'poll',
      summary: `Deleted the poll “${poll.question}”`,
      details: [
        `Options: ${options.map(o => o.text).join(', ')}`,
        ...(pollVotes.length ? [`${pollVotes.length} vote${pollVotes.length !== 1 ? 's' : ''} removed`] : []),
      ],
      undo: { ops },
    })
    loadPolls(); onPollsChanged?.()
  }

  return (
    <div className="px-6 pt-4 space-y-4">
      {/* ── Action buttons ── */}
      {!readOnly && (
        <div className="flex gap-2">
          <button onClick={() => { setShowForm(v => !v); setEditingId(null); setShowPollForm(false) }}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm"
            style={{ background: 'rgba(212,184,122,0.08)', border: '1px dashed rgba(212,184,122,0.25)', color: '#d4b87a' }}>
            <Plus size={14} />Float an Idea
          </button>
          <button onClick={() => { setShowPollForm(v => !v); setShowForm(false); setEditingId(null) }}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm"
            style={{ background: 'rgba(122,154,181,0.08)', border: '1px dashed rgba(122,154,181,0.3)', color: '#7a9ab5' }}>
            <span>🗳️</span>Create a Poll
          </button>
        </div>
      )}

      {showForm && !readOnly && (
        <IdeaForm
          form={form} setForm={setForm} saving={saving} trip={trip} mode="add"
          onSave={addIdea}
          onCancel={() => { setShowForm(false); setForm(BLANK) }}
        />
      )}

      {showPollForm && !readOnly && (
        <PollForm
          ideas={ideas} trip={trip} days={days} saving={saving}
          onSave={createPoll}
          onCancel={() => setShowPollForm(false)}
        />
      )}

      {/* ── Active polls ── */}
      {polls.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs tracking-widest uppercase pt-1" style={{ color: '#5a5248' }}>Polls · Decide</p>
          {polls.map(poll => (
            <PollCard
              key={poll.id} poll={poll} votes={votes} currentUser={currentUser}
              expanded={expandedPoll === poll.id} readOnly={readOnly}
              onToggle={() => setExpandedPoll(expandedPoll === poll.id ? null : poll.id)}
              onVote={optId => vote(poll.id, optId)}
              onDelete={() => deletePoll(poll)}
            />
          ))}
        </div>
      )}

      {/* ── Idea board ── */}
      {(ideas.length > 0 || polls.length > 0) && (
        <p className="text-xs tracking-widest uppercase pt-2" style={{ color: '#5a5248' }}>Ideas · Brainstorm</p>
      )}

      {ideas.length === 0 && !showForm && (
        <div className="text-center py-16 fade-in">
          <div className="text-5xl mb-4">💭</div>
          <p className="font-display text-xl font-light" style={{ color: '#e8d5a3' }}>No ideas yet</p>
          <p className="text-sm mt-2" style={{ color: '#5a5248' }}>
            Toss out places, activities, or anything you're dreaming up — upvote the best, then bundle them into a poll to decide.
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

// ── Poll card ──────────────────────────────────────────────────────────────────
function PollCard({ poll, votes, currentUser, expanded, readOnly, onToggle, onVote, onDelete }) {
  const pollVotes = votes.filter(v => v.poll_id === poll.id)
  const myVote    = pollVotes.find(v => v.user_id === currentUser.id)
  const total     = pollVotes.length
  const canDelete = poll.created_by === currentUser.id && !readOnly
  const dayLabel  = poll.day ? formatWhen(poll.day, '') : ''

  return (
    <div className="glass rounded-2xl overflow-hidden fade-in"
      style={{ border: '1px solid rgba(122,154,181,0.18)' }}>
      <div className="w-full px-5 py-4 flex items-start justify-between gap-3">
        <button onClick={onToggle} className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(122,154,181,0.15)', color: '#7a9ab5' }}>🗳️ Poll</span>
            {dayLabel && (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(122,154,181,0.12)', color: '#7a9ab5' }}>
                <CalendarPlus size={10} />{dayLabel}
              </span>
            )}
          </div>
          <p className="font-display text-lg font-light leading-tight mt-1.5" style={{ color: '#e8d5a3' }}>{poll.question}</p>
          <p className="text-xs mt-1" style={{ color: '#5a5248' }}>{total} vote{total !== 1 ? 's' : ''}{myVote ? ' · voted' : ' · tap to vote'}</p>
        </button>
        <div className="flex items-center gap-2 flex-shrink-0">
          {canDelete && (
            <button onClick={onDelete} style={{ color: '#c47c5a' }} title="Delete poll"><Trash2 size={13} /></button>
          )}
          <button onClick={onToggle} style={{ color: '#5a5248' }}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="px-5 pb-5 space-y-2 slide-up">
          {poll.poll_options?.map(option => {
            const optVotes  = pollVotes.filter(v => v.option_id === option.id).length
            const pct       = total ? Math.round((optVotes / total) * 100) : 0
            const isMyVote  = myVote?.option_id === option.id
            return (
              <button key={option.id} onClick={() => !readOnly && onVote(option.id)} disabled={readOnly}
                className="w-full text-left rounded-xl p-3 transition-all active:scale-98 relative overflow-hidden"
                style={{ background: isMyVote ? 'rgba(212,184,122,0.12)' : 'rgba(255,255,255,0.03)', border: isMyVote ? '1px solid rgba(212,184,122,0.3)' : '1px solid rgba(255,255,255,0.05)' }}>
                <div className="absolute inset-y-0 left-0 rounded-xl transition-all duration-500" style={{ width: `${pct}%`, background: 'rgba(212,184,122,0.06)' }} />
                <div className="relative flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isMyVote && <Check size={12} style={{ color: '#d4b87a' }} />}
                    {option.idea_id && <span title="From an idea" style={{ fontSize: 11 }}>💡</span>}
                    <span className="text-sm" style={{ color: isMyVote ? '#d4b87a' : '#d4cfc8' }}>{option.text}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-medium" style={{ color: isMyVote ? '#d4b87a' : '#5a5248' }}>{pct}%</span>
                    <span className="text-xs ml-1" style={{ color: '#5a5248' }}>({optVotes})</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Poll builder — bundle ideas (and/or free text) into a poll ──────────────────
function PollForm({ ideas, trip, days, saving, onSave, onCancel }) {
  const [question, setQuestion] = useState('')
  const [picked, setPicked]     = useState(new Set())   // idea ids chosen as options
  const [extras, setExtras]     = useState([''])        // free-text options
  const [day, setDay]           = useState('')

  const toggle = id => setPicked(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const options = [
    ...ideas.filter(i => picked.has(i.id)).map(i => ({ text: i.title, idea_id: i.id })),
    ...extras.map(t => t.trim()).filter(Boolean).map(t => ({ text: t })),
  ]
  const canCreate = question.trim() && options.length >= 2

  return (
    <div className="glass rounded-2xl p-5 space-y-4 slide-up" style={{ border: '1px solid rgba(122,154,181,0.25)' }}>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-light" style={{ color: '#7a9ab5' }}>Create a poll</h3>
        <button onClick={onCancel} style={{ color: '#5a5248' }}><X size={14} /></button>
      </div>

      <div>
        <p className="text-xs tracking-widest uppercase mb-2" style={{ color: '#5a5248' }}>Question</p>
        <input autoFocus value={question} onChange={e => setQuestion(e.target.value)}
          placeholder="What should we do on Saturday?"
          className="w-full bg-transparent text-sm outline-none"
          style={{ color: '#d4cfc8', borderBottom: '1px solid rgba(122,154,181,0.2)', paddingBottom: '8px' }} />
      </div>

      {(trip.start_date || days.length > 0) && (
        <div>
          <p className="text-xs tracking-widest uppercase mb-2" style={{ color: '#5a5248' }}>Day (optional)</p>
          <input type="date" value={day} onChange={e => setDay(e.target.value)}
            min={trip.start_date || undefined} max={trip.end_date || undefined}
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: '#d4cfc8', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px', colorScheme: 'dark' }} />
        </div>
      )}

      <div>
        <p className="text-xs tracking-widest uppercase mb-2" style={{ color: '#5a5248' }}>
          Options from ideas
        </p>
        {ideas.length === 0 ? (
          <p className="text-xs" style={{ color: '#3d3830' }}>No ideas yet — add free-text options below.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {ideas.map(idea => {
              const on = picked.has(idea.id)
              return (
                <button key={idea.id} type="button" onClick={() => toggle(idea.id)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-all"
                  style={{
                    background: on ? 'rgba(212,184,122,0.12)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${on ? 'rgba(212,184,122,0.3)' : 'rgba(255,255,255,0.05)'}`,
                  }}>
                  <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                    style={{ background: on ? 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)' : 'rgba(255,255,255,0.06)' }}>
                    {on && <Check size={10} color="#0a0908" strokeWidth={3} />}
                  </span>
                  <span className="text-xs flex-1 min-w-0 truncate" style={{ color: on ? '#d4b87a' : '#d4cfc8' }}>
                    {catOf(idea.category).emoji} {idea.title}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div>
        <p className="text-xs tracking-widest uppercase mb-2" style={{ color: '#5a5248' }}>Other options</p>
        <div className="space-y-2">
          {extras.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs" style={{ color: '#5a5248' }}>+</span>
              <input value={opt}
                onChange={e => setExtras(extras.map((o, idx) => idx === i ? e.target.value : o))}
                placeholder="Add another option"
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: '#d4cfc8', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' }} />
              {extras.length > 1 && (
                <button type="button" onClick={() => setExtras(extras.filter((_, idx) => idx !== i))}
                  style={{ color: '#c47c5a' }}><X size={13} /></button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setExtras([...extras, ''])}
          className="flex items-center gap-1.5 text-xs mt-2" style={{ color: '#7a9ab5' }}>
          <Plus size={11} />Add option
        </button>
      </div>

      <div className="flex gap-2">
        <button onClick={() => onSave({ question, options, day })} disabled={saving || !canCreate}
          className="flex-1 py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5"
          style={{ background: canCreate ? 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)' : '#3d3830', color: canCreate ? '#0a0908' : '#5a5248' }}>
          {saving ? 'Creating…' : <><Check size={12} />Create poll ({options.length})</>}
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded-xl text-xs"
          style={{ color: '#5a5248', background: 'rgba(255,255,255,0.04)' }}>Cancel</button>
      </div>
      {!canCreate && (
        <p className="text-xs" style={{ color: '#3d3830' }}>Pick a question and at least 2 options.</p>
      )}
    </div>
  )
}

function formatWhen(date, time) {
  if (!date) return ''
  let label = date
  try { label = format(new Date(date + 'T12:00:00'), 'EEE, MMM d') } catch { /* keep raw */ }
  if (!time) return label
  const [h, m] = time.split(':').map(Number)
  if (Number.isNaN(h)) return label
  const ampm = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${label} · ${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

function AddToTripRow({ idea, trip, days, onAdd, onCancel }) {
  const fallback = days[0] ? format(days[0], 'yyyy-MM-dd') : ''
  const [date, setDate] = useState(idea.date || fallback)
  const [time, setTime] = useState(idea.time || '')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!date || busy) return
    setBusy(true)
    await onAdd(date, time)
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

      <div>
        <p className="text-xs tracking-widest uppercase mb-2" style={{ color: '#5a5248' }}>Idea *</p>
        <input type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
          placeholder="e.g. Sunrise hike up Mt. Batur" className="w-full bg-transparent text-sm outline-none"
          style={{ color: '#d4cfc8', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }} />
      </div>

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

      <div>
        <p className="text-xs tracking-widest uppercase mb-2" style={{ color: '#5a5248' }}>Note</p>
        <textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })}
          placeholder="Why it could be great (optional)" rows={3}
          className="w-full bg-transparent text-sm outline-none resize-y"
          style={{ color: '#d4cfc8', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }} />
      </div>

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
