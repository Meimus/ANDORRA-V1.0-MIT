import { useState, useRef, useCallback, useEffect, useImperativeHandle } from 'react';
import AccessibilityMapView from './AccessibilityMapView';
import PopulationMapView from './PopulationMapView';
import BaseMapView from './BaseMapView';
import GrowthMapView from './GrowthMapView';
import TourismMapView from './TourismMapView';
import AgentMapView from './AgentMapView';

const LAYERS = [
  { id: 'base',          label: 'Base' },
  { id: 'agents',        label: 'AGENTS' },
  { id: 'growth',        label: 'Growth' },
  { id: 'tourism',       label: 'Tourism' },
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'population',    label: 'Population' },
];

const IFRAME_LAYERS = {
  agents: '/andorra/map?embed',
};

// ── Leaflet-based layers (always mounted after first visit) ───────────────────
const LEAFLET_IDS = ['base', 'growth', 'tourism', 'accessibility', 'population'];

// ── Main component ────────────────────────────────────────────────────────────
export default function MapVisualization({
  overlayEnabled  = {},
  selectedYear    = 2049,
  activeLayer: activeLayerProp,
  onLayerChange,
  hoveredAgent    = -1,
  selectedAgent   = -1,
}) {
  // Internal fallback if no external state is provided (standalone usage)
  const [internalLayer, setInternalLayer] = useState('base');
  const activeLayer   = activeLayerProp ?? internalLayer;
  const setActiveLayer = onLayerChange ?? setInternalLayer;

  // Pre-seed all iframe layers so they mount immediately (avoids race in projector)
  const [everSeen, setEverSeen] = useState(
    Object.keys(IFRAME_LAYERS).reduce((acc, id) => ({ ...acc, [id]: true }), { base: true })
  );
  const timerRef = useRef(null);
  const agentsIframeRef = useRef(null);

  // Forward agent selection/hover into the agents map iframe
  useEffect(() => {
    if (selectedAgent < 0) return;
    agentsIframeRef.current?.contentWindow?.postMessage({ type: 'AGENT_SELECT', pos: selectedAgent }, '*');
  }, [selectedAgent]);

  useEffect(() => {
    if (hoveredAgent < 0) return;
    agentsIframeRef.current?.contentWindow?.postMessage({ type: 'AGENT_HOVER', pos: hoveredAgent }, '*');
  }, [hoveredAgent]);

  // When the external activeLayer changes (e.g. from Arduino encoder),
  // mark it as seen so it mounts
  useEffect(() => {
    if (activeLayer && !everSeen[activeLayer]) {
      setEverSeen(prev => ({ ...prev, [activeLayer]: true }));
    }
  }, [activeLayer]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchLayer = useCallback((id) => {
    if (id === activeLayer) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setActiveLayer(id);
    setEverSeen(prev => ({ ...prev, [id]: true }));
    timerRef.current = setTimeout(() => window.dispatchEvent(new Event('resize')), 80);
  }, [activeLayer, setActiveLayer]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>

      {/* Layer switcher — floats at the bottom of the map */}
      <div style={{
        position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: 6, flexWrap: 'wrap', zIndex: 20, pointerEvents: 'all',
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
        padding: '6px 10px', borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.10)',
      }}>
        {LAYERS.map(({ id, label }) => (
          <button key={id} type="button"
            className={`tab-button ${activeLayer === id ? 'active' : ''}`}
            style={{ fontSize:'10px', padding:'7px 14px' }}
            onClick={() => switchLayer(id)}>
            {label}
          </button>
        ))}
      </div>

      {/* Stacked map container — full viewport height */}
      <div style={{ position: 'relative', height: '100%' }}>

        {/* Leaflet maps — mounted on first visit, kept alive */}
        {LEAFLET_IDS.map(id => (
          <div key={id} style={{
            position:      'absolute',
            inset:         0,
            opacity:       activeLayer === id ? 1 : 0,
            pointerEvents: activeLayer === id ? 'auto' : 'none',
            transition:    'opacity 380ms ease',
            zIndex:        activeLayer === id ? 1 : 0,
          }}>
            {everSeen[id] && (
              id === 'base'          ? <BaseMapView /> :
              id === 'growth'        ? <GrowthMapView overlayEnabled={overlayEnabled} selectedYear={selectedYear} /> :
              id === 'tourism'       ? <TourismMapView /> :
              id === 'accessibility' ? <AccessibilityMapView /> :
                                       <PopulationMapView />
            )}
          </div>
        ))}

        {/* Iframe-based layers (ABM aerial view) */}
        {Object.entries(IFRAME_LAYERS).map(([id, src]) => (
          <div key={id} style={{
            position:      'absolute',
            inset:         0,
            opacity:       activeLayer === id ? 1 : 0,
            pointerEvents: activeLayer === id ? 'auto' : 'none',
            transition:    'opacity 380ms ease',
            zIndex:        activeLayer === id ? 1 : 0,
          }}>
            {everSeen[id] && (
              <iframe
                ref={id === 'agents' ? agentsIframeRef : undefined}
                src={src}
                title={id}
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                allow="clipboard-write"
              />
            )}
          </div>
        ))}

      </div>
    </div>
  );
}
