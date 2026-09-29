/* ─────────────────────────────────────────────────────────────────────────
   The QA read guard (29 Sept 2026). Afnan's decision: claude@groovy.op READS
   every collection and path any rule lets any role read. That only stays
   true if a collection added later is covered too, so this fails the build
   the day a read rule is written that does not admit the QA account.

     · every `allow read` / `allow get` / `allow list` goes through
       isQaRead() (one helper, OR'd in — never a second signedIn() gate)
     · a `allow read, write:` shorthand is split, never left combined
     · request.auth != null appears only in signedIn(), authed() and isQa()
     · the credential collections have NO match block (denied to everyone)
     · isQaRead() is read-only by construction (get/list) and email-bound
     · the write fence text is what the emulator suite exercises:
       signedIn() still excludes QA, and no write clause was widened

   The behaviour itself is tests/rules-emulator-qa.js (real emulator).
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs=require('fs');
const path=require('path');
const {suite}=require('./harness');
const ROOT=path.join(__dirname,'..');
const rules=fs.readFileSync(path.join(ROOT,'firestore.rules'),'utf8');
const src=rules.split('\n').map(l=>l.replace(/\/\/.*$/,'')).join('\n');

module.exports=async function(){
  const s=suite('qa-read-guard');

  s.section('the helper');
  {
    const h=/function isQaRead\(\)\s*\{([^}]*)\}/.exec(src);
    s.ok('isQaRead() exists',!!h);
    s.ok('it is QA and only for get / list',!!h&&/isQa\(\)/.test(h[1])&&/request\.method in \['get', 'list'\]/.test(h[1]));
    const q=/function isQa\(\)\s*\{([^}]*)\}/.exec(src);
    s.ok('isQa() is bound to the account\'s email',!!q&&/claude@groovy\.op/.test(q[1]));
    s.ok('signedIn() still EXCLUDES QA (no second gate, writes stay fenced)',/function signedIn\(\)\s*\{\s*return request\.auth != null && !isQa\(\);\s*\}/.test(src));
    const uses=[...src.matchAll(/request\.auth != null/g)].length;
    s.eq('request.auth != null appears only in signedIn(), authed() and isQa()',uses,3);
  }

  s.section('every read rule admits QA');
  {
    // split into statements: `allow <kinds> : ... ;`
    const stmts=[...src.matchAll(/allow\s+([a-z, ]+?)\s*:\s*if\s+([\s\S]*?);(?=\s*(?:allow|\}|match|function|\n\s*(?:allow|\}|match|function)))/g)]
      .map(m=>({kinds:m[1].split(',').map(k=>k.trim()),cond:m[2]}));
    const reads=stmts.filter(t=>t.kinds.some(k=>k==='read'||k==='get'||k==='list'));
    s.ok('the parser found the read rules ('+reads.length+')',reads.length>=85);
    const bad=reads.filter(t=>!/^\s*isQaRead\(\)\s*\|\|/.test(t.cond));
    s.eq('every read rule starts `isQaRead() ||` (offenders: '+bad.slice(0,3).map(b=>b.cond.replace(/\s+/g,' ').slice(0,60)).join(' ;; ')+')',bad.length,0);
    const combined=stmts.filter(t=>t.kinds.includes('read')&&t.kinds.some(k=>['write','create','update','delete'].includes(k)));
    s.eq('no rule combines read with write in one statement (the read would carry the write)',combined.length,0);
    const onlyGetList=stmts.filter(t=>t.kinds.some(k=>k==='get'||k==='list'));
    s.eq('nothing uses allow get / allow list on its own',onlyGetList.length,0);
    s.ok('every `allow read` in the raw text was parsed as a statement',(src.match(/allow\s+read\s*:/g)||[]).length===reads.length);
    // a match block that HAS rules but no read rule is a path nobody can read: allowed, but named
    s.ok('the number of read statements equals the number of allow-read tokens',(src.match(/allow\s+read/g)||[]).length===reads.length);
  }

  s.section('the credential collections have no match block');
  {
    for(const c of ['integration_secrets','passkeys','passkey_challenges'])
      s.ok(c+' has no match block (default deny, QA included)',!new RegExp('match\\s+/'+c+'/').test(src));
    s.ok('and no catch-all match',!/match\s+\/\{[a-zA-Z_]+=\*\*\}/.test(src));
  }

  s.section('the write side is the fence it was');
  {
    // Every write clause that names QA is one of the declared few.
    const quals=[...src.matchAll(/allow\s+(create|update|delete|write)\s*[^;]*isQa\(\)[^;]*;/g)].length;
    s.ok('write clauses naming isQa() exist only where the fence lives ('+quals+')',quals>0&&quals<40);
    const q=/function qaOwnNotice\(d\)\s*\{([^}]*)\}/.exec(src);
    s.ok('hrm_notifications: QA writes only rows addressed to itself, and to no role',!!q&&/forUser', ''\) == 'claude'/.test(q[1])&&/forRole', ''\) == ''/.test(q[1]));
    s.ok('… on create',/allow create: if signedIn\(\) \|\| \(isQa\(\) && qaOwnNotice\(request\.resource\.data\)\);/.test(src));
    s.ok('… and on update, before AND after',/allow update: if signedIn\(\) \|\| \(isQa\(\) && qaOwnNotice\(resource\.data\) && qaOwnNotice\(request\.resource\.data\)\);/.test(src));
    s.ok('board_items: QA assigns nobody but itself',/request\.resource\.data\.assigneeUids == \[request\.auth\.uid\]/.test(src));
    s.ok('board_lists: QA admins alone (memberUids == [its uid])',/request\.resource\.data\.get\('memberUids', \[\]\) == \[request\.auth\.uid\]/.test(src));
  }
  return s;
};
