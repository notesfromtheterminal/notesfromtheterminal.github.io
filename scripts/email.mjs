// Builds the Morning Note email: the HTML that goes into one HTML block of a Kit
// broadcast (the Kit template in email/kit-template.html supplies the frame and footer).
//   node scripts/email.mjs 2026-10-01             -> the HTML block
//   node scripts/email.mjs 2026-10-01 --preview   -> a full page, template included, to look at
import { readFile } from 'node:fs/promises';
import { loadContent } from './validate.mjs';
import { esc, fetchJSON, p, readJSON } from './lib/util.mjs';

const [date, flag] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
  console.error('usage: node scripts/email.mjs YYYY-MM-DD [--preview]');
  process.exit(2);
}

const site = await readJSON(p('config', 'site.json'));
const sections = (await readJSON(p('config', 'sections.json'))).sections;
const SITE = (process.env.SITE_URL || site.url).replace(/\/+$/, '');
const note = await readJSON(p('content', 'notes', `${date}.json`));
const { briefs } = await loadContent();
const byId = new Map(briefs.map((b) => [b.id, b]));
const stories = [...new Set([note.lead, ...(note.stories ?? [])].filter(Boolean))].map((id) => byId.get(id)).filter(Boolean);
const noteSections = note.body.map((x) => (typeof x === 'string' ? { head: '', text: x } : { head: x.head ?? '', text: x.text }));
const label = (id) => sections.find((s) => s.id === id)?.label ?? id;

// Also on the wire: same picks as the pull request (finance first, one per publisher).
const covered = new Set(stories.flatMap((b) => b.sources.map((s) => s.url)));
const wire = await fetchJSON(`${SITE}/data/wire.json`);
const RANK = ['banking', 'payments', 'sea', 'rules', 'deals'];
const rank = (i) => RANK.indexOf(i.section) + 1 || RANK.length + 1;
const when = (i) => Date.parse(i.publishedAt ?? i.firstSeen);
const wireItems = [];
for (const i of (wire?.items ?? [])
  .filter((i) => i.display !== false && i.section !== 'models' && !covered.has(i.url) && Date.now() - when(i) < 36 * 3600_000)
  .sort((a, b) => rank(a) - rank(b) || when(b) - when(a))) {
  if (wireItems.length === 3) break;
  if (!wireItems.some((w) => w.source === i.source)) wireItems.push(i);
}

const parts = Object.fromEntries(
  new Intl.DateTimeFormat('en-GB', { timeZone: site.timezone, weekday: 'long', day: 'numeric', month: 'long' }).formatToParts(new Date(note.publishedAt)).map((x) => [x.type, x.value]),
);
const day = `${parts.weekday}, ${parts.day} ${parts.month}`;
const firstSentence = (s) => String(s ?? '').split(/(?<=[.!?])\s+(?=[A-Z])/)[0];
// Cards stay even: the "why it matters" line stops at about 150 characters, on a word.
const clip = (s, max = 150) => (s.length <= max ? s : `${s.slice(0, s.lastIndexOf(' ', max)).replace(/[,;:]$/, '')}…`);

// Palette and type: the site's own, with email-safe fallbacks.
const C = { ink: '#0b0b0c', panel: '#17171a', cream: '#f6efe4', paper: '#fffaf2', amber: '#ff8c1a', rust: '#b34700', text: '#1d1d1f', muted: '#5e5e66', light: '#f4f4f5', dim: '#a1a1aa', rule: '#e4dccd' };
const SERIF = "'Newsreader',Georgia,'Times New Roman',serif";
const SANS = "'Schibsted Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'IBM Plex Mono','Courier New',Courier,monospace";

const cursor = `<span style="color:${C.amber};">&#9646;</span>`;
const emblem = (pad = '26px 0 0') => `<tr><td align="center" style="padding:${pad};font-family:${SANS};font-size:18px;line-height:1;color:${C.amber};">&#9646;</td></tr>`;
const kicker = (text, color) => `<p style="margin:0 0 14px;font-family:${MONO};font-size:11.5px;line-height:1.4;letter-spacing:.14em;text-transform:uppercase;color:${color};">${text}</p>`;
const heading = (text, color) =>
  `<tr><td class="nft-pad nft-h" align="center" style="padding:30px 40px 18px;font-family:${SERIF};font-size:21px;line-height:1.25;letter-spacing:.12em;text-transform:uppercase;color:${color};">${text}</td></tr>`;
const pill = (href, text, color) =>
  `<a href="${esc(href)}" style="display:inline-block;padding:11px 24px;border:1px solid ${color};border-radius:999px;font-family:${SANS};font-size:13.5px;font-weight:600;line-height:1;color:${color};text-decoration:none;">${text}</a>`;
const block = (bg, rows) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bg};">${rows}</table>`;

// Two cards per row; on phones each card takes the full width.
function grid(cards) {
  const cell = (inner) =>
    `<!--[if mso]><td width="262" valign="top"><![endif]--><div class="nft-col" style="display:inline-block;width:100%;max-width:252px;vertical-align:top;margin:0 9px 26px;text-align:left;">${inner}</div><!--[if mso]></td><![endif]-->`;
  const rows = [];
  for (let i = 0; i < cards.length; i += 2)
    rows.push(
      `<tr><td class="nft-pad" align="center" style="padding:0 29px;font-size:0;"><!--[if mso]><table role="presentation" width="540" cellpadding="0" cellspacing="0"><tr><![endif]-->${cards.slice(i, i + 2).map(cell).join('')}<!--[if mso]></tr></table><![endif]--></td></tr>`,
    );
  return rows.join('');
}

const storyCard = (b) => {
  const href = `${SITE}/story/${b.id}/`;
  return `<a href="${esc(href)}" style="text-decoration:none;"><img src="${esc(`${SITE}/cards/${b.id}.png`)}" width="252" alt="${esc(b.headline)}" class="nft-img" style="display:block;width:100%;max-width:252px;height:auto;border:1px solid ${C.rule};"></a>
<p style="margin:14px 0 6px;font-family:${MONO};font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:${C.rust};">${esc(label(b.section))}</p>
<p style="margin:0 0 8px;font-family:${SERIF};font-size:19px;font-weight:600;line-height:1.25;color:${C.ink};"><a href="${esc(href)}" style="color:${C.ink};text-decoration:none;">${esc(b.headline)}</a></p>
<p style="margin:0 0 14px;font-family:${SANS};font-size:14px;line-height:1.55;color:${C.muted};">${esc(clip(firstSentence(b.note || b.body)))}</p>
${pill(href, 'Read the brief', C.ink)}`;
};

// The note's own markup: **bold** and [text](https://link), as on the site.
const inline = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fff;">$1</strong>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (m, text, url) => `<a href="${url}" style="color:${C.amber};text-decoration:underline;">${text}</a>`);

// The whole note, one numbered card per section: the subheading, then the section's text.
const sectionRow = (s, i) =>
  `<tr><td class="nft-pad" style="padding:0 40px 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.panel};"><tr>
<td width="46" align="center" valign="top" style="background:${C.rust};font-family:${MONO};font-size:15px;font-weight:500;color:#fff;padding:16px 0;">${String(i + 1).padStart(2, '0')}</td>
<td valign="top" style="padding:14px 18px 16px;">${s.head ? `<p style="margin:0 0 7px;font-family:${SANS};font-size:16px;font-weight:700;line-height:1.35;color:${C.light};">${esc(s.head)}</p>` : ''}<p style="margin:0;font-family:${SERIF};font-size:17px;line-height:1.6;color:#d4d4d8;">${inline(s.text)}</p></td>
</tr></table></td></tr>`;

const html = [
  // Masthead and the day's idea
  block(
    C.ink,
    `<tr><td align="center" style="padding:30px 30px 0;font-size:22px;line-height:1;"><span style="font-family:${SERIF};font-style:italic;color:${C.light};">Notes from the</span> <span style="font-family:${SANS};font-weight:800;letter-spacing:-.01em;color:#fff;">Terminal</span>${cursor}</td></tr>
<tr><td class="nft-pad" align="center" style="padding:34px 44px 0;">${kicker(`The Morning Note &middot; <span style="white-space:nowrap;">${esc(day)}</span>`, C.amber)}
<h1 class="nft-title" style="margin:0 0 16px;font-family:${SERIF};font-size:32px;font-weight:500;line-height:1.18;color:#fff;">${esc(note.title)}</h1>
<p style="margin:0;font-family:${SERIF};font-style:italic;font-size:17px;line-height:1.55;color:${C.dim};">${esc(note.dek ?? '')}</p></td></tr>
${emblem('28px 0 4px')}
${heading("Today's idea in " + noteSections.length + ' points', C.light)}
${noteSections.map(sectionRow).join('')}
<tr><td align="center" style="padding:18px 30px 36px;">${pill(`${SITE}/notes/${date}/`, 'Read it on the site', C.light)}</td></tr>`,
  ),
  // The stories behind it
  block(
    C.cream,
    `${heading("Today's stories", C.ink)}
${grid(stories.slice(0, 4).map(storyCard))}`,
  ),
  // House slot: the place a sponsor takes later
  block(
    C.paper,
    `<tr><td class="nft-pad" align="center" style="padding:30px 46px 32px;border-top:1px solid ${C.rule};border-bottom:1px solid ${C.rule};">${kicker('A note from us', C.rust)}
<p style="margin:0 0 18px;font-family:${SERIF};font-style:italic;font-size:18px;line-height:1.5;color:${C.text};">Enjoying the Morning Note? Forward it to a colleague in finance, or follow along on X for the stories as they land.</p>
${pill(`https://x.com/${site.x}`, `Follow @${esc(site.x)}`, C.ink)}</td></tr>`,
  ),
  // Also on the wire
  wireItems.length
    ? block(
        C.cream,
        `${heading('Also on the wire', C.ink)}
${wireItems
  .map(
    (w) =>
      `<tr><td class="nft-pad" style="padding:0 44px 16px;"><p style="margin:0;font-family:${SERIF};font-size:17px;line-height:1.4;color:${C.ink};"><span style="color:${C.amber};">&#9646;</span>&nbsp; <a href="${esc(w.url)}" style="color:${C.ink};text-decoration:underline;text-decoration-color:${C.amber};">${esc(w.title)}</a></p>
<p style="margin:4px 0 0 18px;font-family:${MONO};font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${C.muted};">${esc(w.source)}</p></td></tr>`,
  )
  .join('')}
<tr><td style="padding:0 0 20px;"></td></tr>`,
      )
    : '',
  // Sign-off
  block(
    C.ink,
    `<tr><td align="center" style="padding:34px 30px 6px;font-family:${SERIF};font-style:italic;font-size:16px;color:${C.dim};">Until the next note,</td></tr>
<tr><td align="center" style="padding:0 30px;font-family:${SANS};font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#fff;">${esc(site.author)}</td></tr>
${emblem('18px 0 34px')}`,
  ),
].join('\n');

if (flag === '--preview') {
  const template = await readFile(p('email', 'kit-template.html'), 'utf8');
  console.log(
    template
      .replace('{{ message_content }}', () => html)
      .replace('{{ unsubscribe_url }}', '#')
      .replace('{{ address }}', '600 1st Ave, Ste 330 PMB 92768, Seattle, WA 98104-2246'),
  );
} else console.log(html);
