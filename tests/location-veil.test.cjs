'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const root = path.resolve(__dirname, '..');
const script = name => fs.readFileSync(path.join(root, name), 'utf8');

function memoryStore() {
  const data = Object.create(null);
  const observers = [];
  const local = {
    async get(keys) {
      const selection = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(data);
      return Object.fromEntries(selection.filter(key => Object.hasOwn(data, key)).map(key => [key, structuredClone(data[key])]));
    },
    async set(values) {
      const changes = {};
      for (const [key, value] of Object.entries(values)) {
        changes[key] = {oldValue: data[key] && structuredClone(data[key]), newValue: structuredClone(value)};
        data[key] = structuredClone(value);
      }
      for (const fn of observers) fn(changes, 'local');
    },
    async remove(key) {
      const oldValue = data[key];
      delete data[key];
      for (const fn of observers) fn({[key]: {oldValue, newValue: undefined}}, 'local');
    }
  };
  return {data, local, observers, permissionState: {allowed: false, requestDecision: true, onRemoved: []}};
}
function installBackground(store) {
  const messageListeners = [];
  const browser = {
    storage: {local: store.local, onChanged: {addListener(fn) {store.observers.push(fn);}}},
    runtime: {onMessage: {addListener(fn) {messageListeners.push(fn);}}, onInstalled: {addListener() {}}, onStartup: {addListener() {}}},
    action: {setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {}}
  };
  const context = vm.createContext({browser, crypto: webcrypto, Date, console, Uint32Array});
  vm.runInContext(script('shared.js'), context);
  vm.runInContext(script('background.js'), context);
  return {
    utils: context.LocationVeilUtils,
    send: async message => {
      for (const fn of messageListeners) {const answer = fn(message); if (answer !== undefined) return await answer;}
      throw Error('Unrecognized message');
    }
  };
}
const pos = {coords: {latitude: 34.708, longitude: 135.59, accuracy: 8, altitude: 20, altitudeAccuracy: 2, heading: 14, speed: 3}, timestamp: 1000};

function fakeElement(id) {
  const handlers = Object.create(null);
  const classes = new Set(id === 'fixedPanel' || id === 'siteCard' ? ['hidden'] : []);
  const el = {
    id, handlers, style: {setProperty() {}}, classList: {
      contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name),
      toggle: (name, state) => state ? classes.add(name) : classes.delete(name)
    }, value: '', checked: false, textContent: '', title: '', disabled: false,
    min: '0', max: '100', dataset: {},
    addEventListener(name, fn) {handlers[name] = fn;},
    replaceChildren() {},
    setAttribute() {},
    get clientWidth() {return 0;}, get clientHeight() {return 0;}
  };
  return el;
}
function launchPopup(store, host = 'alpha.example') {
  const elements = Object.create(null);
  const document = {
    getElementById(id) {return elements[id] ||= fakeElement(id);},
    createElement() {throw Error('unexpected map tile initialization');}
  };
  const browser = {
    storage: {local: store.local, onChanged: {addListener(fn) {store.observers.push(fn);}}},
    tabs: {query: async () => [{url: `https://${host}/index.html`}]},
    runtime: {sendMessage: async () => ({ok:true}), getURL: s => s},
    permissions: {
      async getAll() {return {data_collection: store.permissionState.allowed ? ['locationInfo'] : []};},
      async request(value) {
        assert.equal(value.data_collection[0], 'locationInfo');
        const accepted = store.permissionState.requestDecision;
        if (accepted) store.permissionState.allowed = true;
        return accepted;
      },
      onRemoved: {addListener(fn) {store.permissionState.onRemoved.push(fn);}}
    }
  };
  const window = {addEventListener() {}, devicePixelRatio: 1};
  const ctx = vm.createContext({browser, document, window, console, Date, URL, setTimeout, clearTimeout, requestAnimationFrame: () => 0});
  vm.runInContext(script('shared.js'), ctx);
  vm.runInContext(script('popup.js'), ctx);
  return {elements, ctx};
}
const tick = async () => {await new Promise(resolve => setTimeout(resolve, 20));};

test('This Site choices survive popup closure, new popup, and background restart', async () => {
  const store = memoryStore();
  const initial = launchPopup(store, 'alpha.example');
  await tick();
  initial.elements.siteRule.value = 'fixed';
  await initial.elements.siteRule.handlers.change();
  assert.equal(store.data.settings.siteRules['alpha.example'], 'fixed');
  assert.equal(initial.elements.siteSaveStatus.textContent, 'Saved on this device.');
  const reopened = launchPopup(store, 'alpha.example');
  await tick();
  assert.equal(reopened.elements.siteRule.value, 'fixed');
  for (const choice of ['noise', 'real', 'fixed']) {
    reopened.elements.siteRule.value = choice;
    await reopened.elements.siteRule.handlers.change();
    assert.equal(store.data.settings.siteRules['alpha.example'], choice);
    const again = launchPopup(store, 'alpha.example');
    await tick();
    assert.equal(again.elements.siteRule.value, choice);
  }
  const other = launchPopup(store, 'beta.example');
  await tick();
  assert.equal(other.elements.siteRule.value, 'inherit');
  const freshBackground = installBackground(store);
  const b = await freshBackground.send({type: 'lv:transform', hostname: 'beta.example', position: pos});
  assert.equal(b.kind, 'position');
  assert.notEqual(b.position.coords.latitude, pos.coords.latitude);
  reopened.elements.siteRule.value = 'inherit';
  await reopened.elements.siteRule.handlers.change();
  assert.equal(Object.hasOwn(store.data.settings.siteRules, 'alpha.example'), false);
});

test('all 3 per-host modes and global OFF correctly transform valid native geolocation', async () => {
  const store = memoryStore();
  await store.local.set({settings: {enabled: true, mode: 'noise', fixedLocation: {lat: 48.8584, lng: 2.2945}, siteRules: {'fixed.example': 'fixed', 'real.example':'real'}}});
  const {send} = installBackground(store);
  const fixed = await send({type:'lv:transform',hostname:'fixed.example',position:pos});
  assert.equal(fixed.position.coords.latitude, 48.8584);
  assert.ok(Math.abs(fixed.position.coords.longitude - 2.2945) < 1e-9);
  const real = await send({type:'lv:transform',hostname:'real.example',position:pos});
  assert.equal(real.position.coords.latitude, pos.coords.latitude);
  const noise = await send({type:'lv:transform',hostname:'noise.example',position:pos});
  assert.equal(noise.position.coords.altitude, null);
  assert.ok(noise.position.coords.accuracy >= 593);
  await store.local.set({settings: {...store.data.settings, enabled:false}});
  const off = await send({type:'lv:transform',hostname:'fixed.example',position:pos});
  assert.equal(off.position.coords.latitude, pos.coords.latitude);
});

test('simultaneous first noise requests share one cached sample, including after worker re-creation', async () => {
  const store = memoryStore();
  const b1 = installBackground(store);
  const messages = Array.from({length: 15}, () => b1.send({type:'lv:transform',hostname:'alpha.example',position:pos}));
  const results = await Promise.all(messages);
  assert.equal(new Set(results.map(r => `${r.position.coords.latitude},${r.position.coords.longitude}`)).size, 1);
  assert.ok(Number.isFinite(store.data.noiseCache.latitude));
  const b2 = installBackground(store);
  const afterRestart = await b2.send({type:'lv:transform',hostname:'gamma.example',position:pos});
  assert.equal(afterRestart.position.coords.latitude, results[0].position.coords.latitude);
  assert.equal(afterRestart.position.coords.longitude, results[0].position.coords.longitude);
  await b2.send({type:'lv:clearNoiseCache'});
  assert.equal(Object.hasOwn(store.data, 'noiseCache'), false);
});

test('settings are sanitized and bad local modes do not become active', () => {
  const store = memoryStore();
  const b = installBackground(store);
  const s = b.utils.sanitizeSettings({mode:'real', siteRules:{'ExAmPlE.COM.':'fixed','example.net':'javascript:alert(1)'}, cacheMinutes:Infinity});
  assert.equal(s.mode,'noise');
  assert.equal(s.siteRules['example.com'], 'fixed');
  assert.equal(Object.hasOwn(s.siteRules, 'example.net'), false);
  assert.equal(s.mapProvider, 'offline');
});

test('manifest is Firefox MV3, has no remote script loading or excessive API permissions', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.browser_specific_settings.gecko.strict_min_version, '140.0');
  assert.equal(m.browser_specific_settings.gecko.data_collection_permissions.required[0], 'none');
  assert.equal(m.browser_specific_settings.gecko.data_collection_permissions.optional[0], 'locationInfo');
  assert.deepEqual(m.permissions, ['storage', 'activeTab']);
  assert.deepEqual(m.browser_specific_settings.gecko.data_collection_permissions.required, ['none']);
  assert.match(m.content_security_policy.extension_pages, /script-src 'self'/);
  assert.ok(m.content_scripts.some(s => s.world === 'MAIN' && s.run_at === 'document_start'));
  assert.ok(fs.existsSync(path.join(root, 'LICENSE')));
});

test('page shim and isolated bridge: fixed never invokes native geolocation, noise does, watches clear', async () => {
  const store = memoryStore();
  await store.local.set({settings: {enabled: true, mode: 'fixed', fixedNoNativeApi: true, fixedLocation: {lat: 51.5072, lng: -0.1276}}});
  const background = installBackground(store);
  const window = new EventTarget();
  let nativeGets = 0;
  let nativeWatchStarts = 0;
  let nativeWatchClears = 0;
  let watchSuccess = null;
  const native = {
    getCurrentPosition(success) {nativeGets += 1; queueMicrotask(() => success(pos));},
    watchPosition(success) {nativeWatchStarts += 1; watchSuccess = success; return nativeWatchStarts;},
    clearWatch() {nativeWatchClears += 1;}
  };
  const bridgeBrowser = {
    storage: {local: store.local, onChanged: {addListener(fn) {store.observers.push(fn);}}},
    runtime: {sendMessage: background.send}
  };
  const isolated = vm.createContext({navigator: {geolocation: native}, location: {hostname:'alpha.example'},
    browser: bridgeBrowser, window, CustomEvent, console, Date, Promise});
  vm.runInContext(script('shared.js'), isolated);
  vm.runInContext(script('bridge.js'), isolated);
  class Geolocation {}
  const pageGeolocation = new Geolocation();
  const main = vm.createContext({navigator: {geolocation: pageGeolocation}, Geolocation, window, CustomEvent,
    queueMicrotask, console, Date, Promise, Object, Number, String, Map, JSON});
  vm.runInContext(script('page-geolocation.js'), main);

  const request = () => new Promise((resolve, reject) => pageGeolocation.getCurrentPosition(resolve, reject));
  const fake = await request();
  assert.ok(Math.abs(fake.coords.latitude - 51.5072) < 1e-9);
  assert.equal(nativeGets, 0);

  await store.local.set({settings: {...store.data.settings, mode:'noise'}});
  const noisy = await request();
  assert.equal(nativeGets, 1);
  assert.ok(noisy.coords.accuracy >= 593);
  assert.equal(noisy.coords.altitude, null);

  let watcherResult;
  const watchId = pageGeolocation.watchPosition(position => {watcherResult = position;});
  await tick();
  assert.equal(nativeWatchStarts, 1);
  watchSuccess(pos);
  await tick();
  assert.ok(watcherResult.coords.accuracy >= 593);
  pageGeolocation.clearWatch(watchId);
  assert.equal(nativeWatchClears, 1);
});


test('Online maps require opt-in, persist only while permission exists, and return offline when revoked', async () => {
  const store = memoryStore();
  await store.local.set({settings: {mode:'noise',mapProvider:'osm',siteRules:{'alpha.example':'real'}}});
  const initial = launchPopup(store);
  await tick();
  assert.equal(initial.elements.mapProvider.value, 'offline');
  assert.equal(store.data.settings.mapProvider,'offline');
  store.permissionState.requestDecision = false;
  initial.elements.mapProvider.value='osm';
  await initial.elements.mapProvider.handlers.change();
  assert.equal(store.data.settings.mapProvider,'offline');
  assert.equal(initial.elements.mapProvider.value,'offline');
  store.permissionState.requestDecision = true;
  initial.elements.mapProvider.value='topo';
  await initial.elements.mapProvider.handlers.change();
  assert.equal(store.permissionState.allowed, true);
  assert.equal(store.data.settings.mapProvider,'topo');
  const reopened = launchPopup(store);
  await tick();
  assert.equal(reopened.elements.mapProvider.value,'topo');
  store.permissionState.allowed = false;
  for (const listener of store.permissionState.onRemoved) {
    listener({data_collection:['locationInfo']});
  }
  await tick();
  assert.equal(store.data.settings.mapProvider,'offline');
  assert.equal(reopened.elements.mapProvider.value,'offline');
});
