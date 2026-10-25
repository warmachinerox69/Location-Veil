(() => {
  'use strict';

  const U = LocationVeilUtils;
  const SETTINGS_KEY = 'settings';
  const CACHE_KEY = 'noiseCache';

  const els = {
    enabled: document.getElementById('enabledToggle'),
    statusCard: document.getElementById('statusCard'),
    statusText: document.getElementById('statusText'),
    statusTitle: document.getElementById('statusTitle'),
    statusDetail: document.getElementById('statusDetail'),
    statusPill: document.getElementById('statusPill'),
    siteCard: document.getElementById('siteCard'),
    siteHostname: document.getElementById('siteHostname'),
    siteRule: document.getElementById('siteRule'),
    siteSaveStatus: document.getElementById('siteSaveStatus'),
    noiseMode: document.getElementById('noiseMode'),
    fixedMode: document.getElementById('fixedMode'),
    noisePanel: document.getElementById('noisePanel'),
    fixedPanel: document.getElementById('fixedPanel'),
    protection: document.getElementById('protectionSlider'),
    protectionValue: document.getElementById('protectionValue'),
    accuracyValue: document.getElementById('accuracyValue'),
    privacyHint: document.getElementById('privacyHint'),
    cache: document.getElementById('cacheSlider'),
    cacheValue: document.getElementById('cacheValue'),
    cacheStatus: document.getElementById('cacheStatus'),
    refreshNoise: document.getElementById('refreshNoise'),
    mapProvider: document.getElementById('mapProvider'),
    mapConsentStatus: document.getElementById('mapConsentStatus'),
    map: document.getElementById('map'),
    fallbackMap: document.getElementById('fallbackMap'),
    tileLayer: document.getElementById('tileLayer'),
    mapPin: document.getElementById('mapPin'),
    mapAttribution: document.getElementById('mapAttribution'),
    zoomIn: document.getElementById('zoomIn'),
    zoomOut: document.getElementById('zoomOut'),
    latInput: document.getElementById('latInput'),
    lngInput: document.getElementById('lngInput'),
    fixedHint: document.getElementById('fixedHint'),
    centerPin: document.getElementById('centerPin'),
    fixedNoNativeApi: document.getElementById('fixedNoNativeApi')
  };

  let settings = U.sanitizeSettings();
  // No online tile requests are allowed until the browser's optional permission is confirmed.
  let onlineMapsAllowed = false;
  let currentHostname = '';
  let saveTimer = null;
  let pendingClearCache = false;
  let saveQueue = Promise.resolve();
  let mapFrame = null;
  let worldLoaded = false;
  let worldLoadPromise = null;
  let worldPolygons = [];
  const tileNodes = new Map();
  // Avoid repeatedly retrying missing/blocked tiles on each map redraw.
  const failedTiles = new Set();
  const mapState = {
    center: { ...settings.mapCenter },
    zoom: settings.mapZoom,
    dragging: false,
    dragStart: null,
    centerStartPx: null,
    moved: false
  };

  async function detectCurrentHostname() {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const urlText = tabs && tabs[0] && tabs[0].url;
      if (!urlText) return '';
      const url = new URL(urlText);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return U.normalizeHostname(url.hostname);
    } catch (_) {
      return '';
    }
  }

  function latToUnitY(lat) {
    const clamped = U.clamp(lat, -85.05112878, 85.05112878);
    const sin = Math.sin(clamped * Math.PI / 180);
    return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  }

  function prepareWorldPolygons(geometries) {
    const output = [];
    for (const geometry of geometries || []) {
      if (!geometry || !geometry.coordinates) continue;
      const polygons = geometry.type === 'Polygon'
        ? [geometry.coordinates]
        : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
      for (const polygon of polygons) {
        output.push(polygon.map((ring) => ring.map((point) => [
          (Number(point[0]) + 180) / 360,
          latToUnitY(Number(point[1]))
        ])));
      }
    }
    return output;
  }

  function ensureWorldMapLoaded() {
    if (worldLoaded) return Promise.resolve();
    if (worldLoadPromise) return worldLoadPromise;
    worldLoadPromise = (async () => {
      try {
        const response = await fetch(browser.runtime.getURL('world-110m.json'));
        if (!response.ok) return;
        const data = await response.json();
        if (data && Array.isArray(data.geometries)) worldPolygons = prepareWorldPolygons(data.geometries);
      } catch (_) {
        worldPolygons = [];
      } finally {
        worldLoaded = true;
        worldLoadPromise = null;
      }
    })();
    return worldLoadPromise;
  }

  async function load() {
    const [stored, hostname] = await Promise.all([
      browser.storage.local.get([SETTINGS_KEY, CACHE_KEY]),
      detectCurrentHostname()
    ]);
    settings = U.sanitizeSettings(stored[SETTINGS_KEY]);
    // Check before rendering. Previously stored online choices must never bypass
    // revocation or a new install's optional location-data consent.
    try {
      const granted = await browser.permissions.getAll();
      onlineMapsAllowed = Array.isArray(granted.data_collection) && granted.data_collection.includes('locationInfo');
    } catch (_) {
      onlineMapsAllowed = false;
    }
    if (!onlineMapsAllowed && settings.mapProvider !== 'offline') {
      settings.mapProvider = 'offline';
      await browser.storage.local.set({ [SETTINGS_KEY]: U.sanitizeSettings(settings) });
    }
    currentHostname = hostname;
    mapState.center = { ...settings.mapCenter };
    mapState.zoom = settings.mapZoom;
    renderAll(stored[CACHE_KEY] || null);
    requestMapRender();
  }

  function persistSettings(clearCache) {
    const snapshot = U.sanitizeSettings(settings);
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      await browser.storage.local.set({ [SETTINGS_KEY]: snapshot });
      if (clearCache) {
        await browser.runtime.sendMessage({ type: 'lv:clearNoiseCache' });
        updateCacheStatus(null);
      }
    });
    return saveQueue;
  }

  function scheduleSave({ clearCache = false } = {}) {
    pendingClearCache = pendingClearCache || clearCache;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const shouldClear = pendingClearCache;
      pendingClearCache = false;
      persistSettings(shouldClear).catch(() => {});
    }, 70);
  }

  function saveNow({ clearCache = false } = {}) {
    clearTimeout(saveTimer);
    saveTimer = null;
    const shouldClear = pendingClearCache || clearCache;
    pendingClearCache = false;
    return persistSettings(shouldClear);
  }

  function rangeFill(el) {
    const min = Number(el.min) || 0;
    const max = Number(el.max) || 100;
    const value = Number(el.value);
    const pct = ((value - min) / (max - min)) * 100;
    el.style.setProperty('--range-fill', `${pct}%`);
  }

  function metricMeters(meters) {
    return `${Math.round(meters).toLocaleString()} m`;
  }

  function privacyLabel(protection) {
    if (protection < 120) return 'Precise';
    if (protection < 450) return 'Balanced';
    if (protection < 1200) return 'Strong';
    return 'Maximum';
  }

  function siteOverride() {
    return currentHostname && settings.siteRules ? settings.siteRules[currentHostname] : undefined;
  }

  function renderStatus() {
    els.enabled.checked = settings.enabled;
    els.statusCard.classList.toggle('off', !settings.enabled);
    els.statusCard.classList.remove('real');

    if (!settings.enabled) {
      els.statusPill.textContent = 'OFF';
      els.statusText.textContent = 'Real geolocation passes through';
      els.statusTitle.textContent = 'Protection paused';
      els.statusDetail.textContent = 'Websites receive the browser’s real geolocation.';
      return;
    }

    const mode = U.effectiveMode(settings, currentHostname);
    const override = siteOverride();
    const prefix = override ? 'Site override · ' : '';

    if (mode === 'real') {
      els.statusCard.classList.add('real');
      els.statusPill.textContent = 'REAL';
      els.statusText.textContent = 'Site override active';
      els.statusTitle.textContent = 'Real location allowed';
      els.statusDetail.textContent = currentHostname ? `${currentHostname} receives native geolocation.` : 'Native geolocation passes through.';
      return;
    }

    els.statusPill.textContent = 'ON';
    if (mode === 'fixed') {
      els.statusText.textContent = override ? 'Fixed override active' : 'Fixed location active';
      els.statusTitle.textContent = settings.fixedLocation ? 'Pinned' : 'Choose a point';
      els.statusDetail.textContent = settings.fixedLocation
        ? `${prefix}${settings.fixedLocation.lat.toFixed(4)}, ${settings.fixedLocation.lng.toFixed(4)}`
        : 'Pick a point below before this mode is used.';
    } else {
      els.statusText.textContent = override ? 'Noise override active' : 'Geolocation privacy active';
      els.statusTitle.textContent = 'Protected';
      els.statusDetail.textContent = `${prefix}${U.formatDistance(settings.protectionMeters)} protection.`;
    }
  }

  function renderSite() {
    const available = Boolean(currentHostname);
    els.siteCard.classList.toggle('hidden', !available);
    if (!available) return;
    els.siteHostname.textContent = currentHostname;
    els.siteHostname.title = currentHostname;
    els.siteRule.value = siteOverride() || 'inherit';
  }

  function renderMode() {
    const noiseDefault = settings.mode === 'noise';
    els.noiseMode.classList.toggle('active', noiseDefault);
    els.fixedMode.classList.toggle('active', !noiseDefault);
    els.noiseMode.setAttribute('aria-checked', String(noiseDefault));
    els.fixedMode.setAttribute('aria-checked', String(!noiseDefault));

    // Keep the global settings visible, and also expose the panel needed by an
    // opposite per-site override so a fixed pin/noise level can be edited in place.
    const override = siteOverride();
    const showNoise = settings.mode === 'noise' || override === 'noise';
    const showFixed = settings.mode === 'fixed' || override === 'fixed';
    els.noisePanel.classList.toggle('hidden', !showNoise);
    els.fixedPanel.classList.toggle('hidden', !showFixed);

    if (showFixed) {
      ensureWorldMapLoaded().then(requestMapRender);
      requestAnimationFrame(requestMapRender);
    }
  }

  function renderNoise() {
    const slider = U.sliderFromProtection(settings.protectionMeters);
    els.protection.value = slider;
    els.protectionValue.textContent = metricMeters(settings.protectionMeters);
    els.accuracyValue.textContent = metricMeters(U.accuracyForProtection(settings.protectionMeters));
    els.privacyHint.textContent = privacyLabel(settings.protectionMeters);
    rangeFill(els.protection);

    els.cache.value = settings.cacheMinutes;
    els.cacheValue.textContent = U.formatDuration(settings.cacheMinutes);
    rangeFill(els.cache);
  }

  function renderFixed() {
    els.mapProvider.value = settings.mapProvider;
    if (settings.fixedLocation) {
      els.latInput.value = settings.fixedLocation.lat.toFixed(6);
      els.lngInput.value = settings.fixedLocation.lng.toFixed(6);
      els.fixedHint.textContent = 'Saved until you choose another point.';
      els.centerPin.disabled = false;
    } else {
      els.latInput.value = '';
      els.lngInput.value = '';
      els.fixedHint.textContent = 'No fixed point selected yet.';
      els.centerPin.disabled = true;
    }
    updatePinPosition();
  }

  function renderAdvanced() {
    els.fixedNoNativeApi.checked = settings.fixedNoNativeApi;
  }

  function renderAll(cache) {
    renderStatus();
    renderSite();
    renderMode();
    renderNoise();
    renderFixed();
    renderAdvanced();
    updateCacheStatus(cache);
  }

  async function updateCacheStatus(cacheOverride) {
    let cache = cacheOverride;
    if (cache === undefined) {
      const stored = await browser.storage.local.get(CACHE_KEY);
      cache = stored[CACHE_KEY];
    }
    if (!cache || Number(cache.expiresAt) <= Date.now()) {
      els.cacheStatus.textContent = 'A new noisy point will be generated when needed.';
      return;
    }
    const remainingMin = Math.max(1, Math.ceil((Number(cache.expiresAt) - Date.now()) / 60000));
    els.cacheStatus.textContent = `Current noisy point expires in ${U.formatDuration(remainingMin)}.`;
  }

  function setMode(mode) {
    settings.mode = mode === 'fixed' ? 'fixed' : 'noise';
    renderStatus();
    renderMode();
    saveNow();
  }

  els.enabled.addEventListener('change', () => {
    settings.enabled = els.enabled.checked;
    renderStatus();
    saveNow();
  });
  els.noiseMode.addEventListener('click', () => setMode('noise'));
  els.fixedMode.addEventListener('click', () => setMode('fixed'));

  els.siteRule.addEventListener('change', async () => {
    if (!currentHostname) return;
    settings.siteRules = { ...settings.siteRules };
    const value = els.siteRule.value;
    if (value === 'inherit') delete settings.siteRules[currentHostname];
    else settings.siteRules[currentHostname] = value;
    renderStatus();
    renderMode();
    els.siteSaveStatus.textContent = 'Saving on this device…';
    try {
      // An immediate local-storage write survives closing the popup/restarting Firefox.
      // The status avoids silently claiming success if the write fails.
      await saveNow();
      if (els.siteRule.value === value) els.siteSaveStatus.textContent = 'Saved on this device.';
    } catch (_) {
      if (els.siteRule.value === value) els.siteSaveStatus.textContent = 'Could not save. Please try again.';
    }
  });

  els.protection.addEventListener('input', () => {
    settings.protectionMeters = U.protectionFromSlider(els.protection.value);
    renderNoise();
    renderStatus();
    scheduleSave({ clearCache: true });
  });

  els.cache.addEventListener('input', () => {
    settings.cacheMinutes = Number(els.cache.value);
    renderNoise();
    scheduleSave({ clearCache: true });
  });

  els.refreshNoise.addEventListener('click', async () => {
    await browser.runtime.sendMessage({ type: 'lv:clearNoiseCache' });
    await updateCacheStatus(null);
    const old = els.refreshNoise.textContent;
    els.refreshNoise.textContent = 'Cleared';
    setTimeout(() => { els.refreshNoise.textContent = old; }, 850);
  });

  els.fixedNoNativeApi.addEventListener('change', () => {
    settings.fixedNoNativeApi = els.fixedNoNativeApi.checked;
    saveNow();
  });


  els.mapProvider.addEventListener('change', async () => {
    const selected = els.mapProvider.value;
    const value = ['osm', 'osm-dark', 'topo', 'offline'].includes(selected) ? selected : 'offline';
    if (value !== 'offline' && !onlineMapsAllowed) {
      // This is called directly within the dropdown's user-activation handler.
      // No remote tiles are requested until the user grants the data permission.
      els.mapProvider.disabled = true;
      els.mapConsentStatus.textContent = 'Allow optional location-data sharing to use detailed online maps.';
      try {
        onlineMapsAllowed = await browser.permissions.request({ data_collection: ['locationInfo'] });
      } catch (_) {
        onlineMapsAllowed = false;
      } finally {
        els.mapProvider.disabled = false;
      }
      if (!onlineMapsAllowed) {
        els.mapProvider.value = settings.mapProvider;
        els.mapConsentStatus.textContent = 'Online map permission was not granted. Offline map remains available.';
        return;
      }
    }
    failedTiles.clear();
    settings.mapProvider = value;
    els.mapConsentStatus.textContent = value === 'offline'
      ? 'Offline map selected — no tile-provider requests.'
      : 'Online map enabled. Viewed area and IP address are visible to the tile provider.';
    mapState.zoom = U.clamp(mapState.zoom, U.MAP_ZOOM_MIN, U.MAP_ZOOM_MAX);
    settings.mapZoom = mapState.zoom;
    clearTiles();
    requestMapRender();
    try { await saveNow(); } catch (_) {
      els.mapConsentStatus.textContent = 'Could not save map choice. Please try again.';
    }
  });

  // Honor changes made in Firefox's about:addons permissions UI immediately.
  browser.permissions.onRemoved.addListener((removed) => {
    if (!removed || !Array.isArray(removed.data_collection) || !removed.data_collection.includes('locationInfo')) return;
    onlineMapsAllowed = false;
    if (settings.mapProvider !== 'offline') {
      settings.mapProvider = 'offline';
      els.mapProvider.value = 'offline';
      clearTiles();
      failedTiles.clear();
      requestMapRender();
      saveNow().catch(() => {});
    }
    els.mapConsentStatus.textContent = 'Online map permission revoked. Switched to offline map.';
  });

  function tileUrl(provider, z, x, y) {
    if (provider === 'osm' || provider === 'osm-dark') {
      const sub = ['a', 'b', 'c'][Math.abs(x + y) % 3];
      return `https://${sub}.tile.openstreetmap.fr/osmfr/${z}/${x}/${y}.png`;
    }
    if (provider === 'topo') {
      const sub = ['a', 'b', 'c'][Math.abs(x + y) % 3];
      return `https://${sub}.tile.opentopomap.org/${z}/${x}/${y}.png`;
    }
    return '';
  }

  function setTileAppearance(img, provider) {
    img.dataset.activeProvider = provider;
    img.className = provider === 'osm-dark' ? 'tile dark-map' : 'tile';
  }

  function clearTiles() {
    tileNodes.clear();
    els.tileLayer.replaceChildren();
  }

  function updateAttribution() {
    if (settings.mapProvider === 'offline') {
      els.mapAttribution.textContent = 'Natural Earth · public domain';
      return;
    }
    let usesTopo = settings.mapProvider === 'topo';
    let usesOsmFrance = settings.mapProvider === 'osm' || settings.mapProvider === 'osm-dark';
    for (const img of tileNodes.values()) {
      const active = img.dataset.activeProvider || '';
      if (active === 'topo') usesTopo = true;
      if (active === 'osm' || active === 'osm-dark') usesOsmFrance = true;
    }
    if (usesTopo && usesOsmFrance) {
      els.mapAttribution.textContent = '© OpenStreetMap contributors · OSM France · OpenTopoMap · Natural Earth fallback';
    } else if (usesTopo) {
      els.mapAttribution.textContent = '© OpenStreetMap contributors · SRTM · © OpenTopoMap (CC-BY-SA) · Natural Earth fallback';
    } else {
      els.mapAttribution.textContent = '© OpenStreetMap contributors · rendering OSM France · Natural Earth fallback';
    }
  }

  function worldSize(z) { return 256 * Math.pow(2, z); }

  function lonToX(lng, z) {
    return ((lng + 180) / 360) * worldSize(z);
  }

  function latToY(lat, z) {
    const clamped = U.clamp(lat, -85.05112878, 85.05112878);
    const sin = Math.sin(clamped * Math.PI / 180);
    return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldSize(z);
  }

  function xToLon(x, z) {
    return ((x / worldSize(z)) * 360) - 180;
  }

  function yToLat(y, z) {
    const n = Math.PI - 2 * Math.PI * y / worldSize(z);
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  function normalizeCenter(center, z) {
    const size = worldSize(z);
    let x = lonToX(center.lng, z) % size;
    if (x < 0) x += size;
    const y = U.clamp(latToY(center.lat, z), 0, size);
    return { lat: yToLat(y, z), lng: xToLon(x, z) };
  }

  function drawOfflineBase(width, height) {
    const canvas = els.fallbackMap;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#10131c';
    ctx.fillRect(0, 0, width, height);

    const z = mapState.zoom;
    const size = worldSize(z);
    const centerX = lonToX(mapState.center.lng, z);
    const centerY = latToY(mapState.center.lat, z);

    // Low-contrast geographic grid remains useful even if the bundled outline
    // cannot be loaded for some reason.
    ctx.strokeStyle = 'rgba(154, 166, 255, .08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let lng = -180; lng <= 180; lng += 30) {
      let x = lonToX(lng, z) - centerX;
      while (x > size / 2) x -= size;
      while (x < -size / 2) x += size;
      x += width / 2;
      if (x >= -1 && x <= width + 1) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = latToY(lat, z) - centerY + height / 2;
      if (y >= -1 && y <= height + 1) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
    }
    ctx.stroke();

    if (!worldPolygons.length) return;
    ctx.fillStyle = '#242938';
    ctx.strokeStyle = '#3b4258';
    ctx.lineWidth = Math.max(.55, 1.05 - z * .04);

    for (const polygon of worldPolygons) {
      if (!polygon.length || !polygon[0].length) continue;

      // Coordinates are preprojected to normalized Web Mercator when the
      // offline dataset is loaded, avoiding thousands of trig/log operations
      // on every drag frame.
      const firstRing = polygon[0];
      const unwrappedOuter = [];
      let previousX = null;
      for (const point of firstRing) {
        let x = point[0] * size;
        if (previousX !== null) {
          while (x - previousX > size / 2) x -= size;
          while (x - previousX < -size / 2) x += size;
        }
        previousX = x;
        unwrappedOuter.push([x, point[1] * size]);
      }
      const meanX = unwrappedOuter.reduce((sum, point) => sum + point[0], 0) / unwrappedOuter.length;
      const baseCopy = Math.round((centerX - meanX) / size);

      for (let copyOffset = -1; copyOffset <= 1; copyOffset++) {
        const copy = baseCopy + copyOffset;
        const path = new Path2D();
        let visibleHint = false;

        for (const ring of polygon) {
          let prevX = null;
          let started = false;
          for (const point of ring) {
            let x = point[0] * size;
            if (prevX !== null) {
              while (x - prevX > size / 2) x -= size;
              while (x - prevX < -size / 2) x += size;
            }
            prevX = x;
            const sx = x + copy * size - centerX + width / 2;
            const sy = point[1] * size - centerY + height / 2;
            if (sx > -80 && sx < width + 80 && sy > -80 && sy < height + 80) visibleHint = true;
            if (!started) { path.moveTo(sx, sy); started = true; }
            else path.lineTo(sx, sy);
          }
          if (started) path.closePath();
        }

        if (visibleHint) {
          ctx.fill(path, 'evenodd');
          ctx.stroke(path);
        }
      }
    }
  }

  function renderTiles(width, height) {
    const provider = settings.mapProvider;
    if (provider === 'offline' || !onlineMapsAllowed) {
      clearTiles();
      updateAttribution();
      return;
    }

    const z = mapState.zoom;
    const n = Math.pow(2, z);
    const cx = lonToX(mapState.center.lng, z);
    const cy = latToY(mapState.center.lat, z);
    const left = cx - width / 2;
    const top = cy - height / 2;
    const minTileX = Math.floor(left / 256) - 1;
    const maxTileX = Math.floor((left + width) / 256) + 1;
    const minTileY = Math.max(0, Math.floor(top / 256) - 1);
    const maxTileY = Math.min(n - 1, Math.floor((top + height) / 256) + 1);
    const needed = new Set();

    for (let ty = minTileY; ty <= maxTileY; ty++) {
      for (let tx = minTileX; tx <= maxTileX; tx++) {
        const wrappedX = ((tx % n) + n) % n;
        const key = `${provider}:${z}:${tx}:${ty}`;
        needed.add(key);
        let img = tileNodes.get(key);
        if (!img && !failedTiles.has(key)) {
          img = document.createElement('img');
          img.alt = '';
          img.draggable = false;
          img.decoding = 'async';
          img.loading = 'eager';
          img.dataset.selectedProvider = provider;
          setTileAppearance(img, provider);
          img.referrerPolicy = 'no-referrer';
          img.src = tileUrl(provider, z, wrappedX, ty);
          img.addEventListener('load', updateAttribution);
          img.addEventListener('error', () => {
            // Fail closed to the bundled offline layer. Do not silently send
            // map-view requests to a second external provider.
            failedTiles.add(key);
            tileNodes.delete(key);
            img.remove();
            updateAttribution();
          });
          tileNodes.set(key, img);
          els.tileLayer.appendChild(img);
        }
        img.style.left = `${tx * 256 - left}px`;
        img.style.top = `${ty * 256 - top}px`;
      }
    }

    for (const [key, img] of tileNodes) {
      if (!needed.has(key)) {
        tileNodes.delete(key);
        img.remove();
      }
    }
    updateAttribution();
  }

  function renderMapNow() {
    if (els.fixedPanel.classList.contains('hidden')) return;
    if (!worldLoaded) ensureWorldMapLoaded().then(requestMapRender);
    const width = els.map.clientWidth;
    const height = els.map.clientHeight;
    if (!width || !height) return;
    drawOfflineBase(width, height);
    renderTiles(width, height);
    updatePinPosition();
  }

  function requestMapRender() {
    if (mapFrame !== null) return;
    mapFrame = requestAnimationFrame(() => {
      mapFrame = null;
      renderMapNow();
    });
  }

  function updatePinPosition() {
    const pin = settings.fixedLocation;
    if (!pin || els.fixedPanel.classList.contains('hidden')) {
      els.mapPin.classList.add('hidden');
      return;
    }
    const z = mapState.zoom;
    const size = worldSize(z);
    const centerX = lonToX(mapState.center.lng, z);
    const centerY = latToY(mapState.center.lat, z);
    let dx = lonToX(pin.lng, z) - centerX;
    if (dx > size / 2) dx -= size;
    if (dx < -size / 2) dx += size;
    const dy = latToY(pin.lat, z) - centerY;
    els.mapPin.style.left = `${els.map.clientWidth / 2 + dx}px`;
    els.mapPin.style.top = `${els.map.clientHeight / 2 + dy}px`;
    els.mapPin.classList.remove('hidden');
  }

  function pointToLatLng(clientX, clientY) {
    const rect = els.map.getBoundingClientRect();
    const z = mapState.zoom;
    const centerX = lonToX(mapState.center.lng, z);
    const centerY = latToY(mapState.center.lat, z);
    let wx = centerX + (clientX - rect.left - rect.width / 2);
    let wy = centerY + (clientY - rect.top - rect.height / 2);
    const size = worldSize(z);
    wx = ((wx % size) + size) % size;
    wy = U.clamp(wy, 0, size);
    return { lat: yToLat(wy, z), lng: xToLon(wx, z) };
  }

  function setFixedLocation(point, recenter = false) {
    settings.fixedLocation = U.normalizeFixedLocation(point);
    if (!settings.fixedLocation) return;
    if (recenter) mapState.center = { ...settings.fixedLocation };
    settings.mapCenter = { ...mapState.center };
    renderFixed();
    renderStatus();
    requestMapRender();
    saveNow();
  }

  function setZoom(nextZoom) {
    const clampedZoom = U.clamp(nextZoom, U.MAP_ZOOM_MIN, U.MAP_ZOOM_MAX);
    if (clampedZoom === mapState.zoom) return;
    mapState.zoom = clampedZoom;
    settings.mapZoom = mapState.zoom;
    settings.mapCenter = { ...mapState.center };
    clearTiles();
    requestMapRender();
    scheduleSave();
  }

  els.zoomIn.addEventListener('click', (event) => { event.stopPropagation(); setZoom(mapState.zoom + 1); });
  els.zoomOut.addEventListener('click', (event) => { event.stopPropagation(); setZoom(mapState.zoom - 1); });
  els.map.addEventListener('wheel', (event) => {
    event.preventDefault();
    setZoom(mapState.zoom + (event.deltaY < 0 ? 1 : -1));
  }, { passive: false });

  els.map.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    els.map.setPointerCapture(event.pointerId);
    mapState.dragging = true;
    mapState.moved = false;
    mapState.dragStart = { x: event.clientX, y: event.clientY };
    mapState.centerStartPx = {
      x: lonToX(mapState.center.lng, mapState.zoom),
      y: latToY(mapState.center.lat, mapState.zoom)
    };
    els.map.classList.add('dragging');
  });

  els.map.addEventListener('pointermove', (event) => {
    if (!mapState.dragging) return;
    const dx = event.clientX - mapState.dragStart.x;
    const dy = event.clientY - mapState.dragStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) mapState.moved = true;
    const size = worldSize(mapState.zoom);
    let x = mapState.centerStartPx.x - dx;
    let y = mapState.centerStartPx.y - dy;
    x = ((x % size) + size) % size;
    y = U.clamp(y, 0, size);
    mapState.center = normalizeCenter({ lat: yToLat(y, mapState.zoom), lng: xToLon(x, mapState.zoom) }, mapState.zoom);
    requestMapRender();
  });

  function finishPointer(event) {
    if (!mapState.dragging) return;
    mapState.dragging = false;
    els.map.classList.remove('dragging');
    try { els.map.releasePointerCapture(event.pointerId); } catch (_) {}
    if (!mapState.moved) setFixedLocation(pointToLatLng(event.clientX, event.clientY));
    settings.mapCenter = { ...mapState.center };
    scheduleSave();
  }

  els.map.addEventListener('pointerup', finishPointer);
  els.map.addEventListener('pointercancel', finishPointer);

  function applyCoordinateInputs() {
    if (!els.latInput.value.trim() || !els.lngInput.value.trim()) return;
    const lat = Number(els.latInput.value);
    const lng = Number(els.lngInput.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setFixedLocation({ lat, lng }, true);
  }
  els.latInput.addEventListener('change', applyCoordinateInputs);
  els.lngInput.addEventListener('change', applyCoordinateInputs);

  els.centerPin.addEventListener('click', () => {
    if (!settings.fixedLocation) return;
    mapState.center = { ...settings.fixedLocation };
    settings.mapCenter = { ...mapState.center };
    clearTiles();
    requestMapRender();
    saveNow();
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[CACHE_KEY]) updateCacheStatus(changes[CACHE_KEY].newValue || null);
  });

  window.addEventListener('resize', requestMapRender);
  load().catch((error) => {
    els.statusTitle.textContent = 'Extension error';
    els.statusDetail.textContent = String(error && error.message ? error.message : error);
  });
})();
