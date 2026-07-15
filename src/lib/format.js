// Display-preference helpers. Weather is always fetched in Celsius and times are
// stored as 24h wall-clock strings; these convert at render time based on the
// user's profile prefs (temp_unit: 'C'|'F', time_format: '12'|'24').

export const DEFAULT_TEMP_UNIT = 'C'
export const DEFAULT_TIME_FORMAT = '12'

export function cToF(c) {
  return c * 9 / 5 + 32
}

// Round a Celsius value into the user's unit and label it. Pass just the number
// for a bare "72°"; pass withUnit to get "72°F".
export function formatTemp(celsius, unit = DEFAULT_TEMP_UNIT, { withUnit = false } = {}) {
  if (celsius == null || Number.isNaN(celsius)) return '—'
  const f = unit === 'F'
  const val = Math.round(f ? cToF(celsius) : celsius)
  return `${val}°${withUnit ? (f ? 'F' : 'C') : ''}`
}

// True when the user wants a 12-hour clock.
export function isHour12(timeFormat = DEFAULT_TIME_FORMAT) {
  return timeFormat !== '24'
}

// Format an "HH:MM" wall-clock string in the user's clock format.
// "14:30" → "2:30 PM" (12h) or "14:30" (24h).
export function formatClock(hhmm, timeFormat = DEFAULT_TIME_FORMAT) {
  if (!hhmm) return ''
  const [hRaw, mRaw] = hhmm.split(':')
  let h = Number(hRaw)
  const m = Number(mRaw || 0)
  if (Number.isNaN(h)) return ''
  if (!isHour12(timeFormat)) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`
}
