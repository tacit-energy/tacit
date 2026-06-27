import { useEffect, useState } from 'react';
import { HomePage } from '@/pages/HomePage';
import { DatasetPage } from '@/pages/DatasetPage';
import { SessionPage } from '@/pages/SessionPage';
import { SettingsPage } from '@/settings/SettingsPage';
import { DEFAULT_THEME, isThemeId, type ThemeId } from '@/lib/themes';

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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('energyops-theme', theme);
  }, [theme]);

  let content;
  if (settingsOpen) {
    content = (
      <SettingsPage
        theme={theme}
        onThemeChange={setTheme}
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
        onBack={() => setView({ name: 'dataset', datasetId: view.datasetId })}
        onOpenSettings={() => setSettingsOpen(true)}
      />
    );
  }

  return <div className="h-dvh min-h-0 overflow-hidden">{content}</div>;
}

export default App;
