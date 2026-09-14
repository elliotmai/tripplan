import { useState, useEffect } from 'react'
import { Plug, Copy, Check, Trash2, Plus } from 'lucide-react'

import { createAppToken, listAppTokens, revokeAppToken } from '../lib/appTokens'

/**
 * Apps allowed to read your trips (Account → Connected apps).
 *
 * The first one is Galaxy Farm, which shows a housesitter when you are back
 * and what you are on — so the barn screen stops needing anyone to retype a
 * flight time into a second app.
 *
 * A token is shown **once**, on the screen that mints it. The list afterwards
 * carries the label and when it was last used and never the secret: a list
 * that redisplays it turns one screenshot into standing access, and there is
 * nothing re-minting cannot also do. Revoking is immediate — the endpoints
 * look the token up on every request, so there is no session to expire.
 */

function timeAgo(stamp) {
  if (!stamp?.seconds) return 'never used'
  const days = Math.floor((Date.now() / 1000 - stamp.seconds) / 86400)
  if (days <= 0) return 'used today'
  if (days === 1) return 'used yesterday'
  if (days < 30) return `used ${days}d ago`
  return `used ${Math.floor(days / 30)}mo ago`
}

export default function ConnectedApps({ userId }) {
  const [tokens, setTokens] = useState([])
  const [loading, setLoading] = useState(true)
  const [label, setLabel] = useState('')
  const [minting, setMinting] = useState(false)
  const [fresh, setFresh] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!userId) return
    listAppTokens(userId)
      .then(setTokens)
      .catch(() => setTokens([]))
      .finally(() => setLoading(false))
  }, [userId])

  async function mint() {
    if (!label.trim() || minting) return
    setMinting(true)
    try {
      const { token } = await createAppToken(label, userId)
      setFresh(token)
      setLabel('')
      setTokens(await listAppTokens(userId))
    } finally {
      setMinting(false)
    }
  }

  async function revoke(id, name) {
    // Irreversible and silent from the app's side — it just starts getting
    // 403s — so it is worth one confirm naming what stops working.
    if (!window.confirm(`Disconnect ${name}? It loses access to your trips immediately.`)) return
    await revokeAppToken(id)
    setTokens(tokens.filter(t => t.id !== id))
  }

  function copy() {
    navigator.clipboard?.writeText(fresh).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="px-5 pb-5">
      <p className="text-xs leading-relaxed pb-4" style={{ color: '#5a5248' }}>
        Give another app read-only access to your trips — its dates, and the flights on it.
        Nothing can be changed with a token, and you can disconnect at any time.
      </p>

      {fresh && (
        <div className="rounded-xl p-4 mb-4" style={{ background: 'rgba(196,124,90,0.08)', border: '1px solid rgba(196,124,90,0.25)' }}>
          <p className="text-xs pb-2" style={{ color: '#c47c5a' }}>
            Copy this now — it is not shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="text-xs flex-1 break-all" style={{ color: '#d4cfc8' }}>{fresh}</code>
            <button
              onClick={copy}
              aria-label="Copy token"
              className="p-2 rounded-lg transition-all active:opacity-70"
              style={{ background: 'rgba(255,255,255,0.05)' }}>
              {copied ? <Check size={14} style={{ color: '#7ca55a' }} /> : <Copy size={14} style={{ color: '#d4cfc8' }} />}
            </button>
          </div>
          <button onClick={() => setFresh(null)} className="text-xs pt-3" style={{ color: '#5a5248' }}>
            Done
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 pb-4">
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') mint() }}
          placeholder="App name, e.g. Galaxy Farm"
          className="flex-1 text-sm rounded-xl px-3 py-2.5 outline-none"
          style={{ background: 'rgba(255,255,255,0.04)', color: '#d4cfc8', border: '1px solid rgba(255,255,255,0.06)' }}
        />
        <button
          onClick={mint}
          disabled={!label.trim() || minting}
          className="flex items-center gap-1.5 text-sm rounded-xl px-3 py-2.5 transition-all active:opacity-70 disabled:opacity-40"
          style={{ background: 'rgba(255,255,255,0.06)', color: '#d4cfc8' }}>
          <Plus size={14} />
          Connect
        </button>
      </div>

      {loading ? (
        <p className="text-xs" style={{ color: '#5a5248' }}>Loading…</p>
      ) : tokens.length === 0 ? (
        <p className="text-xs" style={{ color: '#5a5248' }}>Nothing connected yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {tokens.map(token => (
            <div
              key={token.id}
              className="flex items-center gap-3 rounded-xl px-3 py-3"
              style={{ background: 'rgba(255,255,255,0.03)' }}>
              <Plug size={14} style={{ color: '#5a5248', flexShrink: 0 }} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm truncate" style={{ color: '#d4cfc8' }}>{token.label}</span>
                <span className="block text-xs" style={{ color: '#5a5248' }}>{timeAgo(token.last_used_at)}</span>
              </span>
              <button
                onClick={() => revoke(token.id, token.label)}
                aria-label={`Disconnect ${token.label}`}
                className="p-2 rounded-lg transition-all active:opacity-70">
                <Trash2 size={14} style={{ color: '#c47c5a' }} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
