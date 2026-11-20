import { getFirestore } from './store'

/*
 * Wander used to live in Firebase. Its data is now in Hive's Supabase project
 * (./store.js answers the Firestore calls the screens make) and you sign in
 * with your Hive account (../contexts/AuthContext.jsx). `db` is kept so the
 * screens' collection(db, …) calls read as before.
 */
export const db = getFirestore()

// Ask the browser to treat this origin's storage as persistent, so an
// installed Android PWA isn't evicted and signed out (see #7).
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {})
}
