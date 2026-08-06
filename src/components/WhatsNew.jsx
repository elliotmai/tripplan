import { useState } from 'react'
import { WHATS_NEW } from '../config/whatsNew'

const STORAGE_KEY = 'tripplan.whatsNewSeen'

// Compare versions like "2026.07.26" and "2026.07.26.2" numerically per segment,
// so same-day increments (.1, .2, … .10) order correctly.
function cmpVersion(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}


// Read the changelog once on first render and return every entry newer than what
// this device last saw. First visit (no stored value) shows only the newest entry.
function unseenEntries() {
  const latest = WHATS_NEW[0]
  if (!latest) return []
  let seen = null
  try {
    seen = localStorage.getItem(STORAGE_KEY)
  } catch {
    seen = null
  }
  // Versions are zero-padded YYYY.MM.DD, so string comparison orders them.
  return seen == null ? [latest] : WHATS_NEW.filter((e) => cmpVersion(e.version, seen) > 0)
}

/**
 * Accumulating "What's New" popup. The next time a person opens the app after one
 * or more updates, it shows EVERY changelog entry newer than what this device has
 * already seen — combined into a single popup — then remembers the latest version
 * locally so nothing repeats until the next update.
 *
 * First visit on a device shows only the newest entry (not the whole history);
 * a returning device that missed several releases sees them all stacked together.
 */
export default function WhatsNew() {
  const latest = WHATS_NEW[0]
  const [entries, setEntries] = useState(unseenEntries)

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, latest.version)
    } catch {
      /* ignore storage failures */
    }
    setEntries([])
  }

  if (!entries.length || !latest) return null

  const stacked = entries.length > 1

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-6"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
      onClick={dismiss}>
      <div className="w-full max-w-sm rounded-3xl slide-up overflow-hidden"
        style={{ background: '#1c1916', border: '1px solid rgba(212,184,122,0.15)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="text-center px-6 pt-7 pb-4 flex-shrink-0">
          <div className="text-4xl mb-1">✨</div>
          <h2 className="font-display text-2xl font-light" style={{ color: '#e8d5a3', fontStyle: 'italic' }}>What’s New</h2>
          {!stacked && latest.date && (
            <p className="text-xs tracking-widest uppercase mt-1" style={{ color: '#5a5248' }}>{latest.date}</p>
          )}
        </div>

        <div className="overflow-y-auto flex-1 px-6 space-y-4">
          {entries.map(entry => (
            <div key={entry.version} className="space-y-2">
              {stacked && entry.date && (
                <p className="text-xs tracking-widest uppercase" style={{ color: '#5a5248' }}>{entry.date}</p>
              )}
              <ul className="space-y-2">
                {entry.items.map((item, i) => (
                  <li key={i} className="rounded-xl px-4 py-3 text-sm leading-snug"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(212,184,122,0.1)', color: '#d4cfc8' }}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="px-6 pt-4 pb-6 flex-shrink-0">
          <button onClick={dismiss}
            className="w-full py-4 rounded-2xl font-medium tracking-wider transition-all active:scale-95"
            style={{ background: 'linear-gradient(135deg, #d4b87a 0%, #c19a4e 100%)', color: '#0a0908' }}>
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
