import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getOrCreateFeedTokens, revokeFeedTokens } from '../lib/calendarTokens'
import { X, Copy, Check, RefreshCw, AlertTriangle } from 'lucide-react'

const PLATFORMS = [
  {
    id: 'apple',
    label: 'Apple Calendar',
    icon: '🍎',
    steps: [
      'Open Calendar on iPhone or Mac',
      'Mac: File → New Calendar Subscription  |  iPhone: Calendars → Add Calendar → Other Calendar…',
      'Paste any URL below and tap Subscribe',
      'Set Auto-refresh to Every Hour',
      'Repeat for each feed you want separately, or just use the Combined URL',
    ],
  },
  {
    id: 'google',
    label: 'Google Calendar',
    icon: '📅',
    steps: [
      'Open Google Calendar on desktop (calendar.google.com)',
      'Click the + next to "Other calendars" in the left sidebar',
      'Choose "From URL" and paste any URL below',
      'Click "Add calendar"',
      'Repeat for each feed, or just use the Combined URL for everything',
      'Note: Google refreshes every 24 hours — this is a hard Google limitation',
    ],
  },
  {
    id: 'outlook',
    label: 'Outlook',
    icon: '📨',
    steps: [
      'Open Outlook and switch to Calendar view',
      'Click "Add calendar" → "Subscribe from web"',
      'Paste any URL below and click Import',
      'Repeat for each feed, or just use the Combined URL',
    ],
  },
]

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all flex-shrink-0"
      style={{
        background: copied ? 'rgba(138,171,142,0.2)' : 'rgba(212,184,122,0.12)',
        border: copied ? '1px solid rgba(138,171,142,0.3)' : '1px solid rgba(212,184,122,0.25)',
        color: copied ? '#8aab8e' : '#d4b87a',
      }}>
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

function FeedRow({ label, emoji, description, url, accentColor }) {
  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: `${accentColor}08`, border: `1px solid ${accentColor}30` }}>
      <div className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <p className="text-xs font-medium flex items-center gap-1.5" style={{ color: '#d4cfc8' }}>
            <span>{emoji}</span>{label}
          </p>
          {description && (
            <p className="text-xs mt-0.5" style={{ color: '#5a5248' }}>{description}</p>
          )}
        </div>
        <CopyButton text={url} />
      </div>
      <div className="px-4 py-2.5">
        <p className="text-xs font-mono break-all select-all leading-relaxed" style={{ color: '#5a5248' }}>
          {url}
        </p>
      </div>
    </div>
  )
}

export default function CalendarSubscribeSheet({ trip, onClose }) {
  const { user } = useAuth()
  const [feeds, setFeeds]                   = useState(null)
  const [loading, setLoading]               = useState(true)
  const [revoking, setRevoking]             = useState(false)
  const [activePlatform, setActivePlatform] = useState('apple')
  const [showRevoke, setShowRevoke]         = useState(false)

  useEffect(() => { loadTokens() }, [trip.id])

  async function loadTokens() {
    setLoading(true)
    try {
      const result = await getOrCreateFeedTokens(trip.id, user.id)
      setFeeds(result)
    } catch (e) {
      console.error('Failed to create calendar tokens:', e)
    }
    setLoading(false)
  }

  async function handleRevoke() {
    setRevoking(true)
    await revokeFeedTokens(trip.id, user.id)
    setShowRevoke(false)
    setRevoking(false)
    await loadTokens()
  }

  const platform = PLATFORMS.find(p => p.id === activePlatform)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-lg rounded-t-3xl slide-up overflow-hidden"
        style={{
          background: '#1c1916',
          border: '1px solid rgba(212,184,122,0.14)',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
        }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <div>
            <h2 className="font-display text-2xl font-light" style={{ color: '#e8d5a3', fontStyle: 'italic' }}>
              Subscribe to Calendar
            </h2>
            <p className="text-xs mt-0.5" style={{ color: '#5a5248' }}>
              Live feeds — update automatically when the trip changes
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.06)' }}>
            <X size={14} style={{ color: '#5a5248' }} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 pb-8 space-y-6">

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 rounded-full border-2 animate-spin"
                style={{ borderColor: 'rgba(212,184,122,0.2)', borderTopColor: '#d4b87a' }} />
            </div>
          ) : feeds ? (
            <>
              {/* Feed URLs */}
              <div className="space-y-3">
                <p className="text-xs tracking-widest uppercase" style={{ color: '#5a5248' }}>Your Feed URLs</p>

                <FeedRow
                  label="Combined — everything"
                  emoji="🗺️"
                  description="Itinerary + travel in one calendar (recommended)"
                  url={feeds.combined.url}
                  accentColor="#8aab8e"
                />
                <FeedRow
                  label="Itinerary only"
                  emoji="📅"
                  description="Day-by-day events"
                  url={feeds.itinerary.url}
                  accentColor="#d4b87a"
                />
                <FeedRow
                  label="Travel details only"
                  emoji="✈️"
                  description="Journey legs & accommodation"
                  url={feeds.travel.url}
                  accentColor="#7a9ab5"
                />
              </div>

              {/* Refresh note */}
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <RefreshCw size={13} style={{ color: '#5a5248', flexShrink: 0, marginTop: 1 }} />
                <p className="text-xs leading-relaxed" style={{ color: '#5a5248' }}>
                  Apple Calendar refreshes every hour. Google Calendar refreshes every 24 hours — this is a hard Google limitation.
                </p>
              </div>

              {/* Platform instructions */}
              <div>
                <p className="text-xs tracking-widest uppercase mb-3" style={{ color: '#5a5248' }}>
                  How to subscribe
                </p>
                <div className="flex gap-2 mb-4">
                  {PLATFORMS.map(p => (
                    <button key={p.id} onClick={() => setActivePlatform(p.id)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs transition-all flex-1 justify-center"
                      style={{
                        background: activePlatform === p.id ? 'rgba(212,184,122,0.15)' : 'rgba(255,255,255,0.03)',
                        border: activePlatform === p.id ? '1px solid rgba(212,184,122,0.3)' : '1px solid rgba(255,255,255,0.06)',
                        color: activePlatform === p.id ? '#d4b87a' : '#5a5248',
                      }}>
                      <span>{p.icon}</span>
                      <span>{p.label.split(' ')[0]}</span>
                    </button>
                  ))}
                </div>

                <div className="rounded-xl px-4 py-4"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <ol className="space-y-2.5">
                    {platform.steps.map((step, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="text-xs flex-shrink-0 w-4 text-right mt-0.5"
                          style={{ color: '#3d3830' }}>{i + 1}.</span>
                        <span className="text-xs leading-relaxed" style={{ color: '#b5aea4' }}>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              {/* Reset */}
              <div>
                {!showRevoke ? (
                  <button onClick={() => setShowRevoke(true)}
                    className="text-xs flex items-center gap-1.5"
                    style={{ color: '#3d3830' }}>
                    <RefreshCw size={10} />
                    Reset feed URLs (revokes existing subscriptions)
                  </button>
                ) : (
                  <div className="rounded-xl p-4 space-y-3"
                    style={{ background: 'rgba(196,124,90,0.08)', border: '1px solid rgba(196,124,90,0.2)' }}>
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={13} style={{ color: '#c47c5a', flexShrink: 0, marginTop: 1 }} />
                      <p className="text-xs leading-relaxed" style={{ color: '#c47c5a' }}>
                        New URLs will be generated. Anyone subscribed with old URLs will stop receiving updates and need to re-subscribe.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleRevoke} disabled={revoking}
                        className="flex-1 py-2 rounded-xl text-xs font-medium"
                        style={{ background: 'rgba(196,124,90,0.8)', color: '#fff' }}>
                        {revoking ? 'Resetting…' : 'Reset URLs'}
                      </button>
                      <button onClick={() => setShowRevoke(false)}
                        className="px-4 py-2 rounded-xl text-xs"
                        style={{ color: '#5a5248', background: 'rgba(255,255,255,0.04)' }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-center py-8" style={{ color: '#c47c5a' }}>
              Failed to generate feed URLs. Check your connection and try again.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
