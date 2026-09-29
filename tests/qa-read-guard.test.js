/* ─────────────────────────────────────────────────────────────────────────
   The QA read guard (29 Sept 2026). Afnan's decision: claude@groovy.op READS
   every collection and path any rule lets any role read. That only stays
   true if a collection added later is covered too, so this fails the build
   the day a read rule is written that does not admit the QA account.

     · every `allow read` / `allow get` / `allow list` goes through
       isQaRead() (one helper, OR'd in — never a second signedIn() gate)
       — EXCEPT the owner's books: Master Accounts (ma_*) is afnan + ammar
       only and the QA account must NOT read it, so those rules are exempt
       from the two checks around this bullet and held to the opposite rule
       (isMasterAccounts() alone, no isQa anywhere) in their own section
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
// The owner's books (Master Accounts, ma_*): the ONE definition of the exempt
// family is OWNER_ONLY_BOOKS in tools/qa-snapshot-lib.js (the snapshot tool and
// tests/rules-emulator-qa.js read the same one). The section below restates it
// as a literal `ma_` prefix, so widening the pattern cannot slip through.
const L=require('../tools/qa-snapshot-lib.js');

// The [start,end) span of every `match /<owner-only collection>/{id} { … }` block.
function ownerOnlyBlocks(text){
  const out=[];const re=/match\s+\/([A-Za-z0-9_]+)\/\{[A-Za-z0-9_]+\}\s*\{/g;let m;
  while((m=re.exec(text))){
    if(!L.isOwnerOnlyBooks(m[1]))continue;
    let depth=1,i=re.lastIndex;
    while(i<text.length&&depth>0){const ch=text[i++];if(ch==='{')depth++;else if(ch==='}')depth--;}
    out.push({name:m[1],start:m.index,end:i});
  }
  return out;
}
function withoutBlocks(text,blocks){
  let out='',pos=0;
  for(const b of blocks){out+=text.slice(pos,b.start);pos=b.end;}
  return out+text.slice(pos);
}

module.exports=async function(){
  const s=suite('qa-read-guard');
  // split into statements: `allow <kinds> : ... ;` — `at` is where each one sits
  const all=[...src.matchAll(/allow\s+([a-z, ]+?)\s*:\s*if\s+([\s\S]*?);(?=\s*(?:allow|\}|match|function|\n\s*(?:allow|\}|match|function)))/g)]
    .map(m=>({kinds:m[1].split(',').map(k=>k.trim()),cond:m[2],at:m.index}));
  const books=ownerOnlyBlocks(src);
  const inBooks=t=>books.some(b=>t.at>=b.start&&t.at<b.end);

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
    // THE ONE EXEMPTION (29 Sept 2026, when Master Accounts met the QA work).
    // Master Accounts (ma_*) is readable by afnan and ammar ONLY — Afnan: "just
    // for me and Ammar" — and the account used for automated QA must not be able
    // to read the owner's books. So those rules are `isMasterAccounts()` alone,
    // and are NOT `isQaRead() ||`. They are taken out of THIS section, which is
    // exactly as strict as before for every other collection, and held to the
    // opposite rule in the next section. Their combined
    // `allow read, create, update:` statements are exempt from the "no combined
    // read" check for the same reason: nothing in them names isQa(), so there is
    // no QA write for a combined read to carry.
    const stmts=all.filter(t=>!inBooks(t));
    const srcRest=withoutBlocks(src,books);    // the raw text without those blocks
    const reads=stmts.filter(t=>t.kinds.some(k=>k==='read'||k==='get'||k==='list'));
    s.ok('the parser found the read rules ('+reads.length+')',reads.length>=85);
    const bad=reads.filter(t=>!/^\s*isQaRead\(\)\s*\|\|/.test(t.cond));
    s.eq('every read rule starts `isQaRead() ||` (offenders: '+bad.slice(0,3).map(b=>b.cond.replace(/\s+/g,' ').slice(0,60)).join(' ;; ')+')',bad.length,0);
    const combined=stmts.filter(t=>t.kinds.includes('read')&&t.kinds.some(k=>['write','create','update','delete'].includes(k)));
    s.eq('no rule combines read with write in one statement (the read would carry the write)',combined.length,0);
    const onlyGetList=stmts.filter(t=>t.kinds.some(k=>k==='get'||k==='list'));
    s.eq('nothing uses allow get / allow list on its own',onlyGetList.length,0);
    s.ok('every `allow read` in the raw text was parsed as a statement',(srcRest.match(/allow\s+read\s*:/g)||[]).length===reads.length);
    // a match block that HAS rules but no read rule is a path nobody can read: allowed, but named
    s.ok('the number of read statements equals the number of allow-read tokens',(srcRest.match(/allow\s+read/g)||[]).length===reads.length);
  }

  s.section('the owner-only books (ma_*): exempt from the QA read rule, and shut to QA');
  {
    // The exemption above is only safe while these rules stay exactly what the
    // owner asked for. Every assertion here is the OPPOSITE of the section
    // above: none of these rules may admit the QA account.
    const KNOWN=['ma_accounts','ma_sv_accounts','ma_parties','ma_items','ma_settings','ma_commitments','ma_counters','ma_feedback',
      'ma_journal','ma_transfer','ma_counts','ma_closes','ma_audit','ma_backups','ma_shares'];
    const named=books.map(b=>b.name);
    s.ok('the parser found every Master Accounts collection ('+books.length+' blocks)',KNOWN.every(c=>named.indexOf(c)>-1));
    // The family is the lib's pattern; restated here as the literal prefix so a
    // widened (or broken) pattern shows up as a disagreement, not as a silent gap.
    const everyColl=[...new Set([...src.matchAll(/match\s+\/([A-Za-z0-9_]+)\/\{/g)].map(m=>m[1]).filter(c=>c!=='databases'))];
    const disagree=everyColl.filter(c=>L.isOwnerOnlyBooks(c)!==/^ma_/.test(c));
    s.eq('the exempt family is exactly the collections named ma_… (disagreements: '+disagree.join(', ')+')',disagree.length,0);
    s.ok('and every other collection was left to the section above ('+(everyColl.length-named.length)+' collections)',everyColl.length-named.length>50);
    const inside=all.filter(inBooks);
    const insideReads=inside.filter(t=>t.kinds.some(k=>k==='read'||k==='get'||k==='list'));
    s.ok('every ma_ collection has a read rule ('+insideReads.length+' found for '+books.length+' blocks)',insideReads.length>=books.length);
    const notOwner=insideReads.filter(t=>t.cond.trim()!=='isMasterAccounts()');
    s.eq('every ma_ read rule is exactly `isMasterAccounts()` (offenders: '+notOwner.slice(0,3).map(t=>t.cond.replace(/\s+/g,' ').slice(0,60)).join(' ;; ')+')',notOwner.length,0);
    const withQa=books.filter(b=>/isQa/.test(src.slice(b.start,b.end)));
    s.eq('no ma_ block mentions isQa() or isQaRead() anywhere, read or write (offenders: '+withQa.map(b=>b.name).join(', ')+')',withQa.length,0);
    const h=/function isMasterAccounts\(\)\s*\{([^}]*)\}/.exec(src);
    s.ok('isMasterAccounts() exists',!!h);
    s.ok('it is built on signedIn() (which excludes QA), never authed()',!!h&&/signedIn\(\)/.test(h[1])&&!/authed\(\)/.test(h[1]));
    s.ok('it names no isQa()/isQaRead() and does not list the QA account\'s email',!!h&&!/isQa/.test(h[1])&&!/claude@groovy\.op/.test(h[1]));
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
