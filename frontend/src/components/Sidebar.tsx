import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AppSettings, UsageInfo } from '../hooks/useChat';
import { MODEL_OPTIONS, INTERVAL_OPTIONS } from '../hooks/useChat';

interface SidebarProps {
  activePanel: 'memory' | 'settings';
  setActivePanel: (panel: 'memory' | 'settings') => void;
  memory: string;
  settings: AppSettings;
  usage?: UsageInfo | null;
  workIqEnabled?: boolean;
  onUpdateMemory: (content: string) => Promise<{ success: boolean; message: string }>;
  onRefreshMemory: () => void;
  onUpdateSettings: (settings: Partial<AppSettings>) => Promise<any>;
}

export function Sidebar({
  activePanel,
  setActivePanel,
  memory,
  settings,
  usage,
  workIqEnabled,
  onUpdateMemory,
  onRefreshMemory,
  onUpdateSettings,
}: SidebarProps) {
  const [memoryEdit, setMemoryEdit] = useState(memory);
  const [isEditing, setIsEditing] = useState(false);

  const handleSaveMemory = async () => {
    const result = await onUpdateMemory(memoryEdit);
    if (result.success) {
      setIsEditing(false);
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        <button
          className={`tab ${activePanel === 'memory' ? 'active' : ''}`}
          onClick={() => setActivePanel('memory')}
        >
          Memory
        </button>
        <button
          className={`tab ${activePanel === 'settings' ? 'active' : ''}`}
          onClick={() => setActivePanel('settings')}
        >
          Settings
        </button>
      </div>

      <div className="sidebar-content">
        {activePanel === 'memory' && (
          <div className="memory-panel">
            <div className="panel-header">
              <span>Persistent Memory</span>
              <div className="panel-actions">
                {isEditing ? (
                  <>
                    <button className="btn btn-small btn-primary" onClick={handleSaveMemory}>
                      Save
                    </button>
                    <button className="btn btn-small" onClick={() => { setIsEditing(false); setMemoryEdit(memory); }}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-small" onClick={() => { setMemoryEdit(memory); setIsEditing(true); }}>
                      Edit
                    </button>
                    <button className="btn btn-small" onClick={onRefreshMemory}>
                      Refresh
                    </button>
                  </>
                )}
              </div>
            </div>
            {isEditing ? (
              <textarea
                className="memory-editor"
                value={memoryEdit}
                onChange={(e) => setMemoryEdit(e.target.value)}
              />
            ) : (
              <div className="memory-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{memory}</ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {activePanel === 'settings' && (
          <SettingsPanel settings={settings} usage={usage} onUpdateSettings={onUpdateSettings} workIqEnabled={workIqEnabled} />
        )}
      </div>
    </aside>
  );
}

function SettingsPanel({ settings, usage, onUpdateSettings, workIqEnabled }: { settings: AppSettings; usage?: UsageInfo | null; onUpdateSettings: (s: Partial<AppSettings>) => Promise<any>; workIqEnabled?: boolean }) {
  const [saving, setSaving] = useState(false);

  const handleModelChange = async (model: string) => {
    setSaving(true);
    await onUpdateSettings({ model });
    setSaving(false);
  };

  const handleIntervalChange = async (field: 'emailCheckInterval' | 'teamsCheckInterval', value: number) => {
    setSaving(true);
    await onUpdateSettings({ [field]: value });
    setSaving(false);
  };

  const currentModel = MODEL_OPTIONS.find(m => m.id === settings.model);
  const premium = usage?.quotaSnapshots?.premium_interactions;
  const premiumText = (() => {
    if (!premium) return 'Copilot Pro budget: 300 premium requests/month';
    if (premium.isUnlimitedEntitlement) return 'Premium budget: Unlimited';
    if (typeof premium.entitlementRequests === 'number' && typeof premium.usedRequests === 'number' && premium.entitlementRequests > 0) {
      const remaining = Math.max(0, premium.entitlementRequests - premium.usedRequests);
      return `Premium remaining: ${remaining}/${premium.entitlementRequests}`;
    }
    if (typeof premium.remainingPercentage === 'number') {
      return `Premium remaining: ${premium.remainingPercentage}%`;
    }
    return 'Copilot Pro budget: 300 premium requests/month';
  })();

  return (
    <div className="settings-panel">
      <div className="panel-header">
        <span>Settings</span>
        {saving && <span className="settings-saving">Saving...</span>}
      </div>

      <div className="settings-section">
        <label className="settings-label">AI Model</label>
        <p className="settings-description">Choose the model for chat responses. Rate shown per request.</p>
        <div className="settings-current">Usage: <strong>{premiumText}</strong></div>
        <div className="model-selector">
          {MODEL_OPTIONS.map((model) => (
            <button
              key={model.id}
              className={`model-option ${settings.model === model.id ? 'active' : ''}`}
              onClick={() => handleModelChange(model.id)}
              disabled={saving}
            >
              <span className="model-name">{model.label}</span>
              <span className="model-meta">
                <span className="model-provider">{model.provider}</span>
                <span className="model-rate">{model.rateLabel}</span>
              </span>
            </button>
          ))}
        </div>
        {currentModel && (
          <div className="settings-current">
            Active: <strong>{currentModel.label}</strong>
          </div>
        )}
      </div>

      {workIqEnabled ? (
        <>
          <div className="settings-section">
            <label className="settings-label">Email Check Frequency</label>
            <p className="settings-description">How often to check for new emails</p>
            <select
              className="settings-select"
              value={settings.emailCheckInterval}
              onChange={(e) => handleIntervalChange('emailCheckInterval', Number(e.target.value))}
              disabled={saving}
            >
              {INTERVAL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="settings-section">
            <label className="settings-label">Teams Check Frequency</label>
            <p className="settings-description">How often to check for @mentions</p>
            <select
              className="settings-select"
              value={settings.teamsCheckInterval}
              onChange={(e) => handleIntervalChange('teamsCheckInterval', Number(e.target.value))}
              disabled={saving}
            >
              {INTERVAL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="settings-section">
            <label className="settings-label">Auto-draft Replies</label>
            <p className="settings-description">Automatically draft responses to incoming emails</p>
            <button
              className={`settings-toggle ${settings.emailDraftEnabled ? 'on' : 'off'}`}
              onClick={() => onUpdateSettings({ emailDraftEnabled: !settings.emailDraftEnabled })}
              disabled={saving}
            >
              {settings.emailDraftEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
        </>
      ) : (
        <div className="settings-section">
          <label className="settings-label">Microsoft 365</label>
          <p className="settings-description">Work IQ integrations are disabled for this app.</p>
        </div>
      )}
    </div>
  );
}
