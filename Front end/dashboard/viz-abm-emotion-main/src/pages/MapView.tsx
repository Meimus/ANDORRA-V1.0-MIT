declare module '@deck.gl/react';
declare module '@deck.gl/layers';
declare module '@deck.gl/core';
declare module '@deck.gl/geo-layers';

import { useState, useEffect, useMemo, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer, BitmapLayer } from '@deck.gl/layers';
import { TripsLayer, TileLayer } from '@deck.gl/geo-layers';
import { WebMercatorViewport } from '@deck.gl/core';
import type { MapViewState } from '@deck.gl/core';
import styled from 'styled-components';
import { useSharedState } from '../services/SharedStateContext';
import { SharedControlPanel } from '../components/SharedControlPanel';

const MapContainer = styled.div`
  width: 100vw;
  height: 100vh;
  position: relative;
  background: #0d0d0d;
  overflow: hidden;
`;

interface TripData {
  agentId: string;
  agentType: string;
  emotion: string;
  transport: string;
  location: string;
  path: Array<[number, number]>;
  timestamps: Array<number>;
}

interface ScatterLayerData {
  agentId: string;
  agentType: string;
  emotion: string;
  transport: string;
  location: string;
  position: [number, number];
}

// Physical projection bounds — four corners of the 120×120 cm 3D table:
//   a: lon=1.393847 lat=42.694543  (NW)
//   b: lon=1.801074 lat=42.697242  (NE)
//   c: lon=1.39849  lat=42.394176  (SW)
//   d: lon=1.803713 lat=42.396861  (SE)
const PROJECTION_BOUNDS: [[number, number], [number, number]] = [
  [1.393847, 42.394176],   // SW corner (min lon, min lat)
  [1.803713, 42.697242],   // NE corner (max lon, max lat)
];

const FALLBACK_VIEW_STATE: MapViewState = {
  longitude: 1.598780,
  latitude:  42.545709,
  zoom: 10.9,
  pitch: 0,
  bearing: 0,
};

// Keystone calibration dots — one at each physical projector corner
const KEYSTONE_DOTS = [
  { position: [1.393847, 42.694543] as [number, number] },  // NW
  { position: [1.801074, 42.697242] as [number, number] },  // NE
  { position: [1.39849,  42.394176] as [number, number] },  // SW
  { position: [1.803713, 42.396861] as [number, number] },  // SE
];

// NW → NE → SE → SW (clockwise)
const MASK_CORNERS: [number, number][] = [
  [1.393847, 42.694543],
  [1.801074, 42.697242],
  [1.803713, 42.396861],
  [1.39849,  42.394176],
];

function MapView() {
  const { state, loadSimulationData, setFollowedAgent } = useSharedState();
  const [time, setTime] = useState(0);
  const [viewState, setViewState] = useState<MapViewState>(FALLBACK_VIEW_STATE);
  const [maskPoints, setMaskPoints] = useState<string | null>(null);
  const deckContainerRef = useRef<HTMLDivElement>(null);
  const DeckGLAny: any = DeckGL;

  useEffect(() => {
    loadSimulationData();
  }, []);

  // Listen for AGENT_SELECT / AGENT_HOVER forwarded from MapVisualization
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const setFollowedAgentRef = useRef(setFollowedAgent);
  useEffect(() => { setFollowedAgentRef.current = setFollowedAgent; }, [setFollowedAgent]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const agents = stateRef.current.simulationData?.agents;
      if (!agents?.length) return;
      if (e.data?.type === 'AGENT_SELECT') {
        const pos = e.data.pos as number;
        const idx = ((pos % agents.length) + agents.length) % agents.length;
        const agent = agents[idx];
        if (!agent) return;
        const step = stateRef.current.currentStep;
        const emotion   = agent.emotion[Math.min(step, agent.emotion.length - 1)] ?? 'green';
        const transport = agent.transport_method[Math.min(step, agent.transport_method.length - 1)] ?? 'foot';
        setFollowedAgentRef.current(
          stateRef.current.followedAgent?.agentId === agent.agent_id
            ? null
            : { agentId: agent.agent_id, agentType: agent.type, emotion, transport }
        );
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Recompute view to fit the physical projection bounds whenever the canvas resizes
  useEffect(() => {
    const el = deckContainerRef.current;
    if (!el) return;
    const fit = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      try {
        const vp = new WebMercatorViewport({ width, height });
        const fitted = vp.fitBounds(PROJECTION_BOUNDS, { padding: 0 });
        setViewState({ longitude: fitted.longitude, latitude: fitted.latitude, zoom: fitted.zoom, pitch: 0, bearing: 0 });
      } catch {
        setViewState(FALLBACK_VIEW_STATE);
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Recompute SVG mask corners whenever viewState changes
  useEffect(() => {
    const el = deckContainerRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (!width || !height) return;
    try {
      const vp = new WebMercatorViewport({ width, height, ...viewState });
      const pts = MASK_CORNERS.map(([lon, lat]) => {
        const [x, y] = vp.project([lon, lat]);
        return `${x},${y}`;
      });
      setMaskPoints(pts.join(' '));
    } catch {}
  }, [viewState]);

  useEffect(() => {
    if (state.currentStep > 0) {
      const interpolatedTime = state.currentStep + (state.currentInterpolationStep / 40);
      setTime(interpolatedTime);
    }
  }, [state.currentStep, state.currentInterpolationStep]);


  const layers = useMemo(() => {
    // Keystone calibration dots — always rendered regardless of simulation state
    const keystoneLayer = new ScatterplotLayer({
      id: 'keystone-corners',
      data: KEYSTONE_DOTS,
      getPosition: (d: any) => d.position,
      getFillColor: [255, 51, 51, 230] as [number, number, number, number],
      getLineColor: [255, 255, 255, 255] as [number, number, number, number],
      getLineWidth: 2,
      getRadius: 8,
      radiusUnits: 'pixels',
      radiusMinPixels: 6,
      radiusMaxPixels: 10,
      stroked: true,
    } as any);

    // Free ESRI satellite base + reference labels
    const satelliteTiles = new TileLayer({
      id: 'satellite-tiles',
      data: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      minZoom: 0,
      maxZoom: 19,
      tileSize: 256,
      renderSubLayers: (props: any) => {
        const { bbox: { west, south, east, north } } = props.tile;
        return new BitmapLayer(props, {
          data: undefined,
          image: props.data,
          bounds: [west, south, east, north],
        });
      },
    });

    const labelTiles = new TileLayer({
      id: 'label-tiles',
      data: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      minZoom: 0,
      maxZoom: 19,
      tileSize: 256,
      renderSubLayers: (props: any) => {
        const { bbox: { west, south, east, north } } = props.tile;
        return new BitmapLayer(props, {
          data: undefined,
          image: props.data,
          bounds: [west, south, east, north],
        });
      },
    });

    if (!state.simulationData?.agents) return [satelliteTiles, labelTiles, keystoneLayer];

    const tripData: TripData[] = state.simulationData.agents.map(agent => ({
      agentId: agent.agent_id,
      agentType: agent.type,
      emotion: agent.emotion[agent.step],
      transport: agent.transport_method[agent.step],
      location: `[${agent.path[agent.step][0].toFixed(4)}, ${agent.path[agent.step][1].toFixed(4)}]`,
      path: agent.path,
      timestamps: agent.path.map((_: any, i: number) => i * 40),
    }));

    const scatterData: ScatterLayerData[] = state.simulationData.agents.map(agent => {
      if (!agent.path || agent.path.length === 0) {
        return { agentId: agent.agent_id, agentType: 'red', emotion: 'unknown', transport: 'unknown', location: '[0, 0]', position: [0, 0] as [number, number] };
      }

      const currentPathIndex = Math.min(Math.floor(time), agent.path.length - 1);
      const nextPathIndex = Math.min(currentPathIndex + 1, agent.path.length - 1);
      const currentPos = agent.path[currentPathIndex];
      const nextPos = agent.path[nextPathIndex];
      const interpolationFactor = state.currentInterpolationStep / 40;
      const interpolatedPosition: [number, number] = [
        currentPos[0] + (nextPos[0] - currentPos[0]) * interpolationFactor,
        currentPos[1] + (nextPos[1] - currentPos[1]) * interpolationFactor,
      ];

      const currentEmotion = agent.emotion?.[currentPathIndex] || 'unknown';
      const currentTransport = agent.transport_method?.[currentPathIndex] || 'unknown';

      return {
        agentId: agent.agent_id,
        agentType: agent.type,
        emotion: currentEmotion,
        transport: currentTransport,
        location: `[${interpolatedPosition[0].toFixed(4)}, ${interpolatedPosition[1].toFixed(4)}]`,
        position: interpolatedPosition,
      };
    });

    const agentLayers = [
      new TripsLayer({
        id: 'trips',
        data: tripData,
        currentTime: state.currentStep * 40 + state.currentInterpolationStep,
        getPath: (d: TripData) => d.path ?? [],
        getTimestamps: (d: TripData) => d.timestamps ?? [],
        getColor: (d: TripData) => {
          const transportColors: Record<string, [number, number, number]> = {
            foot:    [255, 255, 255],
            bicycle: [255, 87,  51],
            car:     [51,  161, 255],
            bus:     [51,  255, 87],
            train:   [255, 51,  233],
          };
          return transportColors[d.transport] || [128, 128, 128];
        },
        opacity: 0.7,
        widthMinPixels: 3,
        rounded: true,
        fadeTrail: true,
        trailLength: 50,
        shadowEnabled: false,
      }),

      new ScatterplotLayer({
        id: 'emotion-indicators',
        data: scatterData,
        pickable: true,
        opacity: 0.8,
        radiusUnits: 'pixels',
        radiusMinPixels: 2,
        radiusMaxPixels: 5,
        getRadius: 3,
        getPosition: (d: ScatterLayerData) => d.position,
        getFillColor: (d: ScatterLayerData) => {
          const emotionColors: Record<string, [number, number, number]> = {
            green:  [52,  211, 153],  // ENJOYMENT  #34d399
            red:    [248, 113, 113],  // ANGER      #f87171
            purple: [192, 132, 252],  // CONTEMPT   #c084fc
            blue:   [96,  165, 250],  // SADNESS    #60a5fa
            yellow: [251, 191, 36 ],  // DISGUST    #fbbf24
            orange: [251, 146, 60 ],  // FEAR       #fb923c
          };
          return emotionColors[d.emotion] || [128, 128, 128];
        },
        getLineColor: [255, 255, 255] as [number, number, number],
        getLineWidth: 1,
      } as any),

      // Bright solid dot + outer ring for the followed agent — renders on top
      ...(state.followedAgent ? (() => {
        const followed = scatterData.filter((d: ScatterLayerData) => d.agentId === state.followedAgent?.agentId);
        return [
          // Outer ring — white halo
          new ScatterplotLayer({
            id: 'followed-ring-outer',
            data: followed,
            getPosition: (d: ScatterLayerData) => d.position,
            getFillColor: [0, 0, 0, 0] as [number, number, number, number],
            getLineColor: [255, 255, 255, 255] as [number, number, number, number],
            lineWidthUnits: 'pixels',
            getLineWidth: 3,
            getRadius: 22,
            radiusUnits: 'pixels',
            radiusMinPixels: 18,
            radiusMaxPixels: 28,
            stroked: true,
            filled: false,
          } as any),
          // Middle ring — yellow accent for strong contrast
          new ScatterplotLayer({
            id: 'followed-ring-inner',
            data: followed,
            getPosition: (d: ScatterLayerData) => d.position,
            getFillColor: [0, 0, 0, 0] as [number, number, number, number],
            getLineColor: [251, 191, 36, 255] as [number, number, number, number],
            lineWidthUnits: 'pixels',
            getLineWidth: 2,
            getRadius: 14,
            radiusUnits: 'pixels',
            radiusMinPixels: 11,
            radiusMaxPixels: 18,
            stroked: true,
            filled: false,
          } as any),
          // Bright inner dot
          new ScatterplotLayer({
            id: 'followed-dot',
            data: followed,
            getPosition: (d: ScatterLayerData) => d.position,
            getFillColor: [255, 255, 255, 255] as [number, number, number, number],
            getLineColor: [0, 0, 0, 220] as [number, number, number, number],
            lineWidthUnits: 'pixels',
            getLineWidth: 1,
            getRadius: 7,
            radiusUnits: 'pixels',
            radiusMinPixels: 6,
            radiusMaxPixels: 10,
            stroked: true,
            filled: true,
          } as any),
        ];
      })() : []),
    ];

    return [satelliteTiles, labelTiles, ...agentLayers, keystoneLayer];
  }, [state.simulationData, time, state.currentStep, state.currentInterpolationStep, state.followedAgent]);

  return (
    <MapContainer>
      {/* DeckGL canvas — full coverage, control panel overlaid on top */}
      <div ref={deckContainerRef} style={{ position: 'absolute', inset: 0 }}>
        <DeckGLAny
          viewState={viewState}
          controller={false}
          layers={layers}
          style={{ width: '100%', height: '100%' }}
          getTooltip={({ object }: { object: any }) => {
            if (!object) return null;
            return {
              html: `
                <div><strong>Agent:</strong> ${object.agentId}</div>
                <div><strong>Emotion:</strong> ${object.emotion}</div>
                <div><strong>Transport:</strong> ${object.transport}</div>
              `,
              style: {
                background: 'rgba(10,10,15,0.9)',
                color: '#e5e7eb',
                fontSize: '11px',
                padding: '6px 10px',
                fontFamily: "'IBM Plex Mono', monospace",
                borderRadius: '4px',
                border: '1px solid #1f2937',
              },
            };
          }}
        />
      </div>

      {/* Black mask outside the 4 keystone corners */}
      {maskPoints && (
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 5 }}>
          <defs>
            <mask id="deckMask">
              <rect width="100%" height="100%" fill="white" />
              <polygon points={maskPoints} fill="black" />
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="black" mask="url(#deckMask)" />
        </svg>
      )}

      <SharedControlPanel />

      {/* Color legend overlay */}
      <div style={{
        position: 'absolute', bottom: 16, right: 16, zIndex: 10,
        background: 'rgba(10,10,15,0.85)', border: '1px solid #1f2937',
        borderRadius: 6, padding: '8px 12px',
        fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: '#9ca3af',
        display: 'flex', gap: 16, pointerEvents: 'none',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.12em', color: '#6b7280', marginBottom: 2 }}>DOT — EMOTION</div>
          {[
            { color: '#34d399', label: 'ENJOYMENT' },
            { color: '#f87171', label: 'ANGER' },
            { color: '#fb923c', label: 'FEAR' },
            { color: '#60a5fa', label: 'SADNESS' },
            { color: '#c084fc', label: 'CONTEMPT' },
            { color: '#fbbf24', label: 'DISGUST' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 9, letterSpacing: '0.06em' }}>{label}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.12em', color: '#6b7280', marginBottom: 2 }}>TRAIL — TRANSPORT</div>
          {[
            { color: '#ffffff', label: 'FOOT' },
            { color: '#ff5733', label: 'BICYCLE' },
            { color: '#33a1ff', label: 'CAR' },
            { color: '#33ff57', label: 'BUS' },
            { color: '#ff33e9', label: 'TRAIN' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 16, height: 3, borderRadius: 2, background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 9, letterSpacing: '0.06em' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </MapContainer>

  );
}

export default MapView;
