import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { HomePage } from '@/pages/HomePage';
import { DatasetPage } from '@/pages/DatasetPage';
import { SessionPage } from '@/pages/SessionPage';
import { SettingsPage } from '@/settings/SettingsPage';
import { datasetPath, homePath, sessionPath } from '@/lib/routes';
import { DEFAULT_THEME, isThemeId, type ThemeId } from '@/lib/themes';

export interface ProviderSettings {
  provider: 'claude' | 'openrouter' | 'azure';
  claudeModel: string;
  claudeApiKey: string;
  openRouterModel: string;
  openRouterApiKey: string;
  azureEndpoint: string;
  azureModel: string;
  azureApiKey: string;
}

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(() => {
    const stored = window.localStorage.getItem('energyops-theme');
    return isThemeId(stored) ? stored : DEFAULT_THEME;
  });
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(() => ({
    provider:
      window.localStorage.getItem('energyops-provider') === 'openrouter' ||
      window.localStorage.getItem('energyops-provider') === 'azure' ||
      window.localStorage.getItem('energyops-provider') === 'claude'
        ? (window.localStorage.getItem('energyops-provider') as
            | 'claude'
            | 'openrouter'
            | 'azure')
        : 'claude',
    claudeModel:
      window.localStorage.getItem('energyops-claude-model') ||
      'claude-sonnet-4-5-20250929',
    claudeApiKey: window.localStorage.getItem('energyops-claude-key') || '',
    openRouterModel:
      window.localStorage.getItem('energyops-openrouter-model') ||
      'anthropic/claude-sonnet-4',
    openRouterApiKey: window.localStorage.getItem('energyops-openrouter-key') || '',
    azureEndpoint:
      window.localStorage.getItem('energyops-azure-endpoint') ||
      'https://ai-cosmos886082229905.openai.azure.com/openai/responses?api-version=2025-04-01-preview',
    azureModel: window.localStorage.getItem('energyops-azure-model') || 'gpt-5.4',
    azureApiKey: window.localStorage.getItem('energyops-azure-key') || ''
  }));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('energyops-theme', theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem('energyops-provider', providerSettings.provider);
    window.localStorage.setItem(
      'energyops-openrouter-model',
      providerSettings.openRouterModel
    );
    window.localStorage.setItem('energyops-claude-model', providerSettings.claudeModel);
    window.localStorage.setItem('energyops-azure-endpoint', providerSettings.azureEndpoint);
    window.localStorage.setItem('energyops-azure-model', providerSettings.azureModel);
    if (providerSettings.claudeApiKey) {
      window.localStorage.setItem('energyops-claude-key', providerSettings.claudeApiKey);
    } else {
      window.localStorage.removeItem('energyops-claude-key');
    }
    if (providerSettings.openRouterApiKey) {
      window.localStorage.setItem(
        'energyops-openrouter-key',
        providerSettings.openRouterApiKey
      );
    } else {
      window.localStorage.removeItem('energyops-openrouter-key');
    }
    if (providerSettings.azureApiKey) {
      window.localStorage.setItem('energyops-azure-key', providerSettings.azureApiKey);
    } else {
      window.localStorage.removeItem('energyops-azure-key');
    }
  }, [providerSettings]);

  const openSettings = () => setSettingsOpen(true);

  if (settingsOpen) {
    return (
      <div className="h-dvh min-h-0 overflow-hidden">
      <SettingsPage
        theme={theme}
        onThemeChange={setTheme}
        providerSettings={providerSettings}
        onProviderSettingsChange={setProviderSettings}
        onBack={() => setSettingsOpen(false)}
      />
      </div>
    );
  }

  return (
    <div className="h-dvh min-h-0 overflow-hidden">
      <Routes>
        <Route path="/" element={<HomePage onOpenSettings={openSettings} />} />
        <Route
          path="/app/datasets/:datasetId"
          element={
            <DatasetRoute
              providerSettings={providerSettings}
            />
          }
        />
        <Route
          path="/app/datasets/:datasetId/sessions/:sessionId"
          element={
            <SessionRoute
              providerSettings={providerSettings}
              onOpenSettings={openSettings}
            />
          }
        />
        <Route path="*" element={<Navigate to={homePath()} replace />} />
      </Routes>
    </div>
  );
}

function DatasetRoute({
  providerSettings
}: {
  providerSettings: ProviderSettings;
}) {
  const { datasetId } = useParams();
  const navigate = useNavigate();
  if (!datasetId) return <Navigate to={homePath()} replace />;

  return (
    <DatasetPage
      datasetId={datasetId}
      providerSettings={providerSettings}
      onBack={() => navigate(homePath())}
      onOpenSession={id => navigate(sessionPath(datasetId, id))}
    />
  );
}

function SessionRoute({
  providerSettings,
  onOpenSettings
}: {
  providerSettings: ProviderSettings;
  onOpenSettings: () => void;
}) {
  const { datasetId, sessionId } = useParams();
  const navigate = useNavigate();
  if (!datasetId || !sessionId) return <Navigate to={homePath()} replace />;

  return (
    <SessionPage
      sessionId={sessionId}
      providerSettings={providerSettings}
      onBack={() => navigate(datasetPath(datasetId))}
      onOpenSettings={onOpenSettings}
    />
  );
}

export default App;
