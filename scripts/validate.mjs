// Checks every brief and Morning Note before the site builds. The newsroom run
// must get a clean `npm run validate` before it commits.
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { p, readJSON } from './lib/util.mjs';

// House style (communication-style.md). "Leverage" is banned as jargon but stays legal
// as a finance noun, so only the verb forms are caught.
const FORBIDDEN = ['dive into', 'game-changing', 'game changer', 'straightforward', 'synergize', 'circle back', 'touch base', 'furthermore', 'it could be argued'];
const LEVERAGE_VERB = /\bleverag(?:ing|es)\b|\bleverage\s+(?:the|its|their|our|your|ai|data|this|these|existing|new)\b/i;
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

async function listJson(dir) {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listJson(full)));
    else if (e.name.endsWith('.json')) out.push(full);
  }
  return out;
}

function styleIssues(label, text) {
  const issues = [];
  if (/[—]/.test(text)) issues.push(`${label}: em dash (house style bans them, use a comma, colon or period)`);
  const lower = text.toLowerCase();
  for (const f of FORBIDDEN) if (lower.includes(f)) issues.push(`${label}: forbidden phrase "${f}"`);
  if (LEVERAGE_VERB.test(text)) issues.push(`${label}: "leverage" used as a verb (house style bans it)`);
  return issues;
}

const isHttps = (u) => {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
};

// Notes dated from this day on must carry subheadings and keep to one contrast.
const NOTE_RULES_FROM = '2026-10-01';
// The "It's not X, it's Y" family the house style limits to once a note.
const CONTRAST =
  /\brather than\b|\binstead of\b|\bnot (?:just|only|merely)\b|\bno longer\b|, not (?:a |an |the )?\w+|\b(?:is|was|are) not\b[^.]{0,80}\.\s+(?:It|They|This|That) (?:is|was|are)\b|\bisn't\b[^.]{0,80}\bit's\b/gi;

export async function loadContent({ now = Date.now() } = {}) {
  const sections = new Set((await readJSON(p('config', 'sections.json'))).sections.map((s) => s.id));
  const errors = [];
  const warnings = [];
  const briefs = [];
  const notes = [];
  const seen = new Set();
  const rel = (f) => path.relative(p(), f);

  for (const file of await listJson(p('content', 'briefs'))) {
    const where = rel(file);
    let b;
    try {
      b = await readJSON(file);
    } catch (err) {
      errors.push(`${where}: invalid JSON (${err.message})`);
      continue;
    }
    const e = [];
    if (!/^[a-z0-9][a-z0-9-]{5,90}$/.test(b.id ?? '')) e.push('id must be lowercase-kebab, 6-90 chars');
    if (seen.has(b.id)) e.push(`duplicate id ${b.id}`);
    if (!ISO_WITH_OFFSET.test(b.publishedAt ?? '')) e.push('publishedAt must be ISO 8601 with a timezone offset');
    else if (Date.parse(b.publishedAt) - now > 10 * 60_000) e.push('publishedAt is in the future');
    if (!sections.has(b.section)) e.push(`section must be one of ${[...sections].join(', ')}`);
    if (typeof b.headline !== 'string' || b.headline.length < 20 || b.headline.length > 120) e.push('headline must be 20-120 chars');
    if (typeof b.body !== 'string' || b.body.length < 40 || b.body.length > 520) e.push('body must be 40-520 chars');
    if (b.note != null && (typeof b.note !== 'string' || b.note.length > 300)) e.push('note must be a string up to 300 chars');
    if (b.company != null && (typeof b.company !== 'string' || b.company.length > 40)) e.push('company must be a string up to 40 chars');
    if (b.star != null && typeof b.star !== 'boolean') e.push('star must be true or false');
    if (b.figure != null && (typeof b.figure?.value !== 'string' || b.figure.value.length > 18 || typeof b.figure?.label !== 'string' || b.figure.label.length > 70))
      e.push('figure needs value (up to 18 chars) and label (up to 70 chars)');
    if (!Array.isArray(b.sources) || !b.sources.length || b.sources.some((s) => !s?.name || !isHttps(s?.url)))
      e.push('sources must be a non-empty list of {name, https url}');
    for (const [k, v] of [['headline', b.headline], ['body', b.body], ['note', b.note], ['figure', b.figure?.label]])
      if (typeof v === 'string') e.push(...styleIssues(k, v));
    if (typeof b.headline === 'string' && /\.$/.test(b.headline)) warnings.push(`${where}: headline ends with a period`);
    if (typeof b.body === 'string' && (b.body.match(/[.!?](\s|$)/g) ?? []).length > 3) warnings.push(`${where}: body runs past 3 sentences`);

    if (e.length) errors.push(...e.map((m) => `${where}: ${m}`));
    else {
      seen.add(b.id);
      briefs.push(b);
    }
  }

  const briefIds = new Set(briefs.map((b) => b.id));
  for (const file of await listJson(p('content', 'notes'))) {
    const where = rel(file);
    let n;
    try {
      n = await readJSON(file);
    } catch (err) {
      errors.push(`${where}: invalid JSON (${err.message})`);
      continue;
    }
    const e = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(n.date ?? '') || path.basename(file) !== `${n.date}.json`) e.push('date must be YYYY-MM-DD and match the file name');
    if (!ISO_WITH_OFFSET.test(n.publishedAt ?? '')) e.push('publishedAt must be ISO 8601 with a timezone offset');
    if (typeof n.title !== 'string' || n.title.length < 10 || n.title.length > 120) e.push('title must be 10-120 chars');
    if (n.dek != null && (typeof n.dek !== 'string' || n.dek.length > 220)) e.push('dek must be a string up to 220 chars');
    // A section is a paragraph string or { "head", "text" }. From 1 Oct 2026 every section
    // needs a subheading, and the house limit of one "not X, Y" contrast is enforced.
    const paras = Array.isArray(n.body) ? n.body.map((x) => (typeof x === 'string' ? { text: x } : x)) : [];
    if (!paras.length || paras.length > 8 || paras.some((x) => !x || typeof x.text !== 'string' || !x.text.trim() || (x.head != null && typeof x.head !== 'string')))
      e.push('body must be 1-8 sections, each a paragraph string or { "head", "text" }');
    else if (n.date >= NOTE_RULES_FROM) {
      paras.forEach((x, i) => {
        if (!x.head?.trim()) e.push(`body[${i}]: needs a subheading ("head") that states the section's point`);
        else if (x.head.length > 60 || /[.!]$/.test(x.head.trim())) e.push(`body[${i}].head: keep it under 60 characters, with no full stop`);
      });
      const contrasts = [n.title, n.dek, ...paras.map((x) => x.text)].join(' ').match(CONTRAST) ?? [];
      if (contrasts.length > 1)
        e.push(`uses the "not X, Y" contrast ${contrasts.length} times; the house limit is one (${contrasts.slice(0, 4).map((c) => `"${c.trim()}"`).join(', ')})`);
      const words = paras.map((x) => x.text).join(' ').split(/\s+/).length;
      if (words > 450) e.push(`body is ${words} words; keep it under 450`);
    }
    if (n.lead != null && !briefIds.has(n.lead)) e.push(`lead ${n.lead} is not a published brief`);
    for (const id of n.stories ?? []) if (!briefIds.has(id)) e.push(`story ${id} is not a published brief`);
    for (const [k, v] of [['title', n.title], ['dek', n.dek], ...paras.flatMap((x, i) => [[`body[${i}].head`, x.head], [`body[${i}]`, x.text]])]) {
      if (typeof v !== 'string') continue;
      e.push(...styleIssues(k, v));
      if (/\[\[[^\]]*\]\]/.test(v)) e.push(`${k}: unfilled placeholder [[...]]; fill it in or remove it before publishing`);
    }
    if (e.length) errors.push(...e.map((m) => `${where}: ${m}`));
    else if (!n.draft) notes.push(n);
  }

  const byTime = (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
  return { briefs: briefs.sort(byTime), notes: notes.sort(byTime), errors, warnings };
}

// CLI: `npm run validate`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { briefs, notes, errors, warnings } = await loadContent();
  for (const w of warnings) console.log(`warn  ${w}`);
  for (const e of errors) console.log(`ERROR ${e}`);
  console.log(`${briefs.length} briefs, ${notes.length} notes, ${errors.length} errors, ${warnings.length} warnings`);
  process.exit(errors.length ? 1 : 0);
}
