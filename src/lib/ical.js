// ─── ICS generator for Wander
// Handles both itinerary events and traveler journey/accommodation details.

function pad(n) { return String(n).padStart(2, '0') }

function makeUID() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}@wander`
}

function escapeICS(str) {
  if (!str) return ''
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

// dateStr: 'yyyy-MM-dd', timeStr: 'HH:mm' (optional)
function toICSDate(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-')
  if (!timeStr) return { value: `${y}${m}${d}`, allDay: true }
  const [h, min] = timeStr.split(':')
  return { value: `${y}${m}${d}T${pad(Number(h))}${pad(Number(min))}00`, allDay: false }
}

// ISO datetime string → ICS datetime, e.g. "2024-06-15T14:30:00" → "20240615T143000"
function isoToICS(iso) {
  if (!iso) return null
  try {
    const d = new Date(iso)
    const y   = d.getFullYear()
    const mo  = pad(d.getMonth() + 1)
    const day = pad(d.getDate())
    const h   = pad(d.getHours())
    const min = pad(d.getMinutes())
    return `${y}${mo}${day}T${h}${min}00`
  } catch { return null }
}

// Increment a DATE string (yyyyMMdd) by 1 day
function nextDay(icsDate) {
  const y = parseInt(icsDate.slice(0, 4))
  const m = parseInt(icsDate.slice(4, 6)) - 1
  const d = parseInt(icsDate.slice(6, 8))
  const next = new Date(y, m, d + 1)
  return `${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`
}

const TRANSPORT_LABELS = {
  flight:  'Flight',
  train:   'Train',
  bus:     'Bus',
  car:     'Car',
  ferry:   'Ferry',
  subway:  'Subway',
  taxi:    'Taxi',
  walk:    'Walk',
  other:   'Journey',
}

const TRANSPORT_ICONS = {
  flight: '✈️', train: '🚂', bus: '🚌', car: '🚗',
  ferry: '⛴️', subway: '🚇', taxi: '🚕', walk: '🚶', other: '🛸',
}

// ─── Trip banner event ────────────────────────────────────────────────────────

function tripBannerLines(trip) {
  if (!trip?.start_date || !trip?.end_date) return []
  const [sy, sm, sd] = trip.start_date.split('-')
  const [ey, em, ed] = trip.end_date.split('-')
  const startVal = `${sy}${sm}${sd}`
  const endVal   = nextDay(`${ey}${em}${ed}`)
  const emoji    = trip.cover_emoji ? `${trip.cover_emoji} ` : '✈️ '
  const desc     = [
    trip.destination ? `Destination: ${trip.destination}` : null,
    `${trip.start_date} – ${trip.end_date}`,
  ].filter(Boolean).join('\\n')

  return [
    'BEGIN:VEVENT',
    `UID:trip-${makeUID()}`,
    `DTSTAMP:${isoToICS(new Date().toISOString())}Z`,
    `SUMMARY:${escapeICS(`${emoji}${trip.name}`)}`,
    `DTSTART;VALUE=DATE:${startVal}`,
    `DTEND;VALUE=DATE:${endVal}`,
    trip.destination ? `LOCATION:${escapeICS(trip.destination)}` : '',
    `DESCRIPTION:${desc}`,
    'END:VEVENT',
  ].filter(Boolean)
}

// ─── Itinerary events → ICS ───────────────────────────────────────────────────

export function generateICS(events, calName, trip) {
  const lines = icsHeader(calName)

  tripBannerLines(trip).forEach(l => lines.push(l))

  for (const event of events) {
    const start = toICSDate(event.date, event.time || null)
    const end   = toICSDate(event.date, event.end_time || event.time || null)

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${makeUID()}`)
    lines.push(`DTSTAMP:${isoToICS(new Date().toISOString())}Z`)
    lines.push(`SUMMARY:${escapeICS(event.title)}`)

    if (start.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${start.value}`)
      lines.push(`DTEND;VALUE=DATE:${nextDay(start.value)}`)
    } else {
      lines.push(`DTSTART:${start.value}`)
      if (event.end_time) {
        lines.push(`DTEND:${end.value}`)
      } else {
        // Default 1-hour duration
        const [h, min] = event.time.split(':').map(Number)
        const [y, m, d] = event.date.split('-')
        lines.push(`DTEND:${y}${m}${d}T${pad(h + 1)}${pad(min)}00`)
      }
    }

    if (event.location) lines.push(`LOCATION:${escapeICS(event.location)}`)
    if (event.notes)    lines.push(`DESCRIPTION:${escapeICS(event.notes)}`)

    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

// ─── Travel details → ICS ─────────────────────────────────────────────────────

// travelDetails: array of { user_id, legs, accommodation, accommodation_address, notes }
// members:       array of { id, full_name }
// selectedIds:   array of user_ids to include
// tripName:      string
export function generateTravelICS(travelDetails, members, selectedIds, tripName, trip) {
  const lines = icsHeader(`${tripName} – Travel`)

  tripBannerLines(trip).forEach(l => lines.push(l))

  const selected = travelDetails.filter(d => selectedIds.includes(d.user_id))

  for (const detail of selected) {
    const member   = members.find(m => m.id === detail.user_id)
    const name     = member?.full_name || 'Traveler'
    const firstName = name.split(' ')[0]

    // ── Journey legs ──────────────────────────────────────────────────────────
    for (const leg of (detail.legs || [])) {
      const icon  = TRANSPORT_ICONS[leg.transport] || '🛸'
      const label = TRANSPORT_LABELS[leg.transport] || 'Journey'

      // Summary: "✈️ BA123 · Alice: LHR → NRT"  or  "✈️ Flight · Alice: London → Paris"
      const ref    = leg.number ? `${leg.number}` : label
      const route  = [leg.from, leg.to].filter(Boolean).join(' → ')
      const summary = `${icon} ${ref} · ${firstName}${route ? ': ' + route : ''}`

      // Description with full details
      const descParts = [
        `Traveler: ${name}`,
        leg.number ? `${label} number: ${leg.number}` : null,
        leg.from   ? `From: ${leg.from}` : null,
        leg.to     ? `To: ${leg.to}` : null,
        leg.depart_at ? `Departs: ${formatDTReadable(leg.depart_at)}` : null,
        leg.arrive_at ? `Arrives: ${formatDTReadable(leg.arrive_at)}` : null,
        leg.notes  ? `Notes: ${leg.notes}` : null,
      ].filter(Boolean)

      const dtStart = leg.depart_at ? isoToICS(leg.depart_at) : null
      const dtEnd   = leg.arrive_at ? isoToICS(leg.arrive_at) : null

      if (!dtStart) continue  // Can't make a calendar event without a start time

      lines.push('BEGIN:VEVENT')
      lines.push(`UID:${makeUID()}`)
      lines.push(`DTSTAMP:${isoToICS(new Date().toISOString())}Z`)
      lines.push(`SUMMARY:${escapeICS(summary)}`)
      lines.push(`DTSTART:${dtStart}`)
      lines.push(`DTEND:${dtEnd || dtStart}`)  // If no arrival, 0-duration point
      if (leg.from) lines.push(`LOCATION:${escapeICS(leg.from)}`)
      lines.push(`DESCRIPTION:${escapeICS(descParts.join('\\n'))}`)
      lines.push('END:VEVENT')
    }

    // ── Accommodation ─────────────────────────────────────────────────────────
    if (detail.accommodation || detail.accommodation_address) {
      const accomName    = detail.accommodation || 'Accommodation'
      const accomAddress = detail.accommodation_address || ''
      const summary      = `🏨 ${accomName} · ${firstName}`

      // Find check-in/out from legs: earliest arrival date → latest departure date
      const legs = detail.legs || []
      const arrivalDates  = legs.map(l => l.arrive_at?.slice(0, 10)).filter(Boolean).sort()
      const departureDates = legs.map(l => l.depart_at?.slice(0, 10)).filter(Boolean).sort()

      const checkIn  = arrivalDates[0]   || null
      const checkOut = departureDates[departureDates.length - 1] || null

      const descParts = [
        `Traveler: ${name}`,
        accomAddress ? `Address: ${accomAddress}` : null,
        detail.notes ? `Notes: ${detail.notes}` : null,
      ].filter(Boolean)

      lines.push('BEGIN:VEVENT')
      lines.push(`UID:${makeUID()}`)
      lines.push(`DTSTAMP:${isoToICS(new Date().toISOString())}Z`)
      lines.push(`SUMMARY:${escapeICS(summary)}`)

      if (checkIn && checkOut && checkIn !== checkOut) {
        // Multi-day all-day event
        const [cy, cm, cd] = checkIn.split('-')
        const startVal = `${cy}${cm}${cd}`
        const [ey, em, ed] = checkOut.split('-')
        const endVal = `${ey}${em}${ed}`
        lines.push(`DTSTART;VALUE=DATE:${startVal}`)
        lines.push(`DTEND;VALUE=DATE:${endVal}`)
      } else if (checkIn) {
        const [cy, cm, cd] = checkIn.split('-')
        const val = `${cy}${cm}${cd}`
        lines.push(`DTSTART;VALUE=DATE:${val}`)
        lines.push(`DTEND;VALUE=DATE:${nextDay(val)}`)
      } else {
        // No dates — skip accommodation event
        lines.pop() // remove DESCRIPTION prep
        lines.splice(lines.lastIndexOf('BEGIN:VEVENT'))
        continue
      }

      if (accomAddress) lines.push(`LOCATION:${escapeICS(accomAddress)}`)
      lines.push(`DESCRIPTION:${escapeICS(descParts.join('\\n'))}`)
      lines.push('END:VEVENT')
    }
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

// ─── Download helpers ─────────────────────────────────────────────────────────

export function downloadICS(events, calName, trip) {
  triggerDownload(generateICS(events, calName, trip), calName)
}

export function downloadTravelICS(travelDetails, members, selectedIds, tripName, trip) {
  triggerDownload(
    generateTravelICS(travelDetails, members, selectedIds, tripName, trip),
    `${tripName} – Travel`
  )
}

function triggerDownload(content, name) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_]/g, '').toLowerCase()}.ics`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function icsHeader(calName) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Wander//Trip Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICS(calName)}`,
    'X-WR-TIMEZONE:UTC',
  ]
}

function formatDTReadable(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}