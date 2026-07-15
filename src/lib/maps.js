// Open a place in whatever map app the device prefers.
//
// The `geo:` scheme is honoured by Android (and offered as a chooser). iOS and
// desktop don't handle bare `geo:` well, so there we hand off to a universal
// Google Maps search URL, which iOS will deep-link into Apple/Google Maps and
// desktop opens in the browser. We pick based on a light platform sniff.

function isIOS() {
  if (typeof navigator === 'undefined') return false
  return /iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent) ||
    // iPadOS 13+ reports as Mac with touch
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}
function isAndroid() {
  return typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent || '')
}

// Build the best maps URL for a free-text place (address, hotel name, city…).
export function mapsUrl(query) {
  const q = encodeURIComponent((query || '').trim())
  if (!q) return null
  if (isAndroid()) return `geo:0,0?q=${q}`
  if (isIOS())     return `https://maps.apple.com/?q=${q}`
  return `https://www.google.com/maps/search/?api=1&query=${q}`
}

// Open the place. Returns false if there was nothing to open.
export function openInMaps(query) {
  const url = mapsUrl(query)
  if (!url) return false
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}
