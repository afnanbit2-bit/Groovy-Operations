// ── Stock image search, proxied ──────────────────────────────────────
// The point of this function is ONE line of policy: the provider key lives
// in process.env and never reaches the browser. js/*.js and every *.html in
// this repo are public static assets — anything in them is readable
// worldwide with a single curl, before any login happens — so a Pexels key
// pasted into js/boards.js would be a published key. Same reason
// SHOPIFY_CLIENT_SECRET and FIREBASE_SERVICE_ACCOUNT live out here.
//
// A leaked search key is not a data breach, which is exactly why it is
// tempting to shortcut. It still burns someone else's quota and it still
// breaks the rule the rest of this codebase holds, so it does not get an
// exception for being cheap.
//
// NOT CONFIGURED IS A FIRST-CLASS ANSWER. With no PEXELS_API_KEY set this
// returns 200 with {configured:false} rather than an error, because the
// panel that calls it is useful without search — you can still upload — and
// a red failure for a feature nobody has switched on reads as a bug.
//
// UNVERIFIED AGAINST THE LIVE API. The build sandbox cannot reach
// api.pexels.com (nor openverse, nor unsplash — all refused at the egress
// proxy), so the request shape and the response mapping below are written
// from the documented API and have NOT been exercised against it. Treat the
// first real call as the test.
const PROVIDER = "https://api.pexels.com/v1/search";

exports.handler = async (event) => {
  const key = process.env.PEXELS_API_KEY;
  const json = (code, body) => ({
    statusCode: code,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  });

  if (!key) {
    return json(200, {
      configured: false,
      hint: "Set PEXELS_API_KEY in Netlify → Site settings → Environment variables. A free key from pexels.com/api is enough.",
      photos: [],
    });
  }

  const q = String((event.queryStringParameters || {}).q || "").trim();
  if (!q) return json(200, { configured: true, photos: [] });

  // Bounded on purpose: a runaway page size is the only way a caller can
  // make this expensive, and the panel shows a grid, not an archive.
  const per = Math.min(30, Math.max(1, parseInt((event.queryStringParameters || {}).per, 10) || 24));

  try {
    const r = await fetch(
      PROVIDER + "?query=" + encodeURIComponent(q) + "&per_page=" + per,
      { headers: { Authorization: key } }
    );
    if (!r.ok) {
      return json(200, {
        configured: true,
        error: "Search provider returned " + r.status,
        photos: [],
      });
    }
    const d = await r.json();
    // Mapped to the few fields the panel needs rather than passed through:
    // the client should not have to learn a third party's response shape,
    // and a provider swap then touches this file only.
    const photos = (d.photos || []).map((p) => ({
      id: String(p.id),
      thumb: (p.src && (p.src.tiny || p.src.small)) || "",
      full: (p.src && (p.src.large2x || p.src.large || p.src.original)) || "",
      alt: String(p.alt || "").slice(0, 140),
      credit: String((p.photographer || "").slice(0, 80)),
      creditUrl: String(p.photographer_url || ""),
    })).filter((p) => p.thumb && p.full);
    return json(200, { configured: true, photos });
  } catch (e) {
    return json(200, {
      configured: true,
      error: "Could not reach the search provider",
      photos: [],
    });
  }
};
