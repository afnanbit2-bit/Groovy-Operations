// ── Link previews (Sept 2026) ──────────────────────────────────────────
// Pasting a URL onto a Mood Board should give you the picture, the title
// and the description, the way Milanote does — not three empty form fields.
//
// THIS FUNCTION EXISTS BECAUSE THE BROWSER CANNOT DO IT. Reading another
// origin's HTML for og:image/og:title is exactly what CORS forbids, so the
// fetch has to happen server-side. CLAUDE.md has flagged this since Phase 2
// as the deliberate follow-up that must not be shipped casually, because a
// server that fetches a URL a user typed is a Server-Side Request Forgery
// hole unless every one of these is closed:
//
//   - http/https only, and no credentials in the URL.
//   - THE HOSTNAME IS RESOLVED AND EVERY ADDRESS CHECKED before the fetch.
//     A name that resolves to 127.0.0.1, 10.x, 192.168.x, ::1, fd00::/8 or
//     169.254.169.254 (the cloud metadata address, the one that actually
//     matters) is refused. Not a blocklist of hostnames — those are trivial
//     to evade with a DNS record you control.
//   - REDIRECTS ARE FOLLOWED BY HAND, and each hop is re-validated. Left to
//     fetch's own redirect handling, a public URL that 302s to
//     http://169.254.169.254/ walks straight through the check above.
//   - A timeout, a byte cap, and a content-type check, so a hostile or
//     merely enormous page cannot hold the function open or fill memory.
//   - The caller's Firebase ID token is verified. Any signed-in user of this
//     app may preview a link; nobody else may use this as a fetch proxy.
//
// RESIDUAL RISK, STATED PLAINLY: this resolves the name and then fetches by
// name, so a DNS rebind between the two calls is not prevented. Pinning to
// the resolved IP means connecting by IP with a Host header, which breaks
// TLS certificate validation unless the TLS servername is overridden —
// undici's fetch does not expose that. The reward for winning that race is
// one HTML page read back through a response this function has already
// stripped to four short strings, which is why it was accepted rather than
// hidden. Do not widen what is returned without revisiting it.
//
// THE HTML IS NEVER RETURNED. Only title, description, image URL and site
// name come back, each length-capped, and the client hydrates them with
// textContent like every other string a third party wrote.
const admin = require("firebase-admin");
const dns = require("dns").promises;
const net = require("net");

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MAX_TITLE = 300;
const MAX_DESC = 600;
const MAX_URL = 2000;
const BLOCKED = "That address is not reachable from here.";
// A real, current UA: a fair number of sites serve no og: tags at all to
// something that announces itself as a bot.
const UA = "Mozilla/5.0 (compatible; GroovyOpsLinkPreview/1.0; +https://groovyoperations.netlify.app)";

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

/**
 * Is this IP one we must never ask a question of? Covers loopback, both
 * private ranges, link-local (which is where 169.254.169.254 lives),
 * carrier-grade NAT, multicast/reserved, and the IPv6 equivalents including
 * ::ffff: mapped v4. Anything that is not a valid IP at all returns true —
 * fail closed. Pure.
 */
function isBlockedIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const p = String(ip).split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !(n >= 0 && n <= 255))) return true;
    const [a, b] = p;
    if (a === 0) return true;                        // "this network"
    if (a === 10) return true;                       // private
    if (a === 127) return true;                      // loopback
    if (a === 169 && b === 254) return true;         // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;// private
    if (a === 192 && b === 168) return true;         // private
    if (a === 192 && b === 0) return true;           // IETF protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true;                       // multicast, reserved, broadcast
    return false;
  }
  if (v === 6) {
    const s = String(ip).toLowerCase();
    if (s === "::" || s === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isBlockedIp(mapped[1]);
    if (/^fe[89ab]/.test(s)) return true;            // link-local
    if (/^f[cd]/.test(s)) return true;               // unique local
    if (/^ff/.test(s)) return true;                  // multicast
    return false;
  }
  return true;
}

/**
 * Validates a URL and resolves its host, throwing rather than returning a
 * flag so no caller can forget to check. Called again for EVERY redirect
 * hop — that is the whole point of following them by hand.
 */
async function assertSafeUrl(raw, lookup) {
  const resolve = lookup || ((h) => dns.lookup(h, { all: true }));
  let u;
  try { u = new URL(String(raw)); } catch { throw new Error("That does not look like a link."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http and https links can be previewed.");
  if (u.username || u.password) throw new Error("A link carrying a username or password is not previewed.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new Error(BLOCKED);
  const lower = host.toLowerCase();
  if (lower === "localhost" || /\.(local|internal|localdomain|home|lan)$/.test(lower)) throw new Error(BLOCKED);
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error(BLOCKED);
    return u;
  }
  let addrs;
  try { addrs = await resolve(host); } catch { throw new Error("That address could not be found."); }
  if (!addrs || !addrs.length) throw new Error("That address could not be found.");
  if (addrs.some((a) => isBlockedIp(a.address))) throw new Error(BLOCKED);
  return u;
}

/** Reads at most MAX_BYTES of the body and stops pulling. */
async function readCapped(res) {
  const reader = res.body && typeof res.body.getReader === "function" ? res.body.getReader() : null;
  if (!reader) return String(await res.text()).slice(0, MAX_BYTES);
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const buf = Buffer.from(value);
    n += buf.length;
    chunks.push(buf);
    if (n >= MAX_BYTES) { try { await reader.cancel(); } catch { /* already closed */ } break; }
  }
  return Buffer.concat(chunks).slice(0, MAX_BYTES).toString("utf8");
}

async function fetchHtml(startUrl, deps) {
  const d = deps || {};
  const doFetch = d.fetch || fetch;
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await assertSafeUrl(url, d.lookup);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    let r;
    try {
      r = await doFetch(u.href, {
        redirect: "manual",
        signal: ac.signal,
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en" },
      });
    } catch (e) {
      throw new Error(e && e.name === "AbortError" ? "That site took too long to answer." : "Could not reach that site.");
    } finally {
      clearTimeout(timer);
    }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) throw new Error("That link redirected nowhere.");
      // Re-validated at the top of the next pass — never trusted here.
      url = new URL(loc, u.href).href;
      continue;
    }
    if (!r.ok) throw new Error("That site answered " + r.status + ".");
    const ct = String(r.headers.get("content-type") || "").toLowerCase();
    // A PDF or an image is a perfectly good link; it just has no og: tags.
    if (ct && !/text\/html|application\/xhtml\+xml/.test(ct)) return { finalUrl: u.href, html: "", contentType: ct };
    return { finalUrl: u.href, html: await readCapped(r), contentType: ct };
  }
  throw new Error("That link redirected too many times.");
}

/** The entities that actually turn up in a title. Pure. */
function decodeEntities(s) {
  // fromCodePoint THROWS on anything past U+10FFFF, and this runs on HTML a
  // stranger wrote — a single &#9999999; would otherwise cost the whole
  // preview. An unreadable entity is left as the literal text it already is.
  const cp = (n) => { try { return String.fromCodePoint(n); } catch { return ""; } };
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => cp(parseInt(h, 16)) || m)
    .replace(/&#(\d+);/g, (m, n) => cp(parseInt(n, 10)) || m)
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");   // last, or &amp;lt; decodes twice
}

/**
 * First of `keys` that a <meta> tag carries, by property OR name (Open
 * Graph uses property=, Twitter cards and plain descriptions use name=).
 * The attribute order inside the tag is not assumed — the content is pulled
 * out of the matched tag separately. Pure.
 */
function metaContent(html, keys) {
  const src = String(html || "");
  for (const key of keys) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp('<meta\\b[^>]*?(?:property|name)\\s*=\\s*["\']' + esc + '["\'][^>]*>', "i");
    const tag = re.exec(src);
    if (!tag) continue;
    const c = /content\s*=\s*"([^"]*)"/i.exec(tag[0]) || /content\s*=\s*'([^']*)'/i.exec(tag[0]);
    if (c && c[1].trim()) return decodeEntities(c[1].trim());
  }
  return "";
}

/** An image URL only counts if it resolves to something http(s) and public. Pure. */
function safeImageUrl(raw, base) {
  if (!raw) return "";
  let u;
  try { u = new URL(raw, base); } catch { return ""; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isBlockedIp(host)) return "";
  return u.href.length <= MAX_URL ? u.href : "";
}

/** Everything the card needs, and nothing else. Pure. */
function extract(html, finalUrl) {
  const title = metaContent(html, ["og:title", "twitter:title"])
    || decodeEntities(((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || "").replace(/\s+/g, " ").trim());
  const description = metaContent(html, ["og:description", "twitter:description", "description"]);
  const image = safeImageUrl(metaContent(html, ["og:image:secure_url", "og:image:url", "og:image", "twitter:image", "twitter:image:src"]), finalUrl);
  let host = "";
  try { host = new URL(finalUrl).hostname.replace(/^www\./, ""); } catch { host = ""; }
  return {
    url: finalUrl,
    host,
    title: String(title || "").slice(0, MAX_TITLE),
    description: String(description || "").slice(0, MAX_DESC),
    image,
    siteName: metaContent(html, ["og:site_name"]).slice(0, MAX_TITLE) || host,
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return json(500, { error: "Missing env var: FIREBASE_SERVICE_ACCOUNT" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON body" }); }
  if (!body.idToken) return json(400, { error: "idToken is required" });
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  }
  // Any signed-in user of this app may preview a link — every one of them
  // can already create a board. The gate is here so this is not an open
  // fetch proxy for the internet, not to pick which colleague gets previews.
  try { await admin.auth().verifyIdToken(body.idToken); }
  catch { return json(401, { error: "Could not verify who you are — sign in again and retry." }); }

  try {
    const got = await fetchHtml(String(body.url || ""));
    return json(200, Object.assign({ ok: true }, extract(got.html, got.finalUrl)));
  } catch (e) {
    // A site that will not be read is a normal outcome, not a server fault:
    // the card still exists, it just shows the bare URL.
    return json(200, { ok: false, error: (e && e.message) || "Could not read that page." });
  }
};

Object.assign(exports, {
  isBlockedIp, assertSafeUrl, decodeEntities, metaContent, safeImageUrl, extract, fetchHtml,
  MAX_BYTES, MAX_REDIRECTS, BLOCKED,
});
