// Client side of flight tracking. The FR24 token lives in the Cloud Function
// (see functions/index.js → trackFlight); here we just call our own proxy.

const FUNCTION_BASE = import.meta.env.VITE_FUNCTIONS_BASE_URL || ''

// Only flights are trackable, and only if we know the flight number.
export function isTrackable(leg) {
  return !!(leg && leg.transport === 'flight' && (leg.number || '').trim())
}

// Normalize a flight number the way FR24 expects: "BA 123" → "BA123".
export function normalizeFlightNumber(num) {
  return (num || '').toUpperCase().replace(/\s+/g, '')
}

// Returns { flight, airborne, position, count } or throws with a coded reason.
export async function fetchFlightPosition(flightNumber) {
  const flight = normalizeFlightNumber(flightNumber)
  if (!flight) throw new Error('missing_flight')
  if (!FUNCTION_BASE) throw new Error('not_configured')

  const res = await fetch(`${FUNCTION_BASE}/trackFlight?flight=${encodeURIComponent(flight)}`)
  if (res.status === 503) throw new Error('not_configured')
  if (!res.ok) {
    // Pull the upstream FR24 status/detail the function forwards, so failures are
    // diagnosable from the console instead of an opaque 502.
    const info = await res.json().catch(() => ({}))
    console.warn(`Flight tracking failed for ${flight}:`, res.status, info)
    const err = new Error('upstream')
    err.upstreamStatus = info.status
    err.detail = info.detail
    throw err
  }
  return res.json()
}

import { wallClockToInstant } from './timezones'

export const TRACKING_ENABLED = !!FUNCTION_BASE

// How wide to open the tracking window around a flight's scheduled times, so
// early pushbacks and delays are still caught without polling dormant flights.
const PRE_DEPART_MS = 60 * 60 * 1000        // start 1h before scheduled departure
const POST_ARRIVE_MS = 120 * 60 * 1000      // keep 2h after scheduled arrival
const FALLBACK_FLIGHT_MS = 18 * 60 * 60 * 1000 // if no arrival time is known

// True only when `now` plausibly falls within the flight's time in the air.
// Flights that already landed or haven't departed are skipped entirely — the
// whole point is to never poll a flight that can't be airborne right now.
export function isFlightActiveNow(flight, now = Date.now()) {
  if (!flight?.depart_at) return false
  const dep = wallClockToInstant(flight.depart_at, flight.depart_tz)
  if (!dep) return false
  const arr = flight.arrive_at ? wallClockToInstant(flight.arrive_at, flight.arrive_tz || flight.depart_tz) : null
  const start = dep.getTime() - PRE_DEPART_MS
  const end   = (arr ? arr.getTime() : dep.getTime() + FALLBACK_FLIGHT_MS) + POST_ARRIVE_MS
  return now >= start && now <= end
}

// Turn normalized legs into the enriched flight objects the map consumes. Each
// carries the trip it belongs to, who's on it, and its scheduled times (so the
// caller can decide which are active right now). `tripMeta` = { tripId, tripName, tripEmoji }.
export function toTrackableFlights(legs = [], tripMeta = {}) {
  const out = []
  for (const leg of legs) {
    if (!isTrackable(leg)) continue
    out.push({
      number: normalizeFlightNumber(leg.number),
      from: leg.from || '',
      to: leg.to || '',
      travelers: leg.traveler_names || [],
      depart_at: leg.depart_at || '',
      depart_tz: leg.depart_tz || '',
      arrive_at: leg.arrive_at || '',
      arrive_tz: leg.arrive_tz || '',
      tripId: tripMeta.tripId || null,
      tripName: tripMeta.tripName || '',
      tripEmoji: tripMeta.tripEmoji || '✈️',
    })
  }
  return out
}