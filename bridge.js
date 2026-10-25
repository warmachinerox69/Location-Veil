(() => {
  'use strict';

  if (!navigator.geolocation) return;

  // Capture native methods before the MAIN-world shim replaces page-visible methods.
  const nativeGetCurrentPosition = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
  const nativeWatchPosition = navigator.geolocation.watchPosition.bind(navigator.geolocation);
  const nativeClearWatch = navigator.geolocation.clearWatch.bind(navigator.geolocation);

  const REQUEST_EVENT = '__location_veil_request_v1';
  const RESPONSE_EVENT = '__location_veil_response_v1';
  const READY_EVENT = '__location_veil_ready_v1';
  const PROBE_EVENT = '__location_veil_probe_v1';
  const SETTINGS_KEY = 'settings';
  const hostname = LocationVeilUtils.normalizeHostname(location.hostname);

  const activeWatches = new Map();
  let settingsCache = null;
  let settingsLoadPromise = null;

  function serializePosition(position) {
    const c = position.coords;
    return {
      coords: {
        latitude: c.latitude,
        longitude: c.longitude,
        accuracy: c.accuracy,
        altitude: c.altitude,
        altitudeAccuracy: c.altitudeAccuracy,
        heading: c.heading,
        speed: c.speed
      },
      timestamp: position.timestamp
    };
  }

  function serializeError(error) {
    return {
      code: Number(error && error.code) || 2,
      message: String(error && error.message ? error.message : 'Position unavailable')
    };
  }

  function respond(detail) {
    window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: JSON.stringify(detail) }));
  }

  async function getSettings() {
    if (settingsCache) return settingsCache;
    if (settingsLoadPromise) return settingsLoadPromise;
    settingsLoadPromise = browser.storage.local.get(SETTINGS_KEY).then((stored) => {
      settingsCache = LocationVeilUtils.sanitizeSettings(stored[SETTINGS_KEY]);
      return settingsCache;
    });
    try {
      return await settingsLoadPromise;
    } finally {
      settingsLoadPromise = null;
    }
  }

  function sameFixedLocation(a, b) {
    if (!a || !b) return a === b;
    return a.lat === b.lat && a.lng === b.lng;
  }

  function watchBehaviorChanged(oldSettings, newSettings) {
    const oldMode = LocationVeilUtils.effectiveMode(oldSettings, hostname);
    const newMode = LocationVeilUtils.effectiveMode(newSettings, hostname);
    if (oldMode !== newMode) return true;
    if (newMode !== 'fixed') return false;
    return oldSettings.fixedNoNativeApi !== newSettings.fixedNoNativeApi ||
      !sameFixedLocation(oldSettings.fixedLocation, newSettings.fixedLocation);
  }

  async function transformNativePosition(position) {
    return browser.runtime.sendMessage({
      type: 'lv:transform',
      hostname,
      position: serializePosition(position)
    });
  }

  function fixedPosition(fixedLocation) {
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

  async function handleGet(data) {
    const settings = await getSettings();
    const mode = LocationVeilUtils.effectiveMode(settings, hostname);

    if (mode === 'fixed' && settings.fixedNoNativeApi) {
      if (!settings.fixedLocation) {
        respond({
          type: 'get',
          requestId: data.requestId,
          kind: 'error',
          error: { code: 2, message: 'Location Veil: choose a fixed location in the extension popup.' }
        });
      } else {
        respond({
          type: 'get',
          requestId: data.requestId,
          kind: 'position',
          position: fixedPosition(settings.fixedLocation)
        });
      }
      return;
    }

    // Noise, Real, and compatibility-mode Fixed all use the native request first.
    // The background transform re-checks current settings when the result arrives.
    nativeGetCurrentPosition(
      async (position) => {
        try {
          const result = await transformNativePosition(position);
          respond({ type: 'get', requestId: data.requestId, ...result });
        } catch (error) {
          respond({
            type: 'get',
            requestId: data.requestId,
            kind: 'error',
            error: { code: 2, message: `Location Veil internal error: ${error.message || error}` }
          });
        }
      },
      (error) => respond({ type: 'get', requestId: data.requestId, kind: 'error', error: serializeError(error) }),
      data.options || {}
    );
  }

  function stopNativeWatch(entry) {
    if (entry.nativeId !== null) {
      try { nativeClearWatch(entry.nativeId); } catch (_) {}
      entry.nativeId = null;
    }
  }

  async function emitFixedWatch(entry, settings, generation) {
    if (!activeWatches.has(String(entry.watchId)) || entry.generation !== generation) return;
    if (!settings.fixedLocation) {
      respond({
        type: 'watch',
        requestId: entry.requestId,
        watchId: entry.watchId,
        kind: 'error',
        error: { code: 2, message: 'Location Veil: choose a fixed location in the extension popup.' }
      });
      return;
    }
    respond({
      type: 'watch',
      requestId: entry.requestId,
      watchId: entry.watchId,
      kind: 'position',
      position: fixedPosition(settings.fixedLocation)
    });
  }

  async function configureWatch(entry) {
    stopNativeWatch(entry);
    entry.generation += 1;
    const generation = entry.generation;
    const settings = await getSettings();
    if (!activeWatches.has(String(entry.watchId)) || entry.generation !== generation) return;
    const mode = LocationVeilUtils.effectiveMode(settings, hostname);

    if (mode === 'fixed') {
      entry.kind = 'fixed';
      if (settings.fixedNoNativeApi) {
        await emitFixedWatch(entry, settings, generation);
        return;
      }

      // Compatibility option: trigger Firefox's normal permission/provider flow,
      // then return the fixed point once. There is no native watch to keep alive.
      nativeGetCurrentPosition(
        async (position) => {
          if (!activeWatches.has(String(entry.watchId)) || entry.generation !== generation) return;
          try {
            const result = await transformNativePosition(position);
            respond({ type: 'watch', requestId: entry.requestId, watchId: entry.watchId, ...result });
          } catch (error) {
            respond({
              type: 'watch', requestId: entry.requestId, watchId: entry.watchId,
              kind: 'error', error: { code: 2, message: `Location Veil internal error: ${error.message || error}` }
            });
          }
        },
        (error) => {
          if (!activeWatches.has(String(entry.watchId)) || entry.generation !== generation) return;
          respond({ type: 'watch', requestId: entry.requestId, watchId: entry.watchId, kind: 'error', error: serializeError(error) });
        },
        entry.options
      );
      return;
    }

    entry.kind = mode;
    entry.nativeId = nativeWatchPosition(
      async (position) => {
        if (!activeWatches.has(String(entry.watchId)) || entry.generation !== generation) return;
        try {
          const result = await transformNativePosition(position);
          respond({
            type: 'watch',
            requestId: entry.requestId,
            watchId: entry.watchId,
            ...result
          });
        } catch (error) {
          respond({
            type: 'watch',
            requestId: entry.requestId,
            watchId: entry.watchId,
            kind: 'error',
            error: { code: 2, message: `Location Veil internal error: ${error.message || error}` }
          });
        }
      },
      (error) => {
        if (!activeWatches.has(String(entry.watchId)) || entry.generation !== generation) return;
        respond({
          type: 'watch',
          requestId: entry.requestId,
          watchId: entry.watchId,
          kind: 'error',
          error: serializeError(error)
        });
      },
      entry.options
    );
  }

  async function handleWatch(data) {
    const entry = {
      requestId: data.requestId,
      watchId: data.watchId,
      options: data.options || {},
      nativeId: null,
      kind: null,
      generation: 0
    };
    activeWatches.set(String(data.watchId), entry);
    await configureWatch(entry);
  }

  function handleClearWatch(data) {
    const key = String(data.watchId);
    const entry = activeWatches.get(key);
    if (!entry) return;
    entry.generation += 1;
    stopNativeWatch(entry);
    activeWatches.delete(key);
  }

  window.addEventListener(REQUEST_EVENT, (event) => {
    let data;
    try { data = JSON.parse(event.detail); } catch (_) { return; }
    if (!data || typeof data !== 'object') return;
    if (data.type === 'get') handleGet(data).catch(() => {});
    else if (data.type === 'watch') handleWatch(data).catch(() => {});
    else if (data.type === 'clearWatch') handleClearWatch(data);
  }, true);

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    const oldSettings = LocationVeilUtils.sanitizeSettings(changes[SETTINGS_KEY].oldValue);
    const newSettings = LocationVeilUtils.sanitizeSettings(changes[SETTINGS_KEY].newValue);
    settingsCache = newSettings;

    // Map view changes and noise-slider edits do not require restarting the
    // browser's native watch. The background transform reads the new noise
    // settings on the next native update; only a behavioral mode/fixed-point
    // change needs a watch reconfiguration.
    if (!watchBehaviorChanged(oldSettings, newSettings)) return;
    for (const entry of activeWatches.values()) configureWatch(entry).catch(() => {});
  });

  window.addEventListener(PROBE_EVENT, () => {
    window.dispatchEvent(new CustomEvent(READY_EVENT));
  }, true);

  window.dispatchEvent(new CustomEvent(READY_EVENT));
})();
