# Healthtracker

iPhone-first PWA for personal health, food, training, recovery and Gemini-based insight automation.

## What this MVP does

- Firebase-backed app with Auth, Firestore, Hosting and Functions.
- Google OAuth stays enabled for sign-in and optional Drive photo uploads.
- Firestore stores health, food, training, shopping and private Gemini run data.
- Built-in shopping list with manual add/edit/delete/check-off and suggestions from planned home meals.
- Body map logging tracks pain and soreness per muscle group and recommends a low-risk gym day.
- Gemini reads a private Firestore snapshot, writes `geminiRuns`, researches queued meal nutrition when it has concrete sources, and proposes low-friction next steps.
- Unknown meals are queued for Gemini research instead of receiving invented generic nutrition values.
- A token-based Shortcut URL lets iOS Shortcuts open the PWA and save daily Health values into Firestore.

## Setup

1. Copy `.env.example` to `.env.local`.
2. Fill in your Firebase web app config.
3. Optional but recommended: create a Google OAuth web client and set `VITE_GOOGLE_DRIVE_CLIENT_ID`.
4. In Google Cloud, enable Google Drive API for that OAuth client if you want Drive photo uploads.
5. Set the Gemini API key as a Firebase Functions secret:

```bash
firebase functions:secrets:set GEMINI_API_KEY
```

6. Install dependencies and run locally:

```bash
npm install
npm run dev
```

## Firebase

Deploy hosting, Firestore rules/indexes and Functions:

```bash
npm run build
npm run firebase:deploy
```

## iPhone use

Open the hosted URL in Safari and choose Share -> Add to Home Screen.

## iPhone Health import

The app cannot read Apple Health directly from the browser. Use the base URL from the KI tab in an iOS Shortcut that reads Health samples, calculates values, and opens:

```text
...?shortcutToken=TOKEN&date=YYYY-MM-DD&sleepHours=7.4&steps=8200&restingHeartRate=58&weightKg=80.2&bodyFatPct=14.1
```

Supported URL parameters are `date`, `sleepHours`, `sleepStart`, `sleepEnd`, `steps`, `restingHeartRate`, `weightKg`, and `bodyFatPct`. Alternatively pass `healthPayload` as URL-encoded JSON with the same keys.

## Gemini workflow

Die App nutzt Gemini fuer Automation im Healthtracker:

1. `.env.local` mit `VITE_GEMINI_API_KEY` anlegen.
2. Optional `VITE_GEMINI_MODEL=gemini-2.5-flash` setzen.
3. App starten.
4. Im Tab `Gemini` auf `Gemini ausfuehren` klicken.
5. Gemini erhaelt den aktuellen App-Kontext als strukturiertes JSON.
6. Gemini gibt strukturierte JSON-Ergebnisse zurueck:
   - `nutritionUpdates` fuer geschaetzte Naehrwerte
   - `taskActions` fuer Einkaufslisten-Vorschlaege
   - `warnings`
   - `nextPriorities`

Hinweis: `VITE_GEMINI_API_KEY` ist im Browser sichtbar. Fuer produktive Nutzung sollte der Gemini-Aufruf ueber einen Backend-/Cloud-Function-Proxy laufen.
