import { createContext, useContext, useEffect, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile as firebaseUpdateProfile,
  deleteUser,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'firebase/auth'
import {
  doc, setDoc, getDoc, updateDoc,
  deleteDoc, collection, query, where,
  getDocs, writeBatch, serverTimestamp,
} from 'firebase/firestore'
import { auth, db } from '../lib/firebase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)
      if (firebaseUser) {
        const snap = await getDoc(doc(db, 'profiles', firebaseUser.uid))
        setProfile(snap.exists() ? snap.data() : null)
      } else {
        setProfile(null)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  async function signUp(email, password, name) {
    const { user: newUser } = await createUserWithEmailAndPassword(auth, email, password)
    await firebaseUpdateProfile(newUser, { displayName: name })
    const profileData = {
      id: newUser.uid, email, full_name: name,
      home_airport: '', home_city: '',
      created_at: serverTimestamp(),
    }
    await setDoc(doc(db, 'profiles', newUser.uid), profileData)
    setProfile(profileData)
  }

  async function signIn(email, password) {
    await signInWithEmailAndPassword(auth, email, password)
  }

  async function signOut() {
    await firebaseSignOut(auth)
  }

  async function updateProfileData({ full_name, home_airport, home_city }) {
    const uid = auth.currentUser?.uid
    if (!uid) return
    const updates = { full_name, home_airport, home_city, updated_at: serverTimestamp() }
    await updateDoc(doc(db, 'profiles', uid), updates)
    await firebaseUpdateProfile(auth.currentUser, { displayName: full_name })
    setProfile(prev => ({ ...prev, ...updates }))
  }

  async function deleteAccount(password) {
    const uid = auth.currentUser?.uid
    const email = auth.currentUser?.email
    if (!uid) return

    // Re-authenticate before deletion (Firebase requires this)
    const credential = EmailAuthProvider.credential(email, password)
    await reauthenticateWithCredential(auth.currentUser, credential)

    // Delete all user data in Firestore using a batch
    const batch = writeBatch(db)

    // Remove from trip_members (cascade deletes handled by app, not DB)
    const memSnap = await getDocs(
      query(collection(db, 'trip_members'), where('user_id', '==', uid))
    )
    memSnap.docs.forEach(d => batch.delete(d.ref))

    // Delete travel_details
    const detailSnap = await getDocs(
      query(collection(db, 'travel_details'), where('user_id', '==', uid))
    )
    detailSnap.docs.forEach(d => batch.delete(d.ref))

    // Delete poll_votes
    const voteSnap = await getDocs(
      query(collection(db, 'poll_votes'), where('user_id', '==', uid))
    )
    voteSnap.docs.forEach(d => batch.delete(d.ref))

    // Delete profile
    batch.delete(doc(db, 'profiles', uid))

    await batch.commit()

    // Delete the Firebase Auth account last
    await deleteUser(auth.currentUser)
  }

  const mergedUser = user ? {
    id: user.uid,
    email: user.email,
    user_metadata: { full_name: user.displayName || profile?.full_name },
    ...profile,
  } : null

  return (
    <AuthContext.Provider value={{
      user: mergedUser, loading,
      signUp, signIn, signOut,
      updateProfileData, deleteAccount,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)