# Location Veil — Firefox extension

Location Veil is a compact Firefox WebExtension for controlling what websites receive through the browser's JavaScript Geolocation API. It is a separately maintained adaptation of the ideas and behavior in [Location Guard](https://github.com/chatziko/location-guard), by Kostas Chatzikokolakis, Marco Stronati, and contributors, with a different UI and Firefox Manifest V3 implementation. This is **not** an official Location Guard release and is not endorsed by its authors. See `THIRD_PARTY_NOTICES.md`, `LICENSE`, and `PRIVACY.md`.

## Protection modes

- **Noise** — uses the site's normal Firefox geolocation request and permission flow, then applies 2-D planar-Laplace noise locally before the result reaches page JavaScript.
- **Fixed** — returns one persistent saved point. By default it does **not** invoke Firefox's native geolocation provider at all.
- **Off** — the master switch passes native geolocation through without adding a fake location.
- **Per-site override** — the popup can make the active hostname use Noise, Fixed, Real location, or follow the global default.

## Noise controls

- Protection ranges from **40 m** to **3000 m**.
- The linked 95% noise radius ranges from **95 m** to **7116 m**.
- The noisy point is cached from **30 minutes** to **13 hours**, in **5-minute increments**.
- **New point** deletes the current cached noisy position.
- The cache stores the already-noised point rather than generating new independent samples on every request. Reusing one noisy sample avoids giving a site many samples that could be averaged toward the true center.
- Cryptographically secure browser randomness (`crypto.getRandomValues`) is used to sample the planar-Laplace distribution.

## Fixed-location map

The map is dependency-free: there is no Leaflet/MapLibre bundle and no remotely executed JavaScript.

Available basemaps:

1. **OSM · Standard** — OSM France raster tiles (optional online basemap).
2. **OSM · Dark** — the same OSM France tiles with a local dark treatment.
3. **OpenTopoMap** — independent OSM-derived raster service.
4. **Offline world** — bundled low-resolution Natural Earth country outlines; no network request. This is the default basemap for new installs.

The bundled Natural Earth layer is always drawn underneath online tiles. If an online tile fails, the bundled world layer remains visible, and the extension does not silently contact a different online tile provider.

The map only loads tiles that are currently visible; there is no bulk download or prefetch feature. Browser HTTP caching is left intact. Attribution is shown on the map.

The chosen fixed pin, map center, zoom, and provider are saved in `browser.storage.local`. Toggling Fixed mode or the whole extension off does not delete the pin. Opening **Fixed location** displays the offline map immediately; use the dropdown above the map to select **OSM · Standard**, **OSM · Dark**, or **OpenTopoMap** for detailed online tiles. Firefox asks for optional permission before any map-provider request. Revoking that permission switches the map back to Offline world.

## Advanced controls

- **Skip native location in Fixed mode** — on by default. This avoids contacting Firefox's native geolocation provider and, like Location Guard's equivalent option, also means the browser's geolocation permission prompt is not needed for the fixed result. Disable it only when a site behaves better after the ordinary permission/provider flow runs first.
- **Protected accuracy is always enforced.** A geolocation result includes an `accuracy` number that tells the site how many metres of uncertainty it should assume. When Location Veil moves the coordinates, it automatically raises that reported uncertainty to at least the matching 95% protection radius instead of leaving Firefox’s original, overly-precise number. There is no switch to disable this because doing so would make the metadata contradict the deliberately blurred position.

## `watchPosition()` behavior

Location Veil handles `getCurrentPosition()`, `watchPosition()`, and `clearWatch()`.

- Noise and Real modes keep a native watch alive, so modern location-aware sites continue receiving updates. During a cache interval, Noise mode returns the same cached fake point.
- Fixed mode returns the fixed point without keeping a native watch alive.
- Changes that alter a site's effective mode or fixed-point behavior reconfigure active watches. Map-view changes and Noise slider edits do not restart the native watch unnecessarily.

This intentionally favors compatibility over Location Guard's older behavior of turning protected watches into a single `getCurrentPosition()` result.

## Install for personal testing

1. Unzip the source folder somewhere permanent.
2. In Firefox, open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on…**.
4. Select this folder's `manifest.json`.
5. Pin **Location Veil** to the toolbar.

Firefox's normal release channel requires Mozilla signing for permanent installation. The packaged `.zip` is unsigned; upload the add-on zip to AMO for validation/signing. You can also load the manifest for temporary testing. No pre-signed `.xpi` is supplied.

## Privacy notes

- Location Veil does **not** hide IP-based location, timezone, locale, account information, or unrelated fingerprinting signals.
- In Noise mode, the real position is handled in the extension's isolated content-script world and sent through local extension messaging for noise generation. Only the final transformed position crosses into page JavaScript.
- In default Fixed mode, native geolocation is not requested at all.
- There is no analytics, telemetry, remote settings service, geocoder, remote font, or remote JavaScript. When an online map provider was explicitly selected *and* Firefox’s optional location-data permission remains granted, tile requests can occur when the Fixed map opens; otherwise only the offline map loads.
- The **Offline world** basemap is the default for new installs and makes no external map requests. Selecting an online basemap (after granting the optional location-data permission) sends map **view area/zoom** to its provider using HTTPS and may reveal the area you are viewing (including a pinned location when you center on it). Previously saved online basemap selections are honored only while the optional location-data permission remains granted. Tile providers receive normal network metadata such as IP address.
- The extension retains settings, site overrides and a **noisy** cached point in `browser.storage.local`. It does **not** synchronize site rules with a cloud service. Site rules remain until you clear them or uninstall the add-on. The stored noisy coordinate may be shared across websites and does not track movement until the cache expires or is cleared.
- `This site` matches the **hostname of the frame making the geolocation request**. Embedded cross-origin frames can have their own rule. Firefox browser-internal/restricted pages cannot be modified, and extensions may not be able to override sites that remove or replace the shim.

## Files

- `bridge.js` — isolated-world bridge; captures native Firefox geolocation methods and enforces effective per-site mode.
- `page-geolocation.js` — MAIN-world Geolocation API shim for `getCurrentPosition`, `watchPosition`, and `clearWatch`.
- `background.js` — planar-Laplace sampling, serialized noise-cache creation, in-memory settings/cache reuse, fixed transform, and toolbar state.
- `popup.html`, `popup.css`, `popup.js` — readable charcoal/periwinkle interface and dependency-free slippy map. The popup uses the local system UI font stack and does not fetch fonts.
- `shared.js` — settings validation, per-site rules, and slider/accuracy math.
- `world-110m.json` — simplified Natural Earth low-resolution country geometry used for the offline fallback map. It is loaded lazily only when the Fixed map is shown, then preprojected once for faster panning.

## License and upstream credit

**Location Veil: MIT License** — see [`LICENSE`](LICENSE). You may use, change, redistribute, and publish the covered code under MIT terms, provided the copyright and permission notices are retained. Location Veil's new contributions are made available under MIT; its inclusion of upstream material uses Location Guard's MIT/X11 option. **Location Veil is not itself advertised as dual-licensed under CeCILL-B.**

**Original project: [Location Guard](https://github.com/chatziko/location-guard)** — [Firefox Add-ons listing](https://addons.mozilla.org/en-US/firefox/addon/location-guard/), by Kostas Chatzikokolakis, Marco Stronati, and contributors. Its authors offer the original work under **MIT/X11 OR CeCILL-B**. Thank you to the original project for the location-obfuscation approach and groundwork. Location Veil is a separately maintained derivative/adaptation and is **not affiliated with or endorsed by** Location Guard or its authors. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for attribution and map-data notices. Where upstream files have original copyright notices, those notices must remain intact.

The bundled world outline is derived from Natural Earth 1:110m data. Natural Earth data is public domain. Online map data/style attribution is displayed in the map UI.

## Publishing and testing

- For AMO, create a ZIP with `manifest.json` at the ZIP root, then upload the ZIP for Mozilla to review and sign. The separate source ZIP with `tests/` is intended for GitHub.
- Host access is broad because the extension must intercept geolocation calls on arbitrary sites. Browser UI should describe this transparently; the extension does not include general webpage scraping. `activeTab` is used to show the current hostname in the popup.
- Test on a current Firefox build: fixed mode without native permission, noise with normal permission, real override, `watchPosition`, nested frames, private browsing (when allowed), and on sites with strict content policies. Some sites resist API shims; do not advertise an absolute privacy guarantee.
- The source includes dependency-free Node.js regression tests: `node --test tests/*.test.cjs`. No build transpilation or remote JavaScript is required.

Please read `RELEASE_REVIEW.md` for the verification scope, known limitations, and a live Firefox pre-publication checklist.
