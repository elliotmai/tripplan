import { doc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from './firebase'

// Keep a trip's travel in step with who is actually travelling.
//
// Shared legs and stays drop anyone not in `keepIds`; one left with no
// travellers is deleted. Legacy per-user travel_details docs belonging to
// someone not in `keepIds` are deleted when `deleteLegacy` is set (the rules
// only let the trip's creator or the doc's own user do that).
//
// Used both when a traveller is removed and on trip load, which cleans up
// travel left behind by removals made before this existed.
//
// Returns the travel with the same changes applied locally, so callers can
// show the cleaned-up state without waiting for a reload.
export async function pruneTravel({ keepIds, travel, deleteLegacy = false }) {
  const keep = new Set(keepIds)
  // An empty list means members failed to load, not that nobody is travelling.
  if (keep.size === 0) return travel

  const writes = []
  const prune = (coll, items) => items.flatMap(item => {
    const ids = item.traveler_ids || []
    const remaining = ids.filter(id => keep.has(id))
    if (remaining.length === ids.length) return [item]
    if (remaining.length === 0) {
      writes.push(deleteDoc(doc(db, coll, item.id)))
      return []
    }
    writes.push(updateDoc(doc(db, coll, item.id), { traveler_ids: remaining }))
    return [{ ...item, traveler_ids: remaining }]
  })

  const sharedLegs = prune('trip_legs', travel.sharedLegs || [])
  const sharedAccoms = prune('trip_accommodations', travel.sharedAccoms || [])

  let travelDetails = travel.travelDetails || []
  if (deleteLegacy) {
    const stale = travelDetails.filter(d => d._docId && !keep.has(d.user_id))
    stale.forEach(d => writes.push(deleteDoc(doc(db, 'travel_details', d._docId))))
    travelDetails = travelDetails.filter(d => !stale.includes(d))
  }

  await Promise.all(writes.map(w => w.catch(err => console.warn('pruneTravel:', err))))
  return { travelDetails, sharedLegs, sharedAccoms }
}
