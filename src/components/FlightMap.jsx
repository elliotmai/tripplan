import { useState, useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { X, Plane, RefreshCw, Crosshair, Users } from 'lucide-react'
import { fetchFlightPosition, normalizeFlightNumber } from '../lib/flightTracking'

const POLL_MS = 45_000
const BACKOFF_MS = 180_000  // back off to 3 min after a rate-limit

function planeIcon(track, dim) {
  const color = dim ? '#7a9ab5' : '#d4b87a'
  const glow = dim ? 'none' : 'drop-shadow(0 0 5px rgba(212,184,122,.7))'
  const size = dim ? 22 : 28
  // Top-down airplane silhouette, nose pointing up (north) at 0°, so rotating by
  // the flight's heading points the nose the right way.
  return L.divIcon({
    className: '',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div style="transform: rotate(${track ?? 0}deg); transition: transform .5s linear;
             width:34px;height:34px;display:flex;align-items:center;justify-content:center;filter:${glow};
             opacity:${dim ? 0.8 : 1};">
             <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg">
               <path d="M12 2c-.83 0-1.5 1.12-1.5 2.5v4.79L3 14.2v1.8l7.5-2.3v4.3l-2 1.5V21l3.5-1 3.5 1v-1.5l-2-1.5v-4.3l7.5 2.3v-1.8l-7.5-4.91V4.5C13.5 3.12 12.83 2 12 2z"/>
             </svg>
           </div>`,
  })
}

function Follow({ position, enabled }) {
  const map = useMap()
  useEffect(() => {
    if (enabled && position) map.setView([position.lat, position.lon], map.getZoom(), { animate: true })
  }, [position, enabled, map])
  return null
}

// `flights`: enriched objects from toTrackableFlights (number, from, to,
// travelers[], tripName, tripEmoji). Multiple legs can share a flight number
// (e.g. two people on the same flight); we group by number and merge context.
export default function FlightMap({ flights = [], focusFlight, onClose, embedded = false }) {
  const grouped = useMemo(() => {
    const byNum = new Map()
    for (const f of flights) {
      if (!f.number) continue
      const g = byNum.get(f.number) || {
        number: f.number, from: f.from, to: f.to,
        travelers: new Set(), trips: new Map(),
      }
        ; (f.travelers || []).forEach(t => g.travelers.add(t))
      if (f.tripName) g.trips.set(f.tripName, f.tripEmoji || '✈️')
      if (!g.from) g.from = f.from
      if (!g.to) g.to = f.to
      byNum.set(f.number, g)
    }
    return [...byNum.values()].map(g => ({
      ...g,
      travelers: [...g.travelers],
      trips: [...g.trips.entries()].map(([name, emoji]) => ({ name, emoji })),
    }))
  }, [flights])

  const metaFor = num => grouped.find(g => g.number === num)

  const [positions, setPositions] = useState({})
  const [trails, setTrails] = useState({})
  const [status, setStatus] = useState('loading') // loading|ok|none_airborne|none_trackable|not_configured|error|rate_limited
  const [selected, setSelected] = useState(focusFlight ? normalizeFlightNumber(focusFlight) : null)
  const [follow, setFollow] = useState(true)
  const [updatedAt, setUpdatedAt] = useState(null)

  // Stable identity for the set of flights we're watching. Polling keys off this
  // string, so ordinary re-renders (which rebuild the flights array) don't
  // restart the loop — only an actual change to which flights we track does.
  const numbersKey = useMemo(() => grouped.map(g => g.number).sort().join(','), [grouped])

  // Returns the delay (ms) to wait before the next poll — longer after a 429.
  async function poll() {
    if (grouped.length === 0) { setStatus('none_trackable'); return POLL_MS }
    const results = await Promise.allSettled(grouped.map(g => fetchFlightPosition(g.number)))

    if (results.every(r => r.status === 'rejected' && r.reason?.message === 'not_configured')) {
      setStatus('not_configured'); return POLL_MS
    }

    const nextPos = {}
    let anyAirborne = false
    let anyOk = false
    results.forEach((r, i) => {
      const num = grouped[i].number
      if (r.status === 'fulfilled' && r.value) {
        anyOk = true
        if (r.value.airborne && r.value.position) { nextPos[num] = r.value.position; anyAirborne = true }
        else nextPos[num] = null
      } else {
        nextPos[num] = null
      }
    })

    // Rate limited: back off hard and tell the user, but keep any positions we have.
    const rateLimited = results.some(r => r.status === 'rejected' && r.reason?.upstreamStatus === 429)
    if (rateLimited && !anyOk) {
      setStatus('rate_limited')
      return BACKOFF_MS
    }

    setPositions(nextPos)
    setTrails(prev => {
      const next = { ...prev }
      for (const [num, pos] of Object.entries(nextPos)) {
        if (!pos) continue
        const pt = [pos.lat, pos.lon]
        const arr = next[num] || []
        const last = arr[arr.length - 1]
        next[num] = (last && last[0] === pt[0] && last[1] === pt[1]) ? arr : [...arr, pt].slice(-200)
      }
      return next
    })
    setUpdatedAt(Date.now())
    setStatus(anyAirborne ? 'ok' : 'none_airborne')
    setSelected(cur => {
      if (cur && nextPos[cur]) return cur
      if (focusFlight && nextPos[normalizeFlightNumber(focusFlight)]) return normalizeFlightNumber(focusFlight)
      return Object.keys(nextPos).find(n => nextPos[n]) || cur
    })
    return rateLimited ? BACKOFF_MS : POLL_MS
  }

  useEffect(() => {
    let stopped = false
    let handle
    async function loop() {
      const delay = await poll().catch(() => POLL_MS)
      if (!stopped) handle = setTimeout(loop, delay || POLL_MS)
    }
    loop()
    return () => { stopped = true; clearTimeout(handle) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numbersKey])

  const airborne = Object.entries(positions).filter(([, p]) => p).map(([num, p]) => ({ num, ...p }))
  const sel = selected ? positions[selected] : null
  const selMeta = selected ? metaFor(selected) : null

  const containerCls = embedded ? 'flex flex-col h-full' : 'fixed inset-0 z-50 flex flex-col'

  return (
    <div className={containerCls} style={{ background: '#0a0908' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(212,184,122,0.1)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <Plane size={16} style={{ color: '#d4b87a' }} />
          <div className="min-w-0">
            <p className="font-medium text-sm" style={{ color: '#e8d5a3' }}>
              {status === 'ok' ? `${airborne.length} flight${airborne.length !== 1 ? 's' : ''} in the air` : 'Live flight tracking'}
            </p>
            {selMeta && (
              <p className="text-xs truncate" style={{ color: '#5a5248' }}>
                {selected}{[selMeta.from, selMeta.to].filter(Boolean).length ? ' · ' + [selMeta.from, selMeta.to].filter(Boolean).join(' → ') : ''}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={poll} className="p-2 rounded-lg" style={{ color: '#7a9ab5', background: 'rgba(122,154,181,0.08)' }} title="Refresh">
            <RefreshCw size={14} />
          </button>
          {!embedded && onClose && (
            <button onClick={onClose} className="p-2 rounded-lg" style={{ color: '#5a5248', background: 'rgba(255,255,255,0.04)' }}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Map / states */}
      <div className="relative flex-1">
        {status === 'ok' && (
          <>
            <MapContainer center={sel ? [sel.lat, sel.lon] : [airborne[0].lat, airborne[0].lon]} zoom={5} zoomControl={false}
              style={{ height: '100%', width: '100%', background: '#0a0908' }}>
              <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; OpenStreetMap contributors &copy; CARTO' />
              {airborne.map(ac => {
                const isSel = ac.num === selected
                const trail = trails[ac.num] || []
                return (
                  <div key={ac.num}>
                    {trail.length > 1 && (
                      <Polyline positions={trail}
                        pathOptions={{ color: isSel ? '#d4b87a' : '#7a9ab5', weight: 2, opacity: isSel ? 0.5 : 0.25 }} />
                    )}
                    <Marker position={[ac.lat, ac.lon]} icon={planeIcon(ac.track, !isSel)}
                      eventHandlers={{ click: () => setSelected(ac.num) }} />
                  </div>
                )
              })}
              <Follow position={sel} enabled={follow} />
            </MapContainer>

            <button onClick={() => setFollow(f => !f)}
              className="absolute z-[1000] bottom-4 right-4 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs"
              style={{
                background: follow ? 'rgba(212,184,122,0.9)' : 'rgba(10,9,8,0.85)', color: follow ? '#0a0908' : '#d4b87a',
                border: '1px solid rgba(212,184,122,0.3)', backdropFilter: 'blur(8px)'
              }}>
              <Crosshair size={12} />{follow ? 'Following' : 'Follow'}
            </button>

            {/* Telemetry for the selected flight — incl. trip + who's aboard */}
            {sel && selMeta && (
              <div className="absolute z-[1000] top-4 left-4 right-4 px-4 py-3 rounded-xl"
                style={{ background: 'rgba(10,9,8,0.85)', border: '1px solid rgba(212,184,122,0.15)', backdropFilter: 'blur(8px)' }}>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  <Stat label="Flight" value={selected} />
                  <Stat label="Route" value={[sel.orig_iata, sel.dest_iata].filter(Boolean).join(' → ') || '—'} />
                  <Stat label="Altitude" value={sel.alt != null ? `${sel.alt.toLocaleString()} ft` : '—'} />
                  <Stat label="Speed" value={sel.gspeed != null ? `${sel.gspeed} kt` : '—'} />
                  {sel.type && <Stat label="Aircraft" value={sel.type} />}
                </div>
                <FlightContext meta={selMeta} />
              </div>
            )}

            {airborne.length > 1 && (
              <div className="absolute z-[1000] bottom-4 left-4 flex gap-1.5 flex-wrap max-w-[70%]">
                {airborne.map(ac => {
                  const m = metaFor(ac.num)
                  return (
                    <button key={ac.num} onClick={() => setSelected(ac.num)}
                      className="px-2.5 py-1 rounded-full text-xs transition-all"
                      style={{
                        background: ac.num === selected ? 'rgba(212,184,122,0.9)' : 'rgba(10,9,8,0.85)',
                        color: ac.num === selected ? '#0a0908' : '#d4b87a',
                        border: '1px solid rgba(212,184,122,0.3)', backdropFilter: 'blur(8px)',
                      }}>
                      {m?.trips[0]?.emoji || '✈️'} {ac.num}
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}

        {status !== 'ok' && (
          <div className="h-full flex flex-col items-center justify-center px-8 text-center overflow-y-auto py-10">
            <div className="text-5xl mb-4">
              {status === 'loading' ? '📡' : status === 'none_airborne' ? '🛬'
                : status === 'none_trackable' ? '✈️' : status === 'not_configured' ? '🔧'
                  : status === 'rate_limited' ? '⏳' : '⚠️'}
            </div>
            <p className="font-display text-xl font-light" style={{ color: '#e8d5a3' }}>
              {status === 'loading' && 'Locating flights…'}
              {status === 'none_airborne' && 'No flights airborne right now'}
              {status === 'none_trackable' && 'No trackable flights'}
              {status === 'not_configured' && 'Tracking not set up'}
              {status === 'rate_limited' && 'Tracking paused'}
              {status === 'error' && 'Couldn’t reach tracking'}
            </p>
            <p className="text-sm mt-2 max-w-xs" style={{ color: '#5a5248' }}>
              {status === 'loading' && 'Checking the live ADS-B network.'}
              {status === 'none_airborne' && 'None of these flights are broadcasting a live position right now. They’ll appear here automatically once in the air.'}
              {status === 'none_trackable' && 'Add a flight number to a travel leg to track it live.'}
              {status === 'not_configured' && 'Live flight tracking hasn’t been enabled for this app yet.'}
              {status === 'rate_limited' && 'Hit the flight-data rate limit. Slowing down and retrying automatically in a few minutes.'}
              {status === 'error' && 'Something went wrong fetching positions. Try again in a moment.'}
            </p>

            {/* Even when nothing's airborne, list every flight with its trip + crew */}
            {grouped.length > 0 && status !== 'not_configured' && (
              <div className="w-full max-w-sm mt-6 space-y-2">
                {grouped.map(g => (
                  <div key={g.number} className="flex items-center gap-3 px-4 py-3 rounded-xl text-left"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <span className="text-lg flex-shrink-0">{g.trips[0]?.emoji || '✈️'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-mono" style={{ color: '#d4b87a' }}>{g.number}</p>
                      <div className="text-xs" style={{ color: '#5a5248' }}>
                        {g.trips.map(t => t.name).join(', ') || 'Trip'}
                        {[g.from, g.to].filter(Boolean).length ? ` · ${[g.from, g.to].filter(Boolean).join(' → ')}` : ''}
                      </div>
                      {g.travelers.length > 0 && (
                        <div className="flex items-center gap-1 text-xs mt-0.5" style={{ color: '#7a9ab5' }}>
                          <Users size={9} />{g.travelers.join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {grouped.length > 0 && (status === 'none_airborne' || status === 'error') && (
              <button onClick={poll} className="mt-5 px-4 py-2 rounded-xl text-xs flex items-center gap-1.5"
                style={{ background: 'rgba(212,184,122,0.1)', border: '1px solid rgba(212,184,122,0.25)', color: '#d4b87a' }}>
                <RefreshCw size={12} />Check again
              </button>
            )}
          </div>
        )}
      </div>

      {/* Footer / freshness */}
      <div className="px-5 py-2 text-center" style={{ borderTop: '1px solid rgba(212,184,122,0.08)' }}>
        <p className="text-xs" style={{ color: '#3d3830' }}>
          {updatedAt ? `Updated ${Math.round((Date.now() - updatedAt) / 1000)}s ago · refreshes every ${POLL_MS / 1000}s` : 'Live data via Flightradar24'}
        </p>
      </div>
    </div>
  )
}

function FlightContext({ meta }) {
  if (!meta) return null
  const tripLabel = meta.trips.map(t => `${t.emoji} ${t.name}`).join(' · ')
  return (
    <div className="flex flex-col gap-1 mt-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      {tripLabel && <p className="text-xs" style={{ color: '#8a7f70' }}>{tripLabel}</p>}
      {meta.travelers.length > 0 && (
        <p className="flex items-center gap-1 text-xs" style={{ color: '#7a9ab5' }}>
          <Users size={10} />{meta.travelers.join(', ')}
        </p>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest" style={{ color: '#5a5248' }}>{label}</p>
      <p className="text-sm" style={{ color: '#d4cfc8' }}>{value}</p>
    </div>
  )
}