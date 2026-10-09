// Checks every brief and Morning Note before the site builds. The newsroom run
// must get a clean `npm run validate` before it commits.
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aboutSources, attributedClauses, hardened, linked, namesSea, unhedgedNumbers, misattributed, namesIn, norm, numbersIn, ungrounded, unsupported, untraced } from './lib/grounding.mjs';
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

// Briefs published from this moment must carry evidence (NEWSROOM.md, Verification).
const BRIEF_RULES_FROM = Date.parse('2026-10-01T13:00:00+07:00');
// Briefs published from this moment: every fact word of the headline and body must be in the
// evidence (NEWSROOM.md, Verification), so no source-less detail can slip into a sentence.
const STRICT_FROM = Date.parse('2026-10-02T11:00:00+07:00');
// Notes dated from this day: built only on briefs with evidence, and every section that names
// someone or gives a number carries its own "support" from that evidence.
const NOTE_SUPPORT_FROM = '2026-10-03';
// From 8 Oct: no hardened words, no invented cause and effect (see hardened() and linked()).
const MEANING_FROM = Date.parse('2026-10-08T00:00:00+07:00');
const NOTE_MEANING_FROM = '2026-10-08';
// Briefs published from this moment are checked for repeats of earlier briefs.
const REPEAT_RULES_FROM = Date.parse('2026-10-01T19:00:00+07:00');
// Phrases that read as machine-written. None may appear in new briefs or notes, outside quotes.
const AI_TELLS = [
  "it's worth noting", 'it is worth noting', 'worth noting that', "it's important to note", 'it is important to note',
  'delve', 'tapestry', 'a testament to', 'navigate the complex', 'navigating the complex', "in today's fast-paced",
  'ever-evolving', 'paradigm shift', 'cutting-edge', 'unlock the potential', 'unlocks the potential', 'harness the power',
  'plays a crucial role', 'plays a pivotal role', 'a pivotal moment', 'underscores the importance', 'highlights the importance',
  'in the realm of', 'moreover', 'additionally,', 'in addition,', 'in conclusion', 'only time will tell', 'remains to be seen',
  'sends a clear signal', "here's the thing", 'the bottom line is', 'let me be real', 'to be honest', "i'll be honest",
  'make no mistake', 'at the end of the day', 'the stakes have never been higher', 'a new era of',
];
const AI_TELL_PATTERNS = [/(?:^|[.!?]\s+)i (?:think|believe)\b/, /\b(?:everyone|most people) (?:thinks?|assumes?|believes?)\b/];

function tellIssues(label, text) {
  if (typeof text !== 'string') return [];
  const plain = norm(text.replace(/["\u201C][^"\u201C\u201D]*["\u201D]/g, ' '));
  const hits = AI_TELLS.filter((t) => plain.includes(t));
  for (const re of AI_TELL_PATTERNS) if (re.test(plain)) hits.push(plain.match(re)[0].replace(/^[.!?]\s+/, '').trim());
  return hits.map((h) => `${label}: "${h}" reads as machine-written; say it plainly`);
}

// Three short sentences in a row read as staccato, an AI tell in the owner's voice guide.
function staccato(text) {
  const words = String(text ?? '').split(/(?<=[.!?])\s+/).map((s) => s.split(/\s+/).filter(Boolean).length);
  return words.some((w, i) => i + 2 < words.length && w <= 6 && words[i + 1] <= 6 && words[i + 2] <= 6);
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
    if (b.chart != null) {
      const c = b.chart;
      if (c?.kind !== 'models' || !Array.isArray(c.models) || c.models.length < 2 || c.models.length > 8 || c.models.some((m) => typeof m !== 'string' || !m.trim()) || !c.models.includes(c.focus))
        e.push('chart must be {"kind": "models", "models": [2-8 model names as Artificial Analysis lists them], "focus": one of those names}');
    }
    if (b.table != null) {
      const tb = b.table;
      const cell = (c) => typeof c === 'string' && c.trim() && c.length <= 40;
      if (typeof tb?.title !== 'string' || !tb.title.trim() || tb.title.length > 80 || !Array.isArray(tb.columns) || tb.columns.length < 2 || tb.columns.length > 6 || !tb.columns.every(cell) || !Array.isArray(tb.rows) || tb.rows.length < 2 || tb.rows.length > 12 || tb.rows.some((r) => !Array.isArray(r) || r.length !== tb.columns.length || !r.every(cell)) || !Number.isInteger(tb.source) || !b.sources?.[tb.source])
        e.push('table must be {"title", "columns": [2-6], "rows": [2-12 rows, one cell per column, each up to 40 chars], "source": <index into sources>}');
      else if (/artificialanalysis\.ai/i.test(b.sources[tb.source].url))
        e.push("table source is Artificial Analysis, whose terms allow charts but not tables: use the chart field for their numbers");
    }
    if (!Array.isArray(b.sources) || !b.sources.length || b.sources.some((s) => !s?.name || !isHttps(s?.url)))
      e.push('sources must be a non-empty list of {name, https url}');
    for (const [k, v] of [['headline', b.headline], ['body', b.body], ['note', b.note], ['figure', b.figure?.label]])
      if (typeof v === 'string') e.push(...styleIssues(k, v));
    // New briefs: every quote and number must come from an evidence sentence copied from
    // a listed source (check-sources.mjs confirms the sentence is on that page).
    if (Date.parse(b.publishedAt) >= BRIEF_RULES_FROM || b.evidence != null) {
      const ev = b.evidence;
      if (!Array.isArray(ev) || !ev.length || ev.length > 15 || ev.some((x) => !Number.isInteger(x?.source) || !b.sources?.[x.source] || typeof x?.text !== 'string' || x.text.trim().length < 15 || x.text.length > 600))
        e.push('evidence must list 1-15 { "source": <index into sources>, "text": "the exact sentence copied from that page" }');
      else {
        const g = ungrounded([b.headline, b.body, b.note, b.figure?.value].filter(Boolean).join(' \n '), ev.map((x) => x.text));
        for (const q of g.quotes) e.push(`quote "${q}" is in no evidence sentence: quotation marks are only for words copied from the source`);
        for (const n of g.numbers) e.push(`number ${n} is in no evidence sentence: copy the sentence that states it into evidence, or drop it`);
        // Tables: every number and every row name must be in the evidence. Which cell a number
        // belongs in cannot be checked by machine, so the desk copies cells one by one.
        if (Array.isArray(b.table?.rows)) {
          for (const n of ungrounded(b.table.rows.flat().join(' \n '), ev.map((x) => x.text)).numbers)
            e.push(`table number ${n} is in no evidence sentence: copy the source's sentence or table into evidence, or drop it`);
          const said = norm(ev.map((x) => x.text).join(' \n '));
          for (const r of b.table.rows) if (!said.includes(norm(r[0]))) e.push(`table row "${r[0]}" is named in no evidence sentence`);
        }
        if (Date.parse(b.publishedAt) >= STRICT_FROM) {
          const missing = untraced(`${b.headline} \n ${b.body}`, [...ev.map((x) => x.text), ...b.sources.map((s) => s.name), b.company ?? '']);
          if (missing.length)
            e.push(`${missing.map((w) => `"${w}"`).join(', ')} ${missing.length > 1 ? 'are' : 'is'} in no evidence sentence: use the source's own word, add the sentence that says it to evidence, or cut the detail`);
          for (const m of misattributed(`${b.headline}. ${b.body} ${b.note ?? ''}`, ev.map((x) => x.text), ev.map((x) => b.sources[x.source]?.name)))
            e.push(`"${m.word}" is given to ${m.speaker}, but the source gives it to ${m.source}: name who actually said it`);
        }
        if (Date.parse(b.publishedAt) >= MEANING_FROM) {
          const flat = unhedgedNumbers(b.headline, ev.map((x) => x.text));
          if (flat.length) e.push(`headline states ${flat.join(', ')} as settled, but every source sentence with it is hedged ("reportedly", "sought", "plans"): carry the hedge into the headline`);
          if ((b.section === 'sea' || (b.tags ?? []).includes('sea')) && !namesSea(`${b.headline} ${b.body} ${b.company ?? ''} ${b.sources.map((x) => x.name).join(' ')} ${ev.map((x) => x.text).join(' ')}`))
            e.push('filed on the SEA Desk, but no Southeast Asian country, city or ASEAN is named: use another section or tag');
          if (aboutSources(b.note)) e.push('note comments on what the sources do or do not say: give the reader the news or its meaning instead');
          const hard = hardened(`${b.headline} \n ${b.body}`, ev.map((x) => x.text));
          if (hard.length) e.push(`${hard.map((w) => `"${w}"`).join(', ')}: the evidence never says this. Keep the source's own strength ("expects", "plans", "about")`);
          const links = linked(b.body, ev.map((x) => x.text));
          if (links.length) e.push(`body links facts with ${links.map((w) => `"${w}"`).join(', ')}, which no evidence sentence uses: state each fact with its source, and leave cause and effect to the note field`);
        }
        for (const s of unsupported(b.body, ev.map((x) => x.text)))
          e.push(`body sentence has no evidence behind it: "${s.slice(0, 100)}${s.length > 100 ? '…' : ''}". Add the source sentence that says it, or cut the claim`);
      }
      e.push(...tellIssues('headline', b.headline), ...tellIssues('body', b.body), ...tellIssues('note', b.note));
      const found = (s) => [...String(s ?? '').matchAll(CONTRAST)].map((m) => `"${m[0].trim()}"`);
      const pointed = [...found(b.headline), ...found(b.note)];
      if (pointed.length) e.push(`headline or note uses the "not X, Y" contrast (${pointed.join(', ')}); state the point directly`);
      if (found(b.body).length > 1) e.push(`body uses the "not X, Y" contrast more than once (${found(b.body).join(', ')})`);
    }
    if (typeof b.headline === 'string' && /\.$/.test(b.headline)) warnings.push(`${where}: headline ends with a period`);
    if (typeof b.body === 'string' && (b.body.match(/[.!?](\s|$)/g) ?? []).length > 3) warnings.push(`${where}: body runs past 3 sentences`);

    if (e.length) errors.push(...e.map((m) => `${where}: ${m}`));
    else {
      seen.add(b.id);
      Object.defineProperty(b, '_file', { value: file });
      briefs.push(b);
    }
  }

  // One event, one brief (NEWSROOM.md, Selection). A brief whose sources were all used by
  // one earlier brief is a repeat; the same company within 7 days is a warning to check by hand.
  const oldestFirst = [...briefs].sort((x, y) => Date.parse(x.publishedAt) - Date.parse(y.publishedAt));
  const pageKey = (u) => {
    try {
      const x = new URL(u);
      return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}`.toLowerCase();
    } catch {
      return String(u);
    }
  };
  for (const [i, b] of oldestFirst.entries()) {
    if (Date.parse(b.publishedAt) < REPEAT_RULES_FROM) continue;
    const where = rel(b._file);
    const mine = b.sources.map((s) => pageKey(s.url));
    const earlier = oldestFirst.slice(0, i).reverse();
    const same = oldestFirst.slice(0, i).find((a) => {
      const theirs = new Set(a.sources.map((s) => pageKey(s.url)));
      return mine.every((k) => theirs.has(k));
    });
    if (same) errors.push(`${where}: repeats ${same.id}, which already cites ${mine.length > 1 ? 'all these sources' : 'this source'}. One event, one brief: update that brief or skip this one`);
    const recent = earlier.find((a) => a.company && a.company === b.company && Date.parse(b.publishedAt) - Date.parse(a.publishedAt) < 7 * 86_400_000);
    if (!same && recent) warnings.push(`${where}: same company as ${recent.id}. Fine if this is a new development; if it is the same event, drop it`);
  }

  const briefIds = new Set(briefs.map((b) => b.id));
  const briefById = new Map(briefs.map((b) => [b.id, b]));
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
      // A note may only quote and count what its own briefs say.
      const cited = [n.lead, ...(n.stories ?? [])].map((id) => briefById.get(id)).filter(Boolean);
      const refs = cited.flatMap((b) => [b.headline, b.body, b.note ?? '', b.figure?.value ?? '', ...(b.evidence ?? []).map((x) => x.text)]);
      const g = ungrounded([n.title, n.dek, ...paras.map((x) => `${x.head ?? ''} ${x.text}`)].join(' \n '), refs);
      for (const q of g.quotes) e.push(`quote "${q}" is in none of the note's briefs: a note only quotes what its briefs quote`);
      for (const num of g.numbers) e.push(`number ${num} is in none of the note's briefs: take every figure from the briefs it connects`);
      // Each section's names and numbers come from the evidence it lists as its support; any other
      // word missing from that support is a warning, shown under the section in the pull request.
      if (n.date >= NOTE_SUPPORT_FROM) {
        for (const b of cited) if (!b.evidence?.length) e.push(`brief ${b.id} has no evidence: a note may only connect briefs that do`);
        const pool = cited.flatMap((b) => (b.evidence ?? []).map((x) => norm(x.text)));
        // Outlet and company names count as said: "sources told the Korea Herald" names the source.
        const known = cited.flatMap((b) => [...b.sources.map((s) => s.name), b.company ?? '']);
        paras.forEach((x, i) => {
          const names = namesIn(x.text);
          if (!names.length && !numbersIn(x.text).length && x.support == null) return;
          const sup = x.support;
          if (!Array.isArray(sup) || !sup.length || sup.length > 8 || sup.some((s) => typeof s !== 'string' || s.trim().length < 15)) {
            e.push(`body[${i}]: it names someone or gives a number, so it needs "support": 1-8 sentences copied from the evidence of the briefs the note connects`);
            return;
          }
          for (const s of sup) if (!pool.some((t) => t.includes(norm(s)))) e.push(`body[${i}].support: "${s.slice(0, 80)}" is in no evidence of the note's briefs`);
          const g = ungrounded(x.text, sup);
          for (const q of g.quotes) e.push(`body[${i}]: quote "${q}" is not in this section's support`);
          for (const num of g.numbers) e.push(`body[${i}]: number ${num} is not in this section's support`);
          const said = norm([...sup, ...known].join(' '));
          for (const name of names) if (!said.includes(norm(name))) e.push(`body[${i}]: "${name}" is not in this section's support`);
          const ownerOf = (t) => cited.flatMap((b) => (b.evidence ?? []).filter((v) => norm(v.text).includes(norm(t))).map((v) => b.sources[v.source]?.name))[0];
          for (const m of misattributed(x.text, sup, sup.map(ownerOf))) e.push(`body[${i}]: "${m.word}" is given to ${m.speaker}, but the support gives it to ${m.source}: name who actually said it`);
          if (n.date >= NOTE_MEANING_FROM) {
            const hard = hardened(x.text, sup);
            if (hard.length) e.push(`body[${i}]: ${hard.map((w) => `"${w}"`).join(', ')} is stronger than the support, which never says it: keep the source's own word`);
            const links = linked(x.text, sup);
            if (links.length) e.push(`body[${i}]: ${links.map((w) => `"${w}"`).join(', ')} makes one fact cause or explain another, and the support never says so: give the facts side by side, each with its source`);
          }
          // What someone is said to have said must be in the support word for word or in its own words.
          for (const c of attributedClauses(x.text)) {
            const off = untraced(c, [...sup, ...known]);
            if (off.length) e.push(`body[${i}]: "${c.trim().slice(0, 70)}…" attributes ${off.map((w) => `"${w}"`).join(', ')}, which the support does not contain`);
          }
          const loose = untraced(x.text, [...sup, ...known, ...cited.map((b) => b.headline)]);
          if (loose.length) warnings.push(`${where}: body[${i}] words not in its support (check each keeps the source's meaning): ${loose.join(', ')}`);
        });
      }
      paras.forEach((x, i) => {
        e.push(...tellIssues(`body[${i}]`, `${x.head ?? ''}. ${x.text}`));
        if (staccato(x.text)) e.push(`body[${i}]: three short sentences in a row read as staccato; join them into one flowing sentence`);
      });
      e.push(...tellIssues('title', n.title), ...tellIssues('dek', n.dek));
    }
    if (n.lead != null && !briefIds.has(n.lead)) e.push(`lead ${n.lead} is not a published brief`);
    for (const id of n.stories ?? []) if (!briefIds.has(id)) e.push(`story ${id} is not a published brief`);
    for (const [k, v] of [['title', n.title], ['dek', n.dek], ...paras.flatMap((x, i) => [[`body[${i}].head`, x.head], [`body[${i}]`, x.text]])]) {
      if (typeof v !== 'string') continue;
      e.push(...styleIssues(k, v));
      if (/\[\[[^\]]*\]\]/.test(v)) e.push(`${k}: placeholder [[...]]: the note must publish exactly as written, so put an idea for the owner in "suggestion" instead`);
    }
    if (n.suggestion != null && (typeof n.suggestion !== 'string' || n.suggestion.length > 300)) e.push('suggestion must be a string up to 300 characters');
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
