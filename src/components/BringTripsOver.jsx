import { useState } from 'react'
import { History } from 'lucide-react'
import { importHistory, openOldAccount } from '../lib/importHistory'

/* Account → a quiet way for someone whose earlier Wander account used another
   email to bring those trips over. Only opens when asked. */
export default function BringTripsOver() {
  const [state, setState] = useState('closed') // closed | offer | password | moving | done
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')

  async function run() {
    setState('moving'); setMessage('')
    try {
      const n = await importHistory()
      if (n === null) return setState('offer')
      setMessage(n ? `Brought over ${n} things. Refresh to see them all.` : 'You’re all set. There was nothing new to bring over.')
      setState('done')
    } catch (e) {
      setMessage(e.message || 'Could not bring your trips over.')
      setState('offer')
    }
  }

  const btn = { background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }
  const ghost = { border: '1px solid rgba(212,184,122,0.3)', color: '#d4b87a' }
  const field = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(212,184,122,0.15)', color: '#d4cfc8' }

  if (state === 'closed') return (
    <button
      onClick={() => setState('offer')}
      className="w-full flex items-center gap-3 px-5 py-4 text-left transition-all active:opacity-70"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <History size={16} style={{ color: '#5a5248', flexShrink: 0 }} />
      <span className="text-sm" style={{ color: '#8a8070' }}>Used Wander before with another email? Bring your old trips over</span>
    </button>
  )

  return (
    <div className="px-5 py-4 text-sm" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#d4cfc8' }}>
      {state === 'moving' && <p>Bringing your trips over…</p>}
      {state === 'done' && (
        <div className="flex items-center justify-between gap-3">
          <p>{message}</p>
          <button className="px-3 py-1.5 rounded-lg text-xs" style={btn} onClick={() => window.location.reload()}>Refresh</button>
        </div>
      )}
      {(state === 'offer' || state === 'password') && (
        <>
          <p className="font-medium" style={{ color: '#e8d5a3' }}>Bring your old trips over</p>
          <p className="text-xs mt-1 mb-3" style={{ color: '#8a8070' }}>Sign in to the Wander account you used before to bring its trips, friends and calendar links here.</p>
          {message && <p className="text-xs mb-2" style={{ color: '#c47c5a' }}>{message}</p>}
          {state === 'password' ? (
            <form className="flex flex-col gap-2" onSubmit={async (e) => {
              e.preventDefault()
              if (await openOldAccount({ email: email.trim(), password })) { setPassword(''); run() }
              else setMessage('That email and password didn’t open an earlier Wander account.')
            }}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="The email you used before"
                autoComplete="off" className="px-3 py-2 rounded-lg text-sm outline-none" style={field} />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Its password"
                autoComplete="off" className="px-3 py-2 rounded-lg text-sm outline-none" style={field} />
              <div className="flex gap-2">
                <button type="submit" disabled={!email.trim() || !password} className="px-3 py-2 rounded-lg text-xs" style={btn}>Bring them over</button>
                <button type="button" className="px-3 py-2 rounded-lg text-xs" style={{ color: '#8a8070' }} onClick={() => { setState('offer'); setMessage('') }}>Back</button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button className="px-3 py-1.5 rounded-lg text-xs" style={btn} onClick={async () => {
                if (await openOldAccount({ google: true })) run()
                else setMessage('That Google account didn’t open an earlier Wander account.')
              }}>I used Google</button>
              <button className="px-3 py-1.5 rounded-lg text-xs" style={ghost} onClick={() => { setState('password'); setMessage('') }}>I used a password</button>
              <button className="px-3 py-1.5 rounded-lg text-xs" style={{ color: '#8a8070' }} onClick={() => { setState('closed'); setMessage('') }}>Cancel</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
