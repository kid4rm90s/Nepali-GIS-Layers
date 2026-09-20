// ==UserScript==
// @name          Nepali WMS layers
// @version       2026.05.20.010
// @author        kid4rm90s
// @description   Displays layers from Nepali WMS services in WME
// @match         https://www.waze.com/*/editor*
// @match         https://www.waze.com/editor*
// @match         https://beta.waze.com/*
// @exclude       https://www.waze.com/*user/*editor/*
// @run-at        document-end
// @namespace     https://greasyfork.org/en/users/1087400-kid4rm90s
// @license       MIT
// @grant         GM_xmlhttpRequest
// @grant         unsafeWindow
// @require       https://greasyfork.org/scripts/560385/code/WazeToastr.js
// @require       https://update.greasyfork.org/scripts/516445/1480246/Make%20GM%20xhr%20more%20parallel%20again.js
// @require https://update.greasyfork.org/scripts/565546/1750869/Preeti%20to%20Unicode%20Converter.js
// @connect       geoserver.softwel.com.np
// @connect       admin.nationalgeoportal.gov.np
// @connect       localhost:8080
// @connect       greasyfork.org
// @connect       geonep.com.np
// @downloadURL   https://update.greasyfork.org/scripts/521924-nepali-wms-layers.user.js
// @updateURL     https://update.greasyfork.org/scripts/521924-nepali-wms-layers.meta.js
// ==/UserScript==

/*  Scripts modified from Czech WMS layers (https://greasyfork.org/en/scripts/35069-czech-wms-layers; https://greasyfork.org/en/scripts/34720-private-czech-wms-layers, https://greasyfork.org/en/scripts/28160)
orgianl authors: petrjanik, d2-mac, MajkiiTelini, and Croatian WMS layers (https://greasyfork.org/en/scripts/519676-croatian-wms-layers) author: JS55CT */

/* global W */
/* global WazeToastr */
/* global $ */
/* global OpenLayers */
/* global require */

(function main() {
  ('use strict');
  const updateMessage =
'<strong>Added HNs:</strong><br>- Dhangadhi Sub Metropolitan City <br>- Ghodaghodi Municipality <br>- Nepalgunj Sub Metropolitan City<br><br>';
  const scriptName = GM_info.script.name;
  const scriptVersion = GM_info.script.version;
  const downloadUrl = 'https://greasyfork.org/scripts/521924-nepali-wms-layers/code/nepali-wms-layers.user.js';
  let wmeSDK;

  var WMSLayersTechSource = {};
  var W;
  var OL;
  var I18n;
  var ZIndexes = {};
  var WMSLayerTogglers = {};
  var loadedGeoJSONLayers = [];
  var geoJsonLayerOffsets = {};

  // Helper: update GeoJSON layer selector dropdown
  function updateGeoJsonLayerSelector() {
    const select = document.getElementById('geoJsonLayerSelect');
    if (!select) return;

    // Clear existing options except first (default)
    while (select.options.length > 1) {
      select.remove(1);
    }

    // Add options for each loaded layer
    loadedGeoJSONLayers.forEach(layerInfo => {
      const option = document.createElement('option');
      option.value = layerInfo.name;
      option.textContent = layerInfo.name;
      select.appendChild(option);
    });

    // Reset to default if no layers
    if (loadedGeoJSONLayers.length === 0) {
      select.selectedIndex = 0;
    }
  }

  // Helper: shift GeoJSON layer
  function shiftGeoJsonLayer(direction) {
    const selectElem = document.getElementById('geoJsonLayerSelect');
    const distInput = document.getElementById('geoJsonShiftDistance');
    
    if (!selectElem || !distInput) return;
    
    const layerName = selectElem.value;
    const dist = parseFloat(distInput.value) || 0;
    
    if (!layerName || dist === 0) {
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

    const map = W.map;
    const proj = map.getProjectionObject();

    let dx = 0, dy = 0;
    const diag = dist * 0.7071; // sqrt(2)/2 for diagonal

    if (proj && proj.projCode === 'EPSG:4326') {
      const centerLat = map.getCenter().lat;
      const metersPerDegreeLat = 111320;
      const metersPerDegreeLon = (40075000 * Math.cos((centerLat * Math.PI) / 180)) / 360;

      switch (direction) {
        case 'up': dy = dist / metersPerDegreeLat; break;
        case 'down': dy = -dist / metersPerDegreeLat; break;
        case 'left': dx = -dist / metersPerDegreeLon; break;
        case 'right': dx = dist / metersPerDegreeLon; break;
        case 'upleft': dx = -diag / metersPerDegreeLon; dy = diag / metersPerDegreeLat; break;
        case 'upright': dx = diag / metersPerDegreeLon; dy = diag / metersPerDegreeLat; break;
        case 'downleft': dx = -diag / metersPerDegreeLon; dy = -diag / metersPerDegreeLat; break;
        case 'downright': dx = diag / metersPerDegreeLon; dy = -diag / metersPerDegreeLat; break;
      }
    } else {
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
    }

    // Shift all paired layers together
    layersToShift.forEach(info => {
      const layerToShift = info.layer;
      const shiftLayerName = info.name;
      
      // Initialize offset if not exists
      if (!geoJsonLayerOffsets[shiftLayerName]) {
        geoJsonLayerOffsets[shiftLayerName] = { x: 0, y: 0 };
      }

      // Update offset
      geoJsonLayerOffsets[shiftLayerName].x += dx;
      geoJsonLayerOffsets[shiftLayerName].y += dy;

      // Apply offset to all features
      layerToShift.features.forEach(feature => {
        if (feature.geometry && feature.geometry.move) {
          feature.geometry.move(dx, dy);
        }
      });

      // Redraw layer
      layerToShift.redraw();
    });

    const shiftMsg = layersToShift.length > 1 
      ? `Ward ${wardNo} layers shifted ${dist} meters ${direction}`
      : `Layer shifted ${dist} meters ${direction}`;
    WazeToastr.Alerts.info('Layer Shifted', shiftMsg, false, false, 2000);
  }

  // Helper: reset GeoJSON layer shift
  function resetGeoJsonShift() {
    const selectElem = document.getElementById('geoJsonLayerSelect');
    if (!selectElem) return;

    const layerName = selectElem.value;
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
      const resetLayer = info.layer;
      const resetLayerName = info.name;
      const offset = geoJsonLayerOffsets[resetLayerName];

      if (offset && (offset.x !== 0 || offset.y !== 0)) {
        hasOffset = true;
        // Move back to original position
        resetLayer.features.forEach(feature => {
          if (feature.geometry && feature.geometry.move) {
            feature.geometry.move(-offset.x, -offset.y);
          }
        });

        // Reset offset
        geoJsonLayerOffsets[resetLayerName] = { x: 0, y: 0 };

        // Redraw layer
        resetLayer.redraw();
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
    I18n = unsafeWindow.I18n;

    WMSLayersTechSource.tileSizeG = new OL.Size(512, 512);
    WMSLayersTechSource.resolutions = [
      156543.03390625, 78271.516953125, 39135.7584765625, 19567.87923828125, 9783.939619140625, 4891.9698095703125, 2445.9849047851562, 1222.9924523925781, 611.4962261962891, 305.74811309814453, 152.87405654907226, 76.43702827453613,
      38.218514137268066, 19.109257068634033, 9.554628534317017, 4.777314267158508, 2.388657133579254, 1.194328566789627, 0.5971642833948135, 0.298582141697406, 0.149291070848703, 0.0746455354243515, 0.0373227677121757,
    ];
    ZIndexes.base = W.map.getOLMap().Z_INDEX_BASE.Overlay + 20;
    ZIndexes.overlay = W.map.getOLMap().Z_INDEX_BASE.Overlay + 100;
    ZIndexes.popup = W.map.getOLMap().Z_INDEX_BASE.Overlay + 500;

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
    // DOM-based approach: manually create wz-checkbox elements (same pattern as geofile.js)
    var groupTogglerPlaces = addGroupToggler(false, 'layer-switcher-group_np_places', 'NP Places');
    var groupTogglerRoad = addGroupToggler(false, 'layer-switcher-group_np_road', 'NP Roads');
    var groupTogglerHNS = addGroupToggler(false, 'layer-switcher-group_np_hns', 'NP Metric HNs');
    var groupTogglerNames = addGroupToggler(false, 'layer-switcher-group_names', 'NP names and addresses');
    var groupTogglerBorders = addGroupToggler(false, 'layer-switcher-group_borders', 'NP Borders');
    var groupTogglerExternal = addGroupToggler(false, 'layer-switcher-group_external', 'External Maps!!!');

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

    //EXTERNÍ MAPY * EXTERNAL MAPS
    WMSLayerTogglers.xyz_livemap = addLayerToggler(groupTogglerExternal, 'Waze LiveMap', false, [addNewLayer('xyz_livemap', service_xyz_livemap)]);
    WMSLayerTogglers.xyz_google = addLayerToggler(groupTogglerExternal, 'Google Maps', false, [addNewLayer('xyz_google', service_xyz_google)]);
    WMSLayerTogglers.xyz_google_terrain = addLayerToggler(groupTogglerExternal, 'Google Terrain Maps', false, [addNewLayer('xyz_google_terrain', service_xyz_google_terrain)]);
    WMSLayerTogglers.xyz_google_hybrid = addLayerToggler(groupTogglerExternal, 'Google Hybrid Maps', false, [addNewLayer('xyz_google_hybrid', service_xyz_google_hybrid)]);
    WMSLayerTogglers.xyz_google_streetview = addLayerToggler(groupTogglerExternal, 'Google StreetView', false, [addNewLayer('xyz_google_streetview', service_xyz_google_streetview, null, ZIndexes.popup)]);
    WMSLayerTogglers.xyz_osm = addLayerToggler(groupTogglerExternal, 'OpenStreetMaps', false, [addNewLayer('xyz_osm', service_xyz_osm)]);
    WMSLayerTogglers.xyz_april = addLayerToggler(groupTogglerExternal, 'Apríl !!!', false, [addNewLayer('xyz_april', service_xyz_april)]);


    // --- Layer toggler state persistence ---
    function saveLayerTogglerStates() {
      if (!localStorage) return;
      const state = {};
      for (const key in WMSLayerTogglers) {
        const togglerId = WMSLayerTogglers[key].htmlItem;
        const toggler = document.getElementById(togglerId);
        if (toggler) state[key] = toggler.checked;
      }
      localStorage.WMSLayers = JSON.stringify(state);
    }

    function restoreLayerTogglerStates() {
      if (!localStorage.WMSLayers) return;
      const state = JSON.parse(localStorage.WMSLayers);
      for (const key in state) {
        if (WMSLayerTogglers[key]) {
          const togglerId = WMSLayerTogglers[key].htmlItem;
          const toggler = document.getElementById(togglerId);
          if (toggler && toggler.checked !== state[key]) {
            toggler.checked = state[key];
            toggler.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      }
    }

    // Attach change listeners to save state on toggle
    for (const key in WMSLayerTogglers) {
      const togglerId = WMSLayerTogglers[key].htmlItem;
      const toggler = document.getElementById(togglerId);
      if (toggler) {
        toggler.addEventListener('change', saveLayerTogglerStates);
      }
    }
    // Restore state after togglers are created

    restoreLayerTogglerStates();
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

    // Helper: show popup at pixel position with content (custom HTML popup)
    function showWMSPopupAtPixel(lonLat, html) {
      let popup = document.getElementById('wms-info-popup');
      if (!popup) {
        popup = document.createElement('div');
        popup.id = 'wms-info-popup';
        popup.style.position = 'absolute';
        popup.style.zIndex = 9999;
        popup.style.background = 'white';
        popup.style.border = '2px solid #333';
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
        <a href="#" id="wms-info-popup-close" style="position:absolute;top:4px;right:8px;font-size:16px;text-decoration:none;color:#888;">&times;</a>
        <style>
          #wms-info-popup table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 11px; }
          #wms-info-popup th, #wms-info-popup td { border: 1px solid #ccc; padding: 2px 6px; text-align: left; font-size: 11px; }
          #wms-info-popup th { background: #f0f0f0; font-weight: bold; font-size: 11px; }
          #wms-info-popup tr.alert-success th { background: #d4edda; color: #155724; text-align: center; font-size: 11px; }
        </style>
        ${html}
      `;
      // Position popup: convert lon/lat to viewport-relative pixel, then add rect offset (mirrors production)
      const mapDiv = wmeSDK.Map.getMapViewportElement();
      const rect = mapDiv.getBoundingClientRect();
      const px = wmeSDK.Map.getMapPixelFromLonLat({ lonLat: { lon: lonLat.lon, lat: lonLat.lat } });
      popup.style.left = rect.left + px.x + 10 + 'px';
      popup.style.top = rect.top + px.y - 10 + 'px';
      popup.style.display = 'block';
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
        popup.style.position = 'absolute';
        popup.style.zIndex = 9999;
        popup.style.background = 'white';
        popup.style.border = '2px solid #333';
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
        <a href="#" id="${popupId}-close" style="position:absolute;top:4px;right:8px;font-size:16px;text-decoration:none;color:#888;">&times;</a>
        <style>
          #${popupId} table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 11px; }
          #${popupId} th, #${popupId} td { border: 1px solid #ccc; padding: 2px 6px; text-align: left; font-size: 11px; }
          #${popupId} th { background: #f0f0f0; font-weight: bold; font-size: 11px; }
          #${popupId} tr.alert-success th { background: #d4edda; color: #155724; text-align: center; font-size: 11px; }
        </style>
        ${html}
      `;
      // Position popup: convert lon/lat to viewport-relative pixel, then add rect offset (mirrors production)
      const mapDiv = wmeSDK.Map.getMapViewportElement();
      const rect = mapDiv.getBoundingClientRect();
      const px = wmeSDK.Map.getMapPixelFromLonLat({ lonLat: { lon: lonLat.lon, lat: lonLat.lat } });
      // Offset each popup horizontally so they don't overlap
      let offsetX = 10 + 260 * ['wms_PL2023', 'wms_PRTMP_PH', 'wms_PRTMP_PR'].indexOf(layerKey);
      popup.style.left = rect.left + px.x + offsetX + 'px';
      popup.style.top = rect.top + px.y - 10 + 'px';
      popup.style.display = 'block';
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

    var GSVlayer = WMSLayerTogglers.xyz_google_streetview.layerArray[0].layer;
    var enteringStreetView = false;
    var ignoreStreetViewExit = false;
    var previousDisplayState = true;
    var controlObserver = new MutationObserver(function (mutationRecords) {
      if (!document.getElementById('layer-switcher-item_Google_StreetView').checked) {
        if (mutationRecords[0].target.classList.contains('overlay-button-active') == previousDisplayState) {
          if (previousDisplayState == true && !ignoreStreetViewExit) {
            previousDisplayState = !mutationRecords[0].target.classList.contains('overlay-button-active');
            W.map.addLayer(GSVlayer);
            enteringStreetView = true;
            GSVlayer.setVisibility(true);
            enteringStreetView = false;
          } else if (previousDisplayState == false) {
            previousDisplayState = !mutationRecords[0].target.classList.contains('overlay-button-active');
            GSVlayer.setVisibility(false);
            W.map.removeLayer(GSVlayer);
          }
        }
      }
    });
    controlObserver.observe(document.querySelector('.street-view-control'), { attributes: true, attributeFilter: ['class'] });
    GSVlayer.events.register('visibilitychanged', null, function () {
      if (!enteringStreetView && GSVlayer.getVisibility()) {
        ignoreStreetViewExit = true;
      }
      if (!GSVlayer.getVisibility()) {
        ignoreStreetViewExit = false;
      }
    });

    const { tabLabel, tabPane } = await wmeSDK.Sidebar.registerScriptTab();
    tabLabel.innerText = 'WMS-NP';
    tabLabel.title = 'Nepali WMS Layers';
    tabLabel.id = 'sidepanel-wms';
    tabPane.innerHTML = "<b><u><a href='https://greasyfork.org/en/scripts/521924' target='_blank'>" + GM_info.script.name + '</a></u></b> &nbsp; v' + GM_info.script.version;
    var section = document.createElement('section');
    section.style.fontSize = '13px';
    section.id = 'WMS';
    section.style.marginBottom = '15px';
    section.appendChild(document.createElement('br'));
    section.appendChild(document.createTextNode('WMS layer: '));
    var WMSSelect = document.createElement('select');
    WMSSelect.id = 'WMSLayersSelect';
    section.appendChild(WMSSelect);
    var opacityRange = document.createElement('input');
    var opacityLabel = document.createElement('label');
    opacityRange.type = 'range';
    opacityRange.min = 0;
    opacityRange.max = 100;
    opacityRange.value = 100;
    opacityRange.id = 'WMSOpacity';
    opacityLabel.textContent = 'Layer transparency: ' + opacityRange.value + ' %';
    opacityLabel.id = 'WMSOpacityLabel';
    opacityLabel.htmlFor = opacityRange.id;
    section.appendChild(opacityLabel);
    section.appendChild(opacityRange);

    // Add shift controls
    var shiftContainer = document.createElement('div');
    shiftContainer.style.marginTop = '10px';
    shiftContainer.style.display = 'flex';
    shiftContainer.style.flexDirection = 'column';
    shiftContainer.style.alignItems = 'flex-start';

    var distanceLabel = document.createElement('label');
    distanceLabel.textContent = 'Shift distance (meters): ';
    distanceLabel.style.marginRight = '5px';
    var distanceInput = document.createElement('input');
    distanceInput.type = 'number';
    distanceInput.value = 1;
    distanceInput.min = 1;
    distanceInput.style.width = '60px';
    distanceInput.id = 'WMSShiftDistance';
    distanceLabel.appendChild(distanceInput);
    shiftContainer.appendChild(distanceLabel);

    var btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '5px';
    btnRow.style.marginTop = '5px';

    var btnUp = document.createElement('button');
    btnUp.textContent = '↑';
    btnUp.title = 'Shift Up';
    var btnDown = document.createElement('button');
    btnDown.textContent = '↓';
    btnDown.title = 'Shift Down';
    var btnLeft = document.createElement('button');
    btnLeft.textContent = '←';
    btnLeft.title = 'Shift Left';
    var btnRight = document.createElement('button');
    btnRight.textContent = '→';
    btnRight.title = 'Shift Right';

    // Diagonal buttons
    var btnUpLeft = document.createElement('button');
    btnUpLeft.textContent = '↖';
    btnUpLeft.title = 'Shift Up-Left';
    var btnUpRight = document.createElement('button');
    btnUpRight.textContent = '↗';
    btnUpRight.title = 'Shift Up-Right';
    var btnDownLeft = document.createElement('button');
    btnDownLeft.textContent = '↙';
    btnDownLeft.title = 'Shift Down-Left';
    var btnDownRight = document.createElement('button');
    btnDownRight.textContent = '↘';
    btnDownRight.title = 'Shift Down-Right';

    // Add reset button
    var btnReset = document.createElement('button');
    btnReset.textContent = 'Reset';
    btnReset.title = 'Reset Shift';
    btnRow.appendChild(btnReset);

    // Arrange buttons in a grid
    var btnGrid = document.createElement('div');
    btnGrid.style.display = 'grid';
    btnGrid.style.gridTemplateColumns = 'repeat(3, 1fr)';
    btnGrid.style.gap = '2px';
    btnGrid.appendChild(btnUpLeft);
    btnGrid.appendChild(btnUp);
    btnGrid.appendChild(btnUpRight);
    btnGrid.appendChild(btnLeft);
    var emptyCell = document.createElement('div');
    btnGrid.appendChild(emptyCell); // center cell empty
    btnGrid.appendChild(btnRight);
    btnGrid.appendChild(btnDownLeft);
    btnGrid.appendChild(btnDown);
    btnGrid.appendChild(btnDownRight);
    shiftContainer.appendChild(btnGrid);
    shiftContainer.appendChild(btnRow);
    section.appendChild(shiftContainer);

    // Helper: store per-layer offset
    var wmsLayerOffsets = {};

    // Helper: store original offset for each layer
    var wmsLayerOriginalOffsets = {};

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

    // Helper to shift layer (now accepts dx, dy)
    function shiftLayer(direction, customDx, customDy) {
      var value = document.getElementById('WMSLayersSelect').value;
      var dist = parseFloat(document.getElementById('WMSShiftDistance').value) || 0;
      if (!value || value === 'undefined' || dist === 0) return;
      var layer = W.map.getLayers().find(l => l.name === value) || null;
      if (!layer) return;
      patchWMSLayerGetURL(layer);
      var map = W.map;
      var proj = map.getProjectionObject();
      var dx = 0,
        dy = 0;
      var diag = dist * 0.7071; // sqrt(2)/2 for diagonal
      if (typeof customDx === 'number' && typeof customDy === 'number') {
        dx = customDx;
        dy = customDy;
      } else if (proj && proj.projCode === 'EPSG:4326') {
        var centerLat = map.getCenter().lat;
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
      if (!wmsLayerOffsets[layer.name]) wmsLayerOffsets[layer.name] = { x: 0, y: 0 };
      wmsLayerOffsets[layer.name].x += dx;
      wmsLayerOffsets[layer.name].y += dy;
      // Store original offset if not already stored
      if (!wmsLayerOriginalOffsets[layer.name]) {
        wmsLayerOriginalOffsets[layer.name] = { x: 0, y: 0 };
      }
      // Show WazeToastr alert
      WazeToastr.Alerts.info('Layer Shifted', `Layer shifted to ${dist} metres ${direction}. Please wait for fully load.`, false, false, 2000);
      layer.redraw();
    }
    btnUp.addEventListener('click', function () {
      shiftLayer('up');
    });
    btnDown.addEventListener('click', function () {
      shiftLayer('down');
    });
    btnLeft.addEventListener('click', function () {
      shiftLayer('left');
    });
    btnRight.addEventListener('click', function () {
      shiftLayer('right');
    });
    btnUpLeft.addEventListener('click', function () {
      shiftLayer('upleft');
    });
    btnUpRight.addEventListener('click', function () {
      shiftLayer('upright');
    });
    btnDownLeft.addEventListener('click', function () {
      shiftLayer('downleft');
    });
    btnDownRight.addEventListener('click', function () {
      shiftLayer('downright');
    });

    // Reset shift for selected layer
    btnReset.addEventListener('click', function () {
      var value = document.getElementById('WMSLayersSelect').value;
      if (!value || value === 'undefined') return;
      var layer = W.map.getLayers().find(l => l.name === value) || null;
      if (!layer) return;
      patchWMSLayerGetURL(layer);
      wmsLayerOffsets[layer.name] = { x: 0, y: 0 };
      layer.redraw();
      // Show WazeToastr alert on reset
      WazeToastr.Alerts.info('Layer Reset', 'Layer shift has been reset to default.', false, false, 2000);
    });

    tabPane.appendChild(section);

    // --- GeoJSON URL Loading Section ---
    var geoJsonSection = document.createElement('section');
    geoJsonSection.style.fontSize = '13px';
    geoJsonSection.id = 'GeoJSONURLSection';
    geoJsonSection.style.marginBottom = '15px';
    geoJsonSection.style.marginTop = '15px';
    geoJsonSection.style.borderTop = '2px solid #ccc';
    geoJsonSection.style.paddingTop = '10px';

    var geoJsonTitle = document.createElement('h3');
    geoJsonTitle.textContent = 'Load GeoJSON from URL';
    geoJsonTitle.style.fontSize = '14px';
    geoJsonTitle.style.fontWeight = 'bold';
    geoJsonTitle.style.marginBottom = '10px';
    geoJsonSection.appendChild(geoJsonTitle);

    // Font styling controls
    var fontStyleContainer = document.createElement('div');
    fontStyleContainer.style.display = 'flex';
    fontStyleContainer.style.gap = '10px';
    fontStyleContainer.style.marginBottom = '10px';

    // Font color picker
    var fontColorContainer = document.createElement('div');
    fontColorContainer.style.flex = '1';
    var fontColorLabel = document.createElement('label');
    fontColorLabel.textContent = 'Label Color: ';
    fontColorLabel.style.display = 'block';
    fontColorLabel.style.marginBottom = '3px';
    fontColorLabel.style.fontSize = '13px';
    var fontColorInput = document.createElement('input');
    fontColorInput.type = 'color';
    fontColorInput.id = 'geoJsonFontColor';
    fontColorInput.value = '#ffffff';
    fontColorInput.style.width = '70%';
    fontColorInput.style.height = '30px';
    fontColorInput.style.cursor = 'pointer';
    fontColorContainer.appendChild(fontColorLabel);
    fontColorContainer.appendChild(fontColorInput);

    // Font size input
    var fontSizeContainer = document.createElement('div');
    fontSizeContainer.style.flex = '1';
    var fontSizeLabel = document.createElement('label');
    fontSizeLabel.textContent = 'Label Size (px): ';
    fontSizeLabel.style.display = 'block';
    fontSizeLabel.style.marginBottom = '3px';
    fontSizeLabel.style.fontSize = '13px';
    var fontSizeInput = document.createElement('input');
    fontSizeInput.type = 'number';
    fontSizeInput.id = 'geoJsonFontSize';
    fontSizeInput.value = '13';
    fontSizeInput.min = '8';
    fontSizeInput.max = '24';
    fontSizeInput.style.width = '70%';
    fontSizeInput.style.padding = '5px';
    fontSizeContainer.appendChild(fontSizeLabel);
    fontSizeContainer.appendChild(fontSizeInput);

    fontStyleContainer.appendChild(fontColorContainer);
    fontStyleContainer.appendChild(fontSizeContainer);
    geoJsonSection.appendChild(fontStyleContainer);

    // Ward selector
    var wardLabel = document.createElement('label');
    wardLabel.textContent = 'Select Ward Number: ';
    wardLabel.style.display = 'block';
    wardLabel.style.marginBottom = '5px';
    geoJsonSection.appendChild(wardLabel);

    var wardSelect = document.createElement('select');
    wardSelect.id = 'geoJsonWardSelect';
    wardSelect.style.width = '100%';
    wardSelect.style.marginBottom = '10px';
    wardSelect.style.padding = '5px';

    // Add ward options 1-29
    for (let i = 1; i <= 29; i++) {
      let option = document.createElement('option');
      option.value = i;
      option.textContent = `Ward ${i}`;
      wardSelect.appendChild(option);
    }
    geoJsonSection.appendChild(wardSelect);

    // Load button
    var loadGeoJsonBtn = document.createElement('button');
    loadGeoJsonBtn.textContent = 'Load Buildings from URL';
    loadGeoJsonBtn.style.width = '100%';
    loadGeoJsonBtn.style.padding = '8px';
    loadGeoJsonBtn.style.marginBottom = '5px';
    loadGeoJsonBtn.style.cursor = 'pointer';
    loadGeoJsonBtn.title = 'Load building data from geonep.com.np';
    loadGeoJsonBtn.addEventListener('click', loadGeoJSONFromURL);
    geoJsonSection.appendChild(loadGeoJsonBtn);

    // Clear button
    var clearGeoJsonBtn = document.createElement('button');
    clearGeoJsonBtn.textContent = 'Clear Loaded Buildings';
    clearGeoJsonBtn.style.width = '100%';
    clearGeoJsonBtn.style.padding = '8px';
    clearGeoJsonBtn.style.cursor = 'pointer';
    clearGeoJsonBtn.title = 'Remove all loaded building layers';
    clearGeoJsonBtn.addEventListener('click', clearLoadedGeoJSON);
    geoJsonSection.appendChild(clearGeoJsonBtn);

    // Status display
    var geoJsonStatus = document.createElement('div');
    geoJsonStatus.id = 'geoJsonStatus';
    geoJsonStatus.style.marginTop = '10px';
    geoJsonStatus.style.fontSize = '12px';
    geoJsonStatus.style.fontStyle = 'italic';
    geoJsonSection.appendChild(geoJsonStatus);

    // --- GeoJSON Layer Shift Controls ---
    var geoJsonShiftContainer = document.createElement('div');
    geoJsonShiftContainer.style.marginTop = '15px';
    geoJsonShiftContainer.style.paddingTop = '10px';
    geoJsonShiftContainer.style.borderTop = '1px solid #ccc';

    var geoJsonShiftTitle = document.createElement('h4');
    geoJsonShiftTitle.textContent = 'GeoJSON Layer Shift Controls';
    geoJsonShiftTitle.style.fontSize = '13px';
    geoJsonShiftTitle.style.marginBottom = '10px';
    geoJsonShiftContainer.appendChild(geoJsonShiftTitle);

    // Layer selector for shift
    var geoJsonLayerSelectLabel = document.createElement('label');
    geoJsonLayerSelectLabel.textContent = 'Select Layer: ';
    geoJsonLayerSelectLabel.style.display = 'block';
    geoJsonLayerSelectLabel.style.marginBottom = '5px';
    geoJsonShiftContainer.appendChild(geoJsonLayerSelectLabel);

    var geoJsonLayerSelect = document.createElement('select');
    geoJsonLayerSelect.id = 'geoJsonLayerSelect';
    geoJsonLayerSelect.style.width = '100%';
    geoJsonLayerSelect.style.marginBottom = '10px';
    geoJsonLayerSelect.style.padding = '5px';
    var defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '-- Select a loaded layer --';
    geoJsonLayerSelect.appendChild(defaultOption);
    geoJsonShiftContainer.appendChild(geoJsonLayerSelect);

    // Shift distance input
    var geoJsonShiftDistLabel = document.createElement('label');
    geoJsonShiftDistLabel.textContent = 'Shift Distance (meters): ';
    geoJsonShiftDistLabel.style.display = 'block';
    geoJsonShiftDistLabel.style.marginBottom = '5px';
    geoJsonShiftContainer.appendChild(geoJsonShiftDistLabel);

    var geoJsonShiftDistInput = document.createElement('input');
    geoJsonShiftDistInput.type = 'number';
    geoJsonShiftDistInput.id = 'geoJsonShiftDistance';
    geoJsonShiftDistInput.value = '1'; // default 1 meter shift in direction of arrow clicked
    geoJsonShiftDistInput.min = '0';
    geoJsonShiftDistInput.step = '1';
    geoJsonShiftDistInput.style.width = '100%';
    geoJsonShiftDistInput.style.marginBottom = '10px';
    geoJsonShiftDistInput.style.padding = '5px';
    geoJsonShiftContainer.appendChild(geoJsonShiftDistInput);

    // Direction buttons for GeoJSON
    var geoJsonBtnUp = document.createElement('button');
    geoJsonBtnUp.textContent = '↑';
    geoJsonBtnUp.title = 'Shift Up';
    var geoJsonBtnDown = document.createElement('button');
    geoJsonBtnDown.textContent = '↓';
    geoJsonBtnDown.title = 'Shift Down';
    var geoJsonBtnLeft = document.createElement('button');
    geoJsonBtnLeft.textContent = '←';
    geoJsonBtnLeft.title = 'Shift Left';
    var geoJsonBtnRight = document.createElement('button');
    geoJsonBtnRight.textContent = '→';
    geoJsonBtnRight.title = 'Shift Right';

    // Diagonal buttons for GeoJSON
    var geoJsonBtnUpLeft = document.createElement('button');
    geoJsonBtnUpLeft.textContent = '↖';
    geoJsonBtnUpLeft.title = 'Shift Up-Left';
    var geoJsonBtnUpRight = document.createElement('button');
    geoJsonBtnUpRight.textContent = '↗';
    geoJsonBtnUpRight.title = 'Shift Up-Right';
    var geoJsonBtnDownLeft = document.createElement('button');
    geoJsonBtnDownLeft.textContent = '↙';
    geoJsonBtnDownLeft.title = 'Shift Down-Left';
    var geoJsonBtnDownRight = document.createElement('button');
    geoJsonBtnDownRight.textContent = '↘';
    geoJsonBtnDownRight.title = 'Shift Down-Right';

    // Reset button for GeoJSON
    var geoJsonBtnReset = document.createElement('button');
    geoJsonBtnReset.textContent = 'Reset';
    geoJsonBtnReset.title = 'Reset Shift';

    // Arrange buttons in a grid
    var geoJsonBtnGrid = document.createElement('div');
    geoJsonBtnGrid.style.display = 'grid';
    geoJsonBtnGrid.style.gridTemplateColumns = 'repeat(3, 1fr)';
    geoJsonBtnGrid.style.gap = '2px';
    geoJsonBtnGrid.style.marginBottom = '10px';
    geoJsonBtnGrid.appendChild(geoJsonBtnUpLeft);
    geoJsonBtnGrid.appendChild(geoJsonBtnUp);
    geoJsonBtnGrid.appendChild(geoJsonBtnUpRight);
    geoJsonBtnGrid.appendChild(geoJsonBtnLeft);
    var geoJsonEmptyCell = document.createElement('div');
    geoJsonBtnGrid.appendChild(geoJsonEmptyCell); // center cell empty
    geoJsonBtnGrid.appendChild(geoJsonBtnRight);
    geoJsonBtnGrid.appendChild(geoJsonBtnDownLeft);
    geoJsonBtnGrid.appendChild(geoJsonBtnDown);
    geoJsonBtnGrid.appendChild(geoJsonBtnDownRight);
    geoJsonShiftContainer.appendChild(geoJsonBtnGrid);

    // Reset button row
    var geoJsonResetRow = document.createElement('div');
    geoJsonResetRow.style.marginTop = '5px';
    geoJsonResetRow.appendChild(geoJsonBtnReset);
    geoJsonShiftContainer.appendChild(geoJsonResetRow);

    // Add event listeners for GeoJSON shift buttons
    geoJsonBtnUp.addEventListener('click', function () {
      shiftGeoJsonLayer('up');
    });
    geoJsonBtnDown.addEventListener('click', function () {
      shiftGeoJsonLayer('down');
    });
    geoJsonBtnLeft.addEventListener('click', function () {
      shiftGeoJsonLayer('left');
    });
    geoJsonBtnRight.addEventListener('click', function () {
      shiftGeoJsonLayer('right');
    });
    geoJsonBtnUpLeft.addEventListener('click', function () {
      shiftGeoJsonLayer('upleft');
    });
    geoJsonBtnUpRight.addEventListener('click', function () {
      shiftGeoJsonLayer('upright');
    });
    geoJsonBtnDownLeft.addEventListener('click', function () {
      shiftGeoJsonLayer('downleft');
    });
    geoJsonBtnDownRight.addEventListener('click', function () {
      shiftGeoJsonLayer('downright');
    });
    geoJsonBtnReset.addEventListener('click', function () {
      resetGeoJsonShift();
    });

    geoJsonSection.appendChild(geoJsonShiftContainer);

    tabPane.appendChild(geoJsonSection);

    fillWMSLayersSelectList();
    opacityRange.addEventListener('input', function () {
      var value = document.getElementById('WMSLayersSelect').value;
      if (value !== '' && value !== 'undefined') {
        var layer = W.map.getLayers().find(l => l.name === value) || null;
        if (!layer) return;
        layer.setOpacity(opacityRange.value / 100);
        document.getElementById('WMSOpacityLabel').textContent = 'Layer transparency: ' + document.getElementById('WMSOpacity').value + ' %';
      }
    });
    WMSSelect.addEventListener('change', function () {
      var selectedLayer = W.map.getLayers().filter((layer) => layer.name == WMSSelect.value)[0];
      if (selectedLayer) {
        opacityRange.value = selectedLayer.opacity * 100;
        document.getElementById('WMSOpacityLabel').textContent = 'Layer transparency: ' + document.getElementById('WMSOpacity').value + ' %';
      }
    });
    setZOrdering(WMSLayerTogglers);
    wmeSDK.Events.on({ eventName: 'wme-map-layer-added', eventHandler: fillWMSLayersSelectList });
    wmeSDK.Events.on({ eventName: 'wme-map-layer-removed', eventHandler: fillWMSLayersSelectList });
    wmeSDK.Events.on({ eventName: 'wme-map-layer-added', eventHandler: () => setZOrdering(WMSLayerTogglers) });
    wmeSDK.Events.on({ eventName: 'wme-map-layer-removed', eventHandler: () => setZOrdering(WMSLayerTogglers) });
    wmeSDK.Events.on({ eventName: 'wme-map-move-end', eventHandler: () => setZOrdering(WMSLayerTogglers) });
  }

  function fillWMSLayersSelectList() {
    const select = document.getElementById('WMSLayersSelect');
    const value = select.value;
    let htmlCode = '';
    W.map.getLayers().filter((layer) => layer.params?.SERVICE === 'WMS').forEach((layer) => (htmlCode += `<option value='${layer.name}'>${layer.name}</option><br>`));
    select.innerHTML = htmlCode;
    select.value = value;
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

  function addGroupToggler(isDefault, layerSwitcherGroupItemName, layerGroupVisibleName) {
    var group;
    if (isDefault === true) {
      group = document.getElementById(layerSwitcherGroupItemName).parentElement.parentElement;
    } else {
      var layerGroupsList = document.getElementsByClassName('list-unstyled togglers')[0];
      group = document.createElement('li');
      group.className = 'group';
      var togglerContainer = document.createElement('div');
      togglerContainer.className = 'layer-switcher-toggler-tree-category';
      var groupButton = document.createElement('wz-button');
      groupButton.color = 'clear-icon';
      groupButton.size = 'xs';
      var iCaretDown = document.createElement('i');
      iCaretDown.className = 'toggle-category w-icon w-icon-caret-down';
      iCaretDown.dataset.groupId = layerSwitcherGroupItemName.replace('layer-switcher-', '').toUpperCase();
      var togglerSwitch = document.createElement('wz-toggle-switch');
      togglerSwitch.className = layerSwitcherGroupItemName + ' hydrated';
      togglerSwitch.id = layerSwitcherGroupItemName;
      togglerSwitch.checked = true;
      var label = document.createElement('label');
      label.className = 'label-text';
      label.htmlFor = togglerSwitch.id;
      var togglerChildrenList = document.createElement('ul');
      togglerChildrenList.className = 'collapsible-' + layerSwitcherGroupItemName.replace('layer-switcher-', '').toUpperCase();
      label.appendChild(document.createTextNode(layerGroupVisibleName));
      groupButton.addEventListener('click', layerTogglerGroupMinimizerEventHandler(iCaretDown));
      togglerSwitch.addEventListener('click', layerTogglerGroupMinimizerEventHandler(iCaretDown));
      groupButton.appendChild(iCaretDown);
      togglerContainer.appendChild(groupButton);
      togglerContainer.appendChild(togglerSwitch);
      togglerContainer.appendChild(label);
      group.appendChild(togglerContainer);
      group.appendChild(togglerChildrenList);
      layerGroupsList.appendChild(group);
    }
    return group;
  }

  function addLayerToggler(groupToggler, layerName, isPublic, layerArray) {
    var layerToggler = {};
    layerToggler.layerName = layerName;
    layerToggler.serviceType =
      layerArray.filter(function (e) {
        return e.serviceType == 'XYZ';
      }).length > 0
        ? 'XYZ'
        : 'WMS';
    var layerShortcut = layerName.replace(/ /g, '_').replace('.', '');
    layerToggler.htmlItem = 'layer-switcher-item_' + layerShortcut;
    layerToggler.layerArray = layerArray;
    var layer_container = groupToggler.getElementsByTagName('UL')[0];
    var layerGroupCheckbox = groupToggler.getElementsByClassName('layer-switcher-toggler-tree-category')[0].getElementsByTagName('wz-toggle-switch')[0];
    var toggler = document.createElement('li');
    var togglerCheckbox = document.createElement('wz-checkbox');
    togglerCheckbox.id = layerToggler.htmlItem;
    togglerCheckbox.className = 'hydrated';
    var labelSymbol = document.createElement('span');
    labelSymbol.className = isPublic ? 'fa fa-location-arrow' : 'fa fa-lock';
    togglerCheckbox.appendChild(labelSymbol);
    togglerCheckbox.appendChild(document.createTextNode(layerName));
    toggler.appendChild(togglerCheckbox);
    layer_container.appendChild(toggler);
    for (var i = 0; i < layerArray.length; i++) {
      togglerCheckbox.addEventListener('change', layerTogglerEventHandler(layerArray[i]));
      layerGroupCheckbox.addEventListener('change', layerTogglerGroupEventHandler(togglerCheckbox, layerArray[i]));
      layerArray[i].layer.name = layerName + (layerArray.length > 1 ? ' ' + i : '');
    }
    registerKeyShortcut('WMS: ' + layerName, layerKeyShortcutEventHandler(layerGroupCheckbox, togglerCheckbox), layerShortcut);
    return layerToggler;
  }

  function registerKeyShortcut(actionName, callback, keyName) {
    I18n.translations[I18n.locale].keyboard_shortcuts.groups.default.members[keyName] = actionName;
    W.accelerators.addAction(keyName, { group: 'default' });
    W.accelerators.events.register(keyName, null, callback);
    W.accelerators._registerShortcuts({ ['name']: keyName });
  }

  function layerTogglerEventHandler(layerType) {
    return function () {
      if (this.checked) {
        W.map.addLayer(layerType.layer);
        layerType.layer.setVisibility(this.checked);
      } else {
        layerType.layer.setVisibility(this.checked);
        W.map.removeLayer(layerType.layer);
      }
    };
  }

  function layerKeyShortcutEventHandler(groupCheckbox, checkbox) {
    return function () {
      if (!groupCheckbox.disabled) {
        checkbox.click();
      }
    };
  }

  function layerTogglerGroupEventHandler(checkbox, layerType) {
    return function () {
      if (this.checked) {
        if (checkbox.checked) {
          W.map.addLayer(layerType.layer);
          layerType.layer.setVisibility(this.checked && checkbox.checked);
        }
      } else {
        if (checkbox.checked) {
          layerType.layer.setVisibility(this.checked && checkbox.checked);
          W.map.removeLayer(layerType.layer);
        }
      }
      checkbox.disabled = !this.checked;
    };
  }

  function layerTogglerGroupMinimizerEventHandler(iCaretDown) {
    return function () {
      var ulCollapsible = iCaretDown.parentElement.parentElement.parentElement.getElementsByTagName('UL')[0];
      if (!iCaretDown.classList.contains('upside-down')) {
        iCaretDown.classList.add('upside-down');
        ulCollapsible.classList.add('collapse-layer-switcher-group');
      } else {
        iCaretDown.classList.remove('upside-down');
        ulCollapsible.classList.remove('collapse-layer-switcher-group');
      }
    };
  }

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

  function getFullRequestString4326(newParams) {
    this.params.SRS = 'EPSG:4326';
    return OL.Layer.Grid.prototype.getFullRequestString.apply(this, arguments);
  }

  // Function to load GeoJSON from URL
  function loadGeoJSONFromURL() {
    const wardNo = document.getElementById('geoJsonWardSelect').value;
    const fontColor = document.getElementById('geoJsonFontColor').value;
    const fontSize = document.getElementById('geoJsonFontSize').value;
    const buildingUrl = `https://geonep.com.np/LMC/ajax/x_building.php?ward_no=${wardNo}`;
    const boundaryUrl = `https://geonep.com.np/LMC/ajax/x_ward_bnd.php?ward_no=${wardNo}`;
    const buildingLayerName = `LMC_Ward_${wardNo}_Buildings`;
    const boundaryLayerName = `LMC_Ward_${wardNo}_Boundary`;
    
    // Check if layers already exist
    const existingBuildingLayer = W.map.getLayers().filter(l => l.name === buildingLayerName);
    const existingBoundaryLayer = W.map.getLayers().filter(l => l.name === boundaryLayerName);
    if (existingBuildingLayer.length > 0 || existingBoundaryLayer.length > 0) {
      WazeToastr.Alerts.warning(
        scriptName,
        `Ward ${wardNo} layers already loaded`,
        false,
        false,
        3000
      );
      return;
    }
    
    updateGeoJsonStatus('Loading buildings and boundary...');
    console.log(`${scriptName}: Fetching buildings from ${buildingUrl}`);
    console.log(`${scriptName}: Fetching boundary from ${boundaryUrl}`);
    
    // Load buildings first
    GM_xmlhttpRequest({
      method: 'GET',
      url: buildingUrl,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 30000,
      onload: function(response) {
        if (response.status >= 200 && response.status < 300) {
          try {
            const geojsonData = JSON.parse(response.responseText);
            
            // Validate GeoJSON structure
            if (!geojsonData || !geojsonData.type || !geojsonData.features) {
              throw new Error('Invalid GeoJSON format');
            }
            
            if (geojsonData.features.length === 0) {
              throw new Error('No features found in GeoJSON');
            }
            
            console.log(`${scriptName}: Loaded ${geojsonData.features.length} building features`);
            
            // Create vector layer for buildings
            createGeoJSONVectorLayer(geojsonData, buildingLayerName, wardNo, fontColor, fontSize, 'buildings');
            
            // Now load the boundary
            loadWardBoundary(wardNo, boundaryUrl, boundaryLayerName, geojsonData.features.length);
            
          } catch (error) {
            console.error(`${scriptName}: Error parsing buildings GeoJSON:`, error);
            updateGeoJsonStatus(`Error: ${error.message}`);
            WazeToastr.Alerts.error(
              scriptName,
              `Failed to parse buildings GeoJSON: ${error.message}`,
              false,
              false,
              5000
            );
          }
        } else {
          const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
          console.error(`${scriptName}: ${errorMsg}`);
          updateGeoJsonStatus(`Error: ${errorMsg}`);
          WazeToastr.Alerts.error(
            scriptName,
            `Failed to load buildings data: ${errorMsg}`,
            false,
            false,
            5000
          );
        }
      },
      onerror: function(error) {
        console.error(`${scriptName}: Network error:`, error);
        updateGeoJsonStatus('Network error occurred');
        WazeToastr.Alerts.error(
          scriptName,
          'Network error: Unable to connect to geonep.com.np',
          false,
          false,
          5000
        );
      },
      ontimeout: function() {
        console.error(`${scriptName}: Request timeout`);
        updateGeoJsonStatus('Request timeout');
        WazeToastr.Alerts.error(
          scriptName,
          'Request timeout: Server took too long to respond',
          false,
          false,
          5000
        );
      }
    });
  }

  // Function to load ward boundary
  function loadWardBoundary(wardNo, boundaryUrl, boundaryLayerName, buildingCount) {
    GM_xmlhttpRequest({
      method: 'GET',
      url: boundaryUrl,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 30000,
      onload: function(response) {
        if (response.status >= 200 && response.status < 300) {
          try {
            const boundaryData = JSON.parse(response.responseText);
            
            // Validate GeoJSON structure
            if (!boundaryData || !boundaryData.type || !boundaryData.features) {
              throw new Error('Invalid boundary GeoJSON format');
            }
            
            console.log(`${scriptName}: Loaded ${boundaryData.features.length} boundary features`);
            
            // Create vector layer for boundary
            createGeoJSONVectorLayer(boundaryData, boundaryLayerName, wardNo, null, null, 'boundary');
            
            updateGeoJsonStatus(`Loaded ${buildingCount} buildings and boundary for Ward ${wardNo}`);
            WazeToastr.Alerts.success(
              scriptName,
              `Successfully loaded ${buildingCount} buildings and boundary for Ward ${wardNo}`,
              false,
              false,
              3000
            );
            
          } catch (error) {
            console.error(`${scriptName}: Error parsing boundary GeoJSON:`, error);
            updateGeoJsonStatus(`Loaded buildings but boundary failed: ${error.message}`);
            WazeToastr.Alerts.warning(
              scriptName,
              `Loaded buildings but boundary failed: ${error.message}`,
              false,
              false,
              5000
            );
          }
        } else {
          const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
          console.error(`${scriptName}: Boundary ${errorMsg}`);
          updateGeoJsonStatus(`Loaded buildings but boundary failed`);
          WazeToastr.Alerts.warning(
            scriptName,
            `Loaded buildings but boundary failed: ${errorMsg}`,
            false,
            false,
            5000
          );
        }
      },
      onerror: function(error) {
        console.error(`${scriptName}: Boundary network error:`, error);
        updateGeoJsonStatus('Buildings loaded, boundary network error');
        WazeToastr.Alerts.warning(
          scriptName,
          'Buildings loaded, but boundary failed to load',
          false,
          false,
          5000
        );
      },
      ontimeout: function() {
        console.error(`${scriptName}: Boundary request timeout`);
        updateGeoJsonStatus('Buildings loaded, boundary timeout');
        WazeToastr.Alerts.warning(
          scriptName,
          'Buildings loaded, but boundary request timeout',
          false,
          false,
          5000
        );
      }
    });
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

  // Function to create vector layer from GeoJSON
  function createGeoJSONVectorLayer(geojsonData, layerName, wardNo, fontColor, fontSize, layerType) {
    try {
      // Default values for building layers
      fontColor = fontColor || '#ffffff';
      fontSize = fontSize || '13';
      layerType = layerType || 'buildings';
      
      console.log(`${scriptName}: Creating ${layerType} vector layer for Ward ${wardNo}`);
      
      if (layerType === 'buildings') {
        console.log(`${scriptName}: Font settings - Color: ${fontColor}, Size: ${fontSize}px`);
      }
      
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
      
      // Create OpenLayers GeoJSON format reader
      const format = new OL.Format.GeoJSON({
        internalProjection: W.map.getProjectionObject(),
        externalProjection: new OL.Projection('EPSG:4326')
      });
      
      // Read features from GeoJSON as a complete FeatureCollection
      let features;
      try {
        // Pass the entire GeoJSON object as a string (OpenLayers 2 way)
        const geojsonString = typeof geojson === 'string' ? geojson : JSON.stringify(geojson);
        features = format.read(geojsonString);
        console.log(`${scriptName}: Successfully parsed features using format.read()`);
      } catch (parseError) {
        console.error(`${scriptName}: Primary GeoJSON parse error:`, parseError);
        console.log(`${scriptName}: Attempting alternative parsing method...`);
        
        // Alternative: parse each feature individually
        features = [];
        geojson.features.forEach(function(feature, index) {
          try {
            // Create a temporary FeatureCollection for each feature
            const singleFeatureCollection = {
              type: 'FeatureCollection',
              features: [feature]
            };
            const featureString = JSON.stringify(singleFeatureCollection);
            const parsedFeatures = format.read(featureString);
            
            if (parsedFeatures && parsedFeatures.length > 0) {
              features = features.concat(parsedFeatures);
            }
          } catch (e) {
            console.warn(`${scriptName}: Skipping feature ${index}:`, e);
          }
        });
      }
      
      console.log(`${scriptName}: Total features parsed: ${features ? features.length : 0}`);
      
      if (!features || features.length === 0) {
        throw new Error('No valid features could be parsed from GeoJSON');
      }
      
      // Define styles based on layer type
      let defaultStyle, selectStyle;
      
      if (layerType === 'boundary') {
        // Boundary layer style - prominent boundary lines
        defaultStyle = new OL.Style({
          strokeColor: '#FF0000',
          strokeWidth: 3,
          strokeOpacity: 0.9,
          fillColor: '#FF0000',
          fillOpacity: 0.05,
          pointRadius: 4,
          label: '',
        });
        selectStyle = new OL.Style({
          strokeColor: '#00FF00',
          strokeWidth: 4,
          fillColor: '#00FF00',
          fillOpacity: 0.05
        });
      } else {
        // Building layer style - with labels
        defaultStyle = new OL.Style({
          strokeColor: '#FF5722',
          strokeWidth: 2,
          strokeOpacity: 0.8,
          fillColor: '#FF5722',
          fillOpacity: 0.01,
          pointRadius: 4,
          label: '${custom_label}',
          labelAlign: 'cm',
          labelOutlineColor: '#000000',
          labelOutlineWidth: 3,
          fontSize: fontSize + 'px',
          fontWeight: 'bold',
          fontFamily: 'inherit',
          fontColor: fontColor,
        });
        selectStyle = new OL.Style({
          strokeColor: '#00BCD4',
          strokeWidth: 3,
          fillColor: '#00BCD4',
          fillOpacity: 0.01
        });
      }
      
      // Create vector layer with parsed features
      const vectorLayer = new OL.Layer.Vector(layerName, {
        displayInLayerSwitcher: false,
        uniqueName: layerName,
        projection: W.map.getProjectionObject(),
        styleMap: new OL.StyleMap({
          default: defaultStyle,
          select: selectStyle
        })
      });
      
      // Process features to handle null values in labels (only for building layers)
      if (layerType === 'buildings') {
        features.forEach(feature => {
          if (feature.attributes) {
            // Create a custom label by filtering out null/undefined values
            const labelParts = [];
              if (feature.attributes.metric_num !== null && feature.attributes.metric_num !== undefined) {
              labelParts.push(feature.attributes.metric_num);
              } else {
              // If metric_num is not available, skip the rest
              feature.attributes.custom_label = '';
              return;
              }
            if (feature.attributes.rd_naeng !== null && feature.attributes.rd_naeng !== undefined) {
              labelParts.push(feature.attributes.rd_naeng);
            }
            if (feature.attributes.rd_nanep !== null && feature.attributes.rd_nanep !== undefined) {
              // Convert Preeti font to Unicode
              const unicodeText = typeof preeti === 'function' ? preeti(feature.attributes.rd_nanep) : feature.attributes.rd_nanep;
              labelParts.push(unicodeText);
            }
            if (feature.attributes.tole_ne_en !== null && feature.attributes.tole_ne_en !== undefined) {
              labelParts.push(feature.attributes.tole_ne_en);
            }
            // Set the custom label attribute
            feature.attributes.custom_label = labelParts.join('\n');
          }
        });
      }
      
      // Add features to layer
      vectorLayer.addFeatures(features);
      console.log(`${scriptName}: Added ${features.length} features to vector layer`);
      
      // Add layer to map
      W.map.addLayer(vectorLayer);
      vectorLayer.setVisibility(true);
      
      // Set z-index based on layer type - boundaries below buildings
      if (layerType === 'boundary') {
        vectorLayer.setZIndex(ZIndexes.popup + 5);
      } else {
        vectorLayer.setZIndex(ZIndexes.popup + 10);
      }
      
      // Store reference for cleanup
      loadedGeoJSONLayers.push({
        layer: vectorLayer,
        name: layerName,
        wardNo: wardNo,
        layerType: layerType
      });
      
      // Update layer selector dropdown
      updateGeoJsonLayerSelector();
      
    } catch (error) {
      console.error(`${scriptName}: Error creating GeoJSON vector layer:`, error);
      WazeToastr.Alerts.error(
        scriptName,
        `Failed to create vector layer: ${error.message}`,
        false,
        false,
        5000
      );
      throw error;
    }
  }

  // Function to clear all loaded GeoJSON layers
  function clearLoadedGeoJSON() {
    if (loadedGeoJSONLayers.length === 0) {
      WazeToastr.Alerts.info(
        scriptName,
        'No building layers to clear',
        false,
        false,
        2000
      );
      return;
    }
    
    let removedCount = 0;
    loadedGeoJSONLayers.forEach(item => {
      if (item.layer) {
        W.map.removeLayer(item.layer);
        item.layer.destroy();
        removedCount++;
      }
    });
    
    loadedGeoJSONLayers = [];
    updateGeoJsonStatus('All building layers cleared');
    
    WazeToastr.Alerts.success(
      scriptName,
      `Removed ${removedCount} building layer(s)`,
      false,
      false,
      2000
    );
  }

  // Helper function to update status display
  function updateGeoJsonStatus(message) {
    const statusDiv = document.getElementById('geoJsonStatus');
    if (statusDiv) {
      statusDiv.textContent = message;
      statusDiv.style.color = message.includes('Error') ? '#f44336' : '#4CAF50';
    }
  }

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
    wmeSDK = unsafeWindow.getWmeSdk({ scriptId: 'nepali-wms-layers-beta', scriptName });
    console.log(`${scriptName} initialized.`);
scriptupdatemonitor();
    document.addEventListener('wme-map-data-loaded', init, { once: true });
  }

  unsafeWindow.SDK_INITIALIZED.then(bootstrap);
  /*
changeLog
2026.05.20.10
<strong>Added HNs:</strong><br>- Dhangadhi Sub Metropolitan City <br>- Ghodaghodi Municipality <br>- Nepalgunj Sub Metropolitan City<br><br>
2026.05.20.09
- Fixed issue where script fails to load. 
- Most of the code is currently using WMESDK and its equivalent APIs. 
2026-04-16.1
<strong>Fixed:</strong><br> - Compability with latest WME version.<br><br> - swapped W.map.olMap with W.map.getOLMap() to fix layers not showing up issue. <br><br> Thanks to davidsl4 to pointing out.
2026.02.06.06
- Added Preeti font to Unicode conversion for rd_nanep field
- Building labels now display Nepali text in proper Unicode format
2026.02.06.01
- Added feature: Load GeoJSON from URL (LMC Ward Buildings from geonep.com.np)
- New UI section to select ward number (1-29) and load building data
- Buildings display with house numbers as labels
- Clear button to remove all loaded GeoJSON layers
2025.11.29.01
- Added layers: Health Facilities from National Geoportal, Police Units from National Geoportal.
2025.08.30.01
- ZIndex update for : Education Facilities (PRTMP),<br> Health Facilities (PRTMP),<br> Palika Centre (PRTMP),<br> Ward Centre (PRTMP),<br> Tourist Attraction,<br> Customs Office <br> Bridges (BSM),<br> Bridges (PRTMP),<br> and Lalitpur Metropolitan City (LMC) layers.
version: 2025.07.27.1 - Added Layers:
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
version: 2025.07.24.01 - It now supports to display popup for highway with various information.
version: 2025.06.23.01 - Added diagonal (↖, ↗, ↙, ↘) shift buttons for WMS layers.
                       - Shows alert when the shift is reset to default.
version: 2025.06.08.01 - Now the WMS layer can be shifted by a specified distance in meters.
Version: 2025.06.06.02 - Added Bridge Management System bridge locations!
                       - Loaded layers will be reloaded even after the page refresh.
Version: 2025.06.06.01 - Added Bridge Management System bridge locations!
version: 2025.05.11.01 - Fixed Z-ordering
version: 2025.04.13.01 - Fixed Combatible with the latest wme beta v2.287-5! Now it monitors the script update!
version: 2025.03.06.01 - Now LMC HN can be filtered by ward
version: 2025.02.03.01 - Line modification
version: 2025.02.01.02 - Added support for WazeToastr update dialogue box
version: 2025.02.01.01 - Modified how WMS 4326 image is displayed
version: "1.0", message: "Initial Version"

*/
})();
