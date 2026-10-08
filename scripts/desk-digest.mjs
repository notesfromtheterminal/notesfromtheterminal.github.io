// A compact view of what a desk run needs to pick stories, so the run does not read the whole
// wire file and every recent brief: one line per brief from the last 7 days, then one line per
// wire item that is new since the last desk run and not already covered by a brief.
// Picking only. Verification still reads each source in full with source.mjs.
//   node scripts/desk-digest.mjs              -> recent briefs + new wire items
//   node scripts/desk-digest.mjs --hours 24   -> widen the wire window (a quiet day, a missed run)
//   node scripts/desk-digest.mjs --open <id>  -> one wire item in full: link, source, summary
import { execFileSync } from 'node:child_process';
import { loadContent } from './validate.mjs';
import { p, readJSON } from './lib/util.mjs';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const site = await readJSON(p('config', 'site.json'));
const wire = (await readJSON(p('data', 'wire.private.json'), null)) ?? (await readJSON(p('data', 'wire.json'), { items: [] }));
const items = wire.items ?? [];
const when = (i) => Date.parse(i.publishedAt ?? i.firstSeen);

if (opt('--open')) {
  const it = items.find((i) => i.id === opt('--open'));
  if (!it) {
    console.error(`desk-digest: no wire item ${opt('--open')}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ title: it.title, url: it.url, source: it.source, via: it.via, publishedAt: it.publishedAt, section: it.section, summary: it.summary }, null, 2));
  process.exit(0);
}

const NOW = Date.now();
const H = 3600_000;
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: site.timezone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const at = (t) => fmt.format(new Date(t)).replace(',', '');

// Window: from 3 hours before the last desk commit (so stories a busy run left behind show once
// more), at least 6 hours and at most 24. A failed run commits nothing, so the next one looks back
// over the gap on its own.
let last = 0;
try {
  last = Date.parse(execFileSync('git', ['log', '-1', '--format=%cI', '--grep=^desk:', 'HEAD'], { cwd: p(), encoding: 'utf8' }).trim()) || 0;
} catch {}
const hours = Number(opt('--hours')) || Math.min(24, Math.max(6, last ? (NOW - last) / H + 3 : 24));
const since = NOW - hours * H;

const { briefs } = await loadContent();
const recent = briefs.filter((b) => NOW - Date.parse(b.publishedAt) <= 7 * 24 * H).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
const covered = new Set(recent.flatMap((b) => (b.sources ?? []).map((s) => s.url)));
const usedWire = new Set(recent.flatMap((b) => b.wire ?? []));

console.log(`RECENT BRIEFS (last 7 days, ${recent.length}). Compare by event; open a brief's file only when a pick looks like the same story.`);
for (const b of recent) console.log(`${at(b.publishedAt)}  ${b.id}  | ${b.headline}`);

const RANK = ['banking', 'payments', 'sea', 'rules', 'deals'];
const rank = (i) => (i.region === 'sea' ? 0 : RANK.indexOf(i.section) + 1 || RANK.length + 1);
const fresh = items
  .filter((i) => when(i) >= since && !covered.has(i.url) && !usedWire.has(i.id))
  .sort((a, b) => rank(a) - rank(b) || when(b) - when(a));

console.log(`\nNEW ON THE WIRE (last ${Math.round(hours)}h, ${fresh.length} not yet briefed; SEA first, then by beat). Get the link with --open <id>.`);
for (const i of fresh) {
  const flag = i.display === false ? ' [unlisted publisher: find a primary source]' : '';
  console.log(`${at(when(i))}  ${i.id}  ${i.section}${i.region === 'sea' ? '/sea' : ''}  ${i.source}: ${i.title}${flag}`);
}
if (!fresh.length) console.log('(nothing new; a quiet run is a fine run)');
