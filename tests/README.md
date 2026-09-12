# Tests

```bash
node tests/run.js            # everything
node tests/run.js boards     # one suite (substring match)
```

No dependencies. Plain node, same zero-new-deps policy as the app. CI runs
this on every push and pull request (`.github/workflows/tests.yml`).

## What a green run means — and what it doesn't

**It proves the logic still holds.** Validators, sanitisers, maths, state
machines, what a menu offers, what gets written to Firestore, whether a
loader can reject, and the project-structure invariants below.

**It proves nothing about how anything looks.** There is no jsdom and no
browser. The board's entire top bar was invisible for weeks behind a wrong
`z-index` and nothing here would have caught it. Real UI verification needs a
human, a phone, or Claude in Chrome — see the sandbox limits in `CLAUDE.md`.

Read the header of `harness.js` before trusting a green run.

## The suites

| File | Covers |
|---|---|
| `invariants.test.js` | Project structure: every `js/*.js` is in `index.html` **and** `sw.js`; nothing precached is missing from disk; no credentials in client code; everything parses; the browser still can't write to RTDB; every collection the client queries has a `firestore.rules` match block; the staged-rollout gate is all-or-nothing |
| `boards.test.js` | Mood Boards: the pinch zoom curve and its detents, the rich-text sanitiser, labels and reactions, board colour/icon validation, phone vs desktop rendering |
| `profile.test.js` | Profiles: the photo-URL allow-list, the `textContent` boundary, what actually gets written, and a loader that must not reject |
| `check-cache-version.js` | Not a suite — a CI guard. If a precached file changed, `CACHE_VERSION` in `sw.js` must have changed too, or the update silently never reaches anyone who already opened the app |

## Adding a test

Export a function that returns a suite:

```js
const {loadApp,suite}=require('./harness');

module.exports=function(){
  const s=suite('my-thing');
  const {run}=loadApp({files:['js/my-thing.js']});
  s.section('what this group is about');
  s.eq('a plain equality',run(`myFn('x')`),'expected');
  s.ok('a condition',run(`myFn('y')`).length>0);
  return s;                  // async is fine — return a promise
};
```

`loadApp` takes `{files, session, phone, currentPage, viewportW, viewportH,
globals}`. `globals` overrides anything in the sandbox, which is how a test
makes `getDocs` throw to check a loader's failure path.

## Things worth testing, by precedent

Every bug in this list was real. They are the shapes to write tests for:

- **A user string interpolated into an HTML string.** Render structure, fill
  text with `textContent`. Assert the hostile value is *absent* from the
  markup and *present* after hydration.
- **A stored value used as a URL, a colour, or a style.** Assert the
  allow-list refuses `javascript:`, `data:`, a lookalike host, and an
  attribute-break attempt.
- **A loader called from `renderPage`.** The dispatch line has no `.catch`.
  Assert it resolves on a denied read and renders an error with Retry.
- **A transient `_`-prefixed field.** Assert it never reaches the write.
- **Two surfaces that offer the same actions.** Assert they come from one
  list, or they will drift.
