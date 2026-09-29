// Keeps a static page feeling live: clock, "wire updated" age, a refreshed
// wire rail, and a prompt when new briefs land. No framework, no tracking.
(() => {
  // Pages are built in UTC; every time on them is rewritten in the reader's
  // own time zone, taken from the device (no IP lookup).
  const TZ = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  })();
  const base = document.documentElement.dataset.base || '/';
  const body = document.body;
  let sectionsShort = {};
  try {
    sectionsShort = JSON.parse(document.getElementById('site-data').textContent).sections || {};
  } catch {}

  const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  const dayParts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  // The reader's own locale names the zone, so a Londoner sees BST and a New Yorker EDT.
  const zoneFmt = new Intl.DateTimeFormat(undefined, { timeZone: TZ, timeZoneName: 'short' });
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const shortDay = (d) => {
    const [, m, day] = keyFmt.format(d).split('-');
    return `${Number(day)} ${MONTHS[Number(m) - 1]}`;
  };
  // Built from parts so every browser prints "Tuesday, 29 September 2026", like the build.
  const longDay = (d) => {
    const p = Object.fromEntries(dayParts.formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
  };
  const zone = (d) => zoneFmt.formatToParts(d).find((x) => x.type === 'timeZoneName')?.value || 'UTC';
  const isToday = (d) => keyFmt.format(d) === keyFmt.format(new Date());

  // Twins of the build's data-t formats in templates.mjs.
  const FORMATS = {
    hm: (d) => clockFmt.format(d),
    hmz: (d) => `${clockFmt.format(d)} ${zone(d)}`,
    clock: (d) => (isToday(d) ? clockFmt.format(d) : shortDay(d)),
    dateline: (d) => `${longDay(d)}, ${clockFmt.format(d)} ${zone(d)}`,
  };

  function localize(root = document) {
    root.querySelectorAll('time[data-t]').forEach((el) => {
      const d = new Date(el.getAttribute('datetime'));
      const f = FORMATS[el.dataset.t];
      if (f && !Number.isNaN(d.getTime())) el.textContent = f(d);
    });
  }

  function dayLabel(d) {
    const k = keyFmt.format(d);
    const now = new Date();
    if (k === keyFmt.format(now)) return 'Today';
    if (k === keyFmt.format(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
    return longDay(d).replace(/ \d{4}$/, '');
  }
  const timeOfEl = (el) => new Date(el.querySelector('time[datetime]')?.getAttribute('datetime') ?? NaN);

  // The build groups stories by UTC day; regroup them by the reader's own day.
  function regroupRiver(section) {
    const briefs = [...section.querySelectorAll(':scope > article.brief')];
    if (!briefs.length) return;
    section.querySelectorAll(':scope > h3.day').forEach((h) => h.remove());
    let last = '';
    for (const a of briefs) {
      const d = timeOfEl(a);
      if (Number.isNaN(d.getTime())) continue;
      const label = dayLabel(d);
      if (label === last) continue;
      const h = document.createElement('h3');
      h.className = 'day';
      h.textContent = label;
      a.before(h);
      last = label;
    }
  }

  function regroupWirePage(page) {
    const items = [...page.querySelectorAll('li.wire-item')];
    if (!items.length) return;
    const frag = document.createDocumentFragment();
    let list = null;
    let last = '';
    for (const li of items) {
      const d = timeOfEl(li);
      const label = Number.isNaN(d.getTime()) ? last : dayLabel(d);
      if (!list || label !== last) {
        const h = document.createElement('h2');
        h.className = 'day';
        h.textContent = label;
        list = document.createElement('ol');
        list.className = 'wire-list wire-list-wide';
        frag.append(h, list);
        last = label;
      }
      list.append(li);
    }
    page.replaceChildren(frag);
  }

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
    document.querySelectorAll('[data-zone]').forEach((el) => (el.textContent = zone(now)));
    document.querySelectorAll('[data-today]').forEach((el) => (el.textContent = longDay(now)));
    document.querySelectorAll('[data-ago]').forEach((el) => (el.textContent = ago(el.dataset.ago)));
  }

  // Same markup as the server's wireItem() template.
  function wireItem(it) {
    const iso = it.publishedAt || it.firstSeen;
    const also = it.also && it.also.length
      ? `<span class="wire-also" title="Also reported by ${esc(it.also.map((a) => a.source).join(', '))}">+${it.also.length}</span>`
      : '';
    return `<li class="wire-item" data-section="${esc(it.section)}" data-tags="${esc((it.tags || []).join(' '))}"><time datetime="${esc(iso)}" data-t="clock">${esc(FORMATS.clock(new Date(iso)))}</time><div class="wire-text"><a class="wire-head" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a><span class="wire-meta"><span class="wire-src">${esc(it.source)}</span>${also}<span class="wire-sec">${esc(sectionsShort[it.section] || it.section)}</span></span></div></li>`;
  }

  async function refreshWire() {
    const lists = document.querySelectorAll('[data-wire-list]');
    if (!lists.length) return;
    const res = await fetch(`${base}data/wire.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const wire = await res.json();
    lists.forEach((list) => {
      const limit = Number(list.dataset.limit || 30);
      const section = list.dataset.section || '';
      const exclude = list.dataset.exclude || '';
      const items = wire.items
        .filter((i) => i.display !== false && (!section || i.section === section || (i.tags || []).includes(section)))
        .filter((i) => !exclude || i.section !== exclude)
        .slice(0, limit);
      if (items.length) list.innerHTML = items.map(wireItem).join('');
    });
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

  // Newsletter sign-up: submit to Kit in the page. Without JavaScript, or if Kit
  // can't be reached this way, the form posts to Kit's own page instead.
  document.querySelectorAll('form[data-signup]').forEach((form) => {
    const status = form.closest('.signup')?.querySelector('[data-signup-status]');
    const say = (text, state) => {
      if (!status) return;
      status.textContent = text;
      status.dataset.state = state;
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = form.querySelector('button');
      button.disabled = true;
      say('Sending…', 'busy');
      try {
        const res = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.status === 'success') {
          form.hidden = true;
          say('Almost there: check your inbox and confirm your email.', 'ok');
          window.goatcounter?.count?.({ path: 'newsletter-signup', title: 'Newsletter sign-up', event: true });
        } else if (data.status === 'quarantined') {
          form.submit(); // Kit wants a human check; its own page handles that
        } else {
          say("That didn't go through. Check the address and try again.", 'error');
        }
      } catch {
        form.submit();
      } finally {
        button.disabled = false;
      }
    });
  });

  localize();
  document.querySelectorAll('section.river:not(.river-solo)').forEach(regroupRiver);
  document.querySelectorAll('.wire-page').forEach(regroupWirePage);
  tick();
  setInterval(tick, 30_000);
  setInterval(poll, 120_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') poll();
  });
})();
