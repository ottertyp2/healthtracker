# Healthtracker

iPhone-first PWA for personal health, food, training and ChatGPT Agent automation.

## What this MVP does

- Firebase Spark compatible: Auth, Firestore and Hosting only.
- No Cloud Functions and no Firebase Storage dependency.
- Google Drive stores meal photos. Firestore stores the raw health/lifestyle data and photo metadata.
- Built-in shopping list with manual add/edit/delete/check-off and suggestions from planned home meals.
- Body map logging tracks pain and soreness per muscle group and recommends a low-risk gym day.
- A token-based Agent Console exposes raw data snapshots and nutrition research queues to ChatGPT Agent.
- Unknown meals are queued for Agent research instead of receiving invented generic nutrition values.
- A token-based Shortcut URL lets iOS Shortcuts open the PWA and save daily Health values into Firestore.

## Setup

1. Copy `.env.example` to `.env.local`.
2. Fill in your Firebase web app config.
3. Optional but recommended: create a Google OAuth web client and set `VITE_GOOGLE_DRIVE_CLIENT_ID`.
4. In Google Cloud, enable Google Drive API for that OAuth client if you want Drive photo uploads.
5. Install dependencies and run locally:

```bash
npm install
npm run dev
```

## Firebase

Deploy hosting and Firestore rules:

```bash
npm run build
npm run firebase:deploy
```

## iPhone use

Open the hosted URL in Safari and choose Share -> Add to Home Screen.

## iPhone Health import

The app cannot read Apple Health directly from the browser. Use the base URL from the Automation tab in an iOS Shortcut that reads Health samples, calculates values, and opens:

```text
...?shortcutToken=TOKEN&date=YYYY-MM-DD&sleepHours=7.4&steps=8200&restingHeartRate=58&weightKg=80.2&bodyFatPct=14.1
```

Supported URL parameters are `date`, `sleepHours`, `sleepStart`, `sleepEnd`, `steps`, `restingHeartRate`, `weightKg`, and `bodyFatPct`. Alternatively pass `healthPayload` as URL-encoded JSON with the same keys.

## Agent workflow

Run ChatGPT Agent every full hour against the Agent Console URL from the Automation tab. The Agent should update Calendar only through connected workflows, research queued meal nutrition with sources, and write an `agentRun` including `nutritionUpdates` plus structured `taskActions`. Use "Naehrwerte uebernehmen" to apply researched values and "Agent-Items uebernehmen" to move shopping suggestions into the app's built-in Einkaufsliste.

## Important privacy note

The Agent Console uses a long random token URL. Anyone with that URL can read the mirrored raw data snapshot and create agent run logs. Rotate the token from the Automation screen if it leaks.
