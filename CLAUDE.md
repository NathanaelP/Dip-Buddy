# CLAUDE.md — Dips & Hummus Floor Tracker

## Project Overview

A Progressive Web App (PWA) for deli associates to track hummus and dip products on the sales floor. Built for a Publix deli in Kissimmee, FL serving a high-volume tourist population. Core purpose: eliminate expired product slipping through the cracks by making stocking events fast to log and expiration status immediately visible to the whole team.

This app replaces a weak, informal tracking system. It is a real operational tool used on the clock by real associates.

---

## Tech Stack

- **Frontend**: Vanilla HTML, CSS, JavaScript — no framework
- **Database**: Firebase Firestore (real-time, cloud-hosted)
- **Auth**: Firebase Email/Password Authentication
- **Product Lookup**: Open Food Facts API (free, no key required)
- **Barcode Scanning**: QuaggaJS or ZXing-js via CDN
- **OCR**: Tesseract.js via CDN (for reading expiration dates from label photos)
- **Hosting**: GitHub Pages
- **Service Worker**: Custom — caches app shell for offline resilience

> No build tools. No npm. No bundler. CDN imports only. The app must run as static files hosted on GitHub Pages.

---

## Firebase Configuration

Place the Firebase config in `/js/firebase-config.js`. This file is gitignored. A template is committed as `/js/firebase-config.template.js`.

```javascript
// js/firebase-config.js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
```

Use Firebase SDK v9 compat mode (CDN, not modular) so it works without a bundler.

---

## File Structure

```
/
├── index.html              — app shell, auth gate
├── manifest.json           — PWA manifest
├── service-worker.js       — caches app shell
├── CLAUDE.md               — this file
│
├── /css
│   └── styles.css          — all styles, CSS variables, dark theme default
│
├── /js
│   ├── firebase-config.js  — gitignored, real credentials
│   ├── firebase-config.template.js — committed placeholder
│   ├── auth.js             — login, logout, session persistence
│   ├── dashboard.js        — floor item list, status calculation, real-time listener
│   ├── add-item.js         — barcode scan, product lookup, OCR, form submit
│   ├── products.js         — product catalog browser and editor
│   ├── settings.js         — admin panel (role-gated)
│   └── utils.js            — shared helpers (date math, uuid, formatting)
│
└── /views
    ├── dashboard.html      — floor item list view
    ├── add-item.html       — add new floor item
    ├── products.html       — product catalog
    └── settings.html       — admin settings
```

The app is single-page with view switching via JS (hide/show sections or hash routing). Do not use separate HTML pages with full reloads.

---

## Data Model

### Firestore Collections

#### `/products/{barcode}`
The product catalog. Built over time. Never deleted.

```json
{
  "barcode": "014400085805",
  "name": "Sabra Classic Hummus 10oz",
  "brand": "Sabra",
  "category": "hummus",
  "slowMover": false,
  "imageUrl": "https://...",
  "addedAt": "2026-05-21",
  "addedBy": "uid"
}
```

- `slowMover: true` means this product should be pulled in the **morning** on its pull date
- `slowMover: false` means pull in the **evening** on its pull date
- `barcode` is the document ID

#### `/floorItems/{id}`
Each stocking event. One record per time a product is put on the floor.

```json
{
  "id": "uuid-v4",
  "barcode": "014400085805",
  "productName": "Sabra Classic Hummus 10oz",
  "quantity": null,
  "dateStocked": "2026-05-21",
  "expDate": "2026-05-28",
  "pullDate": "2026-05-27",
  "location": "Dips Case 2",
  "slowMover": false,
  "status": "active",
  "notes": "",
  "addedBy": "uid",
  "addedByName": "Nathanael",
  "addedAt": "2026-05-21T10:32:00",
  "updatedAt": "2026-05-21T10:32:00"
}
```

- `quantity` is optional. Store `null` if not entered. Never store `0` unless actually zero.
- `pullDate` is always `expDate - 1 day`. Calculate and store on save.
- `slowMover` is copied from the Product at save time so it stays accurate even if the product is later updated.
- `productName` is denormalized (copied from product catalog) so renaming a product does not corrupt historical records.
- `status` values: `"active"` | `"pulled"` | `"expired"`

#### `/users/{uid}`
One document per registered user, created on first login.

```json
{
  "uid": "firebase-auth-uid",
  "name": "Nathanael",
  "email": "nathanael@example.com",
  "role": "admin",
  "createdAt": "2026-05-21T10:00:00"
}
```

- `role` values: `"admin"` | `"associate"`
- Only `admin` users can access `/views/settings.html` and manage users

#### `/settings/global`
Single document. Global app configuration.

```json
{
  "warnDaysBefore": 3,
  "theme": "dark"
}
```

---

## Business Logic

### Pull Date Rule
**Always `expDate - 1 day`. This is company policy. It is never configurable per product.**

```javascript
function calcPullDate(expDateStr) {
  const d = new Date(expDateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}
```

### Status Calculation
Run on every dashboard load against today's date.

```javascript
function getStatus(item, today, warnDaysBefore) {
  const pull = new Date(item.pullDate);
  const exp  = new Date(item.expDate);
  const now  = new Date(today);

  if (now >= exp)  return 'expired';
  if (now >= pull) return 'pull';
  if ((pull - now) / 86400000 <= warnDaysBefore) return 'warn';
  return 'good';
}
```

### Status Display

| Status | Color | Label |
|--------|-------|-------|
| `expired` | Red | "Expired" |
| `pull` | Orange | "Pull Today — Morning" or "Pull Today — Evening" |
| `warn` | Amber | "Pulls in X days" |
| `good` | Green | "Good" |

Morning vs Evening is determined by `item.slowMover`. Only shown when status is `pull`.

### Dashboard Sort Order
Always sort by `pullDate` ascending — most urgent items at the top. Expired items float above everything else.

---

## Notifications

**There are NO push notifications. This is intentional.**

Associates should not be disturbed on days off. Expiration alerts surface only when the app is actively opened. On dashboard load, if any items are in `pull` or `expired` status, show a prominent banner at the top of the dashboard summarizing the count. The banner taps/clicks to scroll to those items.

Do not implement FCM. Do not request notification permissions.

---

## Authentication Flow

1. App opens → check `firebase.auth().currentUser`
2. If no session → show login screen (email + password)
3. On successful login → load dashboard, create `/users/{uid}` doc if first login
4. Session persists across app close — associate logs in once per device
5. Logout option in settings/menu

---

## Adding a Floor Item — Full Flow

```
1. Tap "Add Item"
2. Choose input method:
   A. Scan barcode
      → Check Firestore /products (instant)
      → Not found: query Open Food Facts API
        → Found: show result, let user confirm/edit name
        → Not found: manual name entry
      → Product confirmed → proceed to step 3
   B. Manual product search / select from catalog

3. Optional: Tap "Scan Label" → camera opens → capture image
   → Canvas preprocessing (contrast boost, threshold)
   → Tesseract.js reads text → parse for date pattern
   → Show parsed date, let user confirm or correct

4. Enter expDate (pre-filled if OCR succeeded)
5. Enter location (optional, e.g. "Dips Case 2")
6. Enter quantity (optional)
7. Toggle slowMover if applicable (defaults from product catalog)
8. Tap Save
   → Calculate pullDate = expDate - 1
   → Write to Firestore /floorItems
   → All associates' dashboards update in real time via listener
```

---

## Open Food Facts API

No API key required. GET request only.

```javascript
async function lookupBarcode(barcode) {
  const url = `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  const data = await res.json();
  if (data.status === 1) {
    return {
      name: data.product.product_name,
      brand: data.product.brands,
      imageUrl: data.product.image_url || null
    };
  }
  return null; // not found — fall through to manual entry
}
```

Always set a timeout (4 seconds). Always handle failure gracefully — fall through to manual entry without breaking the UI.

---

## OCR — Expiration Date Parsing

Use Tesseract.js loaded via CDN. Before passing the image to Tesseract, preprocess on a canvas:
- Convert to grayscale
- Boost contrast
- Apply binary threshold (black/white)

This improves dot matrix label accuracy significantly.

After OCR, parse the result for common date patterns:

```javascript
const DATE_PATTERNS = [
  /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,   // MM/DD/YY or MM-DD-YYYY
  /([A-Z]{3})\s?(\d{1,2})\s?(\d{2,4})/i,         // MAY 28 2026
  /(\d{4})[\/\-](\d{2})[\/\-](\d{2})/,            // YYYY-MM-DD
];
```

Always show the parsed result to the user for confirmation before saving. Never silently accept OCR output.

---

## Offline Behavior

Enable Firestore offline persistence:

```javascript
db.enablePersistence().catch(err => {
  console.warn('Offline persistence unavailable:', err.code);
});
```

This caches recent Firestore reads locally and queues writes when disconnected. When WiFi drops mid-shift, adds still work and sync when connection returns. Show a subtle "Offline" indicator in the UI when `navigator.onLine === false`.

The service worker caches the app shell (HTML, CSS, JS, CDN assets) so the app loads even with no connection.

---

## UI / Design

- **Default theme**: Dark
- **Color palette**: Deep navy/charcoal backgrounds, white text, with status colors:
  - Expired: `#ef4444` (red)
  - Pull Today: `#f97316` (orange)
  - Warn: `#f59e0b` (amber)
  - Good: `#22c55e` (green)
- **Font**: Clean, legible — this is a work tool used quickly on small screens
- **Mobile-first**: Designed for phone use in a deli environment. Large tap targets (min 48px). No hover-dependent interactions.
- **Bottom navigation bar**: Dashboard | Add Item | Products | Settings
- Cards for each floor item showing: product name, location, expDate, pullDate, status badge, addedByName

---

## Roles

| Feature | Associate | Admin |
|---------|-----------|-------|
| View dashboard | ✅ | ✅ |
| Add floor item | ✅ | ✅ |
| Mark item pulled | ✅ | ✅ |
| Edit/delete any item | ❌ | ✅ |
| View product catalog | ✅ | ✅ |
| Edit product catalog | ❌ | ✅ |
| Access settings | ❌ | ✅ |
| Manage users | ❌ | ✅ |

The first user account created should be manually promoted to admin in Firestore. Subsequent users default to `associate`.

---

## Environment Notes

- Publix deli backroom WiFi may be spotty — offline resilience is important
- Associates use phones on the clock — UI must be fast and thumb-friendly
- Some product labels use dot matrix printed dates — OCR preprocessing is required
- Some product boxes have clean sticker labels on the outside — these scan and OCR well

---

## Build Order

1. Firebase project wired up, auth working, login screen functional
2. Firestore read — dashboard loads floor items from Firestore
3. Firestore real-time listener — dashboard auto-updates when another user adds an item
4. Status calculation and color-coded dashboard display
5. Manual add item form (no scanning yet)
6. Barcode scanning → Firestore product lookup
7. Open Food Facts fallback for unknown barcodes
8. Camera capture → Tesseract OCR for date field
9. Product catalog browser (view, edit, slowMover toggle)
10. Admin settings panel and user role management
11. Service worker + PWA manifest
12. Offline indicator and Firestore persistence
