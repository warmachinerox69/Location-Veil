# Current release note: v1.4.4

This version changes the README and release copy, removes em dashes from two extension status messages, and keeps the runtime behavior from v1.4.3. The historical review below covers v1.4.3. Live Firefox testing and Mozilla review are still required.

# Location Veil v1.4.3 release review

Reviewed: 2026-10-25. This is a scoped source-level and simulated-runtime audit of the archive supplied for review, not a guarantee of security, a pen-test of Firefox, a live Firefox UI test, or Mozilla approval.

## UI refinements in v1.4.3

- Removed the explanatory Accuracy paragraph and the in-popup Location Guard license/credit footer. Upstream credit and licensing remain in the shipped `LICENSE`, `README.md`, and `THIRD_PARTY_NOTICES.md`, and the Firefox Add-ons listing should also carry acknowledgment.
- Displayed the bundled PNG extension icon directly in the popup header instead of relying on a CSS SVG background.
- Set the minimum declared popup font size to 11px, raising “Changes stay on this device.” from 10px to 11px and all previously smaller text to 11px.

## Results

- **Local per-site settings:** Confirmed. In the popup's `change` handler, each selected Noise / Fixed / Real mode is written immediately through `saveNow()` to `browser.storage.local.settings.siteRules[hostname]`. `Follow default` deletes just that override. The bridge observes storage changes and derives effective mode at the request frame's hostname. Simulated popup reopen and background reinitialization restored these values. A storage failure now produces a visible error message instead of claiming success.
- **Runtime behavior:** Tests exercised global off, real overrides, fixed responses without native geolocation, noise with native position, geolocation watches, native clearWatch, concurrent noise sample reuse, persistence of cached noise across event-page re-creation and cache clearing.
- **Permission review:** Manifest MV3, Firefox >=140, `storage` and `activeTab`. all-websites content script access is inherent to interception across sites. No unnecessary privileged APIs such as `cookies`, `history`, `webRequest`, or `geolocation` are declared. CSP defaults to denying all resource types, allows only packaged scripts and data and the two HTTPS tile hosts, and forbids outside connections. map images use a no-referrer policy.
- **Source inspection:** No `eval`, obfuscated code, dynamic remote scripts, analytics SDK, tracker, XMLHttpRequest to developer servers, or broad web traffic collectors found in supplied JS. `world-110m.json` is bundled. Map images are the only conditional third-party requests.
- **Credit/license:** Location Guard publicly offers MIT/X11 or CeCILL-B, so reuse and modification under MIT are permitted provided the required notices remain. Preserved `LICENSE` and attribution in `THIRD_PARTY_NOTICES.md` and README. no mandatory in-popup notice is required by the selected MIT/X11 license. GitHub/AMO credit does not imply original-author endorsement. If additional upstream source files were copied from versions not in this archive, preserve all copyright and license notices from those files as well.
- **Privacy improvements:** Offline map is now default for new installs. optional online map traffic requires explicit Firefox consent. online tile provider selection remains a user choice and is disclosed. Failed tiles show the bundled offline map rather than silently contacting another online service. Repeated failed tile requests are suppressed during the popup session. Empty coordinate inputs no longer become (0,0) on change.
- **Packaging:** A root-manifest ZIP is prepared for AMO submission. A separate GitHub source ZIP includes readable scripts and a dependency-free Node test suite. The ZIP is unsigned and is not yet Mozilla-approved.

## Known limitations and pre-publication checks

1. **Live Firefox testing was not possible in this environment:** no Firefox/Web-ext runtime was available. Before publishing, test a temporary install in a current Firefox release using BrowserLeaks Geolocation or your own HTTPS test page. Check correct Noisy/Fixed/Real responses with getCurrentPosition and watchPosition, rejected permissions, nested frames, updates, and browser restart.
2. **MAIN-world interception cannot be security-proof:** a website can read or modify page-visible JavaScript and may evade a geolocation shim or use other location signals. Browser internal/restricted sites are not covered. Avoid marketing the extension as guaranteed anonymity.
3. **Network and AMO disclosures:** Online tile requests reveal the map area and network metadata. v1.4.3 retains `required:["none"]` and `optional:["locationInfo"]`, gates the requests behind a user-activated `permissions.request` prompt, and checks optional grant before loading previously selected providers. Firefox >=140 is required to use the built-in data collection consent feature. Live AMO/browser testing is still required to verify the flow.
4. **Tile service policies:** OSM France requires a freely available, non-profit app, prominent attribution, and moderate traffic. OpenTopoMap has its own limits. For larger-scale distribution, a supported commercial/hosted tile provider or offline-only mapping may be necessary. Read service terms and do not assume unlimited use.
5. **Firefox extension ID:** Before your first AMO submission, confirm `location-veil@personal.local` is the stable, intended extension ID. Changing it after publishing can break upgrades/settings continuity.
6. **Original author/license chain:** The upstream project itself lists MIT/X11 and CeCILL-B. This release includes a standard MIT text and names upstream authors. this is not a legal opinion. If exact upstream files were incorporated, retain their original notices without rewriting them.
7. **No AMO signing performed:** Submit the AMO ZIP to Mozilla for its automated checks, review and signing. The submission outcome can only be established by AMO.

## Automated test results

Run `node --test tests/*.test.cjs` from the source folder. As reviewed, all 10 test cases pass in Node.js 22. Static JavaScript `node --check` passes. These tests use a mocked WebExtensions storage/runtime and an EventTarget-based geolocation bridge. they are not a substitute for real browser interaction.

## References

- Original license and credit: https://github.com/chatziko/location-guard
- Original AMO listing: https://addons.mozilla.org/en-US/firefox/addon/location-guard/
- Firefox MV3 MAIN-world support: https://blog.mozilla.org/addons/2024/07/10/manifest-v3-updates-landed-in-firefox-128/
- Firefox manifest data collection: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings
- Mozilla packaging: https://extensionworkshop.com/documentation/publish/package-your-extension/
- AMO policies: https://extensionworkshop.com/documentation/publish/add-on-policies/
- OSM France usage policy: https://www.openstreetmap.fr/usage/
