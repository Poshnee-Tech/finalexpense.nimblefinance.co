# Final Expense Landing Page — Vercel Deploy

Static frontend (design unchanged from the original PHP site) + a hardened serverless
function that saves each form submission to your existing Google Sheet, + edge-level
country access control. No PHP, no MySQL, no Ringba.

## What's in here

```
index.html           Home / landing page (design identical; form posts to /api/submit)
thankyou.html         Thank-you page (shown after a successful submission)
privacy-policy.html   Local Privacy Policy page (your real content, Effective Date 2026-07-24)
api/submit.js         Serverless function: validates + appends the lead to Google Sheets, redirects
middleware.js         Edge Middleware: country allow/block gate
css/ images/          All original styles and images
styles.css            Thank-you page styles
thank66.jpg           Thank-you image
package.json          Dependencies (googleapis, @vercel/edge)
vercel.json           Clean URLs + security headers
.env.example          Template for all environment variables
```

## Where the leads go

Each valid submission is appended as a new row to your current sheet
(`YOUR_SHEET_ID`) in this column order — same as before:

| fname | lname | phone | email | age | state | zip | trusted |

## Deploy in 3 steps

### 1. Environment-variable values
- **SHEET_ID** = `YOUR_SHEET_ID`
- **GOOGLE_SERVICE_ACCOUNT** = the **entire contents** of `GoogleSheets/final.json` (paste as one value)
- **ALLOWED_COUNTRIES** or **BLOCKED_COUNTRIES** — optional, see "Country access control" below

> The service account `your-service-account@your-project.iam.gserviceaccount.com` already has
> edit access to this sheet, so nothing else needs sharing.

### 2. Deploy this folder to Vercel
**Dashboard:** push `vercel-deploy` to a Git repo → import at [vercel.com/new](https://vercel.com/new)
(Framework preset: **Other**). **Or CLI:**
```bash
npm i -g vercel
cd vercel-deploy
vercel --prod
```

### 3. Add environment variables → redeploy
Project → **Settings → Environment Variables** → add the values from step 1 for
**Production** (and Preview) → **Redeploy**.

## Country access control (geo restriction)

The original site was restricted in some countries. That's handled here by **`middleware.js`**,
which runs at Vercel's edge on every page/API request and blocks by country — driven entirely
by environment variables, so you change the rules without touching code:

- **Allow only certain countries** (recommended for a US-only product):
  `ALLOWED_COUNTRIES=US`  → everyone outside the US gets a 451 "not available in your region" page.
- **Block certain countries:** `BLOCKED_COUNTRIES=PK,IN,BD` (comma-separated ISO codes).
- **Allow everyone:** leave both blank.

Rules: an allowlist takes precedence over a blocklist. Visitors whose country can't be
determined are allowed (so real customers are never blocked by a failed geo lookup). Country
detection uses Vercel's edge geolocation and works only on the deployed site, not `localhost`.

## Security hardening (what's already in place)

- **Server-side validation** of every field (name, phone digits, email format, age 18–120,
  US state whitelist, ZIP format, consent checkbox required). Invalid/malicious posts are rejected.
- **Honeypot anti-spam** field (`company_website`) — invisible to users; bot submissions are dropped.
- **Google Sheets formula-injection protection** — values are stored as RAW text and leading
  `= + - @` are defanged, so a malicious cell can't execute when the sheet is opened.
- **Same-origin guard** on the API + `POST`-only + **16 KB body-size cap**.
- **Secrets stay server-side** — the service-account key is an env var, never in the repo
  (`.gitignore` blocks `*.json` key files and `.env`).
- **Security headers** via `vercel.json` (HSTS, nosniff, X-Frame-Options SAMEORIGIN,
  Referrer-Policy, Permissions-Policy).
- Errors return generic messages; details are logged server-side only (no data leakage).

**Optional next step:** for heavy bot traffic, add Cloudflare Turnstile or Vercel KV rate-limiting.

## Test locally (optional)
```bash
npm i -g vercel
cp .env.example .env      # paste your GOOGLE_SERVICE_ACCOUNT value into .env
vercel dev                # runs the static site + /api/submit locally
```

## Notes for the client-approval build
- **Privacy Policy** now contains your real content. I intentionally left OUT the trailing
  "this is a general-purpose template… have it reviewed by legal counsel" note from `privacy.md`,
  since that reads as an internal reminder, not public policy text. Echoing the recommendation:
  have counsel review the policy before going fully live.
- The **2-minute auto-refresh** (`<meta http-equiv="refresh">`) from the original was removed so
  the page doesn't reload while your client reviews it.
- The **mobile hamburger menu** now works via a small vanilla-JS toggle (the original jQuery
  `js/` files were never in this export). Design is unchanged; the menu just functions now.
- Original tracking (GTM, GA, Meta Pixel, Bing UET, TrustedForm) was kept as-is.
