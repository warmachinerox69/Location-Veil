(() => {
  'use strict';

  if (!navigator.geolocation || globalThis.__locationVeilInstalled) return;
  Object.defineProperty(globalThis, '__locationVeilInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  const REQUEST_EVENT = '__location_veil_request_v1';
  const RESPONSE_EVENT = '__location_veil_response_v1';
  const READY_EVENT = '__location_veil_ready_v1';
  const PROBE_EVENT = '__location_veil_probe_v1';

  let bridgeReady = false;
  let nextId = 1;
  let nextWatchId = 1;
  const pendingEvents = [];
  const callbacks = new Map();
  const watchCallbacks = new Map();

  function sanitizeOptions(options) {
    if (!options || typeof options !== 'object') return {};
    const output = {};
    if ('enableHighAccuracy' in options) output.enableHighAccuracy = Boolean(options.enableHighAccuracy);
    if ('timeout' in options) {
      const timeout = Number(options.timeout);
      if (Number.isFinite(timeout) && timeout >= 0) output.timeout = timeout;
    }
    if ('maximumAge' in options) {
      const maximumAge = Number(options.maximumAge);
      if (Number.isFinite(maximumAge) && maximumAge >= 0) output.maximumAge = maximumAge;
    }
    return output;
  }

  function send(detail) {
    if (!bridgeReady) {
      pendingEvents.push(detail);
      return;
    }
    window.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: JSON.stringify(detail) }));
  }

  function readonlyInterfaceObject(proto, values) {
    const value = Object.create(proto || Object.prototype);
    for (const [key, item] of Object.entries(values)) {
      Object.defineProperty(value, key, {
        value: item,
        enumerable: true,
        configurable: false,
        writable: false
      });
    }
    return Object.freeze(value);
  }

  function makeCoords(coords) {
    return readonlyInterfaceObject(
      globalThis.GeolocationCoordinates && globalThis.GeolocationCoordinates.prototype,
      {
        latitude: Number(coords.latitude),
        longitude: Number(coords.longitude),
        accuracy: Number(coords.accuracy),
        altitude: coords.altitude == null ? null : Number(coords.altitude),
        altitudeAccuracy: coords.altitudeAccuracy == null ? null : Number(coords.altitudeAccuracy),
        heading: coords.heading == null ? null : Number(coords.heading),
        speed: coords.speed == null ? null : Number(coords.speed)
      }
    );
  }

  function makePosition(position) {
    return readonlyInterfaceObject(
      globalThis.GeolocationPosition && globalThis.GeolocationPosition.prototype,
      {
        coords: makeCoords(position.coords || {}),
        timestamp: Number(position.timestamp) || Date.now()
      }
    );
  }

  function makeError(error) {
    return readonlyInterfaceObject(
      globalThis.GeolocationPositionError && globalThis.GeolocationPositionError.prototype,
      {
        code: Number(error && error.code) || 2,
        message: String(error && error.message ? error.message : 'Position unavailable'),
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3
      }
    );
  }

  function callSafely(fn, arg) {
    if (typeof fn !== 'function') return;
    queueMicrotask(() => fn(arg));
  }

  function getCurrentPosition(success, error, options) {
    if (typeof success !== 'function') {
      throw new TypeError("Geolocation.getCurrentPosition: Argument 1 is not callable.");
    }
    const requestId = `g${nextId++}`;
    callbacks.set(requestId, { success, error });
    send({ type: 'get', requestId, options: sanitizeOptions(options) });
  }

  function watchPosition(success, error, options) {
    if (typeof success !== 'function') {
      throw new TypeError("Geolocation.watchPosition: Argument 1 is not callable.");
    }
    const requestId = `w${nextId++}`;
    const watchId = nextWatchId++;
    watchCallbacks.set(String(watchId), { requestId, success, error });
    send({ type: 'watch', requestId, watchId, options: sanitizeOptions(options) });
    return watchId;
  }

  function clearWatch(watchId) {
    const key = String(Number(watchId));
    if (!watchCallbacks.has(key)) return;
    const entry = watchCallbacks.get(key);
    watchCallbacks.delete(key);
    send({ type: 'clearWatch', requestId: entry.requestId, watchId: Number(watchId) });
  }

  window.addEventListener(READY_EVENT, () => {
    bridgeReady = true;
    while (pendingEvents.length) {
      window.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: JSON.stringify(pendingEvents.shift()) }));
    }
  }, true);

  window.dispatchEvent(new CustomEvent(PROBE_EVENT));

  window.addEventListener(RESPONSE_EVENT, (event) => {
    let data;
    try { data = JSON.parse(event.detail); } catch (_) { return; }
    if (!data || typeof data !== 'object') return;

    if (data.type === 'get') {
      const entry = callbacks.get(data.requestId);
      if (!entry) return;
      callbacks.delete(data.requestId);
      if (data.kind === 'position') callSafely(entry.success, makePosition(data.position));
      else callSafely(entry.error, makeError(data.error));
      return;
    }

    if (data.type === 'watch') {
      const entry = watchCallbacks.get(String(data.watchId));
      if (!entry || entry.requestId !== data.requestId) return;
      if (data.kind === 'position') callSafely(entry.success, makePosition(data.position));
      else callSafely(entry.error, makeError(data.error));
    }
  }, true);

  const proto = globalThis.Geolocation && globalThis.Geolocation.prototype;
  const target = proto || navigator.geolocation;
  try {
    Object.defineProperties(target, {
      getCurrentPosition: { value: getCurrentPosition, configurable: true, writable: true },
      watchPosition: { value: watchPosition, configurable: true, writable: true },
      clearWatch: { value: clearWatch, configurable: true, writable: true }
    });
  } catch (_) {
    navigator.geolocation.getCurrentPosition = getCurrentPosition;
    navigator.geolocation.watchPosition = watchPosition;
    navigator.geolocation.clearWatch = clearWatch;
  }
})();
