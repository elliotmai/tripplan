import {
  collection, query, where, getDocs, getDoc, setDoc, updateDoc,
  deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase'

// Deterministic friendship doc id — sorted so A↔B and B↔A collide on the same doc.
export function friendshipId(uidA, uidB) {
  return [uidA, uidB].sort().join('_')
}

export const FRIENDSHIP_STATUS = { PENDING: 'pending', ACCEPTED: 'accepted' }
export const FRIENDSHIP_SOURCE = { REQUEST: 'request', TRIP: 'trip' }

// All friendships involving this user (both pending and accepted).
export async function listFriendships(uid) {
  const snap = await getDocs(
    query(collection(db, 'friendships'), where('users', 'array-contains', uid))
  )
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Resolve profile docs for a list of uids (skipping the current user).
export async function fetchProfiles(uids) {
  const unique = [...new Set(uids)].filter(Boolean)
  if (!unique.length) return []
  const snaps = await Promise.all(
    unique.map(id => getDoc(doc(db, 'profiles', id)))
  )
  return snaps
    .filter(s => s.exists())
    .map(s => ({ id: s.id, ...s.data() }))
}

// Look up a profile by exact email match (case-insensitive).
export async function findProfileByEmail(email) {
  const q = query(
    collection(db, 'profiles'),
    where('email', '==', email.trim().toLowerCase()),
  )
  const snap = await getDocs(q)
  if (snap.empty) return null
  return { id: snap.docs[0].id, ...snap.docs[0].data() }
}

// Send a friend request. If an incoming request already exists, accept it instead.
// Returns: 'sent' | 'accepted' | 'already-friends' | 'self'
export async function sendFriendRequest(myUid, theirUid) {
  if (myUid === theirUid) return 'self'
  const id = friendshipId(myUid, theirUid)
  const ref = doc(db, 'friendships', id)
  const snap = await getDoc(ref)
  if (snap.exists()) {
    const data = snap.data()
    if (data.status === FRIENDSHIP_STATUS.ACCEPTED) return 'already-friends'
    // Pending: if it's incoming (someone else sent it to me), accept it.
    if (data.requester_id !== myUid) {
      await updateDoc(ref, {
        status: FRIENDSHIP_STATUS.ACCEPTED,
        accepted_at: serverTimestamp(),
      })
      return 'accepted'
    }
    return 'sent'  // outgoing already exists — idempotent
  }
  await setDoc(ref, {
    users: [myUid, theirUid].sort(),
    status: FRIENDSHIP_STATUS.PENDING,
    source: FRIENDSHIP_SOURCE.REQUEST,
    requester_id: myUid,
    created_at: serverTimestamp(),
  })
  return 'sent'
}

export async function acceptFriendRequest(id) {
  await updateDoc(doc(db, 'friendships', id), {
    status: FRIENDSHIP_STATUS.ACCEPTED,
    accepted_at: serverTimestamp(),
  })
}

// Used for both declining a pending request and removing an accepted friend.
export async function removeFriendship(id) {
  await deleteDoc(doc(db, 'friendships', id))
}

// Idempotently mark (myUid, otherUid) as accepted friends via a shared trip.
// Each client only writes friendships that include itself, so the rules stay strict.
// If a pending request exists, it is upgraded to accepted.
export async function ensureTripFriendship(myUid, otherUid, tripId) {
  if (myUid === otherUid) return
  const id = friendshipId(myUid, otherUid)
  const ref = doc(db, 'friendships', id)
  const snap = await getDoc(ref)
  if (snap.exists() && snap.data().status === FRIENDSHIP_STATUS.ACCEPTED) return
  if (snap.exists()) {
    await updateDoc(ref, {
      status: FRIENDSHIP_STATUS.ACCEPTED,
      accepted_at: serverTimestamp(),
      source: FRIENDSHIP_SOURCE.TRIP,
      trip_id: tripId,
    })
    return
  }
  await setDoc(ref, {
    users: [myUid, otherUid].sort(),
    status: FRIENDSHIP_STATUS.ACCEPTED,
    source: FRIENDSHIP_SOURCE.TRIP,
    trip_id: tripId,
    requester_id: myUid,
    created_at: serverTimestamp(),
    accepted_at: serverTimestamp(),
  })
}

// Cascade: ensure I'm friends with every other member of a trip.
// Safe to call repeatedly — `ensureTripFriendship` is idempotent.
export async function ensureTripFriendships(myUid, memberIds, tripId) {
  const others = memberIds.filter(id => id && id !== myUid)
  await Promise.all(others.map(uid => ensureTripFriendship(myUid, uid, tripId)))
}

// Convenience: split a friendship list into accepted/incoming/outgoing for the current user.
export function partitionFriendships(friendships, myUid) {
  const accepted = []
  const incoming = []
  const outgoing = []
  for (const f of friendships) {
    if (f.status === FRIENDSHIP_STATUS.ACCEPTED) {
      accepted.push(f)
    } else if (f.requester_id === myUid) {
      outgoing.push(f)
    } else {
      incoming.push(f)
    }
  }
  return { accepted, incoming, outgoing }
}

// Given a friendship doc and the current user, return the *other* user's uid.
export function otherUid(friendship, myUid) {
  return friendship.users.find(u => u !== myUid)
}
