// Client-side search over data/search.json: briefs, Morning Notes and the live
// wire. Every term must match somewhere (headline counts most); each term also
// matches as a word prefix, so results appear while typing. No dependencies.
(() => {
  const TZ = 'Asia/Jakarta';
  const base = document.documentElement.dataset.base || '/';
  const input = document.getElementById('q');
  const out = document.querySelector('[data-search-results]');
  const status = document.querySelector('[data-search-status]');
  const ideas = document.querySelector('[data-search-ideas]');
  const chips = [...document.querySelectorAll('[data-search-filter]')];
  if (!input || !out) return;

  // Same "28 Sep 2026" style as the rest of the site (en-GB alone prints "Sept").
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dateFmt = {
    format: (d) => {
      const [y, m, day] = keyFmt.format(d).split('-');
      return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}`;
    },
  };
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const termsOf = (q) => norm(q).split(/[^a-z0-9$%&.]+/).map((t) => t.replace(/^\.+|\.+$/g, '')).filter(Boolean);

  let index = null;
  let section = '';
  let timer = 0;

  async function load() {
    if (index) return index;
    const res = await fetch(`${base}data/search.json`, { cache: 'no-cache' });
    const data = await res.json();
    const label = (id) => data.sections[id] ?? id;
    const prep = (doc, fields) => ({ ...doc, _f: fields.map(([text, weight]) => [norm(text), weight]) });
    index = {
      briefs: data.briefs.map((b) =>
        prep({ ...b, kind: 'brief' }, [[b.t, 5], [b.c, 4], [`${label(b.s)} ${(b.g || []).map(label).join(' ')}`, 2], [`${b.b} ${b.n}`, 1], [b.src, 1]]),
      ),
      notes: data.notes.map((n) => prep({ ...n, kind: 'note' }, [[n.t, 5], [n.k, 3], [n.b, 1]])),
      wire: data.wire.map((w) => prep({ ...w, kind: 'wire' }, [[w.t, 5], [w.s, 2], [`${label(w.sec)} ${(w.g || []).map(label).join(' ')}`, 1]])),
      label,
    };
    return index;
  }

  function score(doc, regexes) {
    let total = 0;
    for (const re of regexes) {
      let s = 0;
      for (const [text, weight] of doc._f) if (re.test(text)) s += weight;
      if (!s) return 0;
      total += s;
    }
    // Newer stories win ties: up to +1 for the last 30 days.
    const ageDays = (Date.now() - Date.parse(doc.d)) / 86400_000;
    return total + Math.max(0, 1 - ageDays / 30);
  }

  function mark(text, terms) {
    let html = esc(text);
    for (const t of terms) {
      const safe = reEsc(esc(t));
      html = html.replace(new RegExp(`(^|[^a-z0-9])(${safe}[a-z0-9]*)`, 'gi'), '$1<mark>$2</mark>');
    }
    return html;
  }

  function snippet(text, terms, size = 190) {
    const lower = text.toLowerCase();
    const hit = Math.min(...terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0), Infinity);
    if (!Number.isFinite(hit) || text.length <= size) return text.slice(0, size) + (text.length > size ? '…' : '');
    const start = Math.max(0, hit - 60);
    return `${start ? '…' : ''}${text.slice(start, start + size)}${start + size < text.length ? '…' : ''}`;
  }

  const inSection = (doc) => !section || doc.s === section || doc.sec === section || (doc.g || []).includes(section);

  function render(q) {
    const terms = termsOf(q);
    if (ideas) ideas.hidden = terms.length > 0;
    if (!terms.length) {
      out.innerHTML = '';
      status.textContent = '';
      return;
    }
    const regexes = terms.map((t) => new RegExp(`(?:^|[^a-z0-9])${reEsc(t)}`));
    const rank = (list) =>
      list
        .filter(inSection)
        .map((doc) => [score(doc, regexes), doc])
        .filter(([s]) => s > 0)
        .sort((a, b) => b[0] - a[0])
        .map(([, doc]) => doc);

    const stories = [...rank(index.briefs), ...(section ? [] : rank(index.notes))];
    const wire = rank(index.wire).slice(0, 25);

    const storyHtml = stories
      .slice(0, 50)
      .map((doc) =>
        doc.kind === 'note'
          ? `<article class="result"><p class="kicker">The Morning Note · ${esc(dateFmt.format(new Date(doc.d)))}</p><h3 class="result-head"><a href="${base}notes/${esc(doc.date)}/">${mark(doc.t, terms)}</a></h3><p class="result-snip">${mark(snippet(`${doc.k} ${doc.b}`.trim(), terms), terms)}</p></article>`
          : `<article class="result"><p class="kicker">${esc(index.label(doc.s))} · ${esc(dateFmt.format(new Date(doc.d)))}</p><h3 class="result-head"><a href="${base}story/${esc(doc.id)}/">${mark(doc.t, terms)}</a></h3><p class="result-snip">${mark(snippet(doc.b, terms), terms)}</p></article>`,
      )
      .join('');
    const wireHtml = wire
      .map(
        (w) =>
          `<li class="wire-item"><time datetime="${esc(w.d)}">${esc(dateFmt.format(new Date(w.d)).replace(/ \d{4}$/, ''))}</time><div class="wire-text"><a class="wire-head" href="${esc(w.u)}" target="_blank" rel="noopener">${mark(w.t, terms)}</a><span class="wire-meta"><span class="wire-src">${esc(w.s)}</span><span class="wire-sec">${esc(index.label(w.sec))}</span></span></div></li>`,
      )
      .join('');

    const total = stories.length + wire.length;
    status.textContent = total
      ? `${stories.length} ${stories.length === 1 ? 'story' : 'stories'} and ${wire.length} wire ${wire.length === 1 ? 'headline' : 'headlines'} for “${q.trim()}”`
      : `Nothing found for “${q.trim()}”. Try a company name or a broader word.`;
    out.innerHTML =
      (stories.length ? `<h2 class="label">Stories</h2>${storyHtml}` : '') +
      (wire.length ? `<h2 class="label">From the wire <span class="label-note">last 3 days</span></h2><ol class="wire-list">${wireHtml}</ol>` : '');
  }

  function sync() {
    const q = input.value;
    const url = new URL(location.href);
    q.trim() ? url.searchParams.set('q', q.trim()) : url.searchParams.delete('q');
    section ? url.searchParams.set('s', section) : url.searchParams.delete('s');
    history.replaceState(null, '', url);
    render(q);
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(sync, 120);
  });
  document.querySelector('[data-search-form]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    sync();
  });
  chips.forEach((chip) =>
    chip.addEventListener('click', () => {
      section = chip.dataset.searchFilter;
      chips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      sync();
    }),
  );
  document.querySelectorAll('[data-search-idea]').forEach((b) =>
    b.addEventListener('click', () => {
      input.value = b.dataset.searchIdea;
      sync();
      input.focus();
    }),
  );

  const params = new URLSearchParams(location.search);
  input.value = params.get('q') ?? '';
  section = params.get('s') ?? '';
  chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.searchFilter === section)));
  const header = document.getElementById('site-q');
  if (header) header.value = input.value;
  load()
    .then(() => render(input.value))
    .catch(() => {
      status.textContent = 'Search is unavailable right now. Please try again in a minute.';
    });
  if (!input.value) input.focus();
})();
