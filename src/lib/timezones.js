// ─── Timezone utilities for Wander ───────────────────────────────────────────

// A curated list of the most commonly used timezones, grouped by region.
// Uses IANA timezone IDs which are valid in both the browser Intl API and ICS files.
export const TIMEZONE_GROUPS = [
  {
    label: 'Europe',
    zones: [
      { id: 'Europe/London',     label: 'London (GMT/BST)' },
      { id: 'Europe/Dublin',     label: 'Dublin (GMT/IST)' },
      { id: 'Europe/Lisbon',     label: 'Lisbon (WET/WEST)' },
      { id: 'Europe/Paris',      label: 'Paris / Berlin / Rome (CET/CEST)' },
      { id: 'Europe/Amsterdam',  label: 'Amsterdam / Brussels (CET/CEST)' },
      { id: 'Europe/Madrid',     label: 'Madrid (CET/CEST)' },
      { id: 'Europe/Zurich',     label: 'Zurich (CET/CEST)' },
      { id: 'Europe/Stockholm',  label: 'Stockholm / Oslo (CET/CEST)' },
      { id: 'Europe/Warsaw',     label: 'Warsaw (CET/CEST)' },
      { id: 'Europe/Athens',     label: 'Athens / Helsinki (EET/EEST)' },
      { id: 'Europe/Helsinki',   label: 'Helsinki (EET/EEST)' },
      { id: 'Europe/Istanbul',   label: 'Istanbul (TRT)' },
      { id: 'Europe/Moscow',     label: 'Moscow (MSK)' },
    ],
  },
  {
    label: 'Americas',
    zones: [
      { id: 'America/New_York',      label: 'New York / Miami (ET)' },
      { id: 'America/Chicago',       label: 'Chicago / Dallas (CT)' },
      { id: 'America/Denver',        label: 'Denver / Phoenix (MT)' },
      { id: 'America/Los_Angeles',   label: 'Los Angeles / Seattle (PT)' },
      { id: 'America/Anchorage',     label: 'Anchorage (AKT)' },
      { id: 'Pacific/Honolulu',      label: 'Honolulu (HST)' },
      { id: 'America/Toronto',       label: 'Toronto (ET)' },
      { id: 'America/Vancouver',     label: 'Vancouver (PT)' },
      { id: 'America/Mexico_City',   label: 'Mexico City (CT)' },
      { id: 'America/Bogota',        label: 'Bogotá / Lima (COT/PET)' },
      { id: 'America/Caracas',       label: 'Caracas (VET)' },
      { id: 'America/Santiago',      label: 'Santiago (CLT/CLST)' },
      { id: 'America/Sao_Paulo',     label: 'São Paulo / Rio (BRT)' },
      { id: 'America/Buenos_Aires',  label: 'Buenos Aires (ART)' },
      { id: 'America/Halifax',       label: 'Halifax (AT)' },
      { id: 'America/St_Johns',      label: 'St John\'s (NT)' },
    ],
  },
  {
    label: 'Asia & Pacific',
    zones: [
      { id: 'Asia/Dubai',          label: 'Dubai / Abu Dhabi (GST)' },
      { id: 'Asia/Karachi',        label: 'Karachi / Islamabad (PKT)' },
      { id: 'Asia/Kolkata',        label: 'Mumbai / Delhi / Kolkata (IST)' },
      { id: 'Asia/Dhaka',          label: 'Dhaka (BST)' },
      { id: 'Asia/Yangon',         label: 'Yangon (MMT)' },
      { id: 'Asia/Bangkok',        label: 'Bangkok / Jakarta (ICT/WIB)' },
      { id: 'Asia/Singapore',      label: 'Singapore / KL / Manila (SGT/MYT/PHT)' },
      { id: 'Asia/Shanghai',       label: 'Beijing / Shanghai (CST)' },
      { id: 'Asia/Hong_Kong',      label: 'Hong Kong (HKT)' },
      { id: 'Asia/Taipei',         label: 'Taipei (CST)' },
      { id: 'Asia/Tokyo',          label: 'Tokyo / Osaka (JST)' },
      { id: 'Asia/Seoul',          label: 'Seoul (KST)' },
      { id: 'Australia/Perth',     label: 'Perth (AWST)' },
      { id: 'Australia/Adelaide',  label: 'Adelaide (ACST/ACDT)' },
      { id: 'Australia/Sydney',    label: 'Sydney / Melbourne (AEST/AEDT)' },
      { id: 'Pacific/Auckland',    label: 'Auckland (NZST/NZDT)' },
      { id: 'Pacific/Fiji',        label: 'Fiji (FJT)' },
    ],
  },
  {
    label: 'Africa & Middle East',
    zones: [
      { id: 'Africa/Casablanca',   label: 'Casablanca (WET)' },
      { id: 'Africa/Lagos',        label: 'Lagos / Kinshasa (WAT)' },
      { id: 'Africa/Cairo',        label: 'Cairo (EET)' },
      { id: 'Africa/Nairobi',      label: 'Nairobi / Addis Ababa (EAT)' },
      { id: 'Africa/Johannesburg', label: 'Johannesburg (SAST)' },
      { id: 'Asia/Riyadh',         label: 'Riyadh / Kuwait (AST)' },
      { id: 'Asia/Beirut',         label: 'Beirut / Amman (EET/EEST)' },
      { id: 'Asia/Jerusalem',      label: 'Jerusalem (IST/IDT)' },
      { id: 'Asia/Tehran',         label: 'Tehran (IRST/IRDT)' },
      { id: 'Asia/Tbilisi',        label: 'Tbilisi / Baku (GET/AZT)' },
    ],
  },
  {
    label: 'UTC / Other',
    zones: [
      { id: 'UTC',               label: 'UTC (Coordinated Universal Time)' },
      { id: 'Etc/GMT+12',        label: 'UTC−12' },
      { id: 'Etc/GMT+11',        label: 'UTC−11' },
      { id: 'Etc/GMT+10',        label: 'UTC−10' },
      { id: 'Etc/GMT-1',         label: 'UTC+1' },
      { id: 'Etc/GMT-2',         label: 'UTC+2' },
      { id: 'Etc/GMT-3',         label: 'UTC+3' },
      { id: 'Etc/GMT-4',         label: 'UTC+4' },
      { id: 'Etc/GMT-5',         label: 'UTC+5' },
      { id: 'Etc/GMT-5.5',       label: 'UTC+5:30' },
      { id: 'Etc/GMT-6',         label: 'UTC+6' },
      { id: 'Etc/GMT-7',         label: 'UTC+7' },
      { id: 'Etc/GMT-8',         label: 'UTC+8' },
      { id: 'Etc/GMT-9',         label: 'UTC+9' },
      { id: 'Etc/GMT-10',        label: 'UTC+10' },
      { id: 'Etc/GMT-11',        label: 'UTC+11' },
      { id: 'Etc/GMT-12',        label: 'UTC+12' },
    ],
  },
]

// Flat list for lookups
export const ALL_TIMEZONES = TIMEZONE_GROUPS.flatMap(g => g.zones)

// Get the display label for a timezone ID
export function tzLabel(id) {
  return ALL_TIMEZONES.find(z => z.id === id)?.label || id
}

// Try to detect the browser's local timezone
export function localTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

// Find the closest match in our list to the browser timezone.
// Returns the matched ID or falls back to UTC.
export function nearestTimezone(ianaId) {
  if (!ianaId) return 'UTC'
  // Exact match
  if (ALL_TIMEZONES.find(z => z.id === ianaId)) return ianaId
  // Try prefix match (e.g. "America/Indiana/Indianapolis" → "America/New_York")
  const region = ianaId.split('/')[0]
  const fallback = ALL_TIMEZONES.find(z => z.id.startsWith(region))
  return fallback?.id || 'UTC'
}

// Format a datetime-local value + IANA timezone into a human-readable string
// e.g. "2024-06-15T14:30" + "Asia/Tokyo" → "Jun 15, 2024, 2:30 PM JST"
export function formatWithTZ(datetimeLocal, tzId) {
  if (!datetimeLocal || !tzId) return null
  try {
    const date = new Date(datetimeLocal)
    return date.toLocaleString('en-US', {
      timeZone: tzId,
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZoneName: 'short',
    })
  } catch {
    return datetimeLocal
  }
}
