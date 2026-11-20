import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { alreadyImported, importHistory, markImported, oldAccountOpen, openOldAccount } from '../lib/importHistory'

/* Once, after the move: bring your trips over from the old Wander. Signed in
   with your old password? It happens by itself. */
export default function ImportBanner() {
  const [state, setState] = useState('checking') // checking | offer | password | moving | done | hidden
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')

  async function run() {
    setState('moving'); setMessage('')
    try {
      const n = await importHistory()
      if (n === null) return setState('offer')
      setMessage(n ? `Brought over ${n} things from before the move. Refresh to see them all.` : 'You’re all set.')
      setState('done')
    } catch (e) {
      setMessage(e.message || 'Could not bring your trips over.')
      setState('offer')
    }
  }

  useEffect(() => {
    let on = true
    ;(async () => {
      if (await alreadyImported()) return on && setState('hidden')
      if (await oldAccountOpen()) return on && run()
      if (on) setState('offer')
    })().catch(() => on && setState('hidden'))
    return () => { on = false }
  }, [])

  if (state === 'checking' || state === 'hidden') return null
  const box = { background: 'rgba(212,184,122,0.08)', border: '1px solid rgba(212,184,122,0.25)', color: '#d4cfc8' }
  const btn = { background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }
  const ghost = { border: '1px solid rgba(212,184,122,0.3)', color: '#d4b87a' }

  return (
    <div className="mx-4 mt-4 rounded-2xl p-4 text-sm" style={box}>
      {state === 'moving' && <p>Bringing your trips over from before the move…</p>}
      {state === 'done' && (
        <div className="flex items-center justify-between gap-3">
          <p>{message}</p>
          <button className="px-3 py-1.5 rounded-lg text-xs" style={btn} onClick={() => window.location.reload()}>Refresh</button>
        </div>
      )}
      {(state === 'offer' || state === 'password') && (
        <>
          <p className="font-medium" style={{ color: '#e8d5a3' }}>Used Wander before the move?</p>
          <p className="text-xs mt-1 mb-3" style={{ color: '#8a8070' }}>Bring your trips, friends and calendar links over. You only do this once.</p>
          {message && <p className="text-xs mb-2" style={{ color: '#c47c5a' }}>{message}</p>}
          {state === 'password' ? (
            <form className="flex gap-2" onSubmit={async (e) => {
              e.preventDefault()
              const { data } = await supabase.auth.getUser()
              if (await openOldAccount({ email: data.user?.email, password })) { setPassword(''); run() }
              else setMessage('That password didn’t open an old Wander account for your email.')
            }}>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your old password"
                autoComplete="current-password" className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(212,184,122,0.15)', color: '#d4cfc8' }} />
              <button type="submit" disabled={!password} className="px-3 py-2 rounded-lg text-xs" style={btn}>Bring them over</button>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button className="px-3 py-1.5 rounded-lg text-xs" style={btn} onClick={async () => {
                if (await openOldAccount({ google: true })) run()
                else setMessage('That Google account didn’t open an old Wander account.')
              }}>I used Google</button>
              <button className="px-3 py-1.5 rounded-lg text-xs" style={ghost} onClick={() => setState('password')}>I used a password</button>
              <button className="px-3 py-1.5 rounded-lg text-xs" style={{ color: '#8a8070' }} onClick={() => markImported().then(() => setState('hidden'))}>I’m new here</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
