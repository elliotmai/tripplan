const functions  = require('firebase-functions')
const admin      = require('firebase-admin')

admin.initializeApp()

// ─── ICS helpers — timezone-aware ────────────────────────────────────────────

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

// UTC timestamp for DTSTAMP
function nowUTC() {
  const d = new Date()
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

// 'yyyy-MM-dd' → 'yyyyMMdd'
function toDateValue(dateStr) {
  const [y, m, d] = dateStr.split('-')
  return `${y}${m}${d}`
}

// Increment yyyyMMdd by 1 day
function nextDay(icsDate) {
  const y    = parseInt(icsDate.slice(0, 4))
  const m    = parseInt(icsDate.slice(4, 6)) - 1
  const d    = parseInt(icsDate.slice(6, 8))
  const next = new Date(y, m, d + 1)
  return `${next.getFullYear()}${pad(next.getMonth()+1)}${pad(next.getDate())}`
}

// Convert HH:mm + yyyy-MM-dd + IANA tz → ICS local datetime string
function toTZValue(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-')
  const [h, min]  = (timeStr || '00:00').split(':')
  return `${y}${m}${d}T${pad(Number(h))}${pad(Number(min))}00`
}

// Convert datetime-local string 'yyyy-MM-ddTHH:mm' → ICS local datetime string
function isoLocalToValue(isoLocal) {
  if (!isoLocal) return null
  const clean    = isoLocal.slice(0, 16)
  const [dt, tm] = clean.split('T')
  const [y,m,d]  = dt.split('-')
  const [h, min] = tm.split(':')
  return `${y}${m}${d}T${pad(Number(h))}${pad(Number(min))}00`
}

// Get date part 'yyyy-MM-dd' from a datetime-local string
function isoLocalToDate(isoLocal) {
  return isoLocal?.slice(0, 10) || null
}

function formatDTReadable(isoLocal, tzId) {
  if (!isoLocal) return ''
  try {
    return new Date(isoLocal).toLocaleString('en-US', {
      timeZone:     tzId || undefined,
      month:        'short', day: 'numeric', year: 'numeric',
      hour:         '2-digit', minute: '2-digit',
      timeZoneName: 'short',
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
// Google Calendar requires a VTIMEZONE block for every TZID used in the file.
// We generate one dynamically using the Intl API.

function getOffsetMinutes(date, tzId) {
  const utcStr   = date.toLocaleString('en-US', { timeZone: 'UTC', hour12: false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
  const localStr = date.toLocaleString('en-US', { timeZone: tzId,  hour12: false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
  return (parseLocaleStr(localStr) - parseLocaleStr(utcStr)) / 60000
}
function parseLocaleStr(s) {
  const [date, time] = s.split(', ')
  const [m, d, y] = date.split('/')
  const [h, min] = time.split(':')
  return Date.UTC(+y, +m-1, +d, +h === 24 ? 0 : +h, +min)
}
function formatTZOffset(minutes) {
  const sign = minutes >= 0 ? '+' : '-'
  const abs  = Math.abs(minutes)
  return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`
}
function tzAbbr(tzId, date) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tzId, timeZoneName: 'short' })
      .formatToParts(date).find(p => p.type === 'timeZoneName')?.value || tzId.split('/').pop()
  } catch { return tzId.split('/').pop() }
}
function findTZTransition(year, tzId, fromStdToDst) {
  let prevOffset = null
  for (let month = 0; month < 12; month++) {
    for (let day = 1; day <= 31; day++) {
      const d = new Date(Date.UTC(year, month, day, 2, 0))
      if (isNaN(d)) continue
      const offset = getOffsetMinutes(d, tzId)
      if (prevOffset !== null && offset !== prevOffset) {
        if (fromStdToDst === (offset > prevOffset)) return d
      }
      prevOffset = offset
    }
  }
  return new Date(Date.UTC(year, 3, 1, 2, 0))
}
function localDTStr(date, tzId) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tzId, year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: false,
    })
    const parts = fmt.formatToParts(date)
    const get = t => parts.find(p => p.type === t)?.value || '00'
    const h = get('hour') === '24' ? '00' : get('hour')
    return `${get('year')}${get('month')}${get('day')}T${h}${get('minute')}${get('second')}`
  } catch { return '19700101T020000' }
}
function makeVTimezone(tzId) {
  if (!tzId || tzId === 'UTC') return []
  try {
    const jan = new Date(Date.UTC(2024, 0, 15))
    const jul = new Date(Date.UTC(2024, 6, 15))
    const offsetJan = getOffsetMinutes(jan, tzId)
    const offsetJul = getOffsetMinutes(jul, tzId)
    const stdOffset = Math.min(offsetJan, offsetJul)
    const dstOffset = Math.max(offsetJan, offsetJul)
    if (offsetJan === offsetJul) {
      return [
        'BEGIN:VTIMEZONE', `TZID:${tzId}`,
        'BEGIN:STANDARD', 'DTSTART:19700101T000000',
        `TZOFFSETFROM:${formatTZOffset(stdOffset)}`, `TZOFFSETTO:${formatTZOffset(stdOffset)}`,
        `TZNAME:${tzAbbr(tzId, jan)}`, 'END:STANDARD', 'END:VTIMEZONE',
      ]
    }
    const spring = findTZTransition(2024, tzId, true)
    const fall   = findTZTransition(2024, tzId, false)
    return [
      'BEGIN:VTIMEZONE', `TZID:${tzId}`,
      'BEGIN:DAYLIGHT', `DTSTART:${localDTStr(spring, tzId)}`,
      `TZOFFSETFROM:${formatTZOffset(stdOffset)}`, `TZOFFSETTO:${formatTZOffset(dstOffset)}`,
      `TZNAME:${tzAbbr(tzId, jul)}`, 'RRULE:FREQ=YEARLY', 'END:DAYLIGHT',
      'BEGIN:STANDARD', `DTSTART:${localDTStr(fall, tzId)}`,
      `TZOFFSETFROM:${formatTZOffset(dstOffset)}`, `TZOFFSETTO:${formatTZOffset(stdOffset)}`,
      `TZNAME:${tzAbbr(tzId, jan)}`, 'RRULE:FREQ=YEARLY', 'END:STANDARD',
      'END:VTIMEZONE',
    ]
  } catch { return [] }
}

// Collect all unique non-UTC timezones from a list of VEVENT lines
// and inject VTIMEZONE blocks after the calendar header lines
function injectVTimezones(lines) {
  // Find all TZID values used
  const tzIds = new Set()
  for (const line of lines) {
    const m = line.match(/TZID=([^:]+):/)
    if (m && m[1] !== 'UTC') tzIds.add(m[1])
  }
  if (!tzIds.size) return lines

  // Find insertion point — after last header line (before first BEGIN:VEVENT)
  const insertAt = lines.findIndex(l => l === 'BEGIN:VEVENT')
  if (insertAt === -1) return lines

  const vtBlocks = []
  for (const tzId of tzIds) {
    makeVTimezone(tzId).forEach(l => vtBlocks.push(l))
  }

  return [
    ...lines.slice(0, insertAt),
    ...vtBlocks,
    ...lines.slice(insertAt),
  ]
}

// ─── Trip banner (all-day) ────────────────────────────────────────────────────

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
    `UID:trip-banner-${trip.id}`,
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

function eventLines(event, tripTimezone) {
  const tz = event.timezone || tripTimezone || 'UTC'

  const lines = [
    'BEGIN:VEVENT',
    `UID:event-${event.id}`,
    `DTSTAMP:${nowUTC()}`,
    `SUMMARY:${escapeICS(event.title)}`,
  ]

  if (event.time) {
    const val = toTZValue(event.date, event.time)
    lines.push(`DTSTART;TZID=${tz}:${val}`)
    if (event.end_time) {
      lines.push(`DTEND;TZID=${tz}:${toTZValue(event.date, event.end_time)}`)
    } else {
      // default 1-hour duration
      const [h, min] = event.time.split(':').map(Number)
      const [y, m, d] = event.date.split('-')
      lines.push(`DTEND;TZID=${tz}:${y}${m}${d}T${pad(h + 1)}${pad(min)}00`)
    }
  } else {
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

const TRANSPORT_LABELS = { flight:'Flight', train:'Train', bus:'Bus', car:'Car', ferry:'Ferry', subway:'Subway', taxi:'Taxi', walk:'Walk', other:'Journey' }
const TRANSPORT_ICONS  = { flight:'✈️', train:'🚂', bus:'🚌', car:'🚗', ferry:'⛴️', subway:'🚇', taxi:'🚕', walk:'🚶', other:'🛸' }

function shortWho(names) {
  const firstNames = names.map(n => n.split(' ')[0])
  if (firstNames.length === 0) return 'Traveler'
  if (firstNames.length === 1) return firstNames[0]
  if (firstNames.length === 2) return firstNames.join(' & ')
  return `${firstNames[0]} +${firstNames.length - 1}`
}

// `leg` is normalized: { transport, number, from, to, depart_at, arrive_at,
// depart_tz, arrive_tz, notes, traveler_names, _source, _docId | _legacyDocId, _legacyIdx }
function legLines(leg) {
  const icon      = TRANSPORT_ICONS[leg.transport] || '🛸'
  const label     = TRANSPORT_LABELS[leg.transport] || 'Journey'
  const ref       = leg.number || label
  const route     = [leg.from, leg.to].filter(Boolean).join(' → ')
  const names     = leg.traveler_names || []
  const summary   = `${icon} ${ref} · ${shortWho(names)}${route ? ': ' + route : ''}`

  const departTZ = leg.depart_tz || 'UTC'
  const arriveTZ = leg.arrive_tz || leg.depart_tz || 'UTC'

  const depVal = isoLocalToValue(leg.depart_at)
  const arrVal = isoLocalToValue(leg.arrive_at)

  if (!depVal) return []

  const uid = leg._source === 'legacy'
    ? `leg-${leg._legacyDocId}-${leg._legacyIdx}`
    : `leg-${leg._docId}`

  const descParts = [
    names.length ? `Traveler${names.length > 1 ? 's' : ''}: ${names.join(', ')}` : null,
    leg.number    ? `${label} number: ${leg.number}` : null,
    leg.from      ? `From: ${leg.from}` : null,
    leg.to        ? `To: ${leg.to}` : null,
    leg.depart_at ? `Departs: ${formatDTReadable(leg.depart_at, departTZ)}` : null,
    leg.arrive_at ? `Arrives: ${formatDTReadable(leg.arrive_at, arriveTZ)}` : null,
    leg.notes     ? `Notes: ${leg.notes}` : null,
  ].filter(Boolean)

  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${nowUTC()}`,
    `SUMMARY:${escapeICS(summary)}`,
    `DTSTART;TZID=${departTZ}:${depVal}`,
    arrVal ? `DTEND;TZID=${arriveTZ}:${arrVal}` : `DTEND;TZID=${departTZ}:${depVal}`,
    leg.from ? `LOCATION:${escapeICS(leg.from)}` : null,
    `DESCRIPTION:${escapeICS(descParts.join('\n'))}`,
    'END:VEVENT',
  ].filter(Boolean)
}

function pickAccomDates(accom, relatedLegs) {
  if (accom.check_in) {
    return { checkIn: accom.check_in, checkOut: accom.check_out || null }
  }
  if (!relatedLegs.length) return { checkIn: null, checkOut: null }
  const arrDates = relatedLegs.map(l => isoLocalToDate(l.arrive_at)).filter(Boolean).sort()
  const depDates = relatedLegs.map(l => isoLocalToDate(l.depart_at)).filter(Boolean).sort()
  return {
    checkIn: arrDates[0] || null,
    checkOut: depDates[depDates.length - 1] || null,
  }
}

function relatedLegsFor(accom, allLegs) {
  const ids = new Set(accom.traveler_ids || [])
  if (!ids.size) return []
  return allLegs.filter(l => (l.traveler_ids || []).some(id => ids.has(id)))
}

// `accom` is normalized: { name, address, check_in, check_out, notes,
// traveler_ids, traveler_names, _source, _docId | _legacyDocId }
function accommodationLines(accom, allLegs) {
  if (!accom.name && !accom.address) return []
  const accomName    = accom.name || 'Accommodation'
  const accomAddress = accom.address || ''
  const names        = accom.traveler_names || []

  const { checkIn, checkOut } = pickAccomDates(accom, relatedLegsFor(accom, allLegs))
  if (!checkIn) return []

  const startVal = toDateValue(checkIn)
  const endVal   = (checkOut && checkOut !== checkIn) ? toDateValue(checkOut) : nextDay(startVal)

  const uid = accom._source === 'legacy'
    ? `accom-${accom._legacyDocId}`
    : `accom-${accom._docId}`

  const desc = [
    names.length ? `Traveler${names.length > 1 ? 's' : ''}: ${names.join(', ')}` : null,
    accomAddress ? `Address: ${accomAddress}` : null,
    accom.notes  ? `Notes: ${accom.notes}` : null,
  ].filter(Boolean).join('\n')

  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${nowUTC()}`,
    `SUMMARY:${escapeICS(`🏨 ${accomName} · ${shortWho(names)}`)}`,
    `DTSTART;VALUE=DATE:${startVal}`,
    `DTEND;VALUE=DATE:${endVal}`,
    accomAddress ? `LOCATION:${escapeICS(accomAddress)}` : null,
    `DESCRIPTION:${escapeICS(desc)}`,
    'END:VEVENT',
  ].filter(Boolean)
}

// Merge legacy travel_details + new trip_legs/trip_accommodations into one
// normalized list each, the same shape the client uses.
function buildNormalizedTravel(legacyDetails, sharedLegs, sharedAccoms, members) {
  const memberById = Object.fromEntries(members.map(m => [m.id, m]))
  const namesFor = (ids) => (ids || []).map(id => memberById[id]?.full_name).filter(Boolean)

  const legs = []
  for (const detail of legacyDetails) {
    ;(detail.legs || []).forEach((leg, idx) => {
      legs.push({
        ...leg,
        _source: 'legacy',
        _legacyDocId: detail.id,
        _legacyIdx: idx,
        traveler_ids: [detail.user_id],
        traveler_names: namesFor([detail.user_id]),
      })
    })
  }
  for (const leg of sharedLegs) {
    legs.push({
      ...leg,
      _source: 'shared',
      _docId: leg.id,
      traveler_names: namesFor(leg.traveler_ids),
    })
  }

  const accoms = []
  for (const detail of legacyDetails) {
    if (detail.accommodation || detail.accommodation_address) {
      accoms.push({
        name: detail.accommodation || '',
        address: detail.accommodation_address || '',
        check_in: '',
        check_out: '',
        notes: detail.notes || '',
        _source: 'legacy',
        _legacyDocId: detail.id,
        traveler_ids: [detail.user_id],
        traveler_names: namesFor([detail.user_id]),
      })
    }
  }
  for (const accom of sharedAccoms) {
    accoms.push({
      ...accom,
      _source: 'shared',
      _docId: accom.id,
      traveler_ids: accom.traveler_ids || [],
      traveler_names: namesFor(accom.traveler_ids),
    })
  }

  return { legs, accoms }
}

// ─── ICS builders ─────────────────────────────────────────────────────────────

function buildItineraryICS(trip, events) {
  const lines = icsHeader(trip.name, trip.timezone || null)
  tripBannerLines(trip).forEach(l => lines.push(l))
  const tz = trip.timezone || 'UTC'
  for (const event of events) {
    eventLines(event, tz).forEach(l => lines.push(l))
  }
  lines.push('END:VCALENDAR')
  return injectVTimezones(lines).join('\r\n')
}

function buildTravelICS(trip, normalizedLegs, normalizedAccoms) {
  const lines = icsHeader(`${trip.name} – Travel`, trip.timezone || null)
  tripBannerLines(trip).forEach(l => lines.push(l))
  for (const leg of normalizedLegs) {
    legLines(leg).forEach(l => lines.push(l))
  }
  for (const accom of normalizedAccoms) {
    accommodationLines(accom, normalizedLegs).forEach(l => lines.push(l))
  }
  lines.push('END:VCALENDAR')
  return injectVTimezones(lines).join('\r\n')
}

function buildCombinedICS(trip, events, normalizedLegs, normalizedAccoms) {
  const lines = icsHeader(`${trip.name} – Full Trip`, trip.timezone || null)
  tripBannerLines(trip).forEach(l => lines.push(l))
  const tz = trip.timezone || 'UTC'
  for (const event of events) {
    eventLines(event, tz).forEach(l => lines.push(l))
  }
  for (const leg of normalizedLegs) {
    legLines(leg).forEach(l => lines.push(l))
  }
  for (const accom of normalizedAccoms) {
    accommodationLines(accom, normalizedLegs).forEach(l => lines.push(l))
  }
  lines.push('END:VCALENDAR')
  return injectVTimezones(lines).join('\r\n')
}

// ─── Subscription filter helpers ──────────────────────────────────────────────
// `filter` shape (all optional, defaults preserve existing behaviour):
//   traveler_ids:             array | null    null = include all travelers
//   include_transport_events: boolean         default true
//   only_my_events:           boolean         default false
// `ownerId` is the user_id of the token's creator — used for `only_my_events`.

function filterTravelersOnLegs(legs, travelerIds) {
  if (travelerIds == null) return legs
  const set = new Set(travelerIds)
  if (!set.size) return []
  return legs.filter(l => (l.traveler_ids || []).some(id => set.has(id)))
}

function filterTravelersOnAccoms(accoms, travelerIds) {
  if (travelerIds == null) return accoms
  const set = new Set(travelerIds)
  if (!set.size) return []
  return accoms.filter(a => (a.traveler_ids || []).some(id => set.has(id)))
}

function filterEvents(events, filter, ownerId) {
  return events.filter(e => {
    if (filter.include_transport_events === false && e.type === 'transport') return false
    if (filter.only_my_events && ownerId) {
      const a = e.assigned_to
      // assigned_to encodings: ['__all__'] = everyone, [] / null = unassigned, [...] = list
      if (Array.isArray(a) && a[0] === '__all__') return true
      if (typeof a === 'string') return a === ownerId
      if (!a || (Array.isArray(a) && a.length === 0)) return false
      return Array.isArray(a) && a.includes(ownerId)
    }
    return true
  })
}

// ─── Cloud Function ───────────────────────────────────────────────────────────

const db = admin.firestore()

exports.calendarFeed = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET')
    res.set('Access-Control-Max-Age', '3600')
    return res.status(204).send('')
  }

  const { token, type = 'itinerary' } = req.query
  if (!token) return res.status(400).send('Missing token')

  const tokenSnap = await db.collection('calendar_tokens').doc(token).get()
  if (!tokenSnap.exists) return res.status(403).send('Invalid or expired token')

  const tokenData = tokenSnap.data()
  const { trip_id, created_by: ownerId } = tokenData
  const filter = tokenData.filter || {}

  const tripSnap = await db.collection('trips').doc(trip_id).get()
  if (!tripSnap.exists) return res.status(404).send('Trip not found')
  const trip = { id: tripSnap.id, ...tripSnap.data() }

  let icsContent

  if (type === 'travel' || type === 'combined') {
    const [detailsSnap, legsSnap, accomsSnap, membersSnap] = await Promise.all([
      db.collection('travel_details').where('trip_id', '==', trip_id).get(),
      db.collection('trip_legs').where('trip_id', '==', trip_id).get(),
      db.collection('trip_accommodations').where('trip_id', '==', trip_id).get(),
      db.collection('trip_members').where('trip_id', '==', trip_id).get(),
    ])
    const travelDetails = detailsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const sharedLegs    = legsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const sharedAccoms  = accomsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const profileIds    = membersSnap.docs.map(d => d.data().user_id)
    const profiles      = await Promise.all(profileIds.map(uid => db.collection('profiles').doc(uid).get()))
    const members       = profiles.filter(s => s.exists).map(s => ({ id: s.id, ...s.data() }))

    let { legs, accoms } = buildNormalizedTravel(travelDetails, sharedLegs, sharedAccoms, members)
    legs   = filterTravelersOnLegs(legs, filter.traveler_ids)
    accoms = filterTravelersOnAccoms(accoms, filter.traveler_ids)

    if (type === 'combined') {
      const eventsSnap = await db.collection('itinerary_events')
        .where('trip_id', '==', trip_id).orderBy('time', 'asc').get()
      const allEvents = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const events = filterEvents(allEvents, filter, ownerId)
      icsContent = buildCombinedICS(trip, events, legs, accoms)
    } else {
      icsContent = buildTravelICS(trip, legs, accoms)
    }
  } else {
    const eventsSnap = await db.collection('itinerary_events')
      .where('trip_id', '==', trip_id).orderBy('time', 'asc').get()
    const allEvents = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const events = filterEvents(allEvents, filter, ownerId)
    icsContent = buildItineraryICS(trip, events)
  }

  const filename = `${trip.name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_]/g, '').toLowerCase()}-${type}.ics`

  res.set('Content-Type', 'text/calendar; charset=utf-8')
  res.set('Content-Disposition', `attachment; filename="${filename}"`)
  res.set('Cache-Control', 'public, max-age=3600')
  res.send(icsContent)
})