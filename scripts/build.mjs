// Renders the whole site into dist/. Invalid briefs are skipped with a
// message (STRICT=1 fails the build instead), so one bad file never takes
// the site down.
import { cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { makeTemplates } from '../src/templates.mjs';
import { renderCards } from './cards.mjs';
import { loadContent } from './validate.mjs';
import { dayKey, hash, p, readJSON, writeJSON, writeText } from './lib/util.mjs';

const site = await readJSON(p('config', 'site.json'));
const sectionsCfg = await readJSON(p('config', 'sections.json'));
const sourcesCfg = await readJSON(p('config', 'sources.json'));
const wire = await readJSON(p('data', 'wire.json'), { updatedAt: null, items: [] });
const ticker = await readJSON(p('data', 'ticker.json'), { updatedAt: null, quotes: [] });
const { briefs, notes, errors, warnings } = await loadContent();

for (const w of warnings) console.log(`warn  ${w}`);
for (const e of errors) console.log(`skip  ${e}`);
if (errors.length && process.env.STRICT === '1') process.exit(1);

const normBase = (b) => `/${b.trim().replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
const BASE = normBase(process.env.BASE_PATH || '/');
const SITE_URL = (process.env.SITE_URL || 'http://localhost:4321').replace(/\/+$/, '');
const DIST = p('dist');
const H = 3600_000;
const now = new Date();
const tz = site.timezone;

const sections = sectionsCfg.sections;
const sectionMap = Object.fromEntries(sections.map((s) => [s.id, s]));
const sourceNames = [...new Set(sourcesCfg.filter((s) => s.type !== 'googlenews').map((s) => s.name))];
const wireItems = (wire.items ?? []).filter((i) => i.display !== false);
const inSection = (id) => (x) => x.section === id || (x.tags ?? []).includes(id);
const age = (b) => now - Date.parse(b.publishedAt);

// Start from a clean dist/ and render share cards first, so pages can use them.
await rm(DIST, { recursive: true, force: true });
const cardIds = await renderCards({ briefs, notes, site, sectionMap, outDir: p('dist', 'cards') });

const T = makeTemplates({
  site,
  base: BASE,
  siteUrl: SITE_URL,
  sections,
  sectionMap,
  now,
  ticker,
  wireUpdatedAt: wire.updatedAt,
  latestBriefAt: briefs[0]?.publishedAt ?? null,
  buildId: hash(String(now.getTime()), 8),
  sourceCount: sourceNames.length,
  cardIds,
});

// ---------- front page selection ----------
const byId = new Map(briefs.map((b) => [b.id, b]));
const latestNote = notes.find((n) => now - Date.parse(n.publishedAt) < 36 * H) ?? null;
const lead =
  briefs.find((b) => b.star && age(b) < 24 * H) ??
  (latestNote?.lead ? byId.get(latestNote.lead) : undefined) ??
  briefs[0] ??
  null;
const top = [
  ...new Set([
    ...(latestNote?.stories ?? []).map((id) => byId.get(id)).filter(Boolean),
    ...briefs.filter((b) => b.star && age(b) < 36 * H),
    ...briefs,
  ]),
]
  .filter((b) => b !== lead)
  .slice(0, 5);
const riverWindow = (site.riverWindowHours ?? 72) * H;
// Always show at least a dozen briefs, even if the desk has been quiet.
const river = briefs.filter((b) => b !== lead).filter((b, i) => age(b) < riverWindow || i < 12);

// ---------- write ----------
const pages = [];
async function page(path, html, lastmod) {
  await writeText(p('dist', ...(path ? path.split('/').filter(Boolean) : []), 'index.html'), html);
  pages.push({ path, lastmod });
}

await page('', T.frontPage({ lead, top, note: latestNote, river, wire: wireItems }), now.toISOString());

for (const s of sections) {
  await page(
    `section/${s.id}/`,
    T.sectionPage({ section: s, briefs: briefs.filter(inSection(s.id)).slice(0, 60), wire: wireItems.filter(inSection(s.id)) }),
    now.toISOString(),
  );
}

const wireById = new Map(wireItems.map((i) => [i.id, i]));
for (const b of briefs) {
  const more = briefs.filter((x) => x !== b && inSection(b.section)(x)).slice(0, 5);
  let related = (b.wire ?? []).map((id) => wireById.get(id)).filter(Boolean);
  if (!related.length) related = wireItems.filter(inSection(b.section)).slice(0, 5);
  await page(`story/${b.id}/`, T.storyPage({ brief: b, more, related }), b.updatedAt ?? b.publishedAt);
}

for (const n of notes) {
  const ids = [...new Set([n.lead, ...(n.stories ?? [])].filter(Boolean))];
  await page(`notes/${n.date}/`, T.notePage({ note: n, stories: ids.map((id) => byId.get(id)).filter(Boolean) }), n.publishedAt);
}
await page('notes/', T.notesIndex({ notes }), notes[0]?.publishedAt);
await page('wire/', T.wirePage({ items: wireItems }), wire.updatedAt);

const days = new Map();
for (const b of briefs) {
  const k = dayKey(b.publishedAt, tz);
  if (!days.has(k)) days.set(k, []);
  days.get(k).push(b);
}
await page('archive/', T.archiveIndex({ days: [...days].map(([key, list]) => ({ key, date: list[0].publishedAt, count: list.length })) }));
for (const [key, list] of days) await page(`archive/${key}/`, T.archiveDay({ key, date: list[0].publishedAt, briefs: list }));

await page('about/', T.aboutPage({ sourceNames }));
await writeText(p('dist', '404.html'), T.notFoundPage());

// Feeds, sitemap, robots, live data for the client and for the next wire run.
await writeText(p('dist', 'feed.xml'), T.rss({ briefs }));
await writeText(p('dist', 'sitemap.xml'), T.sitemap(pages));
await writeText(p('dist', 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${T.abs('sitemap.xml')}\n`);
await writeText(p('dist', '.nojekyll'), '');
await writeJSON(p('dist', 'data', 'wire.json'), wire);
await writeJSON(p('dist', 'data', 'ticker.json'), ticker);
await writeJSON(p('dist', 'data', 'latest.json'), {
  builtAt: now.toISOString(),
  wireUpdatedAt: wire.updatedAt,
  tickerUpdatedAt: ticker.updatedAt,
  latestBriefAt: briefs[0]?.publishedAt ?? null,
  latestBriefId: briefs[0]?.id ?? null,
  briefCount: briefs.length,
});

await cp(p('src', 'site.css'), p('dist', 'assets', 'site.css'));
await cp(p('src', 'app.js'), p('dist', 'assets', 'app.js'));
if (existsSync(p('public'))) await cp(p('public'), DIST, { recursive: true });

console.log(
  `build: ${pages.length} pages, ${briefs.length} briefs, ${notes.length} notes, ${wireItems.length} wire items, ${ticker.quotes?.length ?? 0} quotes -> dist/ (base ${BASE})`,
);
