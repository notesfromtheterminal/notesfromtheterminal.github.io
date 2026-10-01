// Model comparison charts, for briefs that ask for one ("chart": {"kind": "models", ...}).
// The numbers come from Artificial Analysis' free API, which requires attribution and forbids
// republishing its raw data, so only the drawn chart is kept: public/charts/<brief id>.svg,
// drawn once, so it shows the data as it stood when the story ran. Runs in CI (AA_API_KEY).
//   node scripts/charts.mjs                                        -> draw missing charts
//   node scripts/charts.mjs --fixture <data.json> --out <dir>      -> layout preview with sample
//                                                                     numbers, never into public/
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { esc, p } from './lib/util.mjs';
import { loadContent } from './validate.mjs';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const fixture = opt('--fixture');
const outDir = fixture ? opt('--out') : p('public', 'charts');
if (fixture && (!outDir || path.resolve(outDir).startsWith(p('public')))) {
  console.error('usage: --fixture <data.json> --out <dir outside public/>');
  process.exit(2);
}

const API = 'https://artificialanalysis.ai/api/v2/data/llms/models';
const HOUR = 3_600_000;
const { briefs } = await loadContent();
const pending = briefs.filter(
  (b) => b.chart && !existsSync(path.join(outDir, `${b.id}.svg`)) && (fixture || Date.now() - Date.parse(b.publishedAt) < 14 * 24 * HOUR),
);
if (!pending.length) {
  console.log('charts: nothing to draw');
  process.exit(0);
}
// The free API allows 1,000 requests a day. A new brief is tried on every run for its first
// hour; after that, once an hour, until Artificial Analysis has benchmarked the model.
const fresh = pending.some((b) => Date.now() - Date.parse(b.publishedAt) < HOUR);
if (!fixture && !fresh && new Date().getUTCMinutes() >= 5) {
  console.log(`charts: ${pending.length} waiting, next try at the top of the hour`);
  process.exit(0);
}
if (!fixture && !process.env.AA_API_KEY) {
  console.log(`charts: ${pending.length} waiting, no AA_API_KEY secret set`);
  process.exit(0);
}

let models;
if (fixture) models = JSON.parse(await readFile(fixture, 'utf8')).data ?? [];
else {
  const res = await fetch(API, { headers: { 'x-api-key': process.env.AA_API_KEY }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    console.log(`charts: Artificial Analysis returned HTTP ${res.status}, will retry`);
    process.exit(0);
  }
  models = (await res.json()).data ?? [];
}

const iq = (m) => m?.evaluations?.artificial_analysis_intelligence_index ?? null;
const price = (m) => m?.pricing?.price_1m_blended_3_to_1 ?? null;
const squash = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9.]+/g, '');
// "Claude Opus 5.5" finds "Claude Opus 5.5 (Thinking)": the exact name if listed, otherwise the
// best-scoring variant whose name starts with it. The chart shows Artificial Analysis' own name.
function find(wanted) {
  const w = squash(wanted);
  const exact = models.filter((m) => squash(m.name) === w || squash(m.slug) === w);
  const pool = exact.length ? exact : models.filter((m) => squash(m.name).startsWith(w) || squash(m.slug).startsWith(w));
  return pool.filter((m) => iq(m) != null).sort((a, b) => iq(b) - iq(a))[0] ?? null;
}

const C = { ink: '#0b0b0c', text: '#1d1d1f', muted: '#5e5e66', rule: '#e4e4e7', focus: '#ff8c1a', peer: '#c9c9cf', label: '#b34700' };
const HEAD = "font-family=\"'Schibsted Grotesk','Helvetica Neue',Arial,sans-serif\"";
const MONO = "font-family=\"'IBM Plex Mono',Menlo,monospace\"";
const day = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function drawChart(b, rows, asOf) {
  const W = 480;
  const X = 20;
  const BAR = W - 2 * X - 66;
  const ROW = 46;
  const ordered = [...rows].sort((a, z) => z.iq - a.iq);
  const focus = rows.find((r) => r.focus);
  const parts = [];
  let y = 34;
  parts.push(`<text x="${X}" y="${y}" ${HEAD} font-size="21" font-weight="800" fill="${C.ink}">${esc(`${focus.label} against its peers`)}</text>`);

  const panel = (title, note, value, show) => {
    y += 38;
    parts.push(`<text x="${X}" y="${y}" ${MONO} font-size="13.5" letter-spacing="1.2" fill="${C.label}">${esc(title)}</text>`);
    parts.push(`<text x="${W - X}" y="${y}" ${MONO} font-size="13" text-anchor="end" fill="${C.muted}">${esc(note)}</text>`);
    y += 8;
    const max = Math.max(...ordered.map(value).filter((v) => v != null));
    for (const r of ordered) {
      const v = value(r);
      const weight = r.focus ? 800 : 600;
      parts.push(`<text x="${X}" y="${y + 18}" ${HEAD} font-size="16.5" font-weight="${weight}" fill="${r.focus ? C.ink : C.text}">${esc(r.label)}</text>`);
      if (v == null) parts.push(`<text x="${X}" y="${y + 38}" ${MONO} font-size="13" fill="${C.muted}">not listed</text>`);
      else {
        const w = Math.max(2, Math.round((BAR * v) / max));
        parts.push(`<rect x="${X}" y="${y + 26}" width="${w}" height="13" rx="2" fill="${r.focus ? C.focus : C.peer}"/>`);
        parts.push(`<text x="${X + w + 7}" y="${y + 37.5}" ${MONO} font-size="13.5" font-weight="${r.focus ? 600 : 400}" fill="${C.ink}">${esc(show(v))}</text>`);
      }
      y += ROW;
    }
  };
  panel('INTELLIGENCE INDEX', 'higher is better', (r) => r.iq, (v) => v.toFixed(1));
  panel('PRICE, USD PER 1M TOKENS', 'lower is better', (r) => r.price, (v) => `$${v.toFixed(2)}`);

  y += 14;
  parts.push(`<line x1="${X}" x2="${W - X}" y1="${y}" y2="${y}" stroke="${C.rule}"/>`);
  y += 20;
  const credit = fixture
    ? 'Sample numbers for a layout preview, not Artificial Analysis data'
    : `Source: Artificial Analysis (artificialanalysis.ai), data as of ${day(asOf)}`;
  const creditText = `<text x="${X}" y="${y}" ${HEAD} font-size="13.5" fill="${C.muted}">${esc(credit)}</text>`;
  parts.push(fixture ? creditText : `<a href="https://artificialanalysis.ai/" target="_blank">${creditText}</a>`);
  y += 19;
  parts.push(`<text x="${X}" y="${y}" ${HEAD} font-size="13" fill="${C.muted}">Price blends input and output tokens 3:1. Notes from the Terminal</text>`);
  const H = y + 16;

  const desc = ordered
    .map((r) => `${r.label}: ${r.iq.toFixed(1)}${r.price == null ? '' : `, $${r.price.toFixed(2)} per million tokens`}`)
    .join('; ');
  const id = `chart-${b.id}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="${id}-t ${id}-d" data-asof="${asOf.toISOString().slice(0, 10)}">
<title id="${id}-t">${esc(`${focus.label} against its peers on the Artificial Analysis Intelligence Index and price`)}</title>
<desc id="${id}-d">${esc(desc)}</desc>
<rect width="${W}" height="${H}" fill="#ffffff"/>
${parts.join('\n')}
</svg>
`;
}

await mkdir(outDir, { recursive: true });
let drawn = 0;
for (const b of pending) {
  const rows = [];
  for (const name of b.chart.models) {
    const m = find(name);
    if (!m) console.log(`charts: ${b.id}: "${name}" is not on Artificial Analysis yet`);
    else if (!rows.some((r) => r.id === m.id)) rows.push({ id: m.id, label: m.name, iq: iq(m), price: price(m), focus: squash(name) === squash(b.chart.focus) });
  }
  if (!rows.some((r) => r.focus) || rows.length < 2) {
    console.log(`charts: ${b.id}: waiting until "${b.chart.focus}" and one peer are benchmarked`);
    continue;
  }
  await writeFile(path.join(outDir, `${b.id}.svg`), drawChart(b, rows, new Date()));
  console.log(`charts: drew ${b.id} (${rows.length} models)`);
  drawn++;
}
console.log(`charts: ${drawn} drawn, ${pending.length - drawn} waiting`);
