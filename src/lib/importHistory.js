/* ── Bringing your trips over ──────────────────────────────────────────────
   Wander used to keep everything in Firebase (wander-f10b1). Once per person:
   open the old account (with the password just typed at sign-in, or Google,
   or the old password asked for), have Hive confirm it's yours, then copy the
   trips you were on — with everything in them and the profiles of the people
   on them — plus your friends and links. Everyone's old id becomes their new
   one as they arrive, so shared trips line up. Nothing is overwritten, so a
   second run copies nothing twice.                                          */
import { HIVE_ORIGIN, supabase, wander } from './supabase'
import { encode } from './timestamp'

const OLD = {
  apiKey: 'AIzaSyC1KnocB9ogDmH27IQbjDQe-exvGa8wzsQ',
  authDomain: 'wander-f10b1.firebaseapp.com',
  projectId: 'wander-f10b1',
  storageBucket: 'wander-f10b1.firebasestorage.app',
  messagingSenderId: '1055245629379',
  appId: '1:1055245629379:web:5564c1532f134566f22f76',
}

/** Collections that belong to a trip by their trip_id. */
const TRIP_COLLECTIONS = ['itinerary_events', 'travel_details', 'trip_legs', 'trip_accommodations', 'polls', 'poll_votes',
  'trip_observers', 'brainstorm_ideas', 'brainstorm_comments', 'trip_activity', 'photo_albums', 'date_polls', 'date_availability', 'trip_members']

let loading = null
function oldFirebase() {
  loading ??= (async () => {
    const [{ initializeApp }, fa, fs] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')])
    const app = initializeApp(OLD, 'wander-old')
    return { auth: fa.getAuth(app), db: fs.getFirestore(app), fa, fs }
  })()
  return loading
}

/** Sign in to the old project: { email, password } or { google: true }. Quietly false if it doesn't open. */
export async function openOldAccount(how) {
  try {
    const { auth, fa } = await oldFirebase()
    if (how.google) await fa.signInWithPopup(auth, new fa.GoogleAuthProvider())
    else await fa.signInWithEmailAndPassword(auth, how.email, how.password)
    return true
  } catch {
    return false
  }
}

export async function oldAccountOpen() {
  const { auth } = await oldFirebase()
  await auth.authStateReady()
  return Boolean(auth.currentUser)
}

export async function alreadyImported() {
  const { data } = await wander.from('imports').select('user_id').maybeSingle()
  return Boolean(data)
}

export async function markImported() {
  const { error } = await wander.from('imports').insert({ rows: 0 })
  if (error && error.code !== '23505') throw error
}

const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n))

/** Copy everything, using the old account that's open. Records copied, or null when none is open. */
export async function importHistory() {
  const { auth, db, fa, fs } = await oldFirebase()
  await auth.authStateReady()
  const old = auth.currentUser
  if (!old) return null
  try {
    const { data: s } = await supabase.auth.getSession()
    const r = await fetch(`${HIVE_ORIGIN}/api/auth/legacy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s.session?.access_token}` },
      body: JSON.stringify({ app: 'wander', idToken: await old.getIdToken() }),
    })
    const said = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(said.error || `Hive answered ${r.status}`)

    const uid = old.uid
    const rows = new Map()
    const add = (collection, d) => rows.set(`${collection}/${d.id}`, { collection, id: d.id, data: encode(d.data()) })
    const where = async (collection, field, op, value) => {
      const snap = await fs.getDocs(fs.query(fs.collection(db, collection), fs.where(field, op, value)))
      snap.docs.forEach((d) => add(collection, d))
      return snap.docs
    }

    const memberships = await where('trip_members', 'user_id', '==', uid)
    const created = await where('trips', 'created_by', '==', uid)
    const tripIds = [...new Set([...memberships.map((d) => d.data().trip_id), ...created.map((d) => d.id)])].filter(Boolean)
    for (const id of tripIds) {
      const t = await fs.getDoc(fs.doc(db, 'trips', id))
      if (t.exists()) add('trips', t)
    }
    const people = new Set([uid])
    for (const ids of chunks(tripIds, 10)) {
      for (const c of TRIP_COLLECTIONS) {
        const docs = await where(c, 'trip_id', 'in', ids)
        if (c === 'trip_members' || c === 'trip_observers') docs.forEach((d) => d.data().user_id && people.add(d.data().user_id))
      }
    }
    const pollIds = [...rows.values()].filter((x) => x.collection === 'polls').map((x) => x.id)
    for (const ids of chunks(pollIds, 10)) await where('poll_options', 'poll_id', 'in', ids)
    const friendships = await where('friendships', 'users', 'array-contains', uid)
    friendships.forEach((d) => (d.data().users || []).forEach((u) => people.add(u)))
    await where('calendar_tokens', 'created_by', '==', uid)
    await where('app_tokens', 'created_by', '==', uid)
    for (const p of people) {
      const d = await fs.getDoc(fs.doc(db, 'profiles', p))
      if (d.exists()) add('profiles', d)
    }

    const all = [...rows.values()]
    let copied = 0
    for (const slice of chunks(all, 800).length ? chunks(all, 800) : [[]]) {
      const { data, error } = await wander.rpc('import', { old_id: uid, rows: slice })
      if (error) throw new Error(error.message)
      copied += data || 0
    }
    return copied
  } finally {
    await fa.signOut(auth).catch(() => {})
  }
}
