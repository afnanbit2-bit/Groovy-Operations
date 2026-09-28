// ── Master Accounts: attachments (MASTER_ACCOUNTS_PLAN.md §29) ────────────
// Every other upload in the app is an UNSIGNED upload to a public Cloudinary
// path, readable by anyone holding its URL. The books' bills and receipts
// are not allowed to be that. This function is how an owner's browser
// uploads one privately and looks at it again — without ever holding the
// Cloudinary secret.
//
// POST JSON {action, …} with `Authorization: Bearer <Firebase ID token>`,
// verified here (netlify/lib/ma-server.js: owners only, revoked sessions
// refused). Actions:
//
//   status  → is the Cloudinary key set, and so which mode is in force.
//   sign    {file:{name, type, size}}
//           → everything the browser needs to POST the file STRAIGHT to
//             Cloudinary: the upload URL and the exact form fields, signed.
//             The file never passes through this function (Netlify caps a
//             request body far below a scanned PDF), and the secret never
//             leaves it. The name is minted HERE — `ma/<64 hex>`, 32 random
//             bytes — so no client can choose, guess or overwrite another
//             file's name. The signature covers public_id, type
//             ('authenticated'), allowed_formats and the timestamp, so
//             Cloudinary refuses the upload if any of them is changed, and
//             refuses a file that is not an image or a PDF whatever the
//             browser claimed.
//   url     {file:{publicId, format, type, resourceType?}, download?}
//           → a link to one file. A private file gets Cloudinary's signed
//             download URL that EXPIRES in 5 minutes; asking again is how
//             you look again.
//
// THE FALLBACK (§29), when CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET are
// not set: `sign` hands out the app's existing unsigned preset (groovy-ops)
// with the same server-minted random name. What that does NOT protect: the
// file is public, and its URL — once seen, copied or leaked — opens it
// forever; nothing can expire it, and revoking a share link cannot recall a
// URL someone already has. `status` says which mode is in force so the
// settings page can say so too.
//
// UNVERIFIED from the sandbox (it cannot reach cloudinary.com at all):
// whether the account's plan allows authenticated uploads and the download
// API, the plan's own file-size cap (the free tier is smaller than our 25 MB),
// and whether the unsigned preset honours a public_id. The first real upload
// is the test; every Cloudinary refusal reaches the browser as Cloudinary's
// own message.
'use strict';
const lib = require('../lib/ma-server.js');

async function handle(event, nowMs) {
  if (!event || event.httpMethod !== 'POST') return lib.fail(405, 'method', 'POST only.', { Allow: 'POST' });
  if (!lib.serviceAccount(process.env)) return lib.fail(503, 'not_configured', 'The server is not set up: FIREBASE_SERVICE_ACCOUNT is missing.');
  let app;
  try { app = lib.getAdmin(); } catch (e) { return lib.fail(503, 'not_configured', 'The server could not start the Admin SDK: ' + ((e && e.message) || e)); }
  const who = await lib.verifyOwner(event, app);
  if (who.error) return who.error;
  const rb = lib.readBody(event);
  if (rb.error) return rb.error;
  const body = rb.body;
  const cfg = lib.cloudinaryConfig(process.env);
  try {
    if (body.action === 'status') return status(cfg);
    if (body.action === 'sign') return sign(cfg, body, nowMs);
    if (body.action === 'url') return url(cfg, body, nowMs);
    return lib.fail(400, 'action', 'Unknown action.');
  } catch (e) {
    console.error('[ma-attach]', body.action, (e && e.stack) || e);
    return lib.fail(500, 'server', 'The attachment server failed: ' + ((e && e.message) || e));
  }
}

function status(cfg) {
  return lib.json(200, {
    configured: cfg.signed,
    mode: cfg.mode,
    missing: cfg.missing,
    cloudName: cfg.cloudName,
    preset: cfg.signed ? null : cfg.preset,
    maxBytes: lib.MA_MAX_BYTES,
    types: Object.keys(lib.MA_TYPES),
    formats: lib.MA_FORMATS,
    urlSeconds: lib.URL_TTL_SECONDS,
    note: cfg.signed
      ? 'Attachments are private: each look is a link that stops working after ' + (lib.URL_TTL_SECONDS / 60) + ' minutes.'
      : 'Attachments are PUBLIC: they go up through the app’s unsigned preset, and anyone who has a file’s link can open it, for good. Set CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in Netlify to make them private.'
  });
}

function sign(cfg, body, nowMs) {
  const f = lib.fileCheck(body.file);
  if (f.code) return lib.fail(f.status, f.code, f.message);
  const publicId = lib.newPublicId();
  const uploadUrl = lib.CLOUDINARY_API + encodeURIComponent(cfg.cloudName) + '/image/upload';
  const common = { publicId, resourceType: 'image', name: f.name, mime: f.mime, bytes: f.bytes, maxBytes: lib.MA_MAX_BYTES, uploadUrl };
  if (cfg.signed) {
    const timestamp = Math.floor(nowMs / 1000);
    // Everything the browser will send is here; api_key is left out of the
    // signature by cloudinaryToSign, which is what makes that exclusion
    // load-bearing (and tested).
    const fields = {
      api_key: cfg.apiKey,
      timestamp,
      public_id: publicId,
      type: 'authenticated',
      allowed_formats: lib.MA_FORMATS.join(',')
    };
    fields.signature = lib.cloudinarySignature(fields, cfg.apiSecret);
    return lib.json(200, Object.assign(common, {
      mode: 'authenticated', type: 'authenticated', fields,
      signatureExpiresAt: (timestamp + lib.SIGN_TTL_SECONDS) * 1000
    }));
  }
  return lib.json(200, Object.assign(common, {
    mode: 'unsigned', type: 'upload',
    fields: { upload_preset: cfg.preset, public_id: publicId },
    signatureExpiresAt: null,
    warning: 'This file will be public: anyone who has its link can open it, for good.'
  }));
}

function url(cfg, body, nowMs) {
  const a = lib.assetRef(body.file);
  if (a.code) return lib.fail(400, a.code, a.message);
  const out = lib.deliveryUrl(cfg, a.ref, nowMs, { attachment: body.download === true });
  if (out.code) return lib.fail(503, 'not_configured', 'This file is private and the server has no Cloudinary key to open it with — set CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in Netlify.');
  return lib.json(200, { url: out.url, expiresAt: out.expiresAt, delivery: out.delivery });
}

exports.handler = event => handle(event, Date.now());
exports._handle = handle;
