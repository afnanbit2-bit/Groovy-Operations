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
//   status  → which of the three states attachments are in (`state`):
//             'signed' (200, mode 'authenticated'), 'public' (200, mode
//             'unsigned') or 'not_configured' — a 503 not_configured whose
//             body is the same status, with `error` saying what is missing
//             and both ways out. Every attachment path then says the same
//             thing, and a page that reads only {error, code} — as M1.5b's
//             does — shows that sentence rather than calling it public.
//   sign    {file:{name, type, size}}
//           → everything the browser needs to POST the file STRAIGHT to
//             Cloudinary: the upload URL and the exact form fields, signed.
//             The file never passes through this function (Netlify caps a
//             request body far below a scanned PDF), and the secret never
//             leaves it. The name is minted HERE — `ma/<64 hex>`, 32 random
//             bytes — so no client can choose or guess another file's name.
//             The signature covers public_id, type ('authenticated'),
//             allowed_formats, the timestamp AND overwrite=0, so Cloudinary
//             refuses the upload if any of them is changed, refuses a file
//             that is not an image or a PDF whatever the browser claimed,
//             and — since a signed upload overwrites by default — never
//             lets the same fields, replayed within the signature's hour,
//             put a different file under a name that is already taken
//             (M1.6c, security F7). `0` is how Cloudinary's own Node SDK
//             (2.11.0, as_safe_bool) sends overwrite:false.
//   url     {file:{publicId, format, type, resourceType?}, download?}
//           → a link to one file. A private file gets Cloudinary's signed
//             download URL that EXPIRES in 5 minutes; asking again is how
//             you look again.
//
// THE FALLBACK (§29) IS OPT-IN (M1.6c). With CLOUDINARY_API_KEY and
// CLOUDINARY_API_SECRET not set, `sign` refuses — 503 not_configured, and
// nothing is uploaded — unless the owners set MA_ALLOW_PUBLIC_ATTACH=1 in
// Netlify. Only then does it hand out the app's unsigned preset (groovy-ops)
// with the same server-minted random name. What that does NOT protect: the
// file is public, and its URL — once seen, copied or leaked — opens it
// forever; nothing can expire it, and revoking a share link cannot recall a
// URL someone already has. A file that is already public still opens
// through `url` whatever the setting: it exists, it is the owners' own
// bill, and refusing to show it would un-publish nothing.
//
// UNVERIFIED from the sandbox (it cannot reach cloudinary.com at all):
// whether the account's plan allows authenticated uploads and the download
// API, the plan's own file-size cap (the free tier is smaller than our 25 MB),
// whether the unsigned preset honours a public_id, and what the account does
// with a replayed upload now that overwrite=0 is signed (keeping the file
// already there is what overwrite=false is for). The first real upload is
// the test; every Cloudinary refusal reaches the browser as Cloudinary's own
// message.
'use strict';
const lib = require('../lib/ma-server.js');

async function handle(event, nowMs) {
  if (!event || event.httpMethod !== 'POST') return lib.fail(405, 'method', 'POST only.', { Allow: 'POST' });
  // Nobody is known yet: a server that cannot start says so and no more.
  const boot = lib.startAdmin('ma-attach');
  if (boot.error) return boot.error;
  const app = boot.app;
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

// `configured` keeps its M1.5a meaning — the Cloudinary key is set, i.e.
// files are private — and `state` is the whole answer.
function status(cfg) {
  const out = {
    state: cfg.state,
    configured: cfg.signed,
    mode: cfg.mode,
    missing: cfg.missing,
    invalid: cfg.invalid,
    publicOptIn: cfg.publicOptIn,
    cloudName: cfg.cloudName,
    preset: cfg.state === 'public' ? cfg.preset : null,
    maxBytes: lib.MA_MAX_BYTES,
    types: Object.keys(lib.MA_TYPES),
    formats: lib.MA_FORMATS,
    urlSeconds: lib.URL_TTL_SECONDS,
    note: cfg.state === 'signed'
      ? 'Attachments are private: each look is a link that stops working after ' + (lib.URL_TTL_SECONDS / 60) + ' minutes.'
      : cfg.state === 'public'
        ? 'Attachments are PUBLIC, because ' + lib.PUBLIC_OPT_IN + ' is set to 1: they go up through the app’s unsigned preset, and anyone who has a file’s link can open it, for good. Set CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in Netlify to make new ones private.'
        : lib.attachNotSetUp(cfg)
  };
  if (cfg.state === 'not_configured') return lib.json(503, Object.assign({ error: out.note, code: 'not_configured' }, out));
  return lib.json(200, out);
}

function sign(cfg, body, nowMs) {
  // Fail closed: with no key and no opt-in, no name is minted and nothing
  // goes up — never a public file nobody chose.
  if (cfg.state === 'not_configured') return lib.fail(503, 'not_configured', lib.attachNotSetUp(cfg));
  const f = lib.fileCheck(body.file);
  if (f.code) return lib.fail(f.status, f.code, f.message);
  const publicId = lib.newPublicId();
  const uploadUrl = lib.CLOUDINARY_API + encodeURIComponent(cfg.cloudName) + '/image/upload';
  const common = { publicId, resourceType: 'image', name: f.name, mime: f.mime, bytes: f.bytes, maxBytes: lib.MA_MAX_BYTES, uploadUrl };
  if (cfg.state === 'signed') {
    const timestamp = Math.floor(nowMs / 1000);
    // Everything the browser will send is here; api_key is left out of the
    // signature by cloudinaryToSign, which is what makes that exclusion
    // load-bearing (and tested). overwrite is IN the signature: a signed
    // upload overwrites by default, and these fields stay valid for an hour.
    const fields = {
      api_key: cfg.apiKey,
      timestamp,
      public_id: publicId,
      type: 'authenticated',
      allowed_formats: lib.MA_FORMATS.join(','),
      overwrite: 0
    };
    fields.signature = lib.cloudinarySignature(fields, cfg.apiSecret);
    return lib.json(200, Object.assign(common, {
      mode: 'authenticated', type: 'authenticated', fields,
      signatureExpiresAt: (timestamp + lib.SIGN_TTL_SECONDS) * 1000
    }));
  }
  // state 'public': no key, and the owners opted in (MA_ALLOW_PUBLIC_ATTACH=1).
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
