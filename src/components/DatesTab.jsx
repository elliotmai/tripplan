import { useEffect, useMemo, useState, useRef } from 'react'
import {
  collection, query, where, getDocs, addDoc, deleteDoc, updateDoc,
  doc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import {
  format, parseISO, addDays, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isWithinInterval,
} from 'date-fns'
import { Sparkles, Check, X, Trash2, Lock } from 'lucide-react'

// ─── helpers ──────────────────────────────────────────────────────────────────

const ISO = d => format(d, 'yyyy-MM-dd')
const todayISO = () => ISO(new Date())

// Find the longest contiguous run of dates with the highest average availability.
// Returns { start, end, length, avg } or null.
function suggestedRange(counts, dates, totalMembers) {
  if (!dates.length || !totalMembers) return null
  const max = Math.max(...dates.map(d => counts[d] || 0))
  if (max === 0) return null
  let best = null
  let runStart = null
  let runSum = 0
  let runLen = 0
  function close(endIdx) {
    if (runLen > 0) {
      const candidate = {
        start: dates[runStart],
        end: dates[endIdx],
        length: runLen,
        avg: runSum / runLen,
      }
      // Prefer longer runs at max availability; tie-break on average.
      if (!best
        || candidate.length > best.length
        || (candidate.length === best.length && candidate.avg > best.avg)) {
        best = candidate
      }
    }
    runStart = null; runSum = 0; runLen = 0
  }
  dates.forEach((d, i) => {
    if ((counts[d] || 0) === max) {
      if (runStart === null) runStart = i
      runSum += counts[d] || 0
      runLen += 1
    } else {
      close(i - 1)
    }
  })
  close(dates.length - 1)
  return best
}

// ─── main ─────────────────────────────────────────────────────────────────────

export default function DatesTab({ tripId, trip, members, currentUser, onTripUpdated, readOnly = false }) {
  const [poll, setPoll] = useState(null)
  const [availability, setAvailability] = useState([])  // [{ id, user_id, dates }]
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [lockRange, setLockRange] = useState(null)  // { start, end }
  const [lockMsg, setLockMsg] = useState('')

  const isOwner = members.find(m => m.id === currentUser?.id)?.role === 'owner'

  // Refs for race-free availability writes: myDocId pins the current user's doc
  // so we never create a duplicate; writeLock serialises writes so rapid taps
  // apply in order; availRef mirrors state so back-to-back taps compute from
  // fresh data without waiting for a re-render.
  const myDocIdRef = useRef(null)
  const writeLock = useRef(Promise.resolve())
  const availRef = useRef([])

  useEffect(() => { load() }, [tripId])

  async function load() {
    setLoading(true)
    const pollSnap = await getDocs(
      query(collection(db, 'date_polls'), where('trip_id', '==', tripId))
    )
    if (pollSnap.empty) {
      setPoll(null); setAvailability([]); setLoading(false); return
    }
    // Latest poll wins (one trip can only have one active in this UI).
    const polls = pollSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0))
    const latest = polls[0]
    setPoll(latest)

    const availSnap = await getDocs(
      query(collection(db, 'date_availability'), where('poll_id', '==', latest.id))
    )
    const rows = availSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const mineDoc = rows.find(a => a.user_id === currentUser?.id)
    myDocIdRef.current = mineDoc ? mineDoc.id : null
    availRef.current = rows
    setAvailability(rows)
    setLoading(false)
  }

  // ── derived ────────────────────────────────────────────────────────────────

  const myDoc = availability.find(a => a.user_id === currentUser?.id)
  const myDates = useMemo(() => new Set(myDoc?.dates || []), [myDoc])

  // Only count responses from people currently on the trip — a removed member's
  // stale availability shouldn't skew the heatmap, totals, or the suggestion.
  const memberIds = useMemo(() => new Set(members.map(m => m.id)), [members])
  const memberAvailability = useMemo(
    () => availability.filter(a => memberIds.has(a.user_id)),
    [availability, memberIds],
  )
  const respondedCount = memberAvailability.length

  const dateCounts = useMemo(() => {
    const counts = {}
    memberAvailability.forEach(a => (a.dates || []).forEach(d => {
      counts[d] = (counts[d] || 0) + 1
    }))
    return counts
  }, [memberAvailability])

  const allDates = useMemo(() => {
    if (!poll?.range_start || !poll?.range_end) return []
    return eachDayOfInterval({
      start: parseISO(poll.range_start),
      end: parseISO(poll.range_end),
    }).map(ISO)
  }, [poll?.range_start, poll?.range_end])

  const suggestion = useMemo(
    () => suggestedRange(dateCounts, allDates, members.length),
    [dateCounts, allDates, members.length],
  )

  // ── actions ────────────────────────────────────────────────────────────────

  async function createPoll(rangeStart, rangeEnd) {
    setSaving(true)
    await addDoc(collection(db, 'date_polls'), {
      trip_id: tripId,
      range_start: rangeStart,
      range_end: rangeEnd,
      created_by: currentUser.id,
      created_at: serverTimestamp(),
    })
    setShowCreate(false)
    await load()
    setSaving(false)
  }

  async function deletePoll() {
    if (!poll || !confirm('Delete this date poll? All availability will be lost.')) return
    setSaving(true)
    // Delete all availability docs for this poll, then the poll itself.
    await Promise.all(availability.map(a => deleteDoc(doc(db, 'date_availability', a.id))))
    await deleteDoc(doc(db, 'date_polls', poll.id))
    myDocIdRef.current = null
    availRef.current = []
    setPoll(null); setAvailability([])
    setSaving(false)
  }

  // Persist the current user's dates. Serialised via writeLock so concurrent
  // taps can't race into two addDocs (which used to create duplicate docs).
  async function persistDates(dates) {
    if (!poll || !currentUser?.id) return
    if (myDocIdRef.current) {
      await updateDoc(doc(db, 'date_availability', myDocIdRef.current), {
        dates, updated_at: serverTimestamp(),
      })
    } else {
      const ref = await addDoc(collection(db, 'date_availability'), {
        poll_id: poll.id, trip_id: tripId, user_id: currentUser.id,
        dates, created_at: serverTimestamp(), updated_at: serverTimestamp(),
      })
      myDocIdRef.current = ref.id
      // Swap the local placeholder id for the real one, in state and the ref.
      const patch = a => (a.user_id === currentUser.id ? { ...a, id: ref.id } : a)
      availRef.current = availRef.current.map(patch)
      setAvailability(prev => prev.map(patch))
    }
  }

  function toggleDate(iso) {
    if (readOnly || !poll || !currentUser?.id) return
    const mine = availRef.current.find(a => a.user_id === currentUser.id)
    const next = new Set(mine?.dates || [])
    if (next.has(iso)) next.delete(iso); else next.add(iso)
    const dates = [...next].sort()

    const others = availRef.current.filter(a => a.user_id !== currentUser.id)
    const nextMine = {
      id: mine?.id || myDocIdRef.current || `local_${currentUser.id}`,
      user_id: currentUser.id, dates, poll_id: poll.id, trip_id: tripId,
    }
    const nextAvail = [...others, nextMine]
    availRef.current = nextAvail          // keep ref fresh for rapid taps
    setAvailability(nextAvail)            // optimistic UI

    writeLock.current = writeLock.current.then(() => persistDates(dates)).catch(() => { })
  }

  async function clearMine() {
    await writeLock.current.catch(() => { })   // let any pending create finish
    if (!myDocIdRef.current) return
    if (!confirm('Clear your availability?')) return
    const id = myDocIdRef.current
    myDocIdRef.current = null
    await deleteDoc(doc(db, 'date_availability', id))
    await load()
  }

  async function applyLock() {
    // Inputs default-display the suggestion, but lockRange stays null until
    // the user actually edits — fall back to the suggestion in that case.
    const start = lockRange?.start || suggestion?.start
    const end = lockRange?.end || suggestion?.end
    if (!start || !end || start > end) return
    setSaving(true); setLockMsg('')
    try {
      await updateDoc(doc(db, 'trips', tripId), {
        start_date: start,
        end_date: end,
        updated_at: serverTimestamp(),
      })
      setLockMsg('Trip dates updated!')
      onTripUpdated?.()
      setTimeout(() => setLockMsg(''), 2500)
    } finally {
      setSaving(false)
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="px-6 pt-4 space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-24 rounded-2xl shimmer" style={{ background: '#1c1916' }} />
        ))}
      </div>
    )
  }

  if (!poll) {
    return (
      <div className="px-6 pt-4">
        {showCreate ? (
          <CreatePollCard
            saving={saving}
            onCreate={createPoll}
            onCancel={() => setShowCreate(false)}
            existingTrip={trip}
          />
        ) : (
          <EmptyState
            isOwner={isOwner}
            onStart={() => setShowCreate(true)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="px-6 pt-4 space-y-4">
      {/* Header */}
      <div className="glass rounded-2xl p-5 fade-in">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs tracking-widest uppercase mb-1" style={{ color: '#5a5248' }}>
              Date Poll
            </p>
            <p className="font-display text-lg font-light" style={{ color: '#e8d5a3' }}>
              {format(parseISO(poll.range_start), 'MMM d')}
              {' – '}
              {format(parseISO(poll.range_end), 'MMM d, yyyy')}
            </p>
            <p className="text-xs mt-1" style={{ color: '#5a5248' }}>
              {respondedCount}/{members.length} traveler{members.length !== 1 ? 's' : ''} responded
              {' · '}
              tap days you're free
            </p>
          </div>
          {isOwner && (
            <button onClick={deletePoll} disabled={saving}
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(196,124,90,0.1)', color: '#c47c5a' }}
              title="Delete poll">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Calendar */}
      <Calendar
        rangeStart={poll.range_start}
        rangeEnd={poll.range_end}
        myDates={myDates}
        counts={dateCounts}
        totalMembers={members.length}
        onToggle={toggleDate}
      />

      {/* Legend + clear */}
      <div className="flex items-center justify-between text-xs px-1">
        <div className="flex items-center gap-3" style={{ color: '#5a5248' }}>
          <LegendDot color="rgba(212,184,122,0.18)" label="Few" />
          <LegendDot color="rgba(212,184,122,0.5)" label="Many" />
          <LegendDot color="#d4b87a" label="All" dark />
        </div>
        {myDates.size > 0 && (
          <button onClick={clearMine}
            className="text-xs flex items-center gap-1 transition-opacity active:opacity-60"
            style={{ color: '#c47c5a' }}>
            <X size={10} /> Clear mine
          </button>
        )}
      </div>

      {/* Suggestion + lock */}
      {suggestion && (
        <div className="glass rounded-2xl p-5 fade-in"
          style={{ background: 'rgba(138,171,142,0.06)', border: '1px solid rgba(138,171,142,0.2)' }}>
          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(138,171,142,0.15)' }}>
              <Sparkles size={16} style={{ color: '#8aab8e' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs tracking-widest uppercase" style={{ color: '#5a5248' }}>
                Best window
              </p>
              <p className="font-display text-base font-light" style={{ color: '#e8d5a3' }}>
                {format(parseISO(suggestion.start), 'MMM d')}
                {suggestion.length > 1 && ` – ${format(parseISO(suggestion.end), 'MMM d')}`}
              </p>
              <p className="text-xs mt-0.5" style={{ color: '#5a5248' }}>
                {suggestion.length} day{suggestion.length !== 1 ? 's' : ''}
                {' · '}
                {suggestion.avg >= members.length && members.length > 0
                  ? 'everyone free'
                  : `${Math.round(suggestion.avg)} of ${members.length} free`}
              </p>
            </div>
          </div>

          {isOwner && (
            <>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <DateInput
                  label="Start"
                  value={lockRange?.start || suggestion.start}
                  onChange={v => setLockRange({ start: v, end: lockRange?.end || suggestion.end })}
                />
                <DateInput
                  label="End"
                  value={lockRange?.end || suggestion.end}
                  onChange={v => setLockRange({ start: lockRange?.start || suggestion.start, end: v })}
                />
              </div>
              {(() => {
                const ls = lockRange?.start || suggestion.start
                const le = lockRange?.end || suggestion.end
                const lockValid = ls && le && ls <= le
                return (
                  <>
                    <button onClick={applyLock} disabled={saving || !lockValid}
                      className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all active:scale-95"
                      style={{
                        background: lockMsg
                          ? 'rgba(138,171,142,0.2)'
                          : lockValid
                            ? 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)'
                            : '#3d3830',
                        color: lockMsg ? '#8aab8e' : lockValid ? '#0a0908' : '#5a5248',
                      }}>
                      {lockMsg ? <><Check size={14} /> {lockMsg}</> : <><Lock size={13} /> Lock as trip dates</>}
                    </button>
                    <p className="text-xs mt-2 text-center" style={{ color: '#5a5248' }}>
                      {lockValid ? "Updates the trip's start & end dates." : 'End date must be on or after the start date.'}
                    </p>
                  </>
                )
              })()}
            </>
          )}
        </div>
      )}

      {/* Per-member responses */}
      {availability.length > 0 && (
        <div className="glass rounded-2xl overflow-hidden fade-in">
          <p className="text-xs tracking-widest uppercase px-5 pt-5 pb-3" style={{ color: '#5a5248' }}>
            Responses
          </p>
          {members.map((m, i) => {
            const a = availability.find(av => av.user_id === m.id)
            const count = a?.dates?.length || 0
            return (
              <div key={m.id}
                className="flex items-center gap-3 px-5 py-3"
                style={{ borderBottom: i < members.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center font-display text-sm flex-shrink-0"
                  style={{
                    background: a ? 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)' : 'rgba(255,255,255,0.05)',
                    color: a ? '#0a0908' : '#5a5248',
                  }}>
                  {m.full_name?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate" style={{ color: '#d4cfc8' }}>{m.full_name}</p>
                  <p className="text-xs" style={{ color: '#5a5248' }}>
                    {a ? `${count} day${count !== 1 ? 's' : ''} marked` : 'No response yet'}
                  </p>
                </div>
                {a && <Check size={12} style={{ color: '#8aab8e' }} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── empty state ──────────────────────────────────────────────────────────────

function EmptyState({ isOwner, onStart }) {
  return (
    <div className="text-center py-16 fade-in">
      <div className="text-6xl mb-4">🗓️</div>
      <p className="font-display text-2xl font-light" style={{ color: '#e8d5a3' }}>
        Pick the perfect dates
      </p>
      <p className="text-sm mt-2 mb-6 px-6" style={{ color: '#5a5248' }}>
        Set a window, let everyone tap days they're free, then lock in the dates that work for the whole crew.
      </p>
      {isOwner ? (
        <button onClick={onStart}
          className="px-6 py-3 rounded-xl text-sm font-medium transition-all active:scale-95"
          style={{ background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
          Start date planning
        </button>
      ) : (
        <p className="text-xs" style={{ color: '#5a5248' }}>
          Only the trip owner can start a date poll.
        </p>
      )}
    </div>
  )
}

// ─── create poll ──────────────────────────────────────────────────────────────

function CreatePollCard({ saving, onCreate, onCancel, existingTrip }) {
  const defaultStart = existingTrip?.start_date || todayISO()
  const defaultEnd = existingTrip?.end_date
    || ISO(addDays(parseISO(defaultStart), 60))
  const [start, setStart] = useState(defaultStart)
  const [end, setEnd] = useState(defaultEnd)
  const valid = start && end && start <= end

  return (
    <div className="glass rounded-2xl p-5 space-y-4 slide-up">
      <div>
        <h3 className="font-display text-lg font-light" style={{ color: '#e8d5a3' }}>
          New Date Poll
        </h3>
        <p className="text-xs mt-1" style={{ color: '#5a5248' }}>
          Pick the window of dates everyone should consider.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <DateInput label="Window starts" value={start} onChange={setStart} />
        <DateInput label="Window ends" value={end} onChange={setEnd} />
      </div>
      <div className="flex gap-2">
        <button onClick={() => onCreate(start, end)} disabled={saving || !valid}
          className="flex-1 py-3 rounded-xl text-sm font-medium transition-all active:scale-95"
          style={{
            background: !valid ? '#3d3830' : 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)',
            color: !valid ? '#5a5248' : '#0a0908',
          }}>
          {saving ? 'Creating…' : 'Create poll'}
        </button>
        <button onClick={onCancel}
          className="px-4 py-3 rounded-xl text-sm"
          style={{ background: 'rgba(255,255,255,0.04)', color: '#5a5248' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── calendar grid ────────────────────────────────────────────────────────────

function Calendar({ rangeStart, rangeEnd, myDates, counts, totalMembers, onToggle }) {
  const start = parseISO(rangeStart)
  const end = parseISO(rangeEnd)
  // Build a list of months that the range spans.
  const months = []
  let cursor = startOfMonth(start)
  while (cursor <= end) {
    months.push(cursor)
    cursor = startOfMonth(addDays(endOfMonth(cursor), 1))
  }

  return (
    <div className="space-y-4">
      {months.map(month => (
        <MonthGrid
          key={ISO(month)}
          month={month}
          rangeStart={start}
          rangeEnd={end}
          myDates={myDates}
          counts={counts}
          totalMembers={totalMembers}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

function MonthGrid({ month, rangeStart, rangeEnd, myDates, counts, totalMembers, onToggle }) {
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 0 })
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 0 })
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  return (
    <div className="glass rounded-2xl p-4">
      <p className="font-display text-base font-light mb-3 px-1" style={{ color: '#e8d5a3' }}>
        {format(month, 'MMMM yyyy')}
      </p>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="text-center text-xs" style={{ color: '#3d3830' }}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map(day => {
          const inMonth = isSameMonth(day, month)
          const inRange = isWithinInterval(day, { start: rangeStart, end: rangeEnd })
          const iso = ISO(day)
          const count = counts[iso] || 0
          const mine = myDates.has(iso)
          const ratio = totalMembers ? count / totalMembers : 0

          if (!inRange) {
            return (
              <div key={iso} className="aspect-square rounded-lg flex items-center justify-center text-xs"
                style={{ color: '#2a2621' }}>
                {inMonth ? format(day, 'd') : ''}
              </div>
            )
          }

          // Color intensity scales with availability ratio.
          const bg = ratio === 1
            ? 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)'
            : `rgba(212,184,122,${0.08 + ratio * 0.4})`
          const fg = ratio === 1 ? '#0a0908' : (mine ? '#d4b87a' : '#d4cfc8')
          const border = mine && ratio !== 1
            ? '1.5px solid #d4b87a'
            : '1px solid rgba(212,184,122,0.1)'

          return (
            <button key={iso}
              onClick={() => onToggle(iso)}
              className="aspect-square rounded-lg flex flex-col items-center justify-center transition-all active:scale-90 relative"
              style={{ background: bg, border, color: fg }}>
              <span className="text-xs font-medium leading-none">{format(day, 'd')}</span>
              {count > 0 && (
                <span className="text-[9px] leading-none mt-0.5"
                  style={{ color: ratio === 1 ? 'rgba(10,9,8,0.7)' : 'rgba(212,184,122,0.85)' }}>
                  {count}
                </span>
              )}
              {mine && (
                <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full"
                  style={{ background: ratio === 1 ? '#0a0908' : '#d4b87a' }} />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── small atoms ──────────────────────────────────────────────────────────────

function DateInput({ label, value, onChange }) {
  return (
    <div className="px-3 py-2 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(212,184,122,0.15)' }}>
      <p className="text-xs mb-1" style={{ color: '#5a5248' }}>{label}</p>
      <input type="date" value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-transparent text-sm outline-none"
        style={{ color: '#d4cfc8' }} />
    </div>
  )
}

function LegendDot({ color, label, dark }) {
  return (
    <span className="flex items-center gap-1">
      <span className="w-3 h-3 rounded"
        style={{ background: color, border: dark ? 'none' : '1px solid rgba(212,184,122,0.2)' }} />
      {label}
    </span>
  )
}