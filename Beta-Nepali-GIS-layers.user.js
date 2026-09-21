// ==UserScript==
// @name          Beta - Nepali GIS layers
// @version       2026.09.21.001
// @author        kid4rm90s
// @description   Displays layers from Nepali GIS services in WME
// @include      /^https:\/\/(www|beta)\.waze\.com\/(?!user\/)(.{2,6}\/)?editor.*$/
// @run-at        document-end
// @namespace     https://greasyfork.org/en/users/1087400-kid4rm90s
// @license       MIT
// @grant         GM_xmlhttpRequest
// @grant         unsafeWindow
// @require       https://greasyfork.org/scripts/560385/code/WazeToastr.js
// @require       https://update.greasyfork.org/scripts/516445/1480246/Make%20GM%20xhr%20more%20parallel%20again.js
// @require       https://update.greasyfork.org/scripts/565546/1750869/Preeti%20to%20Unicode%20Converter.js
// @require       https://update.greasyfork.org/scripts/542477/1742119/wmeGisLBBOX.js
// @require       https://update.greasyfork.org/scripts/526229/1537672/GeoGMLer.js
// @require       https://update.greasyfork.org/scripts/524747/1542062/GeoKMLer.js
// @require       https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.15.0/proj4-src.js
// @connect       geoserver.softwel.com.np
// @connect       admin.nationalgeoportal.gov.np
// @connect       localhost:8080
// @connect       greasyfork.org
// @connect       geonep.com.np
// @connect       gis.dmgnepal.gov.np
// @connect       kid4rm90s.github.io
// @connect       docs.google.com

// ==/UserScript==

/*  Scripts modified from Czech WMS layers (https://greasyfork.org/en/scripts/35069-czech-wms-layers; https://greasyfork.org/en/scripts/34720-private-czech-wms-layers, https://greasyfork.org/en/scripts/28160)
orgianl authors: petrjanik, d2-mac, MajkiiTelini, and Croatian WMS layers (https://greasyfork.org/en/scripts/519676-croatian-wms-layers) author: JS55CT
The sidebar panel pattern (gradient header + category cards + per-category opacity slider + checkbox per layer)
and the WME CSS-variable theming are borrowed from the Croatian WMS layers script. */

/* global W */
/* global WazeToastr */
/* global $ */
/* global OpenLayers */
/* global require */
/* global GeoKMLer */

(function main() {
  ('use strict');
  const updateMessage =
'<strong>What is new</strong><br>' +
'- <strong>Postal codes:</strong> select a <em>segment</em> or a <em>venue</em> and an address card appears under its address fields, with the ward, postal code and a <em>Copy</em> button. The code comes from the published government address sheet, matched to the ward the feature actually sits in. Switch between the 7-digit ward code and the 5-digit city code, and turn the sub-city and the <em>Province</em> suffix on or off, on the <em>Settings</em> tab.<br>' +
'- <strong>New full UI:</strong> the sidebar tab is split into <em>Layers</em>, <em>Shifting</em> and <em>Settings</em>. Layer groups are collapsible cards with a per-group <em>opacity slider</em> and one checkbox per layer, plus an on/total count - so opacity, groups and checkboxes are all under your control, and your selection and opacity are remembered.<br>' +
'- <strong>Mostly converted to the WME SDK:</strong> layers, styling, events, keyboard shortcuts, the layer-switcher checkbox and Street View are all on the SDK now instead of the legacy <code>W</code> object and OpenLayers-2 internals. WMS tile layers stay on OL2, because the SDK has no WMS layer type yet.<br>' +
'- <strong>One shift control for everything:</strong> a single dropdown and one 3x3 pad in the <em>Shifting</em> tab move either a WMS layer or a loaded ward layer, in metres, with <em>Reset Shift</em> and the applied shift shown underneath.<br>' +
'- <strong>Choose what a loaded layer displays:</strong> the <em>Style Settings</em> card has a <em>Label field</em> picker, listing every property the loaded features carry - so a ward can be labelled with its postal code, ward code, district or any <code>${attr}</code> template. Applies to the LMC ward layers and both Nepal GIS levels.<br>' +
'- <strong>User-friendly styling:</strong> Stroke Color, Font Size, Label and Outline Color (each with a <em>Match stroke</em> switch), Outline Width, Fill Opacity, Line Size / Style / Opacity and Label Position, with one global style plus an optional per-layer override. Changes redraw the layer in place - nothing is reloaded - and are saved.<br>' +
'- <strong>Auto-loading ward layers:</strong> <em>Lalitpur HN Address Wards</em> and <em>Nepal GIS Layers</em> fetch only what is in the current view. Tick the wards, or the province / district / municipality / ward levels, and layers load as you pan and drop again once off screen.<br>' +
'- <strong>Address and map fixes:</strong> the card no longer jumps to the top of the edit panel, Google place addresses are no longer shown (they are often wrong), and saved layer opacity is applied again after a reload instead of resetting.<br>';
  const scriptName = GM_info.script.name;
  const scriptVersion = GM_info.script.version;
  const downloadUrl = 'https://greasyfork.org/scripts/521924-nepali-wms-layers/code/nepali-wms-layers.user.js';
  let wmeSDK;

  var WMSLayersTechSource = {};
  var W;
  var OL;
  var ZIndexes = {};
  var WMSLayerTogglers = {};
  var loadedGeoJSONLayers = [];
  var geoJsonLayerOffsets = {};
  // Refresh callbacks of the collapsible group cards' "on/total" badges. They are
  // rebuilt with the panel and re-run whenever a layer's checkbox state changes.
  var categoryCountRefreshers = [];

  /* ==================================================================
     STORAGE KEY REGISTRY
     Every preference this script writes to localStorage is listed here,
     with the shape of its value, so the persistence surface can be read
     in one place instead of being searched for across 7000 lines.

     The values are the literal keys the script has always used, so an
     existing user's saved preferences are picked up unchanged. Each of
     these is still declared as its own named constant at its point of
     use (LMC_AUTO_STORAGE_KEY etc.), because the call sites read better
     with a name than with NPW_STORAGE.x - this table is the index.
     ================================================================== */
  var NPW_STORAGE = {
    shortcuts: '_wme_nepali_wms_shortcuts',      // { settingsKey: { raw, combo } }
    lmcAuto: '_wme_nepali_wms_lmc_auto',         // { enabled, autoRemove, viewFilter, wards[] }
    npGis: '_wme_nepali_wms_np_gis',             // { enabled, autoRemove, levels{} }
    master: '_wme_nepali_wms_master',            // 'true' | 'false' (bare string)
    opacity: '_wme_nepali_wms_opacity',          // { categoryName: number }
    collapsed: '_wme_nepali_wms_collapsed',      // { cardStorageKey: boolean }
    subTab: '_wme_nepali_wms_subtab',            // bare tab id (string)
    layerOffsets: '_wme_nepali_wms_layer_offsets', // { layerName: { east, north } } in metres
    postal: '_wme_nepali_wms_postal',            // { wardCodes, autoLoad, subCity, provinceSuffix }
    layerTogglers: 'WMSLayers',                  // { togglerKey: boolean } - pre-existing key
  };

  /* ==================================================================
     PERSISTENCE HELPERS
     Every preference the script remembers lives in localStorage as JSON,
     and every one of them has to survive a corrupt entry, a disabled
     storage (private mode) and a full quota. Those three failure modes
     are handled once, here, instead of in ~10 save/load pairs.

     The loads return the `fallback` rather than throwing, so a caller can
     read a store and use the result directly without its own try/catch.
     ================================================================== */

  /** Reads a JSON store, or `fallback` when it is missing, empty or corrupt. */
  function npwLoadJson(storageKey, fallback) {
    try {
      var raw = localStorage.getItem(storageKey);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  /** Writes a JSON store. A failed write is dropped - it must never break the script. */
  function npwSaveJson(storageKey, value) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch (e) {
      // Ignore: quota exceeded, storage disabled, or a serialisation failure.
    }
  }

  // Reads one key out of a shared JSON object store - the shape `.npw-card` collapse
  // state, per-category opacity and per-layer offsets all use. `fallback` is returned
  // when the store has no entry for `name`.
  function npwLoadEntry(storageKey, name, fallback) {
    var all = npwLoadJson(storageKey, {});
    return all && typeof all === 'object' && all[name] !== undefined ? all[name] : fallback;
  }

  /** Writes one key into a shared JSON object store, leaving the others untouched. */
  function npwSaveEntry(storageKey, name, value) {
    var all = npwLoadJson(storageKey, {});
    if (!all || typeof all !== 'object') all = {};
    all[name] = value;
    npwSaveJson(storageKey, all);
  }

  // Reads a plain string preference. Storage returns strings, so this is the
  // non-JSON counterpart of npwLoadJson - used by the remembered sub-tab and the
  // master toggle, which store a bare value rather than an object.
  function npwLoadString(storageKey, fallback) {
    try {
      var raw = localStorage.getItem(storageKey);
      return raw === null ? fallback : raw;
    } catch (e) {
      return fallback;
    }
  }

  /** Writes a plain string preference. */
  function npwSaveString(storageKey, value) {
    try {
      localStorage.setItem(storageKey, value);
    } catch (e) {
      // Ignore - see npwSaveJson.
    }
  }

  /* ==================================================================
     SDK KEYBOARD SHORTCUTS
     Replaces the legacy W.accelerators + I18n registration. Keys are
     assigned by the user in WME Settings -> Keyboard Shortcuts and are
     persisted here as { settingsKey: { raw, combo } }.
     Pattern ported from WME EZRoad Mod.
     ================================================================== */
  var sdkShortcutDefs = []; // { id, description, settingsKey, callback } - filled by addLayerToggler()
  var SHORTCUTS_STORAGE_KEY = '_wme_nepali_wms_shortcuts';
  var LEGACY_SHORTCUTS_KEY_SUFFIX = 'KBS'; // WME stored W.accelerators keys under "<scriptName>KBS"
  // settingsKeys whose saved key could not be assigned (conflict) - the sync poll
  // skips them so a preserved key is never clobbered back to null.
  var _conflictBlockedKeys = new Set();
  // settingsKey -> stale combo that getAllShortcuts() still reports after WME moved
  // that key away (SDK quirk: originalShortcut is not cleared on conflict resolution).
  var _conflictStaleKeys = new Map();
  var _shortcutsSyncTimer = null;

  // --- Key-code <-> SDK combo converters -----------------------------
  // WME's own storage uses raw "modifiers,keycode" (e.g. "4,82" = Alt+R) while the
  // SDK uses readable combos ("A+R"). Both formats show up in saved data, so every
  // value is normalized to { raw, combo } before use.
  var _KEYCODE_TO_CHAR = {
    65: 'A', 66: 'B', 67: 'C', 68: 'D', 69: 'E', 70: 'F', 71: 'G', 72: 'H', 73: 'I', 74: 'J', 75: 'K', 76: 'L',
    77: 'M', 78: 'N', 79: 'O', 80: 'P', 81: 'Q', 82: 'R', 83: 'S', 84: 'T', 85: 'U', 86: 'V', 87: 'W', 88: 'X',
    89: 'Y', 90: 'Z',
    48: '0', 49: '1', 50: '2', 51: '3', 52: '4', 53: '5', 54: '6', 55: '7', 56: '8', 57: '9',
    112: 'F1', 113: 'F2', 114: 'F3', 115: 'F4', 116: 'F5', 117: 'F6',
    118: 'F7', 119: 'F8', 120: 'F9', 121: 'F10', 122: 'F11', 123: 'F12',
    32: 'Space', 13: 'Enter', 9: 'Tab', 27: 'Esc', 8: 'Backspace', 46: 'Delete',
    36: 'Home', 35: 'End', 33: 'PageUp', 34: 'PageDown', 45: 'Insert',
    37: '\u2190', 38: '\u2191', 39: '\u2192', 40: '\u2193',
    188: ',', 190: '.', 191: '/', 186: ';', 222: "'", 219: '[', 221: ']', 220: '\\', 189: '-', 187: '=', 192: '',
  };

  var _CHAR_TO_KEYCODE = Object.fromEntries(
    Object.entries(_KEYCODE_TO_CHAR).map(function (entry) {
      return [entry[1].toUpperCase(), Number(entry[0])];
    })
  );

  var _MOD_CHAR_TO_VAL = { C: 1, S: 2, A: 4 };

  function _comboToRaw(str) {
    if (!str || str === '' || str === '-1' || str === 'None') return null;
    if (/^\d+,-?\d+$/.test(str)) {
      var keyCodeRaw = parseInt(str.split(',')[1], 10);
      return keyCodeRaw < 0 ? null : str;
    }
    // Legacy/bare numeric key code ("67" = 'C'). Only 2+ digits are key codes:
    // the SDK reports single-digit keys as the CHARACTER ("8" = the '8' key).
    if (/^\d{2,}$/.test(str)) return '0,' + str;

    var upperStr = String(str).toUpperCase();
    if (/^[A-Z0-9]$/.test(upperStr)) return '0,' + upperStr.charCodeAt(0);
    if (_CHAR_TO_KEYCODE[upperStr] !== undefined) return '0,' + _CHAR_TO_KEYCODE[upperStr];

    function modValueOf(mods) {
      return mods.split('').reduce(function (acc, ch) {
        return acc | (_MOD_CHAR_TO_VAL[ch] || 0);
      }, 0);
    }

    var letterMatch = upperStr.match(/^([ACS]+)\+([A-Z0-9])$/);
    if (letterMatch) return modValueOf(letterMatch[1]) + ',' + letterMatch[2].charCodeAt(0);

    var numericMatch = upperStr.match(/^([ACS]+)\+(\d+)$/);
    if (numericMatch) return modValueOf(numericMatch[1]) + ',' + numericMatch[2];

    var specialMatch = upperStr.match(/^([ACS]+)\+(.+)$/);
    if (specialMatch && _CHAR_TO_KEYCODE[specialMatch[2]] !== undefined) {
      return modValueOf(specialMatch[1]) + ',' + _CHAR_TO_KEYCODE[specialMatch[2]];
    }
    return null;
  }

  function _rawToCombo(str) {
    var raw = _comboToRaw(str);
    if (!raw) return null;
    var parts = raw.split(',');
    var modValue = parseInt(parts[0], 10);
    var keyCode = parseInt(parts[1], 10);
    var keyChar = _KEYCODE_TO_CHAR[keyCode] || String(keyCode);
    var modifiers = '';
    if (modValue & 1) modifiers += 'C';
    if (modValue & 2) modifiers += 'S';
    if (modValue & 4) modifiers += 'A';
    return modifiers ? modifiers + '+' + keyChar : keyChar;
  }

  function _normalizeShortcut(value) {
    var src = value && typeof value === 'object' ? value.raw ?? value.combo : value;
    var raw = _comboToRaw(src);
    return { raw: raw, combo: _rawToCombo(raw) };
  }

  // --- Persistence ---------------------------------------------------
  // Unlike the other stores these two log a warning rather than staying silent: a lost
  // shortcut assignment is something the user has to know about, because it is work they
  // did in WME's settings rather than state the script can rebuild.
  function loadShortcutKeys() {
    try {
      var saved = JSON.parse(localStorage.getItem(SHORTCUTS_STORAGE_KEY) || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch (e) {
      console.warn(scriptName + ': could not read saved shortcut keys', e);
      return {};
    }
  }

  function saveShortcutKeys(keys) {
    try {
      localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(keys));
    } catch (e) {
      console.warn(scriptName + ': could not save shortcut keys', e);
    }
  }

  // Migrate keys the user had assigned to the old W.accelerators shortcuts so they
  // survive the switch to the SDK. Legacy format: "<scriptName>KBS" holding
  // [{ "<shortcutString>": "<actionId>" }], where actionId was the layer key.
  function migrateLegacyShortcuts() {
    var legacyStoreKey = scriptName + LEGACY_SHORTCUTS_KEY_SUFFIX;
    var legacyRaw;
    try {
      legacyRaw = JSON.parse(localStorage.getItem(legacyStoreKey));
      if (!Array.isArray(legacyRaw)) return;
    } catch (e) {
      return; // no legacy data
    }

    var keys = loadShortcutKeys();
    var knownSettingsKeys = new Set(sdkShortcutDefs.map(function (d) {
      return d.settingsKey;
    }));
    var migrated = 0;

    legacyRaw.forEach(function (entry) {
      if (!entry) return;
      var shortcutString = Object.keys(entry)[0];
      if (!shortcutString) return;
      var actionId = entry[shortcutString];
      if (!knownSettingsKeys.has(actionId)) return; // not one of our layers
      if (shortcutString === '-1' || shortcutString === 'None' || shortcutString === '') return;
      if (keys[actionId] && keys[actionId].combo !== null) return; // already assigned

      // Legacy values are bare key codes with no modifier prefix. Prefix "0," so a
      // single-digit code (8 = Backspace) is not read as the character '8'.
      var legacyShortcut = String(shortcutString);
      if (/^\d+$/.test(legacyShortcut)) legacyShortcut = '0,' + legacyShortcut;
      keys[actionId] = _normalizeShortcut(legacyShortcut);
      migrated++;
    });

    if (migrated > 0) {
      saveShortcutKeys(keys);
      localStorage.removeItem(legacyStoreKey);
      console.log(scriptName + ': migrated ' + migrated + ' legacy shortcut key(s) to the SDK format.');
    }
  }

  // Register every layer shortcut. Re-runs are safe: existing registrations are
  // deleted first. A key already taken by WME or another script is preserved in
  // storage and the shortcut is registered keyless, with a warning to resolve it.
  function initializeSDKShortcuts() {
    if (!wmeSDK?.Shortcuts || sdkShortcutDefs.length === 0) return;

    sdkShortcutDefs.forEach(function (def) {
      if (wmeSDK.Shortcuts.isShortcutRegistered({ shortcutId: def.id })) {
        wmeSDK.Shortcuts.deleteShortcut({ shortcutId: def.id });
      }
    });

    var keys = loadShortcutKeys();
    sdkShortcutDefs.forEach(function (def) {
      keys[def.settingsKey] = _normalizeShortcut(keys[def.settingsKey]);
    });

    // Duplicate combos can survive from older data: keep the first occurrence,
    // register the rest keyless (their saved key is preserved, never nulled).
    var taken = {};
    var conflicts = [];
    sdkShortcutDefs.forEach(function (def) {
      var combo = keys[def.settingsKey]?.combo || null;
      if (!combo) return;
      if (taken[combo] !== undefined) {
        _conflictBlockedKeys.add(def.settingsKey);
        conflicts.push(def.description + ' (' + combo + ')');
      } else {
        taken[combo] = def.settingsKey;
      }
    });

    sdkShortcutDefs.forEach(function (def) {
      var shortcutKeys = _conflictBlockedKeys.has(def.settingsKey) ? null : keys[def.settingsKey].combo;
      try {
        wmeSDK.Shortcuts.createShortcut({
          shortcutId: def.id,
          description: def.description,
          callback: def.callback,
          shortcutKeys: shortcutKeys,
        });
      } catch (e) {
        if (String(e).indexOf('already in use') !== -1) {
          if (!_conflictBlockedKeys.has(def.settingsKey)) {
            _conflictBlockedKeys.add(def.settingsKey);
            conflicts.push(def.description + ' (' + (keys[def.settingsKey].combo || 'key in use') + ')');
          }
          try {
            wmeSDK.Shortcuts.createShortcut({
              shortcutId: def.id,
              description: def.description,
              callback: def.callback,
              shortcutKeys: null,
            });
          } catch (e2) {
            console.error(scriptName + ': unable to register shortcut ' + def.id, e2);
          }
        } else {
          console.error(scriptName + ': unable to register shortcut ' + def.id, e);
        }
      }
    });

    saveShortcutKeys(keys);

    if (conflicts.length > 0) {
      console.warn(scriptName + ': shortcut conflicts (no key assigned): ' + conflicts.join(', '));
      try {
        WazeToastr.Alerts.warning(
          scriptName,
          'Shortcut conflict: ' + conflicts.join(', ') + ' could not be assigned a key. Resolve it in WME Settings \u2192 Keyboard Shortcuts.',
          false,
          false,
          8000
        );
      } catch (e) {
        console.warn(scriptName + ': WazeToastr warning failed', e);
      }
    }
    console.log(scriptName + ': ' + sdkShortcutDefs.length + ' SDK shortcuts initialized.');
  }

  // WME moves a key away from its previous owner when the user reassigns it, so the
  // SDK state is the source of truth. This syncs SDK -> localStorage for shortcuts
  // the user changed in WME Settings -> Keyboard Shortcuts.
  function checkSDKShortcutsChanged() {
    if (!wmeSDK?.Shortcuts || sdkShortcutDefs.length === 0) return;

    var defsById = {};
    sdkShortcutDefs.forEach(function (def) {
      defsById[def.id] = def;
    });

    var sdkState = {}; // settingsKey -> { raw, combo }
    var combos = {}; // combo -> [settingsKey]
    wmeSDK.Shortcuts.getAllShortcuts().forEach(function (shortcut) {
      var def = defsById[shortcut.shortcutId];
      if (!def) return;
      var normalized = _normalizeShortcut(shortcut.shortcutKeys);
      sdkState[def.settingsKey] = normalized;
      if (normalized.combo) {
        (combos[normalized.combo] = combos[normalized.combo] || []).push(def.settingsKey);
      }
    });

    var keys = loadShortcutKeys();
    var changedKeys = [];
    Object.keys(sdkState).forEach(function (settingsKey) {
      var savedCombo = keys[settingsKey]?.combo || null;
      var sdkCombo = sdkState[settingsKey].combo || null;

      // Stale value from a moved key (SDK quirk) - ignore until it really changes.
      if (_conflictStaleKeys.has(settingsKey)) {
        if (sdkCombo === _conflictStaleKeys.get(settingsKey)) return;
        _conflictStaleKeys.delete(settingsKey);
      }
      // Key we could not assign this session - keep the preserved saved value.
      if (_conflictBlockedKeys.has(settingsKey)) {
        if (sdkCombo === null) return;
        _conflictBlockedKeys.delete(settingsKey);
      }
      if (savedCombo !== sdkCombo) changedKeys.push(settingsKey);
    });

    // Resolve stale duplicates: when several of our shortcuts report the same combo,
    // the one that actually changed is the real holder; the others were displaced by
    // WME and must not be written back as if they still owned the key.
    var staleCleared = false;
    Object.keys(combos).forEach(function (combo) {
      var holders = combos[combo];
      if (holders.length < 2) return;
      var changedHolders = holders.filter(function (settingsKey) {
        return changedKeys.indexOf(settingsKey) !== -1;
      });
      if (changedHolders.length !== 1) return;
      holders.forEach(function (holder) {
        if (holder === changedHolders[0]) return;
        if (_conflictBlockedKeys.has(holder) || _conflictStaleKeys.has(holder)) return;
        keys[holder] = { raw: null, combo: null };
        _conflictStaleKeys.set(holder, combo);
        staleCleared = true;
        console.log(scriptName + ': cleared stale shortcut key for ' + holder + ' (SDK still reports "' + combo + '")');
      });
    });

    if (!staleCleared && changedKeys.length === 0) return;

    changedKeys.forEach(function (settingsKey) {
      if (_conflictStaleKeys.has(settingsKey)) return;
      keys[settingsKey] = sdkState[settingsKey];
    });

    saveShortcutKeys(keys);
    console.log(scriptName + ': SDK shortcut changes saved.');
    try {
      WazeToastr.Alerts.success(scriptName, 'Keyboard shortcut(s) saved.', false, false, 2500);
    } catch (e) {
      console.warn(scriptName + ': WazeToastr success failed', e);
    }
  }

  function startShortcutKeySync() {
    if (_shortcutsSyncTimer) return;
    var handler = function () {
      try {
        checkSDKShortcutsChanged();
      } catch (e) {
        console.error(scriptName + ': shortcut sync failed', e);
      }
    };
    window.addEventListener('beforeunload', handler);
    _shortcutsSyncTimer = setInterval(handler, 5000);
  }

  // WME's map model has no centre until the map is centred, and reading .lat from a
  // null centre throws a TypeError inside the shift maths. Falls back to the OL2 map
  // centre (same value) and finally to Nepal's latitude - it only scales metres to
  // degrees, so a rough value is harmless.
  function getMapCenterLat() {
    try {
      var center = W.map.getCenter();
      if (center && typeof center.lat === 'number') return center.lat;
      var olMap = W.map.getOLMap();
      var olCenter = olMap && olMap.getCenter();
      if (olCenter && typeof olCenter.lat === 'number') return olCenter.lat;
    } catch (e) {
      // Ignore - fall through to the default below.
    }
    return 27.7;
  }

  // Helper: refresh the shared shift dropdown of the "Layer tools" card.
  // That dropdown is the single place the shift pad reads its target from, and it
  // lists the loaded GeoJSON layers too, so it has to be rebuilt whenever one is
  // added or cleared (see fillWMSLayersSelectList).
  function updateGeoJsonLayerSelector() {
    fillWMSLayersSelectList();
    fillStyleScopeSelect();
  }

  // The shared shift dropdown carries the layer KIND in its value, so one pad can
  // drive both engines: "wms:<toggler key>" or "geojson:<layer name>".
  // Returns null while nothing is selectable (no layer loaded yet).
  function selectedShiftTarget() {
    var select = document.getElementById('WMSLayersSelect');
    var raw = select ? select.value : '';
    if (!raw) return null;
    var sep = raw.indexOf(':');
    if (sep === -1) return null;
    return { type: raw.slice(0, sep), name: raw.slice(sep + 1) };
  }

  // The WMS togglers that currently have one of their OL2 layers on the map, with the
  // toggler key. The dropdown is keyed by TOGGLER, never by the OL2 layer name: a
  // toggler can own several layers and addLayerToggler() gives those " 0"/" 1" name
  // suffixes, and the layer's params are not a reliable way to recognise a WMS layer.
  function wmsTogglersOnMap() {
    var attached = [];
    try {
      attached = W.map.getLayers();
    } catch (e) {
      attached = [];
    }
    var list = [];
    for (var key in WMSLayerTogglers) {
      var toggler = WMSLayerTogglers[key];
      if (!toggler || toggler.serviceType !== 'WMS') continue;
      var isOnMap = toggler.layerArray.some(function (item) {
        return !!item.layer && attached.indexOf(item.layer) !== -1;
      });
      if (isOnMap) list.push({ key: key, toggler: toggler });
    }
    return list;
  }

  // The OL2 layers of one toggler that are currently on the map - the same set its
  // checkbox controls. Resolved by object identity so no name matching is involved.
  function findWmsLayersForTarget(togglerKey) {
    var toggler = WMSLayerTogglers[togglerKey];
    if (!toggler) return [];
    var attached = [];
    try {
      attached = W.map.getLayers();
    } catch (e) {
      attached = [];
    }
    return toggler.layerArray
      .map(function (item) {
        return item.layer;
      })
      .filter(function (layer) {
        return !!layer && attached.indexOf(layer) !== -1;
      });
  }

  /* ------------------------------------------------------------------
     Feature layers (LMC ward addresses / ward boundaries today; future KML, KMZ,
     GML, GPX, WKT or ZIP(SHP) imports later) - SDK feature layers.
     Replaces OL.Format.GeoJSON + OL.Layer.Vector + OL.StyleMap: the SDK's
     FeatureStyle is the OL2 style key list, so the styles are declared as style
     rules instead. Every value is read through a styleContext getter, which is what
     lets the Style Settings card restyle an already loaded layer with redrawLayer()
     without ever removing or re-adding a feature.
     ------------------------------------------------------------------ */

  // The values a feature layer uses when neither a per-layer override nor the global
  // style says otherwise. Same shape as the stored records, so the whole object can
  // be copied in and out of IndexedDB unchanged.
  //
  // These reproduce the look the LMC ward layers had before the Style Settings card
  // existed: an orange (#FF5722) outline, 2 px wide at 80% opacity, NO polygon fill,
  // and white 13 px labels with a black outline centred on the feature (labelAlign 'cm').
  var FEATURE_STYLE_DEFAULTS = {
    strokeColor: '#FF5722',      // line + polygon outline colour
    lineOpacity: 0.8,            // stroke opacity, 0-1
    lineSize: 2,                 // stroke width in px
    lineStyle: 'solid',          // 'solid' | 'dash' | 'dot'
    fillOpacity: 0,              // polygon fill opacity, 0-1 (0 = outlines only)
    fontSize: 13,                // label size in px (also the point radius)
    labelColorSync: false,       // true = label text uses the stroke colour
    labelColor: '#ffffff',       // used when labelColorSync is false
    outlineColorSync: false,     // true = label outline uses the stroke colour
    outlineColor: '#000000',     // used when outlineColorSync is false
    outlineWidthRelative: true,  // true = outline width is fontSize / 4
    outlineWidth: 3,             // used when outlineWidthRelative is false
    labelPos: 'cm',              // horizontal (l|c|r) + vertical (t|m|b) = OL2 labelAlign
    // Which property - or ${attr} template - becomes the feature label. '' keeps the
    // layer type's built-in label (properties.custom_label), LABEL_FIELD_NONE hides it.
    labelField: '',
  };

  // Sentinels for the `labelField` style value.
  var LABEL_FIELD_BUILTIN = '';        // the layer type's own label (buildings / ward)
  var LABEL_FIELD_NONE = '__none__';   // no label at all
  var LABEL_FIELD_CUSTOM = '__custom__'; // display-only: labelField holds a template

  // Formats a label from the `labelField` value. A plain property name ("district") is
  // the common case; WME GeoFile's ${attr} template syntax works as well, so several
  // properties can be combined ("${district} - ${gapa_napa}") and a literal `\n`
  // becomes a line break.
  function npwFormatLabelTemplate(template, properties) {
    var props = properties || {};
    var raw = String(template);
    if (raw.indexOf('${') === -1) {
      var value = props[raw.trim()];
      return value === undefined || value === null ? '' : String(value).trim();
    }
    return raw
      .replace(/\$\{([^}]+)\}/g, function (match, key) {
        var found = props[key.trim()];
        return found === undefined || found === null ? '' : String(found);
      })
      .replace(/\\n/g, '\n')
      .trim();
  }

  // One feature's label text, from the layer's style state. Reached through the
  // styleContext getter, so it is re-evaluated on every render - which is what lets a
  // label-field change be applied with redrawLayer() alone.
  function npwResolveLabelText(field, properties, traits) {
    var props = properties || {};
    if (field === LABEL_FIELD_NONE) return '';
    // A user-chosen field wins over the layer type's labelled/unlabelled default, which
    // is what makes the province / district / municipality levels labelable at all.
    if (field) return npwFormatLabelTemplate(field, props);
    if (!traits || !traits.labelled) return '';
    return props.custom_label || '';
  }

  /** Short single-line preview of an attribute value, for the attribute list. */
  function npwAttrPreview(value) {
    if (value === null || value === undefined) return '(empty)';
    var text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return text.length > 64 ? text.slice(0, 61) + '\u2026' : text;
  }

  // Per-type structure - the only thing that differs between layer kinds. Every style
  // value comes from the Style Settings card, so one global style can drive them all.
  var LAYER_TYPE_TRAITS = {
    buildings: { labelled: true, boldLabel: true },  // ward addresses, labelled
    boundary: { labelled: false, boldLabel: false }, // ward outline, unlabelled
    // Nepal GIS ward polygons (KML): labelled with the ward title the KML carries.
    ward: { labelled: true, boldLabel: false },
  };

  var STYLE_DB_NAME = 'NepaliWMSFeatureStyles';
  var STYLE_DB_VERSION = 1;
  var STYLE_DB_STORE = 'styles';
  var STYLE_LAYER_KEY_PREFIX = 'layer:';
  var LMC_BBOX_RECORD_KEY = 'lmc-ward-bboxes';

  // Mirror of the IndexedDB records: { global: style|null, overrides: { name: style } }.
  // Loaded once during init() so no layer is ever created without its style.
  var featureStyleStore = { global: null, overrides: {} };
  // layerName -> the mutable object the styleContext getters of that layer close over.
  // Writing into it + redrawLayer() restyles the layer without touching its features.
  var layerStyleStates = {};
  // layerName -> fn(state): re-applied every time that layer's style state is resolved,
  // so a structural per-layer tweak (the Nepal GIS hierarchy's per-level stroke colour
  // and relative weight) survives a Style Settings change instead of being overwritten
  // by the base resolve. An augment MUST be idempotent - it runs after every resolve.
  var layerStyleAugments = {};
  var _styleDbPromise = null;
  var _styleApplyTimer = null;

  // Whether this browser understands the IndexedDB 3 `IDBTransactionOptions` dictionary.
  // Older engines ignore a third argument to `transaction()` rather than throwing, so passing
  // it unconditionally would be harmless - but a future spec change could make it a TypeError,
  // and this keeps the intent explicit. Probed once, then cached.
  var _idbDurabilitySupported = null;
  function idbSupportsDurability() {
    if (_idbDurabilitySupported !== null) return _idbDurabilitySupported;
    _idbDurabilitySupported = false;
    try {
      // A probe database that is deleted immediately - the only reliable feature test for a
      // dictionary member that is otherwise silently ignored.
      var probe = indexedDB.open('_npw_idb_probe_' + Date.now());
      probe.onsuccess = function () {
        var db = probe.result;
        try {
          var tx = db.transaction([], 'readonly', { durability: 'relaxed' });
          _idbDurabilitySupported = !!tx && tx.durability === 'relaxed';
        } catch (e) {
          _idbDurabilitySupported = false;
        }
        db.close();
        try {
          indexedDB.deleteDatabase(db.name);
        } catch (e) {
          // Ignore - the probe database is tiny and carries no data.
        }
      };
    } catch (e) {
      _idbDurabilitySupported = false;
    }
    return _idbDurabilitySupported;
  }

  // The third argument for `db.transaction()`, in the shape the IndexedDB 3 spec defines.
  // Everything this script stores in IndexedDB is a CACHE - the feature styles, the LMC ward
  // bounding boxes and the postal sheet are all re-derivable, and the postal entry even carries
  // its own 24-hour TTL. The spec is explicit about this case: users are "encouraged to use
  // `relaxed` for ephemeral data such as caches", because a relaxed commit returns as soon as
  // the data reaches the OS rather than waiting for a flush to disk, while `strict` trades that
  // latency for durability across a power loss.
  // Nothing here is worth that trade, so every transaction asks for relaxed and falls back to
  // the engine default (`{}`) on an engine that does not know the dictionary.
  function idbCacheTransactionOptions() {
    return idbSupportsDurability() ? { durability: 'relaxed' } : {};
  }

  // --- IndexedDB: one 'styles' store holding the global style, the per-layer
  //     overrides and the cached LMC ward bounding boxes ---
  function openStyleDb() {
    if (_styleDbPromise) return _styleDbPromise;
    _styleDbPromise = (async function () {
      // Clear a stale copy of our own database first - see idbDropStaleStores. This cannot
      // throw and cannot block: on an engine without databases() it is a no-op, and a blocked
      // delete resolves false. The open below is what actually has to succeed.
      try {
        await idbDropStaleStores();
      } catch (e) {
        // Ignore - cleanup is a convenience, never a precondition.
      }
      return new Promise(function (resolve, reject) {
        var request;
        try {
          request = indexedDB.open(STYLE_DB_NAME, STYLE_DB_VERSION);
        } catch (e) {
          reject(e);
          return;
        }
        request.onupgradeneeded = function (event) {
          var db = event.target.result;
          if (!db.objectStoreNames.contains(STYLE_DB_STORE)) {
            db.createObjectStore(STYLE_DB_STORE, { keyPath: 'key' });
          }
        };
        request.onsuccess = function (event) {
          resolve(event.target.result);
        };
        request.onerror = function () {
          reject(request.error);
        };
      });
    })()
      .catch(function (e) {
        console.warn(scriptName + ': IndexedDB is unavailable, styles and the ward index will not persist.', e);
        _styleDbPromise = null;
        return null;
      });
    return _styleDbPromise;
  }

  // Runs one transaction and resolves with whatever the request returned. Resolves
  // with null when IndexedDB is unavailable, so every caller keeps working without
  // persistence instead of breaking.
  //
  // `commitNow` closes the transaction the moment the request succeeds rather than letting
  // the engine wait to see whether more work is queued (IndexedDB 3's `IDBTransaction.commit()`).
  // It exists for the one write here that carries real volume - see postalSaveCached - and is
  // ignored on an engine without `commit()`, where the transaction closes on its own.
  function styleDbRequest(mode, run, commitNow) {
    return openStyleDb()
      .then(function (db) {
        if (!db) return null;
        return new Promise(function (resolve, reject) {
          var tx;
          try {
            tx = db.transaction([STYLE_DB_STORE], mode, idbCacheTransactionOptions());
          } catch (e) {
            reject(e);
            return;
          }
          var store = tx.objectStore(STYLE_DB_STORE);
          var result = null;
          var request = run(store);
          if (request) {
            request.onsuccess = function () {
              result = request.result;
              if (commitNow && typeof tx.commit === 'function') {
                try {
                  tx.commit();
                } catch (e) {
                  // Already closing, which is the outcome commit() was asking for anyway.
                }
              }
            };
            request.onerror = function () {
              reject(request.error);
            };
          }
          tx.oncomplete = function () {
            resolve(result);
          };
          tx.onerror = function () {
            reject(tx.error);
          };
          tx.onabort = function () {
            reject(tx.error);
          };
        });
      })
      .catch(function (e) {
        console.warn(scriptName + ': style storage request failed', e);
        return null;
      });
  }

  function styleDbGet(key) {
    return styleDbRequest('readonly', function (store) {
      return store.get(key);
    });
  }

  function styleDbPut(key, value) {
    return styleDbRequest('readwrite', function (store) {
      return store.put({ key: key, style: value });
    });
  }

  function styleDbDelete(key) {
    return styleDbRequest('readwrite', function (store) {
      return store.delete(key);
    });
  }

  // Lists the IndexedDB databases this origin holds, via the IndexedDB 3 `databases()` method.
  // Not supported everywhere yet (Chrome 71+, Edge 79+, Firefox 126+, Safari 14+), so it is
  // probed before use and resolves with `null` on an engine without it - which is why every
  // caller treats the result as optional rather than assuming a list.
  // @returns {Promise<Array<{name: string, version: number}>|null>} null when unsupported.
  function idbListDatabases() {
    try {
      if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
        return Promise.resolve(null);
      }
      return indexedDB.databases().catch(function () {
        return null;
      });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  // Deletes our own database if it is left over from a schema this build no longer uses.
  // The styles store is shared by the feature styles, the LMC ward bounding boxes and the
  // postal sheet, so a change to its shape has to be able to start clean rather than read
  // records it can no longer interpret. `databases()` is what makes that check cheap: without
  // it, the only way to spot a stale copy is to open the database and inspect its stores.
  // Nothing is deleted on a guess. The name must match ours exactly, the version must be one
  // this build does not expect, AND the store must be missing or unrecognised - so a database
  // this build can still read is never touched, however old it is.
  // @returns {Promise<boolean>} true when a stale copy was deleted.
  async function idbDropStaleStores() {
    var list = await idbListDatabases();
    if (!Array.isArray(list)) return false;

    var mine = list.filter(function (entry) {
      return entry && entry.name === STYLE_DB_NAME;
    });
    if (mine.length === 0) return false;

    var stale = mine.some(function (entry) {
      // A FUTURE version of our own database is not ours to delete - a newer build owns it.
      return typeof entry.version === 'number' && entry.version < STYLE_DB_VERSION;
    });
    if (!stale) return false;

    return new Promise(function (resolve) {
      var request;
      try {
        request = indexedDB.deleteDatabase(STYLE_DB_NAME);
      } catch (e) {
        resolve(false);
        return;
      }
      request.onsuccess = function () {
        console.log(scriptName + ': removed a stale "' + STYLE_DB_NAME + '" database.');
        resolve(true);
      };
      request.onerror = function () {
        resolve(false);
      };
      // Another tab holding the old database open blocks the delete; the cached data is
      // rebuilt on the next fetch either way, so this is not worth surfacing.
      request.onblocked = function () {
        resolve(false);
      };
    });
  }

  // Reads the global style and every per-layer override into the in-memory mirror.
  // Called from init() before the panel - and therefore before any layer - is built.
  async function loadFeatureStyles() {
    var records = await styleDbRequest('readonly', function (store) {
      return store.getAll();
    });
    if (!Array.isArray(records)) return;
    records.forEach(function (record) {
      if (!record || !record.key) return;
      if (record.key === 'global') {
        featureStyleStore.global = record.style || null;
      } else if (record.key.indexOf(STYLE_LAYER_KEY_PREFIX) === 0) {
        featureStyleStore.overrides[record.key.slice(STYLE_LAYER_KEY_PREFIX.length)] = record.style || {};
      }
    });
    var overrideCount = Object.keys(featureStyleStore.overrides).length;
    console.log(scriptName + ': style settings loaded (' + overrideCount + ' layer override(s)).');
  }

  // --- Style resolution ---------------------------------------------------
  // The raw values of a layer: its override when it has one, otherwise the global
  // style, with the defaults filling any gap. The card uses these so the stored
  // sentinels ("match stroke") stay visible as switches.
  function rawStyleValues(layerName) {
    var source = (layerName && featureStyleStore.overrides[layerName]) || featureStyleStore.global || {};
    var values = {};
    Object.keys(FEATURE_STYLE_DEFAULTS).forEach(function (key) {
      var value = source[key];
      values[key] = value === undefined || value === null ? FEATURE_STYLE_DEFAULTS[key] : value;
    });
    return values;
  }

  // The values the styleContext getters report: the sentinels are resolved here, so
  // "match stroke" and "relative to font size" need no branching at render time.
  function resolveStyleValues(raw) {
    var values = {};
    Object.keys(FEATURE_STYLE_DEFAULTS).forEach(function (key) {
      values[key] = raw[key] === undefined || raw[key] === null ? FEATURE_STYLE_DEFAULTS[key] : raw[key];
    });
    values.fontSize = Number(values.fontSize) || FEATURE_STYLE_DEFAULTS.fontSize;
    values.lineSize = Number(values.lineSize) || 0;
    values.lineOpacity = Math.max(0, Math.min(1, Number(values.lineOpacity)));
    values.fillOpacity = Math.max(0, Math.min(1, Number(values.fillOpacity)));
    values.labelColor = values.labelColorSync ? values.strokeColor : values.labelColor;
    values.outlineColor = values.outlineColorSync ? values.strokeColor : values.outlineColor;
    values.outlineWidthValue = values.outlineWidthRelative
      ? values.fontSize / 4
      : Number(values.outlineWidth) || 0;
    return values;
  }

  // Pushes resolved values into the mutable state object of a layer, keeping the
  // object identity its getters closed over.
  function writeLayerStyleState(layerName, values) {
    if (!layerStyleStates[layerName]) layerStyleStates[layerName] = {};
    var state = layerStyleStates[layerName];
    Object.keys(values).forEach(function (key) {
      state[key] = values[key];
    });
    return state;
  }

  /** Re-runs a layer's structural style tweak, if it registered one. */
  function applyLayerStyleAugment(layerName) {
    var augment = layerStyleAugments[layerName];
    if (!augment) return;
    var state = layerStyleStates[layerName];
    if (!state) return;
    augment(state);
  }

  // styleContext for one layer. The SDK re-calls these getters on every render pass,
  // which is what makes redrawLayer() enough to restyle a loaded layer.
  function buildLayerStyleContext(layerName, layerType) {
    var state = layerStyleStates[layerName];
    var traits = LAYER_TYPE_TRAITS[layerType] || LAYER_TYPE_TRAITS.buildings;
    return {
      // The label source is the layer's `labelField`, read live so redrawLayer() is
      // enough to change it: '' = the type's built-in label, a sentinel = no label,
      // anything else is a property name or a ${attr} template.
      getLabel: function (context) {
        var properties = (context && context.feature && context.feature.properties) || {};
        return npwResolveLabelText(state.labelField, properties, traits);
      },
      getStroke: function () { return state.strokeColor; },
      getLineOpacity: function () { return state.lineOpacity; },
      getLineSize: function () { return state.lineSize; },
      getLineStyle: function () { return state.lineStyle; },
      getFillOpacity: function () { return state.fillOpacity; },
      getFontSize: function () { return state.fontSize + 'px'; },
      getFontColor: function () { return state.labelColor; },
      getLabelOutlineColor: function () { return state.outlineColor; },
      getLabelOutlineWidth: function () { return state.outlineWidthValue; },
      getLabelAlign: function () { return state.labelPos; },
    };
  }

  // The style rules themselves: structure lives here, every value comes from the
  // getters above. pointRadius follows the label size, the way WME GeoFile does it.
  function buildLayerStyleRules(layerType) {
    var traits = LAYER_TYPE_TRAITS[layerType] || LAYER_TYPE_TRAITS.buildings;
    return [
      {
        style: {
          stroke: true,
          strokeColor: '${getStroke}',
          strokeOpacity: '${getLineOpacity}',
          strokeWidth: '${getLineSize}',
          strokeDashstyle: '${getLineStyle}',
          fill: true,
          fillColor: '${getStroke}',
          fillOpacity: '${getFillOpacity}',
          pointRadius: '${getFontSize}',
          fontSize: '${getFontSize}',
          fontColor: '${getFontColor}',
          fontWeight: traits.boldLabel ? 'bold' : 'normal',
          fontFamily: 'inherit',
          // Always routed through the getter, never '' for an unlabelled type: both the
          // labelled/unlabelled trait and the user's labelField resolve inside getLabel,
          // so a field can be set on a layer type that is unlabelled by default.
          label: '${getLabel}',
          labelAlign: '${getLabelAlign}',
          labelOutlineColor: '${getLabelOutlineColor}',
          labelOutlineWidth: '${getLabelOutlineWidth}',
        },
      },
    ];
  }

  // Restyles the loaded layers from their (possibly just changed) style. Debounced, so
  // dragging a slider through 50 values still redraws once.
  function scheduleStyleApply(onlyLayerName) {
    clearTimeout(_styleApplyTimer);
    _styleApplyTimer = setTimeout(function () {
      applyStyleToLoadedLayers(onlyLayerName);
    }, 200);
  }

  function applyStyleToLoadedLayers(onlyLayerName) {
    var refreshed = 0;
    loadedGeoJSONLayers.forEach(function (info) {
      if (onlyLayerName && info.name !== onlyLayerName) return;
      if (!layerStyleStates[info.name]) return;
      writeLayerStyleState(info.name, resolveStyleValues(rawStyleValues(info.name)));
      applyLayerStyleAugment(info.name);
      try {
        wmeSDK.Map.redrawLayer({ layerName: info.name });
        refreshed++;
      } catch (e) {
        console.warn(scriptName + ': could not restyle layer ' + info.name, e);
      }
    });
    return refreshed;
  }

  // Persists the global style / a layer override and restyles what is on the map.
  function saveGlobalFeatureStyle(style) {
    featureStyleStore.global = style;
    styleDbPut('global', style);
    scheduleStyleApply();
  }

  function saveLayerFeatureStyle(layerName, style) {
    if (!layerName) return;
    featureStyleStore.overrides[layerName] = style;
    styleDbPut(STYLE_LAYER_KEY_PREFIX + layerName, style);
    scheduleStyleApply(layerName);
  }

  function clearLayerFeatureStyle(layerName) {
    if (!layerName) return;
    delete featureStyleStore.overrides[layerName];
    styleDbDelete(STYLE_LAYER_KEY_PREFIX + layerName);
    scheduleStyleApply(layerName);
  }

  function clearGlobalFeatureStyle() {
    featureStyleStore.global = null;
    styleDbDelete('global');
    scheduleStyleApply();
  }

  // Fills the Style Settings scope dropdown ("All layers (global)" + one entry per
  // loaded feature layer). Safe to call while the panel does not exist yet.
  function fillStyleScopeSelect() {
    var select = document.getElementById('npwStyleScope');
    if (!select) return;
    var previous = select.value || 'global';
    select.innerHTML = '';
    var globalOption = document.createElement('option');
    globalOption.value = 'global';
    globalOption.textContent = 'All layers (global)';
    select.appendChild(globalOption);
    loadedGeoJSONLayers.forEach(function (info) {
      var option = document.createElement('option');
      option.value = STYLE_LAYER_KEY_PREFIX + info.name;
      option.textContent = info.name;
      select.appendChild(option);
    });
    if (select.querySelector('option[value="' + previous + '"]')) {
      select.value = previous;
    }
    // Let the panel repopulate the controls for the scope that is now selected.
    select.dispatchEvent(new Event('change'));
  }

  /* ------------------------------------------------------------------
     "Lalitpur HN Address Wards" - viewport auto-loader
     Ported from the WME GeoFile KML loader: only the wards whose bounding box
     intersects the current viewport are fetched, off-screen layers are dropped again
     (padded viewport + grace period) and every pass is debounced, so panning does not
     hammer geonep.com.np.

     The LMC endpoints are per-ward and carry no bbox, so each ward's bbox is derived
     once from its boundary file and cached in IndexedDB - after that, a reload needs
     no boundary request at all.
     ------------------------------------------------------------------ */
  var LMC_WARD_COUNT = 29;
  var LMC_MIN_ZOOM = 11;          // auto-load is skipped below this zoom level
  var LMC_DEBOUNCE_MS = 400;      // debounce applied to wme-map-move-end
  var LMC_FETCH_CONCURRENCY = 4;  // parallel ward downloads per batch
  var LMC_MAX_LAYERS = 60;        // hard cap on the number of viewport layers
  var LMC_EVICT_PADDING = 0.5;    // keep a layer until it is 50% of a viewport clear
  var LMC_WINDOW_PADDING = 0.5;   // ...and keep the features this far outside the view
  var LMC_EVICT_GRACE_MS = 8000;  // ...and only once it has been out of range this long
  var LMC_BUILDING_URL = 'https://geonep.com.np/LMC/ajax/x_building.php?ward_no=';
  var LMC_BOUNDARY_URL = 'https://geonep.com.np/LMC/ajax/x_ward_bnd.php?ward_no=';
  var LMC_AUTO_STORAGE_KEY = '_wme_nepali_wms_lmc_auto';

  var lmcAutoEnabled = false;      // master switch of the ward group
  var lmcAutoRemoveEnabled = true; // drop layers that leave the padded viewport
  var lmcEnabledWards = {};        // ward number -> true (ticked in the group card)
  var lmcWardBboxes = null;        // ward number -> [minLon, minLat, maxLon, maxLat]
  var lmcActiveLayers = new Map(); // layer name -> { ward, kind, bbox, lastSeen }
  var lmcDebounceTimer = null;
  var lmcEvictTimer = null;        // follow-up pass once a pending eviction's grace ends
  var lmcUpdateInFlight = false;
  var lmcBboxBuildPromise = null;
  var lmcViewFilterEnabled = true; // put only the features inside the padded view on a layer
  var lmcLayerWindows = {};        // layerName -> { box, ids } = what is currently on the layer
  var _featureWindowTimer = null;  // debounce for the post-pan re-window

  /** Standard bbox overlap test in [minLon, minLat, maxLon, maxLat] order. */
  function lmcBboxesIntersect(a, b) {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  }

  function lmcUnionBbox(a, b) {
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
  }

  /** Grows a bbox by a fraction of its own width/height on every side. */
  function lmcPadBbox(box, fraction) {
    var dx = (box[2] - box[0]) * fraction;
    var dy = (box[3] - box[1]) * fraction;
    return [box[0] - dx, box[1] - dy, box[2] + dx, box[3] + dy];
  }

  /** Current viewport as a bbox array (null while the map has no extent yet). */
  function lmcViewportBbox() {
    try {
      var extent = wmeSDK.Map.getMapExtent();
      if (!extent || extent.length !== 4) return null;
      return [extent[0], extent[1], extent[2], extent[3]];
    } catch (e) {
      return null;
    }
  }

  /** Bounding box of any GeoJSON coordinate nesting (Point/Line/Polygon/Multi*). */
  function lmcBboxOfCoordinates(coordinates) {
    var box = null;
    (function walk(node) {
      if (!node || node.length === 0) return;
      if (typeof node[0] === 'number') {
        var lon = Number(node[0]);
        var lat = Number(node[1]);
        if (!isFinite(lon) || !isFinite(lat)) return;
        box = box
          ? [Math.min(box[0], lon), Math.min(box[1], lat), Math.max(box[2], lon), Math.max(box[3], lat)]
          : [lon, lat, lon, lat];
        return;
      }
      for (var i = 0; i < node.length; i++) walk(node[i]);
    })(coordinates);
    return box;
  }

  function lmcBboxOfFeatures(features) {
    var box = null;
    (features || []).forEach(function (feature) {
      var featureBox = feature && feature.geometry ? lmcBboxOfCoordinates(feature.geometry.coordinates) : null;
      if (featureBox) box = box ? lmcUnionBbox(box, featureBox) : featureBox;
    });
    return box;
  }

  /** GET + parse a GeoJSON endpoint through GM_xmlhttpRequest (no CORS limits). */
  function fetchGeoJson(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        headers: { Accept: 'application/json' },
        timeout: timeoutMs || 30000,
        onload: function (response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error('HTTP ' + response.status));
            return;
          }
          try {
            resolve(JSON.parse(response.responseText));
          } catch (e) {
            reject(e);
          }
        },
        onerror: function () {
          reject(new Error('network error'));
        },
        ontimeout: function () {
          reject(new Error('request timeout'));
        },
      });
    });
  }

  function lmcLayerName(ward, kind) {
    return kind === 'boundary' ? 'LMC_Ward_' + ward + '_Boundary' : 'LMC_Ward_' + ward + '_Buildings';
  }

  function setLmcStatus(text) {
    var element = document.getElementById('lmcAutoStatus');
    if (element) element.textContent = text;
  }

  /* ------------------------------------------------------------------
     "Only put the current view on the map" - feature windowing.

     A ward is fetched whole (the service takes no bbox), but only the features inside
     the (padded) view are actually put on its layer. Panning somewhere new tops the
     layer up with the features that entered the window and takes out the ones that
     left - the same padded-window + retain model WME uses for its own map objects, so
     nothing is churned while the view stays inside the already loaded window.

     The bbox of every feature is precomputed once at load time (properties.__bbox), so
     re-windowing is a four-number compare per feature plus one batched add/remove call.
     ------------------------------------------------------------------ */

  /** The bbox of a feature, as precomputed at load time (null when unknown). */
  function featureBbox(feature) {
    var box = feature && feature.properties && feature.properties.__bbox;
    return Array.isArray(box) && box.length === 4 ? box : null;
  }

  /** The current view grown by LMC_WINDOW_PADDING, i.e. what a layer should carry. */
  function paddedViewBox() {
    var viewport = lmcViewportBbox();
    return viewport ? lmcPadBbox(viewport, LMC_WINDOW_PADDING) : null;
  }

  /** True when `outer` fully covers `inner` - then the layer needs no new features. */
  function boxContains(outer, inner) {
    if (!Array.isArray(outer) || !Array.isArray(inner)) return false;
    return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
  }

  function addFeaturesToLmcLayer(layerName, features) {
    if (!features.length) return;
    wmeSDK.Map.dangerouslyAddFeaturesToLayerWithoutValidation({ features: features, layerName: layerName });
  }

  // Makes a layer carry exactly the features inside the padded view.
  // `force` re-windows even when the current window already covers the view - used after
  // a load, a shift or a switch flip, when the coordinates or the mode changed.
  function windowLayerFeatures(info, force) {
    if (!info) return;

    var record = lmcLayerWindows[info.name];

    if (!lmcViewFilterEnabled) {
      // Filter off: put the whole layer back and stop tracking a window.
      if (!record) return;
      delete lmcLayerWindows[info.name];
      try {
        addFeaturesToLmcLayer(
          info.name,
          info.sdkFeatures.filter(function (feature) {
            return !record.ids[feature.id];
          })
        );
      } catch (e) {
        console.warn(scriptName + ': could not restore all features of ' + info.name, e);
      }
      return;
    }

    var view = paddedViewBox();
    if (!view) return; // no map extent yet - leave the layer as it is
    if (!force && record && boxContains(record.box, view)) return; // nothing new is needed

    if (!record) {
      // The layer is carrying everything right now (it was loaded before this switch was
      // turned on, or the map had no extent yet). Start from "every feature is on the
      // layer" so the diff below trims it down instead of adding duplicates.
      record = { box: null, ids: {} };
      info.sdkFeatures.forEach(function (feature) {
        record.ids[feature.id] = true;
      });
    }

    var wantedIds = {};
    var wantedFeatures = [];
    info.sdkFeatures.forEach(function (feature) {
      var box = featureBbox(feature);
      // Unknown geometry is kept, so a missing bbox can never hide data.
      if (box && !lmcBboxesIntersect(view, box)) return;
      wantedIds[feature.id] = true;
      if (!record.ids[feature.id]) wantedFeatures.push(feature);
    });

    var staleIds = [];
    Object.keys(record.ids).forEach(function (id) {
      if (!wantedIds[id]) staleIds.push(id);
    });

    try {
      if (staleIds.length) wmeSDK.Map.removeFeaturesFromLayer({ layerName: info.name, featureIds: staleIds });
      addFeaturesToLmcLayer(info.name, wantedFeatures);
    } catch (e) {
      console.warn(scriptName + ': could not re-window ' + info.name, e);
      return;
    }

    lmcLayerWindows[info.name] = { box: view.slice(), ids: wantedIds };
  }

  /** Re-windows every loaded feature layer (post-pan, after a switch flip, ...). */
  function rewindowLoadedFeatureLayers(force) {
    loadedGeoJSONLayers.forEach(function (info) {
      windowLayerFeatures(info, force);
    });
  }

  /** Debounced re-window after a pan/zoom, so dragging the map does not churn per frame. */
  function scheduleFeatureWindowUpdate() {
    if (!lmcViewFilterEnabled) return;
    clearTimeout(_featureWindowTimer);
    _featureWindowTimer = setTimeout(function () {
      rewindowLoadedFeatureLayers(false);
    }, 250);
  }

  /** Put only the features inside the padded view on the layers, or the whole ward. */
  function setLmcViewFilterEnabled(enabled) {
    lmcViewFilterEnabled = !!enabled;
    saveLmcAutoState();
    rewindowLoadedFeatureLayers(true);
  }

  // Ensures a bbox is known for every ward, reading the IndexedDB cache first and
  // deriving the missing ones from the ward boundary files (batched, one time only).
  async function ensureLmcWardBboxes() {
    if (lmcWardBboxes && Object.keys(lmcWardBboxes).length >= LMC_WARD_COUNT) return lmcWardBboxes;
    if (lmcBboxBuildPromise) return lmcBboxBuildPromise;

    lmcBboxBuildPromise = (async function build() {
      if (!lmcWardBboxes) {
        var cached = await styleDbGet(LMC_BBOX_RECORD_KEY);
        lmcWardBboxes = (cached && cached.style) || {};
      }

      var missing = [];
      for (var ward = 1; ward <= LMC_WARD_COUNT; ward++) {
        if (!lmcWardBboxes[ward]) missing.push(ward);
      }

      if (missing.length > 0) {
        console.log(scriptName + ': indexing ' + missing.length + ' LMC ward bbox(es) from the boundary service.');
        for (var offset = 0; offset < missing.length; offset += LMC_FETCH_CONCURRENCY) {
          var batch = missing.slice(offset, offset + LMC_FETCH_CONCURRENCY);
          setLmcStatus('Building ward index (' + Math.min(offset + LMC_FETCH_CONCURRENCY, missing.length) + '/' + missing.length + ')…');
          await Promise.all(batch.map(async function (ward) {
            try {
              var data = await fetchGeoJson(LMC_BOUNDARY_URL + ward);
              var box = lmcBboxOfFeatures(data && data.features);
              if (box) lmcWardBboxes[ward] = box;
            } catch (e) {
              console.warn(scriptName + ': could not index ward ' + ward, e);
            }
          }));
        }
        await styleDbPut(LMC_BBOX_RECORD_KEY, lmcWardBboxes);
      }

      lmcBboxBuildPromise = null;
      return lmcWardBboxes;
    })();

    return lmcBboxBuildPromise;
  }

  /** Loads one ward's address points and boundary (skipping anything already loaded). */
  async function addLmcWardLayers(ward) {
    var box = (lmcWardBboxes && lmcWardBboxes[ward]) || null;
    var added = 0;

    for (var i = 0; i < 2; i++) {
      var kind = i === 0 ? 'buildings' : 'boundary';
      var layerName = lmcLayerName(ward, kind);

      if (findGeoJsonLayer(layerName)) {
        // Already on the map (loaded earlier, or by hand) - just track it.
        if (!lmcActiveLayers.has(layerName)) {
          lmcActiveLayers.set(layerName, { ward: ward, kind: kind, bbox: box, lastSeen: Date.now() });
        }
        continue;
      }

      try {
        var url = (kind === 'buildings' ? LMC_BUILDING_URL : LMC_BOUNDARY_URL) + ward;
        var data = await fetchGeoJson(url);
        if (!data || !data.features || data.features.length === 0) {
          console.warn(scriptName + ': ward ' + ward + ' ' + kind + ' returned no features.');
          continue;
        }
        createGeoJSONLayer(data, layerName, ward, kind);
        lmcActiveLayers.set(layerName, { ward: ward, kind: kind, bbox: box, lastSeen: Date.now() });
        added++;
      } catch (e) {
        console.warn(scriptName + ': could not load ward ' + ward + ' ' + kind, e);
      }
    }

    return added;
  }

  /** Removes one feature layer from the map and from every piece of bookkeeping. */
  async function removeLmcLayer(layerName) {
    if (findGeoJsonLayer(layerName)) {
      try {
        wmeSDK.Map.removeAllFeaturesFromLayer({ layerName: layerName });
      } catch (e) {
        // Already gone - the removeLayer below is enough.
      }
      try {
        wmeSDK.Map.removeLayer({ layerName: layerName });
      } catch (e) {
        if (!(wmeSDK.Errors && e instanceof wmeSDK.Errors.InvalidStateError)) {
          console.warn(scriptName + ': could not remove layer ' + layerName, e);
        }
      }
      loadedGeoJSONLayers = loadedGeoJSONLayers.filter(function (item) {
        return item.name !== layerName;
      });
    }
    lmcActiveLayers.delete(layerName);
    delete layerStyleStates[layerName];
    delete layerStyleAugments[layerName];
    delete lmcLayerWindows[layerName];
    delete geoJsonLayerOffsets[layerName];
    updateGeoJsonLayerSelector();
    // Shared teardown for both loaders, so it is also the one place a Nepal GIS ward layer
    // can leave the map. If that was the last one, the address card has no ward polygon to
    // resolve a code from any more and comes down (see postalUpdateAddressCard).
    postalNotifyWardLayersChanged();
  }

  // Drops auto-loaded layers that have left the viewport. Two guards stop this from
  // thrashing while panning: a padded viewport (hysteresis) and a grace period, which
  // also keeps a pan back instant. LMC_MAX_LAYERS stays as a hard cap.
  async function pruneLmcLayers(viewport) {
    if (!Array.isArray(viewport)) return 0;
    var keep = lmcPadBbox(viewport, LMC_EVICT_PADDING);
    var now = Date.now();
    var removed = 0;

    if (lmcAutoRemoveEnabled) {
      var waiting = [];
      var entries = Array.from(lmcActiveLayers.entries());
      for (var i = 0; i < entries.length; i++) {
        var layerName = entries[i][0];
        var record = entries[i][1];
        if (!Array.isArray(record.bbox)) continue; // no bbox to test - never evicted by position
        if (lmcBboxesIntersect(keep, record.bbox)) {
          record.lastSeen = now;
          continue;
        }
        var idle = now - record.lastSeen;
        if (idle >= LMC_EVICT_GRACE_MS) {
          await removeLmcLayer(layerName);
          removed++;
        } else {
          waiting.push(LMC_EVICT_GRACE_MS - idle);
        }
      }
      // Nothing else would trigger another pass if the user stops panning now.
      if (waiting.length > 0) scheduleLmcEvictionCheck(Math.min.apply(null, waiting) + 250);
    }

    // Hard cap safety net, always active.
    var excess = lmcActiveLayers.size - LMC_MAX_LAYERS;
    if (excess > 0) {
      var oldestFirst = Array.from(lmcActiveLayers.entries()).sort(function (a, b) {
        return a[1].lastSeen - b[1].lastSeen;
      });
      for (var j = 0; j < oldestFirst.length && excess > 0; j++) {
        await removeLmcLayer(oldestFirst[j][0]);
        removed++;
        excess--;
      }
    }

    return removed;
  }

  /** Master routine: fetch the ticked wards in view, then prune what has left it. */
  async function updateLmcViewportLayers() {
    if (!lmcAutoEnabled || lmcUpdateInFlight) return;
    lmcUpdateInFlight = true;

    var viewport = lmcViewportBbox();
    try {
      if (!viewport) {
        setLmcStatus('Waiting for the map…');
        return;
      }

      var zoom = 0;
      try {
        zoom = wmeSDK.Map.getZoomLevel();
      } catch (e) {
        zoom = LMC_MIN_ZOOM;
      }
      if (zoom < LMC_MIN_ZOOM) {
        // Zoomed out: what is loaded is still in view, so leave it alone instead of
        // churning it away and re-fetching on the way back in.
        setLmcStatus('Zoom ' + zoom + ' — zoom in to ' + LMC_MIN_ZOOM + '+ to load wards');
        return;
      }

      var ticked = Object.keys(lmcEnabledWards)
        .map(Number)
        .sort(function (a, b) {
          return a - b;
        });
      if (ticked.length === 0) {
        await pruneLmcLayers(viewport);
        setLmcStatus('No ward ticked');
        return;
      }

      var bboxes = await ensureLmcWardBboxes();
      var wanted = ticked.filter(function (ward) {
        var box = bboxes[ward];
        return !box || lmcBboxesIntersect(viewport, box);
      });

      if (wanted.length === 0) {
        var removed = await pruneLmcLayers(viewport);
        setLmcStatus('No ticked ward in view' + (removed > 0 ? ' — removed ' + removed + ' layer(s)' : ''));
        return;
      }

      setLmcStatus('Loading ward ' + wanted.join(', ') + '…');
      var added = 0;
      for (var offset = 0; offset < wanted.length; offset += LMC_FETCH_CONCURRENCY) {
        var batch = wanted.slice(offset, offset + LMC_FETCH_CONCURRENCY);
        var results = await Promise.all(batch.map(function (ward) {
          return addLmcWardLayers(ward);
        }));
        added += results.reduce(function (total, value) {
          return total + value;
        }, 0);
      }

      var pruned = await pruneLmcLayers(viewport);
      var summary = (added > 0 ? 'Added ' + added + ' layer(s)' : 'Up to date') + ' — ' + lmcActiveLayers.size + ' loaded';
      if (pruned > 0) summary += ', removed ' + pruned;
      setLmcStatus(summary);
    } catch (e) {
      console.error(scriptName + ': ward viewport update failed', e);
      setLmcStatus('Error: ' + e.message);
    } finally {
      lmcUpdateInFlight = false;
    }
  }

  /** Debounces viewport updates so rapid panning does not trigger repeated fetches. */
  function scheduleLmcViewportUpdate() {
    if (!lmcAutoEnabled) return;
    clearTimeout(lmcDebounceTimer);
    lmcDebounceTimer = setTimeout(function () {
      updateLmcViewportLayers();
    }, LMC_DEBOUNCE_MS);
  }

  /** Queues one follow-up pass so a layer inside its grace period still gets removed. */
  function scheduleLmcEvictionCheck(delayMs) {
    if (lmcEvictTimer) return; // a pass is already queued
    lmcEvictTimer = setTimeout(function () {
      lmcEvictTimer = null;
      if (lmcAutoEnabled) updateLmcViewportLayers();
    }, Math.max(delayMs, 250));
  }

  // --- Ward group state (localStorage: prefs, IndexedDB: data) ---
  function loadLmcAutoState() {
    var saved = npwLoadJson(LMC_AUTO_STORAGE_KEY, {});
    lmcAutoEnabled = !!saved.enabled;
    lmcAutoRemoveEnabled = saved.autoRemove !== false;
    lmcViewFilterEnabled = saved.viewFilter !== false;
    lmcEnabledWards = {};
    (saved.wards || []).forEach(function (ward) {
      lmcEnabledWards[Number(ward)] = true;
    });
  }

  function saveLmcAutoState() {
    npwSaveJson(LMC_AUTO_STORAGE_KEY, {
      enabled: lmcAutoEnabled,
      autoRemove: lmcAutoRemoveEnabled,
      viewFilter: lmcViewFilterEnabled,
      wards: Object.keys(lmcEnabledWards).map(Number),
    });
  }

  function setLmcAutoEnabled(enabled) {
    lmcAutoEnabled = !!enabled;
    saveLmcAutoState();
    if (lmcAutoEnabled) {
      setLmcStatus('Scanning viewport…');
      scheduleLmcViewportUpdate();
    } else {
      setLmcStatus('Disabled');
    }
  }

  function setLmcAutoRemoveEnabled(enabled) {
    lmcAutoRemoveEnabled = !!enabled;
    saveLmcAutoState();
    if (lmcAutoEnabled) scheduleLmcViewportUpdate();
  }

  /** Ticking a ward queues it for loading; unticking removes its layers immediately. */
  async function setLmcWardEnabled(ward, enabled) {
    ward = Number(ward);
    if (enabled) {
      lmcEnabledWards[ward] = true;
    } else {
      delete lmcEnabledWards[ward];
    }
    saveLmcAutoState();

    if (!enabled) {
      var names = Array.from(lmcActiveLayers.entries())
        .filter(function (entry) {
          return entry[1].ward === ward;
        })
        .map(function (entry) {
          return entry[0];
        });
      for (var i = 0; i < names.length; i++) {
        await removeLmcLayer(names[i]);
      }
    }

    if (lmcAutoEnabled) scheduleLmcViewportUpdate();
    else if (!enabled) setLmcStatus('Ward ' + ward + ' layers removed');
  }

  /** Removes every loaded feature layer (the ward group's "Clear" button). */
  async function clearLmcViewportLayers() {
    // `loadedGeoJSONLayers` is the authoritative list - it also covers a layer that is
    // no longer tracked in lmcActiveLayers (one loaded before the group was rebuilt),
    // so nothing can be left behind on the map.
    var names = loadedGeoJSONLayers.map(function (info) {
      return info.name;
    });
    for (var i = 0; i < names.length; i++) {
      await removeLmcLayer(names[i]);
    }
    setLmcStatus(names.length > 0 ? 'Cleared ' + names.length + ' layer(s)' : 'Nothing to clear');
    if (names.length > 0) {
      WazeToastr.Alerts.success(scriptName, 'Removed ' + names.length + ' layer(s)', false, false, 2000);
    }
  }

  /* ------------------------------------------------------------------
     "Nepal GIS Layers" - hierarchy viewport auto-loader
     Ported from the WME GeoFile script (WME-NP-GIS-Layers). Same viewport model as
     the LMC ward loader above (bbox test + padded eviction + grace period +
     debounce), but the areas are DISCOVERED from the published manifests instead of
     a fixed ward list, so the whole country is covered:

       KML_Wards/index.json            province tier (7 entries, each with a bbox)
       KML_Wards/<PROV>/index.json     one entry per local unit: file + bbox
       KML_Wards/<PROV>/<DIST>/<Mun>/<file>.kml

     Both manifest tiers carry the bbox, so no per-ward bbox needs deriving the way
     the LMC endpoints forced - a ward KML is only downloaded once its manifest bbox
     intersects the view. Downloads are parsed once per session and kept in
     npGisFeatureCache / npGisOutlineCache, so a pan back is free.

     The four hierarchy levels come from three sources:
       province          ->  outlines/province.json        (all 7, dissolved)
       district          ->  outlines/<PROV>-<DISTRICT>.json
       municipality      ->  KML_Municipality/<PROV>/<Mun>.kml  (per local unit)
       ward              ->  KML_Wards/<PROV>/.../<unit>.kml    (per local unit)
     Both KML tiers publish a two-stage manifest (index.json -> <PROV>/index.json),
     and every manifest item carries its own bbox, so a file is only ever fetched when
     its OWN bbox is in view. The outlines/ files carry their bbox in-file.

     `KML_Province/<PROV>.kml` exists but is deliberately NOT used: it is a province-wide
     BUNDLE of municipality polygons (schema name "Nepal_Local_Level_Label", 124
     placemarks for Bagmati, 4.8-6.8 MB) and not a province outline at all. The
     dissolved province geometry only exists in outlines/province.json, which covers all
     seven provinces in ~690 KB.

     The country level of the source script is not ported, so `wmeGisLBBOX` is never
     called here - the manifest and outline bboxes are the only viewport test.

     The KMLs are GeoFile exports: GeoKMLer prefixes every <SimpleData> name with
     "ex_", so the ward label lives in NP_GIS_LABEL_FIELD (ex_Address).
     ------------------------------------------------------------------ */
  var NP_GIS_PAGES_ROOT = 'https://kid4rm90s.github.io/WME-Nepal-GIS-Layers/';
  var NP_GIS_WARDS_PATH = 'KML_Wards/';
  var NP_GIS_MUNICIPALITY_PATH = 'KML_Municipality/';
  var NP_GIS_OUTLINES_PATH = 'outlines/';   // dissolved province/district outlines
  var NP_GIS_ROOT_INDEX = 'index.json';
  var NP_GIS_LABEL_FIELD = 'ex_Address';    // GeoKMLer-prefixed ward title
  var NP_GIS_DEBOUNCE_MS = 400;             // debounce applied to wme-map-move-end
  var NP_GIS_FETCH_CONCURRENCY = 4;         // parallel downloads per batch
  // Higher than the LMC loader's 60 on purpose: the municipality level is one layer per
  // local unit (730 nationally), so a dense view can hold many small layers at once.
  var NP_GIS_MAX_LAYERS = 120;              // hard cap on the number of viewport layers
  var NP_GIS_EVICT_PADDING = 0.5;           // keep a layer until it is 50% of a viewport clear
  var NP_GIS_EVICT_GRACE_MS = 8000;         // ...and only once it has been out of range this long
  var NP_GIS_KML_TIMEOUT_MS = 60000;        // one KML can be ~0.5 MB, so allow longer than JSON
  var NP_GIS_OUTLINE_TIMEOUT_MS = 60000;    // province.json is ~0.7 MB on its own
  var NP_GIS_AUTO_STORAGE_KEY = '_wme_nepali_wms_np_gis';

  // Draw order, bottom -> top: parent fills must render underneath the ward outlines.
  // Only the ticked levels are ever requested.
  var NP_GIS_LEVELS = ['province', 'district', 'municipality', 'ward'];
  var NP_GIS_LEVEL_LABEL = {
    province: 'Province',
    district: 'District',
    municipality: 'Municipality',
    ward: 'Ward',
  };
  // One layer-name / id prefix per level, e.g. NP_P_BA / NP_D_BA_BHAKTAPUR /
  // NP_M_BA_BHAKTAPUR / NP_W_BA_BHAKTAPUR_Bhaktapur.
  var NP_GIS_LEVEL_PREFIX = {
    province: 'NP_P_',
    district: 'NP_D_',
    municipality: 'NP_M_',
    ward: 'NP_W_',
  };
  // Only a stroke colour and a relative line weight stay per level, so the hierarchy stays
  // readable when several levels are drawn at once. Every other style value - font size,
  // line opacity/style, fill opacity, label colour, outline and position - still comes from
  // the Style Settings card, applied through layerStyleAugments so a style change cannot
  // drop the level's colour or weight.
  var NP_GIS_LEVEL_STYLE = {
    province: { color: '#E53935', weight: 3 },      // red
    district: { color: '#FB8C00', weight: 2 },      // orange
    municipality: { color: '#26C6DA', weight: 2 },  // cyan
    ward: { color: '#e100ff', weight: 1 },          // magenta
  };
  // The outline levels are drawn from dissolved polygons that carry no display name of
  // their own, so they were originally routed through the unlabelled 'boundary' type.
  // They now get a per-level DEFAULT LABEL instead (see NP_GIS_LEVEL_DEFAULT_LABEL), and
  // because a set labelField short-circuits the labelled/unlabelled trait in
  // npwResolveLabelText, the 'boundary' type still renders those labels correctly.
  var NP_GIS_OUTLINE_LAYER_TYPE = 'boundary';

  // Minimum zoom at which each level is loaded. Everything is load-on-demand, so a level
  // that is below its gate is simply not fetched - and its already-loaded layers are
  // dropped again, because a gate that left its layers behind would not gate anything
  // (see pruneNpGisLayersAboveZoom).
  var NP_GIS_LEVEL_MIN_ZOOM = {
    province: 8,
    district: 10,
    municipality: 11,
    ward: 14,
  };

  // The label each level uses while the user has not picked a label field of their own
  // (see npGisLevelAugment). These are the same ${attr} templates the Style Settings
  // label-field box accepts, so they can be copied there to be edited.
  // The ward level is absent on purpose: it keeps its built-in ex_Address label.
  // NOTE: `ex\u0938\u094d\u0925` is a Devanagari SimpleField name in the KML_Municipality
  // export, and the `\n` is the formatter's line-break escape (a real newline here would
  // simply end the string literal).
  var NP_GIS_LEVEL_DEFAULT_LABEL = {
    province: 'name',
    district: 'district',
    municipality: '${ex_Changed_Na}\\n${ex_\u0938\u094d\u0925}',
  };

  var npGisEnabled = false;                 // master switch of the group
  var npGisAutoRemoveEnabled = true;        // drop layers that leave the padded viewport
  // Ward only by default: it is the level the loader was ported for, and the three outline
  // levels are wide fills that would hide the map if they came on unasked.
  var npGisLevelsEnabled = { province: false, district: false, municipality: false, ward: true };
  var npGisDebounceTimer = null;
  var npGisEvictTimer = null;
  var npGisUpdateInFlight = false;
  var npGisRootIndexCache = null;           // KML_Wards/index.json
  var npGisProvinceIndexCache = new Map();  // provKey -> the KML_Wards province manifest
  var npGisMunicipalityIndexCache = new Map(); // provKey -> the KML_Municipality manifest
  var npGisFeatureCache = new Map();        // base path + file -> Promise<{ geojson, features }>
  var npGisOutlineCache = new Map();        // outlines/... path -> Promise<features>
  var npGisActiveLayers = new Map();        // layer name -> { level, file, bbox, lastSeen }
  var npGisPropertyLogged = false;          // one-off diagnostic of a parsed KML's property keys

  /** True while at least one hierarchy level is ticked. */
  function npGisAnyLevelEnabled() {
    return NP_GIS_LEVELS.some(function (level) {
      return !!npGisLevelsEnabled[level];
    });
  }

  /** True when `zoom` is close enough in for the level to be loaded. */
  function npGisLevelAllowedAtZoom(level, zoom) {
    var min = NP_GIS_LEVEL_MIN_ZOOM[level];
    return min === undefined || zoom >= min;
  }

  /** The ticked levels that are also allowed at `zoom`, in draw order. */
  function npGisLevelsAtZoom(zoom) {
    return NP_GIS_LEVELS.filter(function (level) {
      return !!npGisLevelsEnabled[level] && npGisLevelAllowedAtZoom(level, zoom);
    });
  }

  /** Layer name for a level + key, sanitised the way the SDK layer ids expect. */
  function npGisLevelLayerName(level, key) {
    var prefix = NP_GIS_LEVEL_PREFIX[level] || 'NP_X_';
    return prefix + String(key).replace(/[^a-z0-9_-]/gi, '_');
  }

  /** Builds a GitHub Pages URL from a repo-relative path (Pages paths are case-sensitive). */
  function npGisUrl(relPath) {
    return NP_GIS_PAGES_ROOT + relPath.split('/').map(encodeURIComponent).join('/');
  }

  // GETs a text resource through GM_xmlhttpRequest (no CORS limits). `headers` is
  // optional and used by the postal-code loader, which talks to Google Sheets.
  function npGisFetchText(url, timeoutMs, headers) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        headers: headers || {},
        timeout: timeoutMs || 30000,
        onload: function (response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error('HTTP ' + response.status + ' for ' + url));
            return;
          }
          resolve(response.responseText);
        },
        onerror: function () {
          reject(new Error('network error for ' + url));
        },
        ontimeout: function () {
          reject(new Error('request timeout for ' + url));
        },
      });
    });
  }

  function getNpGisRootIndex() {
    if (!npGisRootIndexCache) {
      npGisRootIndexCache = npGisFetchText(npGisUrl(NP_GIS_WARDS_PATH + NP_GIS_ROOT_INDEX))
        .then(function (text) {
          return JSON.parse(text);
        })
        .catch(function (e) {
          npGisRootIndexCache = null; // allow a retry on a later pass
          throw e;
        });
    }
    return npGisRootIndexCache;
  }

  function getNpGisProvinceIndex(provKey, relPath) {
    if (!npGisProvinceIndexCache.has(provKey)) {
      npGisProvinceIndexCache.set(
        provKey,
        npGisFetchText(npGisUrl(NP_GIS_WARDS_PATH + relPath))
          .then(function (text) {
            return JSON.parse(text);
          })
          .catch(function (e) {
            npGisProvinceIndexCache.delete(provKey); // allow a retry on a later pass
            throw e;
          })
      );
    }
    return npGisProvinceIndexCache.get(provKey);
  }

  /** The KML_Municipality manifest of one province (one entry per local unit). */
  function getNpGisMunicipalityIndex(provKey) {
    if (!npGisMunicipalityIndexCache.has(provKey)) {
      npGisMunicipalityIndexCache.set(
        provKey,
        npGisFetchText(npGisUrl(NP_GIS_MUNICIPALITY_PATH + provKey + '/' + NP_GIS_ROOT_INDEX))
          .then(function (text) {
            return JSON.parse(text);
          })
          .catch(function (e) {
            npGisMunicipalityIndexCache.delete(provKey); // allow a retry on a later pass
            throw e;
          })
      );
    }
    return npGisMunicipalityIndexCache.get(provKey);
  }

  /** Layer name / key for one ward manifest item: NP_W_BA_BHAKTAPUR_Bhaktapur. */
  function npGisLayerNameFor(item) {
    var base = String(item.file || '').split('/').pop().replace(/\.kml$/i, '');
    return npGisLevelLayerName('ward', base);
  }

  // Per-level structural style, registered through layerStyleAugments so it survives a
  // Style Settings change. `state.lineSize` is MULTIPLIED by the level's relative weight
  // rather than overwritten, so the hierarchy keeps its proportions when the Line Size
  // slider moves - which is exactly why this has to re-run after every style resolve.
  function npGisLevelAugment(level) {
    var levelStyle = NP_GIS_LEVEL_STYLE[level] || {};
    var defaultLabel = NP_GIS_LEVEL_DEFAULT_LABEL[level] || '';
    return function (state) {
      if (levelStyle.color) state.strokeColor = levelStyle.color;
      state.lineSize = (Number(state.lineSize) || 0) * (levelStyle.weight || 1);
      // The sentinels mean "follow the stroke colour", and resolveStyleValues already
      // resolved them against the BASE colour - so that has to be redone here.
      if (state.labelColorSync) state.labelColor = state.strokeColor;
      if (state.outlineColorSync) state.outlineColor = state.strokeColor;
      // The level's default label applies only while nothing has been chosen for it: an
      // empty labelField means "the layer type's built-in label", and for these levels the
      // built-in label IS the level default. LABEL_FIELD_NONE and any user template are
      // non-empty, so either one wins and survives the next style resolve.
      if (!state.labelField && defaultLabel) state.labelField = defaultLabel;
    };
  }

  // GeoKMLer hands back Multi* geometries, and every split part must own its properties
  // object: createGeoJSONLayer writes `__bbox` and `custom_label` per feature, so a
  // shared properties object would make the last part's bbox win for all of them.
  // Z ordinates are stripped later by createGeoJSONLayer (removeZCoordinates).
  function npGisFlattenCollection(collection) {
    var features = [];
    var source = (collection && collection.features) || [];

    var cloneProperties = function (properties) {
      var copy = {};
      Object.keys(properties || {}).forEach(function (key) {
        copy[key] = properties[key];
      });
      return copy;
    };

    var push = function (geometry, properties) {
      features.push({ type: 'Feature', geometry: geometry, properties: cloneProperties(properties) });
    };

    source.forEach(function (feature) {
      if (!feature || !feature.geometry) return;
      var geometry = feature.geometry;
      var properties = feature.properties || {};
      var parts = geometry.coordinates;

      if (geometry.type === 'MultiPolygon' && Array.isArray(parts)) {
        parts.forEach(function (polygon) {
          push({ type: 'Polygon', coordinates: polygon }, properties);
        });
      } else if (geometry.type === 'MultiLineString' && Array.isArray(parts)) {
        parts.forEach(function (line) {
          push({ type: 'LineString', coordinates: line }, properties);
        });
      } else if (geometry.type === 'MultiPoint' && Array.isArray(parts)) {
        parts.forEach(function (point) {
          push({ type: 'Point', coordinates: point }, properties);
        });
      } else {
        push(geometry, properties);
      }
    });

    return { type: 'FeatureCollection', features: features };
  }

  // Downloads + parses one KML once per session (the parsed features are reused, so a pan
  // back is free). `basePath` keeps the two KML trees apart - a ward file and a
  // municipality file can share a basename, so the cache key is the full relative path.
  function getNpGisKmlFeatures(basePath, item) {
    var cacheKey = basePath + item.file;
    if (!npGisFeatureCache.has(cacheKey)) {
      npGisFeatureCache.set(
        cacheKey,
        npGisFetchText(npGisUrl(cacheKey), NP_GIS_KML_TIMEOUT_MS)
          .then(function (text) {
            if (typeof GeoKMLer !== 'function') {
              throw new Error('GeoKMLer is unavailable - check the @require entry');
            }
            var reader = new GeoKMLer();
            var collection = npGisFlattenCollection(reader.toGeoJSON(reader.read(text), true));
            if (collection.features.length > 0 && !npGisPropertyLogged) {
              npGisPropertyLogged = true;
              console.log(
                scriptName + ': Nepal GIS KML property keys (' + cacheKey + ') ->',
                Object.keys(collection.features[0].properties)
              );
            }
            return { geojson: collection, features: collection.features };
          })
          .catch(function (e) {
            npGisFeatureCache.delete(cacheKey); // allow a retry on a later pass
            throw e;
          })
      );
    }
    return npGisFeatureCache.get(cacheKey);
  }

  // Downloads + caches one dissolved-outline FeatureCollection. These files are already
  // WGS84 with no Z, so no transform pass is needed - but they ARE flattened, because
  // province.json ships two MultiPolygons and the ward KMLs are flattened for the same
  // reason (single geometries are what the SDK layer handling is happiest with).
  function getNpGisOutlineFeatures(relPath) {
    if (!npGisOutlineCache.has(relPath)) {
      npGisOutlineCache.set(
        relPath,
        npGisFetchText(npGisUrl(NP_GIS_OUTLINES_PATH + relPath), NP_GIS_OUTLINE_TIMEOUT_MS)
          .then(function (text) {
            var collection = npGisFlattenCollection(JSON.parse(text));
            if (collection.features.length === 0) {
              throw new Error('no features in ' + relPath);
            }
            return collection.features;
          })
          .catch(function (e) {
            npGisOutlineCache.delete(relPath); // allow a retry on a later pass
            throw e;
          })
      );
    }
    return npGisOutlineCache.get(relPath);
  }

  // Creates one outline layer for a level, from the features a single outline file holds
  // for that level.
  // DELIBERATE DEVIATION from WME GeoFile: that script keys its district layer by PROVINCE
  // and appends every visible district to it, which forces a parts-Set per layer and an
  // append path that has to keep its own feature store in sync. Here each outline file
  // becomes its own layer per level (NP_D_BA_BHAKTAPUR), so a layer is always created whole
  // and never appended to - eviction then works per district instead of per province, and
  // nothing has to be pushed into loadedGeoJSONLayers after creation.
  async function addNpGisOutlineLayer(level, layerKey, relPath, bbox, select, displayKey) {
    if (!npGisLevelsEnabled[level]) return 0;

    var layerName = npGisLevelLayerName(level, layerKey);
    if (npGisActiveLayers.has(layerName) || findGeoJsonLayer(layerName)) return 0;

    var features = (await getNpGisOutlineFeatures(relPath)).filter(select);
    if (features.length === 0) return 0;

    npGisActiveLayers.set(layerName, { level: level, file: relPath, bbox: bbox, lastSeen: Date.now() });
    layerStyleAugments[layerName] = npGisLevelAugment(level);
    try {
      createGeoJSONLayer(
        { type: 'FeatureCollection', features: features },
        layerName,
        displayKey,
        NP_GIS_OUTLINE_LAYER_TYPE
      );
    } catch (e) {
      npGisActiveLayers.delete(layerName); // allow a retry on a later pass
      delete layerStyleAugments[layerName];
      throw e;
    }
    return 1;
  }

  /** Fetches one in-view ward KML and puts it on its own layer. */
  async function addNpGisWardLayer(item) {
    var layerName = npGisLayerNameFor(item);
    // Already tracked, or loaded by hand earlier - nothing to do either way.
    if (npGisActiveLayers.has(layerName) || findGeoJsonLayer(layerName)) return 0;

    var loaded = await getNpGisKmlFeatures(NP_GIS_WARDS_PATH, item);
    if (!loaded.features.length) {
      console.warn(scriptName + ': ' + item.file + ' produced no features - skipped.');
      return 0;
    }

    npGisActiveLayers.set(layerName, { level: 'ward', file: item.file, bbox: item.bbox, lastSeen: Date.now() });
    layerStyleAugments[layerName] = npGisLevelAugment('ward');
    try {
      // 'ward' type: labelled from custom_label, which createGeoJSONLayer fills from
      // the KML's ex_Address. `wardNo` only feeds the log line; the shift pairing in
      // shiftGeoJsonLayer looks for LMC_Ward_* partners and simply finds none.
      createGeoJSONLayer(loaded.geojson, layerName, item.municipality || item.district, 'ward');
    } catch (e) {
      npGisActiveLayers.delete(layerName); // allow a retry on a later pass
      delete layerStyleAugments[layerName];
      throw e;
    }
    return 1;
  }

  // Fetches one in-view municipality KML and puts it on its own layer. The file path is
  // `<PROV>/<Municipality>.kml`, so both the province key and the layer name come from it.
  // Unlabelled on purpose: this tree is a raw ArcGIS export whose attribute names are
  // unusable (`District_2`, `GAPA_NAP_2`, `GN_TYPE_13`, plus one mojibake Devanagari
  // field name), so only the geometry and the manifest bbox are taken from it.
  async function addNpGisMunicipalityLayer(item) {
    if (!npGisLevelsEnabled.municipality) return 0;

    var relPath = String(item.file || '');
    var provKey = relPath.split('/')[0];
    var base = relPath.split('/').pop().replace(/\.kml$/i, '');
    var layerName = npGisLevelLayerName('municipality', provKey + '_' + base);
    if (npGisActiveLayers.has(layerName) || findGeoJsonLayer(layerName)) return 0;

    var loaded = await getNpGisKmlFeatures(NP_GIS_MUNICIPALITY_PATH, item);
    if (!loaded.features.length) {
      console.warn(scriptName + ': ' + item.file + ' produced no features - skipped.');
      return 0;
    }

    npGisActiveLayers.set(layerName, {
      level: 'municipality',
      file: item.file,
      bbox: item.bbox,
      lastSeen: Date.now(),
    });
    layerStyleAugments[layerName] = npGisLevelAugment('municipality');
    try {
      createGeoJSONLayer(
        loaded.geojson,
        layerName,
        item.municipality || base,
        NP_GIS_OUTLINE_LAYER_TYPE
      );
    } catch (e) {
      npGisActiveLayers.delete(layerName); // allow a retry on a later pass
      delete layerStyleAugments[layerName];
      throw e;
    }
    return 1;
  }

  /** Downloads manifest items in batches, tolerating a per-item failure. */
  async function loadNpGisBatch(items, loader) {
    var added = 0;
    for (var offset = 0; offset < items.length; offset += NP_GIS_FETCH_CONCURRENCY) {
      var batch = items.slice(offset, offset + NP_GIS_FETCH_CONCURRENCY);
      var results = await Promise.all(
        batch.map(function (item) {
          return loader(item).catch(function (e) {
            console.warn(scriptName + ': could not load ' + item.file, e);
            return 0;
          });
        })
      );
      added += results.reduce(function (total, value) {
        return total + value;
      }, 0);
    }
    return added;
  }

  // Removes one Nepal GIS layer. removeLmcLayer() is the shared single-layer teardown
  // (SDK layer + loadedGeoJSONLayers entry + style state + window + offset + dropdown
  // refresh), so it is reused here rather than duplicated.
  async function removeNpGisLayer(layerName) {
    npGisActiveLayers.delete(layerName);
    await removeLmcLayer(layerName);
  }

  // Drops auto-loaded ward layers that have left the viewport. Same two guards as the
  // LMC loader: a padded viewport (hysteresis) and a grace period, which also keeps a
  // pan back instant. NP_GIS_MAX_LAYERS stays as a hard cap.
  async function pruneNpGisLayers(viewport) {
    if (!Array.isArray(viewport)) return 0;
    var keep = lmcPadBbox(viewport, NP_GIS_EVICT_PADDING);
    var now = Date.now();
    var removed = 0;

    if (npGisAutoRemoveEnabled) {
      var waiting = [];
      var entries = Array.from(npGisActiveLayers.entries());
      for (var i = 0; i < entries.length; i++) {
        var layerName = entries[i][0];
        var record = entries[i][1];
        if (!Array.isArray(record.bbox)) continue; // no bbox to test - never evicted by position
        if (lmcBboxesIntersect(keep, record.bbox)) {
          record.lastSeen = now;
          continue;
        }
        var idle = now - record.lastSeen;
        if (idle >= NP_GIS_EVICT_GRACE_MS) {
          await removeNpGisLayer(layerName);
          removed++;
        } else {
          waiting.push(NP_GIS_EVICT_GRACE_MS - idle);
        }
      }
      // Nothing else would trigger another pass if the user stops panning now.
      if (waiting.length > 0) scheduleNpGisEvictionCheck(Math.min.apply(null, waiting) + 250);
    }

    // Hard cap safety net (always active, even with auto-remove switched off).
    var excess = npGisActiveLayers.size - NP_GIS_MAX_LAYERS;
    if (excess > 0) {
      var oldestFirst = Array.from(npGisActiveLayers.entries()).sort(function (a, b) {
        return a[1].lastSeen - b[1].lastSeen;
      });
      for (var j = 0; j < oldestFirst.length; j++) {
        if (excess <= 0) break;
        await removeNpGisLayer(oldestFirst[j][0]);
        removed++;
        excess--;
      }
    }

    return removed;
  }

  // Drops the layers of levels that `zoom` is too far out for.
  // Unlike the position-based eviction above this is IMMEDIATE, with no padding or grace
  // period: a zoom gate that left its layers behind would not gate anything, and a
  // province-wide view would otherwise keep every ward polygon it had ever loaded.
  // Nothing is lost by it - the parsed KMLs stay in npGisFeatureCache, so zooming back in
  // re-creates the layers without touching the network.
  async function pruneNpGisLayersAboveZoom(zoom) {
    var names = [];
    npGisActiveLayers.forEach(function (record, layerName) {
      // A level the user has switched off is left to setNpGisLevelEnabled().
      if (!npGisLevelsEnabled[record.level]) return;
      if (npGisLevelAllowedAtZoom(record.level, zoom)) return;
      names.push(layerName);
    });
    for (var i = 0; i < names.length; i++) {
      await removeNpGisLayer(names[i]);
    }
    return names.length;
  }

  // Master routine. Levels are gated by zoom first (see NP_GIS_LEVEL_MIN_ZOOM), then
  // intersection testing happens in stages so only the files that can actually be visible
  // are ever downloaded:
  //   1. the root manifest's province bboxes;
  //   2. per province, the ward manifest's per-local-unit bboxes (which also give the
  //      districts in view) and the municipality manifest's own per-local-unit bboxes.
  // The province level reads the shared outlines/province.json and the district level
  // outlines/<PROV>-<DISTRICT>.json; municipalities and wards each read their own
  // per-local-unit KML tree, so every layer owns the bbox it was fetched for. Lighter
  // files load first and the ward KMLs (up to ~0.5 MB each) last. Every pass ends by
  // pruning the layers that have drifted out of the viewport.
  async function updateNpGisViewportLayers() {
    if (!npGisEnabled || npGisUpdateInFlight) return;
    npGisUpdateInFlight = true;

    var viewport = lmcViewportBbox();
    try {
      if (!viewport) {
        setNpGisStatus('Waiting for the map…');
        return;
      }

      if (!npGisAnyLevelEnabled()) {
        setNpGisStatus('No level ticked');
        await pruneNpGisLayers(viewport);
        return;
      }

      var zoom = 0;
      try {
        zoom = wmeSDK.Map.getZoomLevel();
      } catch (e) {
        // Assume the most permissive gate rather than blocking every level.
        zoom = NP_GIS_LEVEL_MIN_ZOOM.ward;
      }

      // Levels below their zoom gate are dropped first, so the pass below only ever sees
      // what the current zoom is actually allowed to show.
      var zoomRemoved = await pruneNpGisLayersAboveZoom(zoom);
      var levelsAllowed = npGisLevelsAtZoom(zoom);

      if (levelsAllowed.length === 0) {
        await pruneNpGisLayers(viewport);
        setNpGisStatus(
          'Zoom ' +
            zoom +
            ' — ' +
            NP_GIS_LEVELS.filter(function (level) {
              return !!npGisLevelsEnabled[level];
            })
              .map(function (level) {
                return NP_GIS_LEVEL_LABEL[level] + ' needs zoom ' + NP_GIS_LEVEL_MIN_ZOOM[level] + '+';
              })
              .join(', ')
        );
        return;
      }

      var isLevelAllowed = function (level) {
        return levelsAllowed.indexOf(level) !== -1;
      };

      var rootIndex = await getNpGisRootIndex();
      var provinces = [];
      var provinceMap = (rootIndex && rootIndex.provinces) || {};
      Object.keys(provinceMap).forEach(function (provKey) {
        var info = provinceMap[provKey] || {};
        if (Array.isArray(info.bbox) && lmcBboxesIntersect(viewport, info.bbox)) {
          provinces.push({ key: provKey, info: info });
        }
      });

      if (provinces.length === 0) {
        var noneInView = await pruneNpGisLayers(viewport);
        setNpGisStatus(
          'No Nepal province in view' + (noneInView > 0 ? ' — removed ' + noneInView + ' layer(s)' : '')
        );
        return;
      }

      setNpGisStatus(
        'Scanning ' +
          provinces
            .map(function (province) {
              return province.info.name || province.key;
            })
            .join(', ') +
          '…'
      );

      var wantedWards = [];
      var wantedMunicipalities = [];
      var added = 0;
      var outlineErrors = 0;
      var noteOutlineError = function (e) {
        outlineErrors++;
        console.warn(scriptName + ': could not load an outline layer', e);
        return 0;
      };

      for (var p = 0; p < provinces.length; p++) {
        var provKey = provinces[p].key;
        var info = provinces[p].info;
        var provinceIndex = null;
        try {
          provinceIndex = await getNpGisProvinceIndex(provKey, info.index || provKey + '/index.json');
        } catch (e) {
          console.warn(scriptName + ': could not load the ' + provKey + ' ward manifest', e);
          continue;
        }

        // Province outline: a single feature selected out of the shared province.json.
        if (isLevelAllowed('province')) {
          added += await addNpGisOutlineLayer(
            'province',
            provKey,
            'province.json',
            Array.isArray(info.bbox) ? info.bbox : null,
            function (feature) {
              return feature.properties && feature.properties.province === provKey;
            },
            info.name || provKey
          ).catch(noteOutlineError);
        }

        // A district's bbox is the union of the local units the manifest lists for it,
        // which is also the test for whether its outline file is worth downloading.
        var items = (provinceIndex && provinceIndex.items) || [];
        var districts = new Map();
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          if (!Array.isArray(item.bbox) || !lmcBboxesIntersect(viewport, item.bbox)) continue;
          var known = districts.get(item.district);
          districts.set(item.district, {
            bbox: known ? lmcUnionBbox(known.bbox, item.bbox) : item.bbox,
          });
          wantedWards.push(item);
        }

        if (isLevelAllowed('district')) {
          var districtKeys = Array.from(districts.keys());
          for (var d = 0; d < districtKeys.length; d++) {
            var districtKey = districtKeys[d];
            added += await addNpGisOutlineLayer(
              'district',
              provKey + '_' + districtKey,
              provKey + '-' + districtKey + '.json',
              districts.get(districtKey).bbox,
              function (feature) {
                return feature.properties && feature.properties.level === 'district';
              },
              districtKey
            ).catch(noteOutlineError);
          }
        }

        // Municipalities read their own per-local-unit manifest, so each layer gets its own
        // bbox and a whole district file is never fetched just to reach one local unit.
        if (isLevelAllowed('municipality')) {
          try {
            var munIndex = await getNpGisMunicipalityIndex(provKey);
            var munItems = (munIndex && munIndex.items) || [];
            for (var m = 0; m < munItems.length; m++) {
              if (Array.isArray(munItems[m].bbox) && lmcBboxesIntersect(viewport, munItems[m].bbox)) {
                wantedMunicipalities.push(munItems[m]);
              }
            }
          } catch (e) {
            console.warn(scriptName + ': could not load the ' + provKey + ' municipality manifest', e);
          }
        }
      }

      // Then the downloads, lightest first: a municipality KML is ~13 KB, a ward KML up to
      // ~0.5 MB.
      if (isLevelAllowed('municipality')) {
        added += await loadNpGisBatch(wantedMunicipalities, addNpGisMunicipalityLayer);
      }
      if (isLevelAllowed('ward')) {
        added += await loadNpGisBatch(wantedWards, addNpGisWardLayer);
      }

      var removed = await pruneNpGisLayers(viewport);
      var levelsOn = levelsAllowed.join(' + ') || 'none';
      var summary =
        (added > 0 ? 'Added ' + added + ' layer(s)' : 'Up to date') +
        ' — ' +
        npGisActiveLayers.size +
        ' loaded [zoom ' +
        zoom +
        ': ' +
        levelsOn +
        ']';
      if (removed > 0) summary += ', removed ' + removed;
      if (zoomRemoved > 0) summary += ', ' + zoomRemoved + ' below zoom gate';
      if (outlineErrors > 0) summary += ' — ' + outlineErrors + ' outline file(s) unavailable';
      setNpGisStatus(summary);
    } catch (e) {
      console.error(scriptName + ': Nepal GIS viewport update failed', e);
      setNpGisStatus('Error: ' + e.message);
    } finally {
      npGisUpdateInFlight = false;
    }
  }

  /** Updates the sidebar status line for the Nepal GIS loader. */
  function setNpGisStatus(text) {
    var element = document.getElementById('npGisStatus');
    if (element) element.textContent = text;
  }

  /** Debounces viewport updates so rapid panning does not trigger repeated fetches. */
  function scheduleNpGisViewportUpdate() {
    if (!npGisEnabled) return;
    clearTimeout(npGisDebounceTimer);
    npGisDebounceTimer = setTimeout(function () {
      updateNpGisViewportLayers();
    }, NP_GIS_DEBOUNCE_MS);
  }

  /** Queues one follow-up pass so a layer inside its grace period still gets removed. */
  function scheduleNpGisEvictionCheck(delayMs) {
    if (npGisEvictTimer) return; // a pass is already queued
    npGisEvictTimer = setTimeout(function () {
      npGisEvictTimer = null;
      if (npGisEnabled) updateNpGisViewportLayers();
    }, Math.max(delayMs, 250));
  }

  // --- Group state (localStorage) ---
  function loadNpGisState() {
    var saved = npwLoadJson(NP_GIS_AUTO_STORAGE_KEY, {});
    npGisEnabled = !!saved.enabled;
    npGisAutoRemoveEnabled = saved.autoRemove !== false;
    if (saved.levels && typeof saved.levels === 'object') {
      NP_GIS_LEVELS.forEach(function (level) {
        if (typeof saved.levels[level] === 'boolean') npGisLevelsEnabled[level] = saved.levels[level];
      });
    }
  }

  function saveNpGisState() {
    npwSaveJson(NP_GIS_AUTO_STORAGE_KEY, {
      enabled: npGisEnabled,
      autoRemove: npGisAutoRemoveEnabled,
      levels: npGisLevelsEnabled,
    });
  }

  function setNpGisEnabled(enabled) {
    npGisEnabled = !!enabled;
    saveNpGisState();
    if (npGisEnabled) {
      setNpGisStatus('Scanning viewport…');
      scheduleNpGisViewportUpdate();
    } else {
      setNpGisStatus('Disabled');
    }
  }

  function setNpGisAutoRemoveEnabled(enabled) {
    npGisAutoRemoveEnabled = !!enabled;
    saveNpGisState();
    if (npGisEnabled) scheduleNpGisViewportUpdate();
  }

  /** Ticking a level queues it for loading; unticking removes its layers immediately. */
  async function setNpGisLevelEnabled(level, enabled) {
    npGisLevelsEnabled[level] = !!enabled;
    saveNpGisState();

    if (!enabled) {
      var names = Array.from(npGisActiveLayers.entries())
        .filter(function (entry) {
          return entry[1].level === level;
        })
        .map(function (entry) {
          return entry[0];
        });
      for (var i = 0; i < names.length; i++) {
        await removeNpGisLayer(names[i]);
      }
    }

    if (npGisEnabled) scheduleNpGisViewportUpdate();
    else if (!enabled) setNpGisStatus(NP_GIS_LEVEL_LABEL[level] + ' layers removed');
  }

  // Removes every Nepal GIS ward layer of this group (its own "Clear" button). Unlike
  // the LMC card's clear, this deliberately leaves unrelated feature layers alone.
  async function clearNpGisLayers() {
    var names = Array.from(npGisActiveLayers.keys());
    for (var i = 0; i < names.length; i++) {
      await removeNpGisLayer(names[i]);
    }
    setNpGisStatus(names.length > 0 ? 'Cleared ' + names.length + ' layer(s)' : 'Nothing to clear');
    if (names.length > 0) {
      WazeToastr.Alerts.success(scriptName, 'Removed ' + names.length + ' layer(s)', false, false, 2000);
    }
  }

  function findGeoJsonLayer(layerName) {
    for (var i = 0; i < loadedGeoJSONLayers.length; i++) {
      if (loadedGeoJSONLayers[i].name === layerName) return loadedGeoJSONLayers[i];
    }
    return null;
  }

  // Translate every coordinate of a GeoJSON geometry in place - the SDK has no
  // geometry.move(). The recursion covers Point/LineString/Polygon/Multi*.
  function translateGeoJsonCoordinates(coordinates, dLon, dLat) {
    if (!coordinates || coordinates.length === 0) return;
    if (typeof coordinates[0] === 'number') {
      coordinates[0] += dLon;
      coordinates[1] += dLat;
      return;
    }
    for (var i = 0; i < coordinates.length; i++) {
      translateGeoJsonCoordinates(coordinates[i], dLon, dLat);
    }
  }

  function translateGeoJsonFeatures(features, dLon, dLat) {
    if (!features) return;
    features.forEach(function (feature) {
      if (!feature || !feature.geometry) return;
      translateGeoJsonCoordinates(feature.geometry.coordinates, dLon, dLat);
      // Keep the precomputed windowing bbox in step with the shifted coordinates,
      // otherwise a shifted layer would be windowed against its old position.
      var box = feature.properties && feature.properties.__bbox;
      if (Array.isArray(box) && box.length === 4) {
        feature.properties.__bbox = [box[0] + dLon, box[1] + dLat, box[2] + dLon, box[3] + dLat];
      }
    });
  }

  // Draw a geometry change: the feature objects are ours, so they can be removed
  // and re-added (the SDK has no "move feature" call).
  function redrawGeoJsonLayer(info) {
    try {
      wmeSDK.Map.removeAllFeaturesFromLayer({ layerName: info.name });
      wmeSDK.Map.dangerouslyAddFeaturesToLayerWithoutValidation({ features: info.sdkFeatures, layerName: info.name });
    } catch (e) {
      console.error(`${scriptName}: could not re-render layer ${info.name}`, e);
    }
  }

  // Helper: shift a GeoJSON layer. `layerName` and `dist` come from the shared shift
  // pad in the "Layer tools" card (the same pad also drives the WMS layers), which is
  // why nothing is read from a dropdown here any more.
  function shiftGeoJsonLayer(direction, layerName, dist) {
    if (!layerName || !dist) {
      WazeToastr.Alerts.warning('Selection Required', 'Please select a layer and enter a shift distance.', false, false, 2000);
      return;
    }

    // Find the layer
    const layerInfo = loadedGeoJSONLayers.find(l => l.name === layerName);
    if (!layerInfo) return;

    // Find paired layer (boundary/building)
    const layersToShift = [layerInfo];
    const wardNo = layerInfo.wardNo;
    if (wardNo) {
      const pairedLayerName = layerInfo.layerType === 'buildings' 
        ? `LMC_Ward_${wardNo}_Boundary`
        : `LMC_Ward_${wardNo}_Buildings`;
      const pairedLayer = loadedGeoJSONLayers.find(l => l.name === pairedLayerName);
      if (pairedLayer) {
        layersToShift.push(pairedLayer);
      }
    }

    // SDK feature layers always store WGS84 degrees, so the distance is converted
    // from metres to degrees here - the map's own projection is no longer relevant.
    let dx = 0,
      dy = 0; // metres, east / north
    const diag = dist * 0.7071; // sqrt(2)/2 for diagonal

    // Direction convention. SDK features are stored as WGS84 degrees, so +dLon is
    // EAST and +dLat is NORTH, and translating the coordinates moves the drawn
    // content the same way the numbers move. The arrow must therefore move the
    // CONTENTS in its own direction: "left" has to DECREASE the longitude.
    // shiftLayer() (WMS) instead moves the requested BBOX, so its content travels the
    // opposite way and its table is the exact negation of this one (both axes).
    // History: this table was wrongly mirrored for a while (.019 and earlier, and in
    // the pre-merge Nepali-WMS-Layers copy) - left/right plus all four diagonals sent
    // the layer the wrong way. .020 fixed it, .021 restored the mirror by mistake and
    // 2026.09.14.002 puts the correct signs back. Do not negate dx here.
    switch (direction) {
      case 'up': dy = dist; break;
      case 'down': dy = -dist; break;
      case 'left': dx = -dist; break;
      case 'right': dx = dist; break;
      case 'upleft': dx = -diag; dy = diag; break;
      case 'upright': dx = diag; dy = diag; break;
      case 'downleft': dx = -diag; dy = -diag; break;
      case 'downright': dx = diag; dy = -diag; break;
    }

    const centerLat = getMapCenterLat();
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLon = (40075000 * Math.cos((centerLat * Math.PI) / 180)) / 360;
    const dLon = dx / metersPerDegreeLon;
    const dLat = dy / metersPerDegreeLat;

    // Shift all paired layers together
    layersToShift.forEach(info => {
      const shiftLayerName = info.name;

      // Offset is kept in degrees so Reset can undo it exactly
      if (!geoJsonLayerOffsets[shiftLayerName]) {
        geoJsonLayerOffsets[shiftLayerName] = { x: 0, y: 0 };
      }
      geoJsonLayerOffsets[shiftLayerName].x += dLon;
      geoJsonLayerOffsets[shiftLayerName].y += dLat;

      // No geometry.move() in the SDK - translate the coordinates and re-window. A
      // plain redraw would put every feature back, undoing the view windowing.
      translateGeoJsonFeatures(info.sdkFeatures, dLon, dLat);
      if (lmcViewFilterEnabled) windowLayerFeatures(info, true);
      else redrawGeoJsonLayer(info);
    });

    const shiftMsg = layersToShift.length > 1 
      ? `Ward ${wardNo} layers shifted ${dist} meters ${direction}`
      : `Layer shifted ${dist} meters ${direction}`;
    WazeToastr.Alerts.info('Layer Shifted', shiftMsg, false, false, 2000);
  }

  // Helper: reset a GeoJSON layer's shift (same shared-pad call style as above).
  function resetGeoJsonShift(layerName) {
    if (!layerName) {
      WazeToastr.Alerts.warning('Selection Required', 'Please select a layer to reset.', false, false, 2000);
      return;
    }

    // Find the layer
    const layerInfo = loadedGeoJSONLayers.find(l => l.name === layerName);
    if (!layerInfo) return;

    // Find paired layer (boundary/building)
    const layersToReset = [layerInfo];
    const wardNo = layerInfo.wardNo;
    if (wardNo) {
      const pairedLayerName = layerInfo.layerType === 'buildings' 
        ? `LMC_Ward_${wardNo}_Boundary`
        : `LMC_Ward_${wardNo}_Buildings`;
      const pairedLayer = loadedGeoJSONLayers.find(l => l.name === pairedLayerName);
      if (pairedLayer) {
        layersToReset.push(pairedLayer);
      }
    }

    let hasOffset = false;
    layersToReset.forEach(info => {
      const resetLayerName = info.name;
      const offset = geoJsonLayerOffsets[resetLayerName];

      if (offset && (offset.x !== 0 || offset.y !== 0)) {
        hasOffset = true;
        // Move back to original position
        translateGeoJsonFeatures(info.sdkFeatures, -offset.x, -offset.y);

        // Reset offset
        geoJsonLayerOffsets[resetLayerName] = { x: 0, y: 0 };

        // Re-window (or re-render the whole layer when the view filter is off)
        if (lmcViewFilterEnabled) windowLayerFeatures(info, true);
        else redrawGeoJsonLayer(info);
      }
    });

    if (hasOffset) {
      const resetMsg = layersToReset.length > 1
        ? `Ward ${wardNo} layers position reset to original`
        : 'Layer position reset to original';
      WazeToastr.Alerts.success('Shift Reset', resetMsg, false, false, 2000);
    } else {
      WazeToastr.Alerts.info('No Shift', 'Layer has no offset to reset.', false, false, 2000);
    }
  }

  async function init() {
      console.log(`${scriptName} initializing.`);
      W = unsafeWindow.W;
      OL = unsafeWindow.OpenLayers;

      // Feature-layer style settings and the ward group's saved state are read before
      // the panel (and therefore before any layer) is built.
      await loadFeatureStyles();
      loadLmcAutoState();
      loadNpGisState();
      loadPostalState();

      WMSLayersTechSource.tileSizeG = new OL.Size(512, 512);
    WMSLayersTechSource.resolutions = [
      156543.03390625, 78271.516953125, 39135.7584765625, 19567.87923828125, 9783.939619140625, 4891.9698095703125, 2445.9849047851562, 1222.9924523925781, 611.4962261962891, 305.74811309814453, 152.87405654907226, 76.43702827453613,
      38.218514137268066, 19.109257068634033, 9.554628534317017, 4.777314267158508, 2.388657133579254, 1.194328566789627, 0.5971642833948135, 0.298582141697406, 0.149291070848703, 0.0746455354243515, 0.0373227677121757,
    ];
    ZIndexes.base = W.map.getOLMap().Z_INDEX_BASE.Overlay + 20;
    ZIndexes.overlay = W.map.getOLMap().Z_INDEX_BASE.Overlay + 100;
    ZIndexes.popup = W.map.getOLMap().Z_INDEX_BASE.Overlay + 500;

    /* ------------------------------------------------------------------
       Built-in default shifts - "this service is published in the wrong place".
       Keyed by layer key (the WMSLayerTogglers.* name). The values are metres the
       DRAWN CONTENT has to move, named the way you measure them on the map, so a
       correction can be written down straight away:

         { west: 260, north: 20 }  -> pull the layer 260 m west and 20 m north
         { east: 30, south: 15 }   -> push it 30 m east and 15 m south

       Only WMS layers can be shifted (an external XYZ basemap has no bbox to move).
       The shift is in place before the first tile of that layer is drawn - no manual
       nudging needed after a reload. A shift made by hand with the pad is remembered
       per layer as well, and "Reset Shift" returns to the default below.
       ------------------------------------------------------------------ */
    var WMS_LAYER_SHIFT_PRESETS = {
      // DMG's municipal boundary is published ~260 m east and ~20 m south of its real
      // position, so the content is pulled west and north until it lines up with WME.
      wms_dmg_municipality: { west: 250, north: 25 },
      wms_dmg_districts: { west: 250, north: 25 },
    };

    // adresy WMS služeb * WMS service addresses
    var service_wms_PL2023 = {
      type: 'WMS',
      url: 'https://geoserver.softwel.com.np/geoserver/ows/wms?CQL_FILTER=dyear%3D%272023%27',
      attribution: '© DoR / Softwel.com.np',
      comment: 'ssrn_PavementLayer2023',
    };

    var service_wms_softwel = {
      type: 'WMS',
      url: 'https://geoserver.softwel.com.np/geoserver/ows/wms?',
      attribution: '© DoR Nepal/Softwel.com.np',
      comment: 'geoserver softwel.com.np',
    };

    var service_wms_geoportal = {
      type: 'WMS',
      url: 'https://admin.nationalgeoportal.gov.np/geoserver/wms?',
      attribution: '© National Geoportal Nepal',
      comment: 'Municipalities names and boundaries',
    };
    var service_wms_dmgnepal = {
      type: 'WMS',
      url: 'http://gis.dmgnepal.gov.np:8080/geoserver/dmg/wms?',
      attribution: '© Department of Mines and Geology Nepal',
      comment: 'Municipalities names and boundaries',
    };
    // var service_wms_geo_lalitpur = {
    //   type: 'WMS_4326',
    //   url: 'http://localhost:8080/geoserver/geo-lalitpur/wms?',
    //   attribution: '© Geonp.com.np / LMC',
    //   comment: 'Lalitpur House numbers and boundaries',
    // };

    //skupiny vrstev v menu * MapTile service addresses
    var service_xyz_livemap = {
      type: 'XYZ',
      url: ['https://worldtiles1.waze.com/tiles/${z}/${x}/${y}.png?highres=true', 'https://worldtiles2.waze.com/tiles/${z}/${x}/${y}.png?highres=true', 'https://worldtiles3.waze.com/tiles/${z}/${x}/${y}.png?highres=true'],
      attribution: "© 2006-2023 Waze Mobile. Všechna práva vyhrazena. <a href='https://www.waze.com/legal/notices' target='_blank'>Poznámky</a>",
      comment: 'Waze Livemapa',
    };
    var service_xyz_google = {
      type: 'XYZ',
      url: [
        'https://mts0.googleapis.com/vt/lyrs=m&x=${x}&y=${y}&z=${z}',
        'https://mts1.googleapis.com/vt/lyrs=m&x=${x}&y=${y}&z=${z}',
        'https://mts2.googleapis.com/vt/lyrs=m&x=${x}&y=${y}&z=${z}',
        'https://mts3.googleapis.com/vt/lyrs=m&x=${x}&y=${y}&z=${z}',
      ],
      attribution: "Mapová data ©2023 GeoBasis-DE/BKG (©2009),Google <a href='https://www.google.com/intl/cs_cz/help/terms_maps.html' target='_blank'>Terms and conditions</a>",
      comment: 'Google Mapy',
    };
    var service_xyz_google_terrain = {
      type: 'XYZ',
      url: [
        'https://mts0.googleapis.com/vt/lyrs=p&x=${x}&y=${y}&z=${z}',
        'https://mts1.googleapis.com/vt/lyrs=p&x=${x}&y=${y}&z=${z}',
        'https://mts2.googleapis.com/vt/lyrs=p&x=${x}&y=${y}&z=${z}',
        'https://mts3.googleapis.com/vt/lyrs=p&x=${x}&y=${y}&z=${z}',
      ],
      attribution: "Mapová data ©2023 GeoBasis-DE/BKG (©2009),Google <a href='https://www.google.com/intl/cs_cz/help/terms_maps.html' target='_blank'>Terms and conditions</a>",
      comment: 'Google Terénní Mapy',
    };
    var service_xyz_google_hybrid = {
      type: 'XYZ',
      url: [
        'https://mts0.googleapis.com/vt/lyrs=y&x=${x}&y=${y}&z=${z}',
        'https://mts1.googleapis.com/vt/lyrs=y&x=${x}&y=${y}&z=${z}',
        'https://mts2.googleapis.com/vt/lyrs=y&x=${x}&y=${y}&z=${z}',
        'https://mts3.googleapis.com/vt/lyrs=y&x=${x}&y=${y}&z=${z}',
      ],
      attribution: "Snímky ©2023 Landsat / Copernicus, Google, GEODIS Brno, Mapová data ©2023 GeoBasis-DE/BKG (©2009),Google <a href='https://www.google.com/intl/cs_cz/help/terms_maps.html' target='_blank'>Terms and conditions</a>",
      comment: 'Google Hybridní Mapy',
    };
    var service_xyz_google_streetview = {
      type: 'XYZ',
      url: [
        'https://mts0.google.com/mapslt?lyrs=svv&&x=${x}&y=${y}&z=${z}&style=40',
        'https://mts1.google.com/mapslt?lyrs=svv&&x=${x}&y=${y}&z=${z}&style=40',
        'https://mts2.google.com/mapslt?lyrs=svv&&x=${x}&y=${y}&z=${z}&style=40',
        'https://mts3.google.com/mapslt?lyrs=svv&&x=${x}&y=${y}&z=${z}&style=40',
      ],
      attribution: "Google <a href='https://www.google.com/intl/cs_cz/help/terms_maps.html' target='_blank'>Terms and conditions</a>",
      comment: 'Google Streetview',
    };
    var service_xyz_osm = {
      type: 'XYZ',
      maxZoom: 20,
      url: ['https://tile.openstreetmap.org/${z}/${x}/${y}.png'],
      attribution: "© Contributors <a href='https://www.openstreetmap.org/copyright' target='_blank'>OpenStreetMap</a>",
      comment: 'OpenStreetMaps',
    };
    var service_xyz_april = {
      type: 'XYZ',
      maxZoom: 19,
      url: [
        'https://worldtiles1.waze.com/tiles/${z}/${x}/${y}.png?highres=true',
        'https://mts0.googleapis.com/vt/lyrs=m&z=${z}&x=${x}&y=${y}',
        'https://mts0.googleapis.com/vt/lyrs=p&z=${z}&x=${x}&y=${y}',
        'https://tile.openstreetmap.org/${z}/${x}/${y}.png',
      ],
      attribution: 'mišmaš',
      comment: 'mišmaš',
    };

    //skupiny vrstev v menu * layer groups in the menu
    // WME's layer switcher is a shadow-DOM web component, so the checkboxes are created
    // through wmeSDK.LayerSwitcher instead of hand-made DOM. The SDK exposes a flat
    // checkbox list (there is no group API), so each group name is kept as a label
    // prefix to keep the list organised and ordered.
    var groupTogglerPlaces = 'NP Places';
    var groupTogglerRoad = 'NP Roads';
    var groupTogglerHNS = 'NP Metric HNs';
    var groupTogglerNames = 'NP names and addresses';
    var groupTogglerBorders = 'NP Borders';
    var groupTogglerExternal = 'External Maps!!!';

    //vrstvy v menu * layers in the menu
    /************************How To add LayerTogglers***************************
	WMSLayerTogglers.*(1)* = addLayerToggler(groupTogglerPlaces, "*(2)*", false, [addNewLayer("*(1)*", *(3)*, "*(4)*")]);
	INDEX:
	*(1)* : LAYER NAME
	*(2)* : LAYER DISPLAY NAME AT LIST
	*(3)* : SERVICE URL NAME TO PULL DATA FROM
	*(4)* : SERVICE URL LAYER NAME TO PULL DATA FROM
	****************************************************************************/

    //MÍSTA * PLACES
    WMSLayerTogglers.wms_rivers = addLayerToggler(groupTogglerPlaces, 'Rivers', false, [addNewLayer('wms_rivers', service_wms_softwel, 'ssrn:ssrn_major_river,npgp:river_nepal')]);
    WMSLayerTogglers.wms_airport = addLayerToggler(groupTogglerPlaces, 'Geoportal Airports', false, [addNewLayer('wms_airport', service_wms_geoportal, 'geonode:Transportation', ZIndexes.popup)]);
    // Separate education facility layers to avoid duplicate labels
    WMSLayerTogglers.wms_prtmp_education = addLayerToggler(groupTogglerPlaces, 'Education Facilities (PRTMP)', false, [addNewLayer('wms_prtmp_education', service_wms_softwel, 'prtmp_01:prtmp_education', ZIndexes.popup)]);
    WMSLayerTogglers.wms_prtmp_health = addLayerToggler(groupTogglerPlaces, 'Health Facilities (PRTMP)', false, [addNewLayer('wms_prtmp_health', service_wms_softwel, 'prtmp_01:health_facilities', ZIndexes.popup)]);
    WMSLayerTogglers.wms_geoportal_health = addLayerToggler(groupTogglerPlaces, 'Health Facilities (Geoportal)', false, [addNewLayer('wms_geoportal_health', service_wms_geoportal, 'geonode:health_facilities', ZIndexes.popup)]);
    WMSLayerTogglers.wms_geoportal_police = addLayerToggler(groupTogglerPlaces, 'Police Units (Geoportal)', false, [addNewLayer('wms_geoportal_police', service_wms_geoportal, 'geonode:All_Nepal_Final_short', ZIndexes.popup)]);
    WMSLayerTogglers.wms_prtmp_palika = addLayerToggler(groupTogglerPlaces, 'Palika Centre (PRTMP)', false, [addNewLayer('wms_prtmp_palika', service_wms_softwel, 'prtmp_01:palika_center,prtmp_01:palika_center_name', ZIndexes.popup)]);
    WMSLayerTogglers.wms_prtmp_ward = addLayerToggler(groupTogglerPlaces, 'Ward Centre (PRTMP)', false, [addNewLayer('wms_prtmp_ward', service_wms_softwel, 'prtmp_01:prtmp_ward_center', ZIndexes.popup)]);
    WMSLayerTogglers.wms_prtmp_tourist = addLayerToggler(groupTogglerPlaces, 'Tourist Attraction', false, [addNewLayer('wms_prtmp_tourist', service_wms_softwel, 'prtmp_01:tourist_attraction', ZIndexes.popup)]);
    WMSLayerTogglers.wms_prtmp_customs = addLayerToggler(groupTogglerPlaces, 'Customs Office', false, [addNewLayer('wms_prtmp_customs', service_wms_softwel, 'prtmp_01:trade_transit', ZIndexes.popup)]);

    //SILNICE * ROAD
    WMSLayerTogglers.wms_PL2023 = addLayerToggler(groupTogglerRoad, 'SSRN Highway 2023', false, [addNewLayer('wms_PL2023', service_wms_PL2023, 'ssrn:ssrn_pavementstatus')]);
    WMSLayerTogglers.wms_PRTMP_NH = addLayerToggler(groupTogglerRoad, 'NH 2023 (BSM/PRTMP)', false, [addNewLayer('wms_PRTMP_NH', service_wms_softwel, 'prtmp_01:road_network,prtmp_01:road_network_name', "road_class='NH';road_class='NH'")]);
    WMSLayerTogglers.wms_PRTMP_PH = addLayerToggler(groupTogglerRoad, 'PH 2023 (BSM/PRTMP)', false, [addNewLayer('wms_PRTMP_PH', service_wms_softwel, 'prtmp_01:road_network,prtmp_01:road_network_name', "road_class='PH';road_class='PH'")]);
    WMSLayerTogglers.wms_PRTMP_PR = addLayerToggler(groupTogglerRoad, 'PR 2023 (BSM/PRTMP)', false, [addNewLayer('wms_PRTMP_PR', service_wms_softwel, 'prtmp_01:road_network,prtmp_01:road_network_name', "road_class='PR';road_class='PR'")]);
    WMSLayerTogglers.wms_BSM_Bridge = addLayerToggler(groupTogglerRoad, 'Bridges (BSM)', false, [addNewLayer('wms_BSM_Bridge', service_wms_softwel, 'bsm:bsm_nc_primary_detail,bsm:nc_primary_detail_code,bsm:bsm_bi_primary_detail', ZIndexes.popup)]);
    WMSLayerTogglers.wms_prtmp_bridge = addLayerToggler(groupTogglerRoad, 'Bridges (PRTMP)', false, [addNewLayer('wms_prtmp_bridge', service_wms_softwel, 'prtmp_01:bridge_inventory_local,prtmp_01:local_bridge,prtmp_01:major_bridge', ZIndexes.popup)]);

    //Metric HNs
        // Dhangadhi
    WMSLayerTogglers.wms_DhangadhiMetricHNS_mun_road = addLayerToggler(groupTogglerHNS, 'Dhangadhi Mun Road', false, [addNewLayer('wms_DhangadhiMetricHNS_mun_road', service_wms_softwel, 'MetricHNS:mun_road', "mun_code = 70813"),addNewLayer('wms_DhangadhiMetricHNS_mun_road', service_wms_softwel, 'MetricHNS:mun_road_noname', "mun_code = 70813")]);
    WMSLayerTogglers.wms_DhangadhiMetricHNS_HNS = addLayerToggler(groupTogglerHNS, 'Dhangadhi House Numbers', false, [addNewLayer('wms_DhangadhiMetricHNS_HNS', service_wms_softwel, 'MetricHNS:hh', 'mun_code = 70813')]);
    WMSLayerTogglers.wms_DhangadhiWards = addLayerToggler(groupTogglerHNS, 'Dhangadhi Wards', false, [addNewLayer('wms_DhangadhiWards', service_wms_softwel, 'MetricHNS:mhns_basemap_ward_boundary_polygon', "loc_code='70813'")]);
// Ghodaghodi
    WMSLayerTogglers.wms_GhodaghodiMetricHNS_mun_road = addLayerToggler(groupTogglerHNS, 'Ghodaghodi Mun Road', false, [addNewLayer('wms_GhodaghodiMetricHNS_mun_road', service_wms_softwel, 'MetricHNS:mun_road', "mun_code = 70805"),addNewLayer('wms_GhodaghodiMetricHNS_mun_road', service_wms_softwel, 'MetricHNS:mun_road_noname', "mun_code = 70805")]);
    WMSLayerTogglers.wms_GhodaghodiMetricHNS_HNS = addLayerToggler(groupTogglerHNS, 'Ghodaghodi House Numbers', false, [addNewLayer('wms_GhodaghodiMetricHNS_HNS', service_wms_softwel, 'MetricHNS:hh', 'mun_code = 70805')]);
    WMSLayerTogglers.wms_GhodaghodiWards = addLayerToggler(groupTogglerHNS, 'Ghodaghodi Wards', false, [addNewLayer('wms_GhodaghodiWards', service_wms_softwel, 'MetricHNS:mhns_basemap_ward_boundary_polygon', "loc_code='70805'")]);
 // Nepalgunj   
    WMSLayerTogglers.wms_NepalgunjMetricHNS_mun_road = addLayerToggler(groupTogglerHNS, 'Nepalgunj Mun Road', false, [addNewLayer('wms_NepalgunjMetricHNS_mun_road', service_wms_softwel, 'MetricHNS:mun_road', "mun_code = 51106"),addNewLayer('wms_NepalgunjMetricHNS_mun_road', service_wms_softwel, 'MetricHNS:mun_road_noname', "mun_code = 51106")]);
    WMSLayerTogglers.wms_NepalgunjMetricHNS_HNS = addLayerToggler(groupTogglerHNS, 'Nepalgunj House Numbers', false, [addNewLayer('wms_NepalgunjMetricHNS_HNS', service_wms_softwel, 'MetricHNS:hh', 'mun_code = 51106')]);
    WMSLayerTogglers.wms_NepalgunjWards = addLayerToggler(groupTogglerHNS, 'Nepalgunj Wards', false, [addNewLayer('wms_NepalgunjWards', service_wms_softwel, 'MetricHNS:mhns_basemap_ward_boundary_polygon', "loc_code='51106'")]);

    //ČÚZK NÁZVY A ADRESY * ČÚZK NAMES AND ADDRESSES
    WMSLayerTogglers.wms_mun_name = addLayerToggler(groupTogglerNames, 'BSM Municipality Names', false, [addNewLayer('wms_mun_name', service_wms_softwel, 'bsm:bsm_localbodies_label')]);
    WMSLayerTogglers.wms_junction_name = addLayerToggler(groupTogglerNames, 'SSRN Junction Names', false, [addNewLayer('wms_junction_name', service_wms_softwel, 'ssrn:ssrn_junction_name')]);

    //ČÚZK HRANICE * BORDER BOARD
    WMSLayerTogglers.wms_geonational = addLayerToggler(groupTogglerBorders, 'Geoportal National Border', false, [addNewLayer('wms_geonational', service_wms_geoportal, 'geonode:nepal')]);
    WMSLayerTogglers.wms_national = addLayerToggler(groupTogglerBorders, 'SSRN National Border', false, [addNewLayer('wms_national', service_wms_softwel, 'ssrn:ssrn_national_boundary_line')]);
    WMSLayerTogglers.wms_geoprovince = addLayerToggler(groupTogglerBorders, 'Geoportal Province Border', false, [addNewLayer('wms_geoprovince', service_wms_geoportal, 'geonode:province')]);
    WMSLayerTogglers.wms_province = addLayerToggler(groupTogglerBorders, 'SSRN Province Border', false, [addNewLayer('wms_province', service_wms_softwel, 'ssrn:ssrn_province_line')]);
    WMSLayerTogglers.wms_geodistrict = addLayerToggler(groupTogglerBorders, 'Geoportal District Border', false, [addNewLayer('wms_geodistrict', service_wms_geoportal, 'geonode:districts')]);
    WMSLayerTogglers.wms_district = addLayerToggler(groupTogglerBorders, 'SSRN District Border', false, [addNewLayer('wms_district', service_wms_softwel, 'ssrn:ssrn_district_boundary_line')]);
    WMSLayerTogglers.wms_geomunicipality = addLayerToggler(groupTogglerBorders, 'Geoportal Municipality Border', false, [addNewLayer('wms_geomunicipality', service_wms_geoportal, 'geonode:NepalLocalUnits0')]);
    WMSLayerTogglers.wms_municipality = addLayerToggler(groupTogglerBorders, 'BSM Municipality Border', false, [addNewLayer('wms_municipality', service_wms_softwel, 'bsm:bsm_localbodies_line')]);
    WMSLayerTogglers.wms_dmg_states = addLayerToggler(groupTogglerBorders, 'DMG Province Border', false, [addNewLayer('wms_dmg_states', service_wms_dmgnepal, 'dmg:states')]);
    WMSLayerTogglers.wms_dmg_districts = addLayerToggler(groupTogglerBorders, 'DMG District Border', false, [addNewLayer('wms_dmg_districts', service_wms_dmgnepal, 'dmg:districts')]);
    WMSLayerTogglers.wms_dmg_municipality = addLayerToggler(groupTogglerBorders, 'DMG Municipality Border', false, [addNewLayer('wms_dmg_municipality', service_wms_dmgnepal, 'dmg:locallevels')]);

    //EXTERNÍ MAPY * EXTERNAL MAPS
    WMSLayerTogglers.xyz_livemap = addLayerToggler(groupTogglerExternal, 'Waze LiveMap', false, [addNewLayer('xyz_livemap', service_xyz_livemap)]);
    WMSLayerTogglers.xyz_google = addLayerToggler(groupTogglerExternal, 'Google Maps', false, [addNewLayer('xyz_google', service_xyz_google)]);
    WMSLayerTogglers.xyz_google_terrain = addLayerToggler(groupTogglerExternal, 'Google Terrain Maps', false, [addNewLayer('xyz_google_terrain', service_xyz_google_terrain)]);
    WMSLayerTogglers.xyz_google_hybrid = addLayerToggler(groupTogglerExternal, 'Google Hybrid Maps', false, [addNewLayer('xyz_google_hybrid', service_xyz_google_hybrid)]);
    WMSLayerTogglers.xyz_google_streetview = addLayerToggler(groupTogglerExternal, 'Google StreetView', false, [addNewLayer('xyz_google_streetview', service_xyz_google_streetview, null, ZIndexes.popup)]);
    WMSLayerTogglers.xyz_osm = addLayerToggler(groupTogglerExternal, 'OpenStreetMaps', false, [addNewLayer('xyz_osm', service_xyz_osm)]);
    WMSLayerTogglers.xyz_april = addLayerToggler(groupTogglerExternal, 'Apríl !!!', false, [addNewLayer('xyz_april', service_xyz_april)]);


    // --- Layer switcher: ONE master checkbox for the whole script; the individual
    //     layers live in the script's own sidebar tab (Croatian WMS pattern) ---
    masterLayerToggleOn = loadMasterToggleState();
    restoreLayerTogglerStates(); // only loads the per-layer checkbox state
    registerMasterLayerCheckbox();

    // Fired by the SDK when the user toggles the master checkbox.
    wmeSDK.Events.on({
      eventName: 'wme-layer-checkbox-toggled',
      eventHandler: function (evt) {
        if (!evt || evt.name !== scriptName) return; // not our master checkbox
        masterLayerToggleOn = !!evt.checked;
        saveMasterToggleState(masterLayerToggleOn);
        syncAllTogglerVisibility();
      },
    });

    // --- SDK keyboard shortcuts (one per layer toggler) ---
    migrateLegacyShortcuts();
    initializeSDKShortcuts();
    startShortcutKeySync();
    /*********************  start of popup code ***************************/
    // --- WMS GetFeatureInfo popup for SSRN Pavement Layer ---
    // const map = W.map.getOLMap();
    // Note: wmeSDK.Map APIs used for map extent/size; OL2 map kept only where no SDK alternative exists

    // Helper: get all visible supported WMS layers for popup
    function getAllVisibleWMSLayerInfo() {
      const supported = [
        { key: 'wms_rivers', service: service_wms_softwel, queryLayer: 'ssrn:ssrn_major_river,npgp:river_nepal', displayName: 'Rivers', formatFn: (feature) => formatFeatureInfo('RIVER', feature) },
        { key: 'wms_prtmp_education', service: service_wms_softwel, queryLayer: 'prtmp_01:prtmp_education', displayName: 'Education Facilities (PRTMP)', formatFn: (feature) => formatFeatureInfo('EDUCATION', feature) },
        { key: 'wms_prtmp_health', service: service_wms_softwel, queryLayer: 'prtmp_01:health_facilities', displayName: 'Health Facilities (PRTMP)', formatFn: (feature) => formatFeatureInfo('HEALTH', feature) },
        { key: 'wms_geoportal_health', service: service_wms_geoportal, queryLayer: 'geonode:health_facilities', displayName: 'Health Facilities (Geoportal)', formatFn: (feature) => formatFeatureInfo('GEO_HEALTH', feature) },
        { key: 'wms_geoportal_police', service: service_wms_geoportal, queryLayer: 'geonode:All_Nepal_Final_short', displayName: 'Police Units (Geoportal)', formatFn: (feature) => formatFeatureInfo('GEO_POLICE', feature) },
        { key: 'wms_prtmp_palika', service: service_wms_softwel, queryLayer: 'prtmp_01:palika_center', displayName: 'Palika Centre (PRTMP)', formatFn: (feature) => formatFeatureInfo('PALIKA', feature) },
        { key: 'wms_prtmp_ward', service: service_wms_softwel, queryLayer: 'prtmp_01:prtmp_ward_center', displayName: 'Ward Centre (PRTMP)', formatFn: (feature) => formatFeatureInfo('WARD', feature) },
        { key: 'wms_prtmp_tourist', service: service_wms_softwel, queryLayer: 'prtmp_01:tourist_attraction', displayName: 'Tourist Attraction', formatFn: (feature) => formatFeatureInfo('TOURIST', feature) },
        { key: 'wms_prtmp_customs', service: service_wms_softwel, queryLayer: 'prtmp_01:trade_transit', displayName: 'Customs Office', formatFn: (feature) => formatFeatureInfo('CUSTOMS', feature) },
        { key: 'wms_PL2023', service: service_wms_PL2023, queryLayer: 'ssrn:ssrn_pavementstatus', displayName: 'SSRN Highway 2023', formatFn: (feature) => formatFeatureInfo('SSRN', feature) },
        { key: 'wms_PRTMP_NH', service: service_wms_softwel, queryLayer: 'prtmp_01:road_network', displayName: 'NH 2023 (BSM/PRTMP)', formatFn: (feature) => formatFeatureInfo('BSM', feature), cqlFilter: "road_class='NH'" },
        { key: 'wms_PRTMP_PH', service: service_wms_softwel, queryLayer: 'prtmp_01:road_network', displayName: 'PH 2023 (BSM/PRTMP)', formatFn: (feature) => formatFeatureInfo('BSM', feature), cqlFilter: "road_class='PH'" },
        { key: 'wms_PRTMP_PR', service: service_wms_softwel, queryLayer: 'prtmp_01:road_network', displayName: 'PR 2023 (BSM/PRTMP)', formatFn: (feature) => formatFeatureInfo('BSM', feature), cqlFilter: "road_class='PR'" },
        {
          key: 'wms_BSM_Bridge',
          service: service_wms_softwel,
          queryLayer: 'bsm:bsm_nc_primary_detail,bsm:nc_primary_detail_code,bsm:bsm_bi_primary_detail',
          displayName: 'Bridges (BSM)',
          formatFn: (feature) => formatFeatureInfo('BRIDGE', feature),
        },
        {
          key: 'wms_prtmp_bridge',
          service: service_wms_softwel,
          queryLayer: 'prtmp_01:bridge_inventory_local,prtmp_01:local_bridge,prtmp_01:major_bridge',
          displayName: 'Bridges (PRTMP)',
          formatFn: (feature) => formatFeatureInfo('BRIDGE', feature),
        },
        {
          key: 'wms_DhangadhiMetricHNS_mun_road',
          service: service_wms_softwel,
          queryLayer: 'MetricHNS:mun_road,MetricHNS:mun_road_noname',
          displayName: 'Dhangadhi Mun Road',
          formatFn: (feature) => formatFeatureInfo('MUN_ROAD', feature),
        },
        {
          key: 'wms_GhodaghodiMetricHNS_mun_road',
          service: service_wms_softwel,
          queryLayer: 'MetricHNS:mun_road,MetricHNS:mun_road_noname',
          displayName: 'Ghodaghodi Mun Road',
          formatFn: (feature) => formatFeatureInfo('MUN_ROAD', feature),
        },
        {
          key: 'wms_NepalgunjMetricHNS_mun_road',
          service: service_wms_softwel,
          queryLayer: 'MetricHNS:mun_road,MetricHNS:mun_road_noname',
          displayName: 'Nepalgunj Mun Road',
          formatFn: (feature) => formatFeatureInfo('MUN_ROAD', feature),
        },
        {
          key: 'wms_DhangadhiMetricHNS_HNS',
          service: service_wms_softwel,
          queryLayer: 'MetricHNS:hh',
          displayName: 'Dhangadhi Metric HNS',
          formatFn: (feature) => formatFeatureInfo('METRIC_HNS', feature),
        },
        {
          key: 'wms_GhodaghodiMetricHNS_HNS',
          service: service_wms_softwel,
          queryLayer: 'MetricHNS:hh',
          displayName: 'Ghodaghodi Metric HNS',
          formatFn: (feature) => formatFeatureInfo('METRIC_HNS', feature),
        },
        {
          key: 'wms_NepalgunjMetricHNS_HNS',
          service: service_wms_softwel,
          queryLayer: 'MetricHNS:hh',
          displayName: 'Nepalgunj Metric HNS',
          formatFn: (feature) => formatFeatureInfo('METRIC_HNS', feature),
        },
      ];
      const visible = [];
      for (const s of supported) {
        const toggler = WMSLayerTogglers[s.key];
        if (!toggler) {
          continue;
        }
        const layer = toggler.layerArray && toggler.layerArray[0] && toggler.layerArray[0].layer;
        if (layer && layer.getVisibility()) {
          visible.push({ layer, service: s.service, queryLayer: s.queryLayer, formatFn: s.formatFn, key: s.key, displayName: s.displayName, cqlFilter: s.cqlFilter });
        }
      }
      return visible;
    }

    // Helper: build GetFeatureInfo URL for any supported WMS layer
    function buildGetFeatureInfoUrl(service, queryLayer, evt, cqlFilter = null) {
      const wmsUrl = service.url;
      // getMapExtent() returns [west, south, east, north] in WGS84 degrees
      const extent = wmeSDK.Map.getMapExtent();
      // Convert WGS84 degrees → EPSG:3857 (Web Mercator) meters
      const toMercX = (lon) => lon * 20037508.34 / 180;
      const toMercY = (lat) => Math.log(Math.tan((90 + lat) * Math.PI / 360)) * 6378137;
      const bboxLeft = toMercX(extent[0]);
      const bboxRight = toMercX(extent[2]);
      const bboxBottom = toMercY(extent[1]);
      const bboxTop = toMercY(extent[3]);
      const mapEl = wmeSDK.Map.getMapViewportElement();
      const width = mapEl.offsetWidth;
      const height = mapEl.offsetHeight;
      // Derive I/J from geographic click position relative to BBOX (avoids pixel coord system mismatch)
      const clickMercX = toMercX(evt.lon);
      const clickMercY = toMercY(evt.lat);
      const x = Math.round((clickMercX - bboxLeft) / (bboxRight - bboxLeft) * width);
      const y = Math.round((bboxTop - clickMercY) / (bboxTop - bboxBottom) * height);

      // Handle CQL filters - priority: parameter > service URL
      let cql = '';
      if (cqlFilter) {
        cql = 'CQL_FILTER=' + encodeURIComponent(cqlFilter);
        console.log('[WMS DEBUG] Using layer-specific CQL filter for GetFeatureInfo:', cqlFilter);
      } else if (wmsUrl.includes('CQL_FILTER=')) {
        const match = wmsUrl.match(/CQL_FILTER=([^&]*)/);
        if (match) {
          cql = 'CQL_FILTER=' + match[1];
          console.log('[WMS DEBUG] Using service URL CQL filter for GetFeatureInfo:', decodeURIComponent(match[1]));
        }
      }

      // Determine CRS: use map.projection or fallback to EPSG:3857
      let crs = 'EPSG:3857';
      if (map.projection && (map.projection === 'EPSG:4326' || map.projection === 'EPSG:3857')) {
        crs = map.projection;
      }
      // Optionally add FEATURE_COUNT if present in service config
      let featureCount = '';
      if (service.featureCount) {
        featureCount = 'FEATURE_COUNT=' + service.featureCount;
      }
      const params = [
        'SERVICE=WMS',
        'VERSION=1.3.0',
        'REQUEST=GetFeatureInfo',
        'FORMAT=image/png',
        'TRANSPARENT=true',
        'QUERY_LAYERS=' + encodeURIComponent(queryLayer),
        'LAYERS=' + encodeURIComponent(queryLayer),
        'INFO_FORMAT=application/json',
        cql,
        'STYLES=',
        'TILED=true',
        'buffer=10',
        'CRS=' + crs,
        'WIDTH=' + width,
        'HEIGHT=' + height,
        'BBOX=' + bboxLeft + ',' + bboxBottom + ',' + bboxRight + ',' + bboxTop,
        'I=' + x,
        'J=' + y,
        featureCount,
      ].filter(Boolean);

      const finalUrl = wmsUrl.split('?')[0] + '?' + params.join('&');
      if (cqlFilter) {
        console.log('[WMS DEBUG] GetFeatureInfo URL with CQL filter:', finalUrl);
      }
      return finalUrl;
    }

    // Helper: place a popup so it always stays fully inside the visible viewport.
    // Popups use position:fixed, so their left/top are the same screen pixels
    // that wmeSDK.Map.getPixelFromLonLat() returns - no page overflow possible.
    function positionPopupInViewport(popup, lonLat, offsetX) {
      const MARGIN = 8;
      // A tall popup scrolls internally instead of growing past the viewport.
      popup.style.maxHeight = Math.max(120, window.innerHeight - MARGIN * 2) + 'px';
      popup.style.overflowY = 'auto';
      // Make it measurable without showing a jump.
      popup.style.display = 'block';
      popup.style.visibility = 'hidden';

      const px = wmeSDK.Map.getPixelFromLonLat({ lonLat: { lon: lonLat.lon, lat: lonLat.lat } });
      const width = popup.offsetWidth;
      const height = popup.offsetHeight;
      const maxLeft = Math.max(MARGIN, window.innerWidth - width - MARGIN);
      const maxTop = Math.max(MARGIN, window.innerHeight - height - MARGIN);

      // Preferred spot: offset to the right of the click, slightly above it.
      let left = px.x + offsetX;
      let top = px.y - 10;

      // Not enough room on the right -> flip to the left of the click.
      if (left + width + MARGIN > window.innerWidth) {
        left = px.x - width - 10;
      }
      // Not enough room below -> flip above the click, when that fits.
      if (top + height + MARGIN > window.innerHeight) {
        const above = px.y - height - 10;
        if (above >= MARGIN) top = above;
      }

      // Final clamp keeps the popup inside the viewport in every direction.
      popup.style.left = Math.min(Math.max(left, MARGIN), maxLeft) + 'px';
      popup.style.top = Math.min(Math.max(top, MARGIN), maxTop) + 'px';
      popup.style.visibility = 'visible';
    }

    // Helper: show popup at pixel position with content (custom HTML popup)
    function showWMSPopupAtPixel(lonLat, html) {
      let popup = document.getElementById('wms-info-popup');
      if (!popup) {
        popup = document.createElement('div');
        popup.id = 'wms-info-popup';
        popup.style.position = 'fixed';
        popup.style.zIndex = 9999;
        // WME CSS variables keep the popup readable in both light and dark themes.
        popup.style.background = 'var(--background_default, #fff)';
        popup.style.color = 'var(--content_default, #333)';
        popup.style.border = '2px solid var(--hairline, #999)';
        popup.style.borderRadius = '8px';
        popup.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
        popup.style.padding = '10px 14px 10px 10px';
        popup.style.minWidth = '220px';
        popup.style.maxWidth = '350px';
        popup.style.pointerEvents = 'auto';
        popup.style.fontSize = '11px';
        popup.style.fontFamily = 'inherit';
        popup.style.display = 'block';
        popup.innerHTML = '';
        document.body.appendChild(popup);
      }
      // Add close button and table styling
      popup.innerHTML = `
        <a href="#" id="wms-info-popup-close" style="position:absolute;top:2px;right:4px;font-size:20px;text-decoration:none;color: #ff0000;">&times;</a>
        <style>
          #wms-info-popup table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 11px; }
          #wms-info-popup th, #wms-info-popup td { border: 1px solid var(--hairline, #ccc); padding: 2px 6px; text-align: left; font-size: 11px; }
          #wms-info-popup th { background: rgba(128, 128, 128, 0.18); font-weight: bold; font-size: 11px; }
          #wms-info-popup tr.alert-success th { background: #8BC34A; color: #1b1b1b; font-weight: 700; text-align: center; font-size: 11px; }
        </style>
        ${html}
      `;
      // Keep the popup fully inside the visible viewport, clamped on all sides.
      positionPopupInViewport(popup, lonLat, 10);
      // Close handler
      document.getElementById('wms-info-popup-close').onclick = function (e) {
        e.preventDefault();
        popup.style.display = 'none';
      };
    }

    // Helper: show popup at pixel position with content (custom HTML popup), unique per layer
    function showWMSPopupAtPixelForLayer(lonLat, html, layerKey) {
      let popupId = 'wms-info-popup-' + layerKey;
      let popup = document.getElementById(popupId);
      if (!popup) {
        popup = document.createElement('div');
        popup.id = popupId;
        popup.style.position = 'fixed';
        popup.style.zIndex = 9999;
        // WME CSS variables keep the popup readable in both light and dark themes.
        popup.style.background = 'var(--background_default, #fff)';
        popup.style.color = 'var(--content_default, #333)';
        popup.style.border = '2px solid var(--hairline, #999)';
        popup.style.borderRadius = '8px';
        popup.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
        popup.style.padding = '10px 14px 10px 10px';
        popup.style.minWidth = '220px';
        popup.style.maxWidth = '350px';
        popup.style.pointerEvents = 'auto';
        popup.style.fontSize = '11px';
        popup.style.fontFamily = 'inherit';
        popup.style.display = 'block';
        popup.innerHTML = '';
        document.body.appendChild(popup);
      }
      // Add close button and table styling
      popup.innerHTML = `
        <a href="#" id="${popupId}-close" style="position:absolute;top:2px;right:4px;font-size:20px;text-decoration:none;color: #ff0000;">&times;</a>
        <style>
          #${popupId} table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 11px; }
          #${popupId} th, #${popupId} td { border: 1px solid var(--hairline, #ccc); padding: 2px 6px; text-align: left; font-size: 11px; }
          #${popupId} th { background: rgba(128, 128, 128, 0.18); font-weight: bold; font-size: 11px; }
          #${popupId} tr.alert-success th { background: #8BC34A; color: #1b1b1b; font-weight: 700; text-align: center; font-size: 11px; }
        </style>
        ${html}
      `;
      // Offset each popup horizontally so they don't overlap, then clamp to viewport.
      const offsetX = 10 + 260 * ['wms_PL2023', 'wms_PRTMP_PH', 'wms_PRTMP_PR'].indexOf(layerKey);
      positionPopupInViewport(popup, lonLat, offsetX);
      // Close handler
      document.getElementById(`${popupId}-close`).onclick = function (e) {
        e.preventDefault();
        popup.style.display = 'none';
      };
    }
    // Helper: format feature info for popup based on type
    function formatFeatureInfo(type, feature) {
      // Define field sets and titles for each type
      const configs = {
        SSRN: {
          title: (feature) => feature.layerName || 'Strategic Road Network',
          fields: [
            ['road_code', 'Road Code'],
            ['link_name', 'Link Name'],
            ['road_name', 'Road Name'],
            ['from_ch', 'From chainage'],
            ['to_ch', 'To chainage'],
            ['pave_type', 'Pavement type'],
            ['last_resurface', 'Last Resurface Year'],
            ['pave_width', 'Pave Width'],
            ['dyear', 'Year'],
            ['add_date', 'Added'],
          ],
        },
        BSM: {
          title: (feature) => feature.layerName || 'BSM Province Road Info',
          fields: [
            ['road_code', 'Road Code'],
            ['road_class', 'Road Class'],
            ['road_name', 'Road Name'],
            ['pcode', 'Province'],
            ['start_ch', 'From chainage'],
            ['end_ch', 'To chainage'],
            ['dyear', 'Year'],
            ['add_date', 'Added'],
          ],
        },
        EDUCATION: {
          title: (feature) => feature.layerName || 'Education Facilities',
          fields: [
            ['name', 'School Name'],
            ['loc_bodies', 'Mun Name'],
            ['district', 'District'],
          ],
        },
        HEALTH: {
          title: (feature) => feature.layerName || 'Health Facilities',
          fields: [
            ['hf_name', 'Name'],
            ['category', 'Category'],
            ['loc_bodies', 'Mun Name'],
            ['ward', 'Ward'],
            ['district', 'District'],
            ['province', 'Province'],
          ],
        },
        GEO_HEALTH: {
          title: (feature) => feature.layerName || 'Health Facilities',
          fields: [
            ['health_fac', 'Name'],
            ['Categorise', 'Category'],
            ['status_lev', 'Status Level'],
            ['local_gove', 'Mun Name'],
            ['District', 'District'],
            ['Province', 'Province'],
          ],
        },
        GEO_POLICE: {
          title: (feature) => feature.layerName || 'Police Units',
          fields: [
            ['EngName', 'Name'],
            ['Nepali_Nam', 'Nep Name'],
            ['dis', 'District'],
            ['Provinces', 'Province'],
          ],
        },
        RIVER: {
          title: (feature) => feature.layerName || 'River Features',
          fields: [['riv_name', 'Name']],
        },
        PALIKA: {
          title: (feature) => feature.layerName || 'Palika Centre',
          fields: [
            ['loc_bod', 'Name Eng'],
            ['dist_name', 'District Eng'],
            ['province', 'Province'],
            ['palika_nep', 'Palika NP'],
            ['dist_nep', 'District NP'],
          ],
        },
        WARD: {
          title: (feature) => feature.layerName || 'Ward Centre',
          fields: [
            ['pcode', 'Province'],
            ['loc_name', 'Name'],
            ['type_gn', 'Type'],
            ['ward_no', 'Ward No'],
          ],
        },
        TOURIST: {
          title: (feature) => feature.layerName || 'Tourist Attraction',
          fields: [
            ['pcode', 'Province'],
            ['name', 'Name'],
            ['district', 'District'],
          ],
        },
        CUSTOMS: {
          title: (feature) => feature.layerName || 'Customs Office',
          fields: [
            ['pcode', 'Province'],
            ['name', 'Name'],
            ['district', 'District'],
          ],
        },
        BRIDGE: {
          title: (feature) => feature.layerName || 'Bridge',
          fields: [
            ['pcode', 'Province'],
            [['name', 'bridge_name'], 'Bridge Name'], // Array of fallback field names
            [['bridge_id', 'bridge_no', 'new_bridge_no'], 'Bridge ID'], // Array of fallback field names
            ['bridge_length', 'Bridge Length'],
            [['river', 'river_name'], 'River'], // Array of fallback field names
            ['road', 'Road Name'], // Array of fallback field names
            ['district', 'District'],
            ['updated_date', 'Updated Date'],
          ],
        },
        MUN_ROAD: {
          title: (feature) => feature.layerName || 'Municipality Road',
          fields: [
            ['r_code', 'Road Code'],
            ['r_name', 'Name'],
            ['r_type', 'Road Type'],
            ['r_width', 'Road Width'],
          ],
        },
        METRIC_HNS: {
          title: (feature) => feature.layerName || 'Metric House Numbers',
          fields: [
            ['hh_number', 'House Number'],
            ['road_name', 'Road Name'],
            // ['road_code', 'Road Code'],
            ['ward_no', 'Ward No'],
            ['hh_nameplate_status', 'Number Plate Status'],
            [['lat', 'lon'], 'Coordinates', 'combine'],
            ['sur_date', 'Survey Date'],
            ['hh_link', 'More Info'],
            ['photo1_path', null],
          ],
        },
      };

      const config = configs[type];
      if (!config) return '<div>No info available</div>';

      // Always use user-friendly display name if present
      let layerTitle = feature.layerName; // || (typeof config.title === 'function' ? config.title(feature) : config.title);

      let html = '<table class="link-table"><tbody>';
      html += `<tr class="alert-success text-center"><th colspan="2">${layerTitle}</th></tr>`;
      for (const [key, label, mode] of config.fields) {
        let value = '';
        if (Array.isArray(key)) {
          if (mode === 'combine') {
            // Combine all non-empty values (e.g. lat + lon)
            value = key.map(k => feature.properties[k]).filter(Boolean).join(', ');
          } else {
            // Fallback: use first non-empty value
            for (const fallbackKey of key) {
              if (feature.properties[fallbackKey]) {
                value = feature.properties[fallbackKey];
                break;
              }
            }
          }
        } else {
          // Single field name
          value = feature.properties[key] || '';
        }
        if (label === null) {
          // Render as photo (value is a relative path appended to the base URL)
          if (value) {
            html += `<tr><td colspan="2" style="text-align:center;padding:4px 0;"><img src="https://hncdsg2.softavi.com/uploads/${value}" style="max-width:100%;border-radius:4px;" onerror="this.style.display='none'"></td></tr>`;
          }
        } else {
          html += `<tr><td>${label}: </td><td>${value}</td></tr>`;
        }
      }
      html += '</tbody></table>';
      return '<div id="popup-content">' + html + '</div>';
    }

    // Map click handler
    wmeSDK.Events.on({ eventName: 'wme-map-mouse-click', eventHandler: function (evt) {
      console.log('[WMS] Map clicked at', { viewportX: evt.viewportX, viewportY: evt.viewportY }, { lat: evt.lat, lon: evt.lon });
      const visibleLayers = getAllVisibleWMSLayerInfo();
      if (!visibleLayers.length) {
        console.log('[WMS] No supported WMS layer visible for popup.');
        return;
      }
      let responses = 0;
      let foundFeatures = [];
      let total = visibleLayers.length;
      for (const info of visibleLayers) {
        const url = buildGetFeatureInfoUrl(info.service, info.queryLayer, evt, info.cqlFilter);
        console.log(`[WMS] GetFeatureInfo URL for ${info.key}:`, url);
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          headers: { Accept: 'application/json' },
          onload: function (response) {
            responses++;
            try {
              const data = JSON.parse(response.responseText);
              console.log(`[WMS] GetFeatureInfo response for ${info.key}:`, data);
              if (data.features && data.features.length > 0) {
                // For combined layers, deduplicate features by name to avoid showing identical entries
                const uniqueFeatures = [];
                const seenNames = new Set();

                for (let feature of data.features) {
                  // Use the facility name as the deduplication key
                  const facilityName = feature.properties?.name || feature.properties?.hf_name || feature.properties?.riv_name || 'unnamed';

                  if (!seenNames.has(facilityName)) {
                    seenNames.add(facilityName);
                    feature.layerName = info.displayName;
                    uniqueFeatures.push({ info, feature });
                  }
                }

                // Add all unique features to the foundFeatures array
                foundFeatures.push(...uniqueFeatures);
              }
            } catch (e) {
              console.error(`[WMS] Error parsing GetFeatureInfo response for ${info.key}:`, e);
            }
            if (responses === total) {
              if (foundFeatures.length > 0) {
                // Show all found features in one popup at the click location
                let html = foundFeatures.map((f) => f.info.formatFn(f.feature)).join('<hr style="margin:6px 0;">');
                showWMSPopupAtPixel({ lon: evt.lon, lat: evt.lat }, html);
                console.log('[WMS] Popup shown for features:', foundFeatures);
              }
            }
          },
          onerror: function (err) {
            responses++;
            console.error(`[WMS] GetFeatureInfo request failed for ${info.key}:`, err);
            if (responses === total) {
              if (foundFeatures.length > 0) {
                let html = foundFeatures.map((f) => f.info.formatFn(f.feature)).join('<hr style="margin:6px 0;">');
                showWMSPopupAtPixel({ lon: evt.lon, lat: evt.lat }, html);
              }
            }
          },
        });
      }
    }});
    /*end of pop up code*/

    /* ------------------------------------------------------------------
       Street View integration (SDK)
       Replaces the MutationObserver that watched the .street-view-control CSS class.
       The Google StreetView overlay is added while Street View is in use and removed
       when it closes - unless the user enabled that layer themselves from the layer
       switcher, in which case the layer is left fully under their control.
       ------------------------------------------------------------------ */
    var streetViewToggler = WMSLayerTogglers.xyz_google_streetview;
    var GSVlayer = streetViewToggler.layerArray[0].layer;
    var streetViewButtonActive = false; // pegman being dragged / peek mode
    var streetViewPanelVisible = false; // street view pane open
    var streetViewOverlayOn = false;

    function isGSVLayerCheckedByUser() {
      // The Google StreetView layer is owned by the user as soon as its checkbox
      // in the script's sidebar tab is ticked.
      return !!streetViewToggler.tabChecked;
    }

    function setStreetViewOverlay(active) {
      if (isGSVLayerCheckedByUser()) return; // user owns this layer
      var isOnMap = W.map.getLayers().indexOf(GSVlayer) !== -1;
      if (active) {
        if (!isOnMap) W.map.addLayer(GSVlayer);
        GSVlayer.setVisibility(true);
      } else {
        GSVlayer.setVisibility(false);
        // Detach only when the layer is really on the map (see applyLayerTogglerVisibility).
        if (!isOnMap) return;
        try {
          W.map.removeLayer(GSVlayer);
        } catch (e) {
          // The <div> was already detached - the overlay is hidden either way.
        }
      }
    }

    function updateStreetViewOverlay() {
      var active = streetViewButtonActive || streetViewPanelVisible;
      if (active === streetViewOverlayOn) return;
      streetViewOverlayOn = active;
      setStreetViewOverlay(active);
    }

    wmeSDK.Events.on({
      eventName: 'wme-street-view-button-activated',
      eventHandler: function () {
        streetViewButtonActive = true;
        updateStreetViewOverlay();
      },
    });
    wmeSDK.Events.on({
      eventName: 'wme-street-view-button-deactivated',
      eventHandler: function () {
        streetViewButtonActive = false;
        updateStreetViewOverlay();
      },
    });
    wmeSDK.Events.on({
      eventName: 'wme-street-view-panel-visibility-changed',
      eventHandler: function (evt) {
        streetViewPanelVisible = !!(evt && evt.isVisible);
        updateStreetViewOverlay();
      },
    });
    // Pick up a Street View pane that is already open when the script loads.
    try {
      streetViewPanelVisible = wmeSDK.Map.isStreetViewActive();
      updateStreetViewOverlay();
    } catch (e) {
      // SDK not ready - the events above will drive it from here on.
    }

    /* ------------------------------------------------------------------
       WMS layer shift: state + conversion helpers

       The pad moves the REQUESTED BBOX, so the drawn content travels the other way.
       `wmsLayerOffsets` therefore holds bbox offsets in the map's own units, while
       everything saved or configured holds metres of CONTENT movement. The two
       converters below are the only place that sign is written down.
       ------------------------------------------------------------------ */
    var wmsLayerOffsets = {}; // layer name -> { x, y } bbox offset (map projection units)
    var wmsLayerOriginalOffsets = {};
    var wmsLayerPresetOffsets = {}; // layer name -> its built-in default offset

    // Metres per degree at the current map centre - only needed for the (unusual)
    // case of a map that is itself in EPSG:4326.
    function wmsMetersPerDegree() {
      var centerLat = getMapCenterLat();
      return {
        lon: (40075000 * Math.cos((centerLat * Math.PI) / 180)) / 360,
        lat: 111320,
      };
    }

    function wmsMapIs4326() {
      try {
        var proj = W.map.getProjectionObject();
        return !!(proj && proj.projCode === 'EPSG:4326');
      } catch (e) {
        return false;
      }
    }

    // Desired content movement (metres) -> the bbox offset getURL needs.
    function wmsOffsetFromContentMeters(east, north) {
      if (wmsMapIs4326()) {
        var per = wmsMetersPerDegree();
        return { x: -east / per.lon, y: -north / per.lat };
      }
      return { x: -east, y: -north };
    }

    // The inverse, used for saving and for describing an offset to the user.
    function wmsContentMetersFromOffset(offset) {
      if (!offset) return { east: 0, north: 0 };
      if (wmsMapIs4326()) {
        var per = wmsMetersPerDegree();
        return { east: -offset.x * per.lon, north: -offset.y * per.lat };
      }
      return { east: -offset.x, north: -offset.y };
    }

    function wmsSameOffset(a, b) {
      return !!a && !!b && a.x === b.x && a.y === b.y;
    }

    // Human-readable form of an offset, e.g. "260 m W, 20 m N" (or "none").
    function describeWmsOffset(offset) {
      var meters = wmsContentMetersFromOffset(offset);
      var east = Math.round(meters.east);
      var north = Math.round(meters.north);
      var parts = [];
      if (east) parts.push(Math.abs(east) + ' m ' + (east > 0 ? 'E' : 'W'));
      if (north) parts.push(Math.abs(north) + ' m ' + (north > 0 ? 'N' : 'S'));
      return parts.length ? parts.join(', ') : 'none';
    }

    // A GeoJSON layer's offset is stored in degrees, so it is converted back to metres
    // for display - the shared pad then reports both layer kinds in the same unit.
    function describeGeoJsonOffset(offset) {
      if (!offset || (!offset.x && !offset.y)) return 'none';
      var centerLat = getMapCenterLat();
      var metersPerDegreeLon = (40075000 * Math.cos((centerLat * Math.PI) / 180)) / 360;
      var east = offset.x * metersPerDegreeLon;
      var north = offset.y * 111320;
      var parts = [];
      if (Math.round(east)) parts.push(Math.abs(Math.round(east)) + ' m ' + (east > 0 ? 'E' : 'W'));
      if (Math.round(north)) parts.push(Math.abs(Math.round(north)) + ' m ' + (north > 0 ? 'N' : 'S'));
      return parts.length ? parts.join(', ') : 'none';
    }

    // Apply a shift to a layer and arm its getURL patch, so the correction is already
    // active when the layer is switched on and requests its first tile.
    function setWmsLayerOffset(layer, offset) {
      if (!layer) return;
      patchWMSLayerGetURL(layer);
      wmsLayerOffsets[layer.name] = { x: offset.x, y: offset.y };
    }

    // Reads a preset written in map terms: { west: 260, north: 20 } means the content
    // has to move 260 m west and 20 m north. east/south work as well, negatives too.
    function presetContentMeters(preset) {
      return {
        east: (preset.east || 0) - (preset.west || 0),
        north: (preset.north || 0) - (preset.south || 0),
      };
    }

    // Remember the total shift of a layer, converted to metres so the stored value is
    // independent of the map projection.
    function rememberWmsLayerOffset(layerName) {
      var meters = wmsContentMetersFromOffset(wmsLayerOffsets[layerName]);
      var stored = loadStoredLayerOffsets();
      stored[layerName] = { east: meters.east, north: meters.north };
      saveStoredLayerOffsets(stored);
    }

    // "Applied shift: 260 m W, 20 m N (built-in default)" next to the shift pad. The
    // pad is shared by both layer kinds, so the line describes whichever one is
    // selected - WMS offsets come from the preset/remembered maps, GeoJSON offsets
    // from the pad's own accumulated degrees.
    function refreshWmsShiftStatus() {
      var el = document.getElementById('WMSShiftStatus');
      if (!el) return;
      var target = selectedShiftTarget();
      if (!target) {
        el.textContent = '';
        return;
      }
      if (target.type === 'geojson') {
        el.textContent = 'Applied shift: ' + describeGeoJsonOffset(geoJsonLayerOffsets[target.name]) + ' (GeoJSON layer)';
        return;
      }
      // WMS offsets are keyed by OL2 layer name, so the toggler's on-map layer is the
      // one whose shift this line reports (a toggler's layers share one offset).
      var layers = findWmsLayersForTarget(target.name);
      var wmsLayer = layers[0];
      if (!wmsLayer) {
        el.textContent = '';
        return;
      }
      var offset = wmsLayerOffsets[wmsLayer.name];
      var isZero = !offset || (!offset.x && !offset.y);
      var suffix = isZero ? '' : wmsSameOffset(wmsLayerPresetOffsets[wmsLayer.name], offset) ? ' (built-in default)' : ' (remembered)';
      el.textContent = 'Applied shift: ' + describeWmsOffset(offset) + suffix;
    }

    // Every WMS layer of the script, by OL2 layer name (a toggler can hold several).
    function allWmsLayersByName() {
      var byName = {};
      for (var key in WMSLayerTogglers) {
        WMSLayerTogglers[key].layerArray.forEach(function (item) {
          if (item.layer && typeof item.serviceType === 'string' && item.serviceType.indexOf('WMS') === 0) {
            byName[item.layer.name] = item.layer;
          }
        });
      }
      return byName;
    }

    // Built-in defaults first, then the shifts the user nudged into place earlier,
    // which take precedence over them.
    function applyStoredAndPresetShifts() {
      var layersByName = allWmsLayersByName();

      Object.keys(WMS_LAYER_SHIFT_PRESETS).forEach(function (key) {
        var toggler = WMSLayerTogglers[key];
        if (!toggler) {
          console.warn(scriptName + ': shift preset for unknown layer "' + key + '" ignored.');
          return;
        }
        var meters = presetContentMeters(WMS_LAYER_SHIFT_PRESETS[key]);
        var offset = wmsOffsetFromContentMeters(meters.east, meters.north);
        toggler.layerArray.forEach(function (item) {
          if (!item.layer || typeof item.serviceType !== 'string' || item.serviceType.indexOf('WMS') !== 0) return;
          setWmsLayerOffset(item.layer, offset);
          wmsLayerPresetOffsets[item.layer.name] = offset;
        });
        console.log(scriptName + ': default shift for "' + key + '": ' + describeWmsOffset(offset));
      });

      var stored = loadStoredLayerOffsets();
      Object.keys(stored).forEach(function (layerName) {
        var layer = layersByName[layerName];
        var meters = stored[layerName];
        if (!layer || !meters || typeof meters.east !== 'number' || typeof meters.north !== 'number') return;
        setWmsLayerOffset(layer, wmsOffsetFromContentMeters(meters.east, meters.north));
      });
    }

    // Corrections are applied before any layer can be switched on: the initial
    // syncAllTogglerVisibility, the master checkbox and every shortcut only toggle
    // visibility, so a corrected layer is already right when its first tile is drawn.
    applyStoredAndPresetShifts();

    const { tabLabel, tabPane } = await wmeSDK.Sidebar.registerScriptTab();
    tabLabel.innerText = 'GIS-NP';
    tabLabel.title = scriptName;
    tabLabel.id = 'sidepanel-wms';

    injectWmsPanelStyles();

    // The panel is a gradient header, a sub-tab bar (Layers / Shifting / Settings)
    // and the pane of the selected sub-tab. "Layers" holds the per-group cards
    // (opacity slider + checkbox per layer) and the "Lalitpur HN Address Wards"
    // viewport auto-loader; "Shifting" holds the layer tools (shift pad + per-layer
    // opacity); "Settings" holds the feature-layer Style Settings.
    var panel = npwCreate('div', 'npw-panel');
    panel.id = 'nepali-wms-panel';

    var panelHeader = npwCreate('div', 'npw-header');
    var panelTitle = npwCreate('a', 'npw-title', GM_info.script.name);
    panelTitle.href = 'https://greasyfork.org/en/scripts/521924';
    panelTitle.target = '_blank';
    panelTitle.title = 'Open the script page on GreasyFork';
    panelHeader.appendChild(panelTitle);
    panelHeader.appendChild(npwCreate('span', 'npw-version', 'v' + GM_info.script.version));
    panel.appendChild(panelHeader);
    tabPane.appendChild(panel);

    // --- Sub-tabs ---------------------------------------------------------
    var tabs = npwTabs(panel, [
      { id: 'layers', label: 'Layers', title: 'Show / hide the WMS layer groups' },
      { id: 'shifting', label: 'Shifting', title: 'Shift a layer and adjust its opacity' },
      {
        id: 'settings',
        label: 'Settings',
        title: 'Script settings',
        // The label-field picker is built from the loaded layers, which change while
        // panning, so it is refreshed whenever this tab becomes active instead of on
        // every layer add/remove.
        onShow: function () {
          refreshLabelFieldControls(true);
        },
      },
    ]);
    var layersPane = tabs.panes.layers;
    var shiftingPane = tabs.panes.shifting;
    var settingsPane = tabs.panes.settings;

    // --- Settings tab: Style Settings (feature layers only) ------------------
    // Ported from "WME GeoFile". One global style plus an optional per-layer
    // override, persisted in IndexedDB, applied live (debounced redraw). WMS and XYZ
    // layers are deliberately untouched - they have their own opacity control.
    var styleCard = npwCard(settingsPane, 'Style Settings');
    styleCard.appendChild(npwCreate('div', 'npw-status', 'Drives the loaded feature layers (GeoJSON today; KML, KMZ, GML, GPX, WKT, ZIP later). WMS and XYZ layers are not affected.'));

    styleCard.appendChild(npwCreate('span', 'npw-small-label', 'Apply to:'));
    var styleScopeSelect = document.createElement('select');
    styleScopeSelect.id = 'npwStyleScope';
    styleScopeSelect.className = 'npw-select';
    styleCard.appendChild(styleScopeSelect);

    // --- control factories --------------------------------------------------
    function styleFieldRow(labelText) {
      var row = npwCreate('div', 'npw-field-row');
      row.appendChild(npwCreate('span', 'npw-field-label', labelText));
      styleCard.appendChild(row);
      return row;
    }

    function styleToggleBox(id, text, title) {
      var wrap = npwCreate('label', 'npw-field-toggle');
      wrap.title = title || text;
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.id = id;
      box.className = 'npw-checkbox';
      wrap.appendChild(box);
      wrap.appendChild(document.createTextNode(text));
      return { wrap: wrap, box: box };
    }

    function styleNumberInput(id, min, max, step) {
      var input = document.createElement('input');
      input.type = 'number';
      input.id = id;
      input.className = 'npw-number';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      return input;
    }

    function styleRangeControl(id, min, max, step, formatter) {
      var input = document.createElement('input');
      input.type = 'range';
      input.id = id;
      input.className = 'npw-opacity-slider';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      var valueEl = npwCreate('span', 'npw-opacity-value', '');
      var readout = function () {
        valueEl.textContent = formatter(parseFloat(input.value));
      };
      input.addEventListener('input', readout);
      return { input: input, valueEl: valueEl, readout: readout };
    }

    // --- Label field ---------------------------------------------------------
    // Which property - or ${attr} template - becomes the label. The property keys differ
    // per layer, so the list is rebuilt from the features of the selected scope, and it
    // can be set on ANY layer type, including those that are unlabelled by default.
    styleCard.appendChild(npwCreate('span', 'npw-small-label', 'Label field:'));
    var labelFieldSelect = document.createElement('select');
    labelFieldSelect.id = 'npwStyleLabelField';
    labelFieldSelect.className = 'npw-select';
    labelFieldSelect.title =
      'Pick a property to label the features with. Selecting one fills the box below, which stays editable so the value can be turned into a template.';
    styleCard.appendChild(labelFieldSelect);

    var labelTemplateInput = document.createElement('input');
    labelTemplateInput.type = 'text';
    labelTemplateInput.id = 'npwStyleLabelTemplate';
    labelTemplateInput.className = 'npw-input';
    labelTemplateInput.placeholder = 'Property name, or template: ${district} - ${gapa_napa}';
    labelTemplateInput.title =
      'A bare property name labels with that value. Use ${propertyName} to combine several, and \\n for a line break.';
    styleCard.appendChild(labelTemplateInput);

    var labelAttrList = npwCreate('div', 'npw-attr-list');
    styleCard.appendChild(labelAttrList);

    // --- Stroke colour + label size ---
    var strokeRow = styleFieldRow('Stroke Color');
    var styleStrokeInput = document.createElement('input');
    styleStrokeInput.type = 'color';
    styleStrokeInput.id = 'npwStyleStroke';
    styleStrokeInput.className = 'npw-color';
    strokeRow.appendChild(styleStrokeInput);
    strokeRow.appendChild(npwCreate('span', 'npw-field-label', 'Font Size'));
    var fontSizeInput = styleNumberInput('npwStyleFontSize', 0, 40, 1);
    strokeRow.appendChild(fontSizeInput);

    // --- Label colour + "match stroke" ---
    var labelRow = styleFieldRow('Label Color');
    var styleLabelColorInput = document.createElement('input');
    styleLabelColorInput.type = 'color';
    styleLabelColorInput.id = 'npwStyleLabelColor';
    styleLabelColorInput.className = 'npw-color';
    labelRow.appendChild(styleLabelColorInput);
    var labelSync = styleToggleBox('npwStyleLabelSync', 'Match stroke', 'Use the stroke colour for the label text');
    labelRow.appendChild(labelSync.wrap);

    // --- Outline colour + "match stroke" ---
    var outlineRow = styleFieldRow('Outline Color');
    var styleOutlineColorInput = document.createElement('input');
    styleOutlineColorInput.type = 'color';
    styleOutlineColorInput.id = 'npwStyleOutlineColor';
    styleOutlineColorInput.className = 'npw-color';
    outlineRow.appendChild(styleOutlineColorInput);
    var outlineSync = styleToggleBox('npwStyleOutlineSync', 'Match stroke', 'Use the stroke colour for the label outline');
    outlineRow.appendChild(outlineSync.wrap);

    // --- Outline width + "relative to font size" ---
    var outlineWidthRow = styleFieldRow('Outline Width');
    var styleOutlineWidthInput = styleNumberInput('npwStyleOutlineWidth', 0, 20, 0.5);
    outlineWidthRow.appendChild(styleOutlineWidthInput);
    var outlineRelative = styleToggleBox('npwStyleOutlineRelative', 'Relative to font size', 'Calculate the outline width as font size / 4');
    outlineWidthRow.appendChild(outlineRelative.wrap);

    // --- Fill opacity ---
    var fillRow = styleFieldRow('Fill Opacity');
    var fillControl = styleRangeControl('npwStyleFillOpacity', 0, 1, 0.01, function (value) {
      return Math.round(value * 100) + '%';
    });
    fillRow.appendChild(fillControl.input);
    fillRow.appendChild(fillControl.valueEl);

    // --- Line stroke: size ---
    var lineSizeRow = styleFieldRow('Line Size');
    var styleLineSizeInput = styleNumberInput('npwStyleLineSize', 0, 20, 0.5);
    lineSizeRow.appendChild(styleLineSizeInput);

    // --- Line stroke: style radios ---
    var lineStyleRow = npwCreate('div', 'npw-radio-row');
    lineStyleRow.appendChild(npwCreate('span', 'npw-field-label', 'Line Style'));
    var lineStyleOptions = npwCreate('div', 'npw-radio-options');
    var styleLineStyleRadios = [];
    ['solid', 'dash', 'dot'].forEach(function (value) {
      var option = npwCreate('label', 'npw-radio-option');
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'npwStyleLineStyle';
      radio.value = value;
      option.appendChild(radio);
      option.appendChild(document.createTextNode(value.charAt(0).toUpperCase() + value.slice(1)));
      lineStyleOptions.appendChild(option);
      styleLineStyleRadios.push(radio);
    });
    lineStyleRow.appendChild(lineStyleOptions);
    styleCard.appendChild(lineStyleRow);

    // --- Line stroke: opacity ---
    var lineOpacityRow = styleFieldRow('Line Opacity');
    var lineOpacityControl = styleRangeControl('npwStyleLineOpacity', 0, 1, 0.05, function (value) {
      return Math.round(value * 100) + '%';
    });
    lineOpacityRow.appendChild(lineOpacityControl.input);
    lineOpacityRow.appendChild(lineOpacityControl.valueEl);

    // --- Label position (horizontal + vertical = OL2 labelAlign) ---
    var posRow = npwCreate('div', 'npw-radio-row');
    posRow.appendChild(npwCreate('span', 'npw-field-label', 'Label Position'));
    var posOptions = npwCreate('div', 'npw-radio-options');
    var stylePosRadios = { h: [], v: [] };
    [
      ['h', [['l', 'Left'], ['c', 'Center'], ['r', 'Right']]],
      ['v', [['t', 'Top'], ['m', 'Middle'], ['b', 'Bottom']]],
    ].forEach(function (group) {
      group[1].forEach(function (pair) {
        var option = npwCreate('label', 'npw-radio-option');
        var radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'npwStyleLabelPos' + group[0].toUpperCase();
        radio.value = pair[0];
        option.appendChild(radio);
        option.appendChild(document.createTextNode(pair[1]));
        posOptions.appendChild(option);
        stylePosRadios[group[0]].push(radio);
      });
    });
    posRow.appendChild(posOptions);
    styleCard.appendChild(posRow);

    var styleCardStatus = npwCreate('div', 'npw-status', '');
    styleCard.appendChild(styleCardStatus);

    var styleBtnRow = npwButtonRow(styleCard);
    var styleResetGlobalBtn = npwButton(styleBtnRow, 'Reset to defaults', 'Reset the global style; per-layer overrides are kept', 'accent');
    var styleResetLayerBtn = npwButton(styleBtnRow, 'Reset this layer', 'Drop this layer\'s override so it follows the global style again', 'neutral');

    // The scope dropdown value is "global" or "layer:<layerName>".
    function styleScopeLayerName() {
      var value = styleScopeSelect.value || 'global';
      return value.indexOf(STYLE_LAYER_KEY_PREFIX) === 0 ? value.slice(STYLE_LAYER_KEY_PREFIX.length) : null;
    }

    function readStyleControls() {
      var style = {};
      Object.keys(FEATURE_STYLE_DEFAULTS).forEach(function (key) {
        style[key] = FEATURE_STYLE_DEFAULTS[key];
      });
      style.strokeColor = styleStrokeInput.value;
      style.fontSize = Number(fontSizeInput.value) || FEATURE_STYLE_DEFAULTS.fontSize;
      style.labelColorSync = labelSync.box.checked;
      style.labelColor = styleLabelColorInput.value;
      style.outlineColorSync = outlineSync.box.checked;
      style.outlineColor = styleOutlineColorInput.value;
      style.outlineWidthRelative = outlineRelative.box.checked;
      style.outlineWidth = Number(styleOutlineWidthInput.value) || 0;
      style.fillOpacity = parseFloat(fillControl.input.value);
      style.lineSize = Number(styleLineSizeInput.value) || 0;
      style.lineOpacity = parseFloat(lineOpacityControl.input.value);
      var horizontal = stylePosRadios.h.filter(function (radio) { return radio.checked; })[0];
      var vertical = stylePosRadios.v.filter(function (radio) { return radio.checked; })[0];
      style.labelPos = (horizontal || stylePosRadios.h[1]).value + (vertical || stylePosRadios.v[1]).value;
      var lineStyleRadio = styleLineStyleRadios.filter(function (radio) { return radio.checked; })[0];
      style.lineStyle = lineStyleRadio ? lineStyleRadio.value : FEATURE_STYLE_DEFAULTS.lineStyle;
      style.labelField = currentLabelFieldValue();
      return style;
    }

    function populateStyleControls(style) {
      styleStrokeInput.value = style.strokeColor;
      fontSizeInput.value = String(style.fontSize);
      labelSync.box.checked = !!style.labelColorSync;
      styleLabelColorInput.value = style.labelColor;
      styleLabelColorInput.disabled = !!style.labelColorSync;
      outlineSync.box.checked = !!style.outlineColorSync;
      styleOutlineColorInput.value = style.outlineColor;
      styleOutlineColorInput.disabled = !!style.outlineColorSync;
      outlineRelative.box.checked = !!style.outlineWidthRelative;
      styleOutlineWidthInput.value = String(style.outlineWidth);
      styleOutlineWidthInput.disabled = !!style.outlineWidthRelative;
      fillControl.input.value = String(style.fillOpacity);
      fillControl.readout();
      styleLineSizeInput.value = String(style.lineSize);
      lineOpacityControl.input.value = String(style.lineOpacity);
      lineOpacityControl.readout();
      styleLineStyleRadios.forEach(function (radio) {
        radio.checked = radio.value === style.lineStyle;
      });
      stylePosRadios.h.forEach(function (radio) {
        radio.checked = style.labelPos.charAt(0) === radio.value;
      });
      stylePosRadios.v.forEach(function (radio) {
        radio.checked = style.labelPos.charAt(1) === radio.value;
      });
    }

    /** The labelField value the two label controls currently describe. */
    function currentLabelFieldValue() {
      if (labelFieldSelect.value === LABEL_FIELD_NONE) return LABEL_FIELD_NONE;
      return labelTemplateInput.value.trim() || LABEL_FIELD_BUILTIN;
    }

    // Property keys available in the selected scope, taken from the first feature of each
    // layer. `__bbox` is our own windowing bookkeeping and `custom_label` is the built-in
    // label, so neither is offered as a label source.
    function labelFieldKeys() {
      var layerName = styleScopeLayerName();
      var keys = [];
      var seen = {};
      loadedGeoJSONLayers.forEach(function (info) {
        if (layerName && info.name !== layerName) return;
        var sample = info.sdkFeatures && info.sdkFeatures[0] && info.sdkFeatures[0].properties;
        if (!sample) return;
        Object.keys(sample).forEach(function (key) {
          if (key === '__bbox' || key === 'custom_label' || seen[key]) return;
          seen[key] = true;
          keys.push(key);
        });
      });
      keys.sort();
      return keys;
    }

    /** Rebuilds the label-field select, the template box and the attribute list. */
    function refreshLabelFieldControls(force) {
      if (!labelFieldSelect) return; // the Style Settings card is not built yet
      // Layer churn while panning would otherwise rebuild this on every add/remove, even
      // with the Settings tab closed. `force` is used by the tab's onShow hook and after
      // a publish, i.e. whenever somebody is actually looking at it.
      if (!force && settingsPane && settingsPane.hidden) return;

      var layerName = styleScopeLayerName();
      var current = rawStyleValues(layerName).labelField || '';
      var keys = labelFieldKeys();

      labelFieldSelect.innerHTML = '';
      var addOption = function (value, text) {
        var el = document.createElement('option');
        el.value = value;
        el.textContent = text;
        labelFieldSelect.appendChild(el);
      };
      addOption(LABEL_FIELD_BUILTIN, 'Built-in (layer default)');
      keys.forEach(function (key) {
        addOption(key, key);
      });
      addOption(LABEL_FIELD_NONE, '\u2014 No label \u2014');
      // Only shown when the saved value is not one of the options above, i.e. a template.
      if (current && current !== LABEL_FIELD_NONE && keys.indexOf(current) === -1) {
        addOption(LABEL_FIELD_CUSTOM, 'Custom template');
      }

      if (current === LABEL_FIELD_NONE) labelFieldSelect.value = LABEL_FIELD_NONE;
      else if (!current) labelFieldSelect.value = LABEL_FIELD_BUILTIN;
      else if (keys.indexOf(current) !== -1) labelFieldSelect.value = current;
      else labelFieldSelect.value = LABEL_FIELD_CUSTOM;

      labelTemplateInput.value = current === LABEL_FIELD_NONE ? '' : current;
      labelTemplateInput.disabled = current === LABEL_FIELD_NONE;
      labelFieldSelect.disabled = loadedGeoJSONLayers.length === 0;

      // The read-only attribute list is what makes the picker usable on the municipality
      // KML, whose ArcGIS names (GAPA_NAP_2, GN_TYPE_13) are otherwise pure guesswork.
      labelAttrList.innerHTML = '';
      var sampleInfo = layerName ? findGeoJsonLayer(layerName) : loadedGeoJSONLayers[0];
      var sampleProps =
        sampleInfo && sampleInfo.sdkFeatures && sampleInfo.sdkFeatures[0] && sampleInfo.sdkFeatures[0].properties;
      if (!sampleProps) {
        labelAttrList.appendChild(npwCreate('div', 'npw-attr-empty', 'No layer loaded yet.'));
        return;
      }
      Object.keys(sampleProps).forEach(function (key) {
        if (key === '__bbox') return;
        var row = npwCreate('div', 'npw-attr-row');
        row.appendChild(npwCreate('span', 'npw-attr-key', key));
        row.appendChild(npwCreate('span', 'npw-attr-value', npwAttrPreview(sampleProps[key])));
        labelAttrList.appendChild(row);
      });
    }

    /** Saves a labelField into the current scope and re-syncs the controls. */
    function publishLabelField(value) {
      var style = readStyleControls();
      style.labelField = value;
      var layerName = styleScopeLayerName();
      if (layerName) saveLayerFeatureStyle(layerName, style);
      else saveGlobalFeatureStyle(style);
      refreshLabelFieldControls(true);
      styleCardStatus.textContent = layerName
        ? 'Label field saved for ' + layerName + '.'
        : 'Label field saved for the global style.';
    }

    function loadStyleScope() {
      var layerName = styleScopeLayerName();
      populateStyleControls(rawStyleValues(layerName));
      refreshLabelFieldControls();
      styleResetLayerBtn.disabled = !layerName;
      styleCardStatus.textContent = layerName
        ? 'Editing the override for ' + layerName + '.'
        : 'Editing the global style used by every feature layer without an override.';
    }

    function onStyleControlChange() {
      var style = readStyleControls();
      // Keep the dependent controls in step with their switches.
      styleLabelColorInput.disabled = style.labelColorSync;
      styleOutlineColorInput.disabled = style.outlineColorSync;
      if (style.labelColorSync) {
        style.labelColor = style.strokeColor;
        styleLabelColorInput.value = style.strokeColor;
      }
      if (style.outlineColorSync) {
        style.outlineColor = style.strokeColor;
        styleOutlineColorInput.value = style.strokeColor;
      }
      styleOutlineWidthInput.disabled = style.outlineWidthRelative;
      if (style.outlineWidthRelative) {
        styleOutlineWidthInput.value = String(Number(style.fontSize) / 4);
      }
      var layerName = styleScopeLayerName();
      if (layerName) saveLayerFeatureStyle(layerName, style);
      else saveGlobalFeatureStyle(style);
    }

    [
      styleStrokeInput, fontSizeInput, styleLabelColorInput, styleOutlineColorInput,
      styleOutlineWidthInput, styleLineSizeInput, fillControl.input, lineOpacityControl.input,
    ].forEach(function (control) {
      control.addEventListener('input', onStyleControlChange);
      control.addEventListener('change', onStyleControlChange);
    });
    [labelSync.box, outlineSync.box, outlineRelative.box]
      .concat(styleLineStyleRadios, stylePosRadios.h, stylePosRadios.v)
      .forEach(function (control) {
        control.addEventListener('change', onStyleControlChange);
      });

    styleScopeSelect.addEventListener('change', loadStyleScope);

    // Selecting a property fills the template box rather than replacing it, so the value
    // stays editable and "${district} - ${gapa_napa}" can be typed on top of a pick.
    labelFieldSelect.addEventListener('change', function () {
      var value = labelFieldSelect.value;
      if (value === LABEL_FIELD_CUSTOM) {
        labelTemplateInput.focus(); // display-only state - nothing to publish
        return;
      }
      labelTemplateInput.value =
        value === LABEL_FIELD_BUILTIN || value === LABEL_FIELD_NONE ? '' : value;
      labelTemplateInput.disabled = value === LABEL_FIELD_NONE;
      publishLabelField(value);
    });
    labelTemplateInput.addEventListener('change', function () {
      publishLabelField(labelTemplateInput.value.trim() || LABEL_FIELD_BUILTIN);
    });

    styleResetGlobalBtn.addEventListener('click', function () {
      clearGlobalFeatureStyle();
      loadStyleScope();
      styleCardStatus.textContent = 'Global style reset to defaults.';
    });
    styleResetLayerBtn.addEventListener('click', function () {
      var layerName = styleScopeLayerName();
      if (!layerName) return;
      clearLayerFeatureStyle(layerName);
      loadStyleScope();
      styleCardStatus.textContent = layerName + ' now follows the global style.';
    });

    fillStyleScopeSelect();
    loadStyleScope();

    // --- Settings tab: Postal Codes (Google Sheet -> ward features) ----------
    buildPostalCard(settingsPane, function () {
      refreshLabelFieldControls(true);
    });

    // --- Postal code in the feature edit panel ---------------------------------
    // wme-feature-editor-opened is the PRIMARY trigger: it fires when the panel opens and
    // names the feature type, so a feature is handled as soon as its panel appears (and an
    // unrelated panel drops a card left over from the previous selection).
    //
    // Segments AND venues are handled. Google places are NOT: the address Google carries is
    // often wrong (see postalUpdateAddressCard) and there is no reliable way to know whether
    // the one on screen belongs to the ward the place sits in, so no card is shown for them.
    wmeSDK.Events.on({
      eventName: 'wme-feature-editor-opened',
      eventHandler: function (evt) {
        if (evt && (evt.featureType === 'segment' || evt.featureType === 'venue')) {
          postalScheduleAddressCard(80);
        } else {
          postalRemoveAddressCard();
        }
      },
    });
    // wme-selection-changed stays as the fallback: it also covers a selection change made
    // while the panel is ALREADY open, which does not re-open it. The first pass catches a
    // segment that was selected before the script finished loading.
    wmeSDK.Events.on({
      eventName: 'wme-selection-changed',
      eventHandler: function () {
        postalScheduleAddressCard();
      },
    });
    postalScheduleAddressCard(400);

    // One card per layer group, with the per-layer checkboxes.
    buildLayerCategoryPanels(layersPane);
    // Now that the checkboxes exist, push the stored state onto the OL2 layers.
    syncAllTogglerVisibility();

    // --- Layer tools: pick a layer for shifting / per-layer opacity ---
    var section = npwCard(shiftingPane, 'Layer tools');
    section.id = 'WMS';
    // One dropdown for both kinds of layer: the WMS layers on the map and the
    // GeoJSON layers loaded from the "Layers" tab (see fillWMSLayersSelectList).
    section.appendChild(npwCreate('span', 'npw-small-label', 'Layer to shift (WMS or GeoJSON, switched on):'));
    var WMSSelect = document.createElement('select');
    WMSSelect.id = 'WMSLayersSelect';
    WMSSelect.className = 'npw-select';
    section.appendChild(WMSSelect);
    var opacityRange = document.createElement('input');
    var opacityLabel = document.createElement('label');
    opacityRange.type = 'range';
    opacityRange.min = 0;
    opacityRange.max = 100;
    opacityRange.value = 100;
    opacityRange.className = 'npw-opacity-slider';
    opacityRange.id = 'WMSOpacity';
    opacityLabel.textContent = 'Layer transparency: ' + opacityRange.value + ' %';
    opacityLabel.className = 'npw-small-label';
    opacityLabel.id = 'WMSOpacityLabel';
    opacityLabel.htmlFor = opacityRange.id;
    section.appendChild(opacityLabel);
    section.appendChild(opacityRange);

    // Shift controls (3x3 pad)
    var shiftContainer = document.createElement('div');
    shiftContainer.style.marginTop = '8px';
    shiftContainer.appendChild(npwCreate('span', 'npw-small-label', 'Shift distance (meters):'));
    var distanceInput = document.createElement('input');
    distanceInput.type = 'number';
    distanceInput.value = 1;
    distanceInput.min = 1;
    distanceInput.className = 'npw-input';
    distanceInput.id = 'WMSShiftDistance';
    shiftContainer.appendChild(distanceInput);
    npwBuildShiftPad(
      shiftContainer,
      function (direction) {
        shiftSelectedLayer(direction);
      },
      function () {
        resetSelectedLayerShift();
      }
    );
    section.appendChild(shiftContainer);

    // Shows the shift currently applied to the selected layer, including a built-in
    // default - feedback that an inaccurate service is already corrected on load.
    var wmsShiftStatus = npwCreate('div', 'npw-status', '');
    wmsShiftStatus.id = 'WMSShiftStatus';
    section.appendChild(wmsShiftStatus);

    // Helper: patch getURL to apply offset
    function patchWMSLayerGetURL(layer) {
      if (!layer || layer._wmsShiftPatched) return;
      const origGetURL = layer.getURL;
      layer._wmsShiftPatched = true;
      layer.getURL = function (bounds) {
        const offset = wmsLayerOffsets?.[layer.name] ?? { x: 0, y: 0 };
        const newBounds = bounds.clone();
        newBounds.right += offset.x;
        newBounds.left += offset.x;
        newBounds.top += offset.y;
        newBounds.bottom += offset.y;
        return origGetURL.call(this, newBounds);
      };
    }

    // Helper to shift a WMS layer. The pad passes the TOGGLER key (the dropdown value
    // after "wms:"), and every layer of that toggler which is on the map is shifted -
    // exactly the set its checkbox controls.
    function shiftLayer(direction, togglerKey, dist) {
      if (!togglerKey || !dist) return;
      var layers = findWmsLayersForTarget(togglerKey);
      if (!layers.length) {
        // Never fail silently: an empty result is what made the pad look dead.
        WazeToastr.Alerts.warning('Layer Not On Map', 'Switch the layer on first, then shift it.', false, false, 2500);
        return;
      }
      var map = W.map;
      var proj = map.getProjectionObject();
      var dx = 0,
        dy = 0;
      var diag = dist * 0.7071; // sqrt(2)/2 for diagonal
      if (proj && proj.projCode === 'EPSG:4326') {
        var centerLat = getMapCenterLat();
        var metersPerDegreeLat = 111320;
        var metersPerDegreeLon = (40075000 * Math.cos((centerLat * Math.PI) / 180)) / 360;
        switch (direction) {
          case 'up':
            dy = -dist / metersPerDegreeLat;
            break;
          case 'down':
            dy = dist / metersPerDegreeLat;
            break;
          case 'left':
            dx = dist / metersPerDegreeLon;
            break;
          case 'right':
            dx = -dist / metersPerDegreeLon;
            break;
          case 'upleft':
            dx = diag / metersPerDegreeLon;
            dy = -diag / metersPerDegreeLat;
            break;
          case 'upright':
            dx = -diag / metersPerDegreeLon;
            dy = -diag / metersPerDegreeLat;
            break;
          case 'downleft':
            dx = diag / metersPerDegreeLon;
            dy = diag / metersPerDegreeLat;
            break;
          case 'downright':
            dx = -diag / metersPerDegreeLon;
            dy = diag / metersPerDegreeLat;
            break;
        }
      } else {
        switch (direction) {
          case 'up':
            dy = -dist;
            break;
          case 'down':
            dy = dist;
            break;
          case 'left':
            dx = dist;
            break;
          case 'right':
            dx = -dist;
            break;
          case 'upleft':
            dx = diag;
            dy = -diag;
            break;
          case 'upright':
            dx = -diag;
            dy = -diag;
            break;
          case 'downleft':
            dx = diag;
            dy = diag;
            break;
          case 'downright':
            dx = -diag;
            dy = diag;
            break;
        }
      }
      // Apply the same step to every layer of the toggler, remembering each one so the
      // correction survives a page reload.
      layers.forEach(function (layer) {
        patchWMSLayerGetURL(layer);
        if (!wmsLayerOffsets[layer.name]) wmsLayerOffsets[layer.name] = { x: 0, y: 0 };
        wmsLayerOffsets[layer.name].x += dx;
        wmsLayerOffsets[layer.name].y += dy;
        if (!wmsLayerOriginalOffsets[layer.name]) {
          wmsLayerOriginalOffsets[layer.name] = { x: 0, y: 0 };
        }
        rememberWmsLayerOffset(layer.name);
        layer.redraw();
      });
      refreshWmsShiftStatus();
      // Show WazeToastr alert
      WazeToastr.Alerts.info('Layer Shifted', `Layer shifted to ${dist} metres ${direction}. Please wait for fully load.`, false, false, 2000);
    }
    // Reset the shift of every on-map layer of the given toggler back to its built-in
    // default (its published position when it has none).
    function resetWMSLayerShift(togglerKey) {
      if (!togglerKey) return;
      var layers = findWmsLayersForTarget(togglerKey);
      if (!layers.length) {
        WazeToastr.Alerts.warning('Layer Not On Map', 'Switch the layer on first, then reset it.', false, false, 2500);
        return;
      }
      var stored = loadStoredLayerOffsets();
      var presetText = null;
      layers.forEach(function (layer) {
        patchWMSLayerGetURL(layer);
        var preset = wmsLayerPresetOffsets[layer.name];
        if (presetText === null && preset) presetText = describeWmsOffset(preset);
        wmsLayerOffsets[layer.name] = preset ? { x: preset.x, y: preset.y } : { x: 0, y: 0 };
        delete stored[layer.name];
        layer.redraw();
      });
      saveStoredLayerOffsets(stored);
      refreshWmsShiftStatus();
      // Show WazeToastr alert on reset
      var resetMessage = presetText
        ? 'Layer shift reset to the built-in default (' + presetText + ').'
        : 'Layer shift has been reset to default.';
      WazeToastr.Alerts.info('Layer Reset', resetMessage, false, false, 2000);
    }

    // --- Shared shift pad ---------------------------------------------------
    // ONE set of buttons drives whichever layer the "Layer tools" dropdown has
    // selected. Only the dispatch is shared: the WMS engine moves the requested bbox
    // (content travels the other way) while the GeoJSON engine translates feature
    // coordinates, and their direction tables are deliberately mirrored. Routing to
    // the two existing engines keeps both behaviours intact.
    function shiftSelectedLayer(direction) {
      var target = selectedShiftTarget();
      var distInput = document.getElementById('WMSShiftDistance');
      var dist = distInput ? parseFloat(distInput.value) || 0 : 0;
      if (!target || !dist) {
        WazeToastr.Alerts.warning('Selection Required', 'Please select a layer and enter a shift distance.', false, false, 2000);
        return;
      }
      if (target.type === 'geojson') {
        shiftGeoJsonLayer(direction, target.name, dist);
      } else {
        shiftLayer(direction, target.name, dist);
      }
    }

    function resetSelectedLayerShift() {
      var target = selectedShiftTarget();
      if (!target) {
        WazeToastr.Alerts.warning('Selection Required', 'Please select a layer to reset.', false, false, 2000);
        return;
      }
      if (target.type === 'geojson') {
        resetGeoJsonShift(target.name);
      } else {
        resetWMSLayerShift(target.name);
      }
    }

    // The opacity slider only works on WMS layers (an SDK feature layer has no
    // setOpacity), so it follows the selected layer kind instead of doing nothing.
    function syncOpacityControlToSelection() {
      var target = selectedShiftTarget();
      var isWms = !!target && target.type === 'wms';
      opacityRange.disabled = !isWms;
      if (!isWms) {
        opacityLabel.textContent = 'Layer transparency (WMS layers only)';
        return;
      }
      var layer = W.map.getLayers().find(l => l.name === target.name) || null;
      if (!layer) return;
      opacityRange.value = layer.opacity * 100;
      opacityLabel.textContent = 'Layer transparency: ' + opacityRange.value + ' %';
    }


    // --- "Lalitpur HN Address Wards" - viewport auto-loader -------------------
    // Loads the ticked wards' address points + boundary from geonep.com.np whenever a
    // ward's bounding box enters the map view, and drops them again once they leave it.
    var wardCard = npwCard(layersPane, 'Lalitpur HN Address Wards', {
      collapsible: true,
      storageKey: 'lalitpur-hn-wards',
    });
    wardCard.id = 'LMCWardGroup';
    var wardBody = wardCard.npwBody;

    wardBody.appendChild(npwCreate('div', 'npw-status', 'Loads the address points and boundary of every ticked ward that is inside the map view. Zoom ' + LMC_MIN_ZOOM + '+ and switch the layer on.'));

    // Master switch for the whole group.
    var lmcMasterRow = npwCreate('div', 'npw-layer-item');
    var lmcMasterCheckbox = document.createElement('input');
    lmcMasterCheckbox.type = 'checkbox';
    lmcMasterCheckbox.className = 'npw-checkbox';
    lmcMasterCheckbox.id = 'lmcAutoToggle';
    lmcMasterCheckbox.checked = lmcAutoEnabled;
    var lmcMasterLabel = npwCreate('label', 'npw-label', 'Auto-load ticked wards in view');
    lmcMasterLabel.title = 'Load the address points and boundary of every ticked ward that intersects the current viewport';
    lmcMasterLabel.addEventListener('click', function () {
      lmcMasterCheckbox.checked = !lmcMasterCheckbox.checked;
      lmcMasterCheckbox.dispatchEvent(new Event('change'));
    });
    lmcMasterRow.appendChild(lmcMasterCheckbox);
    lmcMasterRow.appendChild(lmcMasterLabel);
    wardBody.appendChild(lmcMasterRow);

    // Off-screen cleanup toggle.
    var lmcRemoveRow = npwCreate('div', 'npw-layer-item');
    var lmcRemoveCheckbox = document.createElement('input');
    lmcRemoveCheckbox.type = 'checkbox';
    lmcRemoveCheckbox.className = 'npw-checkbox';
    lmcRemoveCheckbox.id = 'lmcAutoRemove';
    lmcRemoveCheckbox.checked = lmcAutoRemoveEnabled;
    var lmcRemoveLabel = npwCreate('label', 'npw-label', 'Auto-remove off-screen layers');
    lmcRemoveLabel.title = 'Remove an auto-loaded ward once it is ' + Math.round(LMC_EVICT_PADDING * 100) + '% of a viewport clear of the edges, after a ' + Math.round(LMC_EVICT_GRACE_MS / 1000) + ' s grace period';
    lmcRemoveLabel.addEventListener('click', function () {
      lmcRemoveCheckbox.checked = !lmcRemoveCheckbox.checked;
      lmcRemoveCheckbox.dispatchEvent(new Event('change'));
    });
    lmcRemoveRow.appendChild(lmcRemoveCheckbox);
    lmcRemoveRow.appendChild(lmcRemoveLabel);
    wardBody.appendChild(lmcRemoveRow);

    // View window: put only the features inside the padded view on the layers.
    var lmcViewRow = npwCreate('div', 'npw-layer-item');
    var lmcViewCheckbox = document.createElement('input');
    lmcViewCheckbox.type = 'checkbox';
    lmcViewCheckbox.className = 'npw-checkbox';
    lmcViewCheckbox.id = 'lmcViewFilter';
    lmcViewCheckbox.checked = lmcViewFilterEnabled;
    var lmcViewLabel = npwCreate('label', 'npw-label', 'Only put the current view on the map');
    lmcViewLabel.title = 'Put only the features inside the view (padded by ' + Math.round(LMC_WINDOW_PADDING * 100) + '%) on the layer instead of the whole loaded ward; the rest is added as you pan to it';
    lmcViewLabel.addEventListener('click', function () {
      lmcViewCheckbox.checked = !lmcViewCheckbox.checked;
      lmcViewCheckbox.dispatchEvent(new Event('change'));
    });
    lmcViewRow.appendChild(lmcViewCheckbox);
    lmcViewRow.appendChild(lmcViewLabel);
    wardBody.appendChild(lmcViewRow);

    lmcMasterCheckbox.addEventListener('change', function () {
      setLmcAutoEnabled(lmcMasterCheckbox.checked);
    });
    lmcRemoveCheckbox.addEventListener('change', function () {
      setLmcAutoRemoveEnabled(lmcRemoveCheckbox.checked);
    });
    lmcViewCheckbox.addEventListener('change', function () {
      setLmcViewFilterEnabled(lmcViewCheckbox.checked);
    });

    // One checkbox per ward, in a compact grid.
    wardBody.appendChild(npwCreate('span', 'npw-small-label', 'Wards (1-' + LMC_WARD_COUNT + '):'));
    var lmcWardGrid = npwCreate('div', 'npw-ward-grid');
    for (var wardNo = 1; wardNo <= LMC_WARD_COUNT; wardNo++) {
      (function (ward) {
        var item = npwCreate('label', 'npw-ward-item');
        item.title = 'Load ward ' + ward + ' when it is in view';
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'npw-checkbox';
        box.id = 'lmcWard' + ward;
        box.checked = !!lmcEnabledWards[ward];
        box.addEventListener('change', function () {
          setLmcWardEnabled(ward, box.checked);
        });
        item.appendChild(box);
        item.appendChild(npwCreate('span', 'npw-ward-text', String(ward)));
        lmcWardGrid.appendChild(item);
      })(wardNo);
    }
    wardBody.appendChild(lmcWardGrid);

    var lmcStatus = npwCreate('div', 'npw-status', lmcAutoEnabled ? 'Waiting for map…' : 'Disabled');
    lmcStatus.id = 'lmcAutoStatus';
    wardBody.appendChild(lmcStatus);

    npwButton(wardBody, 'Clear auto-loaded layers', 'Remove every automatically loaded ward layer', 'danger')
      .addEventListener('click', function () {
        clearLmcViewportLayers();
      });

    // --- "Nepal GIS Layers" - hierarchy viewport auto-loader ------------------
    // Same viewport model as the LMC ward card above, but the areas are discovered
    // from the published WME-Nepal-GIS-Layers manifests and outlines, so the coverage
    // is national and multilevel instead of a fixed ward list.
    var npGisCard = npwCard(layersPane, 'Nepal GIS Layers', {
      collapsible: true,
      storageKey: 'nepal-gis-layers',
    });
    npGisCard.id = 'NpGisGroup';
    var npGisBody = npGisCard.npwBody;

    npGisBody.appendChild(
      npwCreate(
        'div',
        'npw-status',
        'Loads the hierarchy inside the map view: dissolved province and district outlines, plus the municipality and ward polygons of every local unit, each from its own KML. Every level has its own zoom gate - tick a level to load it, and zoom in until it appears.'
      )
    );

    // Master switch for the whole group.
    var npGisMasterRow = npwCreate('div', 'npw-layer-item');
    var npGisMasterCheckbox = document.createElement('input');
    npGisMasterCheckbox.type = 'checkbox';
    npGisMasterCheckbox.className = 'npw-checkbox';
    npGisMasterCheckbox.id = 'npGisAutoToggle';
    npGisMasterCheckbox.checked = npGisEnabled;
    var npGisMasterLabel = npwCreate('label', 'npw-label', 'Auto-load layers in view');
    npGisMasterLabel.title =
      'Download and show every ticked level whose bounding box intersects the current viewport';
    npGisMasterLabel.addEventListener('click', function () {
      npGisMasterCheckbox.checked = !npGisMasterCheckbox.checked;
      npGisMasterCheckbox.dispatchEvent(new Event('change'));
    });
    npGisMasterRow.appendChild(npGisMasterCheckbox);
    npGisMasterRow.appendChild(npGisMasterLabel);
    npGisBody.appendChild(npGisMasterRow);

    // Hierarchy levels, drawn bottom -> top. The colour dot mirrors the per-level stroke
    // colour so the map is readable without hovering. Ward is the only level ticked by
    // default: the three outline levels are wide fills that would hide the map unasked.
    npGisBody.appendChild(npwCreate('span', 'npw-small-label', 'Levels:'));
    var npGisLevelRow = npwCreate('div', 'npw-level-row');
    var npGisLevelSource = {
      province: 'one dissolved outline per province',
      district: 'one dissolved outline per district',
      municipality: 'one polygon per local unit, each from its own KML',
      ward: 'one polygon per ward, labelled with the ward name the KML carries',
    };
    NP_GIS_LEVELS.forEach(function (level) {
      var levelStyle = NP_GIS_LEVEL_STYLE[level] || {};
      var levelItem = npwCreate('label', 'npw-level-item');
      levelItem.title =
        NP_GIS_LEVEL_LABEL[level] +
        ' — ' +
        (npGisLevelSource[level] || '') +
        '. Drawn in ' +
        (levelStyle.color || 'the Style Settings colour') +
        ', loaded from zoom ' +
        NP_GIS_LEVEL_MIN_ZOOM[level] +
        '+ (below that its layers are dropped again). Default label: ' +
        (NP_GIS_LEVEL_DEFAULT_LABEL[level] || 'the ward name the KML carries');
      var levelDot = npwCreate('span', 'npw-level-dot');
      levelDot.style.backgroundColor = levelStyle.color || 'transparent';
      var levelCheckbox = document.createElement('input');
      levelCheckbox.type = 'checkbox';
      levelCheckbox.className = 'npw-checkbox';
      levelCheckbox.id = 'npGisLevel' + level.charAt(0).toUpperCase() + level.slice(1);
      levelCheckbox.checked = !!npGisLevelsEnabled[level];
      levelCheckbox.addEventListener('change', function () {
        setNpGisLevelEnabled(level, levelCheckbox.checked);
      });
      levelItem.appendChild(levelCheckbox);
      levelItem.appendChild(levelDot);
      levelItem.appendChild(npwCreate('span', 'npw-level-text', NP_GIS_LEVEL_LABEL[level]));
      npGisLevelRow.appendChild(levelItem);
    });
    npGisBody.appendChild(npGisLevelRow);

    // Off-screen cleanup toggle.
    var npGisRemoveRow = npwCreate('div', 'npw-layer-item');
    var npGisRemoveCheckbox = document.createElement('input');
    npGisRemoveCheckbox.type = 'checkbox';
    npGisRemoveCheckbox.className = 'npw-checkbox';
    npGisRemoveCheckbox.id = 'npGisAutoRemove';
    npGisRemoveCheckbox.checked = npGisAutoRemoveEnabled;
    var npGisRemoveLabel = npwCreate('label', 'npw-label', 'Auto-remove off-screen layers');
    npGisRemoveLabel.title =
      'Remove an auto-loaded ward once it is ' +
      Math.round(NP_GIS_EVICT_PADDING * 100) +
      '% of a viewport clear of the edges, after a ' +
      Math.round(NP_GIS_EVICT_GRACE_MS / 1000) +
      ' s grace period';
    npGisRemoveLabel.addEventListener('click', function () {
      npGisRemoveCheckbox.checked = !npGisRemoveCheckbox.checked;
      npGisRemoveCheckbox.dispatchEvent(new Event('change'));
    });
    npGisRemoveRow.appendChild(npGisRemoveCheckbox);
    npGisRemoveRow.appendChild(npGisRemoveLabel);
    npGisBody.appendChild(npGisRemoveRow);

    npGisMasterCheckbox.addEventListener('change', function () {
      setNpGisEnabled(npGisMasterCheckbox.checked);
    });
    npGisRemoveCheckbox.addEventListener('change', function () {
      setNpGisAutoRemoveEnabled(npGisRemoveCheckbox.checked);
    });

    var npGisStatus = npwCreate('div', 'npw-status', npGisEnabled ? 'Waiting for map…' : 'Disabled');
    npGisStatus.id = 'npGisStatus';
    npGisBody.appendChild(npGisStatus);

    npwButton(npGisBody, 'Clear Nepal GIS wards', 'Remove every automatically loaded Nepal GIS ward layer', 'danger')
      .addEventListener('click', function () {
        clearNpGisLayers();
      });

    fillWMSLayersSelectList();
    syncOpacityControlToSelection();
    refreshWmsShiftStatus();
    opacityRange.addEventListener('input', function () {
      var target = selectedShiftTarget();
      if (!target || target.type !== 'wms') return;
      var layer = W.map.getLayers().find(l => l.name === target.name) || null;
      if (!layer) return;
      layer.setOpacity(opacityRange.value / 100);
      opacityLabel.textContent = 'Layer transparency: ' + opacityRange.value + ' %';
    });
    WMSSelect.addEventListener('change', function () {
      syncOpacityControlToSelection();
      refreshWmsShiftStatus();
    });
    setZOrdering(WMSLayerTogglers);
    wmeSDK.Events.on({
      eventName: 'wme-map-layer-added',
      eventHandler: function () {
        fillWMSLayersSelectList();
        syncOpacityControlToSelection();
        refreshWmsShiftStatus();
      },
    });
    wmeSDK.Events.on({
      eventName: 'wme-map-layer-removed',
      eventHandler: function () {
        fillWMSLayersSelectList();
        syncOpacityControlToSelection();
        refreshWmsShiftStatus();
      },
    });
    wmeSDK.Events.on({ eventName: 'wme-map-layer-added', eventHandler: () => setZOrdering(WMSLayerTogglers)() });
    wmeSDK.Events.on({ eventName: 'wme-map-layer-removed', eventHandler: () => setZOrdering(WMSLayerTogglers)() });
    wmeSDK.Events.on({
      eventName: 'wme-map-move-end',
      eventHandler: function () {
        setZOrdering(WMSLayerTogglers)();
        // Panning/zooming changes which wards are in view for the auto-loaders and which
        // features belong on the layers for the view window.
        scheduleLmcViewportUpdate();
        scheduleNpGisViewportUpdate();
        scheduleFeatureWindowUpdate();
        // ...and which ward the selected segment now sits in.
        postalScheduleAddressCard();
      },
    });
  }

  // Fill the ONE dropdown the shared shift pad works on: the WMS layers currently on
  // the map, plus every loaded GeoJSON layer (loaded in the "Layers" tab), grouped.
  // The option value carries the kind - "wms:<toggler key>" / "geojson:<layer name>" -
  // which is how the pad knows which of the two shift engines to drive
  // (see selectedShiftTarget / wmsTogglersOnMap / findWmsLayersForTarget).
  function fillWMSLayersSelectList() {
    const select = document.getElementById('WMSLayersSelect');
    if (!select) return;
    const value = select.value;
    select.innerHTML = '';

    const wmsGroup = document.createElement('optgroup');
    wmsGroup.label = 'WMS layers';
    wmsTogglersOnMap().forEach((entry) => {
      const option = document.createElement('option');
      option.value = 'wms:' + entry.key;
      option.textContent = entry.toggler.layerName;
      wmsGroup.appendChild(option);
    });
    select.appendChild(wmsGroup);

    const geoJsonGroup = document.createElement('optgroup');
    geoJsonGroup.label = 'GeoJSON layers';
    loadedGeoJSONLayers.forEach((info) => {
      const option = document.createElement('option');
      option.value = 'geojson:' + info.name;
      option.textContent = info.name;
      geoJsonGroup.appendChild(option);
    });
    select.appendChild(geoJsonGroup);

    // Keep the current selection while that layer still exists; otherwise fall back to
    // the first entry, because assigning a value that is no longer an option would
    // leave the dropdown blank.
    if (value && select.querySelector('option[value="' + value + '"]')) {
      select.value = value;
    } else if (select.options.length) {
      select.selectedIndex = 0;
    }
  }

  /* ------------------------------------------------------------------
     HTTP-only WMS support (mixed-content workaround)
     Some Nepali WMS servers (e.g. gis.dmgnepal.gov.np:8080) are only
     reachable over plain HTTP. WME runs on HTTPS, so the browser blocks
     those tile <img> requests as mixed content and the layer stays empty.
     Such tiles are fetched with GM_xmlhttpRequest (privileged, exempt from
     mixed-content rules) and handed to OpenLayers as blob: URLs instead
     (WME's CSP allows blob: for images).
     ------------------------------------------------------------------ */
  var HTTP_TILE_CACHE_LIMIT = 400;
  var TRANSPARENT_TILE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  var httpTileBlobCache = {}; // tile URL -> blob URL
  var httpTileCacheOrder = []; // FIFO order, used for cache eviction
  var httpTilePendingCallbacks = {}; // tile URL -> pending callbacks (request de-duplication)
  var httpTileProxyPatchInstalled = false;

  function isHttpUrl(url) {
    return typeof url === 'string' && url.slice(0, 7).toLowerCase() === 'http://';
  }

  function cacheHttpTileBlob(url, blobUrl) {
    if (httpTileBlobCache[url]) return;
    httpTileBlobCache[url] = blobUrl;
    httpTileCacheOrder.push(url);
    while (httpTileCacheOrder.length > HTTP_TILE_CACHE_LIMIT) {
      var expiredUrl = httpTileCacheOrder.shift();
      var expiredBlobUrl = httpTileBlobCache[expiredUrl];
      delete httpTileBlobCache[expiredUrl];
      // Revoking only prevents *new* loads of that URL, already decoded tiles stay visible.
      if (expiredBlobUrl) {
        try {
          URL.revokeObjectURL(expiredBlobUrl);
        } catch (e) {}
      }
    }
  }

  // Fetches one plain-HTTP tile through GM_xmlhttpRequest and hands back a blob: URL.
  //
  // Callback-based, not a promise, because its caller is OpenLayers' own renderTile path
  // (getURLasync), which expects a node-style callback.
  //
  // REQUESTS ARE DE-DUPLICATED per URL. A tile grid asks for the same tile from several code
  // paths, and the pending queue holds every callback until the single in-flight request
  // settles - then they all get the same blob URL (or the same error). A tile already in the
  // cache is answered synchronously. Every callback is invoked in its own try/catch, so one
  // bad consumer cannot strand the others.
  //
  // `error` is non-null only on failure; on success the URL is passed as the first argument.
  //
  // @param {string} url the http:// tile URL
  // @param {Function} callback callback(blobUrl, error)
  function fetchHttpTile(url, callback) {
    if (httpTileBlobCache[url]) {
      callback(httpTileBlobCache[url], null);
      return;
    }
    if (httpTilePendingCallbacks[url]) {
      httpTilePendingCallbacks[url].push(callback);
      return;
    }
    httpTilePendingCallbacks[url] = [callback];

    function settle(blobUrl, error) {
      var callbacks = httpTilePendingCallbacks[url] || [];
      delete httpTilePendingCallbacks[url];
      if (blobUrl) {
        cacheHttpTileBlob(url, blobUrl);
      }
      callbacks.forEach(function (cb) {
        try {
          cb(blobUrl, error);
        } catch (e) {
          console.error(scriptName + ': tile proxy callback failed for ' + url, e);
        }
      });
    }

    GM_xmlhttpRequest({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
      timeout: 30000,
      onload: function (response) {
        var data = response.response;
        var isEmpty = !data || (data instanceof ArrayBuffer ? data.byteLength === 0 : data.size === 0);
        if (response.status >= 200 && response.status < 300 && !isEmpty) {
          var blob = data instanceof Blob ? data : new Blob([data], { type: 'image/png' });
          settle(URL.createObjectURL(blob), null);
        } else {
          settle(null, new Error('HTTP ' + response.status));
        }
      },
      onerror: function () {
        settle(null, new Error('network error'));
      },
      ontimeout: function () {
        settle(null, new Error('request timeout'));
      },
    });
  }

  // Safety net: intercept the last step before OpenLayers assigns an image src.
  // Only layers flagged with _httpTileProxy are touched.
  function patchTileImageSetImgSrc() {
    if (httpTileProxyPatchInstalled) return;
    if (!OL || !OL.Tile || !OL.Tile.Image || !OL.Tile.Image.prototype) return;
    var originalSetImgSrc = OL.Tile.Image.prototype.setImgSrc;
    if (typeof originalSetImgSrc !== 'function') return;
    httpTileProxyPatchInstalled = true;
    OL.Tile.Image.prototype.setImgSrc = function (url) {
      var layer = this.layer;
      if (!url || !layer || !layer._httpTileProxy || !isHttpUrl(url)) {
        return originalSetImgSrc.apply(this, arguments);
      }
      var self = this;
      var imgDiv = this.imgDiv;
      fetchHttpTile(url, function (blobUrl) {
        // The tile may have been cleared or redrawn while the request was in flight.
        if (!blobUrl || !imgDiv || self.imgDiv !== imgDiv) return;
        originalSetImgSrc.call(self, blobUrl);
      });
    };
  }

  // Route all tile requests of an HTTP-only service through GM_xmlhttpRequest
  function enableHttpTileProxy(layer) {
    if (!layer || layer._httpTileProxy) return;
    layer._httpTileProxy = true;
    // Preferred path: OpenLayers.Tile.Image.renderTile() asks for the tile URL
    // asynchronously when layer.async is set, so blob URLs become the tile URL.
    layer.async = true;
    layer.getURLasync = function (bounds, callback, tile) {
      var url = this.getURL(bounds);
      if (!isHttpUrl(url)) {
        callback.call(tile, url);
        return;
      }
      fetchHttpTile(url, function (blobUrl, error) {
        if (blobUrl) {
          callback.call(tile, blobUrl);
        } else {
          console.warn(scriptName + ': could not fetch WMS tile ' + url + ' (' + (error && error.message) + '), showing empty tile.');
          callback.call(tile, TRANSPARENT_TILE);
        }
      });
    };
    patchTileImageSetImgSrc();
  }

  function addNewLayer(id, service, serviceLayers, zIndex = 0, opacity = 1) {
    var newLayer = {};
    newLayer.serviceType = service.type;
    if ((service.type == 'XYZ') & (zIndex == 0)) {
      newLayer.zIndex = ZIndexes.base;
    } else {
      newLayer.zIndex = zIndex == 0 ? ZIndexes.popup : zIndex;
    }
    switch (service.type) {
      case 'WMS':
        // Debug log for WMS request URL and filter
        if (typeof zIndex === 'string' && zIndex.includes("road_class='")) {
          console.log('[WMS DEBUG] Creating WMS Layer:', id);
          console.log('[WMS DEBUG] Service URL:', service.url);
          console.log('[WMS DEBUG] Layers:', serviceLayers);
          console.log('[WMS DEBUG] Filter:', zIndex);
        }
        newLayer.layer = new OL.Layer.WMS(
          id,
          service.url,
          {
            layers: serviceLayers,
            transparent: 'true',
            format: 'image/png',
            version: service.version || '1.3.0', // Use service.version if provided, else default to 1.3.0 use WMS 1.3.0 + EPSG:3857
            CQL_FILTER: typeof zIndex === 'string' ? zIndex : undefined,
          },
          {
            opacity: opacity,
            tileSize: WMSLayersTechSource.tileSizeG || new OL.Size(256, 256), // Use service-defined tile size if available
            isBaseLayer: false,
            visibility: false,
            transitionEffect: 'resize',
            attribution: service.attribution,
            projection: new OL.Projection('EPSG:3857'), //alternativa defaultní EPSG:900913
          }
        );
        break;
      case 'WMS_4326':
        newLayer.layer = new OL.Layer.WMS(
          id,
          service.url,
          {
            layers: serviceLayers,
            transparent: 'true',
            format: 'image/png',
            version: service.version || '1.1.1', //use WMS 1.1.1 + EPSG:4326
            CQL_FILTER: typeof zIndex === 'string' ? zIndex : undefined,
          },
          {
            opacity: opacity,
            tileSize: WMSLayersTechSource.tileSizeG || new OL.Size(256, 256), // Use service-defined tile size if available
            isBaseLayer: false,
            visibility: false,
            transitionEffect: 'resize',
            attribution: service.attribution,
            epsg4326: new OL.Projection('EPSG:4326'),
            getURL: getUrl4326,
            getFullRequestString: getFullRequestString4326,
          }
        );
        break;
      case 'XYZ':
        newLayer.layer = new OL.Layer.XYZ(id, service.url, {
          sphericalMercator: true,
          isBaseLayer: false,
          visibility: false,
          RESOLUTION_PROPERTIES: {},
          resolutions: WMSLayersTechSource.resolutions,
          serverResolutions: WMSLayersTechSource.resolutions.slice(0, 'maxZoom' in service && service.maxZoom > 0 ? service.maxZoom : 23),
          transitionEffect: 'resize',
          attribution: service.attribution,
        });
        break;
      default:
        newLayer.layer = null;
    }
    if (newLayer.layer) {
      var serviceUrls = Array.isArray(service.url) ? service.url : [service.url];
      if (serviceUrls.some(isHttpUrl)) {
        console.log(scriptName + ': "' + id + '" is served over plain HTTP, enabling tile proxy.');
        enableHttpTileProxy(newLayer.layer);
      }
    }
    return newLayer;
  }
  /*For GeoServer WMS:

WMS 1.1.1 prefers coordinates in EPSG:4326 (longitude, latitude order).
WMS 1.3.0 uses EPSG:4326 (latitude, longitude order) and supports EPSG:3857 (Web Mercator) natively.
Recommendations:

If your client expects (longitude, latitude) order, use WMS 1.1.1 with EPSG:4326.
If your client expects (latitude, longitude) order or uses web maps (Google, OSM), use WMS 1.3.0 with EPSG:3857.
Summary:

For web mapping (slippy maps), use WMS 1.3.0 + EPSG:3857.
For GIS tools or legacy clients, use WMS 1.1.1 + EPSG:4326.*/

  /* ==================================================================
     SIDEBAR UI - pattern and theming borrowed from "Croatian WMS layers"
     (https://greasyfork.org/en/scripts/519676-croatian-wms-layers, author JS55CT).

     Instead of one layer-switcher checkbox per layer, a SINGLE master checkbox
     is registered with wmeSDK.LayerSwitcher and every layer lives in the custom
     sidebar tab, grouped into category cards with a per-category opacity slider
     and one checkbox per layer.

     A layer is visible only when its sidebar checkbox is on AND the master
     checkbox in WME's layer switcher is on.

     The panel is styled through WME's own CSS custom properties
     (--content_default, --background_default, --hairline, --primary,
     --content_p1, --content_p2), so it follows the editor theme (including dark
     mode) instead of hard-coding colours.
     ================================================================== */
  var WMS_MASTER_STORAGE_KEY = '_wme_nepali_wms_master';
  var WMS_CATEGORY_OPACITY_STORAGE_KEY = '_wme_nepali_wms_opacity';
  var WMS_COLLAPSED_STORAGE_KEY = '_wme_nepali_wms_collapsed';
  var WMS_SUBTAB_STORAGE_KEY = '_wme_nepali_wms_subtab';
  var WMS_LAYER_OFFSETS_STORAGE_KEY = '_wme_nepali_wms_layer_offsets';
  var masterLayerToggleOn = true;

  // Panel stylesheet. The crimson accent (#DC143C = Nepal crimson) is used for
  // the header gradient and the control accents.
  function injectWmsPanelStyles() {
    if (document.getElementById('npw-panel-styles')) return;
    var style = document.createElement('style');
    style.id = 'npw-panel-styles';
    style.textContent = [
      '.npw-panel { box-sizing: border-box; padding: 4px; font-family: inherit; font-size: 11px; line-height: 1.45; color: var(--content_default, #333); }',
      // Sub-tab bar under the gradient header: a segmented control (Layers / Shifting /
      // Settings). The active segment is filled, the others just show their label.
      '.npw-tabs { display: flex; gap: 4px; margin: 0 0 8px; padding: 3px; border: 1px solid var(--hairline, #ddd); border-radius: 8px; background: var(--background_default, #fff); }',
      // Compound selectors so these rules beat WME's own global button styling.
      '.npw-tabs > button.npw-tab { flex: 1 1 0; min-width: 0; box-sizing: border-box; padding: 6px 4px; border: none; border-radius: 6px; background: transparent; color: var(--content_p1, #333); font-family: inherit; font-size: 10px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; appearance: none; -webkit-appearance: none; transition: background-color 0.15s, color 0.15s; }',
      '.npw-tabs > button.npw-tab:hover { background: rgba(127, 127, 127, 0.18); }',
      '.npw-tabs > button.npw-tab:focus-visible { outline: 2px solid var(--primary, #DC143C); outline-offset: 1px; }',
      '.npw-tabs > button.npw-tab.npw-tab-active { background: #0066cc; color: #fff; }',
      '.npw-tabs > button.npw-tab.npw-tab-active:hover { background: #0052a3; }',
      '.npw-tab-pane[hidden] { display: none; }',
      '.npw-header { display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 6px 8px; margin-bottom: 8px; border-radius: 6px; background: linear-gradient(135deg, #DC143C, #7d0b22); color: #fff; }',
      '.npw-header .npw-title { color: #fff; font-size: 12px; font-weight: 700; letter-spacing: 0.3px; text-decoration: none; }',
      '.npw-header .npw-title:hover { text-decoration: underline; }',
      '.npw-header .npw-version { font-size: 9px; font-weight: 500; opacity: 0.85; }',
      '.npw-card { padding: 6px 8px; margin-bottom: 6px; border: 1px solid var(--hairline, #ddd); border-radius: 6px; background: var(--background_default, #fff); }',
      '.npw-card-title { display: flex; align-items: center; gap: 6px; padding-bottom: 3px; margin-bottom: 6px; border-bottom: 1px solid var(--hairline, #ddd); font-size: 9px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: var(--primary, #DC143C); }',
      '.npw-card-title-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.npw-card-count { flex: none; font-size: 9px; font-weight: 600; opacity: 0.75; }',
      '.npw-caret { flex: none; width: 8px; text-align: center; font-size: 9px; line-height: 1; }',
      '.npw-card-title-clickable { cursor: pointer; user-select: none; }',
      '.npw-card-title-clickable:hover .npw-card-title-text { text-decoration: underline; }',
      '.npw-card-title-clickable:focus-visible { outline: 2px solid var(--primary, #DC143C); outline-offset: 2px; border-radius: 3px; }',
      '.npw-card.npw-collapsed .npw-card-title { margin-bottom: 0; }',
      '.npw-card-body.npw-collapsed { display: none; }',
      '.npw-row { display: flex; align-items: center; gap: 6px; margin: 4px 0; }',
      '.npw-layer-item { display: flex; align-items: center; gap: 8px; min-height: 18px; margin: 0 0 4px; }',
      '.npw-layer-item:last-child { margin-bottom: 0; }',
      '.npw-layer-item > input.npw-checkbox { display: inline-block; flex: 0 0 auto; box-sizing: border-box; width: 14px !important; height: 14px !important; min-width: 14px; margin: 0 !important; padding: 0 !important; vertical-align: middle; align-self: center; cursor: pointer; accent-color: var(--primary, #DC143C); }',
      '.npw-layer-item > label.npw-label { display: flex; align-items: center; flex: 1 1 auto; box-sizing: border-box; min-width: 0; margin: 0; padding: 0; font-size: 10px; line-height: 1.3; cursor: pointer; user-select: none; color: var(--content_p1, #333); }',
      '.npw-opacity-row { display: flex; align-items: center; gap: 6px; margin: 2px 0 6px; }',
      '.npw-opacity-label { min-width: 48px; font-size: 9px; font-weight: 600; color: var(--content_p2, #666); }',
      '.npw-opacity-value { min-width: 28px; text-align: right; font-size: 9px; color: var(--content_p2, #666); }',
      '.npw-opacity-slider { flex: 1; height: 4px; border-radius: 2px; outline: none; cursor: pointer; background: linear-gradient(to right, #ddd 0%, #999 100%); -webkit-appearance: none; appearance: none; }',
      '.npw-opacity-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--primary, #DC143C); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3); cursor: pointer; }',
      '.npw-opacity-slider::-moz-range-thumb { width: 12px; height: 12px; border: none; border-radius: 50%; background: var(--primary, #DC143C); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3); cursor: pointer; }',
      '.npw-btn { display: block; box-sizing: border-box; width: 100%; padding: 7px 12px; margin: 0 0 4px 0; border: none; border-radius: 6px; font-family: inherit; font-size: 12px; font-weight: 600; line-height: 1.2; text-align: center; color: #fff; cursor: pointer; transition: background-color 0.2s; }',
      '.npw-btn:disabled { opacity: 0.5; cursor: not-allowed; }',
      '.npw-btn-primary { background-color: #8BC34A; }',
      '.npw-btn-primary:hover:not(:disabled) { background-color: #689F38; }',
      '.npw-btn-danger { background-color: #E57373; }',
      '.npw-btn-danger:hover:not(:disabled) { background-color: #D32F2F; }',
      '.npw-btn-neutral { background-color: #0066cc; }',
      '.npw-btn-neutral:hover:not(:disabled) { background-color: #0052a3; }',
      '.npw-btn-accent { background-color: #DC143C; }',
      '.npw-btn-accent:hover:not(:disabled) { background-color: #7d0b22; }',
      '.npw-btn-sm { padding: 4px 0; margin-bottom: 0; font-size: 13px; line-height: 1; }',
      '.npw-btn-row { display: flex; gap: 6px; }',
      '.npw-btn-row > .npw-btn { flex: 1; min-width: 0; }',
      '.npw-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; margin-bottom: 6px; }',
      '.npw-select, .npw-input { box-sizing: border-box; width: 100%; padding: 4px; margin-bottom: 6px; border: 1px solid var(--hairline, #ccc); border-radius: 4px; background: var(--background_default, #fff); color: var(--content_default, #333); font-size: 11px; }',
      '.npw-small-label { display: block; margin-bottom: 3px; font-size: 10px; color: var(--content_p2, #666); }',
      '.npw-status { margin-top: 8px; font-size: 11px; font-style: italic; color: var(--content_p2, #666); }',
      '.npw-field-row { display: flex; align-items: center; gap: 6px; margin: 4px 0; }',
      '.npw-field-label { flex: 0 0 auto; min-width: 72px; font-size: 10px; color: var(--content_p2, #666); }',
      // Compound/native-element selectors + !important: WME's global control styles
      // outrank a plain class (same gotcha as the layer checkboxes).
      '.npw-field-row > input.npw-color { flex: 0 0 auto; width: 34px !important; height: 22px !important; padding: 0 2px !important; margin: 0 !important; border: 1px solid var(--hairline, #ccc); border-radius: 4px; background: var(--background_default, #fff); cursor: pointer; }',
      '.npw-field-row > input.npw-color:disabled { opacity: 0.35; cursor: not-allowed; }',
      '.npw-field-row > input.npw-number { flex: 0 0 auto; width: 52px !important; padding: 3px 4px !important; margin: 0 !important; border: 1px solid var(--hairline, #ccc); border-radius: 4px; background: var(--background_default, #fff); color: var(--content_default, #333); font-size: 11px; }',
      '.npw-field-row > input.npw-number:disabled { opacity: 0.35; cursor: not-allowed; }',
      '.npw-field-row > input.npw-opacity-slider { flex: 1 1 auto; min-width: 0; margin: 0 !important; }',
      '.npw-field-toggle { display: inline-flex; align-items: center; gap: 4px; margin: 0 0 0 auto; font-size: 10px; color: var(--content_p1, #333); cursor: pointer; user-select: none; white-space: nowrap; }',
      '.npw-field-toggle > input.npw-checkbox { flex: 0 0 auto; width: 13px !important; height: 13px !important; min-width: 13px; margin: 0 !important; padding: 0 !important; cursor: pointer; accent-color: var(--primary, #DC143C); }',
      '.npw-field-toggle.npw-disabled { opacity: 0.5; cursor: default; }',
      '.npw-radio-row { display: flex; align-items: center; gap: 6px; margin: 4px 0; flex-wrap: wrap; }',
      '.npw-radio-options { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; flex: 1 1 auto; }',
      '.npw-radio-option { display: inline-flex; align-items: center; gap: 4px; margin: 0; font-size: 10px; color: var(--content_p1, #333); cursor: pointer; white-space: nowrap; }',
      '.npw-radio-option > input[type="radio"] { flex: 0 0 auto; width: 13px !important; height: 13px !important; margin: 0 !important; padding: 0 !important; cursor: pointer; accent-color: var(--primary, #DC143C); }',
      // Ward grid of the "Lalitpur HN Address Wards" card.
      '.npw-ward-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 2px 6px; margin: 4px 0 6px; }',
      '.npw-ward-item { display: flex; align-items: center; gap: 4px; margin: 0; font-size: 10px; color: var(--content_p1, #333); cursor: pointer; user-select: none; }',
      '.npw-ward-item > input.npw-checkbox { flex: 0 0 auto; width: 13px !important; height: 13px !important; min-width: 13px; margin: 0 !important; padding: 0 !important; cursor: pointer; accent-color: var(--primary, #DC143C); }',
      '.npw-ward-text { line-height: 1.3; }',
      // Hierarchy-level row of the "Nepal GIS Layers" card. Same native-control gotcha as
      // the ward grid, so the checkbox is targeted as a compound selector.
      '.npw-level-row { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; margin: 4px 0 6px; }',
      '.npw-level-item { display: inline-flex; align-items: center; gap: 4px; margin: 0; font-size: 10px; color: var(--content_p1, #333); cursor: pointer; user-select: none; white-space: nowrap; }',
      '.npw-level-item > input.npw-checkbox { flex: 0 0 auto; width: 13px !important; height: 13px !important; min-width: 13px; margin: 0 !important; padding: 0 !important; cursor: pointer; accent-color: var(--primary, #DC143C); }',
      '.npw-level-dot { flex: 0 0 auto; box-sizing: border-box; width: 8px; height: 8px; border: 1px solid rgba(0, 0, 0, 0.35); border-radius: 2px; }',
      '.npw-level-text { line-height: 1.3; }',
      // Attribute list of the Style Settings label-field picker.
      '.npw-attr-list { max-height: 132px; overflow-y: auto; margin: 2px 0 6px; padding: 3px 5px; border: 1px solid var(--hairline, #ccc); border-radius: 4px; background: rgba(127, 127, 127, 0.07); font-size: 10px; }',
      '.npw-attr-row { display: flex; gap: 6px; padding: 1px 0; }',
      '.npw-attr-key { flex: 0 0 42%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--content_p1, #333); }',
      '.npw-attr-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--content_p2, #666); }',
      '.npw-attr-empty { font-style: italic; color: var(--content_p2, #666); }',
      // Postal address card inside WME's segment edit panel. Unscoped on purpose: it is
      // injected into WME's panel, not into our own .npw-panel.
      '.npw-address-card { box-sizing: border-box; margin: 6px 0; padding: 3px 6px; border: 1px solid var(--hairline, #ccc); border-left: 3px solid var(--primary, #DC143C); border-radius: 4px; background: rgba(220, 20, 60, 0.05); font-family: inherit; font-size: 11px; line-height: 1.35; color: var(--content_default, #333); }',
      '.npw-address-row { display: flex; align-items: center; gap: 6px; }',
      '.npw-address-icon { flex: 0 0 auto; display: inline-flex; align-items: center; color: var(--primary, #DC143C); }',
      '.npw-address-icon > svg { display: block; }',
      '.npw-address-value { flex: 1 1 auto; min-width: 0; font-weight: 600; word-break: break-word; }',
      // Beats ".npw-btn { width: 100% }" on specificity, so no !important is needed.
      '.npw-address-row > button.npw-address-copy { flex: 0 0 auto; width: auto; min-width: 0; padding: 1px 7px; margin: 0; border-radius: 3px; font-size: 9px; font-weight: 600; line-height: 1.6; }',
      '.npw-address-warn { margin-top: 2px; font-size: 9px; line-height: 1.3; color: #b26a00; }',
      '.npw-split { display: flex; gap: 8px; }',
      '.npw-split > div { flex: 1; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  /* --------------------------- small DOM helpers --------------------------- */
  function npwCreate(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  // Remembered sub-tab (Layers / Shifting / Settings), so reopening WME returns the
  // user to the tab they were on.
  function loadSubTab() {
    return npwLoadString(WMS_SUBTAB_STORAGE_KEY, null);
  }

  function saveSubTab(id) {
    npwSaveString(WMS_SUBTAB_STORAGE_KEY, id);
  }

  // Sub-tab bar (the segmented control below the panel header). Each entry of `tabs`
  // is { id, label, title }; a pane per tab is created and returned so the caller can
  // fill it. Only the pane of the active tab is visible.
  function npwTabs(host, tabs) {
    var bar = npwCreate('div', 'npw-tabs');
    bar.setAttribute('role', 'tablist');
    var panesHost = npwCreate('div', 'npw-tab-panes');
    var buttons = {};
    var panes = {};

    var show = function (id) {
      if (!panes[id]) return;
      tabs.forEach(function (tab) {
        var isActive = tab.id === id;
        panes[tab.id].hidden = !isActive;
        buttons[tab.id].classList.toggle('npw-tab-active', isActive);
        buttons[tab.id].setAttribute('aria-selected', isActive ? 'true' : 'false');
        buttons[tab.id].tabIndex = isActive ? 0 : -1;
        // Optional per-tab hook, used by a pane whose content is built from state that
        // changes behind its back (see the Settings tab's label-field picker).
        if (isActive && typeof tab.onShow === 'function') {
          try {
            tab.onShow();
          } catch (e) {
            console.warn(scriptName + ': tab onShow hook failed for ' + tab.id, e);
          }
        }
      });
      saveSubTab(id);
    };

    tabs.forEach(function (tab) {
      var btn = npwCreate('button', 'npw-tab', tab.label);
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', 'npw-tabpane-' + tab.id);
      if (tab.title) btn.title = tab.title;
      btn.addEventListener('click', function () {
        show(tab.id);
      });
      bar.appendChild(btn);
      buttons[tab.id] = btn;
    });

    tabs.forEach(function (tab) {
      var pane = npwCreate('div', 'npw-tab-pane');
      pane.id = 'npw-tabpane-' + tab.id;
      pane.setAttribute('role', 'tabpanel');
      pane.hidden = true;
      panesHost.appendChild(pane);
      panes[tab.id] = pane;
    });

    host.appendChild(bar);
    host.appendChild(panesHost);

    var saved = loadSubTab();
    show(saved && panes[saved] ? saved : tabs[0].id);

    return { bar: bar, buttons: buttons, panes: panes, show: show };
  }

  // Collapsed/expanded state of the panel cards, kept in one localStorage object so a
  // new card only needs a storageKey (a layer group name today, a provider section -
  // Django, ... - tomorrow).
  function loadCollapsedState(storageKey) {
    var stored = npwLoadEntry(WMS_COLLAPSED_STORAGE_KEY, storageKey, null);
    return typeof stored === 'boolean' ? stored : null;
  }

  function saveCollapsedState(storageKey, collapsed) {
    npwSaveEntry(WMS_COLLAPSED_STORAGE_KEY, storageKey, collapsed);
  }

  // A card is the panel's building block: an optional uppercase title bar plus a
  // content area. Content goes into `card.npwBody`, which is the element
  // `options.collapsible` folds away; the state is remembered per `options.storageKey`.
  // The layer-group cards use this, and any provider card added later can opt in the
  // same way. The title bar is a button-like element (click or Enter/Space).
  function npwCard(host, title, options) {
    options = options || {};
    var card = npwCreate('div', 'npw-card');
    var body = npwCreate('div', 'npw-card-body');
    card.npwBody = body;

    if (title) {
      var titleBar = npwCreate('div', 'npw-card-title');
      titleBar.appendChild(npwCreate('span', 'npw-card-title-text', title));
      card.appendChild(titleBar);

      if (options.collapsible) {
        var caret = npwCreate('span', 'npw-caret', '\u25BE');
        titleBar.appendChild(caret);
        titleBar.classList.add('npw-card-title-clickable');
        titleBar.setAttribute('role', 'button');
        titleBar.tabIndex = 0;
        titleBar.title = 'Click to collapse / expand this group';

        var applyCollapsed = function (collapsed) {
          card.classList.toggle('npw-collapsed', collapsed);
          body.classList.toggle('npw-collapsed', collapsed);
          caret.textContent = collapsed ? '\u25B8' : '\u25BE';
          titleBar.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        };
        var toggleCollapsed = function () {
          var collapsed = !card.classList.contains('npw-collapsed');
          applyCollapsed(collapsed);
          if (options.storageKey) saveCollapsedState(options.storageKey, collapsed);
        };
        titleBar.addEventListener('click', toggleCollapsed);
        titleBar.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleCollapsed();
          }
        });

        var stored = options.storageKey ? loadCollapsedState(options.storageKey) : null;
        applyCollapsed(stored === null ? !!options.defaultCollapsed : stored);
      }
    }

    card.appendChild(body);
    if (host) host.appendChild(card);
    return card;
  }

  // Button colour pairs, identical to the "WME GeoFile" script (WME-NP-GIS-Layers):
  // background + hover only, so every panel - including the provider sections that
  // will be added later (Django, ...) - speaks one visual language. `.npw-btn` itself
  // (size, radius, weight, transition) lives in injectWmsPanelStyles().
  var NPW_BUTTON_VARIANTS = {
    primary: 'npw-btn-primary', // positive: load / import / apply
    danger: 'npw-btn-danger',   // destructive: clear / remove
    neutral: 'npw-btn-neutral', // secondary: shift pad arrows
    accent: 'npw-btn-accent',   // panel accent (Nepal crimson)
  };

  // Full-width solid button - same shape, weight and hover as WME GeoFile's
  // createButton(). `variant` is a key of NPW_BUTTON_VARIANTS (default neutral),
  // `extraClass` is used by the shift pad for its compact size.
  function npwButton(host, label, title, variant, extraClass) {
    var btn = npwCreate(
      'button',
      'npw-btn ' + (NPW_BUTTON_VARIANTS[variant] || NPW_BUTTON_VARIANTS.neutral) + (extraClass ? ' ' + extraClass : ''),
      label
    );
    if (title) btn.title = title;
    if (host) host.appendChild(btn);
    return btn;
  }

  // Flex row of equal-width buttons - WME GeoFile's ".geofile-btn-row" layout.
  function npwButtonRow(host) {
    var row = npwCreate('div', 'npw-btn-row');
    if (host) host.appendChild(row);
    return row;
  }

  // 3x3 shift pad shared by the WMS and the GeoJSON shift controls.
  function npwBuildShiftPad(host, onShift, onReset) {
    var defs = [
      ['\u2196', 'Shift Up-Left', 'upleft'],
      ['\u2191', 'Shift Up', 'up'],
      ['\u2197', 'Shift Up-Right', 'upright'],
      ['\u2190', 'Shift Left', 'left'],
      [null, null, null],
      ['\u2192', 'Shift Right', 'right'],
      ['\u2199', 'Shift Down-Left', 'downleft'],
      ['\u2193', 'Shift Down', 'down'],
      ['\u2198', 'Shift Down-Right', 'downright'],
    ];
    var grid = npwCreate('div', 'npw-grid');
    defs.forEach(function (def) {
      if (!def[0]) {
        grid.appendChild(npwCreate('div', 'npw-grid-empty')); // centre cell stays empty
        return;
      }
      var btn = npwButton(null, def[0], def[1], 'neutral', 'npw-btn-sm');
      btn.addEventListener('click', function () {
        onShift(def[2]);
      });
      grid.appendChild(btn);
    });
    host.appendChild(grid);
    var resetBtn = npwButton(host, 'Reset Shift', 'Undo every shift applied to this layer', 'accent');
    resetBtn.addEventListener('click', onReset);
  }

  /* --------------------- master toggle + opacity storage -------------------- */
  // Stored as a bare string, defaulting to ON: only an explicit 'false' turns it off,
  // so a missing or unreadable entry keeps the layers visible.
  function loadMasterToggleState() {
    return npwLoadString(WMS_MASTER_STORAGE_KEY, null) !== 'false';
  }

  function saveMasterToggleState(state) {
    npwSaveString(WMS_MASTER_STORAGE_KEY, state ? 'true' : 'false');
  }

  function loadCategoryOpacity(category) {
    var stored = npwLoadEntry(WMS_CATEGORY_OPACITY_STORAGE_KEY, category, null);
    return typeof stored === 'number' ? stored : null;
  }

  function saveCategoryOpacity(category, opacity) {
    npwSaveEntry(WMS_CATEGORY_OPACITY_STORAGE_KEY, category, opacity);
  }

  // Per-layer WMS shifts the user nudged into place with the pad. Kept in metres of
  // content movement ({ east, north }), so the values do not depend on the map
  // projection and one can be copied straight into WMS_LAYER_SHIFT_PRESETS.
  function loadStoredLayerOffsets() {
    var all = npwLoadJson(WMS_LAYER_OFFSETS_STORAGE_KEY, {});
    return all && typeof all === 'object' ? all : {};
  }

  function saveStoredLayerOffsets(all) {
    npwSaveJson(WMS_LAYER_OFFSETS_STORAGE_KEY, all);
  }

  // Register the single master checkbox that owns every layer of the script.
  function registerMasterLayerCheckbox() {
    if (!wmeSDK || !wmeSDK.LayerSwitcher) return;
    try {
      // Remove first so a re-init never leaves a stale checkbox behind.
      wmeSDK.LayerSwitcher.removeLayerCheckbox({ name: scriptName });
    } catch (e) {
      // Not registered yet - expected on first run.
    }
    try {
      wmeSDK.LayerSwitcher.addLayerCheckbox({ name: scriptName, isChecked: masterLayerToggleOn });
    } catch (e) {
      console.error(scriptName + ': could not register the master layer checkbox', e);
    }
  }

  // Apply a toggler's state to its OL2 layer(s) - the sidebar checkbox is UI only.
  // A layer that is switched off is hidden and then detached from the map, so an off
  // layer really is gone and no hidden tile grid is kept in memory.
  // Detaching may only happen for a layer that is actually attached: WME's
  // removeLayer() detaches the layer <div> unconditionally and throws NotFoundError
  // on removeChild when there is no such node.
  function applyLayerTogglerVisibility(toggler, visible) {
    for (var i = 0; i < toggler.layerArray.length; i++) {
      var layer = toggler.layerArray[i].layer;
      if (!layer) continue;
      var isOnMap = false;
      try {
        isOnMap = W.map.getLayers().indexOf(layer) !== -1;
      } catch (e) {
        isOnMap = false;
      }
      if (visible) {
        if (!isOnMap) W.map.addLayer(layer);
        // Opacity before showing: a newly attached OL2 layer carries its default (1.0), and
        // adding it is what makes the group's remembered opacity apply again after a refresh.
        // Set here rather than after setVisibility so the first painted tile is already correct.
        applyStoredCategoryOpacity(toggler);
        layer.setVisibility(true);
      } else {
        layer.setVisibility(false);
        if (!isOnMap) continue; // nothing to detach
        try {
          W.map.removeLayer(layer);
        } catch (e) {
          // The <div> was already detached - the layer is hidden either way.
          console.warn(scriptName + ': could not detach layer "' + layer.name + '" from the map', e);
        }
      }
    }
  }

  // Re-applies a toggler's remembered category opacity to its layers.
  // The slider writes the value on input and to localStorage, but that is all it used to do -
  // nothing read the stored value back onto the layers, so after a page refresh every layer
  // came back at OL2's default opacity while the slider still showed the saved position. This
  // is the missing half: it runs when a layer is attached and when the slider moves.
  // The storage key is the toggler's own `groupName`, which is exactly what the card's slider
  // is keyed by (buildLayerCategoryPanels groups by the same field).
  // A group with no stored value is left alone rather than forced to 1, so a layer whose own
  // opacity is set elsewhere (the Style Settings card) is not overridden by a default here.
  function applyStoredCategoryOpacity(toggler) {
    var group = toggler && toggler.groupName;
    if (!group) return;
    var opacity = loadCategoryOpacity(group);
    if (opacity === null) return;
    setTogglerOpacity(toggler, opacity);
  }

  /** Sets one opacity on every layer of a toggler that supports it. */
  function setTogglerOpacity(toggler, opacity) {
    toggler.layerArray.forEach(function (item) {
      if (item.layer && typeof item.layer.setOpacity === 'function') item.layer.setOpacity(opacity);
    });
  }

  // A layer is visible only when its sidebar checkbox is ticked AND the master
  // checkbox of the script in WME's layer switcher is on.
  function syncTogglerVisibility(toggler) {
    applyLayerTogglerVisibility(toggler, !!toggler.tabChecked && !!masterLayerToggleOn);
  }

  function syncAllTogglerVisibility() {
    for (var key in WMSLayerTogglers) syncTogglerVisibility(WMSLayerTogglers[key]);
  }

  // State is persisted under the pre-existing "WMSLayers" key, so preferences saved by
  // earlier implementations are picked up unchanged. Its two callers keep their own
  // console.warn: a lost layer selection is worth surfacing, unlike a lost panel toggle.
  function saveLayerTogglerStates() {
    var state = {};
    for (var key in WMSLayerTogglers) state[key] = !!WMSLayerTogglers[key].tabChecked;
    try {
      localStorage.setItem('WMSLayers', JSON.stringify(state));
    } catch (e) {
      console.warn(scriptName + ': could not save layer toggler states', e);
    }
    // Both the checkbox handler and the keyboard-shortcut handler end up here, so this
    // is the one place that keeps the group cards' "on/total" badges in sync.
    categoryCountRefreshers.forEach(function (refresh) {
      refresh();
    });
  }

  // Only loads the saved state into the togglers; the checkboxes and the layer
  // visibility are applied once the sidebar tab exists (see buildLayerCategoryPanels).
  function restoreLayerTogglerStates() {
    var state = npwLoadJson('WMSLayers', null);
    if (!state) return;
    for (var key in state) {
      var toggler = WMSLayerTogglers[key];
      if (!toggler) continue;
      toggler.tabChecked = !!state[key];
    }
  }

  // Build the category cards of the sidebar tab: one card per layer group, each
  // with an opacity slider for the whole group and a checkbox per layer.
  function buildLayerCategoryPanels(host) {
    // Rebuild-safe: drop the badge refreshers of a previous panel, if any.
    categoryCountRefreshers = [];
    var byGroup = {};
    var groupOrder = [];
    for (var key in WMSLayerTogglers) {
      var toggler = WMSLayerTogglers[key];
      var group = toggler.groupName || 'Other';
      if (!byGroup[group]) {
        byGroup[group] = [];
        groupOrder.push(group);
      }
      byGroup[group].push(toggler);
    }

    groupOrder.forEach(function (group) {
      var groupTogglers = byGroup[group];
      // Collapsible group card: the folded state is remembered per group name, so
      // "NP Places" can stay closed while "NP Roads" is open.
      var card = npwCard(host, group, { collapsible: true, storageKey: group });
      var cardBody = card.npwBody;

      // "on/total" badge in the title bar, so a collapsed group still shows how many
      // of its layers are enabled.
      var titleBar = card.querySelector('.npw-card-title');
      var countBadge = npwCreate('span', 'npw-card-count', '');
      titleBar.insertBefore(countBadge, titleBar.querySelector('.npw-caret'));
      var refreshCount = function () {
        var on = groupTogglers.filter(function (tg) {
          return !!tg.tabChecked;
        }).length;
        countBadge.textContent = on + '/' + groupTogglers.length;
      };
      refreshCount();
      categoryCountRefreshers.push(refreshCount);

      // Per-category opacity slider.
      var opacityRow = npwCreate('div', 'npw-opacity-row');
      opacityRow.appendChild(npwCreate('span', 'npw-opacity-label', 'Opacity'));
      var slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'npw-opacity-slider';
      slider.min = '0';
      slider.max = '1';
      slider.step = '0.1';
      var opacity = loadCategoryOpacity(group);
      if (opacity === null) {
        // Nothing stored yet - adopt the opacity of the first layer of the group.
        var firstItem = groupTogglers[0].layerArray[0];
        var firstLayer = firstItem && firstItem.layer;
        opacity = firstLayer && typeof firstLayer.opacity === 'number' ? firstLayer.opacity : 1;
      }
      slider.value = String(opacity);
      var valueLabel = npwCreate('span', 'npw-opacity-value', Math.round(opacity * 100) + '%');
      // The stored value is pushed onto the layers as the card is built too, so a layer that
      // was attached before this card existed (an auto-loaded group, or a layer restored on
      // start-up) picks it up rather than keeping OL2's default.
      groupTogglers.forEach(function (tg) {
        setTogglerOpacity(tg, opacity);
      });
      slider.addEventListener('input', function () {
        var newOpacity = parseFloat(slider.value);
        valueLabel.textContent = Math.round(newOpacity * 100) + '%';
        saveCategoryOpacity(group, newOpacity);
        groupTogglers.forEach(function (tg) {
          setTogglerOpacity(tg, newOpacity);
        });
      });
      opacityRow.appendChild(slider);
      opacityRow.appendChild(valueLabel);
      cardBody.appendChild(opacityRow);

      // One checkbox row per layer.
      groupTogglers.forEach(function (toggler) {
        var row = npwCreate('div', 'npw-layer-item');
        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'npw-checkbox';
        checkbox.checked = !!toggler.tabChecked;
        checkbox.addEventListener('change', function () {
          toggler.tabChecked = checkbox.checked;
          syncTogglerVisibility(toggler);
          saveLayerTogglerStates();
        });
        var label = npwCreate('label', 'npw-label', toggler.layerName);
        // Deliberately no htmlFor: this click handler is the only toggle path, so
        // clicking the label cannot double-toggle the checkbox.
        label.addEventListener('click', function () {
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event('change'));
        });
        row.appendChild(checkbox);
        row.appendChild(label);
        cardBody.appendChild(row);
        toggler.tabCheckbox = checkbox;
      });
    });
  }

  function addLayerToggler(groupName, layerName, isPublic, layerArray) {
    var layerToggler = {};
    layerToggler.layerName = layerName;
    layerToggler.groupName = groupName;
    // NOTE: isPublic is kept for call-site compatibility - SDK checkboxes have no
    // icon slot, so the old public/locked padlock icon can no longer be shown.
    layerToggler.serviceType =
      layerArray.filter(function (e) {
        return e.serviceType == 'XYZ';
      }).length > 0
        ? 'XYZ'
        : 'WMS';
    var layerShortcut = layerName.replace(/ /g, '_').replace('.', '');
    // Sidebar state: tabChecked is the persisted checkbox state of this layer in
    // the script's own tab, tabCheckbox is the DOM checkbox once the tab is built.
    layerToggler.tabChecked = false;
    layerToggler.tabCheckbox = null;
    layerToggler.layerArray = layerArray;
    for (var i = 0; i < layerArray.length; i++) {
      layerArray[i].layer.name = layerName + (layerArray.length > 1 ? ' ' + i : '');
    }
    // Register this toggler as an SDK shortcut. The key itself is assigned by the
    // user in WME Settings -> Keyboard Shortcuts (see initializeSDKShortcuts()).
    sdkShortcutDefs.push({
      id: 'NepaliWMS_' + layerShortcut.replace(/[^A-Za-z0-9]/g, '_'),
      description: 'WMS: ' + layerName,
      settingsKey: layerShortcut,
      callback: layerKeyShortcutEventHandler(layerToggler),
    });
    return layerToggler;
  }

  // Shortcut callback: toggles the layer's sidebar checkbox and applies visibility.
  function layerKeyShortcutEventHandler(toggler) {
    return function () {
      toggler.tabChecked = !toggler.tabChecked;
      if (toggler.tabCheckbox) toggler.tabCheckbox.checked = toggler.tabChecked;
      syncTogglerVisibility(toggler);
      saveLayerTogglerStates();
    };
  }

  // Builds the re-z-indexing pass for a set of togglers.
  //
  // Returns a FUNCTION rather than applying the z-indices itself, because the pass has to be
  // re-run every time a layer is added to or removed from the map (an OL2 layer re-added by
  // WME loses its z-index). The two call sites hand the result straight to the event handler.
  // Only layers with a positive zIndex are touched, so the base-zIndex layers are left alone.
  //
  // @param {Object} layerTogglers key -> toggler, normally WMSLayerTogglers
  // @returns {Function} the pass to run, taking no arguments
  function setZOrdering(layerTogglers) {
    return function () {
      for (var key in layerTogglers) {
        for (var j = 0; j < layerTogglers[key].layerArray.length; j++) {
          if (layerTogglers[key].layerArray[j].zIndex > 0) {
            var l = W.map.getLayers().find(layer => layer.name === layerTogglers[key].layerName);
            if (l !== undefined) {
              l.setZIndex(layerTogglers[key].layerArray[j].zIndex);
            }
          }
        }
      }
    };
  }

  // OpenLayers 2 OVERRIDE - not called by anything in this script.
  //
  // WMS layers created with service type 'WMS_4326' are given getURL / getFullRequestString
  // replacements in their options, and OL2 calls both with `this` bound to the layer. That is
  // why they read `this.projection` / `this.epsg4326` below - those are OL2's own layer
  // properties, set from the options object of addNewLayer().
  //
  // The WMS 1.1.1 axis order is longitude,latitude, so the bounds are transformed FROM the
  // map projection INTO EPSG:4326 with reverseAxisOrder() - the mirror of what the default
  // getURL() does. Do not "simplify" the transform away.
  //
  // @param {OpenLayers.Bounds} bounds the tile bounds in the map projection
  // @returns {string} the full GetMap request URL
  function getUrl4326(bounds) {
    var newParams = {};
    bounds.transform(this.projection, this.epsg4326);
    newParams.BBOX = bounds.toArray(this.reverseAxisOrder());
    var imageSize = this.getImageSize(bounds);
    newParams.WIDTH = imageSize.w;
    newParams.HEIGHT = imageSize.h;
    // newParams.WIDTH = 742;
    // newParams.HEIGHT = 485;
    //from geoserver
    // newParams.WIDTH = 648;
    // newParams.HEIGHT = 768;
    var requestString = this.getFullRequestString(newParams);
    return requestString;
  }

  // OpenLayers 2 OVERRIDE - the companion of getUrl4326 above, with the same `this = layer`
  // calling convention.
  //
  // Forces SRS (not CRS - this is a WMS 1.1.1 request, see the version in addNewLayer) onto the
  // params before delegating to OL2, so the request string is built for the projection the
  // transformed bounds are already in. Setting it here rather than in the layer params is
  // deliberate: OL2's own getFullRequestString would otherwise stamp the map's projection on.
  //
  // @param {Object} newParams the request parameters, including BBOX / WIDTH / HEIGHT
  // @returns {string} the full request URL, via OL2's grid implementation
  function getFullRequestString4326(newParams) {
    this.params.SRS = 'EPSG:4326';
    return OL.Layer.Grid.prototype.getFullRequestString.apply(this, arguments);
  }

  // Helper function to remove Z coordinates from GeoJSON
  function removeZCoordinates(coords) {
    if (!coords) return coords;
    
    // Check if this is a coordinate pair [lon, lat] or [lon, lat, elevation]
    if (typeof coords[0] === 'number') {
      // It's a coordinate pair/triple - return only [lon, lat]
      return coords.slice(0, 2);
    }
    
    // It's an array of coordinates - recurse
    return coords.map(removeZCoordinates);
  }

  /* ==================================================================
     POSTAL CODES - Nepal government address sheet -> feature properties
     The published Google Sheet is fetched once (gviz JSON), cached in the same
     IndexedDB the styles use, and joined to the loaded ward polygons by
     State Code + District + GaPa/NaPa. The join is driven by the WARD KML's own
     properties - never by the Waze city name, which is only ever used for
     checking/display. The 5-digit city code comes straight from the sheet; the
     7-digit ward code is DERIVED from it plus the ward number (10106 + ward 1
     -> 1010601), which is the sheet's own convention (its "Ward Postal Codes"
     cell reads "1010601 to 11").
     ================================================================== */
  var POSTAL_SHEET_ID = '1vY1a2UU9X1j9EJTyBk4Rsg5RgrzDjYgUomETge7vLQI';
  var POSTAL_SHEET_URL =
    'https://docs.google.com/spreadsheets/d/' + POSTAL_SHEET_ID + '/gviz/tq?tqx=out:json';
  var POSTAL_DB_KEY = 'postal-codes'; // record key inside the shared styles store
  var POSTAL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  var POSTAL_STATE_KEY = '_wme_nepali_wms_postal';

  // Column positions A..O of the sheet. Columns P..Z are unnamed and empty, so they are
  // deliberately not mapped: a label-keyed map would collapse all eleven into a single
  // '' key. These are gviz column ids, so a renamed header does not break us.
  var POSTAL_COLUMNS = {
    sn: 0,
    stateCode: 1,
    province: 2,
    district: 3,
    typeGnEn: 4,
    typeRect: 5,
    typeGn: 6,
    gapaNapa: 7,
    wazeCity: 8,
    cityName: 9,
    cityPostal: 10,
    wardCount: 11,
    wardPostalRange: 12,
    postalOffice: 13,
    remarks: 14,
  };

  // Province names, keyed on BOTH spellings the data uses: the two-letter state token the
  // ward KML carries inside its address ("Bhaktapur-9, BHAKTAPUR, BA") and the numeric
  // State Code the sheet uses (1-7). One map, so a name can never differ between the two
  // sources that derive it.
  var POSTAL_STATE_NAMES = {
    KO: 'Koshi',
    MA: 'Madhesh',
    BA: 'Bagmati',
    GA: 'Gandaki',
    LU: 'Lumbini',
    KA: 'Karnali',
    SU: 'Sudurpashchim',
    '1': 'Koshi',
    '2': 'Madhesh',
    '3': 'Bagmati',
    '4': 'Gandaki',
    '5': 'Lumbini',
    '6': 'Karnali',
    '7': 'Sudurpashchim',
  };

  var postalRows = null; // parsed sheet rows
  var postalIndex = null; // { byKey: Map, byUnit: Map }
  var postalLoaded = false;
  var postalFetchedAt = 0;
  var postalStatus = 'idle'; // idle | loading | ready | error
  var postalMessage = ''; // transient note, e.g. "stale cache"
  var postalError = '';
  var postalWardCodes = true; // 7-digit ward code vs 5-digit city code
  var postalAutoLoad = true;
  // Put the Waze city in front of the ward part of the card's address. On by default:
  // the sheet's Waze City Name column holds the sub-city / area / tole, so without it
  // the copied address is missing the one part a local reader uses to find the place.
  var postalSubCity = true;
  // Write "Bagmati Province" rather than a bare "Bagmati". On by default and switchable,
  // the same way the sub-city insert is, so an address can be written either way.
  var postalProvinceSuffix = true;
  // The single switch in the user's words: "Show postal card address". The card is drawn
  // ONLY when this is on AND a Nepal GIS ward (NP_W_*) KML layer is loaded - the two are
  // ANDed, so switching it off hides the card even with the ward on the map, and having no
  // ward loaded keeps the switch greyed out until one appears.
  var postalCardEnabled = true;
  var postalLoadPromise = null;
  var postalUiRefreshers = []; // the Settings card re-renders itself through these

  function postalNotifyUi() {
    postalUiRefreshers.forEach(function (fn) {
      try {
        fn();
      } catch (e) {
        console.warn(scriptName + ': postal UI refresh failed', e);
      }
    });
  }

  function postalSetStatus(status, message, error) {
    postalStatus = status;
    postalMessage = message || '';
    postalError = error || '';
    postalNotifyUi();
  }

  function postalStatusText() {
    if (postalStatus === 'loading') return 'Loading the postal code sheet...';
    if (postalStatus === 'error') return 'Could not load the sheet: ' + (postalError || 'unknown error');
    if (postalLoaded && postalRows) {
      var parts = [postalRows.length + ' rows indexed'];
      if (postalFetchedAt) {
        var mins = Math.round((Date.now() - postalFetchedAt) / 60000);
        parts.push(mins <= 0 ? 'fetched just now' : 'cached ' + mins + ' min ago');
      }
      if (postalMessage) parts.push(postalMessage);
      return parts.join(' - ') + '.';
    }
    return 'Not loaded yet.';
  }

  function postalCellValue(cell) {
    if (!cell) return '';
    if (cell.v === null || cell.v === undefined) {
      return cell.f === null || cell.f === undefined ? '' : String(cell.f);
    }
    return cell.v;
  }

  // Unwraps the gviz wrapper (an "O_o" marker line followed by
  // google.visualization.Query.setResponse({...});) and maps the columns positionally.
  function postalParseGviz(text) {
    var body = String(text);
    var start = body.indexOf('{');
    var end = body.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('unexpected gviz response');
    var payload = JSON.parse(body.slice(start, end + 1));
    var table = payload && payload.table;
    if (!table || !Array.isArray(table.rows)) throw new Error('gviz response has no table');
    var rows = [];
    table.rows.forEach(function (row) {
      var cells = row && row.c;
      if (!Array.isArray(cells)) return;
      var record = {};
      Object.keys(POSTAL_COLUMNS).forEach(function (name) {
        record[name] = postalCellValue(cells[POSTAL_COLUMNS[name]]);
      });
      // A trailing blank line (or a spacer row) carries neither of the two join keys.
      if (!String(record.district || '').trim() && !String(record.gapaNapa || '').trim()) return;
      rows.push(record);
    });
    if (!rows.length) throw new Error('the sheet returned no usable rows');
    return rows;
  }

  // Waze city names: exact match only (no transliteration), so whitespace and Unicode
  // form are the only things normalised - applied to BOTH sides of the compare.
  function postalNormalizeWazeName(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\s+/g, ' ').trim().normalize('NFC');
  }

  // Upper-cased join part. State Code arrives as a number (1..7), so String() first;
  // upper-casing is safe here because these are ASCII values and it only absorbs case
  // drift - it never guesses at a spelling.
  function postalSlugPart(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim().toUpperCase();
  }

  /** Full province name for a state code - the two-letter token or the numeric code. */
  function postalStateName(value) {
    if (value === null || value === undefined) return '';
    var key = postalSlugPart(value);
    return POSTAL_STATE_NAMES[key] || '';
  }

  // The province a ward polygon belongs to: the KML's numeric state code first, then the
  // two-letter token its address ends with. '' when neither is known.
  function postalStateNameOf(properties) {
    if (!properties) return '';
    var mapped =
      postalStateName(properties.ex_state_code) || postalStateName(properties.ex_PROVINCE_2);
    if (mapped) return mapped;
    var address = properties[NP_GIS_LABEL_FIELD];
    if (!address) return '';
    var parts = String(address).split(',');
    return postalStateName(parts[parts.length - 1]);
  }

  // Punctuation- and space-free form: "Bhaktapur Nagarpalika" -> "BHAKTAPURNAGARPALIKA".
  function postalTight(value) {
    return postalSlugPart(value).replace(/[^A-Z0-9]/g, '');
  }

  // Transliteration-tolerant form. The tile and the sheet spell the same local unit
  // differently often enough to matter (Balefi / Balephi, Illam / Ilam, Sunwarshi /
  // Sunawarshi), so the common Nepali romanisation pairs are folded together. BOTH
  // sides go through the same fold, so a spelling the two already share can never be
  // broken by it - only spellings that already differ can come together.
  function postalLoose(value) {
    return postalTight(value)
      .replace(/PH/g, 'F')
      .replace(/BH/g, 'B')
      .replace(/KH/g, 'K')
      .replace(/TH/g, 'T')
      .replace(/CH/g, 'C')
      .replace(/SH/g, 'S')
      .replace(/V/g, 'W')
      .replace(/EE/g, 'I')
      .replace(/OO/g, 'U')
      .replace(/AA/g, 'A')
      .replace(/([A-Z])\1+/g, '$1');
  }

  // Levenshtein similarity, 0..1. Only ever used as the LAST resort, scoped to one
  // district (a handful of candidates), and only accepted with a clear margin over the
  // runner-up - so it cannot silently pick a neighbouring local unit.
  function postalSimilarity(a, b) {
    var m = a.length;
    var n = b.length;
    if (!m || !n) return 0;
    var prev = [];
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) {
      var current = [i];
      for (var k = 1; k <= n; k++) {
        current[k] = Math.min(
          prev[k] + 1,
          current[k - 1] + 1,
          prev[k - 1] + (a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1)
        );
      }
      prev = current;
    }
    return 1 - prev[n] / Math.max(m, n);
  }

  // A fuzzy name match has to clear both bars: similar enough on its own, AND a clear
  // margin over the next best candidate in the district. Anything less is left
  // unmatched - a wrong postal code is worse than none.
  var POSTAL_FUZZY_MIN = 0.78;
  var POSTAL_FUZZY_MARGIN = 0.1;
  var POSTAL_DISTRICT_MIN = 0.75;

  var postalDistrictAlias = new Map(); // "3|CHITAWAN" -> "CHITWAN"
  var postalMatchStats = { code: 0, key: 0, loose: 0, fuzzy: 0, miss: 0 };
  var postalLastPath = '';

  function postalBuildIndex(rows) {
    var byCode = new Map();
    var byKey = new Map();
    var byLoose = new Map();
    var byDistrict = new Map();
    var duplicates = 0;
    rows.forEach(function (row) {
      // City Postal Code is distinct on every row, so it is a name-free key - and the
      // municipality KML carries exactly this value in ex_Code.
      var code = postalSlugPart(row.cityPostal);
      if (code) byCode.set(code, row);

      var state = postalSlugPart(row.stateCode);
      var districtKey = state + '|' + postalSlugPart(row.district);

      var key = districtKey + '|' + postalTight(row.gapaNapa);
      if (byKey.has(key)) duplicates++;
      else byKey.set(key, row);

      var looseKey = districtKey + '|' + postalLoose(row.gapaNapa);
      if (!byLoose.has(looseKey)) byLoose.set(looseKey, row);

      if (!byDistrict.has(districtKey)) byDistrict.set(districtKey, []);
      byDistrict.get(districtKey).push(row);
    });
    if (duplicates) {
      console.warn(scriptName + ': ' + duplicates + ' duplicate postal join key(s) - keeping the first of each.');
    }
    return { byCode: byCode, byKey: byKey, byLoose: byLoose, byDistrict: byDistrict };
  }

  // The tile and the sheet do not always spell a district the same way (CHITAWAN vs
  // CHITWAN), so a district that is not found verbatim is resolved once against the
  // sheet's own district tokens for the same state, then memoised.
  function postalResolveDistrict(state, district) {
    var token = postalSlugPart(district);
    var districtKey = state + '|' + token;
    if (postalIndex.byDistrict.has(districtKey)) return token;
    if (postalDistrictAlias.has(districtKey)) return postalDistrictAlias.get(districtKey);
    var best = '';
    var bestScore = 0;
    postalIndex.byDistrict.forEach(function (list, key) {
      if (key.slice(0, state.length + 1) !== state + '|') return;
      var score = postalSimilarity(postalLoose(key.slice(state.length + 1)), postalLoose(token));
      if (score > bestScore) {
        bestScore = score;
        best = key.slice(state.length + 1);
      }
    });
    var resolved = bestScore >= POSTAL_DISTRICT_MIN ? best : '';
    postalDistrictAlias.set(districtKey, resolved);
    return resolved;
  }

  function postalFuzzyRow(districtKey, gapaNapa) {
    var candidates = postalIndex.byDistrict.get(districtKey);
    if (!candidates || !candidates.length) return null;
    var wanted = postalLoose(gapaNapa);
    var best = null;
    var bestScore = 0;
    var secondScore = 0;
    candidates.forEach(function (row) {
      var score = postalSimilarity(postalLoose(row.gapaNapa), wanted);
      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        best = row;
      } else if (score > secondScore) {
        secondScore = score;
      }
    });
    if (!best || bestScore < POSTAL_FUZZY_MIN) return null;
    if (bestScore - secondScore < POSTAL_FUZZY_MARGIN) return null;
    return best;
  }

  // Resolves a feature to its sheet row. The order is deliberate: an exact postal code
  // first (name-free), then the exact name, then the transliteration fold, then - last
  // resort and district-scoped - a fuzzy name match. `postalLastPath` names the path
  // that succeeded, which is what the match summary logs.
  function postalLookupRow(stateCode, district, gapaNapa, explicitCode) {
    if (!postalIndex) return null;
    var code = postalSlugPart(explicitCode);
    if (code && postalIndex.byCode.has(code)) {
      postalLastPath = 'code';
      return postalIndex.byCode.get(code);
    }
    var state = postalSlugPart(stateCode);
    var resolved = postalResolveDistrict(state, district);
    if (!resolved) return null;
    var districtKey = state + '|' + resolved;
    var hit = postalIndex.byKey.get(districtKey + '|' + postalTight(gapaNapa));
    if (hit) {
      postalLastPath = 'key';
      return hit;
    }
    hit = postalIndex.byLoose.get(districtKey + '|' + postalLoose(gapaNapa));
    if (hit) {
      postalLastPath = 'loose';
      return hit;
    }
    hit = postalFuzzyRow(districtKey, gapaNapa);
    if (hit) postalLastPath = 'fuzzy';
    return hit;
  }

  // True only for a feature that actually names a local unit. A province or district
  // outline carries none, and is skipped before it can count as an unmatched row.
  function postalFeatureIsJoinable(properties) {
    return !!(properties && (properties.ex_gapa_napa || properties.ex_GAPA_NAP_2));
  }

  // The sheet row for a loaded feature, read from its own KML properties. A ward KML
  // carries ex_state_code / ex_district / ex_gapa_napa; the municipality KML carries
  // ex_PROVINCE_2 / ex_DISTRICT_3 / ex_GAPA_NAP_2 plus its own exact ex_Code.
  function postalLookupProperties(properties) {
    if (!properties) return null;
    return postalLookupRow(
      properties.ex_state_code || properties.ex_PROVINCE_2,
      properties.ex_district || properties.ex_DISTRICT_3,
      properties.ex_gapa_napa || properties.ex_GAPA_NAP_2,
      properties.ex_Code
    );
  }

  // The 7-digit ward code: the sheet's 5-digit city code with the ward number padded to
  // two digits appended (10106 + ward 1 -> "1010601"). A ward outside the sheet's own
  // Ward Count is left WITHOUT a ward code rather than given a wrong one.
  function postalWardCode(row, wardNo) {
    var base = postalSlugPart(row && row.cityPostal);
    if (!base) return '';
    var ward = Number(wardNo);
    if (!isFinite(ward) || ward < 1) return '';
    var count = Number(row.wardCount);
    if (isFinite(count) && count >= 1 && ward > count) return '';
    return base + String(ward).padStart(2, '0');
  }

  // Writes the postal properties onto a loaded feature. Returns true on a match.
  function postalAnnotateFeature(properties) {
    if (!postalIndex || !postalFeatureIsJoinable(properties)) return false;
    postalLastPath = '';
    var row = postalLookupProperties(properties);
    if (!row) {
      postalMatchStats.miss++;
      // Fail OPEN: no match simply means no postal properties, never a wrong one.
      delete properties.postal_code;
      delete properties.postal_ward_code;
      delete properties.postal_state;
      return false;
    }
    postalMatchStats[postalLastPath] += 1;
    properties.postal_code = postalSlugPart(row.cityPostal);
    var wardCode = postalWardCode(row, properties.ex_new_ward_n);
    if (wardCode) properties.postal_ward_code = wardCode;
    else delete properties.postal_ward_code;
    // The full province name, from the row's own State Code through the shared map (the
    // sheet's province column is only the fallback), so it can be picked as a label field
    // without the address card being involved at all.
    var stateName = postalStateName(row.stateCode) || String(row.province || '').trim();
    if (stateName) properties.postal_state = stateName;
    else delete properties.postal_state;
    return true;
  }

  // Re-annotates every loaded layer - used when the sheet arrives after them. Every
  // feature that names a local unit is tried, so the municipality level is covered as
  // well as the wards; a province or district outline is skipped inside the annotator.
  function postalApplyToLoadedLayers() {
    if (!postalIndex) return 0;
    postalMatchStats = { code: 0, key: 0, loose: 0, fuzzy: 0, miss: 0 };
    var touched = 0;
    loadedGeoJSONLayers.forEach(function (info) {
      if (!info || !Array.isArray(info.sdkFeatures)) return;
      var matched = 0;
      info.sdkFeatures.forEach(function (feature) {
        if (postalAnnotateFeature(feature.properties)) matched++;
      });
      if (matched) {
        scheduleStyleApply(info.name); // picks up a postal label field if one is set
        touched++;
      }
    });
    var total =
      postalMatchStats.code + postalMatchStats.key + postalMatchStats.loose + postalMatchStats.fuzzy;
    console.log(
      scriptName +
        ': postal codes applied to ' +
        total +
        ' feature(s) in ' +
        touched +
        ' layer(s) - by code ' +
        postalMatchStats.code +
        ', exact name ' +
        postalMatchStats.key +
        ', folded name ' +
        postalMatchStats.loose +
        ', fuzzy ' +
        postalMatchStats.fuzzy +
        ', unmatched ' +
        postalMatchStats.miss +
        '.'
    );
    // A segment can already be selected while the sheet is arriving, so the address card
    // (which shows the code) has to be rebuilt once the codes exist.
    postalScheduleAddressCard();
    return touched;
  }

  var postalSelfCheckResult = null;

  // Cross-checks our derived ward code against the sheet's own "Ward Postal Codes" cell
  // ("1010601 to 11"). This is a canary for a change of convention in the sheet: if the
  // government ever stops using the padded-ward suffix, the mismatch count says so
  // instead of the codes silently going wrong.
  //
  // It also re-derives the province from the code itself. The 7-digit code is 1+2+2+2 -
  // province, district, municipality, ward (2060105 = province 2, district 06,
  // municipality 01, ward 05) - so the first digit of the 5-digit city code has to equal
  // the row's own State Code. That is an independent check of the two keys the join is
  // indexed on, not just of the ward suffix.
  function postalSelfCheck() {
    if (!postalRows || !postalRows.length) return null;
    var checked = 0;
    var mismatched = 0;
    var stateChecked = 0;
    var stateMismatched = 0;
    postalRows.forEach(function (row) {
      var match = String(row.wardPostalRange || '').match(/\d{5,}/);
      if (match) {
        var derived = postalWardCode(row, 1);
        if (derived) {
          checked++;
          if (derived !== match[0]) mismatched++;
        }
      }
      var code = postalSlugPart(row.cityPostal);
      var state = postalSlugPart(row.stateCode);
      if (/^\d{5}$/.test(code) && /^\d+$/.test(state)) {
        stateChecked++;
        if (Number(code.charAt(0)) !== Number(state)) stateMismatched++;
      }
    });
    postalSelfCheckResult = checked ? { checked: checked, mismatched: mismatched } : null;
    if (checked) {
      console.log(
        scriptName +
          ': postal self-check - ' +
          (checked - mismatched) +
          '/' +
          checked +
          ' sheet rows match the derived ward-1 code' +
          (mismatched ? ' (' + mismatched + ' differ).' : '.')
      );
    }
    if (stateChecked) {
      console.log(
        scriptName +
          ': postal self-check - ' +
          (stateChecked - stateMismatched) +
          '/' +
          stateChecked +
          ' sheet rows have a city code whose province digit matches the State Code' +
          (stateMismatched ? ' (' + stateMismatched + ' differ).' : '.')
      );
    }
    return postalSelfCheckResult;
  }

  // --- IndexedDB cache (shares the style store) ---------------------------
  function postalLoadCached() {
    return styleDbGet(POSTAL_DB_KEY).then(function (record) {
      var value = record && record.style;
      return value && Array.isArray(value.rows) ? value : null;
    });
  }

  // The postal sheet is by far the largest record this script writes - one row per ward,
  // each with several fields - so it is the one put that asks to close its transaction
  // immediately instead of leaving the engine to decide when the queue has drained.
  function postalSaveCached(rows, fetchedAt) {
    return styleDbRequest('readwrite', function (store) {
      return store.put({ key: POSTAL_DB_KEY, style: { rows: rows, fetchedAt: fetchedAt } });
    }, true);
  }

  function postalClearCached() {
    return styleDbDelete(POSTAL_DB_KEY);
  }

  function postalFetchRows() {
    return npGisFetchText(POSTAL_SHEET_URL, 45000).then(postalParseGviz);
  }

  function postalInstallRows(rows, fetchedAt, source) {
    postalRows = rows;
    postalIndex = postalBuildIndex(rows);
    postalDistrictAlias = new Map(); // any district alias is derived from the old index
    postalFetchedAt = Number(fetchedAt) || Date.now();
    postalLoaded = true;
    console.log(scriptName + ': postal codes ready from ' + source + ' (' + rows.length + ' rows).');
    postalSelfCheck();
    postalApplyToLoadedLayers();
  }

  // Loads the sheet, preferring a still-fresh cache. `force` always re-fetches.
  function postalEnsureLoaded(force) {
    if (postalLoadPromise && !force) return postalLoadPromise;
    if (postalLoaded && !force) return Promise.resolve();
    postalSetStatus('loading', '', '');
    postalLoadPromise = Promise.resolve()
      .then(function () {
        return force ? null : postalLoadCached();
      })
      .then(function (cached) {
        if (cached) {
          var age = Date.now() - Number(cached.fetchedAt || 0);
          if (age >= 0 && age < POSTAL_CACHE_TTL_MS) {
            postalInstallRows(cached.rows, cached.fetchedAt, 'cache');
            postalSetStatus('ready', '', '');
            return null;
          }
        }
        return postalFetchRows().then(function (rows) {
          var fetchedAt = Date.now();
          postalInstallRows(rows, fetchedAt, 'network');
          postalSetStatus('ready', '', '');
          return postalSaveCached(rows, fetchedAt);
        });
      })
      .catch(function (e) {
        var message = e && e.message ? e.message : String(e);
        if (postalLoaded) {
          // Keep serving the last known codes rather than emptying the map.
          postalSetStatus('ready', 'refresh failed (' + message + ')', '');
          return null;
        }
        return postalLoadCached().then(function (cached) {
          if (cached) {
            postalInstallRows(cached.rows, cached.fetchedAt, 'stale cache');
            postalSetStatus('ready', 'stale cache - ' + message, '');
            return null;
          }
          postalSetStatus('error', '', message);
        });
      })
      .then(function () {
        postalLoadPromise = null;
      });
    return postalLoadPromise;
  }

  // --- Persisted switches -------------------------------------------------
  function loadPostalState() {
    var saved = npwLoadJson(POSTAL_STATE_KEY, {});
    if (typeof saved.wardCodes === 'boolean') postalWardCodes = saved.wardCodes;
    if (typeof saved.autoLoad === 'boolean') postalAutoLoad = saved.autoLoad;
    if (typeof saved.subCity === 'boolean') postalSubCity = saved.subCity;
    if (typeof saved.provinceSuffix === 'boolean') postalProvinceSuffix = saved.provinceSuffix;
    if (typeof saved.cardEnabled === 'boolean') postalCardEnabled = saved.cardEnabled;
  }

  function savePostalState() {
    npwSaveJson(POSTAL_STATE_KEY, {
      wardCodes: postalWardCodes,
      autoLoad: postalAutoLoad,
      subCity: postalSubCity,
      provinceSuffix: postalProvinceSuffix,
      cardEnabled: postalCardEnabled,
    });
  }

  /** True while at least one Nepal GIS ward polygon is loaded - the KML_Wards tree from
   *  kid4rm90s.github.io. That is the layer the postal card's ward lookup reads: every
   *  feature that carries the ex_Address / ex_new_ward_n fields the code is derived from
   *  comes from it. The Lalitpur HN ward group is a different dataset and is deliberately
   *  NOT counted - its polygons have no State Code / district / GaPa-NaPa fields, so no
   *  postal code can be resolved from them. */
  function postalHasWardLayer() {
    var prefix = NP_GIS_LEVEL_PREFIX.ward;
    for (var i = 0; i < loadedGeoJSONLayers.length; i++) {
      var info = loadedGeoJSONLayers[i];
      if (info.layerType !== 'ward') continue;
      if (!prefix || String(info.name).indexOf(prefix) === 0) return true;
    }
    return false;
  }

  /** Re-runs the address card when the NP_W_ ward layers appear or disappear, so both the
   *  card and the greyed-out state of its switch follow the map without waiting for the
   *  next selection change or the next Settings repaint. */
  function postalNotifyWardLayersChanged() {
    postalNotifyUi();
    postalScheduleAddressCard();
  }

  // "Postal Codes" card in the Settings tab: loads/refreshes the sheet, reports what is
  // cached, and picks between the 5-digit city code and the 7-digit ward code.
  // `refreshAttributes` re-reads the label-field attribute list, which is how the new
  // postal_code / postal_ward_code keys appear in the picker.
  function buildPostalCard(host, refreshAttributes) {
    var card = npwCard(host, 'Postal Codes');
    card.appendChild(
      npwCreate(
        'div',
        'npw-status',
        'Postal codes come from the published government address sheet and are matched to the loaded polygons ' +
          'by <em>State Code + District + GaPa/NaPa</em> - taken from the KML\'s own fields, not from the Waze ' +
          'city name. A municipality matches by its own postal code where the KML carries one; a ward falls back ' +
          'to its name, folding the common Nepali romanisation pairs and, last, a district-scoped fuzzy match. ' +
          'The 5-digit city code is read from the sheet; the 7-digit ward code is derived from it plus the ward ' +
          'number. Matches are written to every matched feature as postal_code, postal_ward_code and ' +
          'postal_state (the full province name - KO/MA/BA/GA/LU/KA/SU or 1-7), so any of them can be chosen ' +
          'as a label field.'
      )
    );

    var statusEl = npwCreate('div', 'npw-status', '');
    statusEl.id = 'npwPostalStatus';
    card.appendChild(statusEl);

    var wardToggle = npwCreate('label', 'npw-field-toggle');
    wardToggle.title = 'On: the 7-digit ward code (1010601). Off: the 5-digit city code (10106).';
    var wardBox = document.createElement('input');
    wardBox.type = 'checkbox';
    wardBox.id = 'npwPostalWardCodes';
    wardBox.className = 'npw-checkbox';
    wardToggle.appendChild(wardBox);
    wardToggle.appendChild(document.createTextNode('Use the 7-digit ward postal code'));
    card.appendChild(wardToggle);

    var autoToggle = npwCreate('label', 'npw-field-toggle');
    autoToggle.title = 'Fetch the sheet once at start-up. A cached copy is reused for 24 hours.';
    var autoBox = document.createElement('input');
    autoBox.type = 'checkbox';
    autoBox.id = 'npwPostalAutoLoad';
    autoBox.className = 'npw-checkbox';
    autoToggle.appendChild(autoBox);
    autoToggle.appendChild(document.createTextNode('Load on start-up (cached 24 h)'));
    card.appendChild(autoToggle);

    var subCityToggle = npwCreate('label', 'npw-field-toggle');
    subCityToggle.title =
      'Put the Waze city in front of the ward part of the address card, e.g. ' +
      '"Pathlaiya, Jitpur Simara-1, Bara, Madhesh, 2070301, Nepal". The Waze city is the sub-city / area / ' +
      'tole within the ward\'s local unit, which is why it goes before the ward. Turn this off to copy the ' +
      'address without it.';
    var subCityBox = document.createElement('input');
    subCityBox.type = 'checkbox';
    subCityBox.id = 'npwPostalSubCity';
    subCityBox.className = 'npw-checkbox';
    subCityToggle.appendChild(subCityBox);
    subCityToggle.appendChild(document.createTextNode('Combine the sub-city in the address'));
    card.appendChild(subCityToggle);

    var provinceToggle = npwCreate('label', 'npw-field-toggle');
    provinceToggle.title =
      'Write the province out in full in the address card, e.g. "Bagmati Province" instead of a bare "Bagmati". ' +
      'The word is only added to a name the script resolved from its own code-to-name map, so a token it does not ' +
      'know is still printed exactly as the KML wrote it. Turn this off for the bare name.';
    var provinceBox = document.createElement('input');
    provinceBox.type = 'checkbox';
    provinceBox.id = 'npwPostalProvinceSuffix';
    provinceBox.className = 'npw-checkbox';
    provinceToggle.appendChild(provinceBox);
    provinceToggle.appendChild(document.createTextNode('Combine Province in the address'));
    card.appendChild(provinceToggle);

    var cardToggle = npwCreate('label', 'npw-field-toggle');
    cardToggle.title =
      'Show the postal address card in the edit panel when a segment or a venue is selected. ' +
      'The card needs the Nepal GIS ward polygons to read a code from, so this switch is greyed ' +
      'out until at least one Ward (NP_W_) layer from the Nepal GIS Layers card is loaded - see ' +
      'the Ward level there. With no ward layer loaded there is no code to show.';
    var cardBox = document.createElement('input');
    cardBox.type = 'checkbox';
    cardBox.id = 'npwPostalCardEnabled';
    cardBox.className = 'npw-checkbox';
    cardToggle.appendChild(cardBox);
    cardToggle.appendChild(document.createTextNode('Show postal card address'));
    card.appendChild(cardToggle);

    var buttons = npwButtonRow(card);
    var refreshBtn = npwButton(
      buttons,
      'Load / Refresh',
      'Fetch the sheet and rebuild the postal index',
      'primary'
    );
    var clearBtn = npwButton(buttons, 'Clear cache', 'Forget the cached copy of the sheet', 'danger');

    refreshBtn.addEventListener('click', function () {
      postalEnsureLoaded(true);
    });
    clearBtn.addEventListener('click', function () {
      postalClearCached().then(function () {
        postalRows = null;
        postalIndex = null;
        postalLoaded = false;
        postalFetchedAt = 0;
        postalSetStatus('idle', '', '');
      });
    });
    wardBox.addEventListener('change', function () {
      postalWardCodes = wardBox.checked;
      savePostalState();
      postalNotifyUi();
    });
    autoBox.addEventListener('change', function () {
      postalAutoLoad = autoBox.checked;
      savePostalState();
      if (postalAutoLoad) postalEnsureLoaded(false);
    });
    subCityBox.addEventListener('change', function () {
      postalSubCity = subCityBox.checked;
      savePostalState();
      // The card is always rebuilt from scratch, so the address it shows and copies
      // follows this switch straight away - no repaint hook of its own is needed.
      postalScheduleAddressCard();
    });
    provinceBox.addEventListener('change', function () {
      postalProvinceSuffix = provinceBox.checked;
      savePostalState();
      postalScheduleAddressCard();
    });
    cardBox.addEventListener('change', function () {
      postalCardEnabled = cardBox.checked;
      savePostalState();
      // The card is rebuilt from scratch, so switching this off removes the one on screen
      // and switching it back on brings it back for the current selection.
      postalScheduleAddressCard();
    });

    /** The switch follows the map: it is only usable while an NP_W_ ward layer is loaded,
     *  because that layer is the only place the card's postal code comes from. */
    function refreshPostalCardToggle() {
      var hasWard = postalHasWardLayer();
      cardBox.checked = !!postalCardEnabled;
      cardBox.disabled = !hasWard;
      cardToggle.classList.toggle('npw-disabled', !hasWard);
      cardToggle.title = hasWard
        ? 'Show the postal address card in the edit panel when a segment or a venue is selected. ' +
          'Turn this off to hide the card even while the ward polygons are loaded.'
        : 'Unavailable until a Nepal GIS Ward layer is loaded: the card reads its postal code ' +
          'from those polygons. Tick Ward on the Nepal GIS Layers card (zoom 14+), then this ' +
          'switch becomes available.';
    }

    postalUiRefreshers.push(function () {
      wardBox.checked = !!postalWardCodes;
      autoBox.checked = !!postalAutoLoad;
      subCityBox.checked = !!postalSubCity;
      provinceBox.checked = !!postalProvinceSuffix;
      refreshPostalCardToggle();
      statusEl.textContent = postalStatusText();
      var busy = postalStatus === 'loading';
      refreshBtn.disabled = busy;
      refreshBtn.textContent = busy ? 'Loading...' : 'Load / Refresh';
      if (refreshAttributes) refreshAttributes();
    });

    // First paint, then the start-up load.
    wardBox.checked = !!postalWardCodes;
    autoBox.checked = !!postalAutoLoad;
    subCityBox.checked = !!postalSubCity;
    provinceBox.checked = !!postalProvinceSuffix;
    refreshPostalCardToggle();
    statusEl.textContent = postalStatusText();
    if (postalAutoLoad) postalEnsureLoaded(false);
  }

  /* ------------------------------------------------------------------
     Postal address card in the segment edit panel
     Shows the community address format for the selected segment: street name,
     the ward it sits in, its postal code and the country. The ward is found by
     testing the segment's midpoint against the loaded ward polygons - bounding
     box first, then a real point-in-polygon - so the code shown is the one
     belonging to the ward the segment is actually inside.

     It is inserted ABOVE the "Alternate addresses" block
     (.alt-streets-control), i.e. directly under the address inputs.
     ------------------------------------------------------------------ */
  var POSTAL_ADDRESS_CARD_ID = 'npw-postal-address-card';
  var postalAddressTimer = null;
  var postalAddressRetry = 0; // bounded retries while the edit panel is still rendering

  /** Ray-casting point-in-polygon test over a single ring. */
  function postalPointInRing(point, ring) {
    var x = point[0];
    var y = point[1];
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0];
      var yi = ring[i][1];
      var xj = ring[j][0];
      var yj = ring[j][1];
      // Standard crossing test; the ring is treated as closed because j wraps to the
      // last vertex on the first iteration.
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function postalPointInFeature(point, feature) {
    var geometry = feature && feature.geometry;
    if (!geometry || !geometry.coordinates) return false;
    if (geometry.type === 'Polygon') return postalPointInRing(point, geometry.coordinates[0]);
    if (geometry.type === 'MultiPolygon') {
      for (var i = 0; i < geometry.coordinates.length; i++) {
        if (postalPointInRing(point, geometry.coordinates[i][0])) return true;
      }
    }
    return false;
  }

  // The loaded ward polygon a point falls inside, or null. The precomputed __bbox makes
  // this a four-number compare for all but the one or two features that can contain it.
  function postalWardAtPoint(point) {
    var found = null;
    loadedGeoJSONLayers.forEach(function (info) {
      if (found || info.layerType !== 'ward' || !Array.isArray(info.sdkFeatures)) return;
      for (var i = 0; i < info.sdkFeatures.length; i++) {
        var feature = info.sdkFeatures[i];
        var box = featureBbox(feature);
        if (box && (point[0] < box[0] || point[0] > box[2] || point[1] < box[1] || point[1] > box[3])) {
          continue;
        }
        if (postalPointInFeature(point, feature)) {
          found = feature;
          return;
        }
      }
    });
    return found;
  }

  function postalRemoveAddressCard() {
    var card = document.getElementById(POSTAL_ADDRESS_CARD_ID);
    if (card) card.remove();
  }

  // "LALITPUR" -> "Lalitpur", "RUKUM EAST" -> "Rukum East". The KML carries the district -
  // and sometimes the local unit - in SHOUTING CASE, which next to a normally-cased street
  // name looked wrong. This is a DISPLAY-only fix: the join and every comparison keep the
  // original value, they never see this one.
  function postalTitleCase(value) {
    return String(value)
      .trim()
      .toLowerCase()
      .replace(/(^|[^a-z0-9])([a-z])/g, function (match, lead, ch) {
        return lead + ch.toUpperCase();
      });
  }

  // The KML's ex_Address ends with the two-letter state token ("Bhaktapur-9, BHAKTAPUR, BA").
  // That token is expanded to the full province name - with or without the "Province"
  // suffix, per the Settings switch (see postalProvinceLabel) - and the part before it is
  // re-cased, so the card reads as a real address; an address whose last part is not a
  // known token is returned exactly as the KML wrote it.
  function postalExpandStateToken(address) {
    var text = String(address);
    var parts = text.split(',');
    if (parts.length < 2) return text;
    var lastIndex = parts.length - 1;
    var token = parts[lastIndex];
    var full = postalProvinceLabel(token);
    if (!full) return text;
    // Only the text of a part changes; whatever whitespace the KML put around the commas is
    // kept, so a first part that has none does not silently gain a leading space.
    var leadingSpace = function (part) {
      var match = part.match(/^\s*/);
      return match ? match[0] : '';
    };
    parts[lastIndex] = leadingSpace(token) + full;
    // The part before the state token is the district in the three-part form ("ward, district,
    // state") and the ward-municipality part when the address carries only two - either way
    // it is what the KML shouts, so it is the one that needs re-casing.
    parts[lastIndex - 1] = leadingSpace(parts[lastIndex - 1]) + postalTitleCase(parts[lastIndex - 1]);
    return parts.join(',');
  }

  // "Bhaktapur-9, BHAKTAPUR, Bagmati" - the KML's own ex_Address with its state token
  // expanded, when the ward is known.
  function postalAddressMiddle(properties) {
    if (!properties) return '';
    var address = properties[NP_GIS_LABEL_FIELD];
    if (address) return postalExpandStateToken(address);
    var ward = properties.ex_new_ward_n;
    var municipality = properties.ex_gapa_napa || '';
    var head = municipality ? municipality + (ward ? '-' + ward : '') : '';
    // ex_state_code is the numeric code and ex_Province is the two-letter token (the KML
    // carries "BA", not "Bagmati"), so both go through the shared map before anything is
    // printed. The fully-resolved name also picks up the "Province" suffix here, while a
    // raw token that the map does not know is printed exactly as the KML wrote it.
    var province =
      postalProvinceLabel(properties.ex_state_code) ||
      postalProvinceLabel(properties.ex_Province) ||
      properties.ex_Province ||
      '';
    return [head, postalTitleCase(properties.ex_district), province].filter(Boolean).join(', ');
  }

  // The code to show, per the switch on the Postal Codes card.
  function postalDisplayCode(properties) {
    if (!properties) return '';
    if (postalWardCodes) return properties.postal_ward_code || properties.postal_code || '';
    return properties.postal_code || properties.postal_ward_code || '';
  }

  // The province as the address card writes it: the full name from the shared map, with
  // the word "Province" appended ("Bagmati" -> "Bagmati Province") while the Settings
  // switch is on. " Province" is only added to a name the map actually resolved, so a raw
  // KML token ("BA") or a missing value is left alone rather than being dressed up as a
  // name it is not - turning the switch off simply drops the suffix and leaves the name.
  // Card display only: `postal_state` on a feature - and therefore any label field built
  // from it - keeps the bare name the rest of the script works with.
  function postalProvinceLabel(value) {
    var name = postalStateName(value);
    if (!name) return '';
    return postalProvinceSuffix ? name + ' Province' : name;
  }

  // The sub-city / area / tole of the ward, taken from the sheet's "Waze City Name"
  // column - the column the sheet itself uses to say which Waze city the ward belongs to
  // (its "City Name" column is the local unit, i.e. the municipality). That is the name
  // the address card shows and copies: while WME stores a per-place city, "Pathlaiya" is
  // an area WITHIN Jitpur Simara, not a second municipality, so the sheet's value is the
  // one that belongs in a postal address. Rendered EXACTLY as the sheet writes it - a
  // name that carries Devanagari is left alone, and so is its casing.
  function postalSubCityName(sheetRow) {
    return postalNormalizeWazeName(sheetRow && sheetRow.wazeCity);
  }

  // True when the Waze city of the segment is a sub-city of the ward the segment sits in,
  // i.e. the sheet names a different Waze city for that ward. The comparison is the exact
  // one the card's warning uses - normalised whitespace/Unicode form, no transliteration -
  // and it is shared so the inserted name and the warning can never disagree about
  // whether there is a sub-city at all. '' on either side means the sheet cannot say, and
  // then nothing is inserted and nothing is warned about.
  function postalIsSubCity(cityName, sheetRow) {
    var city = postalNormalizeWazeName(cityName);
    var subCity = postalSubCityName(sheetRow);
    return !!(city && subCity && city !== subCity);
  }

  // WME's placeholders for a missing name must not be shown as if they were real names.
  function postalRealName(name) {
    var text = name ? String(name).trim() : '';
    if (!text || /^none$/i.test(text) || /^unnamed/i.test(text)) return '';
    return text;
  }

  // Street + city of a segment in ONE SDK call. Segments.getAddress() returns the
  // resolved SegmentAddress ({ street, city, state, country, altStreets }), which is what
  // the edit panel itself shows. This is the only way to get the city: the Segment object
  // carries primaryStreetId but NO city id of its own.
  // The city is used for CHECKING only - the match is driven by the ward polygon - so a
  // missing or renamed city can only ever be reported, never allowed to change the code.
  function postalSegmentAddress(segment) {
    var names = { street: '', city: '' };
    try {
      if (!segment) return names;
      var address = wmeSDK.DataModel.Segments.getAddress({ segmentId: segment.id });
      if (!address) return names;
      names.street = postalRealName(address.street && address.street.name);
      names.city = postalRealName(address.city && address.city.name);
    } catch (e) {
      console.warn(scriptName + ': could not read the segment address', e);
    }
    return names;
  }

  // Street + city of a venue in ONE SDK call, the way postalSegmentAddress does it for a
  // segment. Venues.getAddress() is the same shape ({ street, city, state, country, ... }),
  // so a venue's address is read from the same place the editor reads it - rather than
  // scraped from the panel, which would break on a WME rename.
  // A venue whose address was never filled in comes back with WME's "None" placeholder,
  // which is filtered here exactly as it is for a street name.
  function postalVenueAddress(venue) {
    var names = { street: '', city: '', houseNumber: '' };
    try {
      if (!venue) return names;
      var address = wmeSDK.DataModel.Venues.getAddress({ venueId: venue.id });
      if (!address) return names;
      names.street = postalRealName(address.street && address.street.name);
      names.city = postalRealName(address.city && address.city.name);
      // A venue has a house number, a segment does not - it is the one field the venue address
      // carries on top of the base address, and it belongs in front of the street.
      names.houseNumber = postalRealName(address.houseNumber);
    } catch (e) {
      // A venue that carries no address at all is normal - its fields are left untouched - so
      // this is a plain miss rather than a warning-worthy failure.
      return names;
    }
    return names;
  }

  // The element WME is rendering the feature editor into, or null.
  // A segment panel is #edit-panel and a venue panel is #venue-edit-general - plain document
  // elements, so one lookup each is enough, and they are the only two ids WME uses for a
  // feature this script shows a card for.
  function postalEditPanel() {
    return document.getElementById('edit-panel') || document.getElementById('venue-edit-general');
  }

  // Attaches the card to the feature editor, or removes it when there is nowhere to put it.
  // A segment and a venue panel expose the same address container, `.address-edit-view`, and it
  // is the only anchor used. A segment also has `.alt-streets-control` inside it, a venue does
  // not - hence the two branches: insert before that block when it exists, otherwise append to
  // the view, which lands the card under the address fields either way.
  // Nothing is ever appended to the panel itself, so the card can never end up above the whole
  // form - the failure this avoids.
  // @param {Element} card the card to place
  // @returns {boolean} true when the card was attached
  function postalPlaceAddressCard(card) {
    var view = document.querySelector('#edit-panel .address-edit-view, #venue-edit-general .address-edit-view');
    if (!view) {
      // Nowhere to put it: keep the card out of the way rather than guessing a position.
      if (card.parentNode) card.parentNode.removeChild(card);
      return false;
    }
    var block = view.querySelector('.alt-streets-control');
    // Already exactly where it belongs: touch nothing. `insertBefore` on a node that is
    // already in position still counts as a childList mutation for the observer watching
    // this panel, and that is what made the card strobe while the pointer was over it.
    if (block ? card.nextElementSibling === block : view.lastElementChild === card) return true;
    if (block) view.insertBefore(card, block);
    else view.appendChild(card);
    return true;
  }

  // Which kind of edit panel is open, and the segment or venue it holds.
  // The card is shown for a segment and for a venue: both carry a Waze address and both can sit
  // inside a ward, and the ward polygon decides the code, never the feature type.
  // A GOOGLE PLACE is deliberately not supported. It carries Google's own address text, which
  // is frequently wrong for these places, and there is no way to tell from the panel whether
  // the text on screen belongs to the ward the place sits in - so showing it would put a wrong
  // address in front of a user who copies it straight into WME.
  // @returns {{kind: string, segment: Object|null, venue: Object|null}|null} null when the
  //   selection is not something with an address
  function postalResolveTarget() {
    var selection = null;
    try {
      selection = wmeSDK.Editing.getSelection();
    } catch (e) {
      return null;
    }
    if (!selection || !selection.ids || selection.ids.length !== 1) return null;

    if (selection.objectType === 'segment') {
      var segment = null;
      try {
        segment = wmeSDK.DataModel.Segments.getById({ segmentId: selection.ids[0] });
      } catch (e) {
        return null;
      }
      if (!segment || !segment.geometry || !segment.geometry.coordinates) return null;
      return { kind: 'segment', segment: segment, venue: null };
    }

    if (selection.objectType === 'venue') {
      var venue = null;
      try {
        // Venues are fetched by id, so the call is wrapped: an id the SDK cannot resolve
        // simply means no card rather than a broken render.
        venue = wmeSDK.DataModel.Venues.getById({ venueId: selection.ids[0] });
      } catch (e) {
        venue = null;
      }
      if (!venue) return null;
      var hasGeometry =
        venue.geometry &&
        (venue.geometry.type === 'Point' || (venue.geometry.coordinates && venue.geometry.coordinates.length));
      if (!hasGeometry) return null;
      return { kind: 'venue', segment: null, venue: venue };
    }

    return null;
  }

  // The lon/lat a venue sits at, or null when there is nothing to test.
  // The SDK types a venue's geometry as exactly `Point | Polygon` - there is no third case,
  // and no MultiPolygon - so the shape needs no guessing: a point is its own coordinates, and
  // an area venue is tested from the centre of its ring. Both come from `geometry.
  // coordinates`, which is the same source the map itself draws from.
  // The centroid rather than the first vertex matters for the area case: a ring vertex can be
  // a spike, and a ward polygon must be tested with a point that is really inside the place.
  function postalVenuePoint(venue) {
    var geometry = venue && venue.geometry;
    var coordinates = geometry && geometry.coordinates;
    if (!coordinates || !coordinates.length) return null;

    if (geometry.type === 'Point') {
      var x = Number(coordinates[0]);
      var y = Number(coordinates[1]);
      return isFinite(x) && isFinite(y) ? [x, y] : null;
    }

    // Polygon: coordinates[0] is the outer ring, an array of [lon, lat] pairs. A venue is
    // small (a building or a plot), so the average of the ring's vertices is inside it for
    // any shape an editor could draw, and it is a single pass with no allocation.
    var ring = coordinates[0];
    if (!ring || !ring.length) return null;
    var sumX = 0;
    var sumY = 0;
    var count = 0;
    for (var i = 0; i < ring.length; i++) {
      var pair = ring[i];
      if (!pair || pair.length < 2) continue;
      var lon = Number(pair[0]);
      var lat = Number(pair[1]);
      if (!isFinite(lon) || !isFinite(lat)) continue;
      sumX += lon;
      sumY += lat;
      count++;
    }
    return count ? [sumX / count, sumY / count] : null;
  }

  // The street, house number and city to put in the address, per feature type.
  // Both come from the SDK, which is the only place a segment's city exists at all and the
  // same place the editor reads a venue's address from: `Segments.getAddress()` and
  // `Venues.getAddress()` both return an address object with `street`, `city` and `state`
  // (the venue one adds `houseNumber`).
  // A venue's fields are often left untouched, and WME then reports them as "None" - so a
  // venue without a street does not block the parts the ward polygon does know; the card just
  // omits the absent part, exactly as it already does for a nameless street.
  // The venue's own NAME is read as well: it is what a place is, and a venue with no street
  // filled in would otherwise lead the address with nothing.
  function postalAddressNames(target) {
    var names = { street: '', houseNumber: '', city: '', name: '' };

    if (target.kind === 'segment') {
      var segmentNames = postalSegmentAddress(target.segment);
      names.street = segmentNames.street;
      names.city = segmentNames.city;
      return names;
    }

    names.name = postalRealName(target.venue.name);
    var venueAddress = postalVenueAddress(target.venue);
    names.street = venueAddress.street;
    names.houseNumber = venueAddress.houseNumber;
    names.city = venueAddress.city;
    return names;
  }

  /** Builds and places the card for the current selection (or removes it). */
  function postalUpdateAddressCard() {
    // Two conditions, ANDed - both must hold or there is no card:
    //   1. the "Show postal card address" switch is on, and
    //   2. a Nepal GIS ward (NP_W_*) KML layer is loaded, which is the only layer the
    //      postal code is read from.
    // So an on switch with no ward loaded shows nothing, and a loaded ward with the switch
    // off shows nothing either. Any card left from the previous selection goes with it.
    // The Lalitpur HN ward group is NOT part of this test: it is a different dataset whose
    // polygons carry none of the fields the code is derived from.
    if (!postalCardEnabled || !postalHasWardLayer()) {
      postalRemoveAddressCard();
      return;
    }

    // Segment or place - both have a Waze address, so both get a card when they resolve.
    var target = postalResolveTarget();
    if (!target) {
      postalRemoveAddressCard();
      return;
    }

    var editPanel = postalEditPanel();
    if (!editPanel) {
      // The panel is rendered asynchronously. Retry briefly rather than giving up, or the
      // card would stay missing until the next selection change.
      if (postalAddressRetry < 5) {
        postalAddressRetry++;
        postalScheduleAddressCard(150);
      }
      return;
    }
    postalAddressRetry = 0;
    // The panel exists now, so it can be watched for the re-render the address editor does.
    postalEnsureAddressObserver();

    // The point the card's ward is picked from: a segment's midpoint, a venue's own position.
    var point = null;
    if (target.kind === 'segment') {
      var coordinates = target.segment.geometry.coordinates;
      var mid = coordinates[Math.floor(coordinates.length / 2)] || coordinates[0];
      point = [Number(mid[0]), Number(mid[1])];
    } else {
      point = postalVenuePoint(target.venue);
    }

    // The ward under that point, then everything read from it - the polygon decides the code
    // for a place exactly as it does for a segment. A place that is not inside a loaded ward
    // has no code to show; it may still have an address worth copying (see below).
    var ward = point ? postalWardAtPoint(point) : null;
    var properties = (ward && ward.properties) || null;

    var names = postalAddressNames(target);
    // The Waze city is read here rather than further down because the address needs it
    // too: the sheet's Waze City Name is the sub-city of the ward, so it is inserted in
    // front of the ward part (see postalSubCityName) when the "Combine the sub-city in
    // the address" switch is on. The sheet lookup is shared with the warning below.
    var cityName = names.city;
    var sheetRow = properties ? postalLookupProperties(properties) : null;
    var subCity = postalSubCity && postalIsSubCity(cityName, sheetRow) ? cityName : '';

    // The ward-derived wording for this feature, or '' when the feature is not in a loaded
    // ward. Shared by the address and the tooltip so the two can never disagree.
    var middle = postalAddressMiddle(properties);
    var code = postalDisplayCode(properties);

    // Google's own address is deliberately NOT read or shown. It is frequently wrong for these
    // places - the example that prompted dropping it was a Google place whose address control
    // read "गढीमाई, मधेश प्रदेश 44400, Nepal" while the ward it actually sits in is Jitpur
    // Simara-2 - and the card exists to be copied into WME's address field, so a wrong address
    // leading it is worse than no card. The ward polygon is the authority, and the SDK's own
    // address fields are the fallback; a Google place that is not inside a loaded ward simply
    // gets the "not inside a loaded ward" note and no address to copy.
    var placeStreet = [names.houseNumber, names.street].filter(Boolean).join(' ')
      || (target.kind === 'venue' ? names.name : '');

    var parts = [];
    if (middle || code) {
      // Everything the ward polygon knows, in the community's order.
      parts = [placeStreet, subCity, middle, code, 'Nepal'];
    } else if (placeStreet || names.city) {
      // No ward, but the feature does carry a Waze address: show that rather than nothing, and
      // let the warning below say why the code is missing.
      parts = [placeStreet, names.city, 'Nepal'];
    }
    var fullAddress = parts.filter(Boolean).join(', ');

    // The card is REUSED and refilled, never rebuilt: rebuilding tore the copy button out
    // from under the pointer (so a click missed and the label flickered) and, because
    // removing and re-adding the card is itself a childList mutation, fed the panel
    // observer into scheduling the next rebuild.
    var card = document.getElementById(POSTAL_ADDRESS_CARD_ID);
    if (!card) {
      card = npwCreate('div', 'npw-address-card');
      card.id = POSTAL_ADDRESS_CARD_ID;
    }

    // ONE compact row: a postal envelope icon, the address, and the copy button. The
    // ward/code detail is a tooltip rather than a line of its own, which is what keeps
    // the whole thing to a single line above the address inputs.
    var row = card.querySelector('.npw-address-row');
    if (row) {
      // Only the text is written - the row and its button stay exactly where they are.
      row.querySelector('.npw-address-value').textContent = fullAddress;
    } else {
      row = npwCreate('div', 'npw-address-row');
      // An icon instead of the word "Postal": less width, and it means the same thing in
      // any editor language. Inline SVG (static markup, no data interpolated) so it
      // inherits the accent colour through currentColor - an emoji would not.
      var icon = npwCreate('span', 'npw-address-icon');
      icon.title = 'Postal address';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML =
        '<svg viewBox="0 0 16 16" width="13" height="13" focusable="false">' +
        '<rect x="1.4" y="3.4" width="13.2" height="9.2" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
        '<path d="M2 4.3 8 8.6l6-4.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
        '</svg>';
      row.appendChild(icon);
      row.appendChild(npwCreate('span', 'npw-address-value', fullAddress));
      var copyBtn = npwButton(null, 'Copy', 'Copy this address to the clipboard', 'primary', 'npw-address-copy');
      row.appendChild(copyBtn);
      card.appendChild(row);
      // Bound once, on the node that now outlives every refill. The text is read from the
      // card at click time rather than closed over, so it can never copy a stale address.
      copyBtn.addEventListener('click', function () {
        var value = card.querySelector('.npw-address-value');
        value = value ? value.textContent : '';
        if (!value) return;
        navigator.clipboard.writeText(value).then(function () {
          copyBtn.textContent = 'Copied';
          setTimeout(function () {
            // Only restore the face of a button still showing this result, so a slow copy
            // cannot overwrite the label of a card that has since been refilled.
            if (copyBtn.textContent === 'Copied') copyBtn.textContent = 'Copy';
          }, 1500);
        }).catch(function (e) {
          // writeText REJECTS rather than throws, so the catch belongs on the promise.
          console.warn(scriptName + ': clipboard copy failed', e);
        });
      });
    }
    // Only the warning lines are rebuilt; the row above is left where it is.
    card.querySelectorAll('.npw-address-warn').forEach(function (warn) {
      warn.remove();
    });

    // The tooltip is written only on a real change: reassigning title on the card under the
    // pointer re-opens its tooltip, which reads as a flicker even though nothing moved.
    var tooltip = '';
    if (properties && properties.postal_code) {
      var stateLabel = postalStateNameOf(properties) || properties.postal_state || '';
      tooltip =
        (target.kind === 'venue' ? 'Place — ' : '') +
        'Ward ' +
        (properties.ex_new_ward_n !== undefined && properties.ex_new_ward_n !== null
          ? properties.ex_new_ward_n
          : '?') +
        ' — city code ' +
        properties.postal_code +
        (properties.postal_ward_code ? ' — ward code ' + properties.postal_ward_code : '') +
        (stateLabel ? ' — ' + stateLabel : '');
    } else {
      // Worth the extra line only when there is nothing to show: without it an absent
      // code would just look like a broken card.
      card.appendChild(
        npwCreate(
          'div',
          'npw-address-warn',
          (target.kind === 'venue'
            ? 'No postal code: this place is not inside a loaded ward polygon. '
            : 'No postal code: this segment is not inside a loaded ward polygon. ') +
            'Tick the Ward level in the ' +
            'Layers tab and zoom in to 14+ (see the Postal Codes card in Settings).'
        )
      );
    }
    if (card.title !== tooltip) card.title = tooltip;

    // The Waze city is reported as a CHECK against the sheet, and never decides the code.
    // Both values were already read above; only the sub-city DECISION is shared, and the
    // sentence itself is deliberately not gated on the "Combine the sub-city" switch,
    // because the disagreement is worth knowing about either way.
    if (postalIsSubCity(cityName, sheetRow)) {
      card.appendChild(
        npwCreate(
          'div',
          'npw-address-warn',
          'Waze city is "' + cityName + '" but the sheet lists "' + sheetRow.wazeCity + '" for this ward.'
        )
      );
    }

    // Inside the address view for either panel type - see postalPlaceAddressCard.
    postalPlaceAddressCard(card);
  }

  // The edit panel is rendered asynchronously after the selection event, so every pass
  // is deferred - and debounced, because a multi-click selection change fires it often.
  // A call WITHOUT a delay is a fresh trigger (and clears the retry budget); the internal
  // retries pass an explicit delay so they do not reset it.
  function postalScheduleAddressCard(delayMs) {
    if (delayMs === undefined) postalAddressRetry = 0;
    clearTimeout(postalAddressTimer);
    postalAddressTimer = setTimeout(function () {
      postalAddressTimer = null;
      try {
        postalUpdateAddressCard();
      } catch (e) {
        console.warn(scriptName + ': could not build the postal address card', e);
      }
    }, delayMs === undefined ? 150 : delayMs);
  }

  // Opening the address editor on an already-selected segment is WME's own business, and it
  // re-renders the panel without changing the selection or opening the editor - so no event
  // the script subscribes to fires, and the card keeps whatever position the previous
  // render gave it. Watching the panel's subtree closes that gap: any re-render re-runs the
  // placement, which is idempotent (the card is only ever inserted before the
  // alternate-addresses block, and WME removing or replacing that block simply lets the
  // observer put the card back).
  //
  // The callback does no DOM work of its own - it debounces into postalScheduleAddressCard -
  // so the observer can never feed itself into a loop, and the node count is never read.
  var postalAddressObserver = null;
  function postalEnsureAddressObserver() {
    if (postalAddressObserver || typeof MutationObserver !== 'function') return;
    var target = postalEditPanel();
    if (!target) return;
    postalAddressObserver = new MutationObserver(function () {
      postalScheduleAddressCard(60);
    });
    postalAddressObserver.observe(target, { childList: true, subtree: true });
  }

  // Function to create a feature-layer SDK layer. Today this is the LMC ward address
  // points and boundary; any future importer (KML, GPX, ...) that produces GeoJSON
  // features can call it with its own layer name and type.
  function createGeoJSONLayer(geojsonData, layerName, wardNo, layerType) {
    try {
      layerType = layerType || 'buildings';

      // Register this layer's mutable style state before the SDK builds the style
      // context: the getters close over it, so the Style Settings card can restyle the
      // layer later with redrawLayer() alone.
      writeLayerStyleState(layerName, resolveStyleValues(rawStyleValues(layerName)));
      applyLayerStyleAugment(layerName);

      console.log(`${scriptName}: Creating ${layerType} SDK layer for Ward ${wardNo}`);
      console.log(`${scriptName}: GeoJSON data:`, geojsonData);

      // Ensure we have valid GeoJSON
      if (!geojsonData || !geojsonData.features || geojsonData.features.length === 0) {
        throw new Error('No features in GeoJSON data');
      }
      
      // Parse GeoJSON - convert string to object if needed
      const geojson = typeof geojsonData === 'string' ? JSON.parse(geojsonData) : geojsonData;
      
      // Remove Z coordinates (elevation) from all features as OpenLayers 2 doesn't handle 3D coordinates well
      geojson.features.forEach(feature => {
        if (feature.geometry && feature.geometry.coordinates) {
          feature.geometry.coordinates = removeZCoordinates(feature.geometry.coordinates);
        }
      });
      
      console.log(`${scriptName}: Processing ${geojson.features.length} features from GeoJSON (Z-coordinates removed)`);
      
      // Build SDK features. A SdkFeature id is required, and the GeoJSON properties
      // are kept as they are - they carry the fields the label is built from.
      const sdkFeatures = [];
      geojson.features.forEach((feature, index) => {
        if (!feature || !feature.geometry) return;
        const properties = feature.properties || {};
        if (layerType === 'buildings') {
          // Create a custom label by filtering out null/undefined values
          const labelParts = [];
          if (properties.metric_num !== null && properties.metric_num !== undefined) {
            labelParts.push(properties.metric_num);
          } else {
            // If metric_num is not available, skip the rest
            properties.custom_label = '';
          }
          if (labelParts.length > 0) {
            if (properties.rd_naeng !== null && properties.rd_naeng !== undefined) {
              labelParts.push(properties.rd_naeng);
            }
            if (properties.rd_nanep !== null && properties.rd_nanep !== undefined) {
              // Convert Preeti font to Unicode
              const unicodeText = typeof preeti === 'function' ? preeti(properties.rd_nanep) : properties.rd_nanep;
              labelParts.push(unicodeText);
            }
            if (properties.tole_ne_en !== null && properties.tole_ne_en !== undefined) {
              labelParts.push(properties.tole_ne_en);
            }
            properties.custom_label = labelParts.join('\n');
          }
        } else if (layerType === 'ward') {
          // Nepal GIS ward KML. GeoKMLer prefixes every <SimpleData> name with "ex_",
          // so the ward title is ex_Address ("Bhaktapur-9, BHAKTAPUR, BA"). The label
          // comes from custom_label, which is what buildLayerStyleContext reads.
          const wardTitle = properties[NP_GIS_LABEL_FIELD];
          properties.custom_label =
            wardTitle === null || wardTitle === undefined ? '' : String(wardTitle);
          // Postal codes for this ward when the sheet is already in memory. If it is
          // not, postalApplyToLoadedLayers() annotates this layer the moment it arrives.
          postalAnnotateFeature(properties);
        }
        // Precompute the bbox the view windowing compares against (see windowLayerFeatures)
        const featureBboxBox = lmcBboxOfCoordinates(feature.geometry.coordinates);
        if (featureBboxBox) properties.__bbox = featureBboxBox;
        sdkFeatures.push({
          id: layerName + '_' + index,
          type: 'Feature',
          geometry: feature.geometry,
          properties: properties,
        });
      });

      console.log(`${scriptName}: Prepared ${sdkFeatures.length} SDK features (Z-coordinates removed)`);

      if (sdkFeatures.length === 0) {
        throw new Error('No valid features could be parsed from GeoJSON');
      }
      
      // Declarative SDK styling. The structure comes from the layer type and every
      // value from the layer's style state (see buildLayerStyleRules /
      // buildLayerStyleContext), which is what the Style Settings card drives.
      const layerConfig = {
        layerName: layerName,
        zIndexing: true,
        styleRules: buildLayerStyleRules(layerType),
        styleContext: buildLayerStyleContext(layerName, layerType),
      };

      wmeSDK.Map.addLayer(layerConfig);

      // Bulk load - the GeoJSON was already parsed, so validation is skipped on purpose.
      // With the view filter on, only the features inside the padded view go on the layer
      // now; windowLayerFeatures() then tops the layer up as the map is panned.
      const initialViewBox = lmcViewFilterEnabled ? paddedViewBox() : null;
      const featuresOnLayer = initialViewBox
        ? sdkFeatures.filter(function (feature) {
            const box = featureBbox(feature);
            return !box || lmcBboxesIntersect(initialViewBox, box);
          })
        : sdkFeatures;
      if (initialViewBox) {
        const initialLayerIds = {};
        featuresOnLayer.forEach(function (feature) {
          initialLayerIds[feature.id] = true;
        });
        lmcLayerWindows[layerName] = { box: initialViewBox.slice(), ids: initialLayerIds };
      } else {
        delete lmcLayerWindows[layerName];
      }
      if (featuresOnLayer.length > 0) {
        wmeSDK.Map.dangerouslyAddFeaturesToLayerWithoutValidation({ features: featuresOnLayer, layerName: layerName });
      }
      wmeSDK.Map.setLayerVisibility({ layerName: layerName, visibility: true });
      console.log(`${scriptName}: Added ${featuresOnLayer.length} of ${sdkFeatures.length} features to SDK layer ${layerName}`);

      // z-index based on layer type - boundaries below buildings
      wmeSDK.Map.setLayerZIndex({
        layerName: layerName,
        zIndex: layerType === 'boundary' ? ZIndexes.popup + 5 : ZIndexes.popup + 10,
      });

      // Store reference for cleanup and shifting
      loadedGeoJSONLayers.push({
        name: layerName,
        sdkFeatures: sdkFeatures,
        wardNo: wardNo,
        layerType: layerType,
      });

      // A ward polygon has just landed: the address card can now resolve a code, so it is
      // rebuilt straight away (it is hidden while no ward is loaded - see postalUpdateAddressCard).
      postalNotifyWardLayersChanged();

      // Update layer selector dropdown
      updateGeoJsonLayerSelector();
      
    } catch (error) {
      console.error(`${scriptName}: Error creating GeoJSON layer:`, error);
      WazeToastr.Alerts.error(
        scriptName,
        `Failed to create GeoJSON layer: ${error.message}`,
        false,
        false,
        5000
      );
      throw error;
    }
  }

  // "Clear auto-loaded layers" lives on the ward group card (clearLmcViewportLayers),
  // which removes every loaded feature layer through removeLmcLayer().

    function scriptupdatemonitor() {
  if (WazeToastr?.Ready) {
    // Create and start the ScriptUpdateMonitor
    const updateMonitor = new WazeToastr.Alerts.ScriptUpdateMonitor(scriptName, scriptVersion, downloadUrl, GM_xmlhttpRequest);

    // Check immediately on page load, then every 2 hours
    updateMonitor.start(2, true); // checkImmediately = true

    // Show the update dialog for the current version
    WazeToastr.Interface.ShowScriptUpdate(scriptName, scriptVersion, updateMessage, downloadUrl);
  } else {
    setTimeout(scriptupdatemonitor, 250);
  }
}
  function bootstrap() {
    wmeSDK = unsafeWindow.getWmeSdk({ scriptId: 'nepali-gis-layers', scriptName });
    console.log(`${scriptName} initialized.`);
    scriptupdatemonitor();
    // SDK event bus (replaces document.addEventListener('wme-map-data-loaded', ...)).
    // Resolves once map data has been fetched; runs init exactly once.
    wmeSDK.Events.once({ eventName: 'wme-map-data-loaded' }).then(init);
  }

  unsafeWindow.SDK_INITIALIZED.then(bootstrap);
  /*
   * The version history used to live here as a ~350-line comment block. It now lives in
   * CHANGELOG.md next to this script - nothing read it at runtime, and the update dialog
   * is driven by @version, not by that text.
   */
})();
