// Vercel Serverless Function: receives the landing-page form POST, validates it,
// appends the lead as a new row to the existing Google Sheet, then redirects to /thankyou.
//
// Column order MATCHES the current sheet exactly (from the old process.php):
//   fname | lname | phone | email | age | state | zip | trusted
//
// Required environment variables (Vercel -> Project -> Settings -> Environment Variables):
//   SHEET_ID                -> YOUR_SHEET_ID
//   GOOGLE_SERVICE_ACCOUNT  -> the ENTIRE contents of your service-account JSON (final.json)

const { google } = require('googleapis');

const MAX_BODY_BYTES = 16 * 1024; // 16 KB is plenty for this form; reject anything larger.

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

// Read the form body (Vercel-parsed or raw stream) with a hard size cap.
async function readBody(req) {
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Body too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  const type = (req.headers['content-type'] || '').toLowerCase();
  if (type.includes('application/json')) {
    try { return JSON.parse(raw); } catch (_) { return {}; }
  }
  const params = new URLSearchParams(raw);
  const obj = {};
  for (const [k, v] of params) obj[k] = v;
  return obj;
}

// Strip control characters (keep printable chars and spaces).
function stripControl(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 32 && code !== 127) out += str[i];
  }
  return out;
}

// Trim, remove control chars, cap length, and neutralize Google Sheets / CSV formula
// injection (a value starting with = + - @ could execute as a formula on open).
function safeCell(value, maxLen) {
  const limit = maxLen || 200;
  let s = stripControl(String(value == null ? '' : value)).trim();
  if (s.length > limit) s = s.slice(0, limit);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function badRequest(res, message) {
  res.statusCode = 400;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.end(
    '<!doctype html><meta charset="utf-8"><title>Invalid submission</title>' +
    '<div style="font-family:Arial;max-width:520px;margin:80px auto;text-align:center;color:#333">' +
    '<h2>We couldn\'t process that</h2><p>' + message + '</p>' +
    '<p><a href="/" style="color:#08376c">Go back to the form</a></p></div>'
  );
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  // Same-origin guard: if an Origin header is present, it must match this host.
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return res.status(403).send('Forbidden');
      }
    } catch (_) { /* malformed Origin: fall through */ }
  }

  let body;
  try {
    body = await readBody(req);
  } catch (_) {
    return badRequest(res, 'Your submission was too large.');
  }

  // Honeypot: real users never see or fill this field. If it's filled, it's a bot.
  // Pretend success (redirect) without saving, so bots don't learn they were caught.
  if (safeCell(body.company_website)) {
    res.statusCode = 302;
    res.setHeader('Location', '/thankyou');
    return res.end();
  }

  // Extract + validate
  const fname = safeCell(body.fname, 100);
  const lname = safeCell(body.lname, 100);
  const phoneRaw = safeCell(body.phone, 20);
  const email = safeCell(body.email, 150);
  const ageRaw = safeCell(body.age, 3);
  const state = safeCell(body.state, 2).toUpperCase();
  const zip = safeCell(body.zip, 10);
  const trusted = safeCell(body.xxTrustedFormCertUrl || body.trusted, 500);
  const acceptance = safeCell(body.acceptance);

  const phoneDigits = phoneRaw.replace(/\D/g, '');
  const age = parseInt(ageRaw, 10);

  if (!fname || !lname) return badRequest(res, 'Please enter your first and last name.');
  if (phoneDigits.length < 10 || phoneDigits.length > 11) return badRequest(res, 'Please enter a valid phone number.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return badRequest(res, 'Please enter a valid email address.');
  if (!Number.isFinite(age) || age < 18 || age > 120) return badRequest(res, 'Please enter a valid age (18 or older).');
  if (!US_STATES.has(state)) return badRequest(res, 'Please select a valid state.');
  if (!/^\d{5}(-\d{4})?$/.test(zip)) return badRequest(res, 'Please enter a valid ZIP code.');
  if (!acceptance) return badRequest(res, 'Please accept the consent checkbox to continue.');

  try {
    const sheetId = process.env.SHEET_ID;
    const rawCreds = process.env.GOOGLE_SERVICE_ACCOUNT;
    if (!sheetId || !rawCreds) {
      console.error('Missing SHEET_ID or GOOGLE_SERVICE_ACCOUNT environment variable.');
      return res.status(500).send('Server is not configured yet. Please try again shortly.');
    }

    const credentials = JSON.parse(rawCreds);
    if (credentials.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Sheet1',
      valueInputOption: 'RAW', // store as text — no formula execution
      requestBody: {
        values: [[fname, lname, phoneDigits, email, String(age), state, zip, trusted]],
      },
    });

    res.statusCode = 302;
    res.setHeader('Location', '/thankyou');
    return res.end();
  } catch (err) {
    console.error('Submit error:', err && err.message ? err.message : err);
    return res.status(500).send('Sorry, something went wrong saving your details. Please try again.');
  }
};
