# Tests

```bash
node tests/run.js            # everything
node tests/run.js boards     # one suite (substring match)
node tests/smoke-browser.js  # load the whole app in a real headless browser
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
| `smoke-browser.js` | Not a suite — loads every classic script from `index.html`, in the real load order, in a real headless browser, and checks they execute and define what the rest of the app expects; then makes jsPDF write a PDF, SheetJS write a workbook and JsBarcode draw a barcode. Catches load-order breaks, a top-level `const` declared twice across two files, and a global that quietly stopped existing — none of which `node --check` can see. **Only possible because the libraries are vendored** (`assets/vendor/`); from a CDN they never loaded here. Skips cleanly (exit 0) with no browser; set `CHROME_BIN` to point at one. It still cannot sign in — Firebase loads from gstatic, which the sandbox cannot reach |
| `share-target.test.js` | Phone share: the manifest's share_target, the real `sw.js` POST handler against a fake Cache Storage, and the page flow that files a share into a board's Unsorted |
| `board-move.test.js` | Mood Boards "Move to board…": the transaction appends to the target's server-side Unsorted, a failed write moves nothing, containers carry their children, and undo cannot resurrect a moved card |
| `board-roles.test.js` | Mood Boards sharing roles: who can edit, comment or manage sharing, the share payload, the share sheet and comment gates. The rules half is `rules-emulator-boards.js` (run by hand, needs the emulator) |
| `board-notify.test.js` | Mood Boards notifications: who a comment, reply, assignment and due task notifies, the escaping of every bell row, and the bell's link into a board |
| `board-video.test.js` | Mood Boards: which links are YouTube/Vimeo videos (exact host, validated id), the thumbnail-and-play card at rest, the player only after play, and sizing |
| `board-present.test.js` | Mood Boards: a formatted note keeps its structure on a Present slide, through the canvas's own sanitiser; a plain note stays text (#97) |
| `board-notetab.test.js` | Mood Boards: Tab while editing a note stays in the note — nests a list item (Shift+Tab un-nests), indents plain text, is inert in a heading, and leaves the to-do's own Tab and Ctrl+Tab alone (#97 bug 1); a note's hover strip is a corner chip with a first-line float so it covers no text (#97 bug 6) |
| `board-notegrow.test.js` | Mood Boards: a note is as tall as its text — drawn taller at render without writing `c.h`, grown in `c.h` while typing, a column child relaid out rather than drawn over its neighbour, capped, and never resizable shorter than its text (#97 bug 7) |
| `board-hash.test.js` | Mood Boards: the address bar names the open board — `#board=<id>` written by replaceState on open, cleared on leaving the canvas, another module's hash left alone, and read back by the deep-link consumer after a reload (#97 bug 9) |
| `board-title.test.js` | Mood Boards: Enter saves a board rename, Escape restores it, the breadcrumb tile follows (#97 bug 10) |
| `board-trayprev.test.js` | Mood Boards: Unsorted previews a note, to-do, column, colour, heading and table as what they are (text only through `textContent`); the magnet maths; a link with no picture previews as its site, title and address, and is fetched again when dragged out |
| `color-tcx.test.js` | Color Library ▸ TCX codes: the real 2,800-colour book file, search by code/name/hex, "In library" (archived excluded), + Add prefilling the Add Color form, bad rows dropped; the Pantone C codes tab (derived from the built-in list + the library) |
| `link-preview.test.js` | The link-preview function: SSRF refusals (private, metadata, redirect into the network), parsing, and the oEmbed fallback (Pinterest pins, discovery links, the endpoint's host checked like any other) |
| `board-colourpick.test.js` | Mood Boards: Pick colour on a picture, the TCX / Pantone C tabs, CIEDE2000 against the published reference pairs, a recoloured swatch dropping its stale code |
| `board-dragmove.test.js` | Mood Boards: a card dropped on a sub-board card or breadcrumb moves to that board's Unsorted; Home, empty canvas and board links refused (#97 bug 2) |
| `board-swatch.test.js` | Mood Boards: a note holding only a hex colour becomes a colour swatch on leaving it (undo restores the note); nearest colour name, HEX/RGB/HSL/Off display, the picker's fields, invalid hex refused |
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
