import { useSharedState } from '../services/SharedStateContext';

const panel: React.CSSProperties = {
  position:       'absolute',
  top:            0,
  left:           0,
  right:          0,
  height:         44,
  display:        'flex',
  alignItems:     'center',
  gap:            '0.5rem',
  padding:        '0 1rem',
  background:     'var(--bg, #0d0d0d)',
  borderBottom:   '1px solid var(--bdr, #1f2937)',
  zIndex:         10,
  fontFamily:     "'IBM Plex Mono', monospace",
};

const btn: React.CSSProperties = {
  fontSize:       '0.7rem',
  padding:        '5px 14px',
  borderRadius:   4,
  cursor:         'pointer',
  border:         '1px solid var(--bdr, #1f2937)',
  background:     'transparent',
  color:          'var(--muted, #9ca3af)',
  letterSpacing:  '0.06em',
  transition:     'color .15s, background .15s',
};

const EMOTION_COLORS: Record<string, string> = {
  green:  '#4ade80',
  red:    '#f87171',
  purple: '#c084fc',
  blue:   '#60a5fa',
  yellow: '#fbbf24',
};

const TRANSPORT_LABELS: Record<string, string> = {
  foot: 'WALK', bicycle: 'BIKE', car: 'CAR', bus: 'BUS', train: 'TRAIN',
};

export function SharedControlPanel() {
  const { state, togglePlayback } = useSharedState();

  // Count emotion distribution from current step
  const emotionCounts: Record<string, number> = {};
  if (state.simulationData?.agents) {
    state.simulationData.agents.forEach(agent => {
      const step = Math.min(state.currentStep, agent.emotion.length - 1);
      const em = agent.emotion[step] || 'green';
      emotionCounts[em] = (emotionCounts[em] || 0) + 1;
    });
  }
  const total = state.simulationData?.agents?.length || 1;

  return (
    <div style={panel}>
      {/* Play / Pause */}
      <button
        onClick={togglePlayback}
        style={{
          ...btn,
          color:      state.isPlaying ? '#f87171' : '#4ade80',
          border:     `1px solid ${state.isPlaying ? '#f87171' : '#4ade80'}55`,
          background: state.isPlaying ? '#f8717112' : '#4ade8012',
          minWidth:   36,
        }}
      >
        {state.isPlaying ? '⏸' : '▶'}
      </button>

      {/* Step counter */}
      <span style={{ fontSize: '0.68rem', color: 'var(--muted, #9ca3af)', letterSpacing: '0.06em', marginRight: 4 }}>
        STEP {state.currentStep}
      </span>

      {/* Divider */}
      <span style={{ width: 1, height: 20, background: 'var(--bdr, #1f2937)', flexShrink: 0 }} />

      {/* Agent count */}
      <span style={{ fontSize: '0.68rem', color: 'var(--muted, #9ca3af)', letterSpacing: '0.06em' }}>
        {total} AGENTS
      </span>

      {/* Divider */}
      <span style={{ width: 1, height: 20, background: 'var(--bdr, #1f2937)', flexShrink: 0 }} />

      {/* Emotion legend */}
      {Object.entries(emotionCounts).map(([em, count]) => (
        <span key={em} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: EMOTION_COLORS[em] || '#9ca3af',
            display: 'inline-block', flexShrink: 0,
          }} />
          <span style={{ fontSize: '0.65rem', color: EMOTION_COLORS[em] || '#9ca3af', letterSpacing: '0.06em' }}>
            {Math.round(count / total * 100)}%
          </span>
        </span>
      ))}
    </div>
  );
}
