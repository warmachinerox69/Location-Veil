(() => {
  'use strict';

  const DEFAULTS = Object.freeze({
    enabled: true,
    mode: 'noise',
    protectionMeters: 250,
    cacheMinutes: 60,
    fixedLocation: null,
    fixedNoNativeApi: true,
    siteRules: {},
    mapProvider: 'offline',
    mapZoom: 3,
    mapCenter: { lat: 20, lng: 0 }
  });

  const PROTECTION_MIN = 40;
  const PROTECTION_MAX = 3000;
  const ACCURACY_RATIO = 2.372;
  const CACHE_MIN = 30;
  const CACHE_MAX = 13 * 60;
  const CACHE_STEP = 5;
  const MAP_ZOOM_MIN = 1;
  const MAP_ZOOM_MAX = 17;
  const SITE_MODES = new Set(['real', 'noise', 'fixed']);
  const MAP_PROVIDERS = new Set(['osm-dark', 'osm', 'topo', 'offline']);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function accuracyForProtection(meters) {
    return Math.round(clamp(Number(meters) || PROTECTION_MIN, PROTECTION_MIN, PROTECTION_MAX) * ACCURACY_RATIO);
  }

  function protectionFromSlider(value) {
    const t = clamp(Number(value) || 0, 0, 100) / 100;
    const raw = PROTECTION_MIN * Math.pow(PROTECTION_MAX / PROTECTION_MIN, t);
    let step = 5;
    if (raw >= 1500) step = 50;
    else if (raw >= 500) step = 25;
    else if (raw >= 100) step = 10;
    const rounded = Math.round(raw / step) * step;
    return clamp(rounded, PROTECTION_MIN, PROTECTION_MAX);
  }

  function sliderFromProtection(meters) {
    const p = clamp(Number(meters) || PROTECTION_MIN, PROTECTION_MIN, PROTECTION_MAX);
    return Math.round(100 * Math.log(p / PROTECTION_MIN) / Math.log(PROTECTION_MAX / PROTECTION_MIN));
  }

  function normalizeFixedLocation(value) {
    if (!value || !Number.isFinite(Number(value.lat)) || !Number.isFinite(Number(value.lng))) return null;
    return {
      lat: clamp(Number(value.lat), -85.05112878, 85.05112878),
      lng: ((Number(value.lng) + 540) % 360) - 180
    };
  }

  function normalizeHostname(value) {
    const host = String(value || '').trim().toLowerCase().replace(/\.$/, '');
    if (!host || host.length > 253 || /[\s/]/.test(host)) return '';
    return host;
  }

  function sanitizeSiteRules(value) {
    const output = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
    for (const [rawHost, rawMode] of Object.entries(value)) {
      const host = normalizeHostname(rawHost);
      if (host && SITE_MODES.has(rawMode)) output[host] = rawMode;
    }
    return output;
  }

  function sanitizeSettings(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const fixedLocation = normalizeFixedLocation(input.fixedLocation);
    const mapCenter = normalizeFixedLocation(input.mapCenter) || DEFAULTS.mapCenter;
    const cacheRaw = Number(input.cacheMinutes);
    const cacheMinutes = clamp(
      Math.round((Number.isFinite(cacheRaw) ? cacheRaw : DEFAULTS.cacheMinutes) / CACHE_STEP) * CACHE_STEP,
      CACHE_MIN,
      CACHE_MAX
    );
    let mapProvider = MAP_PROVIDERS.has(input.mapProvider) ? input.mapProvider : DEFAULTS.mapProvider;
    // Older builds used CARTO and the OSMF standard tile host. Keep the saved
    // provider ids; current builds route the OSM views through OSM France instead.
    if (input.mapProvider === 'carto') mapProvider = 'osm-dark';

    return {
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : DEFAULTS.enabled,
      mode: input.mode === 'fixed' ? 'fixed' : 'noise',
      protectionMeters: clamp(Math.round(Number(input.protectionMeters) || DEFAULTS.protectionMeters), PROTECTION_MIN, PROTECTION_MAX),
      cacheMinutes,
      fixedLocation,
      fixedNoNativeApi: input.fixedNoNativeApi !== undefined ? Boolean(input.fixedNoNativeApi) : DEFAULTS.fixedNoNativeApi,
      siteRules: sanitizeSiteRules(input.siteRules),
      mapProvider,
      mapZoom: clamp(Math.round(Number(input.mapZoom) || DEFAULTS.mapZoom), MAP_ZOOM_MIN, MAP_ZOOM_MAX),
      mapCenter
    };
  }

  function effectiveMode(settings, hostname) {
    if (!settings.enabled) return 'real';
    const host = normalizeHostname(hostname);
    if (host && SITE_MODES.has(settings.siteRules && settings.siteRules[host])) return settings.siteRules[host];
    return settings.mode;
  }

  function formatDistance(meters) {
    if (meters >= 1000) {
      const km = meters / 1000;
      return `${km >= 10 ? km.toFixed(1) : km.toFixed(2)} km`;
    }
    return `${Math.round(meters)} m`;
  }

  function formatDuration(minutes) {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (!remainder) return `${hours} hr${hours === 1 ? '' : 's'}`;
    return `${hours}h ${remainder}m`;
  }

  globalThis.LocationVeilUtils = Object.freeze({
    DEFAULTS,
    PROTECTION_MIN,
    PROTECTION_MAX,
    ACCURACY_RATIO,
    CACHE_MIN,
    CACHE_MAX,
    CACHE_STEP,
    MAP_ZOOM_MIN,
    MAP_ZOOM_MAX,
    clamp,
    accuracyForProtection,
    protectionFromSlider,
    sliderFromProtection,
    normalizeFixedLocation,
    normalizeHostname,
    sanitizeSiteRules,
    sanitizeSettings,
    effectiveMode,
    formatDistance,
    formatDuration
  });
})();
