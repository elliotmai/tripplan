/**
 * End-user "What's New" entries — NEWEST FIRST.
 *
 * When you ship user-facing changes, bump `version` (use today's date as
 * YYYY.MM.DD) and add a new entry at the top with plain-language, benefit-focused
 * bullets. The next time each person opens the app, the popup shows every entry
 * newer than what their device last saw — so if several releases stacked up
 * between visits, they see them all at once (tracked per-device in localStorage).
 *
 * Skip adding an entry when a release has nothing a user would notice
 * (refactors, config, infra) — the popup only fires when a newer `version` appears.
 */
export const WHATS_NEW = [
  {
    version: '2026.09.14',
    date: 'September 2026',
    items: [
      '🔌 Account → Connected Apps lets you give another app read-only access to your trips — the dates, and the flights on them. Nothing can be changed with it, and you can disconnect any app at any time. First up: a farm housesitter board that now shows when you are back without anyone retyping a flight time into two apps.',
    ],
  },
  {
    version: '2026.07.27',
    date: 'July 2026',
    items: [
      '💡 Ideas and Polls are now one tab. Float ideas, then bundle your favourites straight into a poll (“A, B or C on Saturday?”) so the group can vote.',
      '🕰️ Every trip now has a History tab — see what changed, who changed it and when, with one-tap Undo for edits to the itinerary, ideas, polls and trip details.',
    ],
  },
  {
    version: '2026.07.26',
    date: 'July 2026',
    items: [
      '🐛 Spot a bug or have an idea? There’s now a “Report a bug or request a feature” link in the footer.',
    ],
  },
]
