// Unified read layer for trip travel data.
//
// Two shapes coexist:
//
//   Legacy (per-user):
//     travel_details/{docId} = { trip_id, user_id, legs: [...], accommodation, accommodation_address, notes }
//
//   New (shared, multi-traveler):
//     trip_legs/{docId}            = { trip_id, traveler_ids: [], transport, number, from, to,
//                                      depart_at, arrive_at, depart_tz, arrive_tz, notes, created_by }
//     trip_accommodations/{docId}  = { trip_id, traveler_ids: [], name, address, check_in,
//                                      check_out, notes, created_by }
//
// Helpers below produce a single normalized list of legs / accommodations from both
// shapes, each entry tagged with its source so callers can route edits/deletes.

const LEGACY = 'legacy'
const SHARED = 'shared'

function namesFromIds(ids, memberById) {
  return (ids || []).map(id => memberById[id]?.full_name).filter(Boolean)
}

export function normalizeLegs({ legacyDetails = [], sharedLegs = [], members = [] }) {
  const memberById = Object.fromEntries(members.map(m => [m.id, m]))
  const out = []

  for (const detail of legacyDetails) {
    ;(detail.legs || []).forEach((leg, idx) => {
      out.push({
        ...leg,
        _source: LEGACY,
        _legacyDocId: detail._docId,
        _legacyOwnerId: detail.user_id,
        _legacyIdx: idx,
        traveler_ids: [detail.user_id],
        traveler_names: namesFromIds([detail.user_id], memberById),
      })
    })
  }

  for (const leg of sharedLegs) {
    out.push({
      ...leg,
      _source: SHARED,
      _docId: leg.id,
      traveler_names: namesFromIds(leg.traveler_ids, memberById),
    })
  }

  return out
}

export function normalizeAccommodations({ legacyDetails = [], sharedAccoms = [], members = [] }) {
  const memberById = Object.fromEntries(members.map(m => [m.id, m]))
  const out = []

  for (const detail of legacyDetails) {
    if (detail.accommodation || detail.accommodation_address) {
      out.push({
        name: detail.accommodation || '',
        address: detail.accommodation_address || '',
        check_in: '',
        check_out: '',
        notes: detail.notes || '',
        _source: LEGACY,
        _legacyDocId: detail._docId,
        _legacyOwnerId: detail.user_id,
        traveler_ids: [detail.user_id],
        traveler_names: namesFromIds([detail.user_id], memberById),
      })
    }
  }

  for (const accom of sharedAccoms) {
    out.push({
      name: accom.name || '',
      address: accom.address || '',
      check_in: accom.check_in || '',
      check_out: accom.check_out || '',
      notes: accom.notes || '',
      created_by: accom.created_by,
      _source: SHARED,
      _docId: accom.id,
      traveler_ids: accom.traveler_ids || [],
      traveler_names: namesFromIds(accom.traveler_ids, memberById),
    })
  }

  return out
}

export function legsForMember(allLegs, memberId) {
  return allLegs.filter(l => l.traveler_ids?.includes(memberId))
}

export function accomsForMember(allAccoms, memberId) {
  return allAccoms.filter(a => a.traveler_ids?.includes(memberId))
}

// Members who have any travel data (either shape).
export function membersWithTravel(members, allLegs, allAccoms) {
  return members.filter(m =>
    allLegs.some(l => l.traveler_ids?.includes(m.id)) ||
    allAccoms.some(a => a.traveler_ids?.includes(m.id))
  )
}

export const SOURCES = { LEGACY, SHARED }
