import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db   = getFirestore(app)

// Ask the browser to treat this origin's storage as persistent, so it isn't
// cleared under storage pressure. Firebase Auth's default web persistence
// (indexedDBLocalPersistence) already keeps a session signed in indefinitely,
// but on Android, Chrome can evict IndexedDB for installed PWAs that have
// sat idle for a while — silently wiping that stored session and forcing a
// re-login (see #7: users were getting signed out roughly every 24h on an
// installed Android PWA, never on iOS). This is a best-effort request with
// no behavioral side effects either way, so it's safe to fire on every load.
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {})
}
