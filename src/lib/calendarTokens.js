import {
  doc, getDoc, setDoc, deleteDoc, updateDoc,
  collection, query, where, getDocs,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase'

// Default filter when none is stored. `traveler_ids: null` means "all travelers".
export const DEFAULT_FEED_FILTER = {
  traveler_ids: null,
  include_transport_events: true,
  only_my_events: false,
}

// The Cloud Function base URL — set this after deploying.
// It will look like: https://REGION-PROJECT.cloudfunctions.net
// Or if using Firebase Hosting rewrites: just ''  (same origin)
const FUNCTION_BASE = import.meta.env.VITE_FUNCTIONS_BASE_URL || ''

// ─── Token shape in Firestore ─────────────────────────────────────────────────
// calendar_tokens/{token}
//   trip_id:    string
//   created_by: string (uid)
//   created_at: timestamp

function randomToken() {
  // 32 hex chars — unguessable but URL-safe
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Returns existing tokens for a trip (one per type), or creates them.
// Returns { itinerary: { token, url }, travel: { token, url } }
export async function getOrCreateFeedTokens(tripId, userId) {
  const snap = await getDocs(
    query(
      collection(db, 'calendar_tokens'),
      where('trip_id', '==', tripId),
      where('created_by', '==', userId)
    )
  )

  const existing = {}
  snap.docs.forEach(d => {
    const data = d.data()
    // Guard: skip tokens that were created before the type field was added
    if (data.type) existing[data.type] = { token: d.id, ...data }
  })

  const result = {}
  // Inherit filter from any existing token so all three stay in sync.
  let filter = null
  for (const t of ['combined', 'travel', 'itinerary']) {
    if (existing[t]?.filter) { filter = existing[t].filter; break }
  }

  for (const type of ['itinerary', 'travel', 'combined']) {
    if (existing[type]) {
      result[type] = {
        token: existing[type].token,
        url:   feedUrl(existing[type].token, type),
        filter: existing[type].filter || filter || { ...DEFAULT_FEED_FILTER },
      }
    } else {
      const token = randomToken()
      await setDoc(doc(db, 'calendar_tokens', token), {
        trip_id:    tripId,
        created_by: userId,
        type,
        filter: filter || { ...DEFAULT_FEED_FILTER },
        created_at: serverTimestamp(),
      })
      result[type] = { token, url: feedUrl(token, type), filter: filter || { ...DEFAULT_FEED_FILTER } }
    }
  }

  return result
}

// Update the filter on all of a user's tokens for a trip, so all 3 feed types
// stay in sync. Returns the updated filter object.
export async function updateFeedFilter(tripId, userId, filter) {
  const snap = await getDocs(
    query(
      collection(db, 'calendar_tokens'),
      where('trip_id', '==', tripId),
      where('created_by', '==', userId)
    )
  )
  await Promise.all(snap.docs.map(d => updateDoc(d.ref, { filter })))
  return filter
}

// Revoke all feed tokens for a trip (call when trip is deleted, or user wants to cut access)
export async function revokeFeedTokens(tripId, userId) {
  const snap = await getDocs(
    query(
      collection(db, 'calendar_tokens'),
      where('trip_id', '==', tripId),
      where('created_by', '==', userId)
    )
  )
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)))
}

function feedUrl(token, type) {
  return `${FUNCTION_BASE}/calendarFeed?token=${token}&type=${type}`
}