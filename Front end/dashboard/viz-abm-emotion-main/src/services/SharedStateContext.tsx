import { createContext, useContext, useState, ReactNode, useEffect, useRef } from 'react';
import { tabSyncService } from './TabSyncService';
import { type ScenarioId, type MapLayerId } from './ScenarioDataService';

interface SimulationState {
  agents: Array<{
    agent_id: string;
    follow: boolean;
    step: number;
    type: string;
    emotion:  Array<string>;
    transport_method: Array<string>;
    speed?: number;
    path: Array<[number, number]>;
    timestamps: Array<number>;
    mood_vector:  Array<number[]>;
    conversation: Array<string>;
    conversation_timestamps: Array<number>;
    intended_path: Array<[number, number]>;
  }>;
}

// Define the followed agent interface
interface FollowedAgentInfo {
  agentId: string;
  agentType: string;
  emotion: string;
  transport: string;
}

interface SharedState {
  totalAgents: number;
  averageStressLevel: number;
  activeZones: number;
  emotions: {
    ANGER: number;
    CONTEMPT: number;
    DISGUST: number;
    ENJOYMENT: number;
    FEAR: number;
    SADNESS: number;
    SURPRISE: number;
  };
  isPlaying: boolean;
  currentStep: number;
  currentInterpolationStep: number;
  simulationData: SimulationState | null;
  followedAgent: FollowedAgentInfo | null;
  useRealisticMap: boolean;
  // Cross-dashboard filter state
  selectedAgentType: string | null;
  selectedEmotionFilter: string | null;
  // Scenario / year / map-layer — synced across both screens
  selectedScenario: ScenarioId;
  selectedYear: number;
  activeMapLayer: MapLayerId;
}

interface SharedStateContextType {
  state: SharedState;
  updateState: (newState: Partial<SharedState>) => void;
  togglePlayback: () => void;
  loadSimulationData: () => Promise<void>;
  setFollowedAgent: (agent: FollowedAgentInfo | null) => void;
  toggleMapStyle: () => void;
  setAgentTypeFilter: (type: string | null) => void;
  setEmotionFilter: (emotion: string | null) => void;
  setScenario: (s: ScenarioId) => void;
  setYear: (y: number) => void;
  setMapLayer: (l: MapLayerId) => void;
}

const initialState: SharedState = {
  totalAgents: 0,
  averageStressLevel: 0,
  activeZones: 0,
  emotions: {
    ANGER: 0,
    CONTEMPT: 0,
    DISGUST: 0,
    ENJOYMENT: 0,
    FEAR: 0,
    SADNESS: 0,
    SURPRISE: 0
  },
  isPlaying: new URLSearchParams(window.location.search).has('embed'),
  currentStep: 1,
  currentInterpolationStep: 0,
  simulationData: null,
  followedAgent: (() => { try { const s = sessionStorage.getItem('followedAgent'); return s ? JSON.parse(s) : null; } catch { return null; } })(),
  useRealisticMap: true,
  selectedAgentType: null,
  selectedEmotionFilter: null,
  selectedScenario: 'continuity',
  selectedYear: 2025,
  activeMapLayer: 'agents',
};

const SharedStateContext = createContext<SharedStateContextType | undefined>(undefined);

export function SharedStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SharedState>(initialState);
  const currentFollowedAgentRef = useRef<FollowedAgentInfo | null>(null);

  // Load simulation data when component mounts
  useEffect(() => {
    loadSimulationData();
  }, []);

  useEffect(() => {
    // Subscribe to messages from other tabs
    const unsubscribe = tabSyncService.subscribe((message) => {
      switch (message.type) {
        case 'PLAY':
          setState(prev => ({ ...prev, isPlaying: true }));
          break;
        case 'PAUSE':
          setState(prev => ({ ...prev, isPlaying: false }));
          break;
        case 'STEP_UPDATE':
          if (typeof message.data?.currentStep === 'number') {
            setState(prev => ({ 
              ...prev, 
              currentStep: message.data!.currentStep!,
              currentInterpolationStep: message.data?.currentInterpolationStep ?? 0
            }));
          }
          break;
        case 'FOLLOWED_AGENT_UPDATE':
          setState(prev => ({
            ...prev,
            followedAgent: message.data?.followedAgent ?? null
          }));
          break;
        case 'MAP_STYLE_UPDATE':
          if (typeof message.data?.useRealisticMap === 'boolean') {
            setState(prev => ({
              ...prev,
              useRealisticMap: message.data?.useRealisticMap === true
            }));
          }
          break;
        case 'FILTER_UPDATE':
          setState(prev => ({
            ...prev,
            ...(message.data?.selectedAgentType !== undefined && {
              selectedAgentType: message.data.selectedAgentType ?? null
            }),
            ...(message.data?.selectedEmotionFilter !== undefined && {
              selectedEmotionFilter: message.data.selectedEmotionFilter ?? null
            }),
          }));
          break;
        case 'SCENARIO_CHANGE':
          if (message.data?.scenario) {
            setState(prev => ({ ...prev, selectedScenario: message.data!.scenario as ScenarioId }));
          }
          break;
        case 'YEAR_CHANGE':
          if (typeof message.data?.year === 'number') {
            setState(prev => ({ ...prev, selectedYear: message.data!.year! }));
          }
          break;
        case 'MAP_LAYER_CHANGE':
          if (message.data?.mapLayer) {
            setState(prev => ({ ...prev, activeMapLayer: message.data!.mapLayer as MapLayerId }));
          }
          break;
        case 'SIMULATION_LOADED':
          if (message.data?.simulationData) {
            const data = message.data.simulationData;
            // Process loaded data
            const agentTypes = [...new Set(data.agents.map((agent: { type: string }) => agent.type))];
            const uniqueAgents = [...new Set(data.agents.map((agent: { agent_id: string }) => agent.agent_id))];
            const emotionCounts = countEmotions(data.agents);
            
            setState(prev => ({
              ...prev,
              simulationData: data,
              totalAgents: uniqueAgents.length,
              averageStressLevel: 0, // We'll calculate this differently
              activeZones: agentTypes.length,
              emotions: emotionCounts
            }));
          }
          break;
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Helper function to count emotions
  const countEmotions = (agents: SimulationState['agents']) => {
    const emotions = {
      ANGER: 0,
      CONTEMPT: 0,
      DISGUST: 0,
      ENJOYMENT: 0,
      FEAR: 0,
      SADNESS: 0,
      SURPRISE: 0
    };
        
    // Count emotions based on mood vectors in our data
    agents.forEach((agent: SimulationState['agents'][0]) => {
      // Skip if agent has no mood vector for the current step
      if (!agent.mood_vector[agent.step]) return;
      
      // Find the dominant emotion in the mood vector
      const moodVector = agent.mood_vector[agent.step];
      const maxEmotionIndex = moodVector.reduce(
        (maxIdx, value, idx, arr) => value > arr[maxIdx] ? idx : maxIdx, 0
      );
      
      // Map the index to emotion name
      const emotionKeys = Object.keys(emotions) as Array<keyof typeof emotions>;
      const emotionKey = emotionKeys[maxEmotionIndex];
      
      if (emotionKey) {
        emotions[emotionKey]++;
      }
    });
    
    // Convert to fractions
    Object.keys(emotions).forEach(key => {
      emotions[key as keyof typeof emotions] /= agents.length || 1;
    });
    
    return emotions;
  };

  const updateState = (newState: Partial<SharedState>) => {
    setState(prev => ({
      ...prev,
      ...newState,
      emotions: {
        ...prev.emotions,
        ...(newState.emotions || {})
      }
    }));
  };

  const togglePlayback = () => {
    const newIsPlaying = !state.isPlaying;
    console.log("Toggle playback called, changing state from", state.isPlaying, "to", newIsPlaying);
    
    updateState({ isPlaying: newIsPlaying });
    
    tabSyncService.broadcast({
      type: newIsPlaying ? 'PLAY' : 'PAUSE'
    });
    
    console.log("After updateState, isPlaying is now:", newIsPlaying);
  };

  const loadSimulationData = async () => {
    try {

      const agents_files = import.meta.glob('../simulation_output/**/*.json'); // dynamically import all JSON files
      console.log("Loading simulation data...", agents_files);
      const allAgentData = [];

      for (const path in agents_files) {
        const agent_data = await agents_files[path](); // load each JSON asynchronously
        allAgentData.push((agent_data as any).default);
      }

      console.log(`Successfully loaded ${allAgentData.length} agent files`);

      // Map dominant mood vector index → display color (Ekman order: ANGER,CONTEMPT,DISGUST,ENJOYMENT,FEAR,SADNESS,SURPRISE)
      const MOOD_COLORS = ['red', 'purple', 'yellow', 'green', 'orange', 'blue', 'blue'];
      const dominantColor = (mv: number[]): string => {
        if (!mv?.length) return 'green';
        let maxIdx = 0;
        for (let i = 1; i < mv.length; i++) if (mv[i] > mv[maxIdx]) maxIdx = i;
        return MOOD_COLORS[maxIdx] ?? 'green';
      };

      // Seeded pseudo-random: deterministic so every reload shows the same agents
      const seededRandom = (seed: number) => {
        const x = Math.sin(seed + 1) * 10000;
        return x - Math.floor(x);
      };

      // Collect agent states for this timestamp from all agent data
      const agents = allAgentData.flatMap((agentData, agentIndex) => {
        const paths: Array<[number, number]> = [];
        const moods: Array<number[]> = [];
        const transport_method: Array<string> = [];
        const emotion: Array<string> = [];
        const timestamps: Array<number> = [];
        const intended_paths: Array<[number, number]> = [];


        let routesThroughCortals = false;
        for (const trip of agentData.trips) {
          for(let index = 0; index < trip.path.length; index++) {
              const [lon, lat] = trip.path[index];
              // Skip points routed through the Cortals d'Encamp ski terrain — the road network
              // included highway=None ski-lift edges that the router used as road connections.
              if (lon >= 1.670 && lon <= 1.720 && lat > 42.553) continue;
              // Track whether this agent uses the Cortals valley road
              if (lon >= 1.650 && lon <= 1.730 && lat > 42.535) routesThroughCortals = true;
              paths.push(trip.path[index]);
              const mv = trip.mood_vectors[index];
              moods.push(mv);
              emotion.push(dominantColor(mv));
              transport_method.push(trip.transport_method);
              timestamps.push(trip.timestamps[index]);
          }
        }

        // The Cortals road is lightly used in reality — keep only ~25% of agents routing there
        if (routesThroughCortals && seededRandom(agentIndex) > 0.25) return [];

        if (agentData.intended_trips) {
          for (const trip of agentData.intended_trips) {
            intended_paths.push(...trip.path);
          }
        }

        return [{
          agent_id: agentData.agent_id,
          follow: agentData.follow ? true : false,
          step: 0,
          type: agentData.type,
          conversation: agentData.conversation,
          conversation_timestamps: agentData.conversation_timestamps,
          emotion,
          transport_method,
          speed: 1.0,
          path: paths,
          timestamps: timestamps,
          mood_vector: moods,
          intended_path: intended_paths,
        }];
      });
              
      // Create simulation data with all steps
      const simulationData: SimulationState = {
        agents: agents,
      };
      
      updateState({
        simulationData,
        totalAgents: agents.length,
        averageStressLevel: 0.5, // Default value, can be calculated differently if needed
      });
      
      // Broadcast the loaded data to other tabs
      tabSyncService.broadcast({
        type: 'SIMULATION_LOADED',
        data: { simulationData }
      });
    } catch (error) {
      console.error('Error loading simulation results:', error);
    }
  };

  // Handle visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        tabSyncService.requestTimerOwnership();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Handle step updates during playback
  useEffect(() => {
    let animationFrameId: number;
    let lastUpdate = Date.now();
    const STEP_INTERVAL = 2000; // Update step every second
    const INTERPOLATION_STEPS = 40; // Number of interpolation steps between main steps
    const INTERPOLATION_INTERVAL = STEP_INTERVAL / INTERPOLATION_STEPS; // Time between interpolation steps

    const updateStep = () => {
      if (!state.isPlaying) return;

      const now = Date.now();
      const deltaTime = now - lastUpdate;

      // Handle interpolation steps
      if (deltaTime >= INTERPOLATION_INTERVAL) {
        const newInterpolationStep = state.currentInterpolationStep + 1;
        
        if (newInterpolationStep >= INTERPOLATION_STEPS) {
          // Move to next main step
          const newStep = state.currentStep + 1;
          const agents = state.simulationData?.agents || [];
          const followedLengths = agents
            .filter(agent => agent.follow && Array.isArray(agent.path) && agent.path.length > 0)
            .map(agent => agent.path.length);
          const maxSteps = followedLengths.length > 0
            ? Math.min(...followedLengths)
            : (agents[0]?.path.length || 1);
          
          if (newStep >= maxSteps) {
            setState(prev => ({ 
              ...prev, 
              currentStep: 0,
              currentInterpolationStep: 0
            }));
            tabSyncService.broadcast({
              type: 'STEP_UPDATE',
              data: { 
                currentStep: 0,
                currentInterpolationStep: 0
              }
            });
          } else {
            setState(prev => ({ 
              ...prev, 
              currentStep: newStep,
              currentInterpolationStep: 0
            }));
            tabSyncService.broadcast({
              type: 'STEP_UPDATE',
              data: { 
                currentStep: newStep,
                currentInterpolationStep: 0
              }
            });
          }
        } else {
          // Update interpolation step
          setState(prev => ({ 
            ...prev, 
            currentInterpolationStep: newInterpolationStep 
          }));
          tabSyncService.broadcast({
            type: 'STEP_UPDATE',
            data: { 
              currentStep: state.currentStep,
              currentInterpolationStep: newInterpolationStep
            }
          });
        }
        
        lastUpdate = now;
      }

      animationFrameId = requestAnimationFrame(updateStep);
    };

    if (state.isPlaying) {
      animationFrameId = requestAnimationFrame(updateStep);
    }

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [state.isPlaying, state.currentStep, state.currentInterpolationStep, state.simulationData]);

  // Add a method to set the followed agent
  const setFollowedAgent = (agent: FollowedAgentInfo | null) => {
    // Skip update if the agent is the same (compare by value)
    if (agent === null && currentFollowedAgentRef.current === null) {
      return; // Both null, no change needed
    }
    
    if (agent && currentFollowedAgentRef.current) {
      const current = currentFollowedAgentRef.current;
      // Compare all relevant properties
      if (
        agent.agentId === current.agentId &&
        agent.agentType === current.agentType &&
        agent.emotion === current.emotion
      ) {
        return; // Same agent, no update needed
      }
    }
    
    // Update the ref
    currentFollowedAgentRef.current = agent;

    // Persist so other iframes on the same origin can read on load
    try {
      if (agent) sessionStorage.setItem('followedAgent', JSON.stringify(agent));
      else sessionStorage.removeItem('followedAgent');
    } catch { /* ignore */ }

    // Update state
    setState(prev => ({
      ...prev,
      followedAgent: agent
    }));
    
    // Broadcast to other tabs
    tabSyncService.broadcast({
      type: 'FOLLOWED_AGENT_UPDATE',
      data: { 
        followedAgent: agent === null ? undefined : agent 
      }
    });
  };

  const toggleMapStyle = () => {
    const newUseRealisticMap = !state.useRealisticMap;
    updateState({ useRealisticMap: newUseRealisticMap });
    tabSyncService.broadcast({
      type: 'MAP_STYLE_UPDATE',
      data: { useRealisticMap: newUseRealisticMap }
    });
  };

  const setAgentTypeFilter = (type: string | null) => {
    updateState({ selectedAgentType: type });
    tabSyncService.broadcast({
      type: 'FILTER_UPDATE',
      data: { selectedAgentType: type }
    });
  };

  const setEmotionFilter = (emotion: string | null) => {
    updateState({ selectedEmotionFilter: emotion });
    tabSyncService.broadcast({
      type: 'FILTER_UPDATE',
      data: { selectedEmotionFilter: emotion }
    });
  };

  const setScenario = (s: ScenarioId) => {
    updateState({ selectedScenario: s });
    tabSyncService.broadcast({ type: 'SCENARIO_CHANGE', data: { scenario: s } });
  };

  const setYear = (y: number) => {
    updateState({ selectedYear: y });
    tabSyncService.broadcast({ type: 'YEAR_CHANGE', data: { year: y } });
  };

  const setMapLayer = (l: MapLayerId) => {
    updateState({ activeMapLayer: l });
    tabSyncService.broadcast({ type: 'MAP_LAYER_CHANGE', data: { mapLayer: l } });
  };

  return (
    <SharedStateContext.Provider
      value={{
        state,
        updateState,
        togglePlayback,
        loadSimulationData,
        setFollowedAgent,
        toggleMapStyle,
        setAgentTypeFilter,
        setEmotionFilter,
        setScenario,
        setYear,
        setMapLayer,
      }}
    >
      {children}
    </SharedStateContext.Provider>
  );
}

export function useSharedState() {
  const context = useContext(SharedStateContext);
  if (context === undefined) {
    throw new Error('useSharedState must be used within a SharedStateProvider');
  }
  return context;
} 