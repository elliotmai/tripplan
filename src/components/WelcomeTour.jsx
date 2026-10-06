import { useState } from 'react'
import { useAuth } from '../contexts/useAuth'

// A short, swipe-through tour of the main features, shown once to brand-new
// accounts. signUp() writes `intro_seen: false` on the profile; finishing or
// skipping flips it to true. Accounts made before this existed have no field,
// so they never see it.
const STEPS = [
  {
    emoji: '🧭',
    title: name => `Welcome to Wander${name ? `, ${name}` : ''}`,
    body: 'Plan trips together with the people you’re travelling with. Everyone sees the same plan, and it stays up to date.',
  },
  {
    emoji: '✈️',
    title: () => 'Start a trip',
    body: 'Give it a destination and dates, then invite your travel mates by email or from your Friends. Everyone on a trip can add to it.',
  },
  {
    emoji: '🗓️',
    title: () => 'Build the itinerary',
    body: 'Plan day by day with the weather alongside. Assign events to the people going, and flights and stays slot into each day automatically. Switch between list and calendar views.',
  },
  {
    emoji: '🧳',
    title: () => 'Share your travel',
    body: 'In Travelers, add your flights, trains and stays. One booking can cover several people. During the trip, the Flights tab tracks flights live.',
  },
  {
    emoji: '🗳️',
    title: () => 'Decide together',
    body: 'Use Dates to find when everyone’s free, and Ideas to suggest plans and turn them into polls. Photos holds the trip’s albums, and History shows every change, with undo.',
  },
  {
    emoji: '👀',
    title: () => 'Keep others in the loop',
    body: 'Add family or friends as observers and choose exactly what they see. Subscribe to a trip in your calendar app so it stays in sync.',
  },
]

export default function WelcomeTour() {
  const { user, updatePreferences } = useAuth()
  const [step, setStep] = useState(0)
  const [closed, setClosed] = useState(false)

  if (closed || user?.intro_seen !== false) return null

  const s = STEPS[step]
  const last = step === STEPS.length - 1
  const firstName = (user.full_name || user.user_metadata?.full_name || '').split(' ')[0]

  function finish() {
    setClosed(true)
    updatePreferences({ intro_seen: true }).catch(() => { })
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-6"
      style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-sm rounded-3xl slide-up overflow-hidden"
        role="dialog" aria-modal="true" aria-labelledby="welcome-title"
        style={{ background: '#1c1916', border: '1px solid rgba(212,184,122,0.15)' }}>

        <div className="flex justify-end px-5 pt-4 h-8">
          {!last && (
            <button onClick={finish} className="text-xs tracking-wider" style={{ color: '#5a5248' }}>Skip</button>
          )}
        </div>

        <div key={step} className="px-7 pt-2 pb-6 text-center fade-in" style={{ minHeight: 250 }}>
          <div className="text-5xl mb-4">{s.emoji}</div>
          <h2 id="welcome-title" className="font-display text-2xl font-light mb-3"
            style={{ color: '#e8d5a3', fontStyle: 'italic' }}>
            {s.title(firstName)}
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: '#d4cfc8' }}>{s.body}</p>
        </div>

        <div className="flex justify-center gap-1.5 pb-5">
          {STEPS.map((_, i) => (
            <button key={i} onClick={() => setStep(i)} aria-label={`Step ${i + 1}`}
              className="h-1.5 rounded-full transition-all"
              style={{ width: i === step ? 18 : 6, background: i === step ? '#d4b87a' : 'rgba(212,184,122,0.2)' }} />
          ))}
        </div>

        <div className="flex gap-3 px-6 pb-6">
          {step > 0 && (
            <button onClick={() => setStep(step - 1)}
              className="flex-1 py-4 rounded-2xl text-sm tracking-wider transition-all active:scale-95"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(212,184,122,0.15)', color: '#d4cfc8' }}>
              Back
            </button>
          )}
          <button onClick={last ? finish : () => setStep(step + 1)}
            className="flex-[2] py-4 rounded-2xl font-medium tracking-wider transition-all active:scale-95"
            style={{ background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
            {last ? 'Start planning' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
