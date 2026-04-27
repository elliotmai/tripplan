// ─── ICS generator for Wander — with timezone support
// Uses TZID= property for all datetime values so calendar apps
// display events in the correct local time regardless of viewer timezone.

function pad(n) { return String(n).padStart(2, '0') }
function makeUID() { return `${Date.now()}-${Math.random().toString(36).slice(2)}@wander` }

function escapeICS(str) {
  if (!str) return ''
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

// Current time as ICS UTC stamp — always UTC for DTSTAMP
function nowUTC() {
  const d   = new Date()
  const y   = d.getUTCFullYear()
  const mo  = pad(d.getUTCMonth() + 1)
  const day = pad(d.getUTCDate())
  const h   = pad(d.getUTCHours())
  const min = pad(d.getUTCMinutes())
  return `${y}${mo}${day}T${h}${min}00Z`
}

// Convert 'yyyy-MM-dd' + 'HH:mm' + IANA tzId → ICS DTSTART/DTEND value with TZID
// Returns { prop, value } where prop is the full property name e.g. "DTSTART;TZID=Europe/London"
// and value is e.g. "20240615T143000"
function toTZDateTime(dateStr, timeStr, tzId) {
  const [y, m, d] = dateStr.split('-')
  const [h, min]  = (timeStr || '00:00').split(':')
  const value     = `${y}${m}${d}T${pad(Number(h))}${pad(Number(min))}00`
  const tz        = tzId || 'UTC'
  return { prop: `DTSTART;TZID=${tz}`, dtendProp: `DTEND;TZID=${tz}`, value }
}

// Convert an all-day date string 'yyyy-MM-dd' → ICS DATE value
function toDateValue(dateStr) {
  const [y, m, d] = dateStr.split('-')
  return `${y}${m}${d}`
}

// Increment a DATE string (yyyyMMdd) by 1 day
function nextDay(icsDate) {
  const y    = parseInt(icsDate.slice(0, 4))
  const m    = parseInt(icsDate.slice(4, 6)) - 1
  const d    = parseInt(icsDate.slice(6, 8))
  const next = new Date(y, m, d + 1)
  return `${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`
}

// Convert an ISO datetime-local string + IANA tzId → ICS datetime with TZID
// e.g. "2024-06-15T14:30" + "Asia/Tokyo" → { prop: "DTSTART;TZID=Asia/Tokyo", value: "20240615T143000" }
function isoLocalToTZ(isoLocal, tzId) {
  if (!isoLocal) return null
  // datetime-local format: "2024-06-15T14:30" or "2024-06-15T14:30:00"
  const clean = isoLocal.slice(0, 16) // "2024-06-15T14:30"
  const [datePart, timePart] = clean.split('T')
  const [y, mo, d] = datePart.split('-')
  const [h, min]   = timePart.split(':')
  const value      = `${y}${mo}${d}T${pad(Number(h))}${pad(Number(min))}00`
  const tz         = tzId || 'UTC'
  return {
    startProp: `DTSTART;TZID=${tz}`,
    endProp:   `DTEND;TZID=${tz}`,
    value,
    date:      datePart, // 'yyyy-MM-dd' for accommodation range calc
  }
}

function formatDTReadable(isoLocal, tzId) {
  if (!isoLocal) return ''
  try {
    const date = new Date(isoLocal)
    return date.toLocaleString('en-US', {
      timeZone:        tzId || undefined,
      month:           'short',
      day:             'numeric',
      year:            'numeric',
      hour:            '2-digit',
      minute:          '2-digit',
      timeZoneName:    'short',
    })
  } catch { return isoLocal }
}

function icsHeader(calName, timezone) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Wander//Trip Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICS(calName)}`,
  ]
  if (timezone) lines.push(`X-WR-TIMEZONE:${timezone}`)
  return lines
}


// ─── VTIMEZONE generator ──────────────────────────────────────────────────────
// Required for Google Calendar to correctly interpret TZID= references.

function _getOffsetMin(date, tzId) {
  const utcStr   = date.toLocaleString('en-US', { timeZone: 'UTC', hour12: false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
  const localStr = date.toLocaleString('en-US', { timeZone: tzId,  hour12: false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
  const parse = s => { const [dt,tm]=s.split(', ');const [m,d,y]=dt.split('/');const [h,mn]=tm.split(':');return Date.UTC(+y,+m-1,+d,+h===24?0:+h,+mn) }
  return (parse(localStr) - parse(utcStr)) / 60000
}
function _fmtTZOff(min) {
  const sign=min>=0?'+':'-', abs=Math.abs(min)
  return `${sign}${pad(Math.floor(abs/60))}${pad(abs%60)}`
}
function _tzAbbr(tzId, date) {
  try { return new Intl.DateTimeFormat('en-US',{timeZone:tzId,timeZoneName:'short'}).formatToParts(date).find(p=>p.type==='timeZoneName')?.value||tzId.split('/').pop() }
  catch { return tzId.split('/').pop() }
}
function _findTrans(year, tzId, fromStdToDst) {
  let prev = null
  for (let mo=0;mo<12;mo++) for (let dy=1;dy<=31;dy++) {
    const d=new Date(Date.UTC(year,mo,dy,2,0));if(isNaN(d))continue
    const off=_getOffsetMin(d,tzId)
    if(prev!==null&&off!==prev&&fromStdToDst===(off>prev))return d
    prev=off
  }
  return new Date(Date.UTC(year,3,1,2,0))
}
function _localDT(date, tzId) {
  try {
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:tzId,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(date)
    const get=t=>parts.find(p=>p.type===t)?.value||'00'
    return `${get('year')}${get('month')}${get('day')}T${get('hour')==='24'?'00':get('hour')}${get('minute')}${get('second')}`
  } catch { return '19700101T020000' }
}
function makeVTimezone(tzId) {
  if(!tzId||tzId==='UTC')return[]
  try {
    const jan=new Date(Date.UTC(2024,0,15)),jul=new Date(Date.UTC(2024,6,15))
    const oJan=_getOffsetMin(jan,tzId),oJul=_getOffsetMin(jul,tzId)
    const std=Math.min(oJan,oJul),dst=Math.max(oJan,oJul)
    if(oJan===oJul)return['BEGIN:VTIMEZONE',`TZID:${tzId}`,'BEGIN:STANDARD','DTSTART:19700101T000000',`TZOFFSETFROM:${_fmtTZOff(std)}`,`TZOFFSETTO:${_fmtTZOff(std)}`,`TZNAME:${_tzAbbr(tzId,jan)}`,'END:STANDARD','END:VTIMEZONE']
    const spring=_findTrans(2024,tzId,true),fall=_findTrans(2024,tzId,false)
    return ['BEGIN:VTIMEZONE',`TZID:${tzId}`,'BEGIN:DAYLIGHT',`DTSTART:${_localDT(spring,tzId)}`,`TZOFFSETFROM:${_fmtTZOff(std)}`,`TZOFFSETTO:${_fmtTZOff(dst)}`,`TZNAME:${_tzAbbr(tzId,jul)}`,'RRULE:FREQ=YEARLY','END:DAYLIGHT','BEGIN:STANDARD',`DTSTART:${_localDT(fall,tzId)}`,`TZOFFSETFROM:${_fmtTZOff(dst)}`,`TZOFFSETTO:${_fmtTZOff(std)}`,`TZNAME:${_tzAbbr(tzId,jan)}`,'RRULE:FREQ=YEARLY','END:STANDARD','END:VTIMEZONE']
  } catch { return [] }
}
function injectVTimezones(lines) {
  const tzIds=new Set()
  for(const line of lines){const m=line.match(/TZID=([^:]+):/);if(m&&m[1]!=='UTC')tzIds.add(m[1])}
  if(!tzIds.size)return lines
  const insertAt=lines.findIndex(l=>l==='BEGIN:VEVENT')
  if(insertAt===-1)return lines
  const vtBlocks=[]
  for(const tzId of tzIds)makeVTimezone(tzId).forEach(l=>vtBlocks.push(l))
  return [...lines.slice(0,insertAt),...vtBlocks,...lines.slice(insertAt)]
}

// ─── Trip banner (all-day, no timezone needed) ────────────────────────────────

function tripBannerLines(trip) {
  if (!trip?.start_date || !trip?.end_date) return []
  const startVal = toDateValue(trip.start_date)
  const endVal   = nextDay(toDateValue(trip.end_date))
  const emoji    = trip.cover_emoji ? `${trip.cover_emoji} ` : '✈️ '
  const desc     = [
    trip.destination ? `Destination: ${trip.destination}` : null,
    `${trip.start_date} – ${trip.end_date}`,
  ].filter(Boolean).join('\n')

  return [
    'BEGIN:VEVENT',
    `UID:trip-banner-${trip.id || makeUID()}`,
    `DTSTAMP:${nowUTC()}`,
    `SUMMARY:${escapeICS(`${emoji}${trip.name}`)}`,
    `DTSTART;VALUE=DATE:${startVal}`,
    `DTEND;VALUE=DATE:${endVal}`,
    trip.destination ? `LOCATION:${escapeICS(trip.destination)}` : null,
    `DESCRIPTION:${escapeICS(desc)}`,
    'END:VEVENT',
  ].filter(Boolean)
}

// ─── Itinerary event → VEVENT lines ──────────────────────────────────────────
// event.time / event.end_time: 'HH:mm'
// event.timezone: IANA string (e.g. 'Europe/London') — falls back to trip.timezone or UTC

function eventLines(event, tripTimezone) {
  const tz = event.timezone || tripTimezone || 'UTC'

  const lines = [
    'BEGIN:VEVENT',
    `UID:event-${event.id}`,
    `DTSTAMP:${nowUTC()}`,
    `SUMMARY:${escapeICS(event.title)}`,
  ]

  if (event.time) {
    // Timed event
    const { prop, dtendProp, value } = toTZDateTime(event.date, event.time, tz)
    lines.push(`DTSTART;TZID=${tz}:${value}`)

    if (event.end_time) {
      const endVal = toTZDateTime(event.date, event.end_time, tz).value
      lines.push(`DTEND;TZID=${tz}:${endVal}`)
    } else {
      // Default 1-hour duration
      const [h, min] = event.time.split(':').map(Number)
      const [y, m, d] = event.date.split('-')
      lines.push(`DTEND;TZID=${tz}:${y}${m}${d}T${pad(h + 1)}${pad(min)}00`)
    }
  } else {
    // All-day event
    const val = toDateValue(event.date)
    lines.push(`DTSTART;VALUE=DATE:${val}`)
    lines.push(`DTEND;VALUE=DATE:${nextDay(val)}`)
  }

  if (event.location) lines.push(`LOCATION:${escapeICS(event.location)}`)
  if (event.notes)    lines.push(`DESCRIPTION:${escapeICS(event.notes)}`)
  lines.push('END:VEVENT')
  return lines
}

// ─── Travel leg → VEVENT lines ────────────────────────────────────────────────
// leg.depart_at / leg.arrive_at: datetime-local string 'yyyy-MM-ddTHH:mm'
// leg.depart_tz / leg.arrive_tz: IANA timezone strings

const TRANSPORT_LABELS = { flight:'Flight', train:'Train', bus:'Bus', car:'Car', ferry:'Ferry', subway:'Subway', taxi:'Taxi', walk:'Walk', other:'Journey' }
const TRANSPORT_ICONS  = { flight:'✈️', train:'🚂', bus:'🚌', car:'🚗', ferry:'⛴️', subway:'🚇', taxi:'🚕', walk:'🚶', other:'🛸' }

// `leg` is the normalized shape from src/lib/travel.js: includes traveler_names,
// _source ('shared'|'legacy'), and either _docId or _legacyDocId/_legacyIdx.
function legLines(leg) {
  const icon      = TRANSPORT_ICONS[leg.transport] || '🛸'
  const label     = TRANSPORT_LABELS[leg.transport] || 'Journey'
  const ref       = leg.number || label
  const route     = [leg.from, leg.to].filter(Boolean).join(' → ')
  const names     = leg.traveler_names || []
  const firstNames = names.map(n => n.split(' ')[0])
  const whoShort  = firstNames.length === 0 ? 'Traveler'
                   : firstNames.length === 1 ? firstNames[0]
                   : firstNames.length === 2 ? firstNames.join(' & ')
                   : `${firstNames[0]} +${firstNames.length - 1}`
  const summary   = `${icon} ${ref} · ${whoShort}${route ? ': ' + route : ''}`

  const departTZ = leg.depart_tz || 'UTC'
  const arriveTZ = leg.arrive_tz || leg.depart_tz || 'UTC'

  const depDT = isoLocalToTZ(leg.depart_at, departTZ)
  const arrDT = isoLocalToTZ(leg.arrive_at, arriveTZ)

  if (!depDT) return []

  const uid = leg._source === 'legacy'
    ? `leg-${leg._legacyDocId}-${leg._legacyIdx}`
    : `leg-${leg._docId || Math.random().toString(36).slice(2)}`

  const descParts = [
    names.length > 0 ? `Traveler${names.length > 1 ? 's' : ''}: ${names.join(', ')}` : null,
    leg.notes ? `Notes: ${leg.notes}` : null,
  ].filter(Boolean)

  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${nowUTC()}`,
    `SUMMARY:${escapeICS(summary)}`,
    `DTSTART;TZID=${departTZ}:${depDT.value}`,
    arrDT
      ? `DTEND;TZID=${arriveTZ}:${arrDT.value}`
      : `DTEND;TZID=${departTZ}:${depDT.value}`,
    leg.from ? `LOCATION:${escapeICS(leg.from)}` : null,
    `DESCRIPTION:${escapeICS(descParts.join('\n'))}`,
    'END:VEVENT',
  ].filter(Boolean)
}

// Pick check-in/out dates with this priority:
//   1. Explicit accom.check_in/check_out (new shared shape)
//   2. Inferred from `relatedLegs` arrival/departure (legacy: arrival of first leg → departure of last)
function pickAccomDates(accom, relatedLegs = []) {
  if (accom.check_in) {
    return { checkIn: accom.check_in, checkOut: accom.check_out || null }
  }
  if (!relatedLegs.length) return { checkIn: null, checkOut: null }
  const arrDates = relatedLegs
    .map(l => isoLocalToTZ(l.arrive_at, l.arrive_tz || l.depart_tz)?.date)
    .filter(Boolean).sort()
  const depDates = relatedLegs
    .map(l => isoLocalToTZ(l.depart_at, l.depart_tz)?.date)
    .filter(Boolean).sort()
  return {
    checkIn: arrDates[0] || null,
    checkOut: depDates[depDates.length - 1] || null,
  }
}

function accommodationLines(accom, relatedLegs = []) {
  if (!accom.name && !accom.address) return []
  const accomName    = accom.name || 'Accommodation'
  const accomAddress = accom.address || ''
  const names        = accom.traveler_names || []
  const firstNames   = names.map(n => n.split(' ')[0])
  const whoShort     = firstNames.length === 0 ? 'Traveler'
                      : firstNames.length === 1 ? firstNames[0]
                      : firstNames.length === 2 ? firstNames.join(' & ')
                      : `${firstNames[0]} +${firstNames.length - 1}`
  const summary      = `🏨 ${accomName} · ${whoShort}`

  const { checkIn, checkOut } = pickAccomDates(accom, relatedLegs)
  if (!checkIn) return []

  const startVal = toDateValue(checkIn)
  const endVal   = (checkOut && checkOut !== checkIn)
    ? toDateValue(checkOut)
    : nextDay(startVal)

  const uid = accom._source === 'legacy'
    ? `accom-${accom._legacyDocId}`
    : `accom-${accom._docId || Math.random().toString(36).slice(2)}`

  const desc = [
    names.length > 0 ? `Traveler${names.length > 1 ? 's' : ''}: ${names.join(', ')}` : null,
    accom.notes ? `Notes: ${accom.notes}` : null,
  ].filter(Boolean).join('\n')

  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${nowUTC()}`,
    `SUMMARY:${escapeICS(summary)}`,
    `DTSTART;VALUE=DATE:${startVal}`,
    `DTEND;VALUE=DATE:${endVal}`,
    accomAddress ? `LOCATION:${escapeICS(accomAddress)}` : null,
    `DESCRIPTION:${escapeICS(desc)}`,
    'END:VEVENT',
  ].filter(Boolean)
}

// For each accommodation, find legs that share at least one traveler with it.
// This is used as a fallback when an accom has no explicit check_in/check_out
// (legacy data) — we still derive dates from the traveler's flights.
function relatedLegsFor(accom, allLegs) {
  const ids = new Set(accom.traveler_ids || [])
  if (!ids.size) return []
  return allLegs.filter(l => (l.traveler_ids || []).some(id => ids.has(id)))
}

// ─── Public generate functions ────────────────────────────────────────────────

export function generateICS(events, calName, trip) {
  const lines = icsHeader(calName, trip?.timezone || null)
  tripBannerLines(trip).forEach(l => lines.push(l))
  const tz = trip?.timezone || 'UTC'
  for (const event of events) {
    eventLines(event, tz).forEach(l => lines.push(l))
  }
  lines.push('END:VCALENDAR')
  return injectVTimezones(lines).join('\r\n')
}

// New signature: takes already-normalized legs and accommodations.
// Callers should use src/lib/travel.js to merge legacy + shared shapes first.
export function generateTravelICS({ legs = [], accommodations = [], trip }) {
  const lines = icsHeader(`${trip?.name || 'Trip'} – Travel`, trip?.timezone || null)
  tripBannerLines(trip).forEach(l => lines.push(l))

  for (const leg of legs) {
    legLines(leg).forEach(l => lines.push(l))
  }
  for (const accom of accommodations) {
    const related = relatedLegsFor(accom, legs)
    accommodationLines(accom, related).forEach(l => lines.push(l))
  }

  lines.push('END:VCALENDAR')
  return injectVTimezones(lines).join('\r\n')
}

export function generateCombinedICS({ events = [], legs = [], accommodations = [], trip }) {
  const lines = icsHeader(`${trip?.name || 'Trip'} – Full Trip`, trip?.timezone || null)
  tripBannerLines(trip).forEach(l => lines.push(l))

  const tz = trip?.timezone || 'UTC'
  for (const event of events) {
    eventLines(event, tz).forEach(l => lines.push(l))
  }
  for (const leg of legs) {
    legLines(leg).forEach(l => lines.push(l))
  }
  for (const accom of accommodations) {
    const related = relatedLegsFor(accom, legs)
    accommodationLines(accom, related).forEach(l => lines.push(l))
  }

  lines.push('END:VCALENDAR')
  return injectVTimezones(lines).join('\r\n')
}

// ─── Download helpers ─────────────────────────────────────────────────────────

export function downloadICS(events, calName, trip) {
  triggerDownload(generateICS(events, calName, trip), calName)
}

export function downloadTravelICS({ legs, accommodations, trip }) {
  triggerDownload(
    generateTravelICS({ legs, accommodations, trip }),
    `${trip?.name || 'Trip'} – Travel`
  )
}

export function downloadCombinedICS({ events, legs, accommodations, trip }) {
  triggerDownload(
    generateCombinedICS({ events, legs, accommodations, trip }),
    `${trip?.name || 'Trip'} – Full Trip`
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