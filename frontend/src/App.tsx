import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Moon, PanelRightClose, PanelRightOpen, Sparkles, LogOut } from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginScreen } from './components/LoginScreen';
import { useChat } from './hooks/useChat';
import { Chat } from './components/Chat';
import { Sidebar } from './components/Sidebar';
import { NudgePanel } from './components/NudgePanel';
import './styles/App.css';

function AuthenticatedApp() {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activePanel, setActivePanel] = useState<'memory' | 'settings'>('memory');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const chatState = useChat();

  return (
    <div className="app">
      <div className="cosmic-bg" aria-hidden="true">
        <div className="stars"></div>
        <div className="stars stars-2"></div>
        <div className="stars stars-3"></div>
        <div className="comet comet-1"></div>
        <div className="comet comet-2"></div>
        <div className="comet comet-3"></div>
      </div>

      <header className="app-header">
        <div className="header-left">
          <div className="logo">
            <span className="logo-icon">
              <Sparkles size={18} />
            </span>
            <span className="logo-copy">
              <span className="logo-text">Sidekick</span>
              <span className="logo-tagline">Your AI sidekick</span>
            </span>
          </div>
          <div className={`connection-status ${chatState.isConnected ? 'connected' : 'disconnected'}`}>
            <span className="status-dot"></span>
            {chatState.isConnected ? 'Connected' : 'Reconnecting...'}
          </div>
        </div>
        <div className="header-right">
          {chatState.heartbeatStatus?.running && (
            <div className="heartbeat-indicator">
              <span className="pulse"></span>
              Daemon Active
            </div>
          )}
          <NudgePanel
            nudges={chatState.nudges}
            onDismiss={chatState.acknowledgeNudge}
          />
          <button
            className="btn btn-icon btn-theme"
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          {user && (
            <div className="user-menu" onClick={logout} title={`Signed in as ${user.login} — click to logout`}>
              {user.avatarUrl
                ? <img src={user.avatarUrl} alt={user.login} className="user-avatar" />
                : <span className="user-avatar user-avatar-initials">{user.login[0].toUpperCase()}</span>
              }
              <span className="user-menu-name">{user.login}</span>
              <LogOut size={14} />
            </div>
          )}
          <button
            className="btn btn-icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            {sidebarOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        </div>
      </header>

      <div className="app-body">
        <main className="app-main">
          <Chat
            messages={chatState.messages}
            streamingContent={chatState.streamingContent}
            reasoningContent={chatState.reasoningContent}
            isLoading={chatState.isLoading}
            currentTool={chatState.currentTool}
            pendingApprovals={chatState.pendingApprovals}
            restoredCount={chatState.restoredCount}
            modelId={chatState.settings.model}
            workIqEnabled={chatState.settings.workIqEnabled}
            usage={chatState.usage}
            onSend={chatState.sendMessage}
            onStop={chatState.stopGeneration}
            onApprove={chatState.approveAction}
            onClear={chatState.clearHistory}
            inputPrefill={chatState.inputPrefill}
            onInputPrefillConsumed={() => chatState.setInputPrefill('')}
          />
        </main>

        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              style={{ overflow: 'hidden' }}
            >
              <Sidebar
                activePanel={activePanel}
                setActivePanel={setActivePanel}
                memory={chatState.memory}
                settings={chatState.settings}
                usage={chatState.usage}
                workIqEnabled={chatState.settings.workIqEnabled}
                onUpdateMemory={chatState.updateMemory}
                onRefreshMemory={chatState.fetchMemory}
                onUpdateSettings={chatState.updateSettings}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
      return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-logo">
            <span className="login-logo-icon"><Sparkles size={32} /></span>
            <h1>Booting terminal...</h1>
          </div>
        </div>
      </div>
    );
  }

  return isAuthenticated ? <AuthenticatedApp /> : <LoginScreen />;
}

export default function AppWithAuth() {
  return (
    <AuthProvider>
      <App />
    </AuthProvider>
  );
}
