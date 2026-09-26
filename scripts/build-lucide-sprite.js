#!/usr/bin/env node
// Build ONE SVG sprite from lucide-static (ISC). Plain node, no deps.
//
//   node scripts/build-lucide-sprite.js <path/to/extracted/lucide-static/package>
//
// Provenance, the verified sha512 and how to fetch the tarball:
// assets/vendor/README.md ("lucide-static").
//
// Reads <pkg>/icons/<file>.svg for every icon in ICONS, strips the outer
// <svg>, keeps ONLY path/circle/rect/line/polyline/polygon/ellipse children,
// and writes lucide-sprite-<version>.svg next to this script.
//
// It FAILS rather than silently producing a wrong sprite: an unknown child
// element (e.g. a <g> that would be dropped and lose drawing), an attribute
// outside the allow-list, a missing icon file, or an icon with no drawable
// children all stop the build with a message naming the icon.
'use strict';
const fs = require('fs');
const path = require('path');

const PKG = path.resolve(process.argv[2] || path.join(__dirname, 'extract', 'package'));
// Writes straight into the vendored folder the app serves from.
const OUT_DIR = path.join(__dirname, '..', 'assets', 'vendor');

// Requested symbol id (without the "lucide-" prefix) -> source file in icons/.
// Three requested names are DEPRECATED ALIASES in lucide-static 1.48.0: their
// alias files still ship and DRAW identically to the canonical icon (they
// differ only in the outer class="lucide lucide-<name>" attribute), but we
// read the canonical file so the build does not depend on an alias that a
// later version may drop. The symbol id stays exactly as requested.
const ALIAS_SOURCE = {
  'circle-help': 'circle-question-mark',
  'trash-2': 'trash',
  'filter': 'funnel',
};

const ICONS = [
  'layout-dashboard', 'calendar', 'calendar-days', 'calendar-plus', 'calendar-x',
  'inbox', 'list', 'list-checks', 'list-todo', 'plus', 'users', 'user', 'user-plus',
  'settings', 'search', 'circle-help', 'circle', 'circle-check', 'check', 'star',
  'lock', 'lock-open', 'message-circle', 'paperclip', 'sun', 'flag', 'tag',
  'palette', 'file-text', 'sticky-note', 'trash-2', 'x', 'chevron-left',
  'chevron-right', 'chevron-down', 'chevron-up', 'ellipsis', 'clock',
  'circle-alert', 'bell', 'arrow-right-left', 'send', 'grip-vertical', 'eye',
  'eye-off', 'filter', 'hand',
];

const ALLOWED_ELEMENTS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']);
// Geometry only. Presentation lives on the <symbol>; anything else (on*, href,
// style, class, transform…) is refused outright.
const ALLOWED_ATTRS = new Set([
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'width', 'height', 'points', 'fill',
]);
// "fill" is the one presentation attribute Lucide puts on a child: the solid
// dots in `tag` and `palette` are fill="currentColor" (drop it and they render
// as hollow rings). Only currentColor/none pass, so no literal colour can get
// into a sprite that must follow the page's text colour in both themes.
const CONSTRAINED_VALUES = { fill: new Set(['currentColor', 'none']) };

function fail(msg) { console.error('build-lucide-sprite: ' + msg); process.exit(1); }

function readVersion() {
  const pj = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));
  if (pj.name !== 'lucide-static') fail(`${PKG} is ${pj.name}, not lucide-static`);
  return pj.version;
}

function parseAttrs(src, icon, tag) {
  const out = [];
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
  let m, consumed = '';
  while ((m = re.exec(src))) {
    const name = m[1], value = m[2];
    if (!ALLOWED_ATTRS.has(name)) fail(`${icon}: <${tag}> carries attribute "${name}", which is not on the allow-list`);
    if (/[<>&]/.test(value)) fail(`${icon}: <${tag} ${name}> has a value containing < > or &`);
    if (CONSTRAINED_VALUES[name] && !CONSTRAINED_VALUES[name].has(value)) {
      fail(`${icon}: <${tag} ${name}="${value}"> — only ${[...CONSTRAINED_VALUES[name]].join('/')} allowed`);
    }
    out.push(`${name}="${value}"`);
    consumed += m[0];
  }
  // Anything left over that is not whitespace is an attribute form we did not
  // parse (unquoted, single-quoted…) — refuse rather than guess.
  const rest = src.replace(re, '').replace(/\/\s*$/, '').trim();
  if (rest) fail(`${icon}: <${tag}> has unparsed attribute text: ${JSON.stringify(rest)}`);
  return out;
}

function extractChildren(icon, file) {
  let svg = fs.readFileSync(file, 'utf8');
  svg = svg.replace(/<!--[\s\S]*?-->/g, '');
  const open = svg.match(/<svg\b[^>]*>/);
  const close = svg.lastIndexOf('</svg>');
  if (!open || close < 0) fail(`${icon}: no outer <svg>…</svg> in ${file}`);
  const vb = open[0].match(/viewBox="([^"]*)"/);
  if (!vb || vb[1].trim() !== '0 0 24 24') fail(`${icon}: viewBox is ${vb ? vb[1] : 'missing'}, expected 0 0 24 24`);
  const inner = svg.slice(open.index + open[0].length, close);

  const children = [];
  const tagRe = /<\s*(\/?)\s*([A-Za-z][\w:-]*)([^>]*)>/g;
  let m, last = 0;
  while ((m = tagRe.exec(inner))) {
    const between = inner.slice(last, m.index);
    if (between.trim()) fail(`${icon}: stray text inside <svg>: ${JSON.stringify(between.trim())}`);
    last = tagRe.lastIndex;
    const [, closing, tag, attrSrc] = m;
    if (!ALLOWED_ELEMENTS.has(tag)) fail(`${icon}: child <${closing}${tag}> is not a drawable primitive — refusing to drop it silently`);
    if (closing) continue; // tolerate <path ...></path>
    const attrs = parseAttrs(attrSrc, icon, tag);
    children.push(`<${tag} ${attrs.join(' ')}/>`);
  }
  if (inner.slice(last).trim()) fail(`${icon}: stray text after last element`);
  if (!children.length) fail(`${icon}: no drawable children`);
  return children;
}

function main() {
  const version = readVersion();
  const seen = new Set();
  const symbols = [];
  for (const id of ICONS) {
    if (seen.has(id)) fail(`duplicate icon in list: ${id}`);
    seen.add(id);
    const src = ALIAS_SOURCE[id] || id;
    const file = path.join(PKG, 'icons', src + '.svg');
    if (!fs.existsSync(file)) fail(`${id}: ${file} does not exist in lucide-static ${version}`);
    const kids = extractChildren(id, file);
    symbols.push(
      `<symbol id="lucide-${id}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
      `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${kids.join('')}</symbol>`
    );
  }
  const header = `<!-- lucide-static v${version} (ISC) https://lucide.dev - ${symbols.length} icons; see lucide-static-${version}.LICENSE -->`;
  const sprite = `${header}\n<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${symbols.join('\n')}\n</svg>\n`;
  const out = path.join(OUT_DIR, `lucide-sprite-${version}.svg`);
  fs.writeFileSync(out, sprite);
  console.log(`wrote ${out}`);
  console.log(`bytes ${Buffer.byteLength(sprite)}`);
  console.log(`symbols ${symbols.length}`);
}

main();
