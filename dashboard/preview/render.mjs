// Dev-only preview harness, not needed in Home Assistant.
//
// Renders the real week-planner-card build + skylight-weather-strip with the
// YAML/card-mod/theme from this folder, against a mocked `hass` object, at
// exactly 1280x800 (the Facebook Portal Gen 2 viewport), using Playwright.
//
// Usage:
//   node dashboard/preview/render.mjs <week-planner-card.js> <@mdi/js dir> <out-dir> [scenario]
//     scenario: normal | heavy | empty   (default: normal)
//
// Needs python3 + PyYAML (to read the YAML) and Playwright.

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const dash = path.resolve(here, '..');
const [wpcPath, mdiDir, outDir, scenario = 'normal'] = process.argv.slice(2);
if (!wpcPath || !mdiDir || !outDir) {
  console.error('usage: render.mjs <week-planner-card.js> <@mdi/js dir> <out-dir> [scenario]');
  process.exit(2);
}

const yamlToJson = (file) => JSON.parse(execFileSync('python3', ['-I', '-c',
  'import sys,json,yaml;print(json.dumps(yaml.safe_load(open(sys.argv[1]))))', file]).toString());

const dashboard = yamlToJson(path.join(dash, 'skylight-calendar.yaml'));
const theme = yamlToJson(path.join(dash, 'themes', 'skylight-garden.yaml'))['skylight-garden'];
const stack = dashboard.views[0].cards[0];
const stripCfg = stack.cards[0];
const wpcCfg = stack.cards[1];

// Icon paths for the <ha-icon> stub (in HA these come from the frontend bundle).
const mdi = require(path.join(path.resolve(mdiDir), 'commonjs', 'mdi.js'));
const allText = JSON.stringify(dashboard) + fs.readFileSync(path.join(dash, 'www/skylight/skylight-weather-strip.js'), 'utf8');
const iconNames = new Set([...allText.matchAll(/mdi:[a-z0-9-]+/g)].map((m) => m[0]));
['mdi:close', 'mdi:calendar-account', 'mdi:calendar-clock', 'mdi:map-marker'].forEach((n) => iconNames.add(n));
const icons = {};
for (const n of iconNames) {
  const key = 'mdi' + n.slice(4).split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('');
  if (mdi[key]) icons[n] = mdi[key];
}

const page_html = `<!doctype html><html><head><meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; }
  body { background: var(--lovelace-background); font-family: var(--primary-font-family); color: var(--primary-text-color); }
  #view { display: flex; flex-direction: column; gap: var(--vertical-stack-card-gap, 8px); }
</style></head><body><div id="view"></div>
<script>
  // ---- minimal stand-ins for HA frontend elements ----
  const ICONS = ${JSON.stringify(icons)};
  customElements.define('ha-icon', class extends HTMLElement {
    static get observedAttributes() { return ['icon']; }
    set icon(v) { this.setAttribute('icon', v); }
    connectedCallback() { this._r(); }
    attributeChangedCallback() { this._r(); }
    _r() {
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      const p = ICONS[this.getAttribute('icon')] || '';
      this.shadowRoot.innerHTML = '<style>:host{display:inline-flex;vertical-align:middle;width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px)}svg{width:100%;height:100%;fill:currentColor}</style><svg viewBox="0 0 24 24"><path d="' + p + '"/></svg>';
    }
  });
  customElements.define('ha-card', class extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      this.attachShadow({ mode: 'open' }).innerHTML = '<style>:host{display:block;position:relative;background:var(--ha-card-background,var(--card-background-color,#fff));border-radius:var(--ha-card-border-radius,12px);border:1px solid var(--divider-color);}</style><slot></slot>';
    }
  });
  customElements.define('ha-alert', class extends HTMLElement {});
  customElements.define('ha-icon-button', class extends HTMLElement {});
  customElements.define('ha-dialog', class extends HTMLElement {
    static get observedAttributes() { return ['open']; }
    set open(v) { v ? this.setAttribute('open', '') : this.removeAttribute('open'); }
    get open() { return this.hasAttribute('open'); }
    connectedCallback() {
      if (this.shadowRoot) return;
      this.attachShadow({ mode: 'open' }).innerHTML = '<style>:host{display:none}:host([open]){display:block;position:fixed;inset:200px 340px auto;z-index:9;padding:20px;background:var(--card-background-color);border-radius:var(--ha-dialog-border-radius,12px);box-shadow:0 10px 40px rgba(0,0,0,.3)}</style><slot name="heading"></slot><slot></slot>';
    }
  });
</script>
<script src="/wpc.js"></script>
<script type="module">
  import '/local/skylight/skylight-weather-strip.js';
  const S = window.__SETUP;
  for (const [k, v] of Object.entries(S.theme)) document.documentElement.style.setProperty('--' + k, v);

  // ---- mock data ----
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const at = (d, h, m = 0) => { const x = new Date(day0); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x; };
  const iso = (x) => { const o = -x.getTimezoneOffset(); const s = o >= 0 ? '+' : '-'; const p = (n) => String(Math.abs(n)).padStart(2, '0');
    return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate()) + 'T' + p(x.getHours()) + ':' + p(x.getMinutes()) + ':00' + s + p(Math.trunc(o / 60)) + ':' + p(o % 60); };
  const ymd = (d) => { const x = new Date(day0); x.setDate(x.getDate() + d); return x.toLocaleDateString('en-CA'); };
  const T = (d, h1, m1, h2, m2, summary, location) => ({ start: { dateTime: iso(at(d, h1, m1)) }, end: { dateTime: iso(at(d, h2, m2)) }, summary, location });
  const A = (d1, d2, summary) => ({ start: { date: ymd(d1) }, end: { date: ymd(d2) }, summary });

  const ents = S.wpc.calendars.map((c) => c.entity);
  let EV = {
    [ents[0]]: [T(0, 9, 0, 14, 0, 'Work, studio shift'), T(0, 15, 30, 16, 30, 'Pilates'), T(1, 8, 30, 9, 30, 'Dentist'),
                T(3, 9, 0, 17, 0, 'Office'), T(4, 18, 0, 19, 30, 'Book club at Marieke\\'s'), A(5, 6, 'Mum\\'s birthday'), T(6, 10, 0, 11, 0, 'Brunch')],
    [ents[1]]: [T(0, 7, 30, 8, 15, 'Gym'), T(0, 12, 30, 13, 15, 'Lunch with Sam'), A(2, 4, 'Conference in Rotterdam'),
                T(1, 19, 0, 21, 0, 'Football practice'), T(5, 13, 0, 15, 0, 'Bike repair'), T(6, 14, 0, 15, 0, 'Call grandma')],
    [ents[2]]: [A(0, 1, 'Library books due'), T(0, 15, 0, 16, 0, 'Swimming lesson'), T(1, 14, 30, 15, 15, 'Piano'), T(2, 10, 0, 12, 0, 'Birthday party'),
                T(4, 14, 30, 15, 15, 'Piano'), T(5, 9, 30, 10, 30, 'Hockey match vs. Kampong')],
    [ents[3]]: [T(0, 17, 30, 18, 30, 'Vet appointment for Pepper'), A(3, 4, 'Recycling day'), T(5, 16, 0, 17, 0, 'Haircut'), T(1, 6, 0, 7, 0, 'Early run')],
  };
  if (S.scenario === 'heavy') {
    for (let i = 0; i < 6; i++) EV[ents[i % 4]].push(T(0, 10 + i, 0, 10 + i, 45, 'Extra meeting number ' + (i + 1) + ' with a really quite long title'));
    for (let i = 0; i < 6; i++) EV[ents[i % 4]].push(T(2, 9 + i, 0, 9 + i, 30, 'Errand ' + (i + 1)));
  }
  if (S.scenario === 'empty') EV = {};

  const forecast = ['partlycloudy', 'rainy', 'cloudy', 'sunny', 'pouring', 'partlycloudy', 'snowy-rainy'].map((c, i) => ({
    datetime: iso(at(i, 12)), condition: c, temperature: [9, 8, 7.4, 11, 10, 12, 4][i], templow: [3, 4, 2, 5, 6, 7, -1][i],
    precipitation_probability: [10, 80, 30, 0, 90, 20, 60][i] }));

  const states = {};
  for (const c of S.wpc.calendars) states[c.entity] = { entity_id: c.entity, state: 'off', attributes: { friendly_name: c.name } };
  states[S.strip.entity] = { entity_id: S.strip.entity, state: 'partlycloudy', last_updated: new Date().toISOString(),
    attributes: { temperature: 7.3, temperature_unit: '°C', friendly_name: 'Home' } };

  window.__calls = [];
  const hass = {
    states, language: 'en', locale: { language: 'en', time_format: '24' }, config: { time_zone: tz },
    callApi: async (method, url) => { const ent = url.split('?')[0].split('/')[1]; return EV[ent] || []; },
    callWS: async (msg) => { window.__calls.push(msg);
      if (msg.type === 'call_service' && msg.service === 'get_forecasts') return { context: {}, response: { [S.strip.entity]: { forecast } } };
      throw new Error('unmocked ' + msg.type); },
    formatEntityState: (s, v) => String(v ?? s.state).replace(/partlycloudy/, 'Partly cloudy').replace(/^\\w/, (c) => c.toUpperCase()),
    formatEntityAttributeValue: (s, a) => s.attributes[a], localize: (k) => k.split('.').pop(),
    connection: { subscribeMessage: () => () => {} },
  };

  // ---- build the "panel view" ----
  const view = document.getElementById('view');
  const strip = document.createElement('skylight-weather-strip');
  strip.setConfig(S.strip); view.appendChild(strip); strip.hass = hass;
  await customElements.whenDefined('week-planner-card');
  const card = document.createElement('week-planner-card');
  const { card_mod, type, ...cfg } = S.wpc;
  card.setConfig({ type, ...cfg }); card.hass = hass; view.appendChild(card);
  await card.updateComplete;
  // what card-mod does: a <style> in the card's shadow root
  const st = document.createElement('style'); st.textContent = card_mod.style; card.shadowRoot.appendChild(st);
  window.__strip = strip; window.__hass = hass;
  window.__ready = true;
</script></body></html>`;

const browser = await chromium.launch();
fs.mkdirSync(outDir, { recursive: true });
for (const dpr of [1, 2]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr, timezoneId: 'Europe/Amsterdam', locale: 'en-GB' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('console:', m.text()); });
  await page.route('http://ha.local/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: page_html });
    if (u.pathname === '/wpc.js') return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(wpcPath) });
    if (u.pathname.startsWith('/local/skylight/')) {
      const f = path.join(dash, 'www/skylight', u.pathname.slice('/local/skylight/'.length));
      if (fs.existsSync(f)) return route.fulfill({ path: f, contentType: f.endsWith('.js') ? 'text/javascript' : undefined });
    }
    return route.fulfill({ status: 404, body: 'not found' });
  });
  await page.route(/^(?!http:\/\/ha\.local)/, (route) => { console.error('BLOCKED external request:', route.request().url()); route.abort(); });
  await page.addInitScript((s) => { window.__SETUP = s; }, { theme, wpc: wpcCfg, strip: stripCfg, scenario });
  await page.goto('http://ha.local/');
  await page.waitForFunction(() => window.__ready);
  await page.waitForFunction(() => document.querySelector('week-planner-card').shadowRoot.querySelectorAll('.day').length >= 7);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);

  if (dpr === 1) {
    const m = await page.evaluate(() => {
      const root = document.querySelector('week-planner-card').shadowRoot;
      const card = root.querySelector('ha-card').getBoundingClientRect();
      const strip = document.querySelector('skylight-weather-strip').shadowRoot.querySelector('.strip').getBoundingClientRect();
      const days = [...root.querySelectorAll('.day')].map((d) => ({ cls: d.className, w: Math.round(d.getBoundingClientRect().width),
        overflowY: d.querySelector('.events').scrollHeight > d.querySelector('.events').clientHeight + 1 }));
      const clamped = [...root.querySelectorAll('.event .title')].filter((t) => t.scrollHeight > t.clientHeight + 1).map((t) => t.textContent.trim());
      const timeClipped = [...root.querySelectorAll('.event .time')].filter((t) => t.scrollWidth > t.clientWidth + 1).map((t) => t.textContent.trim().replace(/\s+/g, ' '));
      return { docScroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        strip: [strip.left, strip.top, strip.width, strip.height].map(Math.round),
        card: [card.left, card.top, card.width, card.height].map(Math.round), bottomGap: Math.round(800 - card.bottom),
        days, clamped, timeClipped, font: getComputedStyle(root.querySelector('.day .date')).fontFamily,
        nunitoLoaded: document.fonts.check('700 16px Nunito'), calls: window.__calls.map((c) => c.service) };
    });
    console.log(JSON.stringify(m, null, 1));
  }
  await page.screenshot({ path: path.join(outDir, `${scenario}${dpr === 2 ? '@2x' : ''}.png`) });

  if (dpr === 1 && scenario === 'normal') {
    const ev = page.locator('week-planner-card .day.today .event').nth(1);
    await ev.click();
    await page.waitForTimeout(300);
    const open = await page.evaluate(() => document.querySelector('week-planner-card').shadowRoot.querySelector('ha-dialog')?.open);
    console.log('detail dialog opens on click:', open);
    const kept = await page.evaluate(async () => { const s = window.__strip; s.setConfig({ ...s._config, days: 5 }); s.hass = window.__hass; await new Promise((r) => setTimeout(r, 200)); return s.shadowRoot.querySelectorAll('.tile').length; });
    console.log('forecast tiles after setConfig(days: 5):', kept);
    await page.screenshot({ path: path.join(outDir, 'dialog.png') });
  }
  await ctx.close();
}
await browser.close();
