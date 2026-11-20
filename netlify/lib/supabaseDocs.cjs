// The few Firestore Admin calls Wander's server handlers make — collection,
// doc().get(), where(…, '==', …), orderBy, limit, get, ref.update — answered
// from Supabase's wander.docs over REST with the service key (it skips the
// row rules; these handlers check access themselves, as they did before).
//
// Environment: SUPABASE_SERVICE_ROLE_KEY (secret, functions only).
const SUPABASE_URL = 'https://fcjiummxpacwriwopcho.supabase.co'

const headers = () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY on Wander')
  return { apikey: key, 'accept-profile': 'wander', 'content-profile': 'wander', 'content-type': 'application/json' }
}

// {"$ts": ms} back to a Firestore-like Timestamp, so `.seconds`/`.toDate()` still work.
function decode(v) {
  if (Array.isArray(v)) return v.map(decode)
  if (v && typeof v === 'object') {
    const keys = Object.keys(v)
    if (keys.length === 1 && keys[0] === '$ts') {
      const ms = v.$ts
      return { seconds: Math.floor(ms / 1000), nanoseconds: 0, toDate: () => new Date(ms), toMillis: () => ms }
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]))
  }
  return v
}

function snap(name, row) {
  const ref = {
    id: row ? row.id : null,
    async update(patch) {
      const cur = await fetch(`${SUPABASE_URL}/rest/v1/docs?collection=eq.${encodeURIComponent(name)}&id=eq.${encodeURIComponent(row.id)}&select=data`, { headers: headers() })
      const [r] = await cur.json()
      const res = await fetch(`${SUPABASE_URL}/rest/v1/docs?collection=eq.${encodeURIComponent(name)}&id=eq.${encodeURIComponent(row.id)}`, {
        method: 'PATCH', headers: headers(), body: JSON.stringify({ data: { ...(r?.data || {}), ...patch } }),
      })
      if (!res.ok) throw new Error(`Supabase answered ${res.status}`)
    },
  }
  return { id: ref.id, exists: Boolean(row), ref, data: () => (row ? decode(row.data) : undefined) }
}

function query(name, wheres = [], orders = [], max = null) {
  return {
    where: (field, op, value) => {
      if (op !== '==') throw new Error(`where op ${op} is not supported`)
      return query(name, [...wheres, [field, value]], orders, max)
    },
    orderBy: (field, dir = 'asc') => query(name, wheres, [...orders, [field, dir]], max),
    limit: (n) => query(name, wheres, orders, n),
    async get() {
      const q = new URLSearchParams({ collection: `eq.${name}`, select: 'id,data' })
      for (const [field, value] of wheres) q.append(`data->>${field}`, `eq.${value}`)
      const res = await fetch(`${SUPABASE_URL}/rest/v1/docs?${q}`, { headers: headers() })
      if (!res.ok) throw new Error(`Supabase answered ${res.status}`)
      let docs = (await res.json()).map((r) => snap(name, r))
      for (const [field, dir] of [...orders].reverse()) {
        docs = docs.filter((d) => d.data()[field] !== undefined)
        docs.sort((a, b) => {
          const x = a.data()[field], y = b.data()[field]
          return (x > y ? 1 : x < y ? -1 : 0) * (dir === 'desc' ? -1 : 1)
        })
      }
      if (max) docs = docs.slice(0, max)
      return { docs, empty: docs.length === 0, size: docs.length }
    },
  }
}

function docsDb() {
  return {
    collection: (name) => ({
      ...query(name),
      doc: (id) => ({
        async get() {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/docs?collection=eq.${encodeURIComponent(name)}&id=eq.${encodeURIComponent(id)}&select=id,data`, { headers: headers() })
          if (!res.ok) throw new Error(`Supabase answered ${res.status}`)
          return snap(name, (await res.json())[0] || null)
        },
      }),
    }),
  }
}

module.exports = { docsDb, decode }
