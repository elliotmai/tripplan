import {
  doc, setDoc, deleteDoc,
  collection, query, where, getDocs,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase'

// ─── Token shape in Firestore ─────────────────────────────────────────────────
// app_tokens/{token}
//   label:        string  — what the owner called the app, for the revoke list
//   created_by:   string (uid)
//   created_at:   timestamp
//   last_used_at: timestamp | null  — written by the Cloud Function
//
// Deliberately close to `calendar_tokens`, with one difference that matters:
// a calendar token names the single trip it feeds, so holding it is the whole
// check. An app token has no trip on it — it spans every trip its owner is on,
// so the Cloud Function checks membership per request. See `appTrips` in
// functions/index.js.

const FUNCTION_BASE = import.meta.env.VITE_FUNCTIONS_BASE_URL || ''

function randomToken() {
  // 32 hex chars, same as a feed token — unguessable and URL-safe.
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Mint a token for a named app.
 *
 * Returns the token itself, which is the only time it is ever available: the
 * list below shows the label and when it was last used, never the secret. A
 * list that redisplays it turns one leaked screenshot into standing access,
 * and there is nothing you can do with a shown token that re-minting does not
 * also do.
 */
export async function createAppToken(label, userId) {
  const token = randomToken()
  await setDoc(doc(db, 'app_tokens', token), {
    label: String(label || '').trim().slice(0, 60) || 'Untitled app',
    created_by: userId,
    created_at: serverTimestamp(),
    last_used_at: null,
  })
  return { token, base: FUNCTION_BASE }
}

/** Every token this user has minted, newest first. Without the secret. */
export async function listAppTokens(userId) {
  const snap = await getDocs(
    query(collection(db, 'app_tokens'), where('created_by', '==', userId)),
  )
  return snap.docs
    .map(d => ({
      id: d.id,
      label: d.data().label || 'Untitled app',
      created_at: d.data().created_at || null,
      last_used_at: d.data().last_used_at || null,
    }))
    .sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0))
}

/** Cut one app off. Takes effect on its next request — there is no session. */
export async function revokeAppToken(tokenId) {
  await deleteDoc(doc(db, 'app_tokens', tokenId))
}
