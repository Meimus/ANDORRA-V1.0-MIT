import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { addAndorraBoundary } from '../utils/andorraBoundary';

const PROJECTION_BOUNDS = [[42.394176, 1.393847], [42.697242, 1.803713]];

const LAYER_BTNS = [
  { key: 'ski',         label: 'Ski Resorts' },
  { key: 'peaks',       label: 'Peaks' },
  { key: 'refuges',     label: 'Refuges' },
  { key: 'attractions', label: 'Attractions' },
  { key: 'btt',         label: 'MTB Trails' },
  { key: 'cycling',     label: 'Cycling' },
  { key: 'corona',      label: 'Corona de Llacs' },
];

const INIT_VIS = {
  ski: true, peaks: true, refuges: true, attractions: true,
  btt: false, cycling: false, corona: false,
};

const STAGE_COLORS = ['#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#a855f7'];

const SKI_COLORS = {
  'Grandvalira':            { fill: '#93c5fd', stroke: '#60a5fa' },
  'Vallnord – Pal Arinsal': { fill: '#6ee7b7', stroke: '#34d399' },
  'Ordino Arcalís':         { fill: '#fde68a', stroke: '#fbbf24' },
  'Naturland':              { fill: '#fdba74', stroke: '#fb923c' },
};

// ── Snow System ───────────────────────────────────────────────────────────────
// Full game-style particle + peak-accumulation snow engine.
// Modes: 'summer' | 'winter' | 'cycle' (auto-cycles between seasons)
// ─────────────────────────────────────────────────────────────────────────────
class SnowSystem {
  constructor(canvas, map) {
    this.canvas    = canvas;
    this.ctx       = canvas.getContext('2d');
    this.map       = map;
    this.peaks     = [];
    this.particles = [];
    this.raf       = null;
    this.frame     = 0;

    // Season: 0 = full summer, 1 = full winter
    this.intensity  = 0;
    this.target     = 0;
    this.mode       = 'cycle';
    this.cycleFrame = 0;

    // Wind state
    this.wind        = 0;
    this.windTarget  = 0;

    this._resize();
  }

  _resize() {
    this.canvas.width  = this.canvas.offsetWidth  || 800;
    this.canvas.height = this.canvas.offsetHeight || 900;
  }

  setPeaks(peaks) {
    this.peaks = peaks.map(p => ({
      ...p,
      phase:  Math.random() * Math.PI * 2,
      jitter: 0.85 + Math.random() * 0.3,
    }));
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'summer') this.target = 0;
    if (mode === 'winter') this.target = 1;
    if (mode === 'cycle')  this.cycleFrame = 0;
  }

  getIntensity() { return this.intensity; }

  getSeasonLabel() {
    const i = this.intensity;
    if (i < 0.08)  return 'SUMMER';
    if (i < 0.38)  return 'AUTUMN';
    if (i < 0.65)  return 'EARLY WINTER';
    return 'WINTER';
  }

  // Cycle: summer(480f) → fade-in(300f) → winter(600f) → fade-out(300f) = 1680 frames
  _updateCycle() {
    const TOTAL  = 1680;
    const p      = this.cycleFrame % TOTAL;
    this.cycleFrame++;

    if      (p < 480)  this.target = 0;
    else if (p < 780)  this.target = (p - 480) / 300;
    else if (p < 1380) this.target = 1;
    else               this.target = 1 - (p - 1380) / 300;
  }

  _spawnFlakes() {
    const max = Math.floor(400 * this.intensity);
    const w   = this.canvas.width;

    while (this.particles.length < max) {
      const crystal = Math.random() < 0.22;
      this.particles.push({
        x:       Math.random() * (w + 60) - 30,
        y:       -(Math.random() * 60 + 5),
        vx:      (Math.random() - 0.5) * 0.45,
        vy:      0.22 + Math.random() * 0.95,
        r:       crystal ? (1.6 + Math.random() * 2.6) : (0.7 + Math.random() * 3.0),
        opacity: 0.42 + Math.random() * 0.58,
        wobble:  Math.random() * Math.PI * 2,
        wSpeed:  0.012 + Math.random() * 0.028,
        crystal,
        rot:     Math.random() * Math.PI,
        rotS:    (Math.random() - 0.5) * 0.018,
      });
    }
    if (this.particles.length > max + 40)
      this.particles.splice(0, this.particles.length - max);
  }

  _tick = () => {
    this.frame++;
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;

    if (this.mode === 'cycle') this._updateCycle();

    // Ease intensity — slower ease in cycle mode for smoother transitions
    const rate = this.mode === 'cycle' ? 0.0045 : 0.007;
    this.intensity += (this.target - this.intensity) * rate;

    // Wind shifts every ~3s
    if (this.frame % 185 === 0) this.windTarget = (Math.random() - 0.5) * 2.0;
    this.wind += (this.windTarget - this.wind) * 0.007;

    ctx.clearRect(0, 0, w, h);

    // Subtle winter blue-white tint over the whole map
    if (this.intensity > 0.02) {
      ctx.fillStyle = `rgba(190,212,255,${this.intensity * 0.065})`;
      ctx.fillRect(0, 0, w, h);
    }

    // Accumulated snow on peaks
    this._drawPeakSnow();

    // Falling snowflakes
    if (this.intensity > 0.02) {
      this._spawnFlakes();
      this._updateFlakes(w, h);
      this._drawFlakes();
    }

    this.raf = requestAnimationFrame(this._tick);
  };

  _drawPeakSnow() {
    if (this.intensity < 0.01) return;
    const { ctx, map, peaks, intensity, frame } = this;
    const cW = this.canvas.width, cH = this.canvas.height;

    for (const pk of peaks) {
      if (!pk.altitude) continue;
      try {
        const pt = map.latLngToContainerPoint([pk.lat, pk.lon]);
        if (pt.x < -120 || pt.x > cW + 120 || pt.y < -120 || pt.y > cH + 120) continue;

        // Snow covers peaks above 1600m; 2900m+ = fully covered
        const alt = Math.max(0, (pk.altitude - 1600) / 1300);
        if (alt <= 0) continue;

        const pulse = 0.91 + 0.09 * Math.sin(frame * 0.017 + pk.phase);
        const snow  = Math.min(1, intensity * alt * pk.jitter * pulse);
        if (snow < 0.015) continue;

        // Layer 1 — broad atmospheric haze
        const r3 = (9 + alt * 48) * snow;
        const g3 = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r3);
        g3.addColorStop(0,   `rgba(195,215,255,${0.11 * snow})`);
        g3.addColorStop(1,   'rgba(195,215,255,0)');
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r3, 0, Math.PI * 2);
        ctx.fillStyle = g3; ctx.fill();

        // Layer 2 — mid snow field
        const r2 = (4 + alt * 22) * snow;
        const g2 = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r2);
        g2.addColorStop(0,   `rgba(228,240,255,${0.58 * snow})`);
        g2.addColorStop(0.5, `rgba(218,233,255,${0.38 * snow})`);
        g2.addColorStop(1,   'rgba(210,228,255,0)');
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r2, 0, Math.PI * 2);
        ctx.fillStyle = g2; ctx.fill();

        // Layer 3 — bright snow cap
        const r1 = (2 + alt * 10) * snow;
        const g1 = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r1);
        g1.addColorStop(0,   `rgba(255,255,255,${Math.min(0.97, 0.72 * snow + 0.18)})`);
        g1.addColorStop(0.55,`rgba(240,248,255,${0.52 * snow})`);
        g1.addColorStop(1,   'rgba(220,234,255,0)');
        ctx.beginPath(); ctx.arc(pt.x, pt.y, r1, 0, Math.PI * 2);
        ctx.fillStyle = g1; ctx.fill();

        // Layer 4 — sparkle & cross-arms on high peaks only
        if (alt > 0.5 && snow > 0.45) {
          const spark   = ((alt - 0.5) / 0.5) * snow;
          const twinkle = 0.68 + 0.32 * Math.sin(frame * 0.075 + pk.phase * 3.1);
          const dotR    = 1.5 + alt * 3.8;

          ctx.beginPath();
          ctx.arc(pt.x, pt.y, dotR, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${spark * twinkle * 0.95})`;
          ctx.fill();

          // Four cross arms emanating from peak
          ctx.strokeStyle = `rgba(255,255,255,${spark * twinkle * 0.55})`;
          ctx.lineWidth   = 0.9;
          ctx.lineCap     = 'round';
          const arm = 4 + alt * 9;
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI;
            ctx.beginPath();
            ctx.moveTo(pt.x + Math.cos(a) * dotR,  pt.y + Math.sin(a) * dotR);
            ctx.lineTo(pt.x + Math.cos(a) * arm,   pt.y + Math.sin(a) * arm);
            ctx.stroke();
          }
        }
      } catch (_) {}
    }
  }

  _updateFlakes(w, h) {
    this.particles = this.particles.filter(p => {
      p.wobble += p.wSpeed;
      p.rot    += p.rotS;
      p.x      += p.vx + Math.sin(p.wobble) * 0.28 + this.wind * 0.13;
      p.y      += p.vy;
      return p.y < h + 25 && p.x > -35 && p.x < w + 35;
    });
  }

  _drawFlakes() {
    const { ctx, particles, intensity } = this;

    for (const p of particles) {
      const alpha = p.opacity * Math.min(1, intensity * 2.4);
      if (alpha < 0.04) continue;

      if (p.crystal) {
        // Detailed 6-pointed snowflake
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.82})`;
        ctx.lineWidth   = p.r * 0.38;
        ctx.lineCap     = 'round';

        for (let i = 0; i < 6; i++) {
          const a  = (i / 6) * Math.PI * 2;
          const ex = Math.cos(a) * p.r * 2.3;
          const ey = Math.sin(a) * p.r * 2.3;

          // Main arm
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(ex, ey); ctx.stroke();

          // Branch off the arm
          const mx = Math.cos(a) * p.r * 1.25;
          const my = Math.sin(a) * p.r * 1.25;
          const ba = a + Math.PI / 3;
          ctx.beginPath();
          ctx.moveTo(mx, my);
          ctx.lineTo(mx + Math.cos(ba) * p.r * 0.75, my + Math.sin(ba) * p.r * 0.75);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(mx, my);
          ctx.lineTo(mx + Math.cos(ba - Math.PI * 2 / 3) * p.r * 0.75,
                     my + Math.sin(ba - Math.PI * 2 / 3) * p.r * 0.75);
          ctx.stroke();
        }
        ctx.restore();
      } else {
        // Soft circular flake with gradient
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 1.9);
        g.addColorStop(0,   `rgba(255,255,255,${alpha})`);
        g.addColorStop(0.45,`rgba(242,250,255,${alpha * 0.65})`);
        g.addColorStop(1,   'rgba(255,255,255,0)');
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 1.9, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
      }
    }
  }

  start()   { if (!this.raf) this._tick(); }
  stop()    { cancelAnimationFrame(this.raf); this.raf = null; }
  resize()  { this._resize(); }
  destroy() { this.stop(); }
}

// ── Icon helpers ──────────────────────────────────────────────────────────────
function mkPeakIcon(altitude) {
  const label = altitude ? `${altitude}m` : '▲';
  return L.divIcon({
    html: `<div style="
      display:flex;flex-direction:column;align-items:center;
      pointer-events:none;
    ">
      <div style="
        width:0;height:0;
        border-left:7px solid transparent;
        border-right:7px solid transparent;
        border-bottom:12px solid rgba(255,255,255,0.92);
        filter:drop-shadow(0 1px 3px rgba(0,0,0,0.7));
      "></div>
      <div style="
        margin-top:2px;
        background:rgba(15,23,42,0.82);
        color:#e2e8f0;
        font-size:8.5px;font-weight:600;
        font-family:IBM Plex Mono,monospace;
        padding:1px 4px;border-radius:3px;
        white-space:nowrap;
        border:1px solid rgba(255,255,255,0.18);
        backdrop-filter:blur(2px);
      ">${label}</div>
    </div>`,
    className: '',
    iconSize: [46, 32],
    iconAnchor: [23, 12],
  });
}

function mkRefugeIcon() {
  return L.divIcon({
    html: `<div style="
      width:10px;height:10px;border-radius:50%;
      background:rgba(180,83,9,0.90);
      box-shadow:0 1px 4px rgba(0,0,0,0.6);
      border:1.5px solid rgba(255,200,100,0.6);
      pointer-events:none;
    "></div>`,
    className: '',
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
}

function mkAttractionIcon() {
  return L.divIcon({
    html: `<div style="
      width:10px;height:10px;border-radius:50%;
      background:rgba(109,40,217,0.88);
      box-shadow:0 1px 4px rgba(0,0,0,0.6);
      border:1.5px solid rgba(196,181,253,0.55);
      pointer-events:none;
    "></div>`,
    className: '',
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
}

// Strip interior rings so ski resort polygons render as solid fills, no holes
function stripHoles(geojson) {
  return {
    ...geojson,
    features: geojson.features.map(f => {
      if (!f.geometry) return f;
      const g = f.geometry;
      if (g.type === 'Polygon') {
        return { ...f, geometry: { ...g, coordinates: [g.coordinates[0]] } };
      }
      if (g.type === 'MultiPolygon') {
        return { ...f, geometry: { ...g, coordinates: g.coordinates.map(p => [p[0]]) } };
      }
      return f;
    }),
  };
}

// ── GeoJSON layer factory ─────────────────────────────────────────────────────
function buildLayer(key, data, snowRef) {
  if (key === 'ski') {
    // Dedicated canvas renderer — all piste polygons render at fillOpacity:1 on this canvas,
    // then the canvas element itself gets CSS opacity:0.38, giving a true union fill with no
    // compounding transparency between adjacent/overlapping piste sub-polygons.
    const renderer = L.canvas({ padding: 0.5 });
    snowRef._skiRenderer = renderer;

    return L.geoJSON(stripHoles(data), {
      renderer,
      style: feat => {
        const cfg = SKI_COLORS[feat.properties.name] || { fill: '#93c5fd', stroke: '#60a5fa' };
        return {
          fillColor:   cfg.fill,
          fillOpacity: 1,
          fillRule:    'nonzero',     // canvas renderer uses ctx.fill(fillRule||'evenodd') — nonzero fills self-intersecting rings correctly
          color:       'transparent',
          weight:      0,
          smoothFactor: 1,
        };
      },
      onEachFeature: (f, lyr) => {
        const p   = f.properties;
        const cfg = SKI_COLORS[p.name] || { fill: '#93c5fd', stroke: '#60a5fa' };
        lyr.on('mouseover', function () { this.setStyle({ color: cfg.stroke, weight: 2 }); });
        lyr.on('mouseout',  function () { this.setStyle({ color: 'transparent', weight: 0 }); });
        lyr.bindTooltip(
          `<div style="font-family:monospace;font-size:11px;line-height:1.7">
            <b style="color:${cfg.fill}">${p.name}</b><br/>
            ${p.pistes_km} km of pistes<br/>
            ${p.min_alt}–${p.max_alt} m<br/>
            <span style="color:#9ca3af">${p.sectors}</span>
          </div>`,
          { sticky: true, opacity: 0.97 }
        );
      },
    });
  }

  if (key === 'peaks') {
    const peaks = data.features
      .filter(f => f.geometry?.coordinates)
      .map(f => ({
        lon:      f.geometry.coordinates[0],
        lat:      f.geometry.coordinates[1],
        altitude: f.properties.altitude || 0,
      }));
    if (snowRef.current)        snowRef.current.setPeaks(peaks);
    snowRef._pendingPeaks = peaks;

    return L.geoJSON(data, {
      pointToLayer: (f, ll) => L.marker(ll, { icon: mkPeakIcon(f.properties.altitude) }),
      onEachFeature: (f, lyr) => {
        const p = f.properties;
        lyr.bindTooltip(
          `<div style="font-family:monospace;font-size:11px;line-height:1.7">
            <b style="color:#d1d5db">${p.name || '—'}</b><br/>
            ${p.altitude ? `${p.altitude} m` : ''}
            ${p.refugi ? `<br/><span style="color:#fcd34d">${p.refugi}</span>` : ''}
          </div>`,
          { sticky: true, opacity: 0.97 }
        );
      },
    });
  }

  if (key === 'refuges') {
    return L.geoJSON(data, {
      pointToLayer: (f, ll) => L.marker(ll, { icon: mkRefugeIcon() }),
      onEachFeature: (f, lyr) => {
        const p = f.properties;
        lyr.bindTooltip(
          `<div style="font-family:monospace;font-size:11px;line-height:1.7">
            <b style="color:#fcd34d">${p.name}</b><br/>
            ${p.tipus || ''} ${p.altitude ? `· ${p.altitude} m` : ''}<br/>
            ${p.calendari ? `<span style="color:#9ca3af">${p.calendari}</span>` : ''}
          </div>`,
          { sticky: true, opacity: 0.97 }
        );
      },
    });
  }

  if (key === 'attractions') {
    return L.geoJSON(data, {
      pointToLayer: (f, ll) => L.marker(ll, { icon: mkAttractionIcon() }),
      onEachFeature: (f, lyr) => {
        const p = f.properties;
        lyr.bindTooltip(
          `<div style="font-family:monospace;font-size:11px;line-height:1.7">
            <b style="color:#c4b5fd">${p.name}</b><br/>
            <span style="color:#9ca3af">${p.parish || ''}</span>
          </div>`,
          { sticky: true, opacity: 0.97 }
        );
      },
    });
  }

  if (key === 'btt') {
    return L.geoJSON(data, {
      style: { color: '#f97316', weight: 2, opacity: 0.75 },
      onEachFeature: (f, lyr) => {
        lyr.bindTooltip(
          `<div style="font-family:monospace;font-size:11px"><b style="color:#fb923c">${f.properties.name || 'BTT trail'}</b></div>`,
          { sticky: true, opacity: 0.97 }
        );
      },
    });
  }

  if (key === 'cycling') {
    return L.geoJSON(data, {
      style: { color: '#06b6d4', weight: 2, opacity: 0.75 },
      onEachFeature: (f, lyr) => {
        lyr.bindTooltip(
          `<div style="font-family:monospace;font-size:11px"><b style="color:#22d3ee">${f.properties.name || 'Cycling route'}</b></div>`,
          { sticky: true, opacity: 0.97 }
        );
      },
    });
  }

  if (key === 'corona') {
    return L.geoJSON(data, {
      style: feat => ({
        color:   STAGE_COLORS[(feat.properties.stage || 1) - 1] || '#f59e0b',
        weight:  3,
        opacity: 0.85,
      }),
      onEachFeature: (f, lyr) => {
        lyr.bindTooltip(
          `<div style="font-family:monospace;font-size:11px">
            <b style="color:#fcd34d">${f.properties.name || `Etapa ${f.properties.stage}`}</b><br/>
            <span style="color:#9ca3af">Corona de Llacs · Stage ${f.properties.stage}</span>
          </div>`,
          { sticky: true, opacity: 0.97 }
        );
      },
    });
  }

  return L.geoJSON(data);
}

// ── Season badge colours ──────────────────────────────────────────────────────
const SEASON_STYLE = {
  'SUMMER':       { bg: 'rgba(251,191,36,0.18)', border: '#fbbf24', text: '#fde68a',  icon: '' },
  'AUTUMN':       { bg: 'rgba(251,146,60,0.18)', border: '#fb923c', text: '#fed7aa',  icon: '' },
  'EARLY WINTER': { bg: 'rgba(147,197,253,0.18)',border: '#93c5fd', text: '#bfdbfe',  icon: '' },
  'WINTER':       { bg: 'rgba(191,219,254,0.22)',border: '#bfdbfe', text: '#eff6ff',  icon: '' },
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function TourismMapView() {
  const mapRef      = useRef(null);
  const canvasRef   = useRef(null);
  const instanceRef = useRef(null);
  const snowRef     = useRef(null);
  const layersRef   = useRef({});

  const [vis,         setVis]         = useState(INIT_VIS);
  const [seasonMode]                  = useState('cycle');
  const [seasonLabel, setSeasonLabel] = useState('SUMMER');
  const [snowActive]                  = useState(true);

  // ── Init map — locked (projection table: no zoom / no pan) ───────────────
  useEffect(() => {
    if (!mapRef.current || instanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [42.545709, 1.598780], zoom: 11,
      zoomSnap:        0,
      zoomControl:     false,
      attributionControl: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom:       false,
      boxZoom:         false,
      keyboard:        false,
      dragging:        false,
    });
    instanceRef.current = map;
    map.fitBounds(PROJECTION_BOUNDS, { padding: [0, 0] });
    map.on('resize', () => { map.invalidateSize(); map.fitBounds(PROJECTION_BOUNDS, { padding: [0, 0] }); });

    // Esri satellite
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 18 }
    ).addTo(map);
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 18, opacity: 0.6 }
    ).addTo(map);


    addAndorraBoundary(map);
    [
      [42.694543, 1.393847], [42.697242, 1.801074],
      [42.394176, 1.39849],  [42.396861, 1.803713],
    ].forEach(([lat, lon]) => {
      L.circleMarker([lat, lon], { radius: 5, fillColor: '#ff3333', color: '#ffffff', weight: 2, fillOpacity: 1 }).addTo(map);
    });

    const files = [
      { key: 'ski',         url: '/tourism_ski_areas.geojson' },
      { key: 'peaks',       url: '/tourism_peaks.geojson' },
      { key: 'refuges',     url: '/tourism_refuges.geojson' },
      { key: 'attractions', url: '/tourism_attractions.geojson' },
      { key: 'btt',         url: '/tourism_btt.geojson' },
      { key: 'cycling',     url: '/tourism_cycling.geojson' },
      { key: 'corona',      url: '/tourism_corona_llacs.geojson' },
    ];

    files.forEach(({ key, url }) => {
      fetch(url)
        .then(r => r.json())
        .then(data => {
          const layer = buildLayer(key, data, snowRef);
          layersRef.current[key] = layer;
          if (INIT_VIS[key]) layer.addTo(map);
          // Apply canvas-level CSS opacity for the ski layer union effect
          if (key === 'ski') {
            requestAnimationFrame(() => {
              const canvas = snowRef._skiRenderer?._container;
              if (canvas) canvas.style.opacity = '0.72';
            });
          }
        })
        .catch(err => console.warn(`tourism ${key}:`, err));
    });

    return () => { map.remove(); instanceRef.current = null; };
  }, []);

  // ── Layer visibility ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = instanceRef.current;
    if (!map) return;
    Object.entries(vis).forEach(([key, show]) => {
      const layer = layersRef.current[key];
      if (!layer) return;
      if (show) layer.addTo(map);
      else      map.removeLayer(layer);
    });
  }, [vis]);

  // ── Snow system init / toggle ─────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const map    = instanceRef.current;
    if (!canvas) return;

    if (snowActive) {
      if (!snowRef.current && map) {
        const sys = new SnowSystem(canvas, map);
        snowRef.current = sys;
        sys.setMode(seasonMode);
        if (snowRef._pendingPeaks) sys.setPeaks(snowRef._pendingPeaks);
      }
      if (snowRef.current) { snowRef.current.resize(); snowRef.current.start(); }
      canvas.style.display = 'block';
    } else {
      if (snowRef.current) snowRef.current.stop();
      canvas.style.display = 'none';
    }
  }, [snowActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Season mode changes ───────────────────────────────────────────────────
  useEffect(() => {
    if (snowRef.current) snowRef.current.setMode(seasonMode);
  }, [seasonMode]);

  // ── Poll season label from the animation engine ───────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      if (snowRef.current) setSeasonLabel(snowRef.current.getSeasonLabel());
    }, 400);
    return () => clearInterval(id);
  }, []);

  // ── Resize canvas on container resize ────────────────────────────────────
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (snowRef.current) snowRef.current.resize();
    });
    if (mapRef.current) ro.observe(mapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => { if (snowRef.current) snowRef.current.destroy(); }, []);

  const toggle = key => setVis(v => ({ ...v, [key]: !v[key] }));

  const sStyle = SEASON_STYLE[seasonLabel] || SEASON_STYLE['SUMMER'];

  return (
    <div style={{ position: 'relative', height: '100%' }}>

      {/* ── Controls pill — floating overlay at top-center ──────────── */}
      <div style={{
        position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
        zIndex: 1000, display: 'flex', gap: 6, flexWrap: 'wrap',
        alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
        padding: '6px 10px', borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.10)',
        maxWidth: 'calc(100% - 2rem)',
      }}>
        {/* Layer toggles */}
        {LAYER_BTNS.map(({ key, label }) => (
          <button
            key={key}
            className={`acc-layer-btn${vis[key] ? ' active' : ''}`}
            onClick={() => toggle(key)}
          >
            {label}
          </button>
        ))}

      </div>

      {/* ── Map + canvas — full coverage ─────────────────────────────── */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <div ref={mapRef} style={{ position: 'absolute', inset: 0, background: '#0d0d0d' }} />

        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            pointerEvents: 'none',
          }}
        />

        {/* Season badge — bottom-left of map */}
        {snowActive && (
          <div style={{
            position:    'absolute',
            bottom:      14,
            left:        14,
            zIndex:      1000,
            background:  sStyle.bg,
            border:      `1px solid ${sStyle.border}`,
            borderRadius: 6,
            padding:     '5px 12px',
            fontFamily:  'IBM Plex Mono, monospace',
            fontSize:    11,
            letterSpacing: '.1em',
            color:       sStyle.text,
            pointerEvents: 'none',
            display:     'flex',
            alignItems:  'center',
            gap:         6,
            backdropFilter: 'blur(4px)',
            transition:  'all 1.2s ease',
          }}>
            {seasonLabel}
            {seasonMode === 'cycle' && (
              <span style={{ opacity: 0.6, marginLeft: 4 }}>· AUTO</span>
            )}
          </div>
        )}
      </div>

      {/* ── Legend — overlay at bottom ───────────────────────────────── */}
      <div className="acc-map-legend" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 36, zIndex: 1000, flexWrap: 'nowrap', overflow: 'hidden', background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }}>
        <span className="acc-legend-item">
          <span className="acc-dot" style={{ background: '#60a5fa', borderRadius: 2, width: 14, height: 4 }} />
          Grandvalira
        </span>
        <span className="acc-legend-item">
          <span className="acc-dot" style={{ background: '#34d399', borderRadius: 2, width: 14, height: 4 }} />
          Vallnord
        </span>
        <span className="acc-legend-item">
          <span className="acc-dot" style={{ background: '#fbbf24', borderRadius: 2, width: 14, height: 4 }} />
          Arcalís
        </span>
        <span className="acc-legend-item">
          <span className="acc-dot" style={{ background: '#ffffff', borderRadius: 0, width: 14, height: 2, opacity: 0.5 }} />
          Andorra
        </span>
        <span className="acc-legend-item">
          <span className="acc-dot" style={{ background: '#475569', borderRadius: '50%' }} />
          Peak
        </span>
        <span className="acc-legend-item">
          <span className="acc-dot" style={{ background: '#92400e', borderRadius: '50%' }} />
          Refuge
        </span>
        <span className="acc-legend-item">
          <span className="acc-dot" style={{ background: '#6d28d9', borderRadius: '50%' }} />
          Attraction
        </span>
        <span className="acc-legend-item">
          <span className="acc-dot" style={{ background: '#f97316', borderRadius: 2 }} />
          MTB
        </span>
        <span className="acc-legend-item">
          <span className="acc-dot" style={{ background: '#06b6d4', borderRadius: 2 }} />
          Cycling
        </span>
        {STAGE_COLORS.map((c, i) => (
          <span key={i} className="acc-legend-item">
            <span className="acc-dot" style={{ background: c, borderRadius: 2 }} />
            {`E${i + 1}`}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: 'var(--muted)', letterSpacing: '.06em' }}>
          TOURISM · HOVER FOR DETAILS
        </span>
      </div>
    </div>
  );
}
