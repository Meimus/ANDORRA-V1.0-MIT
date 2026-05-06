/**
 * AgentAnalyticsView
 * ─────────────────────────────────────────────────────────────────────────────
 * Embedded in the main Andorra dashboard as a single iframe.
 * Left 55%  → face animation, emotion sphere, real-time chat
 * Right 45% → agent list sidebar + full Follow Agent detail (profile, radar,
 *              mood history, conversation)
 *
 * One React tree, one SharedStateProvider, one data load.
 */

import { useMemo, useState, useRef, useEffect } from 'react';
import styled from 'styled-components';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  LineChart, Line, CartesianGrid,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer, BitmapLayer, PathLayer } from '@deck.gl/layers';
import { TileLayer } from '@deck.gl/geo-layers';
import type { MapViewState } from '@deck.gl/core';
import { useSharedState } from '../services/SharedStateContext';
import HABMSentiments from '../components/HABMSentiments';
import AgentVisualizationToggle from '../components/AgentVisualizationToggle';
import RealTimeChat from '../components/RealTimeChat';

const DeckGLAny: any = DeckGL;

// ── Constants ─────────────────────────────────────────────────────────────────

const EKMAN_COLORS: Record<string, string> = {
  ANGER:    '#f87171',  // rose
  CONTEMPT: '#c084fc',  // violet
  DISGUST:  '#fbbf24',  // amber
  ENJOYMENT:'#34d399',  // emerald
  FEAR:     '#fb923c',  // amber-orange
  SADNESS:  '#60a5fa',  // sky blue
  SURPRISE: '#f472b6',  // pink
};

const EKMAN_ORDER = ['ANGER','CONTEMPT','DISGUST','ENJOYMENT','FEAR','SADNESS','SURPRISE'];

const COLOR_TO_EKMAN: Record<string, string> = {
  red:    'ANGER',
  purple: 'CONTEMPT',
  green:  'ENJOYMENT',
  blue:   'SADNESS',
  orange: 'FEAR',
  yellow: 'DISGUST',
};

const TYPE_COLORS: Record<string, string> = {
  blue:   '#5ba8f5',  // sky, distinct from sadness blue
  red:    '#f26d63',  // warm coral
  purple: '#b98ef7',  // lavender
  orange: '#f7aa52',  // warm amber
  green:  '#2ed4a4',  // cyan-teal
  Adult:  '#2ed4a4',
  Carlos: '#2ed4a4',
  Elena:  '#7ec8f9',
};

const AGENT_TYPES = ['blue', 'red', 'green', 'orange', 'purple'];

// ── Fake name generator ───────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Marc','Joan','Pere','Antoni','Jordi','Pau','Ricard','Guillem','Xavier','Andreu',
  'Ferran','Albert','Arnau','Bernat','Clàudia','Aina','Miriam','Laia','Marta','Rosa',
  'Sophie','Emma','Léa','Clara','Juliette','Antoine','Nicolas','Pierre','Thomas','Hugo',
  'Carlos','Miguel','Diego','Álvaro','Sergio','Elena','Sofía','Carmen','Laura','Lucía',
  'Maria','Anna','Núria','Montserrat','Carme','Irene','David','Daniel','Luc','Nathalie',
];

const LAST_NAMES = [
  'Martínez','García','López','Sánchez','González','Rodríguez','Fernández','Torres',
  'Pérez','Álvarez','Puig','Serra','Mas','Pons','Vila','Roca','Bosch','Coll',
  'Durand','Moreau','Simon','Laurent','Bernard','Dubois','Thomas','Robert',
  'Casal','Badia','Salvat','Farré','Planes','Solà','Valls','Font','Miró',
  'Vilaró','Xalabarder','Bartumeu','Alís','Barba','Bonnet','Mercier','Girard',
];

const SPECIAL_NAMES: Record<string, string> = {
  Carlos: 'Carlos García',
  Elena:  'Elena Bartumeu',
};

function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function getFakeName(agentId: string): string {
  if (SPECIAL_NAMES[agentId]) return SPECIAL_NAMES[agentId];
  const h = hashStr(agentId);
  return `${FIRST_NAMES[h % FIRST_NAMES.length]} ${LAST_NAMES[(h >>> 4) % LAST_NAMES.length]}`;
}

const PERSONALITIES = [
  'Extroverted','Introverted','Ambivert','Analytical','Creative',
  'Pragmatic','Empathetic','Assertive','Independent','Social',
];

const OCCUPATIONS = [
  'Tourism Manager','Retail Merchant','Financial Advisor','Ski Instructor',
  'Hotel Manager','Teacher','Doctor','Engineer','Government Official',
  'Real Estate Agent','Restaurant Owner','IT Specialist','Nurse',
  'Border Guard','Chef','Banker','Pharmacist','Architect','Lawyer','Accountant',
];

function getFakeAge(agentId: string): number {
  const h = hashStr(agentId + 'age');
  return 18 + (h % 55); // 18–72
}

function getFakePersonality(agentId: string): string {
  const h = hashStr(agentId + 'pers');
  return PERSONALITIES[h % PERSONALITIES.length];
}

function getFakeOccupation(agentId: string): string {
  const h = hashStr(agentId + 'occ');
  return OCCUPATIONS[h % OCCUPATIONS.length];
}

// ── Design tokens (matches main dashboard index.css) ──────────────────────────

const BG    = '#1e1e1e';
const SURF  = '#272727';
const SURF2 = '#303030';
const BDR   = '#444';
const LBL   = '#888';
const TXT   = '#ccc';
const ACT   = '#eee';
const FONT  = `'IBM Plex Mono', monospace`;

const Wrapper = styled.div`
  display: flex;
  height: 100vh;
  width: 100%;
  overflow: hidden;
  background: ${BG};
  font-family: ${FONT};
`;

// ── Left side ─────────────────────────────────────────────────────────────────

const LeftPane = styled.div`
  flex: 0 0 45%;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: ${BG};
  font-family: ${FONT};
  color: ${TXT};
  border-right: 1px solid ${BDR};
`;

const LeftHeader = styled.div`
  display: flex;
  align-items: center;
  padding: 0 1.2rem;
  height: 44px;
  border-bottom: 1px solid ${BDR};
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: ${LBL};
  gap: 1rem;
`;

const TopContainer = styled.div`
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: ${BDR};
  min-height: 0;
`;

const BottomContainer = styled.div`
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 1px;
  background: ${BDR};
  min-height: 0;
`;

const LeftPanel = styled.div`
  background: ${BG};
  padding: 1rem 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  overflow: hidden;
`;

const PanelLabel = styled.div`
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.14em;
  color: ${LBL};
  text-transform: uppercase;
  border-bottom: 1px solid ${BDR};
  padding-bottom: 6px;
  margin-bottom: 2px;
  flex-shrink: 0;
`;

const InfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 12px;
  padding: 2px 0;
  span:first-child { color: ${LBL}; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
  span:last-child  { color: ${ACT}; font-weight: 500; }
`;

// ── Right side ────────────────────────────────────────────────────────────────

const RightPane = styled.div`
  flex: 0 0 55%;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: ${BG};
  font-family: ${FONT};
  color: ${TXT};
`;

const RightHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0 1.2rem;
  height: 44px;
  border-bottom: 1px solid ${BDR};
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: ${LBL};
`;

const RightBody = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
`;

// ── Agent list sidebar ────────────────────────────────────────────────────────

const ListSidebar = styled.div`
  width: 200px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid ${BDR};
  overflow: hidden;
  background: ${BG};
`;

const SidebarHeader = styled.div`
  padding: 8px 12px 7px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.14em;
  color: ${LBL};
  text-transform: uppercase;
  border-bottom: 1px solid ${BDR};
  flex-shrink: 0;
`;

const FilterRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 10px;
  border-bottom: 1px solid ${BDR};
  flex-shrink: 0;
`;

const FilterChip = styled.button<{ $active: boolean; $color: string }>`
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid ${p => p.$active ? p.$color : BDR};
  background: ${p => p.$active ? `${p.$color}22` : 'transparent'};
  color: ${p => p.$active ? p.$color : LBL};
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  letter-spacing: 0.08em;
  transition: all 0.12s;
  &:hover { border-color: ${p => p.$color}; color: ${p => p.$color}; }
`;

const AgentList = styled.div`
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  scrollbar-width: thin;
  scrollbar-color: ${BDR} transparent;
  padding: 4px 0;
`;

const AgentCard = styled.div<{ $selected: boolean; $color: string; $hovered?: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 4px;
  margin: 0 5px;
  border: 1px solid ${p => p.$selected ? p.$color : p.$hovered ? '#555' : 'transparent'};
  background: ${p => p.$selected ? `${p.$color}28` : p.$hovered ? SURF2 : 'transparent'};
  box-shadow: ${p => p.$selected ? `inset 3px 0 0 ${p.$color}` : 'none'};
  cursor: pointer;
  transition: all 0.12s;
  &:hover {
    background: ${p => p.$selected ? `${p.$color}38` : SURF};
    border-color: ${p => p.$selected ? p.$color : BDR};
  }
`;

const AgentDot = styled.div<{ $color: string }>`
  width: 6px; height: 6px; border-radius: 50%;
  background: ${p => p.$color}; flex-shrink: 0;
`;

// ── Detail panel ──────────────────────────────────────────────────────────────

const DetailPane = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  background: ${BG};
`;

const DetailScroll = styled.div`
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: ${BDR};
  scrollbar-width: thin;
  scrollbar-color: ${BDR} transparent;
`;

const Block = styled.div`
  background: ${BG};
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
`;

const BlockTitle = styled.div`
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.14em;
  color: ${LBL};
  text-transform: uppercase;
  border-bottom: 1px solid ${BDR};
  padding-bottom: 6px;
  margin-bottom: 2px;
  flex-shrink: 0;
`;

const ProfileRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 12px;
  padding: 2px 0;
  span:first-child { color: ${LBL}; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
  span:last-child  { color: ${ACT}; font-weight: 500; }
`;

const MoodBar = styled.div<{ $value: number; $color: string }>`
  height: 4px;
  border-radius: 2px;
  background: ${p => p.$color};
  width: ${p => Math.max(2, p.$value * 100)}%;
  transition: width 0.3s ease;
`;

const MoodRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: ${LBL};
  letter-spacing: 0.06em;
  .label { width: 76px; flex-shrink: 0; text-transform: uppercase; }
  .bar-wrap { flex: 1; background: ${SURF2}; border-radius: 2px; overflow: hidden; height: 4px; }
  .val { width: 34px; text-align: right; flex-shrink: 0; color: ${TXT}; }
`;

const ReleaseBtn = styled.button`
  padding: 6px 0;
  border-radius: 6px;
  border: 1px solid ${BDR};
  background: transparent;
  color: ${LBL};
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  &:hover { border-color: #777; color: ${TXT}; }
`;

const SelectBtn = styled.button`
  padding: 7px 18px;
  border-radius: 999px;
  border: 1px solid ${BDR};
  background: transparent;
  color: ${LBL};
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  &:hover { border-color: #777; color: ${TXT}; }
`;

const MapBox = styled.div`
  height: 260px;
  flex-shrink: 0;
  position: relative;
  background: #111;
  border-bottom: 1px solid ${BDR};
`;

const MapLabel = styled.div`
  position: absolute;
  top: 8px;
  left: 10px;
  z-index: 10;
  font-family: ${FONT};
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${TXT};
  background: rgba(0,0,0,0.7);
  padding: 3px 8px;
  border-radius: 4px;
  pointer-events: none;
`;

const ConvList = styled.div`
  overflow-y: auto;
  max-height: 200px;
  padding: 4px 0;
  scrollbar-width: thin;
  scrollbar-color: ${BDR} transparent;
`;

const ConvLine = styled.div<{ $isSelf: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: ${p => p.$isSelf ? 'flex-end' : 'flex-start'};
  margin-bottom: 6px;
`;

const ConvBubble = styled.div<{ $isSelf: boolean }>`
  background: ${p => p.$isSelf ? `${SURF2}` : `${SURF}`};
  border: 1px solid ${BDR};
  border-radius: 8px;
  padding: 5px 10px;
  font-size: 12px;
  color: ${TXT};
  max-width: 90%;
  line-height: 1.5;
`;

const ConvTs = styled.div`
  font-size: 11px;
  color: ${LBL};
  letter-spacing: 0.06em;
`;

// ── Follow-map (close-up DeckGL, no Mapbox token) ────────────────────────────

const ESRI_SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_LABELS    = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

function makeTile(id: string, url: string) {
  return new TileLayer({
    id,
    data: url,
    minZoom: 0,
    maxZoom: 19,
    tileSize: 256,
    renderSubLayers: (props: any) => {
      const { bbox: { west, south, east, north } } = props.tile;
      return new BitmapLayer(props, { data: undefined, image: props.data, bounds: [west, south, east, north] });
    },
  });
}

function FollowMap() {
  const { state } = useSharedState();
  const step  = state.currentStep;
  const iStep = state.currentInterpolationStep;

  const agentData = useMemo(() => {
    if (!state.followedAgent || !state.simulationData?.agents) return null;
    return state.simulationData.agents.find(a => a.agent_id === state.followedAgent?.agentId) ?? null;
  }, [state.followedAgent, state.simulationData]);

  const position = useMemo((): [number, number] | null => {
    if (!agentData?.path?.length) return null;
    const max = agentData.path.length - 1;
    const cur = Math.min(step, max);
    const nxt = Math.min(cur + 1, max);
    const a = agentData.path[cur];
    const b = agentData.path[nxt];
    if (!a || !b) return null;
    const t = iStep / 40;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }, [agentData, step, iStep]);

  const [viewState, setViewState] = useState<MapViewState>({
    longitude: 1.601, latitude: 42.546, zoom: 17, pitch: 0, bearing: 0,
  });

  useEffect(() => {
    if (!position) return;
    setViewState(v => ({ ...v, longitude: position[0], latitude: position[1], transitionDuration: 80 }));
  }, [position?.[0], position?.[1]]);

  const layers = useMemo(() => {
    const base = [makeTile('sat', ESRI_SATELLITE), makeTile('lbl', ESRI_LABELS)];
    if (!agentData?.path?.length) return base;

    const pathLayer = new PathLayer({
      id: 'agent-path',
      data: [{ path: agentData.path }],
      getPath: (d: any) => d.path,
      getColor: [255, 200, 0, 180],
      getWidth: 3,
      widthMinPixels: 2,
      widthMaxPixels: 5,
      rounded: true,
    });

    const dotLayer = position
      ? new ScatterplotLayer({
          id: 'agent-dot',
          data: [{ position }],
          getPosition: (d: any) => d.position,
          getFillColor: [255, 255, 255, 240],
          getLineColor: [0, 0, 0, 200],
          getLineWidth: 2,
          getRadius: 8,
          radiusMinPixels: 6,
          radiusMaxPixels: 12,
          stroked: true,
        })
      : null;

    return dotLayer ? [...base, pathLayer, dotLayer] : [...base, pathLayer];
  }, [agentData, position]);

  if (!state.followedAgent || !agentData) return null;

  const ekman = COLOR_TO_EKMAN[state.followedAgent.emotion] ?? state.followedAgent.emotion;
  const eColor = EKMAN_COLORS[ekman] ?? '#9ca3af';

  return (
    <MapBox>
      <MapLabel style={{ color: eColor }}>
        ◉ {state.followedAgent.agentId} · {ekman} · {state.followedAgent.transport}
      </MapLabel>
      <DeckGLAny
        viewState={viewState}
        controller={false}
        onViewStateChange={({ viewState: vs }: { viewState: MapViewState }) => setViewState(vs)}
        layers={layers}
        style={{ position: 'absolute', inset: 0 }}
      />
    </MapBox>
  );
}

// ── Left panel ────────────────────────────────────────────────────────────────

function VisualizationLeft() {
  const { state } = useSharedState();
  const [currentEmotion, setCurrentEmotion] = useState('happy');
  const lastEmotionChangeTime = useRef(Date.now());

  const agentMoodVector = useMemo(() => {
    if (!state.followedAgent || !state.simulationData?.agents) return undefined;
    const agent = state.simulationData.agents.find(a => a.agent_id === state.followedAgent?.agentId);
    if (!agent) return undefined;
    const stepIndex = Math.min(state.currentStep, agent.mood_vector.length - 1);
    return agent.mood_vector[stepIndex];
  }, [state.followedAgent, state.simulationData, state.currentStep]);

  const displayEmotion = useMemo(() => {
    if (state.followedAgent) return state.followedAgent.emotion;
    if (!state.simulationData?.agents) return 'calm';
    const counts: Record<string, number> = {};
    state.simulationData.agents.forEach(a => {
      const e = a.emotion[Math.min(state.currentStep, a.emotion.length - 1)] ?? 'green';
      counts[e] = (counts[e] || 0) + 1;
    });
    return Object.entries(counts).reduce((a, b) => b[1] > a[1] ? b : a, ['green', 0])[0];
  }, [state.followedAgent, state.simulationData, state.currentStep]);

  useEffect(() => {
    if (!agentMoodVector) return;
    const sad   = agentMoodVector[2] ?? 0;
    const happy = agentMoodVector[0] ?? 0;
    const angry = agentMoodVector[1] ?? 0;
    const newEmotion = sad > happy && sad > angry ? 'sad'
      : angry > happy && angry > sad ? 'angry'
      : 'happy';
    const now = Date.now();
    if (newEmotion !== currentEmotion && now - lastEmotionChangeTime.current >= 15000) {
      setCurrentEmotion(newEmotion);
      lastEmotionChangeTime.current = now;
    }
  }, [agentMoodVector, currentEmotion]);

  const videoPath = useMemo(() => {
    const agentId = state.followedAgent?.agentId || 'Carlos';
    return `/faces/${agentId}/${currentEmotion}.mp4`;
  }, [currentEmotion, state.followedAgent]);

  const agentDetails = useMemo(() => {
    if (!state.followedAgent) return { id: 'None', age: '—', personality: '—', occupation: '—' };
    const id = state.followedAgent.agentId;
    return {
      id,
      age:         getFakeAge(id),
      personality: getFakePersonality(id),
      occupation:  getFakeOccupation(id),
    };
  }, [state.followedAgent]);

  const habmAgents = useMemo(() => {
    if (!state.simulationData?.agents) return [];
    return state.simulationData.agents.map(agent => ({
      id: agent.agent_id,
      emotions: {
        insecure: agent.emotion[agent.step] === 'purple' ? 1 : 0,
        energize: agent.emotion[agent.step] === 'blue'   ? 1 : 0,
        threaten: agent.emotion[agent.step] === 'red'    ? 1 : 0,
        stress:   agent.emotion[agent.step] === 'orange' ? 1 : 0,
        calm:     agent.emotion[agent.step] === 'green'  ? 1 : 0,
      },
    }));
  }, [state.simulationData, state.currentStep]);

  const fakeName = state.followedAgent ? getFakeName(state.followedAgent.agentId) : null;
  const followedEkman = state.followedAgent ? (COLOR_TO_EKMAN[state.followedAgent.emotion] ?? state.followedAgent.emotion) : null;
  const followedColor = followedEkman ? (EKMAN_COLORS[followedEkman] ?? '#9ca3af') : '#9ca3af';

  return (
    <LeftPane>
      <LeftHeader>
        AGENT ANALYTICS
        {fakeName && <span style={{ color: followedColor, fontWeight: 700 }}>→ {fakeName}</span>}
        {followedEkman && <span style={{ color: followedColor, marginLeft: 'auto' }}>{followedEkman}</span>}
      </LeftHeader>

      <TopContainer>
        <LeftPanel>
          <PanelLabel>Agent Profile</PanelLabel>
          <InfoRow>
            <span>NAME</span>
            <span style={{ color: followedColor || '#e5e7eb' }}>{fakeName ?? '—'}</span>
          </InfoRow>
          <InfoRow><span>ID</span><span>{agentDetails.id}</span></InfoRow>
          <InfoRow><span>AGE</span><span>{agentDetails.age}</span></InfoRow>
          <InfoRow><span>PERSONALITY</span><span>{agentDetails.personality}</span></InfoRow>
          <InfoRow><span>OCCUPATION</span><span>{agentDetails.occupation}</span></InfoRow>
          {state.followedAgent && (
            <>
              <InfoRow>
                <span>EMOTION</span>
                <span style={{ color: followedColor }}>{followedEkman}</span>
              </InfoRow>
              <InfoRow>
                <span>TRANSPORT</span>
                <span>{state.followedAgent.transport}</span>
              </InfoRow>
            </>
          )}
        </LeftPanel>
        <AgentVisualizationToggle
          videoPath={videoPath}
          emotion={displayEmotion}
          moodVector={agentMoodVector}
        />
      </TopContainer>

      <BottomContainer>
        <RealTimeChat />
        <LeftPanel>
          <PanelLabel>Population Emotion Distribution</PanelLabel>
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <HABMSentiments agents={habmAgents} />
          </div>
        </LeftPanel>
      </BottomContainer>
    </LeftPane>
  );
}

// ── Right panel ───────────────────────────────────────────────────────────────

function FollowAgentRight() {
  const { state, setFollowedAgent } = useSharedState();
  const agents = state.simulationData?.agents ?? [];
  const step   = state.currentStep;
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const [encoderHoverIdx, setEncoderHoverIdx] = useState(-1);
  const agentListRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() =>
    typeFilter ? agents.filter(a => a.type === typeFilter) : agents,
  [agents, typeFilter]);

  const handleFollow = (agentId: string) => {
    const agent = agents.find(a => a.agent_id === agentId);
    if (!agent) return;
    const emotion   = agent.emotion[Math.min(step, agent.emotion.length - 1)] ?? 'green';
    const transport = agent.transport_method[Math.min(step, agent.transport_method.length - 1)] ?? 'foot';
    setFollowedAgent(
      state.followedAgent?.agentId === agentId
        ? null
        : { agentId, agentType: agent.type, emotion, transport }
    );
  };

  // Stable listener via ref — re-registers only once, always reads latest agents/handleFollow
  const msgHandlerRef = useRef<((e: MessageEvent) => void) | null>(null);
  msgHandlerRef.current = (e: MessageEvent) => {
    if (!agents.length) return;
    if (e.data?.type === 'AGENT_HOVER') {
      const pos = e.data.pos as number;
      const idx = ((pos % agents.length) + agents.length) % agents.length;
      setEncoderHoverIdx(idx);
    } else if (e.data?.type === 'AGENT_SELECT') {
      const pos = e.data.pos as number;
      const idx = ((pos % agents.length) + agents.length) % agents.length;
      setEncoderHoverIdx(-1);
      handleFollow(agents[idx].agent_id);
    }
  };

  useEffect(() => {
    const handler = (e: MessageEvent) => msgHandlerRef.current?.(e);
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    if (encoderHoverIdx < 0 || !agentListRef.current) return;
    const cards = agentListRef.current.querySelectorAll('[data-agent-card]');
    const card = cards[encoderHoverIdx] as HTMLElement | undefined;
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [encoderHoverIdx]);

  // Data for the detail panel
  const followedAgentData = useMemo(() => {
    if (!state.followedAgent) return null;
    return agents.find(a => a.agent_id === state.followedAgent?.agentId) ?? null;
  }, [state.followedAgent, agents]);

  const moodVectorData = useMemo(() => {
    if (!followedAgentData) return [];
    const vec = followedAgentData.mood_vector[Math.min(step, followedAgentData.mood_vector.length - 1)];
    if (!vec) return [];
    return EKMAN_ORDER.map((name, i) => ({
      name,
      value: +(vec[i] ?? 0),
      fullValue: (vec[i] ?? 0) * 100,
      color: EKMAN_COLORS[name],
    }));
  }, [followedAgentData, step]);

  const radarData = useMemo(() =>
    moodVectorData.map(d => ({ emotion: d.name.slice(0, 3), value: +(d.value * 100).toFixed(1) })),
  [moodVectorData]);

  const moodHistory = useMemo(() => {
    if (!followedAgentData) return [];
    const history = [];
    const start = Math.max(0, step - 29);
    for (let s = start; s <= step; s++) {
      const vec = followedAgentData.mood_vector[Math.min(s, followedAgentData.mood_vector.length - 1)];
      if (!vec) continue;
      const row: Record<string, number> = { step: s };
      EKMAN_ORDER.forEach((k, i) => { row[k] = +((vec[i] ?? 0) * 100).toFixed(1); });
      history.push(row);
    }
    return history;
  }, [followedAgentData, step]);

  const pathProgress = useMemo(() => {
    if (!followedAgentData?.path?.length) return 0;
    return Math.min(1, step / (followedAgentData.path.length - 1));
  }, [followedAgentData, step]);

  const pickRandom = () => {
    if (!agents.length) return;
    const a = agents[Math.floor(Math.random() * agents.length)];
    const emotion   = a.emotion[Math.min(step, a.emotion.length - 1)] ?? 'green';
    const transport = a.transport_method[Math.min(step, a.transport_method.length - 1)] ?? 'foot';
    setFollowedAgent({ agentId: a.agent_id, agentType: a.type, emotion, transport });
  };

  const f = state.followedAgent;
  const currentEkman = f ? (COLOR_TO_EKMAN[f.emotion] ?? f.emotion) : null;
  const typeColor    = f ? (TYPE_COLORS[f.agentType] || '#9ca3af') : '#9ca3af';
  const emotionColor = currentEkman ? (EKMAN_COLORS[currentEkman] || '#9ca3af') : '#9ca3af';

  return (
    <RightPane>
      <RightHeader>
        FOLLOW AGENT
        {f && (
          <span style={{ color: typeColor, fontWeight: 700 }}>→ {f.agentId}</span>
        )}
        <span style={{ marginLeft: 'auto', color: LBL }}>{agents.length} agents</span>
      </RightHeader>

      <RightBody>
        {/* ── Agent list sidebar ── */}
        <ListSidebar>
          <SidebarHeader>Select Agent</SidebarHeader>
          {!agents.length ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: LBL, fontSize: '11px', padding: '8px' }}>
              LOADING…
            </div>
          ) : (
            <AgentList ref={agentListRef}>
              {filtered.slice(0, 300).map((agent, listIdx) => {
                const emotion  = agent.emotion[Math.min(step, agent.emotion.length - 1)] ?? 'green';
                const ekman    = COLOR_TO_EKMAN[emotion] ?? 'ENJOYMENT';
                const tColor   = TYPE_COLORS[agent.type] || '#9ca3af';
                const selected = f?.agentId === agent.agent_id;
                const name     = getFakeName(agent.agent_id);
                const encHover = encoderHoverIdx === listIdx;
                return (
                  <AgentCard key={agent.agent_id} $selected={selected} $color={tColor} $hovered={encHover}
                    data-agent-card
                    onClick={() => handleFollow(agent.agent_id)}
                  >
                    <AgentDot $color={EKMAN_COLORS[ekman] || '#9ca3af'} />
                    <span style={{ flex: 1, fontSize: '11px', color: selected ? '#e5e7eb' : '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}
                    </span>
                    <span style={{ fontSize: '10px', color: EKMAN_COLORS[ekman] || '#9ca3af', flexShrink: 0 }}>{ekman.slice(0,3)}</span>
                  </AgentCard>
                );
              })}
            </AgentList>
          )}
          {/* Legend */}
          <div style={{ padding: '8px 10px', borderTop: `1px solid ${BDR}`, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: '9px', color: LBL, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 2 }}>Emotion Color</div>
            {[
              { color: '#34d399',  label: 'ENJOYMENT' },
              { color: '#f87171',  label: 'ANGER' },
              { color: '#fb923c',  label: 'FEAR' },
              { color: '#60a5fa',  label: 'SADNESS' },
              { color: '#c084fc',  label: 'CONTEMPT' },
              { color: '#fbbf24',  label: 'DISGUST' },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ fontSize: '9px', color: LBL, letterSpacing: '0.06em' }}>{label}</span>
              </div>
            ))}
            <div style={{ fontSize: '9px', color: LBL, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 4, marginBottom: 2 }}>Trail = Transport</div>
            {[
              { color: '#ffffff',  label: 'FOOT' },
              { color: '#ff5733',  label: 'BICYCLE' },
              { color: '#33a1ff',  label: 'CAR' },
              { color: '#33ff57',  label: 'BUS' },
              { color: '#ff33e9',  label: 'TRAIN' },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 16, height: 3, borderRadius: 2, background: color, flexShrink: 0 }} />
                <span style={{ fontSize: '9px', color: LBL, letterSpacing: '0.06em' }}>{label}</span>
              </div>
            ))}
            <div style={{ fontSize: '9px', color: LBL, marginTop: 3 }}>{filtered.length} agents</div>
          </div>
        </ListSidebar>

        {/* ── Detail pane ── */}
        <DetailPane>
          <FollowMap />
          {!f || !followedAgentData ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: LBL, fontSize: '12px', letterSpacing: '0.06em', textAlign: 'center', padding: '20px' }}>
              <div style={{ fontSize: '1.4rem', opacity: 0.2 }}>◎</div>
              <div>NO AGENT SELECTED</div>
              <div style={{ color: LBL, fontSize: '11px', maxWidth: 200, lineHeight: 1.7 }}>
                Click an agent in the list to begin tracking
              </div>
              <SelectBtn onClick={pickRandom}>SELECT RANDOM</SelectBtn>
            </div>
          ) : (
            <DetailScroll>
              {/* Profile card */}
              <Block>
                <BlockTitle>
                  Followed Agent
                  <span style={{ marginLeft: 8, color: typeColor, fontWeight: 700 }}>{getFakeName(f.agentId)}</span>
                </BlockTitle>
                <ProfileRow><span>NAME</span><span style={{ color: ACT }}>{getFakeName(f.agentId)}</span></ProfileRow>
                <ProfileRow><span>AGE</span><span>{getFakeAge(f.agentId)}</span></ProfileRow>
                <ProfileRow><span>PERSONALITY</span><span>{getFakePersonality(f.agentId)}</span></ProfileRow>
                <ProfileRow><span>OCCUPATION</span><span>{getFakeOccupation(f.agentId)}</span></ProfileRow>
                <ProfileRow><span>EMOTION</span><span style={{ color: emotionColor }}>{currentEkman}</span></ProfileRow>
                <ProfileRow><span>TRANSPORT</span><span>{f.transport}</span></ProfileRow>
                <ProfileRow>
                  <span>STEP</span>
                  <span style={{ color: '#a3e635' }}>{step} / {followedAgentData.path.length - 1}</span>
                </ProfileRow>

                {/* Path progress */}
                <div>
                  <div style={{ fontSize: 11, color: LBL, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Path Progress</div>
                  <div style={{ height: 4, borderRadius: 2, background: SURF2, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 2,
                      background: typeColor,
                      width: `${(pathProgress * 100).toFixed(1)}%`,
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                  <div style={{ fontSize: 11, color: LBL, marginTop: 3, textAlign: 'right' }}>
                    {(pathProgress * 100).toFixed(0)}%
                  </div>
                </div>

                {/* Mood vector bars */}
                <div>
                  <div style={{ fontSize: 11, color: LBL, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5 }}>Mood Vector</div>
                  {moodVectorData.map(m => (
                    <MoodRow key={m.name}>
                      <div className="label">{m.name}</div>
                      <div className="bar-wrap"><MoodBar $value={m.value} $color={m.color} /></div>
                      <div className="val">{m.fullValue.toFixed(0)}%</div>
                    </MoodRow>
                  ))}
                </div>

                <ReleaseBtn onClick={() => setFollowedAgent(null)}>RELEASE AGENT</ReleaseBtn>
              </Block>

              {/* Emotion radar */}
              <Block style={{ height: 220 }}>
                <BlockTitle>Emotion Radar — Step {step}</BlockTitle>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
                      <PolarGrid stroke="#444" />
                      <PolarAngleAxis dataKey="emotion" tick={{ fontSize: 11, fill: '#888', fontFamily: "'IBM Plex Mono', monospace" }} />
                      <Radar name="mood" dataKey="value" stroke={emotionColor} fill={emotionColor} fillOpacity={0.25} />
                      <Tooltip contentStyle={{ background: '#1e1e1e', border: '1px solid #444', borderRadius: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10 }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </Block>

              {/* Mood history */}
              <Block style={{ height: 200 }}>
                <BlockTitle>Mood History — Last 30 Steps</BlockTitle>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={moodHistory} margin={{ top: 4, right: 8, bottom: 4, left: -10 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke="#444" />
                      <XAxis dataKey="step" tick={{ fontSize: 10, fill: '#888', fontFamily: "'IBM Plex Mono', monospace" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#888', fontFamily: "'IBM Plex Mono', monospace" }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ background: '#1e1e1e', border: '1px solid #444', borderRadius: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 9 }} />
                      {EKMAN_ORDER.map(k => (
                        <Line key={k} type="monotone" dataKey={k} stroke={EKMAN_COLORS[k]}
                          dot={false} strokeWidth={k === currentEkman ? 2.5 : 1}
                          opacity={k === currentEkman ? 1 : 0.3}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Block>

              {/* Conversation history */}
              <Block>
                <BlockTitle>
                  Conversation History
                  {followedAgentData.conversation?.length
                    ? <span style={{ color: LBL, fontWeight: 400, marginLeft: 6 }}>{followedAgentData.conversation.length} messages</span>
                    : <span style={{ color: LBL, fontWeight: 400, marginLeft: 6 }}>no messages</span>
                  }
                </BlockTitle>
                {followedAgentData.conversation?.length ? (
                  <ConvList>
                    {followedAgentData.conversation.map((text: string, i: number) => {
                      const ts  = followedAgentData.conversation_timestamps?.[i] ?? 0;
                      const isActive = Math.abs(ts - step) < 3;
                      const isSelf   = i % 2 === 0;
                      return (
                        <ConvLine key={i} $isSelf={isSelf}>
                          <ConvTs>STEP {ts} · {isSelf ? f.agentId : 'OTHER'}</ConvTs>
                          <ConvBubble $isSelf={isSelf}
                            style={isActive ? { borderColor: emotionColor, background: `${emotionColor}18` } : {}}
                          >
                            {text}
                          </ConvBubble>
                        </ConvLine>
                      );
                    })}
                  </ConvList>
                ) : (
                  <div style={{ color: LBL, fontSize: '0.58rem', padding: '6px 0' }}>
                    No conversation data for this agent.
                  </div>
                )}
              </Block>
            </DetailScroll>
          )}
        </DetailPane>
      </RightBody>
    </RightPane>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function AgentAnalyticsView() {
  const { loadSimulationData, state, setFollowedAgent } = useSharedState();

  useEffect(() => {
    loadSimulationData();
  }, []);

  // Auto-follow a random agent as soon as simulation data arrives
  useEffect(() => {
    const agents = state.simulationData?.agents;
    if (!agents?.length || state.followedAgent) return;
    const a = agents[Math.floor(Math.random() * agents.length)];
    setFollowedAgent({
      agentId:   a.agent_id,
      agentType: a.type,
      emotion:   a.emotion[0] ?? 'green',
      transport: a.transport_method[0] ?? 'foot',
    });
  }, [state.simulationData]);

  return (
    <Wrapper>
      <VisualizationLeft />
      <FollowAgentRight />
    </Wrapper>
  );
}
