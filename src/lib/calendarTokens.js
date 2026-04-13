import {
  doc, getDoc, setDoc, deleteDoc,
  collection, query, where, getDocs,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase'

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

  for (const type of ['itinerary', 'travel', 'combined']) {
    if (existing[type]) {
      result[type] = {
        token: existing[type].token,
        url:   feedUrl(existing[type].token, type),
      }
    } else {
      const token = randomToken()
      await setDoc(doc(db, 'calendar_tokens', token), {
        trip_id:    tripId,
        created_by: userId,
        type,
        created_at: serverTimestamp(),
      })
      result[type] = { token, url: feedUrl(token, type) }
    }
  }

  return result
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