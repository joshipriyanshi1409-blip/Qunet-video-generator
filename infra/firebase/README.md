# Firebase

Firestore + Storage for CreatorDNA Studio. No Firebase project is required to
run the app locally — the API boots without Firebase credentials and only
rejects authenticated requests until you configure it.

## Local (emulator)

```bash
npm i -g firebase-tools
firebase login
firebase use --add            # pick your project

# from this directory
firebase emulators:start      # auth 9099, firestore 8080, storage 9199, ui 4001
```

Point the API at the emulator by setting in `apps/api/.env`:

```
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199
```

## Deploy rules

```bash
firebase deploy --only firestore:rules,storage
firebase deploy --only firestore:indexes
```

## What the rules enforce

Every creator's data lives under `users/{uid}` and only `request.auth.uid == uid`
can read it. Writes are narrower still:

| Path                       | Client read | Client write                                   |
| -------------------------- | ----------- | ---------------------------------------------- |
| `users/{uid}`              | owner       | owner, fixed field set, no delete              |
| `users/{uid}/dna/{docId}`  | owner       | owner (must stamp `uid` + `updatedAt`)         |
| `users/{uid}/jobs/{jobId}` | owner       | owner may only move a job to `cancelled`       |
| `users/{uid}/assets/*`     | owner       | none — the worker writes these                 |
| `users/{uid}/sources/*`    | owner       | owner, audio/video/image only, <100 MB         |
| `users/{uid}/trends/*`     | owner       | none — refreshed by the worker                 |
| `trends/*`, `prompts/*`    | signed in   | none                                           |

Everything not matched above is denied by the catch-all rules.

## Web client

`apps/web/src/lib/firebase.ts` initialises the client SDK from the
`VITE_FIREBASE_*` variables in `apps/web/.env`. When they are blank the app runs
in "no Firebase" mode and only the public placeholder pages work.

## API admin SDK

`apps/api/src/lib/firebase-admin.ts` initialises the Admin SDK from
`FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` /
`FIREBASE_STORAGE_BUCKET`. Keep the literal `\n` escapes in the private key —
they are converted to real newlines at boot. Without these variables the API
starts but returns `503` on endpoints that need auth verification.
