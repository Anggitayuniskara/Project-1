<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Denpasar Urban Heat Map</title>
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css">
<style>
  :root { --ink:#142720; --paper:#F5F6F1; --ochre:#C08A2E; --line:#D8DBCF; }
  * { box-sizing: border-box; }
  html, body { height:100%; margin:0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color:var(--ink); }
  #map { position:absolute; inset:0; }
  .panel { position:absolute; top:12px; left:12px; width:290px; max-width:calc(100% - 24px);
           background:var(--paper); border:1px solid var(--line); border-radius:10px; padding:14px; box-shadow:0 2px 10px rgba(0,0,0,.15); z-index:2; }
  .panel h1 { font-size:1rem; margin:0 0 4px; }
  .panel p { font-size:.78rem; margin:0 0 10px; line-height:1.4; }
  .toggle { display:flex; gap:6px; margin-bottom:10px; }
  .toggle button { flex:1; padding:6px 8px; border:1px solid var(--line); background:#fff; border-radius:6px; cursor:pointer; font-size:.8rem; }
  .toggle button.active { background:var(--ink); color:#fff; border-color:var(--ink); }
  .legend-bar { height:10px; border-radius:5px; margin:4px 0; }
  .legend-labels { display:flex; justify-content:space-between; font-size:.72rem; }
  .stats { margin-top:10px; font-size:.78rem; display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; text-align:center; }
  .stats div { background:#fff; border:1px solid var(--line); border-radius:6px; padding:6px 2px; }
  .stats b { display:block; font-size:.95rem; }
  .controls { margin-top:10px; font-size:.78rem; display:grid; gap:6px; }
  .controls label { display:flex; align-items:center; gap:8px; }
  .controls input[type=range] { flex:1; }
  .note { font-size:.7rem; opacity:.75; margin-top:2px; }
  .banner { display:none; margin-top:10px; padding:6px 8px; font-size:.72rem; background:#fff3d6; border:1px solid var(--ochre); border-radius:6px; }
  .banner.show { display:block; }
  .maplibregl-popup-content { font-size:.8rem; }
</style>
</head>
<body>
<div id="map"></div>

<div class="panel">
  <h1>Denpasar Urban Heat Map</h1>
  <p id="desc"></p>
  <div class="toggle">
    <button id="btn-lst" class="active">Surface temp. (LST)</button>
    <button id="btn-ndvi">Vegetation (NDVI)</button>
  </div>
  <div class="legend-bar" id="legend-bar"></div>
  <div class="legend-labels"><span id="lg-min"></span><span id="lg-unit"></span><span id="lg-max"></span></div>
  <div class="note" id="height-note"></div>
  <div class="stats">
    <div><b id="st-mean">-</b>mean</div>
    <div><b id="st-max">-</b>max</div>
    <div><b id="st-n">-</b>points</div>
  </div>
  <div class="controls">
    <label>Tinggi <input type="range" id="exag" min="0.2" max="2.5" step="0.1" value="1"> <span id="exag-val">1.0x</span></label>
    <label><input type="checkbox" id="chk-base"> Tampilkan bangunan basemap</label>
  </div>
  <div class="banner" id="demo-banner"><b>DEMO DATA.</b> Values are synthetic. Add <code>data/denpasar_points.geojson</code> exported from Google Earth Engine to show real data.</div>
</div>

<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script>
// ---------- Settings you may want to change ----------
const CENTER = [115.2126, -8.6705];          // [longitude, latitude]
const PERIOD = 'Jan - Sep 2026';              // must match filterDate in the Earth Engine script
const POINTS_FILE    = 'data/denpasar_points.geojson';     // required for real data
const AOI_FILE       = 'data/denpasar_aoi.geojson';        // optional boundary line
const BUILDINGS_FILE = 'data/denpasar_buildings.geojson';  // optional 3D buildings (needs LST/NDVI props)
const CELL_FILL = 0.9;   // ukuran kolom relatif terhadap jarak antar titik (0.9 = ada celah tipis)
// ------------------------------------------------------

// hmax = tinggi kolom (meter) di nilai maksimum legenda, sebelum dikali slider
const LAYERS = {
  LST:  { prop:'LST',  unit:'°C', min:24, max:42, hmax:350,
          colors:['#313695','#74add1','#fee090','#f46d43','#a50026'],
          desc:'Land surface temperature (Landsat 8), ' + PERIOD + '.', fmt:v=>v.toFixed(1)+' °C' },
  NDVI: { prop:'NDVI', unit:'index', min:0, max:0.8, hmax:350,
          colors:['#a50026','#fdae61','#ffffbf','#a6d96a','#1a9850'],
          desc:'Vegetation index NDVI (Landsat 8), ' + PERIOD + '.', fmt:v=>v.toFixed(2) }
};
let current = 'LST';
let exag = 1;
let data = null;
let baseBuildingLayers = [];

// Seeded random so the demo data is stable between reloads
function rng(seed){ return function(){ seed = (seed*16807)%2147483647; return (seed-1)/2147483646; }; }

function demoData(){
  const r = rng(42), feats = [];
  for(let i=0;i<2600;i++){
    const lon = 115.15 + r()*0.15, lat = -8.78 + r()*0.18;
    const d = Math.hypot((lon-CENTER[0])/0.06, (lat-CENTER[1])/0.07);
    const urban = Math.max(0, 1-d);
    const lst = 29 + 10*urban + (r()-0.5)*3;
    const ndvi = Math.max(0, 0.65 - 0.5*urban + (r()-0.5)*0.15);
    feats.push({type:'Feature', properties:{LST:+lst.toFixed(2), NDVI:+ndvi.toFixed(3)}, geometry:{type:'Point', coordinates:[lon,lat]}});
  }
  return {type:'FeatureCollection', features:feats};
}

const map = new maplibregl.Map({
  container:'map',
  style:'https://tiles.openfreemap.org/styles/liberty',
  center:CENTER, zoom:12, pitch:55, bearing:-20, maxPitch:80
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch:true }), 'top-right');
map.addControl(new maplibregl.ScaleControl(), 'bottom-left');

// ---- Expressions: warna dan tinggi sama-sama dari nilai LST / NDVI ----
function colorExpr(key){
  const L = LAYERS[key], n = L.colors.length - 1, stops = [];
  L.colors.forEach((c,i)=>{ stops.push(L.min + (L.max-L.min)*i/n, c); });
  return ['interpolate',['linear'],['get',L.prop],...stops];
}
function heightExpr(key){
  const L = LAYERS[key];
  return ['interpolate',['linear'],['get',L.prop], L.min, 5, L.max, L.hmax*exag];
}

// ---- Titik -> kotak (polygon) supaya bisa di-extrude ----
function estimateStep(fc){
  const pts = fc.features.map(f=>f.geometry.coordinates);
  const sample = pts.slice(0,400), nn = [];
  sample.forEach(a=>{
    let best = Infinity;
    for(const b of pts){
      if(a===b) continue;
      const d = Math.hypot(a[0]-b[0], a[1]-b[1]);
      if(d>0 && d<best) best = d;
    }
    if(isFinite(best)) nn.push(best);
  });
  nn.sort((x,y)=>x-y);
  return nn.length ? nn[Math.floor(nn.length/2)] : 0.001;
}

function toGrid(fc){
  const half = estimateStep(fc) * CELL_FILL / 2;
  const feats = [];
  fc.features.forEach(f=>{
    const p = f.properties || {};
    if(typeof p.LST !== 'number' || typeof p.NDVI !== 'number' || isNaN(p.LST) || isNaN(p.NDVI)) return;
    const [x,y] = f.geometry.coordinates;
    feats.push({ type:'Feature', properties:{LST:p.LST, NDVI:p.NDVI},
      geometry:{ type:'Polygon', coordinates:[[[x-half,y-half],[x+half,y-half],[x+half,y+half],[x-half,y+half],[x-half,y-half]]] }});
  });
  return { type:'FeatureCollection', features:feats };
}

function updateLegend(){
  const L = LAYERS[current];
  document.getElementById('legend-bar').style.background = 'linear-gradient(to right,'+L.colors.join(',')+')';
  document.getElementById('lg-min').textContent = L.min;
  document.getElementById('lg-max').textContent = L.max;
  document.getElementById('lg-unit').textContent = L.unit;
  document.getElementById('desc').textContent = L.desc;
  document.getElementById('height-note').textContent = 'Warna dan tinggi kolom sama-sama mengikuti ' + current + '.';
}

function updateStats(){
  const L = LAYERS[current];
  const v = data.features.map(f=>f.properties[L.prop]).filter(x=>typeof x==='number' && !isNaN(x));
  const mean = v.reduce((a,b)=>a+b,0)/v.length;
  document.getElementById('st-mean').textContent = L.fmt(mean);
  document.getElementById('st-max').textContent = L.fmt(Math.max(...v));
  document.getElementById('st-n').textContent = v.length;
}

function applyStyle(){
  if (map.getLayer('grid-3d')) {
    map.setPaintProperty('grid-3d','fill-extrusion-color', colorExpr(current));
    map.setPaintProperty('grid-3d','fill-extrusion-height', heightExpr(current));
  }
  if (map.getLayer('buildings-3d')) {
    map.setPaintProperty('buildings-3d','fill-extrusion-color', colorExpr(current));
  }
}

function setLayer(key){
  current = key;
  applyStyle();
  document.getElementById('btn-lst').classList.toggle('active', key==='LST');
  document.getElementById('btn-ndvi').classList.toggle('active', key==='NDVI');
  updateLegend(); updateStats();
}

function setBaseBuildings(show){
  baseBuildingLayers.forEach(id=>{
    map.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none');
  });
}

async function loadJSON(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error('missing ' + url);
  return res.json();
}

map.on('load', async ()=>{
  // 0. Bangunan 3D bawaan basemap: catat id-nya, sembunyikan default (tidak punya nilai LST/NDVI)
  baseBuildingLayers = map.getStyle().layers
    .filter(l => l.type === 'fill-extrusion')
    .map(l => l.id);
  setBaseBuildings(false);

  // 1. Main data (points of LST and NDVI)
  try {
    data = await loadJSON(POINTS_FILE);
  } catch(e) {
    data = demoData();
    document.getElementById('demo-banner').classList.add('show');
  }

  // 2. Zoom to the data (pitch/bearing dipertahankan)
  const b = new maplibregl.LngLatBounds();
  data.features.forEach(f => b.extend(f.geometry.coordinates));
  map.fitBounds(b, { padding:60, maxZoom:15, duration:0, pitch:55, bearing:-20 });

  // 3. Optional: bangunan sendiri (harus punya properti LST/NDVI + height)
  try {
    const bld = await loadJSON(BUILDINGS_FILE);
    map.addSource('bld', { type:'geojson', data: bld });
    map.addLayer({ id:'buildings-3d', type:'fill-extrusion', source:'bld', paint:{
      'fill-extrusion-color': colorExpr(current),
      'fill-extrusion-height': ['to-number', ['get','height'], 6],
      'fill-extrusion-opacity': 0.9 }});
  } catch(e) { /* optional file, ignore if missing */ }

  // 4. Kolom 3D: tinggi + warna dari LST / NDVI
  map.addSource('grid', { type:'geojson', data: toGrid(data) });
  map.addLayer({ id:'grid-3d', type:'fill-extrusion', source:'grid', paint:{
    'fill-extrusion-color': colorExpr(current),
    'fill-extrusion-height': heightExpr(current),
    'fill-extrusion-base': 0,
    'fill-extrusion-opacity': 0.88 }});

  // 5. Optional: boundary line
  try {
    const aoi = await loadJSON(AOI_FILE);
    map.addSource('aoi', { type:'geojson', data: aoi });
    map.addLayer({ id:'aoi-line', type:'line', source:'aoi',
      paint:{ 'line-color':'#142720', 'line-width':2 } });
  } catch(e) { /* optional file, ignore if missing */ }

  // 6. Pencahayaan supaya sisi kolom terlihat 3D
  map.setLight({ anchor:'viewport', position:[1.4, 200, 50], intensity:0.45, color:'#ffffff' });

  // 7. Popup on click
  map.on('click','grid-3d',e=>{
    const p = e.features[0].properties;
    new maplibregl.Popup().setLngLat(e.lngLat)
      .setHTML('<b>LST:</b> '+Number(p.LST).toFixed(1)+' °C<br><b>NDVI:</b> '+Number(p.NDVI).toFixed(2))
      .addTo(map);
  });
  map.on('mouseenter','grid-3d',()=>map.getCanvas().style.cursor='pointer');
  map.on('mouseleave','grid-3d',()=>map.getCanvas().style.cursor='');

  updateLegend(); updateStats();
});

document.getElementById('btn-lst').onclick  = ()=>setLayer('LST');
document.getElementById('btn-ndvi').onclick = ()=>setLayer('NDVI');
document.getElementById('exag').oninput = e=>{
  exag = parseFloat(e.target.value);
  document.getElementById('exag-val').textContent = exag.toFixed(1) + 'x';
  applyStyle();
};
document.getElementById('chk-base').onchange = e=>setBaseBuildings(e.target.checked);
</script>
</body>
</html>