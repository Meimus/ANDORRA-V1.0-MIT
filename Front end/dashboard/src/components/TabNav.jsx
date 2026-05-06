const TABS = [
  { id: 'main',          label: 'MAIN' },
  { id: 'economic',      label: 'ECONOMIC MATRIX' },
  { id: 'social',        label: 'SOCIAL SYSTEMS' },
  { id: 'environmental', label: 'ENVIRONMENTAL GRID' },
  { id: 'infrastructure',label: 'INFRASTRUCTURE' },
  { id: 'agents',        label: 'AGENT ANALYTICS' },
];

export default function TabNav({ activeTab, setActiveTab }) {
  return (
    <div className="tab-nav">
      {TABS.map((tab) => (
        <button
          type="button"
          key={tab.id}
          className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => setActiveTab(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
