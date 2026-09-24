// The free, no-LLM layer: pull headlines from curated feeds, tag them,
// merge duplicates, and write data/wire.json. Runs every 5 minutes in
// GitHub Actions. State carries over between runs by reading the previous
// wire.json from the live site (WIRE_STATE_URL), so nothing gets committed.
import { XMLParser } from 'fast-xml-parser';
import { makeClassifier } from './lib/classify.mjs';
import { UA, cleanUrl, fetchJSON, hash, p, readJSON, stripHtml, urlKey, writeJSON } from './lib/util.mjs';

const site = await readJSON(p('config', 'site.json'));
const sources = await readJSON(p('config', 'sources.json'));
const classify = makeClassifier(await readJSON(p('config', 'sections.json')));
const publishers = await readJSON(p('config', 'publishers.json'));
const trusted = new Set(publishers.trusted.map((n) => n.toLowerCase()));
const aliases = publishers.aliases ?? {};

const WINDOW_MS = (site.wireWindowHours ?? 72) * 3600_000;
const MAX_ITEMS = 500;
const NOW = Date.now();

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => name === 'item' || name === 'entry',
});

const text = (v) => {
  if (v == null) return '';
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') return text(v['#text'] ?? '');
  return String(v);
};

function atomLink(link) {
  const links = Array.isArray(link) ? link : [link];
  const pick = links.find((l) => l && (!l['@_rel'] || l['@_rel'] === 'alternate')) ?? links[0];
  return typeof pick === 'string' ? pick : pick?.['@_href'];
}

function rssLink(it) {
  const link = text(it.link);
  if (link) return link;
  const guid = text(it.guid);
  return /^https?:\/\//.test(guid) ? guid : '';
}

function feedUrl(src) {
  if (src.type !== 'googlenews') return src.url;
  const q = new URLSearchParams({ q: src.query, hl: src.hl, gl: src.gl, ceid: src.ceid });
  return `https://news.google.com/rss/search?${q}`;
}

function parseEntries(xml) {
  const doc = parser.parse(xml);
  if (doc.rss?.channel) {
    const ch = Array.isArray(doc.rss.channel) ? doc.rss.channel[0] : doc.rss.channel;
    return (ch.item ?? []).map((it) => ({
      title: text(it.title),
      link: rssLink(it),
      date: text(it.pubDate) || text(it['dc:date']) || text(it.published) || text(it.updated),
      summary: text(it.description) || text(it['content:encoded']),
      publisher: text(it.source),
    }));
  }
  if (doc.feed) {
    return (doc.feed.entry ?? []).map((e) => ({
      title: text(e.title),
      link: atomLink(e.link),
      date: text(e.published) || text(e.updated),
      summary: text(e.summary) || text(e.content),
    }));
  }
  const rdf = doc['rdf:RDF'];
  if (rdf) {
    return (rdf.item ?? []).map((it) => ({
      title: text(it.title),
      link: text(it.link),
      date: text(it['dc:date']),
      summary: text(it.description),
    }));
  }
  throw new Error('not an RSS/Atom feed');
}

async function fetchSource(src, prev) {
  const started = Date.now();
  const health = { id: src.id, name: src.name, ok: false, kept: 0, seen: 0 };
  // Polite polling: a source is fetched at most every `every` minutes (default 5),
  // and only re-downloaded when the publisher says the feed changed (304 otherwise).
  // Items from skipped or unchanged sources carry over from the previous state.
  const every = (src.every ?? 5) * 60_000;
  if (prev?.fetchedAt && NOW - Date.parse(prev.fetchedAt) < every - 60_000) {
    return { items: [], health: { ...prev, skipped: true, ms: 0 } };
  }
  try {
    const headers = { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5' };
    if (prev?.etag) headers['If-None-Match'] = prev.etag;
    if (prev?.lastModified) headers['If-Modified-Since'] = prev.lastModified;
    const res = await fetch(feedUrl(src), { headers, signal: AbortSignal.timeout(20000), redirect: 'follow' });
    health.status = res.status;
    health.fetchedAt = new Date(NOW).toISOString();
    if (res.status === 304) {
      Object.assign(health, { ok: true, notModified: true, kept: prev?.kept ?? 0, seen: prev?.seen ?? 0, etag: prev?.etag, lastModified: prev?.lastModified });
      return { items: [], health };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const etag = res.headers.get('etag');
    const lastModified = res.headers.get('last-modified');
    if (etag) health.etag = etag;
    if (lastModified) health.lastModified = lastModified;
    const entries = parseEntries(await res.text());
    health.seen = entries.length;
    // Some feeds stamp every item with the feed's build time. Those dates are
    // meaningless, so the item's first-seen time is used instead.
    const stamps = entries.map((e) => Date.parse(e.date)).filter(Number.isFinite);
    const datesUnreliable = stamps.length >= 4 && Math.max(...stamps) - Math.min(...stamps) < 5 * 60_000;
    if (datesUnreliable) health.datesUnreliable = true;
    const items = [];
    for (const e of entries.slice(0, src.maxItems ?? 60)) {
      const url = cleanUrl(e.link);
      let title = stripHtml(e.title);
      if (!url || !title) continue;
      if (/\/(event-info|events?|webinars?)\//i.test(url)) continue; // listings, not news

      let sourceName = src.name;
      let display = src.display !== false;
      if (src.type === 'googlenews') {
        const publisher = stripHtml(e.publisher);
        if (publisher) {
          sourceName = aliases[publisher] ?? publisher;
          if (title.endsWith(` - ${publisher}`)) title = title.slice(0, -(publisher.length + 3)).trim();
        }
        // Google News mixes in content farms. Unknown publishers stay off the public wire
        // (the newsroom can still read them in the private file).
        if (!trusted.has(sourceName.toLowerCase())) display = false;
      }

      const d = e.date && !datesUnreliable ? Date.parse(e.date) : NaN;
      // Items dated well into the future are scheduled posts or events, not news yet.
      if (Number.isFinite(d) && d - NOW > 30 * 60_000) continue;
      const published = Number.isFinite(d) ? Math.min(d, NOW) : null;
      if (published && NOW - published > WINDOW_MS) continue;

      const summary = stripHtml(e.summary).slice(0, 500);
      const c = classify({ title, summary }, src);
      if (!c.keep) continue;

      items.push({
        id: hash(urlKey(url)),
        title,
        url,
        source: sourceName,
        sourceId: src.id,
        ...(src.type === 'googlenews' ? { via: 'Google News' } : {}),
        publishedAt: published ? new Date(published).toISOString() : null,
        section: c.section,
        tags: c.tags,
        region: src.region,
        ...(display ? {} : { display: false }),
        summary, // stays in the private file only
      });
    }
    health.ok = true;
    health.kept = items.length;
    return { items, health };
  } catch (err) {
    health.error = String(err.message || err).slice(0, 160);
    return { items: [], health };
  } finally {
    health.ms = Date.now() - started;
  }
}

async function pool(list, size, fn) {
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < list.length) {
        const idx = i++;
        out[idx] = await fn(list[idx]);
      }
    }),
  );
  return out;
}

// ---------- duplicate clustering (same story from several outlets) ----------

const STOP = new Set('the a an and or of to in on for with at by from as is are be its it this that new says said will after over into how why what more than about amid its their his her has have had was were not but up out who'.split(' '));
const tokens = (t) =>
  new Set(t.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9$%]+/).filter((w) => w.length > 2 && !STOP.has(w)));
function similar(a, b) {
  if (a.size < 4 || b.size < 4) return false;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter) >= 0.5;
}

function cluster(items) {
  // Direct publisher feeds lead over Google News copies; earlier reports lead later ones.
  const order = [...items].sort(
    (x, y) => (x.via ? 1 : 0) - (y.via ? 1 : 0) || Date.parse(x.firstSeen) - Date.parse(y.firstSeen),
  );
  const leads = [];
  for (const it of order) {
    const tk = tokens(it.title);
    const t = Date.parse(it.publishedAt ?? it.firstSeen);
    const lead = leads.find(
      (l) => l.id !== it.id && Math.abs(l._t - t) < 36 * 3600_000 && similar(l._tk, tk),
    );
    if (lead) {
      lead.also ??= [];
      if (!lead.also.some((a) => a.url === it.url) && lead.url !== it.url) lead.also.push({ source: it.source, url: it.url });
      for (const a of it.also ?? []) if (!lead.also.some((x) => x.url === a.url)) lead.also.push(a);
    } else {
      leads.push({ ...it, _tk: tk, _t: t });
    }
  }
  return leads.map(({ _tk, _t, ...rest }) => rest);
}

// ---------- run ----------

const previous =
  (process.env.WIRE_STATE_URL && (await fetchJSON(process.env.WIRE_STATE_URL))) ||
  (await readJSON(p('data', 'wire.private.json'), null)) ||
  (await readJSON(p('data', 'wire.json'), { items: [] }));
const prevById = new Map((previous.items ?? []).map((it) => [it.id, it]));
const prevHealth = new Map((previous.sources ?? []).map((h) => [h.id, h]));

const results = await pool(sources, 8, (src) => fetchSource(src, prevHealth.get(src.id)));
const fresh = results.flatMap((r) => r.items);
const health = results.map((r) => r.health);

const merged = new Map();
for (const it of fresh) {
  if (merged.has(it.id)) continue;
  const prev = prevById.get(it.id);
  merged.set(it.id, { ...it, firstSeen: prev?.firstSeen ?? new Date(NOW).toISOString(), also: prev?.also });
}
// Keep earlier items that have scrolled out of their feed but are still inside the window.
for (const prev of prevById.values()) if (!merged.has(prev.id)) merged.set(prev.id, prev);

const inWindow = [...merged.values()].filter((it) => NOW - Date.parse(it.publishedAt ?? it.firstSeen) <= WINDOW_MS);
const items = cluster(inWindow)
  .map((it) => (it.also?.length ? it : (({ also, ...rest }) => rest)(it)))
  .sort((a, b) => Date.parse(b.publishedAt ?? b.firstSeen) - Date.parse(a.publishedAt ?? a.firstSeen))
  .slice(0, MAX_ITEMS);

const meta = { updatedAt: new Date(NOW).toISOString(), windowHours: site.wireWindowHours ?? 72, count: items.length, sources: health };
// Public file: headlines and links only, no publisher text.
await writeJSON(p('data', 'wire.json'), { ...meta, items: items.map(({ summary, ...rest }) => rest) });
// Private file: keeps feed summaries for the newsroom run. Never deployed.
await writeJSON(p('data', 'wire.private.json'), { ...meta, items });

const ok = health.filter((h) => h.ok).length;
const unchanged = health.filter((h) => h.notModified && !h.skipped).length;
const skipped = health.filter((h) => h.skipped).length;
console.log(`wire: ${items.length} items from ${ok}/${health.length} sources (${fresh.length} fetched this run, ${unchanged} unchanged, ${skipped} not due)`);
for (const h of health) {
  const state = h.skipped ? 'not due' : h.notModified ? 'unchanged' : `kept ${String(h.kept).padStart(3)} / seen ${String(h.seen).padStart(3)}`;
  console.log(`  ${h.ok ? 'ok ' : 'ERR'} ${h.id.padEnd(18)} ${state}  ${h.ms}ms${h.error ? '  ' + h.error : ''}`);
}
