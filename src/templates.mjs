// HTML templates. Plain functions returning strings; everything user- or
// feed-supplied goes through esc().
import { dayKey, esc, longDay, shortDay, timeOf } from '../scripts/lib/util.mjs';

const X_ICON =
  '<svg class="x-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';

const SEARCH_ICON =
  '<svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

export function makeTemplates(ctx) {
  const { site, base, siteUrl, sections, sectionMap, now, ticker, wireUpdatedAt, latestBriefAt, buildId, cardIds = new Set(), charts = new Map() } = ctx;
  const tz = site.timezone; // edition days: Morning Notes and archive pages
  const D = 'UTC'; // times are built in UTC; app.js rewrites them in the reader's own time zone

  const u = (path = '') => base + String(path).replace(/^\/+/, '');
  const abs = (path = '') => siteUrl + u(path);
  const ext = (url, label, cls = '') =>
    `<a${cls ? ` class="${cls}"` : ''} href="${esc(url)}" target="_blank" rel="noopener">${label}</a>`;
  const followUrl = `https://x.com/intent/follow?screen_name=${encodeURIComponent(site.x)}`;
  const shareUrl = (text, path) =>
    `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(abs(path))}&via=${encodeURIComponent(site.x)}`;
  const storyPath = (b) => `story/${b.id}/`;
  const sec = (id) => sectionMap[id] ?? { id, label: id, short: id };

  const todayKey = dayKey(now, D);
  const yesterdayKey = dayKey(new Date(now.getTime() - 86400_000), D);
  const dayLabel = (iso) => {
    const k = dayKey(iso, D);
    if (k === todayKey) return 'Today';
    if (k === yesterdayKey) return 'Yesterday';
    return longDay(iso, D).replace(/ \d{4}$/, '');
  };
  // Each data-t format has a twin in app.js, which re-renders it in the reader's time zone.
  const at = {
    hm: (iso) => timeOf(iso, D),
    hmz: (iso) => `${timeOf(iso, D)} UTC`,
    clock: (iso) => (dayKey(iso, D) === todayKey ? timeOf(iso, D) : shortDay(iso, D)),
    dateline: (iso) => `${longDay(iso, D)}, ${timeOf(iso, D)} UTC`,
  };
  // A note section is a paragraph string or { head, text }.
  const paraText = (x) => (typeof x === 'string' ? x : x?.text ?? '');
  const timeTag = (iso, t = 'hm') => `<time datetime="${esc(iso)}" data-t="${t}">${esc(at[t](iso))}</time>`;
  // Edition dates (Morning Notes, archive days) read the same for every reader.
  const dateTag = (iso, text) => `<time datetime="${esc(iso)}">${esc(text)}</time>`;

  function inline(text) {
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (m, t, url) => `<a href="${url}" target="_blank" rel="noopener">${t}</a>`);
  }

  function bodyHtml(b) {
    const body = esc(b.body);
    if (!b.company) return body;
    const c = esc(b.company);
    const i = body.indexOf(c);
    return i === -1 ? body : `${body.slice(0, i)}<strong>${c}</strong>${body.slice(i + c.length)}`;
  }

  const kicker = (b, { big = false } = {}) =>
    `<p class="kicker">${
      b.star
        ? `<span class="star" aria-hidden="true">★</span>${big ? '<span>The Big One</span><span class="kicker-sep" aria-hidden="true">/</span>' : '<span class="sr">Top story: </span>'}`
        : ''
    }<a href="${u(`section/${b.section}/`)}">${esc(sec(b.section).label)}</a></p>`;

  const minusSign = (v) => v.replace(/^-(?=\d)/, '−');
  const figure = (b, cls = 'figure') =>
    b.figure
      ? `<p class="${cls}"><span class="figure-value">${esc(minusSign(b.figure.value))}</span><span class="figure-label">${esc(b.figure.label)}</span></p>`
      : '';

  const note = (b) =>
    b.note ? `<p class="note"><span class="note-label">Note</span>${esc(b.note)}</p>` : '';

  // Inline, so the chart takes the site's fonts. Its credit line links to Artificial Analysis, and
  // the sentences under it (written when it was drawn, already escaped) come from its <metadata>.
  const chartFigure = (b) => {
    const svg = charts.get(b.id);
    if (!svg) return '';
    const says = svg.match(/<metadata[^>]*>([\s\S]*?)<\/metadata>/)?.[1]?.trim();
    return `<figure class="chart">${svg}${says ? `<figcaption class="chart-note">${says} Source: ${ext('https://artificialanalysis.ai/', 'Artificial Analysis')}.</figcaption>` : ''}</figure>`;
  };

  // A comparison table from figures in the brief's own evidence; the chart's model is marked.
  const squash = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9.]+/g, '');
  const tableFigure = (b) => {
    const t = b.table;
    if (!t) return '';
    const src = b.sources[t.source];
    const head = t.columns.map((c, i) => `<th scope="col"${i ? ' class="num"' : ''}>${esc(c)}</th>`).join('');
    const rows = t.rows
      .map((r) => {
        const mark = b.chart && squash(r[0]) === squash(b.chart.focus) ? ' class="focus"' : '';
        return `<tr${mark}>${r.map((c, i) => (i ? `<td class="num">${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`)).join('')}</tr>`;
      })
      .join('');
    return `<figure class="data-table"><figcaption>${esc(t.title)}</figcaption><div class="table-scroll"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div><p class="table-source">Source: ${ext(src.url, esc(src.name))}</p></figure>`;
  };

  const sourcesLine = (b) =>
    `<span class="srcs">${b.sources.length > 1 ? 'Sources' : 'Source'}: ${b.sources
      .map((s) => ext(s.url, esc(s.name)))
      .join(', ')}</span>`;

  const shareLink = (text, path, label = 'Share') =>
    `<a class="share" href="${esc(shareUrl(text, path))}" target="_blank" rel="noopener">${X_ICON}<span>${label}</span></a>`;

  const meta = (b, { withTime = false } = {}) =>
    `<p class="meta">${withTime ? `${timeTag(b.publishedAt, 'hmz')}<span class="dot" aria-hidden="true">·</span>` : ''}${sourcesLine(b)}<span class="dot" aria-hidden="true">·</span>${shareLink(b.headline, storyPath(b))}</p>`;

  // ---------- shared chrome ----------

  function tape() {
    const quotes = ticker?.quotes ?? [];
    if (!quotes.length) return '';
    const items = quotes
      .map((q) => {
        const dir = q.changePct > 0.005 ? 'up' : q.changePct < -0.005 ? 'down' : 'flat';
        const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
        const pct = `${Math.abs(q.changePct).toFixed(2)}%`;
        const px = q.price.toLocaleString('en-US', { minimumFractionDigits: q.decimals, maximumFractionDigits: q.decimals });
        return `<li><span class="t-sym">${esc(q.label)}</span><span class="t-px">${esc(px)}</span><span class="t-chg ${dir}"><span aria-hidden="true">${arrow}</span><span class="sr">${dir === 'down' ? 'down' : dir === 'up' ? 'up' : 'unchanged'} </span>${esc(pct)}</span></li>`;
      })
      .join('');
    return `<div class="tape" role="region" aria-label="Market ticker, delayed prices"><div class="wrap tape-row"><ul class="tape-list">${items}</ul><span class="tape-meta">Delayed<span class="tape-time"> · ${timeTag(ticker.updatedAt, 'hmz')}</span></span></div></div>`;
  }

  function nav(active) {
    const link = (href, label, id) =>
      `<li><a href="${u(href)}"${active === id ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`;
    return `<nav class="sections" aria-label="Sections"><div class="wrap"><ul>${[
      link('', 'Latest', 'home'),
      ...sections.map((s) => link(`section/${s.id}/`, s.label, s.id)),
      link('wire/', 'The Wire', 'wire'),
      link('notes/', 'Morning Notes', 'notes'),
    ].join('')}</ul></div></nav>`;
  }

  const wordmark = (cls = '') =>
    `<a class="wordmark${cls}" href="${u('')}" aria-label="${esc(site.name)}, home"><span class="wm-notes">Notes from the</span> <span class="wm-terminal">Terminal</span><span class="cursor" aria-hidden="true"></span></a>`;

  function layout({ title, description, path = '', type = 'website', body, active, jsonLd, pageKind = 'page', image, signup = true }) {
    const fullTitle = title ? `${title} | ${site.name}` : `${site.name}: ${site.tagline}`;
    const desc = description || site.description;
    const ld = jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : '';
    const sectionsJson = JSON.stringify(Object.fromEntries(sections.map((s) => [s.id, s.short]))).replace(/</g, '\\u003c');
    return `<!doctype html>
<html lang="en" data-base="${esc(base)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(abs(path))}">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title || site.name)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(abs(path))}">
<meta property="og:image" content="${esc(abs(image ?? 'og.png'))}">
<meta property="og:image:alt" content="${esc(title || site.name)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@${esc(site.x)}">
<meta name="twitter:creator" content="@${esc(site.x)}">
<meta name="theme-color" content="#0b0b0c">
<link rel="icon" href="${u('favicon.svg')}" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${esc(site.name)}" href="${u('feed.xml')}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500&family=Schibsted+Grotesk:wght@500;600;700;800;900&display=swap">
<link rel="stylesheet" href="${u(`assets/site.css?v=${buildId}`)}">
${site.goatcounter ? `<script data-goatcounter="${esc(site.goatcounter)}" async src="https://gc.zgo.at/count.js"></script>` : ''}
${ld}
</head>
<body data-page="${pageKind}" data-latest-brief="${esc(latestBriefAt ?? '')}" data-wire-updated="${esc(wireUpdatedAt ?? '')}">
<a class="skip" href="#main">Skip to content</a>
<div class="utility"><div class="wrap utility-row">
<p class="u-left"><span class="u-date" data-today>${esc(longDay(now, D))}</span><span class="dot u-date-dot" aria-hidden="true">·</span><span><span data-clock>${esc(timeOf(now, D))}</span> <span data-zone>UTC</span></span>${
      wireUpdatedAt
        ? `<span class="dot u-wire-dot" aria-hidden="true">·</span><span class="u-live"><span class="pulse" aria-hidden="true"></span>Wire updated <span data-wire-age data-ago="${esc(wireUpdatedAt)}">${esc(at.hmz(wireUpdatedAt))}</span></span>`
        : ''
    }</p>
<p class="u-right">${site.substackUrl ? `<a class="btn btn-ghost" href="${esc(site.substackUrl)}">Subscribe</a>` : ''}<a class="btn btn-x" href="${esc(followUrl)}" target="_blank" rel="noopener">${X_ICON}<span>Follow <span class="u-handle">@${esc(site.x)}</span></span></a></p>
</div></div>
<header class="masthead"><div class="wrap masthead-row">${wordmark()}<form class="search-form" action="${u('search/')}" method="get" role="search"><label class="sr" for="site-q">Search the desk</label><input id="site-q" type="search" name="q" placeholder="Search news, companies, topics" autocomplete="off"><button type="submit" aria-label="Search">${SEARCH_ICON}</button></form></div></header>
${nav(active)}
${tape()}
<main id="main" class="wrap">
${body}
</main>
<footer class="site-footer"><div class="wrap">
${signup ? signupBox('footer', { compact: true }) : ''}
<div class="footer-top">${wordmark(' wordmark-inverse')}<p class="footer-tagline">${esc(site.tagline)}</p></div>
<nav class="footer-links" aria-label="Footer"><a href="${u('about/')}">About</a><a href="${u('archive/')}">Archive</a><a href="${u('notes/')}">Morning Notes</a><a href="${u('wire/')}">The Wire</a><a href="${u('feed.xml')}">RSS</a><a href="https://x.com/${esc(site.x)}" target="_blank" rel="noopener">X @${esc(site.x)}</a>${site.substackUrl ? `<a href="${esc(site.substackUrl)}">Substack</a>` : ''}</nav>
<p class="copyright">© ${now.getFullYear()} ${esc(site.name)}</p>
</div></footer>
<div class="fresh" hidden><button type="button" data-refresh><span class="pulse" aria-hidden="true"></span>New stories · Refresh</button></div>
<script type="application/json" id="site-data">{"sections":${sectionsJson}}</script>
<script src="${u(`assets/app.js?v=${buildId}`)}" defer></script>
</body>
</html>
`;
  }

  // ---------- building blocks ----------

  function leadArticle(b) {
    return `<article class="lead">
${kicker(b, { big: true })}
<h1 class="lead-head"><a href="${u(storyPath(b))}">${esc(b.headline)}</a></h1>
${figure(b)}
<p class="lead-body">${bodyHtml(b)}</p>
${note(b)}
${meta(b, { withTime: true })}
</article>`;
  }

  function briefArticle(b) {
    return `<article class="brief" id="${esc(b.id)}">
<div class="brief-time">${timeTag(b.publishedAt)}</div>
<div class="brief-main">
${kicker(b)}
<h3 class="brief-head"><a href="${u(storyPath(b))}">${esc(b.headline)}</a></h3>
<p class="brief-body">${bodyHtml(b)}</p>
${figure(b, 'figure figure-sm')}
${note(b)}
${meta(b)}
</div>
</article>`;
  }

  function river(briefs) {
    if (!briefs.length) return '<p class="empty">No briefs in this window yet. The wire on the right is live.</p>';
    const groups = [];
    for (const b of briefs) {
      const label = dayLabel(b.publishedAt);
      if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
      groups.at(-1).items.push(b);
    }
    return groups
      .map((g) => `<h3 class="day">${esc(g.label)}</h3>${g.items.map(briefArticle).join('\n')}`)
      .join('\n');
  }

  const wireItem = (it) =>
    `<li class="wire-item" data-section="${esc(it.section)}" data-tags="${esc((it.tags ?? []).join(' '))}">${timeTag(it.publishedAt ?? it.firstSeen, 'clock')}<div class="wire-text">${ext(it.url, esc(it.title), 'wire-head')}<span class="wire-meta"><span class="wire-src">${esc(it.source)}</span>${
      it.also?.length ? `<span class="wire-also" title="Also reported by ${esc(it.also.map((a) => a.source).join(', '))}">+${it.also.length}</span>` : ''
    }<span class="wire-sec">${esc(sec(it.section).short)}</span></span></div></li>`;

  function wireRail(items, { limit = 30, section = '', title = 'The Wire' } = {}) {
    return `<aside class="wire-rail" aria-labelledby="wire-h">
<h2 class="label" id="wire-h">${esc(title)} <span class="label-note"><span class="pulse" aria-hidden="true"></span>live headlines</span></h2>
${items.length ? `<ol class="wire-list" data-wire-list data-limit="${limit}" data-section="${esc(section)}">${items.slice(0, limit).map(wireItem).join('')}</ol>` : '<p class="empty">The wire is quiet right now.</p>'}
<a class="more" href="${u('wire/')}">Full wire <span aria-hidden="true">→</span></a>
</aside>`;
  }

  const topList = (briefs) =>
    `<ol class="top-list">${briefs
      .map(
        (b, i) =>
          `<li><span class="top-n">${i + 1}</span><div><a class="top-head" href="${u(storyPath(b))}">${esc(b.headline)}</a><p class="top-meta">${esc(sec(b.section).short)} · ${timeTag(b.publishedAt, 'clock')}</p></div></li>`,
      )
      .join('')}</ol>`;

  function noteCard(n) {
    return `<section class="note-card" aria-labelledby="note-card-h">
<h2 class="label">The Morning Note <span class="label-note">${esc(shortDay(n.publishedAt, tz))}</span></h2>
<h3 class="note-card-title" id="note-card-h"><a href="${u(`notes/${n.date}/`)}">${esc(n.title)}</a></h3>
${n.dek ? `<p class="note-card-dek">${esc(n.dek)}</p>` : ''}
<p class="byline">${esc(site.author)}</p>
<a class="more" href="${u(`notes/${n.date}/`)}">Read the note <span aria-hidden="true">→</span></a>
</section>`;
  }

  const shareBar = (text, path) =>
    `<div class="share-bar"><a class="btn btn-x" href="${esc(shareUrl(text, path))}" target="_blank" rel="noopener">${X_ICON}<span>Share on X</span></a><a class="btn btn-ghost" href="${esc(followUrl)}" target="_blank" rel="noopener">Follow @${esc(site.x)}</a></div>`;

  // The Morning Note by email. The form posts straight to Kit, so it works without
  // JavaScript; app.js upgrades it to an in-page submit with a confirmation line.
  function signupBox(id, { compact = false } = {}) {
    if (!site.kitFormId) return '';
    const action = `https://app.kit.com/forms/${encodeURIComponent(site.kitFormId)}/subscriptions`;
    const head = compact ? 'Get the Morning Note by email' : 'The AI-in-finance stories that matter, before work';
    // Until the first email goes out (site.newsletterLive), the box says so.
    const soon = site.newsletterLive ? '' : 'Starting soon. ';
    const dek = compact
      ? `${soon}The AI-in-finance stories that matter, before work. Free, and you can leave anytime.`
      : `${soon}One short email each morning, readable in under three minutes. Free, and you can leave anytime.`;
    return `<section class="signup${compact ? ' signup-compact' : ''}" aria-labelledby="signup-h-${id}">
${compact ? '' : '<p class="kicker">The Morning Note, by email</p>'}
<h2 class="signup-head" id="signup-h-${id}">${head}</h2>
<p class="signup-dek">${dek}</p>
<form class="signup-form" action="${esc(action)}" method="post" data-signup>
<label class="sr" for="signup-email-${id}">Email address</label>
<input id="signup-email-${id}" type="email" name="email_address" placeholder="Your email" autocomplete="email" required>
<button type="submit">Subscribe</button>
</form>
<p class="signup-status" data-signup-status role="status" aria-live="polite"></p>
</section>`;
  }

  // ---------- pages ----------

  // The phone strip leads with finance news; general AI stays in the wire column.
  const stripItems = (wire) => {
    const finance = wire.filter((i) => i.section !== 'models').slice(0, 3);
    return finance.length === 3 ? finance : wire.slice(0, 3);
  };

  function frontPage({ lead, top, note: n, river: riverBriefs, wire }) {
    const hero = lead
      ? leadArticle(lead)
      : `<article class="lead lead-empty"><p class="kicker">The desk</p><h1 class="lead-head">The first briefs land shortly</h1><p class="lead-body">The wire is already live: headlines on AI in banking, payments, the labs and Southeast Asia, refreshed through the day.</p></article>`;
    const side = [n ? noteCard(n) : '', signupBox('front'), top.length ? `<section class="top" aria-labelledby="top-h"><h2 class="label" id="top-h">Top stories</h2>${topList(top)}</section>` : '']
      .filter(Boolean)
      .join('\n');
    return layout({
      path: '',
      active: 'home',
      pageKind: 'front',
      signup: false,
      body: `<section class="live-strip" aria-labelledby="live-h"><h2 class="label" id="live-h">Latest headlines <span class="label-note"><span class="pulse" aria-hidden="true"></span>live</span></h2><ol class="wire-list" data-wire-list data-limit="3" data-exclude="models">${stripItems(wire).map(wireItem).join('')}</ol></section>
<div class="front${side ? '' : ' front-solo'}">
<div class="front-lead">${hero}</div>
${side ? `<div class="front-side">${side}</div>` : ''}
</div>
<div class="columns">
<section class="river" aria-labelledby="latest-h"><h2 class="label" id="latest-h">Latest</h2>
${river(riverBriefs)}
<a class="more" href="${u('archive/')}">Archive <span aria-hidden="true">→</span></a>
</section>
${wireRail(wire)}
</div>`,
    });
  }

  function sectionPage({ section, briefs, wire }) {
    return layout({
      title: section.label,
      description: section.description,
      path: `section/${section.id}/`,
      active: section.id,
      pageKind: 'section',
      body: `<header class="page-head"><p class="kicker">Section</p><h1 class="page-title">${esc(section.label)}</h1><p class="page-dek">${esc(section.description)}</p></header>
<div class="columns">
<section class="river" aria-labelledby="latest-h"><h2 class="label" id="latest-h">Latest briefs</h2>
${river(briefs)}
</section>
${wireRail(wire, { section: section.id, title: `Wire: ${section.short}` })}
</div>`,
    });
  }

  function storyPage({ brief: b, more, related }) {
    const path = storyPath(b);
    const card = cardIds.has(b.id) ? `cards/${b.id}.png` : null;
    const cardAlt = `${b.headline}${b.figure ? `. ${minusSign(b.figure.value)} ${b.figure.label}` : ''}`;
    return layout({
      title: b.headline,
      description: b.body,
      path,
      type: 'article',
      active: b.section,
      pageKind: 'story',
      signup: false,
      image: card,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'NewsArticle',
        headline: b.headline,
        description: b.body,
        datePublished: b.publishedAt,
        dateModified: b.updatedAt ?? b.publishedAt,
        articleSection: sec(b.section).label,
        mainEntityOfPage: abs(path),
        isBasedOn: b.sources.map((s) => s.url),
        ...(card ? { image: abs(card) } : {}),
        author: { '@type': 'Organization', name: site.name, url: abs('') },
        publisher: { '@type': 'Organization', name: site.name, url: abs('') },
      },
      body: `<div class="story-wrap">
<article class="story">
${kicker(b, { big: b.star })}
<h1 class="story-head">${esc(b.headline)}</h1>
<p class="dateline">${timeTag(b.publishedAt, 'dateline')}${b.updatedAt ? ` <span class="updated">Updated ${timeTag(b.updatedAt, 'hmz')}</span>` : ''}</p>
${card ? `<figure class="story-card"><img src="${u(card)}" width="1200" height="630" alt="${esc(cardAlt)}"></figure>` : figure(b)}
<p class="story-body">${bodyHtml(b)}</p>
${note(b)}
${chartFigure(b)}
${tableFigure(b)}
${b.correction ? `<p class="correction"><strong>Correction:</strong> ${esc(b.correction)}</p>` : ''}
<section class="story-sources" aria-labelledby="src-h"><h2 class="label" id="src-h">Read the original</h2><ul>${b.sources
        .map((s) => `<li>${ext(s.url, `${esc(s.name)} <span aria-hidden="true">↗</span>`)}</li>`)
        .join('')}</ul></section>
${shareBar(b.headline, path)}
${signupBox('story')}
</article>
<aside class="story-aside">
${more.length ? `<section><h2 class="label">More in ${esc(sec(b.section).label)}</h2>${topList(more)}</section>` : ''}
${related.length ? `<section><h2 class="label">On the wire</h2><ol class="wire-list">${related.map(wireItem).join('')}</ol></section>` : ''}
</aside>
</div>`,
    });
  }

  function notePage({ note: n, stories }) {
    const path = `notes/${n.date}/`;
    const card = cardIds.has(`note-${n.date}`) ? `cards/note-${n.date}.png` : null;
    return layout({
      image: card,
      title: n.title,
      description: n.dek || paraText(n.body[0]),
      path,
      type: 'article',
      active: 'notes',
      pageKind: 'note',
      signup: false,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'OpinionNewsArticle',
        headline: n.title,
        description: n.dek || paraText(n.body[0]),
        datePublished: n.publishedAt,
        mainEntityOfPage: abs(path),
        author: { '@type': 'Person', name: site.author, url: `https://x.com/${site.x}` },
        publisher: { '@type': 'Organization', name: site.name, url: abs('') },
      },
      body: `<article class="morning-note">
<p class="kicker">The Morning Note</p>
<h1 class="mn-title">${esc(n.title)}</h1>
${n.dek ? `<p class="mn-dek">${esc(n.dek)}</p>` : ''}
<p class="byline">By <a href="https://x.com/${esc(site.x)}" target="_blank" rel="noopener">${esc(site.author)}</a> <span class="dot" aria-hidden="true">·</span> ${dateTag(n.publishedAt, longDay(n.publishedAt, tz))}</p>
<div class="mn-body">${n.body
  .map((x) => (typeof x === 'string' ? `<p>${inline(x)}</p>` : `${x.head ? `<h2 class="mn-sub">${esc(x.head)}</h2>` : ''}<p>${inline(x.text)}</p>`))
  .join('\n')}</div>
${signupBox('note')}
${stories.length ? `<section class="mn-stories" aria-labelledby="mn-s-h"><h2 class="label" id="mn-s-h">The stories behind this note</h2>${topList(stories)}</section>` : ''}
${shareBar(n.title, path)}
</article>`,
    });
  }

  function notesIndex({ notes }) {
    return layout({
      title: 'Morning Notes',
      description: 'One note every morning connecting the day in AI and finance.',
      path: 'notes/',
      active: 'notes',
      body: `<header class="page-head"><p class="kicker">Every morning</p><h1 class="page-title">Morning Notes</h1><p class="page-dek">One note that connects the day's stories in AI and finance.</p></header>
<div class="index-list">${
        notes.length
          ? notes
              .map(
                (n) =>
                  `<article class="index-item"><p class="kicker">${esc(longDay(n.publishedAt, tz))}</p><h2 class="index-title"><a href="${u(`notes/${n.date}/`)}">${esc(n.title)}</a></h2>${n.dek ? `<p class="index-dek">${esc(n.dek)}</p>` : ''}</article>`,
              )
              .join('')
          : '<p class="empty">The first Morning Note is on its way.</p>'
      }</div>`,
    });
  }

  function wirePage({ items }) {
    const groups = [];
    for (const it of items) {
      const label = dayLabel(it.publishedAt ?? it.firstSeen);
      if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
      groups.at(-1).items.push(it);
    }
    const chips = [['', 'All'], ...sections.map((s) => [s.id, s.short])]
      .map(([id, label]) => `<button type="button" class="chip" data-filter="${id}" aria-pressed="${id === '' ? 'true' : 'false'}">${esc(label)}</button>`)
      .join('');
    return layout({
      title: 'The Wire',
      description: 'Live headlines on AI in finance, payments, the labs and Southeast Asia, linked to the original reporting.',
      path: 'wire/',
      active: 'wire',
      pageKind: 'wire',
      body: `<header class="page-head"><p class="kicker"><span class="pulse" aria-hidden="true"></span> Live</p><h1 class="page-title">The Wire</h1><p class="page-dek">Every headline the desk is watching, from ${esc(String(ctx.sourceCount))} sources, refreshed about every ${esc(String(site.wireEveryMinutes ?? 20))} minutes. Each one links to the original story.</p></header>
<div class="chips" role="group" aria-label="Filter by section">${chips}</div>
<div class="wire-page">${groups
        .map((g) => `<h2 class="day">${esc(g.label)}</h2><ol class="wire-list wire-list-wide">${g.items.map(wireItem).join('')}</ol>`)
        .join('')}</div>`,
    });
  }

  function archiveIndex({ days }) {
    return layout({
      title: 'Archive',
      description: 'Every brief, by day.',
      path: 'archive/',
      body: `<header class="page-head"><p class="kicker">Archive</p><h1 class="page-title">Every brief, by day</h1></header>
<ul class="archive-days">${days
        .map((d) => `<li><a href="${u(`archive/${d.key}/`)}">${esc(longDay(d.date, tz))}</a><span class="count">${d.count} ${d.count === 1 ? 'brief' : 'briefs'}</span></li>`)
        .join('')}</ul>`,
    });
  }

  function archiveDay({ key, date, briefs }) {
    return layout({
      title: `Briefs for ${longDay(date, tz)}`,
      path: `archive/${key}/`,
      body: `<header class="page-head"><p class="kicker"><a href="${u('archive/')}">Archive</a></p><h1 class="page-title">${esc(longDay(date, tz))}</h1></header>
<section class="river river-solo">${briefs.map(briefArticle).join('\n')}</section>`,
    });
  }

  function searchPage() {
    const chips = [['', 'All'], ...sections.map((x) => [x.id, x.short])]
      .map(([id, label]) => `<button type="button" class="chip" data-search-filter="${id}" aria-pressed="${id === '' ? 'true' : 'false'}">${esc(label)}</button>`)
      .join('');
    const ideas = ['agentic commerce', 'fraud', 'KYC', 'Indonesia', 'Singapore', 'Nvidia', 'regulator']
      .map((q) => `<button type="button" class="chip chip-idea" data-search-idea="${esc(q)}">${esc(q)}</button>`)
      .join('');
    return layout({
      title: 'Search',
      description: 'Search every brief, Morning Note and live wire headline on the desk.',
      path: 'search/',
      pageKind: 'search',
      body: `<header class="page-head"><p class="kicker">Search</p><h1 class="page-title">Search the desk</h1><p class="page-dek">Every brief and Morning Note, plus the last three days of the live wire.</p></header>
<form class="search-big" role="search" data-search-form><label class="sr" for="q">Search</label><span class="search-big-icon">${SEARCH_ICON}</span><input id="q" type="search" name="q" placeholder="Try a company, a country or a topic" autocomplete="off"></form>
<div class="chips" role="group" aria-label="Filter by section">${chips}</div>
<p class="search-status" aria-live="polite" data-search-status></p>
<div class="search-ideas" data-search-ideas><p class="label-note">Popular searches</p><div class="chips">${ideas}</div></div>
<div class="search-results" data-search-results><noscript><p class="empty">Search needs JavaScript. You can browse the <a href="${u('archive/')}">archive</a> instead.</p></noscript></div>
<script src="${u(`assets/search.js?v=${buildId}`)}" defer></script>`,
    });
  }

  function aboutPage() {
    const x = `<a href="https://x.com/${esc(site.x)}" target="_blank" rel="noopener">@${esc(site.x)}</a>`;
    return layout({
      title: 'About',
      description: 'One place for AI in finance, curated to cut the noise: the stories that change how banks, lenders, insurers and payment companies work.',
      path: 'about/',
      body: `<article class="prose">
<p class="kicker">About</p>
<h1 class="page-title">One place for AI in finance</h1>
<p class="lede">${esc(site.name)} is one place for AI in finance, curated for one mission: following what AI is actually changing inside banks, lenders, insurers and payment companies, with a desk for Southeast Asia.</p>
<p>Most financial news covers everything at once, so the AI stories that matter to people working in finance get buried between market moves, politics and gadget launches. So the idea here is simple: fewer stories, picked because they change how finance works, each one short enough to read in under a minute, with a note on why it matters.</p>
<h2>What you will find here</h2>
<ul class="how">
<li><strong>The briefs.</strong> The day's AI-in-finance stories, sorted into Banking &amp; Lending, Payments &amp; Fintech, the SEA Desk, Models &amp; Labs, Deals, and Rules &amp; Regulators.</li>
<li><strong>The Morning Note.</strong> One note each morning that connects the stories worth your attention, on the site and by email.</li>
<li><strong>The Wire.</strong> Live headlines, linked straight to the original reporting.</li>
</ul>
<p>Follow along on X at ${x}.</p>
<h2>Corrections</h2>
<p>Spot a mistake? Reply to ${x} on X, and the brief gets fixed with a correction line.</p>
<h2>Not advice</h2>
<p>Nothing here is investment advice.</p>
</article>`,
    });
  }

  function notFoundPage() {
    return layout({
      title: 'Page not found',
      path: '404.html',
      body: `<div class="prose"><p class="kicker">404</p><h1 class="page-title">That page isn't on the terminal</h1><p class="lede">It may have moved. <a href="${u('')}">Back to the latest</a>.</p></div>`,
    });
  }

  function rss({ briefs }) {
    const items = briefs
      .slice(0, 60)
      .map(
        (b) => `<item>
<title>${esc(b.headline)}</title>
<link>${esc(abs(storyPath(b)))}</link>
<guid isPermaLink="true">${esc(abs(storyPath(b)))}</guid>
<pubDate>${new Date(b.publishedAt).toUTCString()}</pubDate>
<category>${esc(sec(b.section).label)}</category>
<description>${esc(`${b.body}${b.note ? ` Note: ${b.note}` : ''}`)}</description>
</item>`,
      )
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${esc(site.name)}</title>
<link>${esc(abs(''))}</link>
<atom:link href="${esc(abs('feed.xml'))}" rel="self" type="application/rss+xml"/>
<description>${esc(site.description)}</description>
<language>en</language>
<lastBuildDate>${now.toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>
`;
  }

  function sitemap(paths) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((x) => `<url><loc>${esc(abs(x.path))}</loc>${x.lastmod ? `<lastmod>${esc(x.lastmod)}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
  }

  return { frontPage, sectionPage, storyPage, notePage, notesIndex, wirePage, archiveIndex, archiveDay, aboutPage, searchPage, notFoundPage, rss, sitemap, abs, u };
}
