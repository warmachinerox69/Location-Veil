(() => {
  'use strict';

  const U = globalThis.LocationVeilUtils;
  const SETTINGS_KEY = 'settings';
  const CACHE_KEY = 'noiseCache';

  let settingsCache = null;
  let settingsLoadPromise = null;
  let noiseCacheLoaded = false;
  let noiseCacheLoadPromise = null;
  let noiseCacheMemory = null;
  let noiseCacheQueue = Promise.resolve();

  async function getSettings() {
    if (settingsCache) return settingsCache;
    if (settingsLoadPromise) return settingsLoadPromise;
    settingsLoadPromise = (async () => {
      const stored = await browser.storage.local.get(SETTINGS_KEY);
      settingsCache = U.sanitizeSettings(stored[SETTINGS_KEY]);
      if (!stored[SETTINGS_KEY]) await browser.storage.local.set({ [SETTINGS_KEY]: settingsCache });
      return settingsCache;
    })();
    try {
      return await settingsLoadPromise;
    } finally {
      settingsLoadPromise = null;
    }
  }

  async function getNoiseCache() {
    if (noiseCacheLoaded) return noiseCacheMemory;
    if (noiseCacheLoadPromise) return noiseCacheLoadPromise;
    noiseCacheLoadPromise = (async () => {
      const stored = await browser.storage.local.get(CACHE_KEY);
      noiseCacheMemory = stored[CACHE_KEY] || null;
      noiseCacheLoaded = true;
      return noiseCacheMemory;
    })();
    try {
      return await noiseCacheLoadPromise;
    } finally {
      noiseCacheLoadPromise = null;
    }
  }

  async function setNoiseCache(cache) {
    noiseCacheMemory = cache;
    noiseCacheLoaded = true;
    await browser.storage.local.set({ [CACHE_KEY]: cache });
  }

  async function clearNoiseCache() {
    let releaseQueue;
    const previous = noiseCacheQueue;
    noiseCacheQueue = new Promise((resolve) => { releaseQueue = resolve; });
    await previous;
    try {
      noiseCacheMemory = null;
      noiseCacheLoaded = true;
      await browser.storage.local.remove(CACHE_KEY);
    } finally {
      releaseQueue();
    }
  }

  function randomOpen01() {
    const data = new Uint32Array(1);
    crypto.getRandomValues(data);
    return (data[0] + 1) / 4294967297;
  }

  function destinationPoint(latDeg, lngDeg, distanceMeters, bearingRadians) {
    // Match Location Guard's WGS84-equatorial radius.
    const earthRadius = 6378137;
    const angular = distanceMeters / earthRadius;
    const lat1 = latDeg * Math.PI / 180;
    const lon1 = lngDeg * Math.PI / 180;

    const sinLat1 = Math.sin(lat1);
    const cosLat1 = Math.cos(lat1);
    const sinAngular = Math.sin(angular);
    const cosAngular = Math.cos(angular);

    const lat2 = Math.asin(
      sinLat1 * cosAngular + cosLat1 * sinAngular * Math.cos(bearingRadians)
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(bearingRadians) * sinAngular * cosLat1,
      cosAngular - sinLat1 * Math.sin(lat2)
    );

    return {
      lat: lat2 * 180 / Math.PI,
      lng: ((lon2 * 180 / Math.PI + 540) % 360) - 180
    };
  }

  function samplePlanarLaplace(baseLat, baseLng, protectionMeters) {
    // Radial planar-Laplace noise is Gamma(shape=2, rate=epsilon).
    // Summing two exponential samples is exactly that Gamma distribution.
    // epsilon = 2 / protection makes expected radial error = protection.
    const epsilon = 2 / protectionMeters;
    const distance = (-Math.log(randomOpen01()) - Math.log(randomOpen01())) / epsilon;
    const bearing = randomOpen01() * Math.PI * 2;
    return destinationPoint(baseLat, baseLng, distance, bearing);
  }

  function normalizePosition(position) {
    const coords = position && position.coords ? position.coords : {};
    return {
      coords: {
        latitude: Number(coords.latitude),
        longitude: Number(coords.longitude),
        accuracy: Number.isFinite(Number(coords.accuracy)) ? Number(coords.accuracy) : 0,
        altitude: Number.isFinite(Number(coords.altitude)) ? Number(coords.altitude) : null,
        altitudeAccuracy: Number.isFinite(Number(coords.altitudeAccuracy)) ? Number(coords.altitudeAccuracy) : null,
        heading: Number.isFinite(Number(coords.heading)) ? Number(coords.heading) : null,
        speed: Number.isFinite(Number(coords.speed)) ? Number(coords.speed) : null
      },
      timestamp: Number(position && position.timestamp) || Date.now()
    };
  }

  function makeFixedPosition(fixedLocation) {
    return {
      coords: {
        latitude: fixedLocation.lat,
        longitude: fixedLocation.lng,
        accuracy: 10,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null
      },
      timestamp: Date.now()
    };
  }

  function validNoiseCache(cache, settings, now = Date.now()) {
    return Boolean(cache) &&
      Number(cache.expiresAt) > now &&
      Number(cache.protectionMeters) === settings.protectionMeters &&
      Number(cache.cacheMinutes) === settings.cacheMinutes &&
      Number.isFinite(Number(cache.latitude)) &&
      Number.isFinite(Number(cache.longitude)) &&
      Number.isFinite(Number(cache.generatedAt));
  }

  function sampleFromCache(cache) {
    return {
      noisy: { lat: Number(cache.latitude), lng: Number(cache.longitude) },
      generatedAt: Number(cache.generatedAt),
      expiresAt: Number(cache.expiresAt)
    };
  }

  async function getOrCreateNoiseSample(position, settings) {
    let cache = await getNoiseCache();
    if (validNoiseCache(cache, settings)) return sampleFromCache(cache);

    // Serialize cache creation. Without this, simultaneous first requests could
    // each generate a different noisy point before the storage write completes,
    // giving a site multiple independent samples that are easier to average.
    let releaseQueue;
    const previous = noiseCacheQueue;
    noiseCacheQueue = new Promise((resolve) => { releaseQueue = resolve; });
    await previous;

    try {
      cache = await getNoiseCache();
      if (validNoiseCache(cache, settings)) return sampleFromCache(cache);

      const generatedAt = Date.now();
      const noisy = samplePlanarLaplace(
        position.coords.latitude,
        position.coords.longitude,
        settings.protectionMeters
      );
      const expiresAt = generatedAt + settings.cacheMinutes * 60 * 1000;
      const nextCache = {
        latitude: noisy.lat,
        longitude: noisy.lng,
        generatedAt,
        expiresAt,
        protectionMeters: settings.protectionMeters,
        cacheMinutes: settings.cacheMinutes
      };
      await setNoiseCache(nextCache);
      return { noisy, generatedAt, expiresAt };
    } finally {
      releaseQueue();
    }
  }

  async function transformPosition(rawPosition, hostname) {
    const settings = await getSettings();
    const position = normalizePosition(rawPosition);
    const mode = U.effectiveMode(settings, hostname);

    if (mode === 'real') return { kind: 'position', position };

    if (mode === 'fixed') {
      if (!settings.fixedLocation) {
        return {
          kind: 'error',
          error: { code: 2, message: 'Location Veil: choose a fixed location in the extension popup.' }
        };
      }
      return { kind: 'position', position: makeFixedPosition(settings.fixedLocation) };
    }

    const { noisy, generatedAt, expiresAt } = await getOrCreateNoiseSample(position, settings);

    // A deliberately displaced coordinate should never advertise Firefox's
    // original metre-level precision. Keep the 95% accuracy metadata aligned
    // with the protection radius unconditionally.
    const accuracy = Math.max(
      position.coords.accuracy || 0,
      U.accuracyForProtection(settings.protectionMeters)
    );

    return {
      kind: 'position',
      position: {
        coords: {
          latitude: noisy.lat,
          longitude: noisy.lng,
          accuracy,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null
        },
        // Reuse the sample timestamp together with the cached point. This makes
        // repeated cache hits behave like one cached geolocation sample.
        timestamp: generatedAt
      },
      cache: { generatedAt, expiresAt }
    };
  }

  async function updateActionState(settingsOverride) {
    const settings = settingsOverride || await getSettings();
    await browser.action.setBadgeText({ text: settings.enabled ? '' : 'OFF' });
    if (!settings.enabled) await browser.action.setBadgeBackgroundColor({ color: '#565a69' });
    await browser.action.setTitle({
      title: settings.enabled
        ? `Location Veil: ${settings.mode === 'fixed' ? 'Fixed location' : 'Noise protection'} default`
        : 'Location Veil: Off (real geolocation)'
    });
  }

  browser.runtime.onInstalled.addListener(async () => {
    const settings = await getSettings();
    await updateActionState(settings);
  });

  browser.runtime.onStartup.addListener(() => {
    updateActionState().catch(() => {});
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes[SETTINGS_KEY]) {
      const oldSettings = U.sanitizeSettings(changes[SETTINGS_KEY].oldValue);
      settingsCache = U.sanitizeSettings(changes[SETTINGS_KEY].newValue);
      if (oldSettings.enabled !== settingsCache.enabled || oldSettings.mode !== settingsCache.mode) {
        updateActionState(settingsCache).catch(() => {});
      }
    }

    if (changes[CACHE_KEY]) {
      noiseCacheMemory = changes[CACHE_KEY].newValue || null;
      noiseCacheLoaded = true;
    }
  });

  browser.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return undefined;

    if (message.type === 'lv:transform') return transformPosition(message.position, message.hostname);
    if (message.type === 'lv:clearNoiseCache') {
      return clearNoiseCache().then(() => ({ ok: true }));
    }
    return undefined;
  });
})();
