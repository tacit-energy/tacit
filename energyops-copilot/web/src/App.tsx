import { useEffect, useState } from 'react';
import { HomePage } from '@/pages/HomePage';
import { DatasetPage } from '@/pages/DatasetPage';
import { SessionPage } from '@/pages/SessionPage';
import { SettingsPage } from '@/settings/SettingsPage';
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

type View =
  | { name: 'home' }
  | { name: 'dataset'; datasetId: string }
  | { name: 'session'; sessionId: string; datasetId: string };

function App() {
  const [view, setView] = useState<View>({ name: 'home' });
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

  let content;
  if (settingsOpen) {
    content = (
      <SettingsPage
        theme={theme}
        onThemeChange={setTheme}
        providerSettings={providerSettings}
        onProviderSettingsChange={setProviderSettings}
        onBack={() => setSettingsOpen(false)}
      />
    );
  } else if (view.name === 'home') {
    content = (
      <HomePage
        onOpenDataset={id => setView({ name: 'dataset', datasetId: id })}
        onOpenSettings={() => setSettingsOpen(true)}
      />
    );
  } else if (view.name === 'dataset') {
    content = (
      <DatasetPage
        datasetId={view.datasetId}
        providerSettings={providerSettings}
        onBack={() => setView({ name: 'home' })}
        onOpenSession={id =>
          setView({ name: 'session', sessionId: id, datasetId: view.datasetId })
        }
      />
    );
  } else {
    content = (
      <SessionPage
        sessionId={view.sessionId}
        providerSettings={providerSettings}
        onBack={() => setView({ name: 'dataset', datasetId: view.datasetId })}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSession={id =>
          setView({ name: 'session', sessionId: id, datasetId: view.datasetId })
        }
      />
    );
  }

  return <div className="h-dvh min-h-0 overflow-hidden">{content}</div>;
}

export default App;
