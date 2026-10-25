# GitHub copy-and-paste text

**Repository description (About field):**

A privacy-focused Firefox extension for spoofing or blurring website geolocation, with a clean UI, offline fixed-location map, and persistent per-site rules. Based on Location Guard.

**Suggested GitHub topics:**

`firefox` `webextension` `geolocation` `location-privacy` `privacy` `open-source` `location-guard`

**Suggested release title:**

Location Veil v1.4.3 — Firefox geolocation privacy controls

**Suggested release notes:**

Location Veil is a Firefox extension based on the original Location Guard project, offering a redesigned UI and persistent per-site geolocation modes. Choose Noise to locally blur the browser's reported position, Fixed to use a saved point without requesting native location (by default), or Real to let a trusted site receive native geolocation.

It includes a bundled offline world map for choosing a fixed location without contacting a map service. Detailed online maps are optional; Firefox asks for consent before map tiles can be requested from a provider. Site-specific modes, the pin, and other settings are saved locally in your Firefox profile.

Location Veil is maintained independently and is not endorsed by Location Guard's authors. **Location Veil is MIT-licensed**. The upstream Location Guard project is offered under **MIT/X11 OR CeCILL-B**; credit and notices are included in `LICENSE` and `THIRD_PARTY_NOTICES.md`.

**Security notes:** This extension modifies access to the browser's JavaScript Geolocation API. It does not hide your IP address, timezone, account identity or other location signals. Site permissions still matter, and malicious websites may evade page-level protections. Mozilla signing and live Firefox validation are still needed before release.

**Useful links:** Original project: https://github.com/chatziko/location-guard · Original Firefox extension: https://addons.mozilla.org/en-US/firefox/addon/location-guard/

**Installation:** Install a signed release from Firefox Add-ons when available. For local development, load `manifest.json` temporarily using `about:debugging#/runtime/this-firefox`.
