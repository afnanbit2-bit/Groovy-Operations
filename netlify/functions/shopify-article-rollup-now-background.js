/* shopify-article-rollup-now-background — run the article rollup ON DEMAND,
 * or rebuild it in FULL (owners only).
 *
 * shopify-article-rollup-background is SCHEDULED (netlify.toml, 06:15 UTC) and
 * Netlify answers a direct HTTP request to a scheduled function with 403, so
 * this is the unscheduled wrapper (the ma-rollup-now-background.js /
 * pattern-sync-now-background.js precedent): POST with the owner's Firebase ID
 * token in `Authorization: Bearer …`, verified server-side by ma-server's
 * verifyOwner (afnan and ammar — MA_OWNER_EMAILS, the owners list). Body
 * {"mode":"full"} rebuilds every article from the first synced day (51k+ line
 * items, 128+ snapshots; a few minutes); anything else is the nightly
 * trailing-60-day recompute. A BACKGROUND function: Netlify answers 202 at
 * once and ignores the return, so the page polls shopify_rollup_meta/status
 * (`state`, `finished_at`); a refusal is visible only to a direct caller — the
 * UI gate is what people see, this check is the boundary.
 */
'use strict';
const lib = require('../lib/ma-server.js');
const rollup = require('./shopify-article-rollup-background.js');

exports.handler = async function (event) {
  if (event && event.httpMethod && event.httpMethod !== 'POST') return lib.fail(405, 'method', 'POST only.');
  const started = lib.startAdmin('article-rollup-now');
  if (started.error) return started.error;
  const who = await lib.verifyOwner(event, started.app);
  if (who.error) return who.error;
  let mode = 'nightly';
  try { const b = JSON.parse((event && event.body) || '{}'); if (b && b.mode === 'full') mode = 'full'; } catch (e) { return lib.fail(400, 'json', 'The request body is not JSON.'); }
  try {
    const report = await rollup.runRollup({ db: started.app.firestore(), nowMs: Date.now(), mode, triggeredBy: who.owner.email });
    console.log('[article-rollup-now]', report.state, JSON.stringify({ mode: report.mode, counts: report.counts, error: report.error }));
    const ok = report.state !== 'failed';
    return lib.json(ok ? 200 : 500, { ok, state: report.state, mode: report.mode });
  } catch (e) {
    console.error('[article-rollup-now] failed and could not record it', (e && e.stack) || e);
    return lib.fail(500, 'failed', 'The rollup failed and could not record why — see the Netlify function log.');
  }
};
