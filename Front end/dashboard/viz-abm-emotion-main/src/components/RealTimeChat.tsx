import React, { useEffect, useMemo, useRef } from 'react';
import styled from 'styled-components';
import { useSharedState } from '../services/SharedStateContext';

const BG    = '#1e1e1e';
const SURF  = '#272727';
const SURF2 = '#303030';
const BDR   = '#444';
const LBL   = '#888';
const TXT   = '#ccc';
const ACT   = '#eee';
const FONT  = `'IBM Plex Mono', monospace`;

const Panel = styled.div`
  background: ${BG};
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
  font-family: ${FONT};
`;

const PanelLabel = styled.div`
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.14em;
  color: ${LBL};
  text-transform: uppercase;
  border-bottom: 1px solid ${BDR};
  padding: 0 1.2rem 6px;
  padding-top: 1rem;
  flex-shrink: 0;
`;

const MessageList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
  scrollbar-width: thin;
  scrollbar-color: ${BDR} transparent;
  &::-webkit-scrollbar { width: 3px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: ${BDR}; border-radius: 2px; }
`;

const MessageItem = styled.div`
  padding: 4px 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-left: 2px solid transparent;
  &:hover { background: ${SURF}; }
`;

const MessageHeader = styled.div`
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${LBL};
`;

const MessageText = styled.div`
  font-size: 11px;
  color: ${TXT};
  line-height: 1.5;
`;

const EmptyState = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: ${LBL};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.6;
`;

interface ChatMessage {
  agentId: string;
  step: number;
  text: string;
  timestamp: number;
}

const AGENT_COLORS: Record<string, string> = {
  Carlos: '#10b981',
  Elena:  '#60a5fa',
};

function RealTimeChat() {
  const { state } = useSharedState();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const currentMessages = useMemo(() => {
    if (!state.simulationData?.agents) return [];
    const messages: ChatMessage[] = [];
    const currentStep = state.currentStep;
    state.simulationData.agents.forEach(agent => {
      if (agent.conversation && agent.conversation_timestamps) {
        agent.conversation_timestamps.forEach((timestamp: number, index: number) => {
          if (timestamp === currentStep) {
            messages.push({
              agentId:   agent.agent_id,
              step:      timestamp,
              text:      agent.conversation[index],
              timestamp: Date.now() + Math.random(),
            });
          }
        });
      }
    });
    return messages
      .filter(m => m.agentId === 'Elena' || m.agentId === 'Carlos')
      .sort((a, b) => a.step - b.step);
  }, [state.simulationData, state.currentStep]);

  const [allMessages, setAllMessages] = React.useState<ChatMessage[]>([]);

  useEffect(() => {
    setAllMessages(prev => {
      const newMsgs = currentMessages.filter(
        m => !prev.some(p => p.agentId === m.agentId && p.step === m.step && p.text === m.text)
      );
      return [...prev, ...newMsgs].slice(-200);
    });
  }, [currentMessages]);

  useEffect(() => {
    if (state.currentStep === 0) setAllMessages([]);
  }, [state.currentStep]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allMessages]);

  return (
    <Panel>
      <PanelLabel>Agent Conversations</PanelLabel>
      {allMessages.length === 0 ? (
        <EmptyState>Waiting for conversations…</EmptyState>
      ) : (
        <MessageList>
          {allMessages.map((msg) => {
            const color = AGENT_COLORS[msg.agentId] ?? ACT;
            return (
              <MessageItem
                key={`${msg.agentId}-${msg.step}-${msg.timestamp}`}
                style={{ borderLeftColor: color }}
              >
                <MessageHeader style={{ color }}>
                  {msg.agentId} · step {msg.step}
                </MessageHeader>
                <MessageText>{msg.text}</MessageText>
              </MessageItem>
            );
          })}
          <div ref={messagesEndRef} />
        </MessageList>
      )}
    </Panel>
  );
}

export default RealTimeChat;
