import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function AuthPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'signin') {
        await signIn(email, password)
      } else {
        await signUp(email, password, name)
      }
    } catch (err) {
      // Firebase error messages are readable enough
      setError(err.message.replace('Firebase: ', '').replace(/ \(auth\/.*\)\.?/, ''))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12"
      style={{background: 'radial-gradient(ellipse at 50% 0%, #2a2214 0%, #0a0908 60%)'}}>
      <div className="mb-10 text-center fade-in">
        <span className="text-5xl font-display" style={{color: '#d4b87a', fontStyle: 'italic', fontWeight: 300}}>wander</span>
        <p className="text-sm tracking-[0.2em] uppercase mt-2" style={{color: '#5a5248'}}>collaborative travel planning</p>
      </div>

      <div className="w-full max-w-sm glass rounded-2xl p-8 fade-in" style={{animationDelay: '0.1s'}}>
        <h2 className="font-display text-2xl font-light mb-6" style={{color: '#e8d5a3'}}>
          {mode === 'signin' ? 'Welcome back' : 'Start your journey'}
        </h2>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl text-sm"
            style={{background: 'rgba(196,124,90,0.15)', border: '1px solid rgba(196,124,90,0.3)', color: '#c47c5a'}}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <Field label="Full Name">
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="Your name" required
                className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
                style={{background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(212,184,122,0.15)', color: '#d4cfc8'}}
                onFocus={e => e.target.style.borderColor = 'rgba(212,184,122,0.4)'}
                onBlur={e => e.target.style.borderColor = 'rgba(212,184,122,0.15)'} />
            </Field>
          )}
          <Field label="Email">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" required
              className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
              style={{background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(212,184,122,0.15)', color: '#d4cfc8'}}
              onFocus={e => e.target.style.borderColor = 'rgba(212,184,122,0.4)'}
              onBlur={e => e.target.style.borderColor = 'rgba(212,184,122,0.15)'} />
          </Field>
          <Field label="Password">
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required
              className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
              style={{background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(212,184,122,0.15)', color: '#d4cfc8'}}
              onFocus={e => e.target.style.borderColor = 'rgba(212,184,122,0.4)'}
              onBlur={e => e.target.style.borderColor = 'rgba(212,184,122,0.15)'} />
          </Field>

          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-xl text-sm font-medium tracking-wider mt-2 transition-all active:scale-95"
            style={{background: loading ? '#3d3830' : 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908'}}>
            {loading ? 'Loading…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm" style={{color: '#5a5248'}}>
          {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
          <button onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError('') }}
            style={{color: '#d4b87a'}}>
            {mode === 'signin' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs tracking-widest uppercase mb-2" style={{color: '#5a5248'}}>{label}</label>
      {children}
    </div>
  )
}
