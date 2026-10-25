# Location Veil privacy information

Location Veil changes the coordinates websites can obtain through Firefox's JavaScript Geolocation API. It is not a VPN and does not conceal IP addresses, timezone, language, identity, or location information voluntarily submitted to websites.

## Data stored in your Firefox profile

The extension uses `browser.storage.local`, not an online account or browser sync, to store:

- Whether protection is on, the default mode, privacy radius, cache duration and other preferences.
- Hostname-specific overrides selected in **This site**. These are reused when you return, including after restarting Firefox. A hostname rule affects the corresponding requesting frame, so an embedded third-party frame can follow its own setting.
- A fixed coordinate you select and the map center, zoom, and provider.
- One previously blurred (noisy) coordinate and its expiry time. The original precise coordinate is not stored by the extension. Different sites may receive the same cached blurred coordinate until expiry. Select **New point** if you want to discard it early.

These values are held in your local Firefox profile. Location Veil does not synchronize or upload them. You can remove individual hostname overrides by selecting **Follow default**, change a fixed coordinate, and clear the noise cache via **New point**. Uninstalling the extension normally removes its extension storage from the profile.

## Geolocation and site access

With Noise mode, Firefox's normal site geolocation permission process runs. The native position is sent between the extension's isolated script and its local background component to calculate a blurred position. The page receives the blurred result. In Fixed mode, the default setting returns your selected pin without invoking the native provider or Firefox's site permission prompt. In Real mode, or when the extension's master switch is off, the real position is delivered to the requesting website, subject to Firefox's normal native permission behavior.

The extension declares access to all web pages to patch the Geolocation API. It does not scrape or sell webpage contents, browse histories, or settings. The `activeTab` permission is used to identify the current website in the popup. The website itself receives the geolocation result requested through the API according to your chosen mode.

## Optional online maps

**Offline world** is the default map background for new installations and does not contact any map provider. It still lets you click and save a fixed pin. If you select OSM France or OpenTopoMap, Firefox asks you to grant the optional **location information** transmission permission before the popup downloads raster map tiles over HTTPS from that provider. You can revoke that permission from Firefox’s extension Permissions and data settings. the map will fall back to the offline background. Those requests reveal the area and zoom level being viewed and ordinary network data such as your IP address to the tile provider. If you center a map on your fixed pin, the tile requests can reveal its approximate area. The extension does not automatically contact a different provider if a tile fails. A previously selected online provider is kept only while optional permission remains granted. without permission the selection falls back to offline before tiles load.

The public tile services are operated by third parties and have their own usage and privacy policies. The map includes attribution. Online map requests are for map display only, not developer telemetry.

## Limits

Websites may use IP geolocation, device signals, cookies, account information, scripts running before or against the shim, or other methods to infer your location. Some privileged Firefox pages and restricted domains do not permit extensions to inject scripts. Location Veil therefore does not provide an absolute anonymity or location-hiding guarantee. Keep Firefox updated and use the browser's native site permission controls when you do not wish to disclose location.

## No developer data collection

The source contains no analytics, advertisements, tracking pixels, server sync, remote configuration or remote JavaScript. Apart from requests made to a map tile server when you select an online map, Location Veil has no outbound network client. The manifest declares no required data transmission and requests `locationInfo` as an optional permission for online map tiles. The extension requires Firefox 140 or later, which supports Firefox’s built-in consent flow.
