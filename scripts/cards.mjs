// Share cards: one 1200x630 PNG per brief and per Morning Note, drawn only from
// the site's own headline, figure and section (no third-party images, so no
// licensing questions). Rendered with headless Chrome and cached by content
// hash in .cache/cards/, so an unchanged story is never rendered twice.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { dayKey, esc, hash, p, shortDay } from './lib/util.mjs';

const chrome = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((c) => c && existsSync(c));

// Terminal-style mnemonics for stories without a headline number.
const MNEMONIC = { banking: 'BANK', payments: 'PAY', sea: 'SEA', models: 'LAB', deals: 'DEAL', rules: 'REG' };

const FONTS =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Newsreader:ital,opsz,wght@0,6..72,600;1,6..72,500&family=Schibsted+Grotesk:wght@800;900&display=block';

const CSS = `
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #fff; }
.card { position: relative; width: 1200px; height: 630px; }
.rule { position: absolute; left: 64px; right: 64px; top: 52px; border-top: 6px solid #0b0b0c; }
.kicker { position: absolute; left: 64px; top: 82px; font: 600 21px 'IBM Plex Mono', monospace; letter-spacing: .1em; text-transform: uppercase; color: #b34700; white-space: nowrap; }
.kicker .star { color: #ff8c1a; margin-right: 10px; }
.kicker .sep { color: #5e5e66; margin: 0 10px; }
.clamp { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }
.head { position: absolute; left: 64px; top: 136px; width: 640px; font-family: 'Schibsted Grotesk', sans-serif; font-weight: 800; line-height: 1.04; letter-spacing: -.028em; color: #0b0b0c; -webkit-line-clamp: 4; }
.src { position: absolute; left: 64px; top: 440px; width: 640px; font: 500 19px 'IBM Plex Mono', monospace; color: #5e5e66; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.panel { position: absolute; right: 64px; top: 136px; width: 392px; height: 330px; border-radius: 4px; box-sizing: border-box; padding: 40px 36px; display: flex; flex-direction: column; justify-content: center; }
.panel.fig { background: #fbf5ec; }
.panel.term { background: #0b0b0c; }
.fig-value { font-family: 'Schibsted Grotesk', sans-serif; font-weight: 900; line-height: 1; letter-spacing: -.04em; color: #0b0b0c; white-space: nowrap; }
.fig-label { margin-top: 18px; font: 600 19px/1.35 'IBM Plex Mono', monospace; letter-spacing: .06em; text-transform: uppercase; color: #5e5e66; }
.mnemonic { font: 600 104px/1 'IBM Plex Mono', monospace; color: #ff9f1c; letter-spacing: -.02em; white-space: nowrap; }
.mnemonic .cursor { display: inline-block; width: .5em; height: .72em; margin-left: .08em; background: #ff8c1a; vertical-align: baseline; }
.term-label { margin-top: 20px; font: 600 19px 'IBM Plex Mono', monospace; letter-spacing: .08em; text-transform: uppercase; color: #a1a1aa; }
.note-kicker { position: absolute; left: 64px; top: 82px; font: 600 21px 'IBM Plex Mono', monospace; letter-spacing: .1em; text-transform: uppercase; color: #b34700; }
.note-wrap { position: absolute; left: 64px; right: 64px; top: 124px; bottom: 136px; display: flex; flex-direction: column; justify-content: center; gap: 22px; }
.note-title { font-family: 'Newsreader', serif; font-weight: 600; line-height: 1.08; letter-spacing: -.015em; color: #0b0b0c; -webkit-line-clamp: 3; }
.note-dek { max-width: 1000px; font: italic 500 28px/1.35 'Newsreader', serif; color: #5e5e66; -webkit-line-clamp: 2; }
.band { position: absolute; left: 0; right: 0; bottom: 0; height: 104px; background: #0b0b0c; display: flex; align-items: center; justify-content: space-between; padding: 0 64px; box-sizing: border-box; }
.mark { color: #fff; font-size: 38px; line-height: 1; white-space: nowrap; }
.mark .notes { font-family: 'Newsreader', serif; font-style: italic; font-weight: 500; }
.mark .terminal { font-family: 'Schibsted Grotesk', sans-serif; font-weight: 900; letter-spacing: -.035em; }
.mark .cursor { display: inline-block; width: .4em; height: .7em; margin-left: .08em; background: #ff8c1a; vertical-align: baseline; }
.handle { font: 600 24px 'IBM Plex Mono', monospace; color: #ff9f1c; letter-spacing: .04em; }
`;

const page = (body) =>
  `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${FONTS}"><style>${CSS}</style></head><body><div class="card">${body}</div></body></html>`;

const band = (site) =>
  `<div class="band"><span class="mark"><span class="notes">Notes from the</span> <span class="terminal">Terminal</span><span class="cursor"></span></span><span class="handle">@${esc(site.x)}</span></div>`;

const sizeFor = (text, steps) => steps.find(([max]) => text.length <= max)?.[1] ?? steps.at(-1)[1];
const minus = (v) => v.replace(/^-(?=\d)/, '−');
const dateLine = (iso, tz) => `${shortDay(iso, tz)} ${dayKey(iso, tz).slice(0, 4)}`;

function briefCard(b, { site, sectionMap }) {
  const section = sectionMap[b.section]?.label ?? b.section;
  const names = b.sources.map((s) => s.name);
  const sources = names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  const headSize = sizeFor(b.headline, [[60, 60], [80, 54], [100, 48], [Infinity, 44]]);
  const panel = b.figure
    ? `<div class="panel fig"><div class="fig-value" style="font-size:${sizeFor(b.figure.value, [[5, 104], [7, 88], [10, 72], [Infinity, 60]])}px">${esc(minus(b.figure.value))}</div><div class="fig-label">${esc(b.figure.label)}</div></div>`
    : `<div class="panel term"><div class="mnemonic">${MNEMONIC[b.section] ?? 'NEWS'}<span class="cursor"></span></div><div class="term-label">${esc(section)}</div></div>`;
  return page(`
<div class="rule"></div>
<div class="kicker">${b.star ? '<span class="star">★</span>The Big One<span class="sep">/</span>' : ''}${esc(section)}</div>
<div class="head clamp" style="font-size:${headSize}px">${esc(b.headline)}</div>
<div class="src">${b.sources.length > 1 ? 'Sources' : 'Source'}: ${esc(sources)} · ${esc(dateLine(b.publishedAt, site.timezone))}</div>
${panel}
${band(site)}`);
}

function noteCard(n, { site }) {
  const titleSize = sizeFor(n.title, [[60, 72], [80, 62], [Infinity, 54]]);
  return page(`
<div class="rule"></div>
<div class="note-kicker">The Morning Note · ${esc(dateLine(n.publishedAt, site.timezone))}</div>
<div class="note-wrap">
<div class="note-title clamp" style="font-size:${titleSize}px">${esc(n.title)}</div>
${n.dek ? `<div class="note-dek clamp">${esc(n.dek)}</div>` : ''}
</div>
${band(site)}`);
}

export async function renderCards({ briefs, notes, site, sectionMap, outDir }) {
  const cacheDir = p('.cache', 'cards');
  await mkdir(cacheDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const jobs = [
    ...briefs.map((b) => ({ id: b.id, html: briefCard(b, { site, sectionMap }) })),
    ...notes.map((n) => ({ id: `note-${n.date}`, html: noteCard(n, { site }) })),
  ].map((j) => ({ ...j, key: `${j.id}-${hash(j.html, 10)}` }));

  const ready = new Set();
  let rendered = 0;
  let cached = 0;
  let failed = 0;
  for (const job of jobs) {
    const png = `${cacheDir}/${job.key}.png`;
    if (existsSync(png)) cached++;
    else if (chrome) {
      const html = `${cacheDir}/${job.key}.html`;
      await writeFile(html, job.html);
      spawnSync(
        chrome,
        ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,630', '--virtual-time-budget=10000', `--screenshot=${png}`, pathToFileURL(html).href],
        { timeout: 60_000, stdio: 'ignore' },
      );
      await rm(html, { force: true });
      if (!existsSync(png)) {
        failed++;
        continue;
      }
      rendered++;
    } else {
      failed++;
      continue;
    }
    await copyFile(png, `${outDir}/${job.id}.png`);
    ready.add(job.id);
  }

  // Drop cached cards for stories that changed or no longer exist.
  const keep = new Set(jobs.map((j) => `${j.key}.png`));
  for (const f of await readdir(cacheDir)) if (!keep.has(f)) await rm(`${cacheDir}/${f}`, { force: true });

  console.log(`cards: ${rendered} rendered, ${cached} cached${failed ? `, ${failed} skipped${chrome ? '' : ' (no Chrome found)'}` : ''}`);
  return ready;
}
