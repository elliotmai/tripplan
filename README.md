# ✈️ Wander — Collaborative Trip Planner

Mobile-first, dark & elegant travel planning for groups — **React + Tailwind CSS v3 + Firebase**.

Plan trips together: agree on dates, build a day-by-day itinerary, track everyone's flights live, brainstorm ideas, and keep travel logistics in one place.

---

## Features

- 🗺️ **Collaborative trips** — invite friends by email or from your friends list
- 🗳️ **Date planning** — When2Meet-style availability grid; everyone taps the days they're free and the app suggests the best window, which the owner can lock in as the trip dates
- 📅 **Day-by-day itinerary** — events with type, time, location, and assignees, with live weather
- 🌤️ **Live weather** via Open-Meteo (free, no API key)
- 🧳 **Per-person travel** — flights, trains, ferries, and accommodation, timezone-aware
- ✈️ **Live flight tracking** — a dedicated **Flights** tab shows every in-progress trip's currently-airborne flights on a live map, labelled with which trip and who's on board (via the Flightradar24 API)
- 💭 **Brainstorm (Ideas)** — a low-friction idea board with upvotes and comments
- 🗺️ **Tap-to-map** — tap any accommodation address or event location to open it in your device's maps app
- 📊 **Polls** — group voting with live percentages
- 📸 **Photo albums** — link Google Photos, iCloud, Dropbox, or Flickr
- 👀 **Observers** — add people who can view a trip without travelling (BCC-style: observers can't see each other, and travellers only see the observers they add)
- 👥 **Roles** — promote observers to travellers, demote travellers to observers, and remove people from a trip
- 🔧 **Preferences** — per-user °C/°F and 12/24-hour toggles that apply throughout the app
- 📆 **Calendar subscription** — subscribe to a trip's itinerary/travel as a live ICS feed (Google Calendar, Apple Calendar, etc.)
- 🤝 **Friends** — send/accept friend requests; trip-mates are auto-friended

---

## Tech stack

- **React 19** + **Vite** + **React Router 7**
- **Tailwind CSS v3**
- **Firebase** — Auth (email/password) + Firestore
- **Firebase Cloud Functions** — ICS calendar feed + flight-tracking proxy
- **Leaflet / react-leaflet** — live flight map (free CARTO dark tiles, no map key)
- **date-fns** — date handling
- **lucide-react** — icons

---

## Setup (≈5–10 minutes)

### 1. Firebase Console
1. Go to https://console.firebase.google.com and open (or create) a project — the free Spark plan is fine to start, but the flight-tracking and calendar Cloud Functions require the **Blaze** (pay-as-you-go) plan.

### 2. Enable Authentication
- **Build → Authentication → Get started**
- Under **Sign-in method**, enable **Email/Password**

### 3. Enable Firestore
- **Build → Firestore Database → Create database**
- Start in **production mode** → pick a region close to your users

### 4. Deploy Security Rules
- In Firestore → **Rules**, paste the contents of `firebase/firestore.rules` and **Publish**
  (or use the CLI: `firebase deploy --only firestore:rules`)

### 5. Deploy Composite Indexes
- **Option A (recommended):** run the app; when a query needs an index, Firestore prints a direct link in the browser console — click it to create it in one step.
- **Option B (CLI):**
  ```bash
  npm install -g firebase-tools
  firebase login
  firebase init firestore
  firebase deploy --only firestore:indexes
  ```

### 6. Get your web config
- **Project Settings** (gear) → **Your apps** → **Web app** (create one if needed) → copy the `firebaseConfig` values.

### 7. Environment variables
```bash
cp .env.example .env   # if present; otherwise create .env
```
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

# Needed for calendar subscription and live flight tracking (your deployed functions base URL)
VITE_FUNCTIONS_BASE_URL=https://REGION-PROJECT.cloudfunctions.net
```

### 8. Install & run
```bash
npm install
npm run dev
```
Visit http://localhost:5173

---

## Optional integrations

### Live flight tracking (Flightradar24)

The **Flights** tab and the per-trip **Track live** button plot airborne flights on a live map. The Flightradar24 API token is held **server-side** by the `trackFlight` Cloud Function so it never ships in the client bundle.

1. Get an API token from the [Flightradar24 API portal](https://fr24api.flightradar24.com/) (there's a free sandbox to test against; live positions require a paid plan).
2. Give the function the token — add to `functions/.env`:
   ```
   FR24_API_KEY=your_token_here
   ```
   (or `firebase functions:secrets:set FR24_API_KEY`)
3. Make sure `VITE_FUNCTIONS_BASE_URL` points at your deployed functions.
4. Deploy: `firebase deploy --only functions`

Behaviour & guarantees:
- Only flights whose **scheduled window is happening now** (± a cushion for early departures/delays) are polled, and only for trips **currently in progress** — so dormant flights never cost API calls.
- The function caches responses briefly and backs off on rate limits; the client backs off too. If tracking isn't configured, the UI shows a friendly "not set up" state instead of erroring.
- A flight only appears while it's actually airborne and broadcasting ADS-B.

### Calendar subscription (ICS)

The **Subscribe** button on a trip generates a tokenised ICS feed served by the `calendarFeed` Cloud Function, which any calendar app can subscribe to for live updates. Requires `VITE_FUNCTIONS_BASE_URL` and deployed functions. All events are emitted with correct `VTIMEZONE` data so times land in the right zone.

Deploy functions:
```bash
cd functions && npm install && cd ..
firebase deploy --only functions
```

---

## Project structure

```
src/
  App.jsx                          # Routes (Trips, Flights, Friends, Account, Trip detail)
  main.jsx
  contexts/
    AuthContext.jsx                # Firebase Auth state, profile sync, display preferences
  lib/
    firebase.js                    # Firebase app init (auth + db)
    weather.js                     # Open-Meteo (no key) + geocoding
    timezones.js                   # IANA zone list + wall-clock ↔ instant conversion
    travel.js                      # Unified read layer for legs/accommodations
    ical.js                        # Client-side ICS generation (timezone-aware)
    calendarTokens.js              # Calendar-feed token helpers
    friends.js                     # Friendship queries + auto-friending
    flightTracking.js              # Flight-tracking client + active-window logic
    format.js                      # Temperature/clock formatting per user preference
    maps.js                        # Open a location in the device's maps app
  pages/
    AuthPage.jsx                   # Sign in / sign up
    TripsPage.jsx                  # Trip list + "Observing" section
    TripDetailPage.jsx             # Trip hub (tabbed) + observer detection
    FlightsPage.jsx                # Global live flight map across in-progress trips
    FriendsPage.jsx                # Friend requests & list
    AccountPage.jsx                # Profile, stats, preferences (°C/°F, 12/24h)
  components/
    BottomNav.jsx                  # Mobile nav (Trips / Flights / Friends / Account)
    ItineraryTab.jsx               # Day planner + weather + tap-to-map
    DatesTab.jsx                   # When2Meet-style date availability poll
    TravelersTab.jsx               # Per-person travel, invites, roles, observers
    ObserversSection.jsx           # BCC-style observer management
    BrainstormTab.jsx              # Idea board (upvotes + comments)
    PollsTab.jsx                   # Voting polls
    PhotosTab.jsx                  # Album links
    FlightMap.jsx                  # Live Leaflet flight map
    TimezonePicker.jsx             # IANA timezone selector
    NewTripModal.jsx / EditTripSheet.jsx
    CalendarSubscribeSheet.jsx     # ICS subscription UI

firebase/
  firestore.rules                  # Security rules
  firestore.indexes.json           # Composite indexes
functions/
  index.js                         # calendarFeed + trackFlight Cloud Functions
```

---

## Firestore collections

| Collection | Purpose |
|---|---|
| `profiles` | User display names, emails, home city/airport, and display preferences (`temp_unit`, `time_format`) |
| `trips` | Trip metadata (name, dates, destination, coords, timezone, cover emoji) |
| `trip_members` | User ↔ trip membership + role (`owner` / `member`) |
| `trip_observers` | BCC-style viewers — `{ trip_id, user_id, added_by }` |
| `itinerary_events` | Per-day events |
| `travel_details` | Legacy per-user travel info |
| `trip_legs` | Shared, multi-traveller flight/transport legs (timezone-aware) |
| `trip_accommodations` | Shared, multi-traveller accommodations |
| `date_polls` | Date-availability poll window per trip |
| `date_availability` | One doc per (poll, user) holding selected dates |
| `brainstorm_ideas` | Idea board entries (with `liked_by` upvotes) |
| `brainstorm_comments` | Comments on ideas |
| `polls` / `poll_options` / `poll_votes` | Voting polls |
| `photo_albums` | Linked album URLs |
| `friendships` | Friend relationships (doc id = sorted uid pair) |
| `calendar_tokens` | Tokens for ICS calendar feeds |

---

## Cloud Functions

| Function | Type | Purpose |
|---|---|---|
| `calendarFeed` | HTTPS | Serves a tokenised ICS feed for a trip's itinerary/travel |
| `trackFlight` | HTTPS | Proxies the Flightradar24 API (keeps the token server-side), with short-lived caching and rate-limit handling |

---

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `VITE_FIREBASE_*` (6) | client `.env` | Firebase web config |
| `VITE_FUNCTIONS_BASE_URL` | client `.env` | Base URL of your deployed Cloud Functions (calendar + flight tracking) |
| `FR24_API_KEY` | `functions/.env` | Flightradar24 API token (server-side only) |

---

## Deploy

**Client (Vercel):**
```bash
npm i -g vercel && vercel
```
Add all `VITE_*` variables in Vercel → Project Settings → Environment Variables.

**Firebase (rules + functions):**
```bash
firebase deploy --only firestore:rules
firebase deploy --only functions
```

---

## Notes & caveats

- **Observer privacy is UI-enforced.** The "observers can't see each other / travellers only see the observers they add" rules are applied in the interface. Because the Firestore rules allow any authenticated user to read trip data, this is best-effort privacy suitable for a friends-planning-a-trip context — not a hard data-layer boundary. To make it airtight, route member/observer reads through a Cloud Function (as the calendar and flight-tracking features already do).
- **Flight tracking depends on your Flightradar24 plan.** Live positions require a paid tier, and per-minute rate limits scale with the plan. The app degrades gracefully (cached/stale positions and backoff) rather than breaking.
- **Times are timezone-aware.** Each travel leg stores a wall-clock time plus an IANA zone; the app renders each in its own zone and computes cross-timezone durations correctly.
- **Display preferences are per-user.** Two people on the same trip can independently see °C vs °F and 12- vs 24-hour times.