// ── Master Accounts: send a PDF by link (MASTER_ACCOUNTS_PLAN.md §31) ─────
// The link a vendor opens from WhatsApp:
//
//   GET /.netlify/functions/ma-share?t=<token>        (the plan's own path)
//
// is the ONE public door into the books, so it opens exactly one thing — a
// PDF this server itself named `ma/<64 hex>` — and only while its share
// document is live:
//   unknown or malformed token           → 404, a plain page
//   withdrawn (revoked)                  → 410, a plain page
//   past its expiry                      → 410, a plain page
//   live                                 → count the open, then 302 to a
//                                          Cloudinary link that itself dies
//                                          in 5 minutes (a private file), or
//                                          to the file's public URL (the
//                                          fallback — see ma-attach.js). A
//                                          link to a file that is already
//                                          public keeps opening whatever the
//                                          opt-in says now: refusing it
//                                          would break a link already sent
//                                          and un-publish nothing.
// Nothing about the books is served from here, the pages echo only what the
// owner named the document (escaped), and every response carries no-store,
// no-referrer and noindex. A share document this server would not have
// written — no revoked:false, an expiry window longer than the cap, a file
// that is not one of ours — is treated as unknown: firestore.rules let an
// owner write ma_shares directly (M1.2, plan §19), so the endpoint trusts
// the SHAPE, not the writer.
//
// The owners' side, POST JSON with `Authorization: Bearer <ID token>`:
//   create {subject:{type,id,no,rev?}, file:{publicId,format,type,resourceType?},
//           filename?, days?, to?:{party, phone}}
//          → a 32-byte random token and the PATH to hand out; the client puts
//            its own origin in front (this function never guesses its host).
//            `subject.rev` — the document's revision the PDF was made at, a
//            whole number, 1 or more — is kept on the share as `docRev` and
//            answered back, so the list can say when the document moved on
//            since; not sent, the share carries no docRev at all; anything
//            else is refused (400 subject). FAILS CLOSED like ma-attach:
//            with no Cloudinary key and no MA_ALLOW_PUBLIC_ATTACH=1, no link
//            is made to any file (503 not_configured).
//   revoke {token} → withdrawn for good (never un-revoked); idempotent.
// Both write an ma_audit row in the same batch as the share (§29, §31).
// There is no `list`: owners read ma_shares directly under the rules.
// Before the caller is known, a server that cannot start says only that it
// is not set up; the reason goes to the function log (lib.startAdmin).
//
// Opens: `opens`/`lastOpenedAt` count people; a link-preview fetch (the
// sender's own WhatsApp builds the preview by fetching the link) is counted
// in `previews` instead, so "opened 1 time" does not mean "the vendor looked"
// before the vendor has even received it. Everyone still gets the file —
// the user agent only chooses the counter, never whether it is served.
'use strict';
const lib = require('../lib/ma-server.js');

const SHARE_PATH = '/.netlify/functions/ma-share?t=';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;           // 32 random bytes, base64url
const DAY_MS = 86400000;
// js/ma-core.js accepts settings.share.defaultDays from 1 to 90; a link can
// live as long as the setting allows, and no longer.
const MAX_SHARE_DAYS = 90;
const SKEW_MS = 5 * 60 * 1000;
const PREVIEW_UA = /\b(WhatsApp|facebookexternalhit|Facebot|TelegramBot|Twitterbot|Slackbot|Slack-ImgProxy|Discordbot|LinkedInBot|SkypeUriPreview|Googlebot|bingbot|Applebot|Embedly)\b/i;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CONTROL = /[\u0000-\u001f\u007f]/g;

const SAFE = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff'
};

// Pakistan does not change its clocks: PKT is UTC+5 all year.
function pktDate(ms) {
  const d = new Date(ms + 5 * 3600000);
  return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

// A small self-contained page — no app CSS, nothing loaded, nothing run.
function page(statusCode, heading, lines) {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">'
    + '<title>' + lib.esc(heading) + ' · GROOVY</title><style>'
    + ':root{color-scheme:light dark}'
    + 'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f4f5;color:#18181b;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}'
    + 'main{max-width:420px;margin:24px 16px;padding:28px 24px;background:#fff;border:1px solid #e4e4e7;border-radius:14px}'
    + '.brand{margin:0 0 18px;font-size:12px;font-weight:800;letter-spacing:.16em;color:#52525b}'
    + 'h1{margin:0 0 8px;font-size:20px;line-height:1.3}p{margin:8px 0 0;color:#3f3f46}'
    + '@media (prefers-color-scheme:dark){body{background:#09090b;color:#f4f4f5}main{background:#18181b;border-color:#3f3f46}.brand{color:#a1a1aa}p{color:#d4d4d8}}'
    + '</style></head><body><main><div class="brand">GROOVY</div><h1>' + lib.esc(heading) + '</h1>'
    + lines.filter(Boolean).map(l => '<p>' + lib.esc(l) + '</p>').join('')
    + '</main></body></html>';
  return {
    statusCode,
    headers: Object.assign({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    }, SAFE),
    body: html
  };
}
const notFound = () => page(404, 'This link is not valid', ['Check that the whole link was copied, or ask whoever sent it for a new one.']);
const unavailable = () => page(503, 'This document cannot be opened right now', ['Please try again in a little while.']);
const docLine = d => (typeof d.docNo === 'string' && d.docNo.trim() ? 'Document: ' + d.docNo.trim().slice(0, 60) + '.' : '');
const withdrawn = d => page(410, 'This link has been withdrawn', ['GROOVY has withdrawn this link.', docLine(d), 'Ask whoever sent it to share the document again.']);
const expired = d => page(410, 'This link has expired', ['It was open until ' + pktDate(d.expiresAt) + '.', docLine(d), 'Ask whoever sent it to share the document again.']);

// What the endpoint makes of a stored share. The order is the answer's:
// withdrawn says so even when it has also expired.
function shareState(d, nowMs) {
  if (!d || typeof d !== 'object') return { state: 'invalid' };
  if (d.revoked === true) return { state: 'revoked' };
  if (d.revoked !== false) return { state: 'invalid' };
  const created = d.createdAt, exp = d.expiresAt;
  if (!Number.isFinite(created) || !Number.isFinite(exp)) return { state: 'invalid' };
  if (created > nowMs + SKEW_MS) return { state: 'invalid' };
  if (exp <= created || exp - created > MAX_SHARE_DAYS * DAY_MS + SKEW_MS) return { state: 'invalid' };
  const a = lib.assetRef({ publicId: d.pdfPublicId, format: d.format, type: d.deliveryType, resourceType: d.resourceType });
  if (a.code || a.ref.format !== 'pdf') return { state: 'invalid' };
  if (nowMs >= exp) return { state: 'expired' };
  return { state: 'live', ref: a.ref };
}

async function serve(event, nowMs) {
  const q = (event && event.queryStringParameters) || {};
  const t = typeof q.t === 'string' ? q.t : '';
  if (!TOKEN_RE.test(t)) return notFound();
  if (!lib.serviceAccount(process.env)) return unavailable();
  let app, snap;
  try {
    app = lib.getAdmin();
    snap = await app.firestore().collection('ma_shares').doc(t).get();
  } catch (e) {
    console.error('[ma-share] read failed', (e && e.message) || e);
    return unavailable();
  }
  if (!snap.exists) return notFound();
  const d = snap.data() || {};
  const v = shareState(d, nowMs);
  if (v.state === 'revoked') return withdrawn(d);
  if (v.state === 'invalid') return notFound();
  if (v.state === 'expired') return expired(d);
  const out = lib.deliveryUrl(lib.cloudinaryConfig(process.env), v.ref, nowMs);
  if (out.code) {
    console.error('[ma-share] a private file was shared but CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET are not set');
    return unavailable();
  }
  // Count AFTER the link is minted, so a refused serve is never an "open".
  // Counting is best-effort: the file is what the vendor came for.
  const preview = PREVIEW_UA.test(lib.header(event, 'user-agent'));
  const inc = app.firestore.FieldValue.increment(1);
  try {
    await snap.ref.update(preview ? { previews: inc, lastPreviewAt: nowMs } : { opens: inc, lastOpenedAt: nowMs });
  } catch (e) {
    console.error('[ma-share] could not count an open', (e && e.message) || e);
  }
  // The plan: "the function logs what it served" — never the token or the URL.
  console.log('[ma-share] served', JSON.stringify({ share: t.slice(0, 6), doc: String(d.docKind) + '/' + String(d.docId), delivery: out.delivery, preview }));
  return { statusCode: 302, headers: Object.assign({ Location: out.url }, SAFE), body: '' };
}

// ── The owners' side ────────────────────────────────────────────────────
function cleanText(s, max) {
  return typeof s === 'string' ? s.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}
function checkSubject(s) {
  if (!s || typeof s !== 'object') return null;
  const type = typeof s.type === 'string' ? s.type.trim() : '';
  const id = typeof s.id === 'string' ? s.id.trim() : '';
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(type) || !/^[A-Za-z0-9._-]{1,120}$/.test(id)) return null;
  return { type, id, no: cleanText(s.no, 60) || null };
}
// The revision the PDF was made at (maRevOf on the client: edits + 1).
// → {} when not sent (undefined or null — the days/to rule), {rev} when it
// is a whole number, 1 or more, else {error}. A string, a fraction, zero, a
// negative or an unsafe integer is a request this function would not have
// been sent, so it is refused rather than dropped: a link that silently
// lost its revision could never say its document had changed.
function checkRev(s) {
  const r = s && typeof s === 'object' ? s.rev : undefined;
  if (r === undefined || r === null) return {};
  if (typeof r !== 'number' || !Number.isSafeInteger(r) || r < 1) return { error: 'The document’s revision must be a whole number, 1 or more.' };
  return { rev: r };
}
function checkTo(to) {
  if (to === undefined || to === null) return { to: null };
  if (typeof to !== 'object' || Array.isArray(to)) return { error: 'Who the link is for must be {party, phone}.' };
  const party = cleanText(to.party, 80) || null;
  const phone = typeof to.phone === 'string' && to.phone.trim() ? to.phone.trim() : null;
  if (phone !== null && !/^\+?[0-9][0-9 -]{5,19}$/.test(phone)) return { error: 'That phone number is not a phone number.' };
  return { to: party || phone ? { party, phone } : null };
}
function cleanFilename(name, subject) {
  let f = cleanText(name, 120).replace(/[\\/]/g, '-');
  if (!f) f = cleanText(subject.no || subject.id, 100).replace(/[\\/]/g, '-');
  if (!/\.pdf$/i.test(f)) f += '.pdf';
  return f;
}

async function defaultDays(db) {
  try {
    const s = await db.collection('ma_settings').doc('main').get();
    return lib.core.maSettings(s.exists ? s.data() : null).share.defaultDays;
  } catch (e) {
    console.error('[ma-share] settings unreadable; the link gets the default', (e && e.message) || e);
    return lib.core.MA_DEFAULT_SETTINGS.share.defaultDays;
  }
}

async function create(app, owner, body, nowMs) {
  const subject = checkSubject(body.subject);
  if (!subject) return lib.fail(400, 'subject', 'Name the document being shared: subject {type, id, no}.');
  const rv = checkRev(body.subject);
  if (rv.error) return lib.fail(400, 'subject', rv.error);
  const a = lib.assetRef(body.file);
  if (a.code) return lib.fail(400, a.code, a.message);
  if (a.ref.format !== 'pdf') return lib.fail(400, 'file', 'Only a PDF can be sent by link.');
  const cfg = lib.cloudinaryConfig(process.env);
  if (a.ref.type === 'authenticated' && !cfg.signed) {
    return lib.fail(503, 'not_configured', 'This PDF is private and the server has no Cloudinary key to open it with — set CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in Netlify first.');
  }
  // Fail closed (M1.6c): with no key and no opt-in, no link is made — not
  // even to a PDF that went up public before; the owners have not chosen
  // public links. With the key set, a PDF that is already public may still
  // be linked: the link makes nothing more public than it is.
  if (cfg.state === 'not_configured') return lib.fail(503, 'not_configured', lib.attachNotSetUp(cfg));
  const t = checkTo(body.to);
  if (t.error) return lib.fail(400, 'to', t.error);
  const db = app.firestore();
  let days;
  if (body.days === undefined || body.days === null) days = await defaultDays(db);
  else if (typeof body.days !== 'number' || !Number.isFinite(body.days) || body.days < 1) return lib.fail(400, 'days', 'A link lives for a whole number of days, at least 1.');
  else days = Math.min(MAX_SHARE_DAYS, Math.round(body.days));
  const token = lib.newToken();
  const filename = cleanFilename(body.filename, subject);
  const share = {
    docKind: subject.type, docId: subject.id, docNo: subject.no,
    pdfPublicId: a.ref.publicId, format: a.ref.format, resourceType: a.ref.resourceType, deliveryType: a.ref.type,
    filename, to: t.to,
    createdBy: owner.u, createdAt: nowMs, days, expiresAt: nowMs + days * DAY_MS,
    revoked: false, revokedAt: null, revokedBy: null,
    opens: 0, lastOpenedAt: null, previews: 0, lastPreviewAt: null
  };
  // Absent when not sent — never null, never undefined (a write carrying
  // undefined is refused by Firestore).
  if (rv.rev !== undefined) share.docRev = rv.rev;
  const audit = lib.auditRow('share', { dt: subject.type, id: subject.id, no: subject.no },
    { detail: 'Link to ' + filename + ' · ' + days + ' day' + (days > 1 ? 's' : '') + (t.to && t.to.party ? ' · for ' + t.to.party : ''), by: owner.u, at: nowMs });
  const b = db.batch();
  b.create(db.collection('ma_shares').doc(token), share);
  b.set(db.collection('ma_audit').doc(lib.auditId(nowMs, owner.u)), audit);
  await b.commit();
  const out = { token, path: SHARE_PATH + token, expiresAt: share.expiresAt, days, share: Object.assign({ token }, share) };
  if (share.docRev !== undefined) out.docRev = share.docRev;
  return lib.json(200, out);
}

async function revoke(app, owner, body, nowMs) {
  const token = typeof body.token === 'string' ? body.token : '';
  if (!TOKEN_RE.test(token)) return lib.fail(400, 'token', 'That is not a share token.');
  const db = app.firestore();
  const ref = db.collection('ma_shares').doc(token);
  const out = await db.runTransaction(async tx => {
    const s = await tx.get(ref);
    if (!s.exists) return { missing: true };
    const d = s.data() || {};
    if (d.revoked === true) return { already: true, d };
    const patch = { revoked: true, revokedAt: nowMs, revokedBy: owner.u };
    tx.update(ref, patch);
    tx.set(db.collection('ma_audit').doc(lib.auditId(nowMs, owner.u)), lib.auditRow('revoke',
      { dt: typeof d.docKind === 'string' ? d.docKind : null, id: typeof d.docId === 'string' ? d.docId : null, no: typeof d.docNo === 'string' ? d.docNo : null },
      { detail: 'Link withdrawn' + (typeof d.filename === 'string' ? ' · ' + d.filename : ''), by: owner.u, at: nowMs }));
    return { d: Object.assign({}, d, patch) };
  });
  if (out.missing) return lib.fail(404, 'not_found', 'No share link has that token.');
  return lib.json(200, { token, revoked: true, already: !!out.already, revokedAt: out.d.revokedAt || null, revokedBy: out.d.revokedBy || null });
}

async function owners(event, nowMs) {
  // Nobody is known yet: a server that cannot start says so and no more.
  const boot = lib.startAdmin('ma-share');
  if (boot.error) return boot.error;
  const app = boot.app;
  const who = await lib.verifyOwner(event, app);
  if (who.error) return who.error;
  const rb = lib.readBody(event);
  if (rb.error) return rb.error;
  try {
    if (rb.body.action === 'create') return await create(app, who.owner, rb.body, nowMs);
    if (rb.body.action === 'revoke') return await revoke(app, who.owner, rb.body, nowMs);
    return lib.fail(400, 'action', 'Unknown action.');
  } catch (e) {
    console.error('[ma-share]', rb.body.action, (e && e.stack) || e);
    return lib.fail(500, 'server', 'The share server failed: ' + ((e && e.message) || e));
  }
}

async function handle(event, nowMs) {
  const m = event && event.httpMethod;
  if (m === 'GET') return serve(event, nowMs);
  if (m === 'POST') return owners(event, nowMs);
  return lib.fail(405, 'method', 'GET or POST only.', { Allow: 'GET, POST' });
}

exports.handler = event => handle(event, Date.now());
exports._handle = handle;
exports._test = { shareState, pktDate, checkSubject, checkTo, cleanFilename, SHARE_PATH, TOKEN_RE, MAX_SHARE_DAYS, PREVIEW_UA };
