import {
  collection, addDoc, doc, getDoc, setDoc, updateDoc, deleteDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase'

// ── Trip activity log ─────────────────────────────────────────────────────────
//
// Every meaningful change to a trip's content writes one document to the
// `trip_activity` collection. Each entry carries a short human summary, an
// optional list of detail lines (the field-level diff), who made the change and
// when, and — where the change can be safely reversed — an `undo` payload.
//
// An undo payload is a list of primitive Firestore operations:
//   { ops: [{ op: 'delete' | 'set' | 'update', collection, docId, data? }] }
// Running them in order reverses the original change:
//   • undo a create  → delete the created doc(s)
//   • undo a delete  → set the doc(s) back (snapshot captured before deleting)
//   • undo an update → update the changed fields back to their previous values
//
// Logging must never break the primary action, so every write is best-effort.

export async function logActivity(tripId, actor, { action, entity, summary, details = [], undo = null }) {
  try {
    await addDoc(collection(db, 'trip_activity'), {
      trip_id: tripId,
      actor_id: actor?.id || null,
      actor_name: actor?.full_name || actor?.user_metadata?.full_name || 'Someone',
      action,          // 'create' | 'update' | 'delete'
      entity,          // 'event' | 'idea' | 'poll' | 'trip'
      summary,
      details,         // string[]
      undo,            // { ops: [...] } | null
      undone: false,
      created_at: serverTimestamp(),
    })
  } catch (e) {
    console.warn('logActivity failed', e)
  }
}

// Reverse a logged change and mark the entry as undone.
export async function undoActivity(entry) {
  if (!entry?.undo?.ops?.length) return
  for (const op of entry.undo.ops) {
    const ref = doc(db, op.collection, op.docId)
    if (op.op === 'delete') await deleteDoc(ref)
    else if (op.op === 'set') await setDoc(ref, op.data)
    else if (op.op === 'update') await updateDoc(ref, op.data)
  }
  await updateDoc(doc(db, 'trip_activity', entry.id), {
    undone: true,
    undone_at: serverTimestamp(),
  })
}

// Read a doc's current data so we can snapshot it before a destructive change.
// Returns a ready-to-use `set` op, or null if the doc is gone.
export async function snapshotOp(collectionName, docId) {
  const snap = await getDoc(doc(db, collectionName, docId))
  if (!snap.exists()) return null
  return { op: 'set', collection: collectionName, docId, data: snap.data() }
}

// ── Field formatting / diffing ─────────────────────────────────────────────────

function show(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—'
  return String(v)
}

// Compare two versions of an entity over a set of labeled fields.
// Returns { lines, prev } — `lines` are human "Label: old → new" strings for the
// detail view, `prev` is a map of the changed fields' previous values (used to
// build an update-based undo). undefined is normalised to null for Firestore.
export function fieldDiff(before, after, fields) {
  const lines = []
  const prev = {}
  for (const { key, label, format } of fields) {
    const b = before?.[key]
    const a = after?.[key]
    const bs = format ? format(b) : show(b)
    const as = format ? format(a) : show(a)
    if (bs !== as) {
      lines.push(`${label}: ${bs} → ${as}`)
      prev[key] = b === undefined ? null : b
    }
  }
  return { lines, prev }
}

// One "Label: value" line per non-empty field — used to describe a created or
// deleted entity in the detail view.
export function fieldSummaryLines(data, fields) {
  const lines = []
  for (const { key, label, format } of fields) {
    const s = format ? format(data?.[key]) : show(data?.[key])
    if (s && s !== '—') lines.push(`${label}: ${s}`)
  }
  return lines
}
