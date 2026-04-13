import { useState, useEffect } from 'react'
import {
  collection, query, where, getDocs,
  addDoc, deleteDoc, doc, orderBy, serverTimestamp
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { fetchWeatherForTrip } from '../lib/weather'
import { format, parseISO } from 'date-fns'
import { Plus, Clock, MapPin, Trash2, ChevronDown, ArrowRight } from 'lucide-react'

// ─── constants ────────────────────────────────────────────────────────────────

const EVENT_TYPES = [
  { value: 'activity', label: 'Activity', color: '#8aab8e' },
  { value: 'food', label: 'Food & Drink', color: '#d4b87a' },
  { value: 'transport', label: 'Transport', color: '#c47c5a' },
  { value: 'accommodation', label: 'Stay', color: '#7a9ab5' },
  { value: 'note', label: 'Note', color: '#5a5248' },
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

// ─── Build per-date travel cards from multi-leg details ───────────────────────

function buildTravelByDate(travelDetails, members) {
  const byDate = {}

  function push(dateStr, card) {
    if (!dateStr) return
    if (!byDate[dateStr]) byDate[dateStr] = []
    byDate[dateStr].push(card)
  }

  travelDetails.forEach(detail => {
    const member = members.find(m => m.id === detail.user_id)
    const name = member?.full_name?.split(' ')[0] || 'Someone'
    const legs = detail.legs || []

    legs.forEach((leg, legIdx) => {
      const meta = TRANSPORT_META[leg.transport] || TRANSPORT_META.other

      const depDate = leg.depart_at?.slice(0, 10)
      const arrDate = leg.arrive_at?.slice(0, 10)
      const sameDay = depDate && arrDate && depDate === arrDate

      if (leg.depart_at) {
        push(depDate, {
          kind: 'depart',
          name,
          userId: detail.user_id,
          legIdx,
          transport: leg.transport,
          number: leg.number,
          from: leg.from,
          to: leg.to,
          depart_time: formatTime(leg.depart_at),
          // Show arrive time on the same card when both are on the same day
          arrive_time: sameDay ? formatTime(leg.arrive_at) : null,
          meta,
        })
      }

      // Arrival card only needed on a different date (otherwise already shown on depart card)
      if (leg.arrive_at && !sameDay) {
        push(arrDate, {
          kind: 'arrive',
          name,
          userId: detail.user_id,
          legIdx,
          transport: leg.transport,
          number: leg.number,
          from: leg.from,
          to: leg.to,
          depart_time: depDate ? null : formatTime(leg.depart_at), // only if no depart card exists
          arrive_time: formatTime(leg.arrive_at),
          meta,
        })
      }
    })
  })

  return byDate
}

function formatTime(dt) {
  if (!dt) return null
  try {
    return new Date(dt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  } catch { return null }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ItineraryTab({ tripId, trip, days, members, travelDetails = [], currentUser }) {
  const [events, setEvents] = useState([])
  const [weather, setWeather] = useState([])
  const [expandedDay, setExpandedDay] = useState(0)
  const [showAddForm, setShowAddForm] = useState(null)
  const [form, setForm] = useState({
    title: '', time: '', location: '', notes: '', type: 'activity', assigned_to: ''
  })
  const [saving, setSaving] = useState(false)

  const travelByDate = buildTravelByDate(travelDetails, members)

  useEffect(() => {
    loadEvents()
    if (trip.lat && trip.lon && trip.start_date && trip.end_date) {
      fetchWeatherForTrip(trip.lat, trip.lon, trip.start_date, trip.end_date).then(setWeather)
    }
  }, [tripId])

  async function loadEvents() {
    const snap = await getDocs(query(
      collection(db, 'itinerary_events'),
      where('trip_id', '==', tripId),
      orderBy('time', 'asc')
    ))
    setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  async function addEvent(date) {
    if (!form.title.trim()) return
    setSaving(true)
    await addDoc(collection(db, 'itinerary_events'), {
      trip_id: tripId,
      date,
      title: form.title,
      time: form.time || null,
      location: form.location || null,
      notes: form.notes || null,
      type: form.type,
      assigned_to: form.assigned_to || null,
      created_by: currentUser.id,
      created_at: serverTimestamp(),
    })
    setForm({ title: '', time: '', location: '', notes: '', type: 'activity', assigned_to: '' })
    setShowAddForm(null)
    setSaving(false)
    loadEvents()
  }

  async function deleteEvent(id) {
    await deleteDoc(doc(db, 'itinerary_events', id))
    loadEvents()
  }

  return (
    <div className="px-6 pt-4 space-y-3">
      {days.length === 0 && (
        <div className="text-center py-16">
          <p className="text-sm" style={{ color: '#5a5248' }}>Add dates to your trip to see the itinerary.</p>
        </div>
      )}

      {days.map((day, idx) => {
        const dateStr = format(day, 'yyyy-MM-dd')
        const dayEvents = events.filter(e => e.date === dateStr)
        const dayWeather = weather.find(w => w.date === dateStr)
        const dayTravel = travelByDate[dateStr] || []
        const totalItems = dayEvents.length + dayTravel.length
        const isOpen = expandedDay === idx

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
                    {dayEvents.length > 0 && (
                      <span className="text-xs" style={{ color: '#5a5248' }}>
                        {dayEvents.length} event{dayEvents.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {dayTravel.length > 0 && (
                      <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full"
                        style={{ background: 'rgba(122,154,181,0.15)', color: '#7a9ab5' }}>
                        {[...new Set(dayTravel.map(t => t.meta.icon))].join('')} {dayTravel.length} travel
                      </span>
                    )}
                    {totalItems === 0 && (
                      <span className="text-xs" style={{ color: '#3d3830' }}>Empty</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {dayWeather && (
                  <div className="flex flex-col items-end">
                    <div className="flex items-center gap-1">
                      <span className="text-base">{dayWeather.icon}</span>
                      <span className="text-sm font-medium" style={{ color: '#d4cfc8' }}>{dayWeather.maxTemp}°</span>
                    </div>
                    <span className="text-xs" style={{ color: '#5a5248' }}>{dayWeather.minTemp}° low</span>
                  </div>
                )}
                <ChevronDown size={14} style={{
                  color: '#5a5248',
                  transform: isOpen ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s'
                }} />
              </div>
            </button>

            {/* ── Expanded body ── */}
            {isOpen && (
              <div className="px-5 pb-5 space-y-2 slide-up">

                {/* Weather detail strip */}
                {dayWeather && (
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <span className="text-xl">{dayWeather.icon}</span>
                    <div>
                      <p className="text-sm" style={{ color: '#d4cfc8' }}>{dayWeather.label}</p>
                      <p className="text-xs" style={{ color: '#5a5248' }}>
                        {dayWeather.maxTemp}° high · {dayWeather.minTemp}° low
                        {dayWeather.precipProb > 20 ? ` · ${dayWeather.precipProb}% rain` : ''}
                      </p>
                    </div>
                  </div>
                )}

                {/* Travel leg cards */}
                {dayTravel.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs tracking-widest uppercase px-1 pt-1" style={{ color: '#5a5248' }}>Travel</p>
                    {dayTravel.map((card, ci) => <TravelCard key={ci} card={card} />)}
                  </div>
                )}

                {/* Events */}
                {dayEvents.length > 0 && (
                  <div className="space-y-1.5">
                    {dayTravel.length > 0 && (
                      <p className="text-xs tracking-widest uppercase px-1 pt-1" style={{ color: '#5a5248' }}>Events</p>
                    )}
                    {dayEvents.map(event => (
                      <EventItem key={event.id} event={event} members={members}
                        onDelete={deleteEvent} currentUser={currentUser} />
                    ))}
                  </div>
                )}

                {totalItems === 0 && showAddForm !== dateStr && (
                  <p className="text-xs text-center py-3" style={{ color: '#3d3830' }}>No events yet.</p>
                )}

                {/* Add event form */}
                {showAddForm === dateStr ? (
                  <div className="rounded-xl p-4 space-y-3 mt-2"
                    style={{ background: 'rgba(212,184,122,0.06)', border: '1px solid rgba(212,184,122,0.15)' }}>
                    <input autoFocus placeholder="Event title *" value={form.title}
                      onChange={e => setForm({ ...form, title: e.target.value })}
                      className="w-full bg-transparent text-sm outline-none"
                      style={{ color: '#e8d5a3', borderBottom: '1px solid rgba(212,184,122,0.2)', paddingBottom: '8px' }} />
                    <div className="grid grid-cols-2 gap-3">
                      <input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })}
                        className="bg-transparent text-xs outline-none"
                        style={{ color: '#b5aea4', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' }} />
                      <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
                        className="bg-transparent text-xs outline-none"
                        style={{ color: '#b5aea4', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px', background: 'transparent' }}>
                        {EVENT_TYPES.map(t => (
                          <option key={t.value} value={t.value} style={{ background: '#1c1916' }}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    <input placeholder="Location (optional)" value={form.location}
                      onChange={e => setForm({ ...form, location: e.target.value })}
                      className="w-full bg-transparent text-xs outline-none"
                      style={{ color: '#b5aea4', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' }} />
                    <select value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })}
                      className="w-full text-xs outline-none"
                      style={{ color: '#b5aea4', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px', background: 'transparent' }}>
                      <option value="" style={{ background: '#1c1916' }}>Assign to… (optional)</option>
                      {members.map(m => (
                        <option key={m.id} value={m.id} style={{ background: '#1c1916' }}>{m.full_name}</option>
                      ))}
                    </select>
                    <textarea placeholder="Notes (optional)" value={form.notes}
                      onChange={e => setForm({ ...form, notes: e.target.value })}
                      rows={2} className="w-full bg-transparent text-xs outline-none resize-none"
                      style={{ color: '#b5aea4', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px' }} />
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => addEvent(dateStr)} disabled={saving || !form.title.trim()}
                        className="flex-1 py-2 rounded-xl text-xs font-medium"
                        style={{ background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
                        {saving ? 'Saving…' : 'Add Event'}
                      </button>
                      <button onClick={() => setShowAddForm(null)}
                        className="px-4 py-2 rounded-xl text-xs"
                        style={{ color: '#5a5248', background: 'rgba(255,255,255,0.04)' }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setShowAddForm(dateStr)}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs mt-1 transition-all"
                    style={{ color: '#5a5248', border: '1px dashed rgba(212,184,122,0.2)' }}>
                    <Plus size={12} />Add event
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Travel card (itinerary view) ─────────────────────────────────────────────

function TravelCard({ card }) {
  const isArrive = card.kind === 'arrive'
  const c = card.meta.color
  const hasRoute = card.from || card.to

  return (
    <div className="px-3 py-2.5 rounded-xl"
      style={{ background: `${c}12`, border: `1px solid ${c}28` }}>

      {/* Top row: icon · name · number · label */}
      <div className="flex items-center gap-2">
        <span className="text-base flex-shrink-0">{card.meta.icon}</span>
        <span className="text-xs font-medium flex-1 min-w-0 truncate" style={{ color: '#d4cfc8' }}>
          {card.name}
        </span>
        {card.number && (
          <span className="text-xs px-1.5 py-0.5 rounded font-mono flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.06)', color: '#b5aea4' }}>
            {card.number}
          </span>
        )}
        {/* <span className="text-xs font-medium flex-shrink-0" style={{ color: c }}>
          {isArrive ? 'Arriving' : 'Departing'}
        </span> */}
      </div>

      {/* Route row: from [depart time] → to [arrive time] */}
      {hasRoute && (
        <div className="flex items-start gap-2 mt-2 ml-6">
          {/* Origin + depart time */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate" style={{ color: '#b5aea4' }}>
              {card.from || '—'}
            </p>
            {card.depart_time && (
              <p className="text-xs flex items-center gap-1 mt-0.5" style={{ color: '#5a5248' }}>
                <Clock size={8} />{card.depart_time}
              </p>
            )}
          </div>

          <ArrowRight size={10} style={{ color: '#3d3830', flexShrink: 0, marginTop: 2 }} />

          {/* Destination + arrive time */}
          <div className="flex-1 min-w-0 text-right">
            <p className="text-xs font-medium truncate" style={{ color: '#b5aea4' }}>
              {card.to || '—'}
            </p>
            {card.arrive_time && (
              <p className="text-xs flex items-center justify-end gap-1 mt-0.5" style={{ color: '#5a5248' }}>
                <Clock size={8} />{card.arrive_time}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Fallback when no route but we have times */}
      {!hasRoute && (card.depart_time || card.arrive_time) && (
        <div className="flex items-center gap-2 mt-1 ml-6">
          {card.depart_time && (
            <span className="flex items-center gap-1 text-xs" style={{ color: '#5a5248' }}>
              <Clock size={8} />{card.depart_time}
            </span>
          )}
          {card.depart_time && card.arrive_time && (
            <ArrowRight size={8} style={{ color: '#3d3830' }} />
          )}
          {card.arrive_time && (
            <span className="flex items-center gap-1 text-xs" style={{ color: '#5a5248' }}>
              <Clock size={8} />{card.arrive_time}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Itinerary event row ──────────────────────────────────────────────────────

function EventItem({ event, members, onDelete, currentUser }) {
  const typeInfo = EVENT_TYPES.find(t => t.value === event.type) || EVENT_TYPES[0]
  const assignee = members.find(m => m.id === event.assigned_to)

  return (
    <div className="flex items-start gap-3 px-3 py-3 rounded-xl group"
      style={{ background: 'rgba(255,255,255,0.03)' }}>
      <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: typeInfo.color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium truncate" style={{ color: '#d4cfc8' }}>{event.title}</p>
          {event.created_by === currentUser.id && (
            <button onClick={() => onDelete(event.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              style={{ color: '#5a5248' }}>
              <Trash2 size={12} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
          {event.time && (
            <span className="flex items-center gap-1 text-xs" style={{ color: '#5a5248' }}>
              <Clock size={9} />{event.time.slice(0, 5)}
            </span>
          )}
          {event.location && (
            <span className="flex items-center gap-1 text-xs" style={{ color: '#5a5248' }}>
              <MapPin size={9} />{event.location}
            </span>
          )}
          {assignee && (
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(212,184,122,0.1)', color: '#d4b87a' }}>
              {assignee.full_name?.split(' ')[0]}
            </span>
          )}
        </div>
        {event.notes && <p className="text-xs mt-1" style={{ color: '#5a5248' }}>{event.notes}</p>}
      </div>
    </div>
  )
}