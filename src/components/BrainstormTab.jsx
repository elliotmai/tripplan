import { useState, useEffect } from 'react'
import {
  collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, arrayUnion, arrayRemove,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { Plus, ThumbsUp, MessageCircle, Trash2, X, Check, Send, ExternalLink } from 'lucide-react'

// Lightweight, low-friction idea board. Polls are for formal decisions; this is
// the scratchpad where anyone can toss out an idea, others upvote the ones they
// like, and a short comment thread hangs off each. Sorted by votes so the ideas
// the group is excited about float to the top.

const CATEGORIES = [
  { id: 'activity',  label: 'Activity',  emoji: '🎒' },
  { id: 'food',      label: 'Food',      emoji: '🍜' },
  { id: 'stay',      label: 'Stay',      emoji: '🏨' },
  { id: 'transport', label: 'Transport', emoji: '🚆' },
  { id: 'other',     label: 'Idea',      emoji: '💡' },
]
const catOf = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1]

const BLANK = { title: '', note: '', url: '', category: 'other' }

export default function BrainstormTab({ tripId, members = [], currentUser }) {
  const [ideas, setIdeas]         = useState([])
  const [comments, setComments]   = useState({})   // ideaId -> [comment]
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState(BLANK)
  const [saving, setSaving]       = useState(false)
  const [openThread, setOpenThread] = useState(null)

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
      url: form.url.trim(),
      category: form.category,
      created_by: currentUser.id,
      liked_by: [currentUser.id],   // proposing an idea counts as a vote for it
      created_at: serverTimestamp(),
    })
    setForm(BLANK); setShowForm(false); setSaving(false); load()
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
      <button onClick={() => setShowForm(!showForm)}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm"
        style={{ background: 'rgba(212,184,122,0.08)', border: '1px dashed rgba(212,184,122,0.25)', color: '#d4b87a' }}>
        <Plus size={14} />Float an Idea
      </button>

      {showForm && (
        <IdeaForm
          form={form} setForm={setForm} saving={saving}
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
          const cat      = catOf(idea.category)
          const liked    = idea.liked_by?.includes(currentUser.id)
          const likes    = idea.liked_by?.length || 0
          const thread   = comments[idea.id] || []
          const canDelete = idea.created_by === currentUser.id
          const open     = openThread === idea.id

          return (
            <div key={idea.id} className="glass rounded-2xl p-5 fade-in">
              <div className="flex items-start gap-4">
                {/* Vote pill */}
                <button onClick={() => toggleLike(idea)}
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
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(255,255,255,0.05)', color: '#8a7f70' }}>
                          {cat.emoji} {cat.label}
                        </span>
                      </div>
                      <p className="font-medium text-sm" style={{ color: '#d4cfc8' }}>{idea.title}</p>
                      {idea.note && <p className="text-xs mt-1.5" style={{ color: '#5a5248' }}>{idea.note}</p>}
                      {idea.url && (
                        <a href={idea.url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs mt-2" style={{ color: '#7a9ab5' }}>
                          <ExternalLink size={11} />Link
                        </a>
                      )}
                      <p className="text-xs mt-2" style={{ color: '#3d3830' }}>
                        Suggested by {nameOf(idea.created_by)}
                      </p>
                    </div>
                    {canDelete && (
                      <button onClick={() => deleteIdea(idea.id)} style={{ color: '#c47c5a' }} title="Delete">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>

                  <button onClick={() => setOpenThread(open ? null : idea.id)}
                    className="flex items-center gap-1.5 mt-3 text-xs" style={{ color: '#5a5248' }}>
                    <MessageCircle size={12} />
                    {thread.length ? `${thread.length} comment${thread.length !== 1 ? 's' : ''}` : 'Comment'}
                  </button>
                </div>
              </div>

              {open && (
                <Thread
                  thread={thread} nameOf={nameOf} currentUserId={currentUser.id}
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

function Thread({ thread, nameOf, currentUserId, onAdd, onDelete }) {
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
          {c.created_by === currentUserId && (
            <button onClick={() => onDelete(c.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: '#c47c5a' }}>
              <X size={11} />
            </button>
          )}
        </div>
      ))}
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
    </div>
  )
}

function IdeaForm({ form, setForm, saving, onSave, onCancel }) {
  return (
    <div className="glass rounded-2xl p-5 space-y-4 slide-up">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-light" style={{ color: '#e8d5a3' }}>New idea</h3>
        <button onClick={onCancel} style={{ color: '#5a5248' }}><X size={14} /></button>
      </div>

      <div>
        <p className="text-xs tracking-widest uppercase mb-2" style={{ color: '#5a5248' }}>Category</p>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map(c => (
            <button key={c.id} onClick={() => setForm({ ...form, category: c.id })}
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

      {[
        ['Idea *', 'title', 'e.g. Sunrise hike up Mt. Batur', 'text'],
        ['Note', 'note', 'Why it could be great (optional)', 'text'],
        ['Link', 'url', 'https://… (optional)', 'url'],
      ].map(([label, key, ph, type]) => (
        <div key={key}>
          <p className="text-xs tracking-widest uppercase mb-2" style={{ color: '#5a5248' }}>{label}</p>
          <input type={type} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })}
            placeholder={ph} className="w-full bg-transparent text-sm outline-none"
            style={{ color: '#d4cfc8', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }} />
        </div>
      ))}

      <div className="flex gap-2">
        <button onClick={onSave} disabled={saving || !form.title.trim()}
          className="flex-1 py-2 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5"
          style={{ background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
          {saving ? 'Saving…' : <><Check size={12} />Add Idea</>}
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded-xl text-xs"
          style={{ color: '#5a5248', background: 'rgba(255,255,255,0.04)' }}>Cancel</button>
      </div>
    </div>
  )
}
