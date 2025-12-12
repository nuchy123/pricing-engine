# Pricing Engine

A static mortgage pricing UI that reads an uploaded XLS rate sheet from `localStorage`,
shows program/term dropdowns, and calculates a payment/price for the best available rate.

## How to run locally
Because this is a static site, you can serve it from any simple HTTP server.

1. From the project root, start a server (pick one):
   - `npm start` (uses the built-in `server.js` script)
   - `python3 -m http.server 8000`
   - or `npx serve .`
2. Open the app in your browser at <http://localhost:8000/index.html>.
3. (Optional) Open the admin upload page at <http://localhost:8000/admin.html> to load a rate sheet.

> Tip: When you upload a sheet in `admin.html`, it saves to `localStorage` under the key
> `tpoPricingModel_v2`. Reload `index.html` afterwards and the front end will pick it up.

## What to test
- **Term dropdown**: should always show options on load; changing Program repopulates the list.
- **ZIP autofill**: entering a 5-digit ZIP fills City/State/County via API with fallbacks.
- **Pricing**: after a rate sheet upload, click **Get Pricing** to see the note rate and P&I.

## Quick sanity check
Run `node --check pricing-engine.js` to confirm the script parses.
