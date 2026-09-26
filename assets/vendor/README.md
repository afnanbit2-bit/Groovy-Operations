# Vendored libraries

Third-party runtime libraries, served from this origin instead of a CDN.

| File | Package | Version | Licence |
|---|---|---|---|
| `jspdf-2.5.1.umd.min.js` | [jspdf](https://www.npmjs.com/package/jspdf) | 2.5.1 | MIT |
| `xlsx-0.18.5.full.min.js` | [xlsx](https://www.npmjs.com/package/xlsx) (SheetJS) | 0.18.5 | Apache-2.0 |
| `jsbarcode-3.11.6.all.min.js` | [jsbarcode](https://www.npmjs.com/package/jsbarcode) | 3.11.6 | MIT |
| `qrcode-generator-2.0.4.js` | [qrcode-generator](https://www.npmjs.com/package/qrcode-generator) | 2.0.4 | MIT |
| `flatpickr-4.6.13.min.js` + `flatpickr-4.6.13.min.css` | [flatpickr](https://www.npmjs.com/package/flatpickr) | 4.6.13 | MIT |
| `lucide-sprite-1.48.0.svg` (licence: `lucide-static-1.48.0.LICENSE`) | [lucide-static](https://www.npmjs.com/package/lucide-static) — 47 icons built into one sprite | 1.48.0 | ISC |

Each `*.LICENSE` file is the licence text as published in that package.

## Why these are here

They used to load from `cdnjs.cloudflare.com` and `cdn.jsdelivr.net`, which
meant three things this app did not want:

1. **The PWA was not actually offline-capable.** `sw.js` routes cross-origin
   scripts network-first, so with no signal a PDF export or an Excel export
   failed. Served from this origin they sit in `PRECACHE_URLS` like every
   other asset and work offline like the rest of the app.
2. **A third-party origin could change or disappear** under a business that
   prints gate passes and payroll from these files.
3. **Neither CDN is reachable from the Claude build sandbox**, so no session
   could ever boot the app in a browser to check anything.

## Provenance — how to redo this, and how to verify it

Fetched from the **npm registry**, not from a CDN mirror, and each tarball's
sha512 was checked against the `dist.integrity` value the registry publishes
before anything was extracted:

```bash
PKG=jspdf VER=2.5.1
meta=$(curl -sS "https://registry.npmjs.org/$PKG/$VER")
url=$(echo "$meta" | python3 -c "import json,sys;print(json.load(sys.stdin)['dist']['tarball'])")
integ=$(echo "$meta" | python3 -c "import json,sys;print(json.load(sys.stdin)['dist']['integrity'])")
curl -sS -o "$PKG.tgz" "$url"
# verify $integ (sha512, base64) against the downloaded file, THEN extract
tar xzf "$PKG.tgz" && cp package/dist/jspdf.umd.min.js assets/vendor/jspdf-2.5.1.umd.min.js
```

Verified integrity values at the time of vendoring:

```
jspdf@2.5.1      sha512-hXObxz7ZqoyhxET78+XR34Xu2qFGrJJ2I2bE5w4SM8eFaFEkW2xcGRVUss360fYelwRSid/jT078kbNvmoW0QA==
xlsx@0.18.5      sha512-dmg3LCjBPHZnQp5/F/+nnTa+miPJxUXB6vtk42YjBBKayDNagxGEeIdWApkYPOf3Z3pm3k62Knjzp7lMeTEtFQ==
jsbarcode@3.11.6 sha512-G5TKGyKY1zJo0ZQKFM1IIMfy0nF2rs92BLlCz+cU4/TazIc4ZH+X1GYeDRt7TKjrYqmPfTjwTBkU/QnQlsYiuA==
```

## Rules for changing these

- **The version is in the filename** and nothing else references it, so these
  files are immutable — `netlify.toml` serves them `immutable`, and they
  carry no `?v=` query string. **Upgrading means adding a new file and
  changing the `<script src>` in `index.html`, never editing one in place.**
- Add the new file to `PRECACHE_URLS` in `sw.js` and remove the old one, then
  bump `CACHE_VERSION`. `tests/invariants.test.js` fails if a precached path
  does not exist on disk, and `tests/check-cache-version.js` fails if you
  forget the bump.
- **Never hand-edit a vendored file.** If one needs patching, the patch
  belongs in our own code.

## qrcode-generator 2.0.4 (Sept 2026 — the Pattern Hub's 5×6 in label)

Added for the QR code on each pattern label (M4), which deep-links to the
block's page. JsBarcode is 1-D only. Same procedure, same check:

```
PKG=qrcode-generator VER=2.0.4
registry dist.integrity:
  sha512-mZSiP6RnbHl4xL2Ap5HfkjLnmxfKcPWpWe/c+5XxCuetEenqmNFf1FH/ftXPCtFG5/TDobjsjz6sSNL0Sr8Z9g==
file (openssl dgst -sha512 -binary | base64):  identical — verified 17 Sept 2026
extracted:  package/dist/qrcode.js  →  assets/vendor/qrcode-generator-2.0.4.js
```

`dist/qrcode.js` is the UMD build and **not minified** (the package ships no
minified file); as a classic script it defines a global `qrcode`. The package
ships no LICENSE file — `qrcode-generator-2.0.4.LICENSE` reproduces the MIT
text with the author's copyright line from the source header.



## The Board's two (session 2, Sept 2026)

Added for The Board's visual pass (P1). Same rules as everything above: from
the npm registry, sha512 checked against `dist.integrity` before extraction,
version in the filename, precached in `sw.js`, no runtime fetch.

| Package | Tarball | `dist.integrity` (verified, exact match) |
|---|---|---|
| flatpickr 4.6.13 | `https://registry.npmjs.org/flatpickr/-/flatpickr-4.6.13.tgz` | `sha512-97PMG/aywoYpB4IvbvUJi0RQi8vearvU0oov1WW3k0WZPBMrTQVqekSX5CjSG/M4Q3i6A/0FKXC7RyAoAUUSPw==` |
| lucide-static 1.48.0 | `https://registry.npmjs.org/lucide-static/-/lucide-static-1.48.0.tgz` | `sha512-ZUGgZ4rzlLfVbhN2Zi37TMrTaSpXAbWx6Y/xZxKSDLPiqxtTK7Mw2M+oBJa0gjV8p3+CWBHh48u+IC9+jKlUjA==` |

- **flatpickr**: `dist/flatpickr.min.js` and `dist/flatpickr.min.css`,
  byte-identical to the tarball. Its **dark theme is NOT vendored**: the
  calendar is restyled to the app's own tokens in `css/main.css`, so it
  follows the light/dark switch like every other surface.
- **lucide-static**: the sprite is BUILT, not copied —
  `node scripts/build-lucide-sprite.js <extracted package dir>` reads the 47
  icon files, keeps only drawable children against an allow-list (no
  `on*`, `href`, `style`, `class` or literal colour can get in), and writes
  `lucide-sprite-1.48.0.svg` here. Re-running it on the verified tarball
  reproduces the committed file byte-for-byte (checked). Icons are used as
  `<svg><use href="/assets/vendor/lucide-sprite-1.48.0.svg#lucide-NAME">` —
  same-origin, cached, and precached by `sw.js`. To add an icon: add its name
  to `ICONS` in the builder, rebuild, and bump `CACHE_VERSION`.
