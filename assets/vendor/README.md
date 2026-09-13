# Vendored libraries

Third-party runtime libraries, served from this origin instead of a CDN.

| File | Package | Version | Licence |
|---|---|---|---|
| `jspdf-2.5.1.umd.min.js` | [jspdf](https://www.npmjs.com/package/jspdf) | 2.5.1 | MIT |
| `xlsx-0.18.5.full.min.js` | [xlsx](https://www.npmjs.com/package/xlsx) (SheetJS) | 0.18.5 | Apache-2.0 |
| `jsbarcode-3.11.6.all.min.js` | [jsbarcode](https://www.npmjs.com/package/jsbarcode) | 3.11.6 | MIT |

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
