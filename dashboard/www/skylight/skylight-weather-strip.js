/*
 * skylight-weather-strip.js
 * ---------------------------------------------------------------------------
 * Install location:  /config/www/skylight/skylight-weather-strip.js
 * Dashboard resource: /local/skylight/skylight-weather-strip.js  (JavaScript module)
 * Card type:          custom:skylight-weather-strip
 *
 * A small, dependency-free Lovelace card that shows a Skylight-style strip:
 * date + clock, the live current conditions, and the daily forecast.
 *
 *  - Forecast comes from the `weather.get_forecasts` action (type: daily),
 *    called through Home Assistant's own WebSocket. No external API calls.
 *  - Icons are HA-native <ha-icon> MDI icons (bundled with the HA frontend).
 *  - Also registers the locally hosted Nunito font (served from
 *    /config/www/skylight/fonts) so the whole dashboard can use it offline.
 *
 * Config:
 *   type: custom:skylight-weather-strip
 *   entity: weather.home        # required
 *   days: 7                     # forecast tiles to show (incl. today)
 *   show_clock: true            # date + time block on the left
 *   refresh_minutes: 30         # forecast refresh interval
 * ---------------------------------------------------------------------------
 */

const VERSION = '1.0.0';

/* ---------- Local font (no Google Fonts, no CDN) ------------------------- */
(() => {
  if (document.getElementById('skylight-nunito-font')) return;
  const base = new URL('./fonts/', import.meta.url).href;
  const faces = [400, 600, 700, 800].map((w) => `
    @font-face {
      font-family: 'Nunito';
      font-style: normal;
      font-weight: ${w};
      font-display: swap;
      src: url('${base}nunito-latin-${w}-normal.woff2') format('woff2');
    }`).join('\n');
  const style = document.createElement('style');
  style.id = 'skylight-nunito-font';
  style.textContent = faces;
  document.head.appendChild(style);
})();

/* ---------- Condition -> HA-native MDI icon + tint ---------------------- */
const ICONS = {
  'clear-night': ['mdi:weather-night', 'night'],
  cloudy: ['mdi:weather-cloudy', 'cloud'],
  exceptional: ['mdi:alert-circle-outline', 'warn'],
  fog: ['mdi:weather-fog', 'cloud'],
  hail: ['mdi:weather-hail', 'rain'],
  lightning: ['mdi:weather-lightning', 'storm'],
  'lightning-rainy': ['mdi:weather-lightning-rainy', 'storm'],
  partlycloudy: ['mdi:weather-partly-cloudy', 'sun'],
  pouring: ['mdi:weather-pouring', 'rain'],
  rainy: ['mdi:weather-rainy', 'rain'],
  snowy: ['mdi:weather-snowy', 'snow'],
  'snowy-rainy': ['mdi:weather-snowy-rainy', 'snow'],
  sunny: ['mdi:weather-sunny', 'sun'],
  windy: ['mdi:weather-windy', 'cloud'],
  'windy-variant': ['mdi:weather-windy-variant', 'cloud'],
};

const iconFor = (condition, isNight = false) => {
  if (isNight && condition === 'partlycloudy') return ['mdi:weather-night-partly-cloudy', 'night'];
  if (isNight && condition === 'sunny') return ICONS['clear-night'];
  return ICONS[condition] || ['mdi:weather-cloudy', 'cloud'];
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

class SkylightWeatherStrip extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._forecast = null;
    this._lastFetch = 0;
    this._lastUpdated = null;
    this._error = null;
  }

  static getStubConfig() {
    return { entity: 'weather.home', days: 7, show_clock: true };
  }

  setConfig(config) {
    if (!config || !config.entity || !String(config.entity).startsWith('weather.')) {
      throw new Error('skylight-weather-strip: set `entity` to a weather.* entity');
    }
    const entityChanged = this._config?.entity !== config.entity;
    this._config = {
      days: 7,
      show_clock: true,
      refresh_minutes: 30,
      ...config,
    };
    if (entityChanged) {
      // New entity: drop the old forecast and fetch again on the next hass update.
      this._forecast = null;
      this._lastFetch = 0;
      this._lastUpdated = null;
      if (this._hass) this._fetchForecast();
    }
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const st = hass?.states?.[this._config?.entity];
    const updated = st?.last_updated;
    // Re-fetch when the weather entity updates (throttled to once a minute).
    if (updated !== this._lastUpdated && Date.now() - this._lastFetch > 60_000) {
      this._lastUpdated = updated;
      this._fetchForecast();
    }
    this._render();
  }

  connectedCallback() {
    this._clockTimer = setInterval(() => this._render(), 15_000);
    this._refreshTimer = setInterval(
      () => this._fetchForecast(),
      Math.max(5, Number(this._config?.refresh_minutes) || 30) * 60_000,
    );
    if (this._hass && !this._forecast) this._fetchForecast();
  }

  disconnectedCallback() {
    clearInterval(this._clockTimer);
    clearInterval(this._refreshTimer);
  }

  getCardSize() {
    return 2;
  }

  getGridOptions() {
    return { columns: 'full', rows: 2 };
  }

  async _fetchForecast() {
    if (!this._hass || !this._config) return;
    this._lastFetch = Date.now();
    const entity = this._config.entity;
    try {
      // weather.get_forecasts (daily), via HA's own WebSocket API.
      const res = await this._hass.callWS({
        type: 'call_service',
        domain: 'weather',
        service: 'get_forecasts',
        service_data: { type: 'daily' },
        target: { entity_id: entity },
        return_response: true,
      });
      this._forecast = res?.response?.[entity]?.forecast ?? [];
      this._error = null;
    } catch (err) {
      this._error = err?.message || err?.code || 'Forecast unavailable';
      console.warn('skylight-weather-strip:', err);
    }
    this._render();
  }

  _lang() {
    return this._hass?.locale?.language || this._hass?.language || navigator.language || 'en';
  }

  _temp(v) {
    return v === undefined || v === null || Number.isNaN(Number(v)) ? '–' : `${Math.round(Number(v))}°`;
  }

  _condText(stateObj, condition) {
    try {
      if (this._hass?.formatEntityState) return this._hass.formatEntityState(stateObj, condition);
    } catch (_) { /* fall through */ }
    return String(condition || '').replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  }

  _render() {
    if (!this._config) return;
    const hass = this._hass;
    const stateObj = hass?.states?.[this._config.entity];
    const lang = this._lang();
    const now = new Date();
    const timeZone = hass?.config?.time_zone;
    const tzOpt = timeZone ? { timeZone } : {};

    /* -- clock -- */
    let clock = '';
    if (this._config.show_clock) {
      const hour12 = hass?.locale?.time_format === '12' ? true
        : hass?.locale?.time_format === '24' ? false : undefined;
      const time = new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit', hour12, ...tzOpt }).format(now);
      const wd = new Intl.DateTimeFormat(lang, { weekday: 'long', ...tzOpt }).format(now);
      const date = new Intl.DateTimeFormat(lang, { month: 'long', day: 'numeric', ...tzOpt }).format(now);
      clock = `
        <div class="clock">
          <div class="time">${esc(time)}</div>
          <div class="date"><span class="wd">${esc(wd)}</span>, ${esc(date)}</div>
        </div>`;
    }

    /* -- current conditions -- */
    let current = '';
    if (!stateObj) {
      current = `<div class="current missing">Weather entity <b>${esc(this._config.entity)}</b> not found</div>`;
    } else {
      const cond = stateObj.state;
      const [icon, tint] = iconFor(cond, false);
      const unit = stateObj.attributes?.temperature_unit || '';
      const today = (this._forecast || [])[0];
      const hiLo = today
        ? `<span class="hi">H ${this._temp(today.temperature)}</span><span class="lo">L ${this._temp(today.templow)}</span>`
        : '';
      current = `
        <div class="current">
          <ha-icon class="cond-icon tint-${tint}" icon="${icon}"></ha-icon>
          <div class="cur-text">
            <div class="cur-temp">${this._temp(stateObj.attributes?.temperature)}<span class="unit">${esc(unit.replace('°', ''))}</span></div>
            <div class="cur-cond">${esc(this._condText(stateObj, cond))}</div>
            <div class="cur-hilo">${hiLo}</div>
          </div>
        </div>`;
    }

    /* -- daily forecast -- */
    const days = Math.max(1, Number(this._config.days) || 7);
    const fc = (this._forecast || [])
      .filter((f) => f.is_daytime !== false)
      .slice(0, days);
    const todayKey = new Intl.DateTimeFormat('en-CA', { ...tzOpt }).format(now);
    const tiles = fc.map((f) => {
      const d = new Date(f.datetime);
      const key = new Intl.DateTimeFormat('en-CA', { ...tzOpt }).format(d);
      const isToday = key === todayKey;
      const label = isToday ? 'Today' : new Intl.DateTimeFormat(lang, { weekday: 'short', ...tzOpt }).format(d);
      const [icon, tint] = iconFor(f.condition);
      const pop = Number(f.precipitation_probability);
      return `
        <div class="tile${isToday ? ' today' : ''}" title="${esc(this._condText(stateObj, f.condition))}">
          <div class="t-day">${esc(label)}</div>
          <ha-icon class="t-icon tint-${tint}" icon="${icon}"></ha-icon>
          <div class="t-temps"><span class="hi">${this._temp(f.temperature)}</span><span class="lo">${this._temp(f.templow)}</span></div>
          ${pop >= 20 ? `<div class="t-pop"><ha-icon icon="mdi:water-outline"></ha-icon>${Math.round(pop)}%</div>` : ''}
        </div>`;
    }).join('');

    const forecast = fc.length
      ? `<div class="forecast">${tiles}</div>`
      : `<div class="forecast empty">${this._error ? `Forecast unavailable (${esc(this._error)})` : 'Loading forecast…'}</div>`;

    this.shadowRoot.innerHTML = `
      <style>${SkylightWeatherStrip.styles}</style>
      <div class="strip">
        ${clock}
        ${current}
        ${forecast}
      </div>`;

    // Tap anywhere on the strip -> HA's more-info dialog for the weather entity.
    this.shadowRoot.querySelector('.strip').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('hass-more-info', {
        detail: { entityId: this._config.entity },
        bubbles: true,
        composed: true,
      }));
    });
  }

  static get styles() {
    return `
      :host {
        display: block;
        font-family: var(--skylight-font, 'Nunito', system-ui, sans-serif);
        color: var(--skylight-ink, #2f2a24);
      }
      .strip {
        box-sizing: border-box;
        height: var(--skylight-strip-height, 104px);
        margin: var(--skylight-strip-margin, 14px 40px 12px);
        padding: 0 22px;
        display: flex;
        align-items: center;
        gap: 22px;
        background: var(--skylight-panel-bg, rgba(250, 246, 236, 0.74));
        -webkit-backdrop-filter: blur(var(--skylight-panel-blur, 6px));
        backdrop-filter: blur(var(--skylight-panel-blur, 6px));
        border-radius: var(--skylight-panel-radius, 22px);
        box-shadow: 0 6px 24px rgba(80, 64, 40, 0.12);
        cursor: pointer;
        overflow: hidden;
      }
      .clock { flex: 0 0 auto; min-width: 170px; }
      .clock .time { font-size: 40px; font-weight: 800; line-height: 1; letter-spacing: -0.5px; }
      .clock .date { margin-top: 6px; font-size: 15px; font-weight: 600; color: var(--skylight-ink-soft, #6b5f52); white-space: nowrap; }
      .clock .wd { color: var(--skylight-accent, #c4623f); font-weight: 800; }

      .current {
        flex: 0 0 auto;
        display: flex; align-items: center; gap: 12px;
        padding-left: 22px;
        border-left: 1.5px solid var(--skylight-rule, rgba(107, 95, 82, 0.22));
        height: 70px;
      }
      .current.missing { font-size: 14px; }
      .cond-icon { --mdc-icon-size: 54px; width: 54px; height: 54px; }
      .cur-temp { font-size: 36px; font-weight: 800; line-height: 1; }
      .cur-temp .unit { font-size: 16px; font-weight: 700; vertical-align: top; margin-left: 1px; color: var(--skylight-ink-soft, #6b5f52); }
      .cur-cond { font-size: 14px; font-weight: 700; margin-top: 3px; white-space: nowrap; }
      .cur-hilo { font-size: 13px; font-weight: 600; color: var(--skylight-ink-soft, #6b5f52); display: flex; gap: 8px; }

      .forecast {
        flex: 1 1 auto;
        display: flex; justify-content: space-between; gap: 6px;
        padding-left: 18px;
        border-left: 1.5px solid var(--skylight-rule, rgba(107, 95, 82, 0.22));
        min-width: 0;
      }
      .forecast.empty { font-size: 14px; color: var(--skylight-ink-soft, #6b5f52); align-items: center; height: 70px; }
      .tile {
        flex: 1 1 0; min-width: 0;
        display: flex; flex-direction: column; align-items: center;
        padding: 6px 2px; border-radius: 14px;
      }
      .tile.today { background: rgba(255, 255, 255, 0.55); }
      .t-day { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: var(--skylight-ink-soft, #6b5f52); }
      .tile.today .t-day { color: var(--skylight-accent, #c4623f); }
      .t-icon { --mdc-icon-size: 30px; width: 30px; height: 30px; margin: 3px 0 2px; }
      .t-temps { font-size: 15px; font-weight: 800; display: flex; gap: 6px; }
      .t-temps .lo, .cur-hilo .lo { color: var(--skylight-ink-faint, #8d8173); font-weight: 600; }
      .t-pop { font-size: 11px; font-weight: 700; color: #5d8199; display: flex; align-items: center; --mdc-icon-size: 12px; }

      .tint-sun   { color: #e0a032; }
      .tint-cloud { color: #8a9a86; }
      .tint-rain  { color: #5d8199; }
      .tint-storm { color: #7a6a8f; }
      .tint-snow  { color: #8fb3c9; }
      .tint-night { color: #7c6f9a; }
      .tint-warn  { color: #c4623f; }
    `;
  }
}

if (!customElements.get('skylight-weather-strip')) {
  customElements.define('skylight-weather-strip', SkylightWeatherStrip);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'skylight-weather-strip',
    name: 'Skylight Weather Strip',
    description: 'Clock, current conditions and daily forecast (weather.get_forecasts), HA-native icons only.',
  });
  console.info(`%c SKYLIGHT-WEATHER-STRIP %c v${VERSION} `, 'background:#c4623f;color:#fff', 'background:#9db98a;color:#2f2a24');
}
