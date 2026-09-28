/* ma-server — shared server code for the Master Accounts functions
 * (ma-attach, ma-share, ma-backup; MASTER_ACCOUNTS_PLAN.md §29, §30, §31).
 *
 * Lives OUTSIDE netlify/functions on purpose (the postex-core precedent): a
 * file directly in netlify/functions is deployed as an endpoint of its own,
 * a file here is only ever bundled (esbuild) into the functions that
 * require it.
 *
 * What more than one function has to agree on, defined once:
 *   WHO   — the owners, and the ID-token check. MA_OWNER_EMAILS mirrors
 *           isMasterAccounts() in firestore.rules, _MA_USERS in
 *           js/master-accounts.js and MA_OWNERS in js/ma-core.js;
 *           tests/ma-server.test.js holds all four equal. A role or a name
 *           sent by the client is never trusted — only the verified token's
 *           email. checkRevoked is on: a session revoked after a lost phone,
 *           or a disabled account, is refused at once rather than for the
 *           rest of the token's hour.
 *   WHAT  — a Master Accounts file: an image or a PDF stored in Cloudinary
 *           as `ma/<64 hex>` (32 random bytes, minted HERE, never by the
 *           client), delivered as type 'authenticated' when this server
 *           holds the Cloudinary secret, or 'upload' (public) when it does
 *           not (the plan's fallback, §29).
 *   HOW   — Cloudinary's documented signature, hand-rolled on node's crypto
 *           (no SDK — the zero-new-deps line): every parameter sent except
 *           file, api_key, resource_type, cloud_name and signature itself,
 *           blanks dropped, sorted by key, `key=value` joined by `&` (an `&`
 *           inside a pair written %26 — the SDK's signature v2), the API
 *           secret appended, SHA-1 hex. Checked against the Cloudinary Node
 *           SDK 2.11.0 source when written; never against the live API (the
 *           sandbox cannot reach Cloudinary at all).
 *
 * Secrets come from process.env only and never leave this process: the
 * Cloudinary API secret only signs; the service account is the Admin SDK's.
 */
'use strict';
const crypto = require('crypto');
const admin = require('firebase-admin');
const core = require('../../js/ma-core.js');

const MA_OWNER_EMAILS = ['afnan@groovy.op', 'ammar@groovy.op'];

// The cloud and the unsigned preset the rest of the app uploads with
// (js/shared.js, js/boards.js, …). Public identifiers, not secrets.
// CLOUDINARY_CLOUD_NAME in Netlify overrides the cloud when it is valid.
const CLOUDINARY_CLOUD = 'deww4lpym';
const CLOUDINARY_PRESET = 'groovy-ops';
const CLOUDINARY_API = 'https://api.cloudinary.com/v1_1/';
const CLOUDINARY_CDN = 'https://res.cloudinary.com/';

const MA_MAX_BYTES = 25 * 1024 * 1024;   // the brief's default; the plan names no cap
const MA_TYPES = {                        // MIME → the Cloudinary format it becomes
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf'
};
const MA_EXTS = {                         // name extension → MIME
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf'
};
const MA_FORMATS = ['jpg', 'png', 'webp', 'heic', 'heif', 'pdf'];
const URL_TTL_SECONDS = 300;              // a view or a share opens a link that dies in 5 minutes
const SIGN_TTL_SECONDS = 3600;            // Cloudinary refuses an upload signature older than an hour
const MAX_BODY = 16 * 1024;               // every JSON body here is a few hundred bytes

const PID_AUTHENTICATED = /^ma\/[0-9a-f]{64}$/;
// An unsigned preset may put its own folder in front (fixed-folder mode), so
// a public file is `[folder/]ma/<64 hex>`. Still unguessable, still only ever
// a file this server named.
const PID_UPLOAD = /^(?:[A-Za-z0-9_-]{1,64}\/){0,3}ma\/[0-9a-f]{64}$/;

// Cloudinary signs every parameter sent EXCEPT these.
const CLOUDINARY_UNSIGNED = ['file', 'api_key', 'resource_type', 'cloud_name', 'signature'];

// ── Responses and requests ──────────────────────────────────────────────
function json(statusCode, obj, extra) {
  return {
    statusCode,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }, extra || {}),
    body: JSON.stringify(obj)
  };
}
// Every refusal is {error: <a sentence for a person>, code: <a word for code>}.
const fail = (statusCode, code, error, headers) => json(statusCode, { error, code }, headers);

// Netlify hands header names in lower case; read them case-blind anyway.
function header(event, name) {
  const h = (event && event.headers) || {};
  const want = String(name).toLowerCase();
  for (const k of Object.keys(h)) if (k.toLowerCase() === want) return String(h[k] == null ? '' : h[k]);
  return '';
}
function bearer(event) {
  const m = /^Bearer\s+(\S+)$/i.exec(header(event, 'authorization').trim());
  return m ? m[1] : '';
}

// → {body} or {error: <response>}. Never throws.
function readBody(event) {
  let raw = event && event.body;
  if (raw === undefined || raw === null || raw === '') return { body: {} };
  if (typeof raw !== 'string') return { error: fail(400, 'json', 'The request body is not JSON.') };
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (raw.length > MAX_BODY) return { error: fail(413, 'too_large', 'The request body is too large.') };
  try {
    const b = JSON.parse(raw);
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('not an object');
    return { body: b };
  } catch (e) {
    return { error: fail(400, 'json', 'The request body is not JSON.') };
  }
}

// ── Firebase Admin ──────────────────────────────────────────────────────
function serviceAccount(env) {
  try {
    const sa = JSON.parse(String((env || process.env).FIREBASE_SERVICE_ACCOUNT || ''));
    return sa && typeof sa === 'object' && !Array.isArray(sa) ? sa : null;
  } catch (e) { return null; }
}
function getAdmin() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount(process.env)) });
  return admin;
}
// The service account's own OAuth token (cloud-platform scope — firebase-
// admin 13's ServiceAccountCredential), for Google REST APIs the Admin SDK
// does not wrap. app().options returns class instances as they are, so this
// IS the live credential.
async function accessToken(app) {
  const t = await app.app().options.credential.getAccessToken();
  if (!t || !t.access_token) throw new Error('the service account returned no access token');
  return t.access_token;
}

// → {owner:{uid,email,u}} or {error:<response>}.
async function verifyOwner(event, app) {
  const token = bearer(event);
  if (!token) return { error: fail(401, 'auth', 'Sign in again — this request carried no sign-in token.') };
  let decoded;
  try { decoded = await app.auth().verifyIdToken(token, true); }
  catch (e) { return { error: fail(401, 'auth', 'Could not verify who you are — sign in again and retry.') }; }
  const email = String((decoded && decoded.email) || '').toLowerCase();
  if (MA_OWNER_EMAILS.indexOf(email) < 0) return { error: fail(403, 'forbidden', 'Master Accounts is for Afnan and Ammar only.') };
  return { owner: { uid: decoded.uid, email, u: email.split('@')[0] } };
}

// ── Cloudinary ──────────────────────────────────────────────────────────
function cloudinaryConfig(env) {
  const e = env || process.env;
  const over = String(e.CLOUDINARY_CLOUD_NAME || '').trim();
  const cloudName = /^[A-Za-z0-9_-]{1,64}$/.test(over) ? over : CLOUDINARY_CLOUD;
  const apiKey = String(e.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = String(e.CLOUDINARY_API_SECRET || '').trim();
  const missing = [];
  if (!apiKey) missing.push('CLOUDINARY_API_KEY');
  if (!apiSecret) missing.push('CLOUDINARY_API_SECRET');
  const signed = !missing.length && !/\s/.test(apiKey + apiSecret);
  return { cloudName, apiKey, apiSecret, signed, missing, mode: signed ? 'authenticated' : 'unsigned', preset: CLOUDINARY_PRESET };
}

function cloudinaryToSign(params) {
  return Object.keys(params)
    .filter(k => CLOUDINARY_UNSIGNED.indexOf(k) < 0)
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map(k => (k + '=' + (Array.isArray(params[k]) ? params[k].join(',') : String(params[k]))).replace(/&/g, '%26'))
    .join('&');
}
function cloudinarySignature(params, secret) {
  return crypto.createHash('sha1').update(cloudinaryToSign(params) + secret, 'utf8').digest('hex');
}

const newPublicId = () => 'ma/' + crypto.randomBytes(32).toString('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

// A reference to a Master Accounts file: {publicId, format, type,
// resourceType?}. → {ref} or {code, message}.
function assetRef(input) {
  const r = input && typeof input === 'object' ? input : {};
  const type = r.type;
  if (type !== 'authenticated' && type !== 'upload') return { code: 'file', message: "The file's type must be 'authenticated' or 'upload'." };
  const resourceType = r.resourceType === undefined || r.resourceType === null || r.resourceType === '' ? 'image' : r.resourceType;
  if (resourceType !== 'image') return { code: 'file', message: 'A Master Accounts file is an image resource (images and PDFs).' };
  const publicId = typeof r.publicId === 'string' ? r.publicId : '';
  if (!(type === 'authenticated' ? PID_AUTHENTICATED : PID_UPLOAD).test(publicId)) {
    return { code: 'file', message: 'That is not a Master Accounts file — its id must be ma/ followed by 64 hex characters.' };
  }
  const format = typeof r.format === 'string' ? r.format.toLowerCase() : '';
  if (MA_FORMATS.indexOf(format) < 0) return { code: 'file', message: 'A Master Accounts file is a JPG, PNG, WebP or HEIC image, or a PDF.' };
  return { ref: { publicId, resourceType, format, type } };
}

// What the browser says it is about to upload. → {name, mime, bytes} or
// {status, code, message}.
function fileCheck(input) {
  const f = input && typeof input === 'object' ? input : {};
  const name = typeof f.name === 'string' ? f.name.trim() : '';
  if (!name) return { status: 400, code: 'name', message: 'The file has no name.' };
  if (name.length > 200) return { status: 400, code: 'name', message: 'The file name is longer than 200 characters.' };
  if (/[\u0000-\u001f\u007f\\/]/.test(name)) return { status: 400, code: 'name', message: 'The file name has a character that is not allowed.' };
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (ext && !MA_EXTS[ext]) return { status: 415, code: 'type', message: 'Only images (JPG, PNG, WebP, HEIC) and PDFs can be attached — not .' + ext.slice(0, 12) + ' files.' };
  let mime = typeof f.type === 'string' ? f.type.trim().toLowerCase() : '';
  if (mime === 'image/jpg') mime = 'image/jpeg';
  if (!mime && ext) mime = MA_EXTS[ext];   // Windows reports no type for a .heic
  if (!MA_TYPES[mime]) return { status: 415, code: 'type', message: 'Only images (JPG, PNG, WebP, HEIC) and PDFs can be attached.' };
  if (ext && (mime === 'application/pdf') !== (ext === 'pdf')) {
    return { status: 415, code: 'type', message: 'The file is named .' + ext + ' but says it is ' + mime + '.' };
  }
  const size = f.size;
  if (!Number.isInteger(size) || size < 1) return { status: 400, code: 'size', message: 'The file size is missing, or the file is empty.' };
  if (size > MA_MAX_BYTES) return { status: 413, code: 'size', message: 'The file is larger than ' + Math.round(MA_MAX_BYTES / 1048576) + ' MB.' };
  return { name, mime, bytes: size };
}

// A private (authenticated) file, through Cloudinary's download API with an
// expiry — the SDK's private_download_url, by hand.
function privateDownloadUrl(cfg, ref, nowMs, opts) {
  const o = opts || {};
  const timestamp = Math.floor(nowMs / 1000);
  const expiresAt = timestamp + (o.ttl || URL_TTL_SECONDS);
  const p = { timestamp, public_id: ref.publicId, format: ref.format, type: ref.type, expires_at: expiresAt, api_key: cfg.apiKey };
  if (o.attachment) p.attachment = true;
  p.signature = cloudinarySignature(p, cfg.apiSecret);
  const qs = Object.keys(p).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(p[k]))).join('&');
  return { url: CLOUDINARY_API + encodeURIComponent(cfg.cloudName) + '/' + ref.resourceType + '/download?' + qs, expiresAt: expiresAt * 1000 };
}
function publicUrl(cfg, ref) {
  return CLOUDINARY_CDN + encodeURIComponent(cfg.cloudName) + '/' + ref.resourceType + '/upload/' + ref.publicId + '.' + ref.format;
}
// → {url, expiresAt (ms, null when it never expires), delivery} or {code}.
function deliveryUrl(cfg, ref, nowMs, opts) {
  if (ref.type === 'authenticated') {
    if (!cfg.signed) return { code: 'not_configured' };
    return Object.assign(privateDownloadUrl(cfg, ref, nowMs, opts), { delivery: 'signed' });
  }
  return { url: publicUrl(cfg, ref), expiresAt: null, delivery: 'public' };
}

// ── The audit trail (§29) — the core's own row shape (maAuditRow), so the
// Close & audit page reads a server row exactly like one it wrote itself.
// 'backup' is a server-only action the core's MA_AUDIT_ACTIONS does not list
// (maAuditRow would file it as 'post'), so it is set after. ────────────────
const SERVER_AUDIT_ACTIONS = ['share', 'revoke', 'backup'];
function auditRow(action, target, meta) {
  if (SERVER_AUDIT_ACTIONS.indexOf(action) < 0) throw new Error('not a server audit action: ' + action);
  const row = core.maAuditRow(action, target, meta);
  row.action = action;
  return row;
}
function auditId(at, by) {
  return String(at) + '-' + String(by || 'server').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) + '-' + crypto.randomBytes(3).toString('hex');
}

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = {
  MA_OWNER_EMAILS, CLOUDINARY_CLOUD, CLOUDINARY_PRESET, CLOUDINARY_API, CLOUDINARY_CDN,
  MA_MAX_BYTES, MA_TYPES, MA_EXTS, MA_FORMATS, URL_TTL_SECONDS, SIGN_TTL_SECONDS, CLOUDINARY_UNSIGNED,
  json, fail, header, bearer, readBody, serviceAccount, getAdmin, accessToken, verifyOwner,
  cloudinaryConfig, cloudinaryToSign, cloudinarySignature, newPublicId, newToken, assetRef, fileCheck,
  privateDownloadUrl, publicUrl, deliveryUrl, auditRow, auditId, esc, core
};
