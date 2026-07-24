// Vercel Edge Middleware — country-level access control.
//
// Runs at the edge before every page/API request (static assets are excluded below).
// Configure the country rules with environment variables (no code change needed):
//
//   ALLOWED_COUNTRIES = "US"            -> allow ONLY these ISO country codes (allowlist mode)
//   BLOCKED_COUNTRIES = "PK,IN,BD"      -> block these ISO country codes (blocklist mode)
//
// Precedence: if ALLOWED_COUNTRIES is set, only those are allowed and everything else is
// blocked. Otherwise, if BLOCKED_COUNTRIES is set, those are blocked. If neither is set,
// all traffic is allowed. Visitors whose country cannot be determined are ALLOWED
// (so real customers are never blocked by a missing geo lookup).

import { next } from '@vercel/edge';

export const config = {
  // Match all routes EXCEPT files with an extension (css/js/images) and Vercel internals.
  matcher: ['/((?!_next|_vercel|.*\\.[a-zA-Z0-9]+$).*)'],
};

function parseList(value) {
  return (value || '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
}

export default function middleware(request) {
  const country = (request.headers.get('x-vercel-ip-country') || '').toUpperCase();

  const allow = parseList(process.env.ALLOWED_COUNTRIES);
  const block = parseList(process.env.BLOCKED_COUNTRIES);

  let blocked = false;
  if (allow.length > 0) {
    // Allowlist mode: block anything not on the list (but allow unknown geo).
    blocked = country !== '' && !allow.includes(country);
  } else if (block.length > 0) {
    // Blocklist mode.
    blocked = country !== '' && block.includes(country);
  }

  if (!blocked) return next();

  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Not available in your region</title></head>' +
    '<body style="font-family:Arial,Helvetica,sans-serif;background:#f4f6fa;color:#333;margin:0">' +
    '<div style="max-width:560px;margin:12vh auto;text-align:center;padding:0 22px">' +
    '<h1 style="color:#08376c;font-size:26px">This service isn&rsquo;t available in your region</h1>' +
    '<p style="font-size:16px;line-height:1.6">We&rsquo;re sorry, but access to this site is not available from your location.</p>' +
    '</div></body></html>';

  return new Response(html, {
    status: 451, // 451 Unavailable For Legal Reasons — standard for geo-restriction
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
