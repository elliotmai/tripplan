import { useEffect, useState } from 'react'
import {
  doc, setDoc, getDoc, updateDoc,
  collection, query, where,
  getDocs, writeBatch, serverTimestamp,
} from '../lib/store'
import { db } from '../lib/firebase'
import { HIVE_ORIGIN, supabase } from '../lib/supabase'
import { AuthContext } from './useAuth'

/*
 * Your Hive account: the same sign-in as Hive and every app under
 * flyingdoublemranch.com. Signed in to any of them? Then you're signed in here.
 */

const MESSAGES = {
  invalid_credentials: 'That email and password don’t match.',
  email_not_confirmed: 'Confirm your email first: open the link we sent you.',
  user_already_exists: 'That email already has an account. Sign in instead.',
  weak_password: 'Use a password of at least 6 characters.',
  over_request_rate_limit: 'Too many tries. Wait a minute and try again.',
  carry_over_emailed: 'Almost there: we emailed you a link to finish signing in. Open it on this device.',
  confirm_email: 'Check your email: open the link we sent to finish making your account.',
}
const friendly = (err) => Object.assign(new Error(MESSAGES[err?.code] || err?.message || 'Something went wrong. Please try again.'), { code: err?.code })

/* A password Supabase doesn't know yet may be from before the move: Hive checks
   it against the old apps and brings it over, then we try again. */
async function passwordSignIn(email, password) {
  const first = await supabase.auth.signInWithPassword({ email, password })
  if (!first.error) return
  if (first.error.code !== 'invalid_credentials') throw first.error
  const r = await fetch(`${HIVE_ORIGIN}/api/auth/carry-over`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
  }).catch(() => null)
  if (!r?.ok) throw first.error
  const d = await r.json().catch(() => ({}))
  if (d.how === 'email') throw Object.assign(new Error('emailed'), { code: 'carry_over_emailed' })
  const again = d.how === 'token'
    ? await supabase.auth.verifyOtp({ token_hash: d.token, type: 'magiclink' })
    : await supabase.auth.signInWithPassword({ email, password })
  if (again.error) throw again.error
}

/** Make sure a signed-in person has a profile (Google and Hive sign-ins arrive without one). */
async function ensureProfile(u) {
  const ref = doc(db, 'profiles', u.id)
  const snap = await getDoc(ref)
  if (snap.exists()) return snap.data()
  const name = u.user_metadata?.full_name || u.user_metadata?.name || (u.email || '').split('@')[0]
  const profileData = {
    id: u.id, email: (u.email || '').toLowerCase(), full_name: name,
    home_airport: '', home_city: '',
    temp_unit: 'C', time_format: '12',
    intro_seen: false,   // shows the WelcomeTour once
    created_at: serverTimestamp(),
  }
  await setDoc(ref, profileData)
  return (await getDoc(ref)).data()
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let lastId = 'unset'
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null
      if ((u?.id ?? null) === lastId) {
        if (_event === 'USER_UPDATED') setUser(u)
        return // a token refresh: nothing changed
      }
      lastId = u?.id ?? null
      setUser(u)
      if (!u) {
        setProfile(null)
        setLoading(false)
        return
      }
      // Run outside the auth callback (Supabase asks not to await inside it).
      setTimeout(() => {
        ensureProfile(u)
          .then(setProfile, (e) => { console.warn('profile', e); setProfile(null) })
          .finally(() => setLoading(false))
      }, 0)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  async function signUp(email, password, name) {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { data: { full_name: name }, emailRedirectTo: `${window.location.origin}/` },
    })
    if (error) throw friendly(error)
    if (data.user && !data.user.identities?.length) throw friendly({ code: 'user_already_exists' })
    if (!data.session) throw friendly({ code: 'confirm_email' })
  }

  async function signIn(email, password) {
    email = email.trim()
    try {
      await passwordSignIn(email, password)
    } catch (e) {
      throw friendly(e)
    }
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/`, queryParams: { prompt: 'select_account' } },
    })
    if (error) throw friendly(error)
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  async function updateProfileData({ full_name, home_airport, home_city }) {
    const uid = user?.id
    if (!uid) return
    const updates = { full_name, home_airport, home_city, updated_at: serverTimestamp() }
    await updateDoc(doc(db, 'profiles', uid), updates)
    await supabase.auth.updateUser({ data: { full_name } }).catch(() => {})
    setProfile(prev => ({ ...prev, ...updates }))
  }

  // Display preferences (temperature unit, clock format). Merged straight onto
  // the profile so they're readable app-wide via useAuth().user.
  async function updatePreferences(prefs) {
    const uid = user?.id
    if (!uid) return
    const updates = { ...prefs, updated_at: serverTimestamp() }
    await updateDoc(doc(db, 'profiles', uid), updates)
    setProfile(prev => ({ ...prev, ...updates }))
  }

  async function deleteAccount(password) {
    const uid = user?.id
    const email = user?.email
    if (!uid) return

    // Check the password before deleting anything.
    const { error: wrong } = await supabase.auth.signInWithPassword({ email, password })
    if (wrong) throw friendly(wrong)

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

    // Your Hive account itself stays (Hive and your other apps use it); Wander
    // forgets you, and signs you out here.
    await supabase.auth.signOut()
  }

  const mergedUser = user ? {
    id: user.id,
    email: user.email,
    user_metadata: { full_name: user.user_metadata?.full_name || user.user_metadata?.name || profile?.full_name },
    ...profile,
  } : null

  return (
    <AuthContext.Provider value={{
      user: mergedUser, loading,
      signUp, signIn, signInWithGoogle, signOut,
      updateProfileData, updatePreferences, deleteAccount,
    }}>
      {children}
    </AuthContext.Provider>
  )
}
