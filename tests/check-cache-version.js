#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   CACHE_VERSION guard.  `node tests/check-cache-version.js <base-ref>`

   CLAUDE.md: "sw.js serves precached HTML/CSS/JS cache-first, so phones keep
   serving the old files until the cache version changes. Forget this and
   your change silently will not reach anyone who already opened the app."

   Silently is the problem — nothing fails, nothing looks wrong, the change
   just never arrives. So: if a precached file changed, CACHE_VERSION must
   have changed too. This is the one check that needs git history, which is
   why it is not part of the invariants suite.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const {execSync}=require('child_process');

const base=process.argv[2];
if(!base){
  console.error('usage: node tests/check-cache-version.js <base-ref>');
  process.exit(2);
}

const sh=cmd=>execSync(cmd,{encoding:'utf8'}).trim();

let changed;
try{
  changed=sh('git diff --name-only '+JSON.stringify(base)+' HEAD').split('\n').filter(Boolean);
}catch(e){
  // A shallow clone or a first commit — nothing to compare against, so this
  // check abstains rather than inventing a failure.
  console.log('cache-version: no comparable history against '+base+' — skipping');
  process.exit(0);
}

const SHIPPED=/^(index\.html|store\.html|color-backfill\.html|pantone-importer\.html|manifest\.json|css\/.*\.css|js\/.*\.js)$/;
const shipped=changed.filter(f=>SHIPPED.test(f));

if(!shipped.length){
  console.log('cache-version: no precached file changed — nothing to bump');
  process.exit(0);
}

const versionAt=ref=>{
  const src=ref==='HEAD'?sh('git show HEAD:sw.js'):sh('git show '+JSON.stringify(ref)+':sw.js');
  const m=/const CACHE_VERSION\s*=\s*'([^']+)'/.exec(src);
  return m?m[1]:null;
};

let before,after;
try{before=versionAt(base);after=versionAt('HEAD');}
catch(e){
  console.log('cache-version: could not read sw.js on both sides — skipping');
  process.exit(0);
}

if(!after){
  console.error('cache-version: FAILED — could not find CACHE_VERSION in sw.js');
  process.exit(1);
}
if(before===after){
  console.error('\ncache-version: FAILED');
  console.error('  These precached files changed:');
  shipped.forEach(f=>console.error('    - '+f));
  console.error('  but CACHE_VERSION in sw.js is still '+JSON.stringify(after)+'.');
  console.error('');
  console.error('  Anyone who has already opened the app will keep being served the');
  console.error('  OLD files from cache. Bump it (v'+(parseInt(String(after).replace(/\D/g,''),10)+1||'…')+') and push again.');
  console.error('');
  process.exit(1);
}
console.log('cache-version: ok — '+shipped.length+' precached file(s) changed, '+before+' → '+after);
