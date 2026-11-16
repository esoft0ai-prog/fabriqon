# Fabriqon — Tailoring Management (offline-first PWA)

Fabriqon is a tailoring management app for independent tailors, fashion designers, tailoring shops and garment producers. It covers customers, body measurements, styles, fabric estimation, orders and production, payments, inventory, calendar, reports and customer messages.

It is built with **HTML5, modern JavaScript (ES modules), CSS3 and IndexedDB** — no framework, no build step and no cloud database. After the first visit it **works completely offline**, and it can be installed on Android, iOS/iPadOS, Windows, macOS and Linux.

---

## Quick start

Requirements: **Node.js 18+**. It's only needed for the dev server, tests and build scripts; the app itself has no dependencies.

```bash
npm start
```

Open <http://localhost:5173>. The setup wizard creates your workspace. Tick **“Add sample customers and orders”** on the last step if you want demo data to explore.

> A service worker requires `http://localhost` or HTTPS. Opening `index.html` straight from disk (`file://`) won't work.

### Scripts

| Command | What it does |
|---|---|
| `npm start` | Serves the app on port 5173 (dependency-free static server). |
| `npm test` | Runs the automated tests (Node's built-in test runner): calculations, fabric engine, backup validation, PWA manifest and precache. |
| `npm run check` | Parses every module and verifies that all relative imports and named exports resolve. |
| `npm run build:sw` | Regenerates the service worker's precache list and version hash. **Run this after changing any app file**, or installed copies won't update. |
| `npm run build:icons` | Re-renders the PNG app icons from the logo geometry. |
| `npm run ai-proxy` | Starts the optional AI proxy (see below). |

---

## What's inside

| Module | Highlights |
|---|---|
| **Dashboard** | Every figure is calculated from your records: customers, active orders, awaiting production, being sewn, awaiting collection, completed, revenue, outstanding, monthly expenses, estimated profit, deadlines, low stock, recent activity. Charts and quick actions. |
| **Customers** | Auto-numbered profiles (CUS-0001), optional photo, duplicate detection by name and phone, search/filter/sort, archive. Customers who have orders or payments can't be deleted, which protects your financial history. |
| **Measurements** | Men, women and children templates, plus custom templates and custom fields. Phone-friendly **one-field-at-a-time** capture with ± steppers, "same as last time", and previous values as hints. cm ↔ inch conversion. **Every update is saved as a new version** and versions can be compared side by side. Printable PDF sheet and Excel/CSV export. |
| **Designs & Styles** | A gallery of styles with photos, category, required measurements, fabric estimate, production days and price. Use a design directly in a new order. |
| **Fabric Calculator** | A configurable rule engine: length = Σ(factor × measurement) + allowance, scaled for fabric width, plus waste %, number of garments, fit adjustment and cost. Results are clearly marked as **estimates**. Log what you actually used, and after 3 or more logs it suggests a calibration factor for that rule. |
| **Orders** | Multiple items, discount, deposit (with a receipt), due date, assigned tailor, linked design and measurements, fabric taken from stock, reference photos. Overdue orders are highlighted. |
| **Production** | A kanban board over your workflow stages, which you can configure: drag and drop on desktop, arrow buttons on touch screens. Progress notes and photos, with a full timeline. |
| **Payments & Finance** | Payments, deposits, refunds and expenses. Overpayment is blocked unless you choose to keep the excess as customer credit. Cash-basis revenue is kept separate from estimated profit. PDF invoices and receipts. |
| **Inventory** | Fabrics, threads, buttons, zips and more. Stock in/out/count, low-stock alerts and supplier records. A purchase can be recorded as an expense, and fabric can be deducted from an order (with confirmation). |
| **Calendar** | Measurement, fitting, delivery and collection appointments plus order deadlines, in day, week, month and upcoming views. Overlapping appointments are flagged before saving and highlighted on the calendar. |
| **Reports** | Filter by date range: revenue, expenses, profit, best-selling categories, top customers, outstanding balances, completed and cancelled orders, average completion time, material use and inventory value. Export to **PDF, Excel and CSV**. |
| **Messages & Alerts** | Reminders worked out from your data, plus optional on-device notifications. Editable customer message templates that open **WhatsApp, SMS or email** pre-filled, or copy to the clipboard. |
| **Tailoring Assistant** | Works offline: built-in guidance on sewing problems, measurement terms, construction, fabrics and pricing, plus a pricing calculator, a production schedule ranked by urgency, and a quotation PDF builder. AI answers are optional (see below). |
| **Settings** | Business profile and logo, currency (₦ by default), units, theme, measurement templates, workflow stages, staff, PIN lock, AI proxy, and data & backup. |

---

## Your data: where it lives and how to protect it

- Everything is stored in **IndexedDB in this browser, on this device**. Small preferences such as theme and the last-backup date are kept in LocalStorage.
- Data **does not sync between devices or browsers**. A phone and a laptop each have their own separate database.
- Clearing site data, resetting the device or uninstalling the browser **erases it**. Browser storage is **not a substitute for a backup**.
- Fabriqon asks the browser for **persistent storage** (`navigator.storage.persist()`), shows how much space is used, and reminds you to back up (every 7 days by default).

### Backup and restore (Settings → Data & backup)

- **Download full backup** saves a `.json` file containing every record, including photos, with a SHA-256 checksum.
- **Restore** checks the file *before* changing anything: format, schema version, every record, duplicate IDs, truncation and the checksum. You then see what is **new / unchanged / different** and choose how to merge:
  - keep what's on this device and only add new records (the default),
  - use whichever copy was updated most recently,
  - use the backup copy, or
  - replace everything (you must type `REPLACE`).
- A **safety backup of your current data is downloaded before any restore**. Numbering counters (order, receipt and customer numbers) never move backwards, so restored and new records can't collide.
- To **move to a new device**, back up on the old one and restore on the new one.
- **Database health** checks for missing stores, orphaned references, invalid records and negative stock.

---

## Offline & PWA

- `service-worker.js` precaches the whole app: HTML, CSS, every JS module, fonts, icons, and the bundled **Chart.js, jsPDF + AutoTable and SheetJS** in `js/vendor/`. Nothing critical comes from a CDN, so PDFs, Excel exports and charts all work offline.
- Page loads use an offline-first app shell. All modules work offline.
- **Updates:** when a new version is deployed, the app shows *“A new version of Fabriqon is ready”*, and you choose when to switch, so an open form is never interrupted.
- **Install:**
  - Chrome / Edge (desktop and Android): the install icon in the address bar, or the menu → *Install app*. Settings → Data & backup also has an Install button when the browser offers one.
  - Safari on iPhone/iPad: Share → *Add to Home Screen*.
  - Installing usually also makes the browser grant persistent storage.

---

## Security notes

- **App PIN** (optional): PBKDF2-SHA-256 (150k iterations) with a random salt. Too many wrong attempts trigger a cooldown, and the app auto-locks after inactivity. **It deters casual access only — it is not encryption.** Anyone with full access to the browser profile can read IndexedDB. Use your device's screen lock as well.
- A strict **Content-Security-Policy** (`script-src 'self'`) means no inline scripts and no third-party code. All user content is escaped by a tagged-template renderer, and uploaded images are type-checked, size-limited and re-encoded through a canvas.
- CSV exports guard against spreadsheet formula injection.
- **Staff** are used for job assignment only. With local-only storage there are no per-user logins or server-enforced permissions; everyone using the device sees everything.

---

## Optional AI assistant

The app never contains an API key. AI goes through a small proxy that **you** host:

```bash
cd server
npm install
cp .env.example .env    # set ANTHROPIC_API_KEY and ALLOWED_ORIGIN
ANTHROPIC_API_KEY=... ALLOWED_ORIGIN=https://your-fabriqon-site npm start
```

Then add the proxy URL (`https://…/api/assistant`) in **Settings → AI** and press **Test connection**.

- The proxy uses the official Anthropic SDK with **Claude Opus 5.5** (`claude-opus-5-5`, configurable through `FABRIQON_MODEL`).
- It has a CORS allow-list, a per-IP rate limit and a request-size limit.
- It tells the model not to invent measurements or guarantee diagnoses.
- Server-side refusal fallback is enabled.

Image generation isn't included; design ideas come back as written concepts. If the proxy isn't configured, the device is offline, or the provider returns an error, the assistant falls back to its built-in guidance and the rest of the app is unaffected.

Proxy contract: `POST { task: 'chat'|'design'|'ping', messages: [{role, content}], context }` → `{ reply, images: [] }`.

---

## Deployment

It's a static site. Upload the project root (excluding `tests/`, `tools/`, `server/` and `node_modules/`) to any HTTPS static host, such as Netlify, Vercel, Cloudflare Pages, GitHub Pages, S3 + CloudFront or nginx.

1. Run `npm run build:sw` and `npm test`.
2. Serve over **HTTPS**, with `service-worker.js`, `index.html` and `manifest.json` sent with `Cache-Control: no-cache` so updates are picked up.
3. Serve `.js` as `text/javascript` and `.woff2` as `font/woff2`.
4. If you use the AI proxy, deploy `server/` separately (any Node 18+ host) and set `ALLOWED_ORIGIN` to the site's origin.

---

## Project structure

```
index.html            App entry (CSP, manifest, styles)
manifest.json         PWA manifest (icons, shortcuts)
service-worker.js     Offline cache + update flow (precache list generated)
offline.html          Fallback if the app was never fully cached
css/                  variables, themes (light/dark), main, layout, components, dashboard, responsive
js/
  app.js              Bootstrap: DB, onboarding, PIN lock, shell, router, SW
  router.js           Hash router
  database.js         IndexedDB layer: versioned schema, validated CRUD, transactions, integrity
  services.js         Business operations (atomic transactions + activity log)
  state.js storage.js theme.js pwa.js lock.js alerts.js charts.js exports.js backup.js ai.js
  ui.js icons.js utils.js quick.js onboarding.js seed.js
  core/               Pure logic (unit-tested in Node): calc, fabric-engine, schema, backup-format, defaults, knowledge
  modules/            One file per screen: dashboard, customers, measurements, designs, orders,
                      production, fabric-calculator, inventory, finance, calendar, analytics,
                      notifications, assistant, settings
  vendor/             Chart.js 4.4.6, jsPDF 2.5.2, jsPDF-AutoTable 3.8.4, SheetJS 0.18.5 (bundled locally)
assets/               icons (SVG + generated PNGs), Inter font (self-hosted)
server/               Optional AI proxy (Node + Anthropic SDK)
tests/                node:test suites
tools/                serve, build-sw, build-png-icons, build-icons (Lucide subset), check-syntax
```

### Data model (IndexedDB `fabriqon`, schema v2)

`customers, measurements, measurementTemplates, designs, orders, orderItems, productionTasks, payments, expenses, inventory, inventoryTransactions, suppliers, appointments, notifications, settings, activityLogs, fabricLogs`

Each store has indexes for the common queries. Every write is validated against the rules in `js/core/schema.js`. Schema upgrades run as numbered migrations (`MIGRATIONS` in the same file).

### Licences of bundled libraries

Chart.js (MIT), jsPDF and jsPDF-AutoTable (MIT), SheetJS Community Edition (Apache-2.0), Lucide icons (ISC), and the Inter font (SIL OFL 1.1).
