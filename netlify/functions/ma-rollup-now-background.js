/* ma-rollup-now-background — run the courier rollup ON DEMAND (owners only).
 *
 * ma-rollup-background is SCHEDULED (netlify.toml, 03:45 UTC) and Netlify
 * answers a direct HTTP request to a scheduled function with 403, so this is
 * the unscheduled wrapper (the pattern-sync-now-background.js precedent):
 * POST with the owner's Firebase ID token in `Authorization: Bearer …`,
 * verified server-side by ma-server's verifyOwner (afnan and ammar only, the
 * email compared exactly as the rules compare it). A BACKGROUND function:
 * Netlify answers 202 at once and ignores the handler's return, so the page
 * polls ma_runs/rollup (`at`, `state`) for the result — a refusal is only
 * visible to a caller who calls it directly (the UI gate is what people see;
 * this check is the boundary).
 */
'use strict';
const lib = require('../lib/ma-server.js');
const rollup = require('./ma-rollup-background.js');

exports.handler = async function (event) {
  if (event && event.httpMethod && event.httpMethod !== 'POST') return lib.fail(405, 'method', 'POST only.');
  const started = lib.startAdmin('ma-rollup-now');
  if (started.error) return started.error;
  const who = await lib.verifyOwner(event, started.app);
  if (who.error) return who.error;
  try {
    const report = await rollup.runRollup({ db: started.app.firestore(), nowMs: Date.now(), triggeredBy: who.owner.email });
    console.log('[ma-rollup-now]', JSON.stringify(report));
    return lib.json(report.state === 'done' ? 200 : 500, { ok: report.state === 'done', report });
  } catch (e) {
    console.error('[ma-rollup-now] failed and could not record it', (e && e.stack) || e);
    return lib.fail(500, 'failed', 'The rollup failed and could not record why — see the Netlify function log.');
  }
};
