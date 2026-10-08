// The brief check's tool (BRIEF-CHECK.md). It lists the briefs published or corrected since the
// last check, and files what it finds as request files in content/review/requests/, which the
// desk handles at the start of its next run (NEWSROOM.md, step 1). No GitHub login or API.
//   node scripts/brief-check.mjs                                  -> briefs to check, and requests still open
//   node scripts/brief-check.mjs add CORRECTION <brief id> <file.md>
//   node scripts/brief-check.mjs add MISSED "<headline>" <file.md>
//   node scripts/brief-check.mjs done <time>                      -> record the check (the time the listing printed)
import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { p, readJSON, writeJSON } from './lib/util.mjs';
import { loadContent } from './validate.mjs';

const STATE = p('content', 'review', 'brief-check.json');
const REQUESTS = p('content', 'review', 'requests');
const HOURS = 3600_000;

export async function openRequests() {
  let files = [];
  try {
    files = (await readdir(REQUESTS)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
  return Promise.all(files.map(async (f) => ({ file: `content/review/requests/${f}`, ...(await readJSON(p('content', 'review', 'requests', f))) })));
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
const stamp = (d = new Date()) => new Date(d.getTime() + 7 * HOURS).toISOString().slice(0, 16).replace(/[-:T]/g, '');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, kind, subject, file] = process.argv.slice(2);

  if (!cmd) {
    const now = new Date().toISOString();
    const state = await readJSON(STATE, { checkedThrough: new Date(Date.now() - 24 * HOURS).toISOString() });
    // Never further back than 48 hours, so a missed day doesn't turn into a backlog.
    const from = Math.max(Date.parse(state.checkedThrough), Date.now() - 48 * HOURS);
    const { briefs } = await loadContent();
    const due = briefs
      .filter((b) => Math.max(Date.parse(b.publishedAt), Date.parse(b.updatedAt ?? 0) || 0) > from)
      .sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
    console.log(`Briefs published or corrected since ${new Date(from).toISOString()}: ${due.length}\n`);
    for (const b of due) {
      console.log(`=== ${b.id} (${b.publishedAt}${b.updatedAt ? `, corrected ${b.updatedAt}` : ''}) · ${b._file?.replace(p() + '/', '') ?? ''}`);
      console.log(`Headline: ${b.headline}\nBody: ${b.body}${b.note ? `\nNote: ${b.note}` : ''}`);
      for (const [i, s] of (b.sources ?? []).entries()) console.log(`Source ${i}: ${s.name} ${s.url}`);
      for (const ev of b.evidence ?? []) console.log(`Evidence (source ${ev.source}): ${ev.text}`);
      console.log('');
    }
    const open = await openRequests();
    console.log(`Requests still open for the desk: ${open.length ? '' : 'none'}`);
    for (const r of open) console.log(`- ${r.kind}: ${r.subject} (${r.file})`);
    console.log(`\nWhen you have finished, run: node scripts/brief-check.mjs done ${now}`);
    process.exit(0);
  }

  if (cmd === 'add' && /^(CORRECTION|MISSED)$/.test(kind ?? '') && subject && file) {
    const text = (await readFile(file, 'utf8')).trim();
    if (kind === 'CORRECTION') {
      const { briefs } = await loadContent();
      if (!briefs.some((b) => b.id === subject)) {
        console.error(`brief-check: no brief with the id ${subject}`);
        process.exit(1);
      }
      if (!/Brief says:/i.test(text) || !/Source says:/i.test(text) || !/Suggested fix:/i.test(text)) {
        console.error('brief-check: a CORRECTION needs "Brief says:", "Source says:" and "Suggested fix:" lines');
        process.exit(1);
      }
    } else if (!/https?:\/\//.test(text)) {
      console.error('brief-check: a MISSED request needs the primary source link');
      process.exit(1);
    }
    const open = await openRequests();
    if (open.some((r) => r.kind === kind && r.subject === subject)) {
      console.log(`brief-check: a ${kind} request for "${subject}" is already open, nothing added`);
      process.exit(0);
    }
    const name = `${stamp()}-${kind.toLowerCase()}-${slug(subject)}.json`;
    await writeJSON(p('content', 'review', 'requests', name), { kind, subject, at: new Date().toISOString(), text });
    console.log(`brief-check: added content/review/requests/${name}`);
    process.exit(0);
  }

  if (cmd === 'done' && !Number.isNaN(Date.parse(kind ?? ''))) {
    await writeJSON(STATE, { checkedThrough: new Date(kind).toISOString() });
    console.log(`brief-check: checked through ${new Date(kind).toISOString()}. Commit content/review/ and push it to main.`);
    process.exit(0);
  }

  console.error('usage: node scripts/brief-check.mjs [add CORRECTION <brief id> <file.md> | add MISSED "<headline>" <file.md> | done <time>]');
  process.exit(2);
}
