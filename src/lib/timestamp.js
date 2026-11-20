/*
 * Dates the way the screens already use them.
 *
 * Wander's records came from Firestore, where dates are Timestamp objects with
 * `.seconds`, `.toDate()` and `.toMillis()`. In Supabase each record is JSON,
 * and a date is stored as {"$ts": milliseconds}. `decode` turns those back
 * into Timestamps on the way out, and `encode` turns Timestamps and Dates into
 * {"$ts"} on the way in, so no screen had to change.
 */

export class Timestamp {
  constructor(ms) {
    this._ms = Math.round(Number(ms));
    this.seconds = Math.floor(this._ms / 1000);
    this.nanoseconds = (((this._ms % 1000) + 1000) % 1000) * 1e6;
  }

  static now() { return new Timestamp(Date.now()); }

  static fromDate(date) { return new Timestamp(new Date(date).getTime()); }

  static fromMillis(ms) { return new Timestamp(ms); }

  toDate() { return new Date(this._ms); }

  toMillis() { return this._ms; }

  valueOf() { return this._ms; }

  toJSON() { return { $ts: this._ms }; }
}

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Timestamps and Dates → {"$ts"}, all the way down. */
export function encode(value) {
  if (value instanceof Timestamp) return { $ts: value.toMillis() };
  if (value instanceof Date) return { $ts: value.getTime() };
  if (value && typeof value.toMillis === 'function' && typeof value.toDate === 'function') return { $ts: value.toMillis() }; // a Firestore Timestamp (import)
  if (Array.isArray(value)) return value.map(encode);
  if (isPlain(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = encode(v);
    return out;
  }
  return value;
}

/** {"$ts"} → Timestamps, all the way down. */
export function decode(value) {
  if (Array.isArray(value)) return value.map(decode);
  if (isPlain(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === '$ts' && typeof value.$ts === 'number') return new Timestamp(value.$ts);
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = decode(v);
    return out;
  }
  return value;
}
