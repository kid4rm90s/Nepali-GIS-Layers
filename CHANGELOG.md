# Changelog - Beta / Nepali WMS layers

Version history, newest first.

Moved out of the userscript in `2026.09.20.023` - the block was ~350 lines (~4.5% of the
file) and nothing read it at runtime. `GM_info.script.version` drives the update dialog,
not this file.

> **Note:** entries up to `2026.09.20.022` were originally written to be shown inside a
> WazeToastr dialog, which wraps every highlighted term in `<strong>`, `<em>` or `<code>`.
> Those are rendered as Markdown emphasis here; the wording is unchanged. Entries from
> `2026.09.20.023` onward were written as Markdown.


## 2026.09.20.024

**Changed - the update dialog now describes the feature set, not a changelog:**
- `updateMessage` had described only the Postal Codes work, which shipped before `2026.09.20.010` and so was not new to anybody. It is now a plain-language list of what the script does today, in the order a user meets it: the postal address card on segments and venues, the tabbed sidebar (opacity, groups, checkboxes), the WME SDK conversion, the single shift control, the label-field picker, the styling card, the auto-loading ward layers, and the address/map fixes.
- Written for an END USER: no `IndexedDB`, no `postal_ward_code`, no `styleContext`. The only technical detail kept is the one caveat a user has to know - WMS tile layers still run on OpenLayers 2, because the SDK has no WMS layer type **yet**. That claim matches what the code does today (`new OL.Layer.WMS(...)` in `addNewLayer`), but it is the one line here that will go stale the moment the SDK gains WMS support, so re-check it when that lands.
- The message spans several concatenated string literals rather than one long line. Every part is still a plain string with no interpolated values, so nothing can throw at the point the dialog is shown.
- `ShowScriptUpdate` is unchanged and still called from `scriptupdatemonitor()` with the same four arguments (`scriptName`, `scriptVersion`, `updateMessage`, `downloadUrl`).

## 2026.09.20.023

**Changed - the file is ~430 lines shorter and the version history moved out (no behaviour change):**
- The `/* changeLog ... */` comment block was **350 lines - about 4.5% of the file** - and nothing read it at runtime. The update dialog is driven by `GM_info.script.version`, not by that text, so the history now lives in `CHANGELOG.md` beside the script and the block is replaced by a five-line pointer.
- **31 multi-line `/** ... */` JSDoc blocks were converted to runs of `//` lines.** Every word was kept, including the `@param` / `@returns` tags: VS Code reads those from a `//` run directly above a function, so hover text and call-site type checking are unaffected, and the type information stays available to anyone (or anything) reading the file. Only the `/**`, the leading ` * ` and the closing `*/` were dropped - 88 lines of comment scaffolding.
- Four functions gained full documentation as part of the same pass, chosen because their behaviour is not visible from the call site: `setZOrdering` (returns a function rather than applying anything), `getUrl4326` and `getFullRequestString4326` (**OpenLayers 2 method overrides** - nothing in the script calls them, and they read `this.projection` / `this.epsg4326` off the layer), and `fetchHttpTile` (callback-based by necessity, and de-duplicates in-flight requests per URL).
- **The 54 functions left undocumented were left deliberately.** They are self-evident one-liners (`styleDbGet`, `lmcUnionBbox`, `postalClearCached`), where a comment would only restate the name - and padding the file with those makes the comments that carry real warnings harder to find. The `// Do not negate dx here` note, which documents a shift-direction bug that has already been fixed and re-broken once, is only conspicuous because not everything is commented.
- Verified as a comment-only change: with all comments stripped, the code is **identical token-for-token (21,893 tokens)** before and after. `node --check` exits 0.
- `@connect *.googleusercontent.com` was removed from the header. It was added speculatively for the postal sheet on the theory that Google might redirect an export, and **nothing ever used it** - the only sheet request goes to `docs.google.com`, which is covered by its own entry. An unused `@connect` only widens the permission prompt a new user sees.

## 2026.09.20.022

**Fixed - the previous version broke start-up with "(intermediate value).catch is not a function":**
- Wrapping the database open in an async function to run the stale-database check first left the wrapper *uncalled*: `(async function () { ... })` is a function expression, and the `.catch(...)` chained onto it was being read as a property of that function rather than of a promise. The result was an `TypeError` the moment `loadFeatureStyles` ran from `init`, which is the very first thing start-up does.
- The fix is the missing invocation pair: `(async function () { ... })()`. The promise the async function returns is what carries `.catch`, so the "IndexedDB is unavailable" fallback now attaches to a promise as intended and a failure to open degrades to no persistence instead of aborting start-up.
- Worth noting `node --check` passed on the broken version - it is a valid parse, so the syntax check could not catch it. Only running the code shows up a call that never happens.

## 2026.09.20.021

**Changed - the postal-sheet write now closes its transaction explicitly:**
- The postal sheet is the largest thing this script caches - a row per ward, each with several fields - and it was written through the ordinary put path, which leaves the engine to decide when the transaction is finished. `styleDbRequest` now takes a third argument that calls the IndexedDB 3 `IDBTransaction.commit()` the moment the put reports success, so the transaction closes instead of waiting on the microtask queue for work that is never going to arrive.
- It is deliberately **one write, not all of them**. The style and bounding-box records are a handful of small objects where the queued work is genuinely still coming, and calling `commit()` there would trade nothing for the risk of cutting a transaction short. Only the postal sheet has the volume to gain.
- Guarded the same way as the rest of the IndexedDB code: `commit()` is checked for before being called and is skipped on an engine without it (it is Chrome 76+/Firefox 74+/Safari 15+), so the transaction closes on its own exactly as before. A `commit()` that throws because the transaction is already closing is swallowed - that is the outcome it was asking for.
- The write no longer routes through `styleDbPut` because that helper has no way to express the option; it calls `styleDbRequest` directly and stores the same `{ key, style }` shape as before, so the record it writes and the record `postalLoadCached` reads back are unchanged.

## 2026.09.20.020

**Changed - the IndexedDB cache now uses two IndexedDB 3 features:**
- **`durability: 'relaxed'` on every transaction.** Everything this script persists is a cache - the feature styles, the LMC ward bounding boxes and the postal sheet are all re-derivable, and the postal entry even carries its own 24-hour TTL. The spec names exactly this case, encouraging `relaxed` for "ephemeral data such as caches or quickly changing records": a relaxed commit returns once the data has reached the OS instead of waiting for a flush to disk, and the stricter default buys nothing here.
- The option is **probed once**, not assumed. `idbSupportsDurability()` opens a throwaway database, reads `transaction.durability` back and deletes it, so an engine that silently ignores the dictionary falls back to the engine default rather than depending on unchanged behaviour. The result is cached and the probe database is removed either way.
- **`indexedDB.databases()` to detect a stale copy of our own database.** The styles store is shared by three different kinds of record, so a change to its shape needs to be able to start clean instead of reading records it can no longer interpret - and without `databases()` the only way to spot that is to open the database and inspect it. `idbListDatabases()` probes for the method first and resolves `null` where it is missing (Firefox below 126, Safari below 14), and every caller treats the result as optional.
- **Nothing is deleted on a guess.** `idbDropStaleStores()` acts only when the name matches this script's own database exactly *and* the version is older than this build expects. A newer version is deliberately left alone because a newer build owns it, and another script's database - `GeometryLayersDB` from WME GeoFile, which holds user-imported layers - can never match. A delete blocked by another tab holding the database open resolves quietly; the cache is rebuilt on the next fetch regardless.
- Cleanup runs inside `openStyleDb()` before the open, wrapped so it cannot throw and cannot block: it is a convenience, never a precondition. On an engine without either feature the whole change is inert and the previous behaviour is preserved exactly.

## 2026.09.20.019

**Fixed - a group's opacity slider was remembered but never re-applied:**
- The slider *saved* its value on every move and read it back to position itself after a refresh - but nothing ever pushed that value onto the layers, so every layer came back at OpenLayers' default opacity (1.0) while the slider still sat at the saved position. The panel and the map disagreed, and only moving the slider again had any effect.
- The write half now exists: `applyStoredCategoryOpacity(toggler)` reads the group's remembered value and applies it, and it is called from `applyLayerTogglerVisibility` whenever a layer is attached. It runs *before* `setVisibility(true)`, so the first painted tile is already at the right opacity rather than flashing at full strength.
- The value is also pushed onto the layers while the card is being built, which covers a layer that was attached before the card existed - an auto-loaded ward group, or a layer restored during start-up.
- The group key is the toggler's own `groupName`, the same field `buildLayerCategoryPanels` groups by, so the slider and the apply path cannot disagree about which store to use.
- A group with no stored value is deliberately left alone instead of being forced to 1, so a layer whose opacity is set elsewhere (the Style Settings card) is not overridden by a default here. The per-layer loop is now the shared `setTogglerOpacity` helper, replacing the inline copy in the slider handler.

## 2026.09.20.018

**Changed - the localStorage layer is now four helpers and one key registry (no behaviour change):**
- The same `try { JSON.parse(localStorage.getItem(KEY) || '{}') } catch {}` shape was written out in nine separate save/load pairs. It is now `npwLoadJson` / `npwSaveJson` (object stores), `npwLoadEntry` / `npwSaveEntry` (one key inside a shared object store), and `npwLoadString` / `npwSaveString` (bare string preferences, which the sub-tab and master toggle use). All six swallow a corrupt entry, disabled storage or exceeded quota, so no caller needs its own try/catch.
- Folded onto them: the LMC ward state, Nepal GIS state, postal switch state, remembered sub-tab, card collapse state, master toggle, per-category opacity, per-layer offsets, and the legacy `WMSLayers` toggler state. **Every key string is unchanged**, so existing saved preferences are picked up exactly as before - the ten keys were diffed after the change to confirm it.
- Two stores deliberately keep their own `console.warn` and so kept their own try/catch: the saved shortcut keys and the layer toggler states. Both hold work the user did elsewhere (WME's keyboard-shortcut settings, their layer selection) that the script cannot rebuild, unlike a panel toggle it can simply re-derive.
- A `NPW_STORAGE` table near the top now lists every key with the shape of its value, so the storage surface is readable in one place rather than searched for over 7000 lines.
- Also removed a **duplicated function**: `postalRemoveAddressCard` was declared twice with byte-identical bodies, so the first was dead code that the second silently shadowed. Behaviour is unchanged - the survivor is the one that was already taking effect.

## 2026.09.20.017

**Removed - Google place support:**
- The address Google carries is not reliable for these places, and the panel gives no way to know whether the text it shows belongs to the ward the place actually sits in. Since the card exists to be copied straight into WME's address field, showing it was worse than showing nothing.
- Removed with it: `postalGooglePlaceAddress` and the shadow-DOM read it needed, the `googleAddress` field on the names object, the branch that printed Google's address as the whole card, the warning that flagged it as Google's, and the `[data-testid="google-place-address-control"]` placement path. `googlePlace` is also gone from the editor-opened handler, so selecting a place now drops a card left over from the previous segment instead of building one.
- A Google place that is not inside a loaded ward gets no address to copy, and the card says so. A segment or venue outside every loaded ward still shows its own Waze address, unchanged.

## 2026.09.20.016

**Fixed - Google's own address no longer leads the card:**
- A Google place's address text is frequently WRONG for these places: the case that prompted this is a Google place whose address control reads *à¤—à¤¢à¥€à¤®à¤¾à¤ˆ, à¤®à¤§à¥‡à¤¶ à¤ªà¥à¤°à¤¦à¥‡à¤¶ 44400, Nepal* while the ward it actually sits in is Jitpur Simara-2. It was being used as the street part whenever the feature had no street of its own, which pushed a wrong address to the front of a single line the user copies and pastes straight into WME.
- The ward's address is now built from the ward polygon alone. Google's text is never mixed into it: the leading part is the place's own house number / street (or its name), and nothing else.
- When there is no loaded ward and no Waze street either, Google's text is all there is, so it is still shown - on its own, with a warning that it is Google's and often wrong, and that ticking the Ward level and zooming to 14+ will produce the ward-derived address instead.

## 2026.09.20.015

**Fixed - a Google place panel has no address view, and its address must be read through the shadow DOM:**
- A Google place renders into `#edit-panel`, and the hashed `googlePlaceFeatureEditor--â€¦` class is a wrapper INSIDE it - not a panel root. So the panel lookup needs only the two ids, and `#edit-panel` already covers a Google place.
- That panel has NO `.address-edit-view` at all: the address is a plain `.form-group` around `[data-testid="google-place-address-control"]`. The card is now placed directly beneath that control's block, which is the same reading position the address view gives on the other panels.
- The address itself was being read with `textContent`, which returns only the control's light-DOM labels (*Address*, *No suggestions*) - the value lives two shadow roots down, in `wz-autocomplete &gt; #shadow-root &gt; wz-text-input[value]`. It is now read from the reflected `value` attribute first, then the inner `wz-text-input`'s value, then a plain `input` in the shadow root.
- Verified against a real Google place whose address is Devanagari (*à¤—à¤¢à¥€à¤®à¤¾à¤ˆ, à¤®à¤§à¥‡à¤¶ à¤ªà¥à¤°à¤¦à¥‡à¤¶ 44400, Nepal*): that text is copied verbatim and is never title-cased, because the ward part title-casing is meaningless for Devanagari.

## 2026.09.20.014

**Changed - the venue support is down to a fraction of the code, and nothing was lost:**
- A venue panel's structure showed that its address block is `#venue-edit-general .address-edit-view` - the SAME container class a segment panel uses. The card therefore needs no per-feature-type selector list at all: one query for `.address-edit-view` under whichever panel id is open covers both.
- `postalPlaceAddressCard` lost the `addressViews` parameter, the selector loop, the `try/catch` per selector and the extra-anchor branch. It is now: find the address view, insert before `.alt-streets-control` inside it if there is one, otherwise append. Same result for both panel types.
- `postalEditPanel` lost the `[class*="googlePlaceFeatureEditor"]` lookup. A Google place uses the venue panel (`#venue-edit-general`, a plain id - the hash-suffixed class is an inner element, not the host), so the two-id form is sufficient.
- Removed with that: the hashed-class matching and the `venue-feature-editor` wrapper guesses, which were written for a panel host that turned out not to exist.

## 2026.09.20.013

**Fixed - a venue or place panel has no "Alternate addresses" block, so the card is placed in the address view instead:**
- Confirmed directly: with a place selected, `document.querySelectorAll('.alt-streets-control').length` is **0**. The block is a SEGMENT-panel control, and the card had been built and then deleted, because placement only knew how to insert before that block and the final fallback removes the card rather than leave it somewhere arbitrary.
- Placement now has two strategies: insert immediately BEFORE `.alt-streets-control` when the panel has it (unchanged for segments), otherwise append the card as the LAST child of the panel's address view. Last child, not first, so the card sits under the address fields instead of above them.
- The address-view selectors are supplied per panel type at the call site, so the venue list tries the panel's own address view first and only then the wrapper classes. The Google place address control is no longer needed as an anchor - the address view is a better boundary and it is what the card was always meant to sit inside.

## 2026.09.20.012

**Changed - the panel lookup was simplified back to one document-level pass:**
- WME does not put its feature editor behind a shadow root, so `#edit-panel`, `#venue-edit-general` and the Google place root are all reachable straight from the document. That is how WME POI Shortcuts selects venue controls (`document.querySelector('#venue-edit-general wz-text-input[name="name"]')`, and the same id is used for its autocomplete and multiselect lookups), which confirms it does not need walking into a wrapper.
- The wrapper-descendant pass and the `.venue-edit-view` guess added in .011 are gone. They were guessing at a cause that no longer holds, and two layers of fallback only make the real failure harder to see. `postalEditPanel` is now three lookups: `#edit-panel`, then `#venue-edit-general`, then the Google place root.
- The `venue-feature-editor` class you pointed out is the venue panel's parent wrapper, so the card's anchor scope list still uses it - matching a wrapper is harmless and costs one extra query when the panel id already matched.

## 2026.09.20.011

**Fixed - the venue panel is now found through its wrapper:**
- `#venue-edit-general` sits INSIDE `class="venue-feature-editor"`, and a WME feature editor is mounted in its own container - so the panel id was not resolvable from the document even though the panel was on screen. The lookup is now two passes: the panel by id/class from the document first, then again as a DESCENDANT of the editor's wrapper (`[class*="venue-feature-editor"]`, `[class*="googlePlaceFeatureEditor"]`, `.feature-editor-component`). Either pass returns a usable panel.
- The wrapper class is matched with the attribute-substring form for the same reason as the Google place root: its hash suffix changes between WME builds.
- If neither pass identifies the panel, the wrapper itself is returned rather than null, so the card is placed in the right editor instead of being discarded by the retry guard.
- The card's anchor scope list gained the `venue-feature-editor` variants alongside the existing `googlePlaceFeatureEditor` ones.

## 2026.09.20.010

**Added - the Google place panel is matched on its stable class prefix:**
- A Google place renders into its own root, `class="googlePlaceFeatureEditor--LQH5n"`. That trailing `--hash` is a CSS-modules build artifact, so it differs between WME builds and can change on any deploy - a class selector written against it would silently stop matching. The card now uses the attribute-substring form `[class*="googlePlaceFeatureEditor"]`, which matches the stable part and ignores whatever follows the double dash.
- It is wired in at both points, just like the venue id: the panel lookup (`postalEditPanel`, so the built card is not discarded by the retry guard) and the anchor scope list (so the card lands inside the Google place view rather than being appended to a parent).

## 2026.09.20.009

**Fixed - no card appeared when a place was selected:**
- WME renders a venue's editor into `#venue-edit-general`, not into `#edit-panel`, so the panel lookup failed for every place and the pass returned early before the card could be placed. The selection and the venue itself were resolving correctly - it was the DOM host that was never found.
- The panel is now looked up through one helper (`postalEditPanel`) that tries `#edit-panel`, then `#venue-edit-general`, then `.venue-edit-view`, and finally the generic `.feature-editor-component`. The card's own anchor search and the re-render observer use the same helper, so all three agree on which panel they are working in.

## 2026.09.20.008

**Changed - venue geometry and addresses are now read straight from the SDK:**
- The venue point is resolved from the venue object itself (`geometry` is exactly `Point | Polygon`, so there is no third case to guess at): a point uses its own coordinates, an area venue uses the centre of its ring. The old helper walked the geometry for a `MultiPolygon` and fell back to a ring's first vertex - shapes the SDK never returns, and a vertex that can be a spike.
- A place's house number is now part of the address: `Venues.getAddress()` returns a `VenueAddress`, which is the base address plus `houseNumber`, so the card writes *12 Ward Road, â€¦* rather than leaving the number out. A segment has no house number and is unaffected.
- A venue with no street of its own now falls back to its own `name` rather than an empty leading part - the name is what the place *is*, and it is the only label a Google place with nothing filled in has. Both come from the SDK, so nothing is read out of the panel except the Google address itself.
- `postalFeatureCentre` and `postalIsNoneName` were left over from the guessing approach and are gone; `postalRealName` already treats WME's `None` placeholder as empty.

## 2026.09.20.007

**Added - the address card now appears for places, not just segments:**
- Selecting a *venue* (which includes the imported *Google place* points, whose panel is the same venue panel) shows the card. Nothing about the resolution changed: the ward polygon under the feature still decides the code, so a place inside a loaded ward gets the same ward code a segment there would.
- A place has no city field of its own, so its street/city are read through `Venues.getAddress()` - the same shape `Segments.getAddress()` returns - and WME's `None` placeholder is filtered rather than printed. An area venue (a polygon) is tested from its geometry's centre, not its first vertex, so a concave shape cannot resolve to the wrong ward.
- A place OUTSIDE every loaded ward has no code, and rather than an empty card it now shows the address the Google place brings with it, read from `[data-testid="google-place-address-control"]` and copied verbatim: it is already a complete address (*NH01 - Mahendra Hwy, Pathlaiya, Nepal*), so nothing is appended to it. A venue with only a Waze street/city falls back to that.
- Placement for a place panel anchors to that same address control, because a place panel has no alternate-addresses block; the block is still preferred wherever a panel has one.
- The card is one shared builder for both feature types (`postalResolveTarget` + `postalAddressNames`), so the two panels cannot drift apart in formatting, tooltip or warnings.

## 2026.09.20.006

**Fixed - the card stayed above the address card after the address editor was opened:**
- Opening the editor replaces the collapsed *full address* line with an expanding `wz-card.address-edit-card`, which moves *Alternate addresses* into that view. Nothing fires when that happens (no selection change, no editor-open event), so the card kept the position the previous render gave it - above the whole form.
- Placement is now its own helper, `postalPlaceAddressCard`, which searches for `.alt-streets-control` innermost-first (address view, then address card, then the panel) and always inserts relative to *that block's own parent*. It never appends to a container: if the block cannot be found the card is left alone rather than moved to the top.
- The edit panel's subtree is now watched with a `MutationObserver`, so the panel's own re-renders re-place the card. The callback only debounces into the existing scheduler (it does no DOM work of its own), so it cannot feed itself, and the card is only ever inserted - never re-added - which keeps it stable on WME's frequent re-renders.

## 2026.09.20.005

**Fixed - the address card could appear above the whole address form:**
- With the segment address editor open, the card was found at the very top of the panel, above the street/city/state/country card, instead of just above *Alternate addresses*. The anchor lookup was scoped to the whole edit panel, but the alternate-addresses block sits inside the address view (`.address-edit-view &gt; â€¦ .alt-streets-control`) - so when the panel-wide query missed it, the fallback appended the card straight to the panel, i.e. above everything.
- The anchor is now looked up innermost-first: `.address-edit-view .alt-streets-control`, then inside whichever address view or card was found, and only then panel-wide. A WME rename now leaves the card directly above the form it belongs to rather than above the entire panel.

## 2026.09.20.004

**Added - switch for the "Province" suffix (Settings tab):**
- Spreading out the province is now a choice, like the sub-city: the new *Combine Province in the address* switch on the Postal Codes card writes *Bagmati Province* when it is on and a bare *Bagmati* when it is off. On by default and remembered in `localStorage._wme_nepali_wms_postal` next to the other three postal switches; flipping it re-renders the card straight away.
- Both address forms honour it, because they now resolve the province through one shared helper: the *ex_Address* state-token expansion calls it for the trailing token, and the property-based path calls it for `ex_state_code` and `ex_Province`. A token the shared map does not know is still printed exactly as the KML wrote it, whichever way the switch is set - so *BA* never becomes *BA Province*.
- Still display-only: a matched feature's own `postal_state`, and therefore any label field built from it, keeps the bare name.

## 2026.09.20.003

**Changed - "Province" spelled out in the address card:**
- The province part of the card's address now reads *Bagmati Province* instead of a bare *Bagmati*, e.g. *Bhaktapur Sadak, Bhaktapur-9, Bhaktapur, Bagmati Province, 3070209, Nepal*.
- The suffix is only added to a name the shared code-to-name map actually resolved. A KML that carries a token the map does not know is still printed exactly as the KML wrote it, so *BA* never becomes *BA Province*.
- It is a **display-only** change: the mid-part of the card picks up both the full name and the suffix together, in the same single place. A matched feature's own `postal_state` - and therefore any label field built from it - still holds the bare name, so map labels and the internal comparisons are untouched.

## 2026.09.20.002

**Added - sub-city in the address card (Settings tab):**
- The address card now leads its ward part with the **sub-city**, so a segment in Pathlaiya reads *Pathlaiya, Jitpur Simara-1, Bara, Madhesh, 2070301, Nepal* instead of stopping at the ward. The *Waze City Name* column is what the sheet itself uses to say which Waze city a ward belongs to (its *City Name* column is the local unit), so that value - not the WME city - is the one inserted, which is exactly why the card already flagged the two as a mismatch.
- It is inserted **before the ward part**, because a Waze city such as *Pathlaiya* is an area / tole *within* the ward's local unit, not a second municipality - the address stays ordered largest-last, as a postal address is written.
- A new Settings switch, *Combine the sub-city in the address*, turns the insert off for anyone who wants the plain ward-level address; it is on by default and remembered in `localStorage._wme_nepali_wms_postal` next to the other two postal switches. Flipping it re-renders the card immediately.
- The insert only happens when the sheet names a Waze city for the ward *and* it differs from the segment's own city, so a segment whose city already matches the sheet gains no duplicated name. It is rendered exactly as the sheet writes it: a value carrying Devanagari is left as it is, and so is its casing.
- The "Waze city is ... but the sheet lists ..." note is unchanged in wording and still appears when the two disagree, whatever the new switch is set to: the mismatch is worth knowing about either way. The two now share one helper, so the inserted name and the note can never disagree about whether there is a sub-city at all.

## 2026.09.19.013

**Fixed - district casing in the address card:**
- The KML carries the district (and sometimes the local unit) in SHOUTING CASE, so the card read *Lalitpur-15, LALITPUR, Bagmati, 30802, Nepal* - a fully-cased street name and ward next to an all-caps middle. The district is now re-cased for display, giving *Lalitpur-15, Lalitpur, Bagmati, 30802, Nepal*. The re-casing covers the part before the state token in both address forms, so a municipality the KML shouts is tidied the same way.
- It is deliberately a **display-only** fix. The join, the district alias resolution and every comparison still use the original value, so nothing about the matching can shift because of a change of case - the helper is only ever reached from the address card.
- Words are capitalised individually (*RUKUM EAST* to *Rukum East*) and everything else is lower-cased first, so the result is stable no matter how the KML mixes its case.

## 2026.09.19.012

**Added - full state names (address card + postal properties):**
- A code to name map for the seven provinces, keyed on **both** spellings the data uses: the two-letter state token the ward KML carries in its address (*Bhaktapur-9, BHAKTAPUR, BA*) and the numeric *State Code* the sheet uses (1-7). *KO*=Koshi, *MA*=Madhesh, *BA*=Bagmati, *GA*=Gandaki, *LU*=Lumbini, *KA*=Karnali, *SU*=Sudurpashchim.
- The address card now ends its middle part with the **full province name** instead of the bare token: *Bagmati Sadak, Bhaktapur-9, BHAKTAPUR, Bagmati, 3070209, Nepal*. Only a trailing token that is actually in the map is expanded, so any address the KML spells differently is left exactly as it was.
- Matched features also gain **`postal_state`** (the full province name, taken from the row's own State Code through the same map, with the sheet's province column as the fallback), so it can be picked in the Style Settings *Label field* picker exactly like `postal_code`. The card tooltip names the province as well.
- The self-check now also verifies the **province digit**. The 7-digit code is 1+2+2+2 - province, district, municipality, ward (e.g. `2060105` = province 2, district 06, municipality 01, ward 05) - so the first digit of the 5-digit city code has to equal the row's own State Code. That is an independent check of the two keys the join is indexed on, not just of the derived ward suffix, and it is logged alongside the existing ward-1 comparison.

## 2026.09.19.011

**Added - postal codes on the loaded ward polygons (Settings tab):**
- A new **Postal Codes** card reads the published government address sheet and caches it in the same IndexedDB store the styles use, for 24 hours. *Load / Refresh* re-fetches on demand, *Clear cache* forgets the cached copy. The sheet is delivered as gviz JSON, which needs no API key and sends the Devanagari columns intact; the response's `O_o` wrapper is stripped before parsing.
- The sheet is **matched to the KML by its own fields** - `ex_state_code` + `ex_district` + `ex_gapa_napa` on a ward - never by the Waze city name. The *Waze City Name* column is kept for checking and display only, because the match has to work from what the polygon itself says.
- **Matching is layered, and exact beats fuzzy every time.** First a feature that carries its own postal code is resolved by that code alone; the municipality KML does (`ex_Code` is the sheet's *City Postal Code* verbatim, verified on every sampled municipality, and every sheet row's code is distinct). A ward KML has no such code, so it falls back to its local-unit name: exact, then through a fold of the common Nepali romanisation pairs (`ph`/`f`, `bh`/`b`, `v`/`w`, ... - which is what turns the tile's *Balefi* into the sheet's *Balephi*), and only then a fuzzy name match. Districts get the same treatment, so *CHITAWAN* resolves to the sheet's *CHITWAN*.
- The fuzzy step is deliberately the last resort: it is scoped to **one district** (a handful of candidates), and it must both clear a similarity floor and beat the runner-up by a clear margin. Anything less is left unmatched, because a wrong postal code is worse than none. Each load logs how many features matched by code, exact name, folded name and fuzzy match, so the balance is visible at a glance.
- Every matched ward feature gains `postal_code` (the sheet's 5-digit city code) and `postal_ward_code` (the **derived** 7-digit ward code - the city code plus the ward number padded to two digits, `10106` + ward 1 &rarr; `1010601`, which is the sheet's own convention). Both are ordinary properties, so they appear in the Style Settings *Label field* picker with no extra UI.
- **The ward code is derived, not parsed.** A ward outside the sheet's own *Ward Count* is left without a ward code rather than given a wrong one, and a feature that matches no row simply gets no postal properties - the join fails open.
- A **self-check** runs on every load: the derived ward-1 code is compared against the sheet's own *Ward Postal Codes* range cell and the match/mismatch count is logged to the console. If the government ever changes that convention, the count says so instead of the codes silently going wrong.
- The card also carries the two switches: *Use the 7-digit ward postal code* and *Load on start-up*, both remembered in `localStorage._wme_nepali_wms_postal`. A stale cache is preferred over an empty map when a refresh fails.
- Two `@connect` entries are added for the sheet (`docs.google.com`, and `*.googleusercontent.com` for a possible export redirect).
- **A postal address card in the segment edit panel.** Selecting a single segment adds a **one-line** card showing the community address format - *street, ward, postal code, Nepal* - with a Copy button, inserted **directly under the address inputs, above the *Alternate addresses* block**. The ward and code detail is a tooltip rather than a line of its own, so the card costs a single row and leads with a postal envelope icon instead of a label; only the "no postal code" / Waze-city notes add a second line, and only when they apply. The ward is resolved by testing the segment's midpoint against the loaded ward polygons (bounding box first, then a real point-in-polygon over the full feature set, so it still works while the view filter has most of them off the map). The card is rebuilt on every selection change and after a pan, because WME re-renders that panel on its own schedule. When no ward contains the segment it says so and names the fix, and the *Waze City Name* column is used only to flag a disagreement with the polygon's ward - it never decides the code.
- The card rides **`wme-feature-editor-opened`** as its primary trigger, not just `wme-selection-changed`. That event names the `featureType`, so a segment panel is handled as soon as it opens and a *venue* panel reliably drops a card left over from the previous segment instead of showing a stale address. `wme-selection-changed` stays as the fallback, because it also covers a selection change made while the panel is *already* open (which does not re-open it). A short, bounded retry covers the panel's asynchronous first render.
- The street and city come from `Segments.getAddress()` - the same resolved address the edit panel shows. This is the only way to get the city: the `Segment` object carries `primaryStreetId` but **no city id at all**, so an id lookup for it cannot work.

## 2026.09.19.010

**Added - per-level zoom gates and default labels (Nepal GIS Layers):**
- Each level now has its own zoom gate instead of one gate for all of them: **Province 8+, District 10+, Municipality 11+, Ward 14+**. A level below its gate is simply not fetched, and its already-loaded layers are *dropped again* - a gate that left its layers behind would not gate anything, and a province-wide view would otherwise keep every ward polygon it had ever loaded. Zooming back in re-creates them without a network request, because the parsed KMLs stay in the in-session feature cache.
- That gate eviction is deliberately immediate, with no padded viewport and no grace period, unlike the off-screen eviction, which keeps its hysteresis. Panning still never churns; only crossing a zoom gate does.
- The status line now reports the current zoom, the levels actually loading at it, and how many layers the gate just dropped. When nothing is allowed yet it names the zoom each ticked level needs, e.g. *Zoom 9 â€” Ward needs zoom 14+*.
- **A default label per level**, used while no label field has been chosen: Province `name`, District `district`, Municipality `${ex_Changed_Na}\n${ex_à¤¸à¥à¤¥}`. The ward level keeps its built-in `ex_Address` label, which is the one already carried by the KML.
- Those ride the existing per-layer style augment instead of a new code path: an empty `labelField` means "the layer type's built-in label", and for these levels the built-in label *is* the level default. A chosen property or *â€” No label â€”* is non-empty, so either one wins and survives the next style resolve. The Style Settings picker still reads *Built-in (layer default)* for them, which is exactly what the level default is.
- The municipality default reads two properties of the raw ArcGIS export, one of them a Devanagari `SimpleField` name. If that level comes out unlabelled, open Settings: the label-field attribute list shows the real property keys, and the same template can be pasted into the label box.
- Each level's tooltip now states its zoom gate and its default label.

## 2026.09.19.009

**Added - user-selectable label field (Style Settings):**
- Features can now be labelled from **any property the layer carries**, instead of only the label the layer type happens to build. A new *Label field* picker sits above *Stroke Color* and follows the same *Apply to* scope as every other control: *All layers (global)* or one specific layer, persisted in IndexedDB with the rest of the style.
- The picker lists the property keys of the selected scope, taken from the first feature of each loaded layer. `__bbox` (our windowing bookkeeping) and `custom_label` (the built-in label) are excluded, since neither is a meaningful label source.
- Underneath is a read-only **attribute list** showing `key: sampleValue` for the first feature. This is the point of the feature as much as the picker is: the municipality KML\'s attributes are raw ArcGIS names (`GAPA_NAP_2`, `GAPANAPA_1`, `GN_TYPE_13`, `DISTRICT_3`) plus one mojibake Devanagari field name, so choosing blind from 18 options was guesswork.
- **Both a property pick and a template.** Selecting a property fills the editable box below it, which stays editable, so one property (`district`) or a combination (`${district} - ${gapa_napa}`) both work. This is WME GeoFile\'s `${attr}` syntax - including the `\n` escape for a line break - but as a live setting rather than GeoFile\'s import-time modal. GeoFile *skips* that modal for transient layers (`fileObj.labelattribute || fileObj.transient`), and every layer our viewport loaders create is transient, so there is no import moment to ask at here.
- **The labelling gate moved into the getter.** `buildLayerStyleRules()` used to emit `label: traits.labelled ? '${getLabel}' : ''`, so for an unlabelled type the getter was never called at all and a chosen field would have silently done nothing. It now always routes through `getLabel`, which resolves the trait *and* the user\'s field - so the province, district and municipality levels are now labelable (e.g. `district`, or `${province}-${district}`) when they never could be before. The default is unchanged: with no field set, an unlabelled type still renders no label.
- The label text is produced by a getter, so a change needs no feature re-processing - it is applied with the existing debounced `redrawLayer()` path, exactly like a colour change.
- *â€” No label â€”* is available as an explicit choice, which is the only way to silence the built-in label on a labelled type (the ward `ex_Address`, or the building house-number label).
- The picker is rebuilt lazily: only when the Settings tab is actually active, plus once whenever it becomes active (a new optional `onShow` hook on `npwTabs()`). Rebuilding it on every layer add/remove would have meant hundreds of rebuilds during a panning pass at the 120-layer cap, on a tab nobody was looking at.

## 2026.09.19.008

**Changed - municipalities now load per local unit (Nepal GIS Layers):**
- The *Municipality* level reads the new per-local-unit KML manifest (`KML_Municipality/index.json` &rarr; `&lt;PROV&gt;/index.json` &rarr; `&lt;PROV&gt;/&lt;Municipality&gt;.kml`) instead of the per-district `outlines/&lt;PROV&gt;-&lt;DISTRICT&gt;.json`. Every local unit now carries **its own bbox**, so entering one municipality no longer downloads every municipality of its district: 730 files of ~13 KB instead of 77 district files of 56-220 KB.
- Layers are therefore one per local unit (`NP_M_BA_Bhaktapur`) rather than one per district, so eviction is per local unit too. `NP_GIS_MAX_LAYERS` is raised 60 &rarr; 120 to match, since this level alone can put many small layers in view at once and a dense view would otherwise evict and re-fetch them in a loop.
- Both KML tiers now share one cached fetcher and one batched downloader. The feature cache key is the full relative path, because a ward file and a municipality file can share a basename.
- Municipalities stay **unlabelled**: that tree is a raw ArcGIS export whose attribute names are unusable (`District_2`, `GAPA_NAP_2`, `GN_TYPE_13`, and one mojibake Devanagari field name), so only the geometry and the manifest bbox are read from it.
- **Provinces and districts are unchanged.** `KML_Province/&lt;PROV&gt;.kml` is deliberately NOT used: it is a province-wide *bundle of municipality polygons* (its schema is named `Nepal_Local_Level_Label`, 124 placemarks for Bagmati, 4.8-6.8 MB each) and not a province outline. The dissolved province geometry only exists in `outlines/province.json`, which covers all seven provinces in ~690 KB.

## 2026.09.19.007

**Added - province, district and municipality levels (Nepal GIS Layers):**
- The card now drives the **whole hierarchy** instead of wards only. Three new checkboxes - *Province*, *District*, *Municipality* - sit next to the ward level, each with a colour dot matching the stroke it draws. Ward stays the only level ticked by default, because the outline levels are wide fills that would hide the map if they came on unasked.
- Sources: `outlines/province.json` (7 dissolved provinces) and `outlines/&lt;PROV&gt;-&lt;DISTRICT&gt;.json`, which holds that district's own outline (`level: district`) plus one feature per local unit (`level: municipality`). Both tiers carry a bbox, so the existing two-stage viewport test is unchanged and a district file is only downloaded when one of its local units is in view.
- Only a stroke colour and a *relative* line weight are per level (province `#E53935` Ã—3, district `#FB8C00` Ã—2, municipality `#26C6DA` Ã—2, ward `#e100ff` Ã—1); every other style value still comes from the Style Settings card. A new per-layer style-augment hook (`layerStyleAugments`) re-applies the level colour and weight after every style resolve, so changing Line Size, Fill Opacity or the colours in Style Settings scales the hierarchy instead of flattening it back to one look. It also re-derives the *match stroke* sentinels, which would otherwise keep the base colour.
- Layer names carry the level: `NP_P_BA`, `NP_D_BA_BHAKTAPUR`, `NP_M_BA_BHAKTAPUR`, `NP_W_BA_BHAKTAPUR_Bhaktapur`. The outline levels are unlabelled (a dissolved province or municipality has no single name to show) and reuse the existing `boundary` feature type; only wards are labelled, from the KML's `ex_Address`.
- **Deliberate deviation from WME GeoFile:** that script keys a district layer by *province* and appends every visible district to it, which needs a parts-Set per layer and an append path that keeps its own feature store in sync. Here each outline file becomes its own layer per level, so a layer is always created whole and never appended to - eviction works per district rather than per province, and nothing has to be pushed into `loadedGeoJSONLayers` after creation.
- Outline files are flattened the same way as the ward KMLs: `province.json` ships two `MultiPolygon` features, and each split part gets its own properties object so the per-feature `__bbox` cannot be shared.
- Unticking a level removes that level's layers immediately; the ticked levels are remembered in `localStorage._wme_nepali_wms_np_gis` alongside the master and auto-remove switches.

## 2026.09.19.006

**Added - "Nepal GIS Layers" (Layers tab), ward auto-loader:**
- A new collapsible card loads the **ward polygons for the whole country** as they enter the map view, from the published `WME-Nepal-GIS-Layers` tile (GitHub Pages). Switch it on and every local unit in the view is fetched, drawn and labelled with the ward name the KML carries; the loaded layers are ordinary feature layers, so they appear in the Shifting dropdown and are restyled by the Style Settings card.
- Wards are discovered from the published manifests in two stages, so only files that can actually be visible are ever downloaded: `KML_Wards/index.json` (7 provinces, each with a bbox) then `KML_Wards/&lt;PROV&gt;/index.json` (one entry per local unit, with its own bbox and KML path). Both tiers carry a bbox, so - unlike the LMC wards - no per-ward bbox has to be derived or cached.
- Same viewport model as the LMC ward loader: a debounced `wme-map-move-end` pass, a zoom gate (11+), batches of 4 downloads, a padded-viewport eviction test with an 8 s grace period and a 60-layer hard cap. A parsed KML is kept in memory for the session, so panning back is free. The master switch and the *Auto-remove off-screen layers* flag live in `localStorage._wme_nepali_wms_nepal_gis`.
- The card's *Clear Nepal GIS wards* button removes **only this group's** layers, unlike the LMC card's clear, which removes every loaded feature layer.
- New dependency: `GeoKMLer` parses the KML, plus an `@connect` for `kid4rm90s.github.io`. GeoKMLer hands back `Multi*` geometries, so they are split into single geometries before loading (each part gets its own properties object, because the per-feature `__bbox` would otherwise be shared).
- New feature-layer type `ward`: labelled, label text from the KML's `ex_Address` (GeoKMLer prefixes every `&lt;SimpleData&gt;` name with `ex_`). The first loaded KML logs its property keys to the console once, so the exact field names in use can be confirmed at a glance.
- The *Only put the current view on the map* switch on the LMC ward card also windows these layers (the feature windowing is shared), which is what keeps a 32-ward municipality such as Kathmandu light.
- Not ported from WME GeoFile: the country / province / district / municipality outline levels and the manual file importer, so `wmeGisLBBOX` is not called by this loader - the manifest bboxes are the only viewport test.

## 2026.09.14.005

**Added - "Only put the current view on the map" (Lalitpur HN Address Wards):**
- A loaded ward now puts only the features inside the map view on its layer, rather than every feature of the ward. The view is padded by 50% (`LMC_WINDOW_PADDING`, the same margin the ward eviction test uses), so nothing pops in at the edge.
- The window follows the padded-viewport + retain model WME uses for its own map objects: while the view stays inside the already loaded window nothing is touched; when you pan to a new area the layer is topped up with the features that entered and the ones that left are removed (`Map.removeFeaturesFromLayer` + `dangerouslyAddFeaturesToLayerWithoutValidation`, one batched call each).
- The ward itself is still fetched once and kept whole in memory (`loadedGeoJSONLayers[].sdkFeatures`), so panning never re-downloads and shifting/styling keep working on the complete set.
- Every feature now carries a precomputed bbox (`properties.__bbox`), which makes re-windowing a four-number compare per feature. The bbox is translated with the coordinates when a layer is shifted, and the shift/reset paths re-window instead of re-adding every feature.
- New switch *Only put the current view on the map* in the ward group card (on by default, remembered in `localStorage._wme_nepali_wms_lmc_auto`). Turning it off immediately puts the whole loaded ward back on the map.
- *Clear auto-loaded layers*, unticking a ward, eviction and the Style Settings card are unaffected; the window bookkeeping is dropped with the layer.

## 2026.09.14.004

**Changed - Style Settings defaults:**
- The default feature-layer style now reproduces the previous LMC ward GeoJSON look instead of the neutral WME GeoFile blue: stroke `#FF5722` (orange), line width 2 px at 80% opacity, label size 13 px with white text and a black outline, centred on the feature (OL2 `labelAlign: cm`).
- **Fill Opacity now defaults to 0**, so ward polygons render as outlines only (the previous building fill was 0.01 and the boundary fill 0.05). Raise it with the *Fill Opacity* slider when a filled area is wanted.
- These are the fallback values, used when neither the global style nor a layer override has been touched. A previously saved global style or per-layer override still wins - press *Reset to defaults* (global) or *Reset this layer* to pick up the new values.
- Ward addresses and ward boundaries now share these defaults; give one of them an override in the *Apply to* dropdown to keep their colours apart again.

## 2026.09.14.003

**Added - Style Settings (Settings tab):**
- Ported the "Style Settings" card from WME GeoFile (WME-NP-GIS-Layers). It styles every non-WMS/XYZ layer - the LMC ward address/boundary layers today, and any KML, KMZ, GML, GPX, WKT or ZIP(SHP) importer added later. WMS and XYZ layers keep their own opacity control and are deliberately untouched.
- Controls: Stroke Color, Font Size, Label Color and Outline Color (each with a *Match stroke* switch), Outline Width (optionally *Relative to font size*, i.e. fontSize / 4), Fill Opacity, Line Size, Line Style (Solid / Dash / Dot), Line Opacity and Label Position (horizontal Left/Center/Right + vertical Top/Middle/Bottom, which becomes the OL2 `labelAlign`).
- One *global* style plus an optional *per-layer override*: the *Apply to* dropdown switches between *All layers (global)* and a single loaded layer. *Reset to defaults* clears the global style, *Reset this layer* drops that layer's override so it follows the global style again.
- Changes restyle already loaded layers with `Map.redrawLayer()` - no feature is removed or re-added - and are debounced (200 ms), so dragging a slider redraws once. Styles and overrides persist in IndexedDB (`NepaliWMSFeatureStyles` &gt; `styles`).
- The hard-coded per-type styles (`GEOJSON_LAYER_STYLES`) and the two label inputs in the old GeoJSON card are gone; the style engine is the single source of truth. Note that buildings and boundaries now share the global style by default (boundaries stay unlabelled) - give one of them an override to keep their colours apart.
**Added - "Lalitpur HN Address Wards" (Layers tab):**
- The manual *Load GeoJSON from URL* card (ward dropdown, label colour/size inputs, *Load Buildings* button) is retired. In its place is a collapsible group card with a master switch, an *Auto-remove off-screen layers* switch, one checkbox per ward (1-29, all off by default) and a single *Clear auto-loaded layers* button.
- A ticked ward is loaded automatically as soon as its bounding box intersects the map view: its address points (`x_building.php?ward_no=N`) and its ward boundary (`x_ward_bnd.php?ward_no=N`), including the house-number / road-name labels the ward addresses carry.
- The loader follows the WME GeoFile KML loader: a debounced `wme-map-move-end` pass, a zoom gate (11+), batches of 4 downloads, a padded-viewport eviction test with an 8 s grace period, and a 60-layer hard cap. *Auto-remove* can be switched off to keep loaded wards on the map.
- The LMC endpoints are per-ward and carry no bbox, so each ward's bbox is derived once from its boundary file and cached in IndexedDB (`lmc-ward-bboxes`) - afterwards a reload needs no boundary request at all. The master switch, the ticked wards and the auto-remove flag live in `localStorage._wme_nepali_wms_lmc_auto`.
- Loaded ward layers are ordinary feature layers: they appear in the Shifting dropdown, can be shifted/reset and are restyled by the Style Settings card.

## 2026.09.14.002

**Fixed - GeoJSON shift directions (again):**
- The GeoJSON pad moved the loaded layer *opposite* to the arrow for left/right and all four diagonals (up/down were unaffected). `2026.09.13.021` wrongly claimed the GeoJSON table had to be the horizontal *mirror* of the WMS table and restored that mirror; the mirror is what caused the original bug.
- The GeoJSON coordinates are WGS84 degrees, so `+dLon` is east and `+dLat` is north and the translated content moves the same way, which means `left` has to *decrease* the longitude. The table is now the full negation of the WMS `shiftLayer()` table (both axes) - WMS moves the requested bbox, so its content travels the other way.
- Restored `left: dx = -dist`, `right: dx = +dist`, `upleft: dx = -diag`, `upright: dx = +diag`, `downleft: dx = -diag`, `downright: dx = +diag` (the `dy` values are unchanged). Every arrow now moves the GeoJSON layer the way it points, matching the WMS arrows.

## 2026.09.13.021

**Fixed - GeoJSON shift directions:**
- The GeoJSON pad moved the loaded layer *opposite* to the arrow for left/right and all four diagonals (up/down were unaffected). `.020` had "corrected" the GeoJSON direction table to match the WMS table, negating `dx`; that is wrong. The GeoJSON table is, by field-verified design, the horizontal *mirror* of the WMS table - WMS shifts the request bbox (content travels the opposite way) while GeoJSON translates feature coordinates directly, so the two must differ.
- Restored `left: dx = +dist`, `right: dx = -dist`, `upleft: dx = +diag`, `upright: dx = -diag`, `downleft: dx = +diag`, `downright: dx = -diag` (the `dy` values are unchanged). Every arrow now moves the GeoJSON layer the way it points, while the WMS arrows keep behaving as before.

## 2026.09.13.020

**Fixed - shift pad:**
- GeoJSON shift directions were mirrored horizontally: *left/right and all four diagonals moved the layer the wrong way* while up/down were correct. In WGS84 `+x` is east and `+y` is north and `dLon` is derived from `dx`, so the horizontal component is no longer negated. Every arrow now moves the loaded layer in the direction it points.
- The WMS arrows did nothing at all. The pad resolved the layer with `W.map.getLayers().find(l =&gt; l.name === &lt;name from the dropdown&gt;)`, but `addLayerToggler()` renames a toggler's layers to "&lt;display name&gt; 0", "&lt;display name&gt; 1" when it owns several, and the listing also depended on `layer.params.SERVICE` being upper-cased. The dropdown is now keyed by the *toggler* (`wms:&lt;toggler key&gt;`) and the layers are resolved by object identity (`wmsTogglersOnMap()` / `findWmsLayersForTarget()`), so no name matching is involved.
- A toggler's on-map layers are all shifted and reset together - the same set its checkbox controls - instead of only the one whose name happened to match.
- The pad no longer fails silently: if the selected layer is not on the map it now says so ("Layer Not On Map - switch the layer on first"), which is what made the WMS case look dead. The dropdown hint now mentions that only switched-on layers are listed.

## 2026.09.13.019

**UI - shared shift pad:**
- The WMS layers and the loaded GeoJSON layers now use *one* set of shift buttons. The "Layer tools" card in the *Shifting* tab has a single dropdown listing both kinds, grouped (*WMS layers* / *GeoJSON layers*), one distance field, one 3x3 pad and one *Reset Shift*.
- The option value carries the layer kind (`wms:&lt;name&gt;` / `geojson:&lt;name&gt;`) and the pad dispatches to the right engine through the new `shiftSelectedLayer()` / `resetSelectedLayerShift()`. The two engines are deliberately NOT merged: the WMS pad moves the requested bbox (content travels the opposite way) while the GeoJSON pad translates feature coordinates, and their direction tables are mirrored by design.
- The duplicate GeoJSON shift block (its own dropdown, distance input and pad in the GeoJSON card) has been removed. `shiftGeoJsonLayer()` and `resetGeoJsonShift()` now take the layer name and distance as arguments instead of reading their own dropdown.
- The applied-shift line reports both kinds in metres: GeoJSON offsets are stored in degrees and are converted back for display (`describeGeoJsonOffset()`).
- The transparency slider is WMS-only, so it now disables itself when a GeoJSON layer is selected instead of silently doing nothing.
- The GeoJSON card keeps the ward picker, label colour/size and Load/Clear, plus a hint that loaded layers are shifted from the Shifting tab.

## 2026.09.13.018

**Fixed:**
- The info-popup title bar (the green `tr.alert-success` heading) was unreadable: the background was a translucent green (`rgba(40, 167, 69, 0.25)`) while the text inherited the theme colour, so it rendered green on green. It is now a solid `#8BC34A` bar with dark (`#1b1b1b`) bold text, which keeps a readable contrast in both the light and the dark editor theme. Applied to both popup builders (`showWMSPopupAtPixel` and `showWMSPopupAtPixelForLayer`).

## 2026.09.13.017

**UI:**
- The sidebar panel is now split into sub-tabs below the gradient header: *Layers*, *Shifting* and *Settings*, built with the new shared `npwTabs()` helper (segmented control, ARIA `tablist`/`tab`/`tabpanel` roles).
- *Layers* holds everything it showed before: the collapsible layer-group cards (opacity slider + checkbox per layer) and the GeoJSON loader card. *Shifting* holds the Layer tools card (layer select, transparency, shift distance, 3x3 pad, reset, applied-shift status). *Settings* is a placeholder for options added later.
- The selected sub-tab is remembered in `localStorage` (`_wme_nepali_wms_subtab`), so a reload returns to the tab that was last open.
**Fixed:**
- Layer-row checkboxes sat out of line with their labels: WME's global `input[type=checkbox]` rule outranks a plain class, so its size/margins won. The checkbox and label are now targeted as `.npw-layer-item &gt; input.npw-checkbox` / `&gt; label.npw-label` with a pinned 14x14 box and a centred label.

## 2026.09.13.016

**Added:**
- WMS layers can now start from a corrected position: `WMS_LAYER_SHIFT_PRESETS` holds a built-in default shift per layer, applied *before the first tile is drawn*, so e.g. the inaccurate DMG municipality border no longer has to be nudged into place by hand (no 260 clicks after every reload). Values are written the way they are measured on the map: `{ west: 260, north: 20 }` = pull the layer 260 m west and 20 m north. Currently set for the DMG municipality border.
- A shift made by hand with the pad is now remembered per layer (stored in metres, so it is projection-independent) and re-applied on the next page load. *Reset Shift* returns to the layer's built-in default instead of an unshifted position.
- The Layer tools card shows the shift currently applied to the selected layer, e.g. *Applied shift: 260 m W, 20 m N (built-in default)* / *(remembered)* - the value can be copied straight into the preset table.

## 2026.09.13.015

**UI:**
- The layer-group cards (NP Places, NP Roads, ...) can now be collapsed and expanded by clicking their title bar (keyboard: Enter/Space). The folded state is remembered per group, so a collapsed "NP Places" stays collapsed after a page reload.
- Each group title shows an *on/total* badge (e.g. `2/12`) that stays visible while the group is collapsed, and `npwCard()` now takes an optional `{ collapsible, storageKey }` so the provider cards planned next (Django, etc.) get the same behaviour for free.

## 2026.09.13.014

**UI:**
- Buttons modernised to the "WME GeoFile" (WME-NP-GIS-Layers) look: full-width solid button, 6px radius, 600 weight, coloured hover, using the same palette (green = load/import, red = clear/remove, blue = neutral, crimson = accent).
- Load / Clear are now one two-button row, and each shift pad has a full-width *Reset Shift* button under the 3x3 arrow grid instead of a small inline one.
- The button factory, palette and row helper are shared (`npwButton()`, `npwButtonRow()`, `NPW_BUTTON_VARIANTS`) so the provider sections planned next (Django, etc.) can reuse the same layout and colours.

## 2026.09.13.013

**Fixed:**
- GeoJSON layer shift direction: only up/down moved the layer the way the arrow points; *left/right and the four diagonals were mirrored horizontally*. The horizontal component of the shift is now negated so every arrow moves the layer in the direction it points (vertical was already correct).

## 2026.09.13.012

**SDK migration (GeoJSON layers):**
- The LMC ward GeoJSON layers are now WME SDK feature layers: `Map.addLayer` with `styleRules`/`styleContext` + `dangerouslyAddFeaturesToLayerWithoutValidation`, `setLayerVisibility`, `setLayerZIndex`, `redrawLayer`, `removeAllFeaturesFromLayer` and `removeLayer` replace `OL.Format.GeoJSON`, `OL.Layer.Vector`, `OL.StyleMap` and the OL2 layer calls.
- Every feature now gets the `id` the SDK requires (`&lt;layerName&gt;_&lt;index&gt;`), and the label is built from the feature properties instead of OL2 `attributes`.
- The label colour/size inputs now update the loaded building layers immediately (`redrawLayer` re-runs the styleContext getters) instead of only affecting newly loaded wards.
- Shifting no longer uses OL2 `geometry.move()`: coordinates are translated in WGS84 degrees and the layer is re-added. The metres-to-degrees conversion now always applies, because SDK features are stored in WGS84 regardless of the map projection.

## 2026.09.13.011

**Fixed:**
- `W.map.getCenter()` is no longer read blindly: the WMS and GeoJSON shift maths asked for `.lat` even when the map had no centre yet (TypeError). Both now use `getMapCenterLat()`, which falls back to the OL2 map centre and finally to Nepal's latitude.

## 2026.09.13.010

**Changed:**
- Switching a layer off now detaches it from the map again instead of only hiding it, so an off layer keeps no hidden tile grid in memory. The detach is guarded - only layers that are actually attached to the map are removed and a failed detach can no longer break the toggle, which is what caused the `NotFoundError: removeChild` in 2026.09.13.007.
- The Street View overlay cleanup detaches the layer the same way.

## 2026.09.13.009

**Changed:**
- Layers are no longer detached from the map: a layer is attached on demand and then only switched with `setVisibility()`, the way "Croatian WMS layers" does it. `W.map.removeLayer()` is no longer called anywhere for WMS/XYZ layers, so the `NotFoundError: removeChild` class of failure cannot occur at all.
- Side effect: a layer that has been enabled once stays in the map's layer list after being switched off (it no longer disappears from the "Layer tools" drop-down), and re-enabling it is instant.

## 2026.09.13.008

**Fixed:**
- `NotFoundError: Failed to execute 'removeChild' on 'Node'` when switching a layer off. WME's `removeLayer()` detaches the layer `&lt;div&gt;` unconditionally, so it was being called for layers that were never added to the map (e.g. on start-up and when the master checkbox was off). Layers are now detached only when they are actually on the map, and hiding relies on `setVisibility(false)` alone.
- Same guard applied to the Street View overlay cleanup.

## 2026.09.13.007

**UI:**
- Sidebar tab rebuilt on the "Croatian WMS layers" pattern: gradient header (title + version), one card per layer group with a per-group **opacity slider** and one checkbox per layer, plus theme-aware controls.
- The WME layer switcher now holds a **single master checkbox** for the script instead of one checkbox per layer; a layer is drawn only when its sidebar checkbox *and* the master checkbox are on. The master state is remembered.
- Panel and both WMS popups are now themed with WME CSS variables (`--content_default`, `--background_default`, `--hairline`, `--primary`, `--content_p1/p2`), so they follow the editor's light/dark theme instead of hard-coded colours.

## 2026.09.13.006

**SDK migration:**
- Layer switcher rebuilt on `wmeSDK.LayerSwitcher` (addLayerCheckbox / setLayerCheckboxChecked / isLayerCheckboxChecked + the `wme-layer-checkbox-toggled` event) instead of hand-made shadow-DOM `wz-checkbox` elements. Saved states are preserved; the group names are kept as label prefixes since the SDK has no group API.
- Street View overlay is now driven by the SDK street view events (`wme-street-view-button-activated/deactivated`, `wme-street-view-panel-visibility-changed`) and `Map.isStreetViewActive()`, replacing the MutationObserver on `.street-view-control`.

## 2026.09.13.005

**SDK migration:**
- Bootstrap now waits on `wmeSDK.Events.once('wme-map-data-loaded')` instead of a DOM event listener.
- WMS info popups are positioned with the SDK screen-pixel API and are clamped to stay inside the viewport (no more page distortion at the map edges).
- Keyboard shortcuts migrated from `W.accelerators`/`I18n` to the WME SDK (`wmeSDK.Shortcuts`), with automatic migration of previously assigned legacy keys.
### 2026.05.20.10
**Added HNs:**
- Dhangadhi Sub Metropolitan City 
- Ghodaghodi Municipality 
- Nepalgunj Sub Metropolitan City
### 2026.05.20.09
- Fixed issue where script fails to load.
- Most of the code is currently using WMESDK and its equivalent APIs.
### 2026-04-16.1
**Fixed:**
 - Compability with latest WME version.

 - swapped W.map.olMap with W.map.getOLMap() to fix layers not showing up issue. 

 Thanks to davidsl4 to pointing out.
### 2026.02.06.06
- Added Preeti font to Unicode conversion for rd_nanep field
- Building labels now display Nepali text in proper Unicode format
### 2026.02.06.01
- Added feature: Load GeoJSON from URL (LMC Ward Buildings from geonep.com.np)
- New UI section to select ward number (1-29) and load building data
- Buildings display with house numbers as labels
- Clear button to remove all loaded GeoJSON layers
### 2025.11.29.01
- Added layers: Health Facilities from National Geoportal, Police Units from National Geoportal.
### 2025.08.30.01
- ZIndex update for : Education Facilities (PRTMP),
 Health Facilities (PRTMP),
 Palika Centre (PRTMP),
 Ward Centre (PRTMP),
 Tourist Attraction,
 Customs Office 
 Bridges (BSM),
 Bridges (PRTMP),
 and Lalitpur Metropolitan City (LMC) layers.

### 2025.07.27.1
Added Layers:

  - Rivers
  - Education Facilities (PRTMP)
  - Health Facilities (PRTMP)
  - Palika Centre (PRTMP)
  - Ward Centre (PRTMP)
  - Tourist Attraction
  - Customs Office
  - National Highways 2023
  - Province Highways 2023
  - Province Roads 2023
  - Bridges (BSM)
  - Bridges (PRTMP)
  - and popup support for above layers and more.

### 2025.07.24.01
It now supports to display popup for highway with various information.

### 2025.06.23.01
Added diagonal (â†–, â†—, â†™, â†˜) shift buttons for WMS layers.

  - Shows alert when the shift is reset to default.

### 2025.06.08.01
Now the WMS layer can be shifted by a specified distance in meters.

### 2025.06.06.02
Added Bridge Management System bridge locations!

  - Loaded layers will be reloaded even after the page refresh.

### 2025.06.06.01
Added Bridge Management System bridge locations!

### 2025.05.11.01
Fixed Z-ordering

### 2025.04.13.01
Fixed Combatible with the latest wme beta v2.287-5! Now it monitors the script update!

### 2025.03.06.01
Now LMC HN can be filtered by ward

### 2025.02.03.01
Line modification

### 2025.02.01.02
Added support for WazeToastr update dialogue box

### 2025.02.01.01
Modified how WMS 4326 image is displayed

### 1.0
Initial Version
