# Nepali GIS Layers - Waze Map Editor Script

[![Script Status](https://img.shields.io/badge/Status-Active-brightgreen.svg)](https://github.com/kid4rm90s/Nepali-WMS-Layers)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Bring Nepali geospatial data into the Waze Map Editor — WMS layers, postal codes, and
the Nepal GIS hierarchy, in one sidebar tab.**

## Description

This userscript for the Waze Map Editor (WME) gives mappers in Nepal access to the
authoritative geospatial data they need while editing, without hunting for service URLs
or configuring anything by hand.

It does three things:

1. **Pre-configured WMS layers** from Nepali government and road-authority services —
   roads, borders, place names, house numbers, health and education facilities.
2. **A postal address card** in the edit panel. Select a segment or a venue and the card
   shows the ward, postal code and country for the place you selected, ready to copy.
   The code comes from the published government address sheet, matched to the ward the
   feature actually sits in.
3. **Auto-loading ward layers** for Lalitpur and the national GIS hierarchy, which fetch
   only the data inside your current view as you pan.

> **Note on the name:** this script was previously called *Nepali WMS Layers*. It was
> renamed to *Nepali GIS Layers* because it now does considerably more than display WMS
> layers. WMS layers are still fully supported — see the [note below](#a-note-on-wms-layers).

## Features

### Layers

Six groups of pre-configured layers, each with an opacity slider and one checkbox per
layer:

| Group | What is in it |
|---|---|
| **NP Places** | Rivers, airports, education and health facilities, police units, palika and ward centres, tourist attractions, customs offices |
| **NP Roads** | SSRN Highway 2023, National / Province Highways and Province Roads, bridges (BSM and PRTMP) |
| **NP Metric HNs** | Metric house numbers, municipality roads and ward boundaries for Dhangadhi, Ghodaghodi and Nepalgunj |
| **NP names and addresses** | BSM municipality names, SSRN junction names |
| **NP Borders** | National, province, district and municipality borders from Geoportal, SSRN, BSM and DMG |
| **External Maps!!!** | Waze LiveMap, Google Maps / Terrain / Hybrid / StreetView, OpenStreetMap |

Layer group cards are collapsible, show how many of their layers are on, and remember
both their collapsed state and your layer selection.

### Postal codes and addresses

- **Address card** under the address fields when you select a **segment** or a **venue**,
  with a **Copy** button. Works for places and streets alike.
- The postal code is matched to the **ward the feature is actually inside**, found by
  point-in-polygon against the loaded ward polygons — not from the Waze city name, which
  is only used to flag a disagreement with the sheet.
- Choose between the **7-digit ward code** (e.g. `2070301`) and the **5-digit city code**
  (e.g. `20703`).
- **Sub-city and Province switches**: optionally lead the address with the area / tole
  name, and write *Bagmati Province* instead of a bare *Bagmati*.
- Every matched feature also gains `postal_code`, `postal_ward_code` and `postal_state`,
  so any of them can be used as a **label field**.

### Style Settings

Restyle the loaded ward and GIS layers without reloading anything:

- Stroke Color, Font Size, Label Color and Outline Color (each with a *Match stroke* switch)
- Outline Width (optionally relative to font size), Fill Opacity
- Line Size, Line Style (Solid / Dash / Dot), Line Opacity
- Label Position (horizontal Left / Center / Right + vertical Top / Middle / Bottom)
- **Label field picker** — choose which property labels the features, from every property
  the loaded features carry, or build a template such as `${ex_gapa_napa} - ${postal_code}`

One **global** style plus an optional **per-layer override**. Changes redraw the layer in
place and are saved.

### Auto-loading ward layers

- **Lalitpur HN Address Wards** — tick the wards (1-29) you want. The address points and
  ward boundary load automatically as soon as a ticked ward enters the map view, and drop
  again once it leaves (with a padded viewport and a grace period, so panning does not
  thrash).
- **Nepal GIS Layers** — the national hierarchy: **province**, **district**,
  **municipality** and **ward** levels. Each level has its own zoom gate, and only the
  files whose bounding box is in view are ever downloaded.

### Shifting

One dropdown and one 3×3 pad move either a **WMS layer** or a **loaded ward layer**, in
metres, with *Reset Shift* and the currently applied shift shown underneath. Useful when a
published service sits slightly off its true position.

### A note on WMS layers

The script has largely moved to the **WME SDK** — layer management, styling, events,
keyboard shortcuts, the layer-switcher checkbox and Street View are all SDK-based now.

**WMS tile layers are the exception.** They still run on OpenLayers 2, because the WME SDK
has no WMS layer type yet. This is a limitation of the SDK, not a choice — the WMS layers
will move across as soon as the SDK supports them.

## Installation

You will need a userscript manager such as **Tampermonkey** (Chrome, Firefox, Safari,
Edge) or **Greasemonkey** (Firefox).

1. **Install a userscript manager**
   - **Chrome / Edge / Safari:** [Tampermonkey](https://www.tampermonkey.net/) from your
     browser's extension store
   - **Firefox:** [Tampermonkey](https://www.tampermonkey.net/) or
     [Greasemonkey](https://addons.mozilla.org/en-US/firefox/addon/greasemonkey/)

2. **Install the script**
   - Open [the script on GreasyFork](https://greasyfork.org/en/scripts/521924-nepali-wms-layers)
   - Your userscript manager will prompt you — click **Install**

3. **Verify**
   - Open the [Waze Map Editor](https://www.waze.com/editor) and log in
   - Open your userscript manager — you should see **Nepali GIS Layers** listed

## Usage

1. **Open WME** at <https://www.waze.com/editor> and log in.
2. **Open the sidebar tab.** The script registers a single master checkbox in WME's own
   layer switcher, and its own tab labelled **WMS-NP** in the sidebar. A layer is drawn
   only when *both* its checkbox in the script's tab and the master checkbox are on.
3. **Use the three sub-tabs:**
   - **Layers** — the layer groups, the two auto-loading ward cards, and the per-layer
     checkboxes
   - **Shifting** — pick a layer, set a distance, and use the 3×3 pad to nudge it
   - **Settings** — Postal Codes, Style Settings, and the address switches
4. **Select a segment or a venue** to see the postal address card in the edit panel.
5. **Tick a ward or GIS level** to auto-load it as you pan the map.

Your layer selection, opacity, sub-tab, address switches, card states and loaded ward
choices are all remembered between sessions.

## Contributing

Contributions are welcome — suggestions for new layers, improvements, or bug fixes.

- **Open an Issue** to report a bug, suggest a feature, or request a new layer
- **Submit a Pull Request** with your changes

Please make sure any layer you suggest is:

- **Publicly accessible** (or at least reachable by Waze mappers in Nepal)
- **Legally usable** for mapping purposes within Waze
- **Relevant and useful** for Waze map editing in Nepal

## License

Released under the [MIT License](LICENSE) — see the `LICENSE` file for details.

**Disclaimer:** this is an unofficial, community-developed tool, not endorsed or supported
by Waze or Google. Use it at your own risk. The availability and accuracy of the data are
the responsibility of the respective providers and are beyond the control of this script.

---

## Acknowledgements

Built on work by others:

- **Czech WMS layers** — original authors **petrjanik**, **d2-mac**, **MajkiiTelini**
- **Croatian WMS layers** — author **JS55CT**. The sidebar panel pattern (gradient header,
  category cards, per-category opacity slider, checkbox per layer) and the WME
  CSS-variable theming come from this script. The layer styling is taken from **WME
  Geofile**, also by **JS55CT**.

**GitHub:** <https://github.com/kid4rm90s/Nepali-GIS-Layers>
**Changelog:** [`CHANGELOG.md`](CHANGELOG.md)