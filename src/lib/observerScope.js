// What an observer is allowed to see of a trip.
//
// Each trip_observers doc may carry a `scope`:
//
//   scope = {
//     travel: { mode, ids },   // legs + stays
//     events: { mode, ids },   // itinerary events
//   }
//
//   mode 'all'    → everything in that area
//   mode 'none'   → nothing
//   mode 'people' → items belonging to any of `ids` (traveller ids); follows
//                   new items as they're added
//   mode 'items'  → exactly the items whose keys are in `ids` (see legKey,
//                   stayKey; events use their doc id)
//
// A doc with no scope means all/all, so observers added before scopes existed
// keep seeing what they always saw. If several travellers each add the same
// observer, the observer sees the union of their scopes.
//
// Like the rest of the observer model this is a display filter, not access
// control: the Firestore rules still let any signed-in user read trip data.
// functions/index.js mirrors this logic for calendar feeds — keep them in step.

export const FULL_SCOPE = { travel: { mode: 'all', ids: [] }, events: { mode: 'all', ids: [] } }

export function normalizeScope(scope) {
  const area = a => ({
    mode: ['all', 'none', 'people', 'items'].includes(a?.mode) ? a.mode : 'all',
    ids: Array.isArray(a?.ids) ? a.ids : [],
  })
  return { travel: area(scope?.travel), events: area(scope?.events) }
}

const firstName = n => (n || '').split(' ')[0] || 'Unknown'

function listNames(ids, members) {
  const names = ids.map(id => firstName(members.find(m => m.id === id)?.full_name)).filter(Boolean)
  if (!names.length) return 'nobody'
  return names.length <= 2 ? names.join(' & ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`
}

// One line describing a scope, e.g. "All travel · Sam's events".
export function scopeSummary(rawScope, members) {
  const s = normalizeScope(rawScope)
  const part = (area, noun) => {
    if (area.mode === 'all') return `All ${noun}`
    if (area.mode === 'none') return `No ${noun}`
    if (area.mode === 'people') return `${listNames(area.ids, members)}’s ${noun}`
    return `${area.ids.length} picked ${noun}`
  }
  return `${part(s.travel, 'travel')} · ${part(s.events, 'events')}`
}

// Stable keys for travel items across both storage shapes (see lib/travel.js).
export function legKey(leg) {
  return leg._source === 'legacy'
    ? `legacy-leg:${leg._legacyDocId}:${leg._legacyIdx}`
    : `leg:${leg._docId || leg.id}`
}

export function stayKey(accom) {
  return accom._source === 'legacy'
    ? `legacy-stay:${accom._legacyDocId}`
    : `stay:${accom._docId || accom.id}`
}

function travelMatch(area, key, travelerIds) {
  switch (area.mode) {
    case 'all': return true
    case 'people': return (travelerIds || []).some(id => area.ids.includes(id))
    case 'items': return area.ids.includes(key)
    default: return false
  }
}

// assigned_to encodings: ['__all__'] = everyone, [] / null = unassigned,
// legacy string = one id, array = those ids.
function eventPeople(raw) {
  if (!raw) return []
  if (typeof raw === 'string') return [raw]
  return Array.isArray(raw) ? raw : []
}

function eventMatch(area, event) {
  switch (area.mode) {
    case 'all': return true
    case 'people': {
      const people = eventPeople(event.assigned_to)
      if (people[0] === '__all__') return area.ids.length > 0
      return people.some(id => area.ids.includes(id))
    }
    case 'items': return area.ids.includes(event.id)
    default: return false
  }
}

const any = (scopes, fn) => scopes.map(normalizeScope).some(fn)

export function canSeeEvent(scopes, event) {
  return any(scopes, s => eventMatch(s.events, event))
}

// Filter the raw travel data TripDetailPage loads, before any component
// normalizes it. Legacy travel_details docs keep only their visible legs and
// lose their stay fields if that stay isn't visible.
export function filterTravel({ travelDetails, sharedLegs, sharedAccoms }, scopes) {
  const legOk = (key, ids) => any(scopes, s => travelMatch(s.travel, key, ids))
  return {
    sharedLegs: sharedLegs.filter(l => legOk(`leg:${l.id}`, l.traveler_ids)),
    sharedAccoms: sharedAccoms.filter(a => legOk(`stay:${a.id}`, a.traveler_ids)),
    travelDetails: travelDetails.map(d => {
      const owner = [d.user_id]
      const legs = (d.legs || []).filter((_, i) => legOk(`legacy-leg:${d._docId}:${i}`, owner))
      const stayOk = legOk(`legacy-stay:${d._docId}`, owner)
      return stayOk
        ? { ...d, legs }
        : { ...d, legs, accommodation: '', accommodation_address: '', notes: '' }
    }),
  }
}
