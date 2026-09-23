// Keeps a static page feeling live: clock, "wire updated" age, a refreshed
// wire rail, and a prompt when new briefs land. No framework, no tracking.
(() => {
  const TZ = 'Asia/Jakarta';
  const base = document.documentElement.dataset.base || '/';
  const body = document.body;
  let sectionsShort = {};
  try {
    sectionsShort = JSON.parse(document.getElementById('site-data').textContent).sections || {};
  } catch {}

  const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const shortDay = (d) => {
    const [, m, day] = keyFmt.format(d).split('-');
    return `${Number(day)} ${MONTHS[Number(m) - 1]}`;
  };

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function ago(iso) {
    const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const h = Math.floor(mins / 60);
    return h < 24 ? `${h} hr ago` : `${Math.floor(h / 24)} d ago`;
  }

  function tick() {
    const now = new Date();
    document.querySelectorAll('[data-clock]').forEach((el) => (el.textContent = clockFmt.format(now)));
    document.querySelectorAll('[data-today]').forEach((el) => (el.textContent = dayFmt.format(now)));
    document.querySelectorAll('[data-ago]').forEach((el) => (el.textContent = ago(el.dataset.ago)));
  }

  // Same markup as the server's wireItem() template.
  function wireItem(it) {
    const iso = it.publishedAt || it.firstSeen;
    const d = new Date(iso);
    const label = keyFmt.format(d) === keyFmt.format(new Date()) ? clockFmt.format(d) : shortDay(d);
    const also = it.also && it.also.length
      ? `<span class="wire-also" title="Also reported by ${esc(it.also.map((a) => a.source).join(', '))}">+${it.also.length}</span>`
      : '';
    return `<li class="wire-item" data-section="${esc(it.section)}" data-tags="${esc((it.tags || []).join(' '))}"><time datetime="${esc(iso)}">${esc(label)}</time><div class="wire-text"><a class="wire-head" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a><span class="wire-meta"><span class="wire-src">${esc(it.source)}</span>${also}<span class="wire-sec">${esc(sectionsShort[it.section] || it.section)}</span></span></div></li>`;
  }

  async function refreshWire() {
    const list = document.querySelector('[data-wire-list]');
    if (!list) return;
    const res = await fetch(`${base}data/wire.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const wire = await res.json();
    const limit = Number(list.dataset.limit || 30);
    const section = list.dataset.section || '';
    const items = wire.items
      .filter((i) => i.display !== false && (!section || i.section === section || (i.tags || []).includes(section)))
      .slice(0, limit);
    if (items.length) list.innerHTML = items.map(wireItem).join('');
  }

  let wireUpdatedAt = body.dataset.wireUpdated || '';
  const latestBrief = body.dataset.latestBrief || '';
  const fresh = document.querySelector('.fresh');

  async function poll() {
    try {
      const res = await fetch(`${base}data/latest.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const latest = await res.json();
      if (latest.wireUpdatedAt) {
        document.querySelectorAll('[data-wire-age]').forEach((el) => (el.dataset.ago = latest.wireUpdatedAt));
        if (latest.wireUpdatedAt !== wireUpdatedAt) {
          wireUpdatedAt = latest.wireUpdatedAt;
          await refreshWire();
        }
      }
      if (fresh && latest.latestBriefAt && (!latestBrief || Date.parse(latest.latestBriefAt) > Date.parse(latestBrief))) fresh.hidden = false;
      tick();
    } catch {}
  }

  document.querySelector('[data-refresh]')?.addEventListener('click', () => location.reload());

  // Section filter chips on the wire page.
  const chips = document.querySelectorAll('.chip[data-filter]');
  chips.forEach((chip) =>
    chip.addEventListener('click', () => {
      const f = chip.dataset.filter;
      chips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      document.querySelectorAll('.wire-page .wire-item').forEach((li) => {
        li.hidden = Boolean(f) && li.dataset.section !== f && !li.dataset.tags.split(' ').includes(f);
      });
      document.querySelectorAll('.wire-page .day').forEach((h) => {
        const list = h.nextElementSibling;
        h.hidden = list ? ![...list.children].some((li) => !li.hidden) : false;
      });
    }),
  );

  tick();
  setInterval(tick, 30_000);
  setInterval(poll, 120_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') poll();
  });
})();
