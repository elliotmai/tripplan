import { useState, useEffect } from 'react'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { undoActivity } from '../lib/activity'
import { formatDistanceToNow, format } from 'date-fns'
import {
  ChevronDown, ChevronUp, Undo2, CalendarDays, Lightbulb, Vote, Plane, History,
} from 'lucide-react'

// Read-only change log for a trip. Each entry shows a one-line summary, who made
// the change and when; expanding reveals the field-level detail. Reversible
// changes carry an Undo button.

const ENTITY_META = {
  event: { icon: CalendarDays, label: 'Itinerary' },
  idea:  { icon: Lightbulb,    label: 'Idea' },
  poll:  { icon: Vote,         label: 'Poll' },
  trip:  { icon: Plane,        label: 'Trip' },
}

const ACTION_COLOR = {
  create: '#8aab8e',
  update: '#7a9ab5',
  delete: '#c47c5a',
}

const ACTION_VERB = { create: 'added', update: 'edited', delete: 'removed' }

export default function HistoryTab({ tripId, readOnly = false, onChanged }) {
  const [entries, setEntries] = useState(null)   // null = still loading
  const [expanded, setExpanded] = useState(null)
  const [undoing, setUndoing] = useState(null)

  useEffect(() => { load() }, [tripId])

  async function load() {
    const snap = await getDocs(query(collection(db, 'trip_activity'), where('trip_id', '==', tripId)))
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    list.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0))
    setEntries(list)
  }

  async function handleUndo(entry) {
    setUndoing(entry.id)
    try {
      await undoActivity(entry)
      await load()
      onChanged?.()
    } catch (e) {
      console.warn('undo failed', e)
    }
    setUndoing(null)
  }

  if (entries === null) return (
    <div className="px-6 pt-10 text-center">
      <div className="text-3xl" style={{ animation: 'pulse 2s infinite' }}>🕰️</div>
    </div>
  )

  if (entries.length === 0) return (
    <div className="text-center py-16 fade-in px-6">
      <div className="text-5xl mb-4">🕰️</div>
      <p className="font-display text-xl font-light" style={{ color: '#e8d5a3' }}>No history yet</p>
      <p className="text-sm mt-2" style={{ color: '#5a5248' }}>
        Changes to the itinerary, ideas, polls and trip details will show up here.
      </p>
    </div>
  )

  return (
    <div className="px-6 pt-4 space-y-2">
      {entries.map(entry => {
        const meta = ENTITY_META[entry.entity] || { icon: History, label: entry.entity }
        const Icon = meta.icon
        const color = ACTION_COLOR[entry.action] || '#5a5248'
        const isOpen = expanded === entry.id
        const when = entry.created_at?.toDate?.()
        const canUndo = !readOnly && entry.undo?.ops?.length && !entry.undone

        return (
          <div key={entry.id} className="glass rounded-2xl overflow-hidden fade-in">
            <div className="w-full px-4 py-3 flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: `${color}18`, border: `1px solid ${color}30` }}>
                <Icon size={14} style={{ color }} />
              </div>

              <button onClick={() => setExpanded(isOpen ? null : entry.id)}
                className="flex-1 min-w-0 text-left">
                <p className="text-sm" style={{ color: entry.undone ? '#5a5248' : '#d4cfc8', textDecoration: entry.undone ? 'line-through' : 'none' }}>
                  {entry.summary}
                </p>
                <p className="text-xs mt-0.5" style={{ color: '#5a5248' }}>
                  {entry.actor_name} · {when ? formatDistanceToNow(when, { addSuffix: true }) : 'just now'}
                  {entry.undone && ' · undone'}
                  {entry.details?.length > 0 && (isOpen
                    ? <ChevronUp size={11} className="inline ml-1 align-middle" />
                    : <ChevronDown size={11} className="inline ml-1 align-middle" />)}
                </p>
              </button>

              {canUndo && (
                <button onClick={() => handleUndo(entry)} disabled={undoing === entry.id}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs flex-shrink-0 transition-all active:scale-95"
                  style={{ background: 'rgba(122,154,181,0.1)', border: '1px solid rgba(122,154,181,0.25)', color: '#7a9ab5' }}
                  title="Undo this change">
                  <Undo2 size={11} />{undoing === entry.id ? '…' : 'Undo'}
                </button>
              )}
            </div>

            {isOpen && entry.details?.length > 0 && (
              <div className="px-4 pb-3 pt-0 ml-11 space-y-1 slide-up">
                {entry.details.map((line, i) => (
                  <p key={i} className="text-xs" style={{ color: '#8a7f70' }}>· {line}</p>
                ))}
                {when && (
                  <p className="text-xs pt-1" style={{ color: '#3d3830' }}>
                    {format(when, "EEE, MMM d 'at' h:mm a")}
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
