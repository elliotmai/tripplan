/*
 * The Firestore calls Wander's screens make, answered by Supabase.
 *
 * Wander moved from Firebase (project wander-f10b1) to Hive's Supabase
 * project, schema `wander`: one row per document in wander.docs. Rather than
 * rewrite every screen, this keeps the calls they use — collection, doc,
 * query, where (==, in, array-contains), orderBy, limit, getDoc(s), addDoc,
 * setDoc, updateDoc, deleteDoc, writeBatch, onSnapshot, serverTimestamp,
 * arrayUnion, arrayRemove, deleteField — over that table. The database
 * decides who may see and change what: a trip's records are for the people on
 * it (see the wander migration in Fridge-Board/supabase).
 */
import { supabase, wander } from './supabase'
import { Timestamp, decode, encode } from './timestamp'

export { Timestamp }
export const getFirestore = () => ({ kind: 'db' })

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20)

export function collection(_db, name) {
  return { kind: 'col', name }
}

/** doc(db, name, id) · doc(colRef) (new id) · doc(colRef, id) */
export function doc(a, b, c) {
  if (a?.kind === 'col') return { kind: 'doc', name: a.name, id: b ?? newId() }
  return { kind: 'doc', name: b, id: c ?? newId() }
}

export const where = (field, op, value) => ({ type: 'where', field, op, value })
export const orderBy = (field, dir = 'asc') => ({ type: 'orderBy', field, dir })
export const limit = (n) => ({ type: 'limit', n })
export const query = (col, ...parts) => ({
  kind: 'query',
  name: col.name,
  wheres: [...(col.wheres || []), ...parts.filter((p) => p.type === 'where')],
  orders: [...(col.orders || []), ...parts.filter((p) => p.type === 'orderBy')],
  max: parts.find((p) => p.type === 'limit')?.n ?? col.max,
})

// ── markers for writes ──
const SERVER_TS = Symbol('serverTimestamp')
const DELETE = Symbol('deleteField')
export const serverTimestamp = () => SERVER_TS
export const deleteField = () => DELETE
export const arrayUnion = (...items) => ({ __op: 'union', items })
export const arrayRemove = (...items) => ({ __op: 'remove', items })

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Timestamp) && typeof v.toMillis !== 'function'
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Apply markers against the current value. */
function resolve(value, current) {
  if (value === SERVER_TS) return Timestamp.now()
  if (value?.__op === 'union') {
    const base = Array.isArray(current) ? [...current] : []
    for (const it of value.items) if (!base.some((x) => same(x, it))) base.push(it)
    return base
  }
  if (value?.__op === 'remove') return (Array.isArray(current) ? current : []).filter((x) => !value.items.some((it) => same(x, it)))
  if (isPlain(value)) {
    const out = {}
    for (const [k, v] of Object.entries(value)) if (v !== undefined && v !== DELETE) out[k] = resolve(v, undefined)
    return out
  }
  if (Array.isArray(value)) return value.map((v) => resolve(v, undefined))
  return value
}

const fail = (error) => {
  if (error) throw Object.assign(new Error(error.message), { code: error.code === '42501' ? 'permission-denied' : error.code })
}

// ── reading ──
function snapDoc(name, row) {
  const ref = { kind: 'doc', name, id: row?.id }
  const fields = row ? decode(row.data) : undefined
  return { id: ref.id, ref, exists: () => Boolean(row), data: () => (fields ? { ...fields } : undefined) }
}

const sortValue = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v ?? '')

async function run(q) {
  // Looking someone up by email goes through wander.find_profile (profiles are
  // otherwise only visible to people you share a trip or friendship with).
  const byEmail = q.name === 'profiles' && q.wheres.length === 1 && q.wheres[0].field === 'email' && q.wheres[0].op === '=='
  if (byEmail) {
    const { data, error } = await wander.rpc('find_profile', { email: String(q.wheres[0].value) })
    fail(error)
    return (data || []).map((r) => snapDoc('profiles', r))
  }
  let req = wander.from('docs').select('id, data').eq('collection', q.name)
  for (const w of q.wheres) {
    const col = w.field === '__name__' || w.field === 'id' ? 'id' : `data->>${w.field}`
    if (w.op === '==') req = w.value === null ? req.is(col, null) : req.eq(col, typeof w.value === 'string' ? w.value : JSON.stringify(w.value).replace(/^"|"$/g, ''))
    else if (w.op === 'in') {
      if (!w.value?.length) return []
      req = req.in(col, w.value)
    } else if (w.op === 'array-contains') req = req.filter(`data->${w.field}`, 'cs', JSON.stringify([w.value]))
    else throw new Error(`where op ${w.op} is not supported`)
  }
  const { data, error } = await req
  fail(error)
  let docs = data.map((r) => snapDoc(q.name, r))
  for (const o of [...q.orders].reverse()) {
    docs = docs.filter((d) => d.data()[o.field] !== undefined)
    docs.sort((a, b) => {
      const x = sortValue(a.data()[o.field]), y = sortValue(b.data()[o.field])
      return (x > y ? 1 : x < y ? -1 : 0) * (o.dir === 'desc' ? -1 : 1)
    })
  }
  return q.max ? docs.slice(0, q.max) : docs
}

const asQuery = (q) => (q.kind === 'col' ? { name: q.name, wheres: [], orders: [] } : q)
const snapshot = (docs) => ({ docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) })

export async function getDocs(q) {
  return snapshot(await run(asQuery(q)))
}

async function readRow(ref) {
  const { data, error } = await wander.from('docs').select('id, data').eq('collection', ref.name).eq('id', ref.id).maybeSingle()
  fail(error)
  return data
}

export async function getDoc(ref) {
  return snapDoc(ref.name, await readRow(ref))
}

let channelSeq = 0

/** Answers now, then again whenever a record in that collection changes (that you can see). */
export function onSnapshot(target, next, onError) {
  const isDoc = target.kind === 'doc'
  let live = true
  const refresh = () =>
    (isDoc ? getDoc(target) : getDocs(target))
      .then((s) => live && next(s))
      .catch((err) => live && (onError ? onError(err) : console.warn('[wander]', err.message)))
  refresh()
  const channel = supabase
    .channel(`wander-${target.name}-${++channelSeq}`)
    .on('postgres_changes', { event: '*', schema: 'wander', table: 'docs', filter: `collection=eq.${target.name}` }, refresh)
    .subscribe()
  const onVisible = () => {
    if (!document.hidden) refresh()
  }
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    live = false
    document.removeEventListener('visibilitychange', onVisible)
    supabase.removeChannel(channel)
  }
}

// ── writing ──
export async function addDoc(col, fields) {
  const id = newId()
  const { error } = await wander.from('docs').insert({ collection: col.name, id, data: encode(resolve(fields)) })
  fail(error)
  return { kind: 'doc', name: col.name, id }
}

function deepMerge(base, patch) {
  const out = isPlain(base) ? { ...base } : {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if (v === DELETE) delete out[k]
    else if (isPlain(v) && !v.__op) out[k] = deepMerge(out[k], v)
    else out[k] = resolve(v, out[k])
  }
  return out
}

export async function setDoc(ref, fields, options = {}) {
  let data
  if (options.merge) {
    const row = await readRow(ref)
    data = deepMerge(row ? decode(row.data) : {}, fields)
  } else data = resolve(fields)
  const { error } = await wander.from('docs').upsert({ collection: ref.name, id: ref.id, data: encode(data) }, { onConflict: 'collection,id' })
  fail(error)
}

/** updateDoc(ref, { field: v, 'a.b': v }): replaces those fields; the document must exist. */
export async function updateDoc(ref, changes) {
  const row = await readRow(ref)
  if (!row) throw Object.assign(new Error('No document to update'), { code: 'not-found' })
  const data = decode(row.data)
  for (const [key, v] of Object.entries(changes)) {
    if (v === undefined) continue
    const path = key.split('.')
    let node = data
    for (const p of path.slice(0, -1)) {
      if (!isPlain(node[p])) node[p] = {}
      node = node[p]
    }
    const last = path[path.length - 1]
    if (v === DELETE) delete node[last]
    else node[last] = resolve(v, node[last])
  }
  const { error } = await wander.from('docs').update({ data: encode(data) }).eq('collection', ref.name).eq('id', ref.id)
  fail(error)
}

export async function deleteDoc(ref) {
  const { error } = await wander.from('docs').delete().eq('collection', ref.name).eq('id', ref.id)
  fail(error)
}

/** Runs the queued writes in order when committed. */
export function writeBatch() {
  const ops = []
  const batch = {
    set: (ref, data, options) => (ops.push(() => setDoc(ref, data, options)), batch),
    update: (ref, data) => (ops.push(() => updateDoc(ref, data)), batch),
    delete: (ref) => (ops.push(() => deleteDoc(ref)), batch),
    async commit() {
      for (const op of ops) await op()
    },
  }
  return batch
}
