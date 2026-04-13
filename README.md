# ✈️ Wander — Collaborative Trip Planner (Firebase)

Mobile-first, dark & elegant travel planning — React + Tailwind CSS v3 + Firebase.

## Features
- 🗺️ Collaborative trips — invite friends by email
- 📅 Day-by-day itinerary — events with type, time, location, assignee
- 🌤️ Live weather via Open-Meteo (free, no API key)
- 🧳 Per-person travel details — flights, trains, accommodation
- 🗳️ Polls with live vote percentages
- 📸 Photo album links — Google Photos, iCloud, Dropbox, Flickr

---

## Setup (5 minutes)

### 1. Firebase Console Setup

1. Go to https://console.firebase.google.com
2. Open your project (or create one with the free Spark plan)

### 2. Enable Authentication
- Sidebar → **Build → Authentication → Get started**
- Under **Sign-in method**, enable **Email/Password**

### 3. Enable Firestore
- Sidebar → **Build → Firestore Database → Create database**
- Choose **Start in production mode** → pick a region close to your users

### 4. Deploy Security Rules
- In Firestore → **Rules** tab, paste the contents of `firebase/firestore.rules` and click **Publish**

### 5. Deploy Composite Indexes
  Option A — automatic (recommended):
  Just run the app. When a query needs an index, Firestore will print a direct link
  in the browser console — click it to create the index in one step.

  Option B — Firebase CLI:
  ```bash
  npm install -g firebase-tools
  firebase login
  firebase init firestore   # point to your project
  firebase deploy --only firestore:indexes
  ```

### 6. Get Your Config
- Firebase Console → **Project Settings** (gear icon) → **Your apps** → **Web app**
- If no web app exists, click **Add app → Web**, give it a name
- Copy the `firebaseConfig` object values

### 7. Set Environment Variables
```bash
cp .env.example .env
```
Fill in your values:
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

### 8. Install & Run
```bash
npm install
npm run dev
```
Visit http://localhost:5173

---

## Project Structure
```
src/
  contexts/AuthContext.jsx       # Firebase Auth state + profile sync
  lib/firebase.js                # Firebase app init (auth + db)
  lib/weather.js                 # Open-Meteo API (no key needed)
  pages/
    AuthPage.jsx                 # Sign in / Sign up
    TripsPage.jsx                # Trip list
    TripDetailPage.jsx           # Trip hub (tabbed)
  components/
    ItineraryTab.jsx             # Day planner + weather
    TravelersTab.jsx             # Per-person details + invite
    PollsTab.jsx                 # Voting polls
    PhotosTab.jsx                # Album links
    NewTripModal.jsx             # Create trip
    BottomNav.jsx                # Mobile nav
firebase/
  firestore.rules                # Security rules
  firestore.indexes.json         # Composite indexes
```

## Firestore Collections
| Collection | Purpose |
|---|---|
| `profiles` | User display names & emails |
| `trips` | Trip metadata (name, dates, destination, coords) |
| `trip_members` | User ↔ trip membership + role |
| `itinerary_events` | Per-day events |
| `travel_details` | Per-person travel info |
| `polls` | Poll questions |
| `poll_options` | Options per poll |
| `poll_votes` | One vote per user per poll |
| `photo_albums` | Linked album URLs |

## Deploy to Vercel
```bash
npm i -g vercel && vercel
```
Add all `VITE_FIREBASE_*` vars in Vercel → Project Settings → Environment Variables.
