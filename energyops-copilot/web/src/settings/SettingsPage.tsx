import { useState } from 'react';
import { ArrowLeft, Check, KeyRound, MonitorCog } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { AGENT_TOOLS, labelFor } from '@/lib/tool-labels';
import { THEMES, type ThemeId } from '@/lib/themes';
import type { ProviderSettings } from '@/App';

interface Props {
  theme: ThemeId;
  onThemeChange: (theme: ThemeId) => void;
  providerSettings: ProviderSettings;
  onProviderSettingsChange: (settings: ProviderSettings) => void;
  onBack: () => void;
}

export function SettingsPage({
  theme,
  onThemeChange,
  providerSettings,
  onProviderSettingsChange,
  onBack
}: Props) {
  const [activeTab, setActiveTab] = useState<'agent' | 'theming'>('agent');
  const updateProvider = (patch: Partial<ProviderSettings>) =>
    onProviderSettingsChange({ ...providerSettings, ...patch });
  const toolsByGroup = AGENT_TOOLS.reduce<Record<string, typeof AGENT_TOOLS>>(
    (groups, tool) => {
      groups[tool.group] = [...(groups[tool.group] ?? []), tool];
      return groups;
    },
    {}
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--background)]">
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to workspace">
          <ArrowLeft />
        </Button>
        <MonitorCog size={15} className="text-[var(--muted-foreground)]" />
        <span className="text-sm font-medium text-[var(--foreground)]">Settings</span>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        <section className="max-w-4xl">
          <div
            role="tablist"
            aria-label="Settings sections"
            className="mb-6 inline-flex rounded-md border border-[var(--border)] bg-[var(--muted)]/35 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'agent'}
              onClick={() => setActiveTab('agent')}
              className={
                activeTab === 'agent'
                  ? 'h-8 rounded px-4 text-sm font-medium bg-[var(--primary)] text-[var(--primary-foreground)]'
                  : 'h-8 rounded px-4 text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }
            >
              Agent
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'theming'}
              onClick={() => setActiveTab('theming')}
              className={
                activeTab === 'theming'
                  ? 'h-8 rounded px-4 text-sm font-medium bg-[var(--primary)] text-[var(--primary-foreground)]'
                  : 'h-8 rounded px-4 text-sm font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }
            >
              Theming
            </button>
          </div>

          {activeTab === 'agent' ? (
            <>
              <div className="mb-8">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-[var(--foreground)]">Agent Provider</h2>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    Claude is the default runtime. Provider keys are stored in this browser and sent only with matching requests.
                  </p>
                </div>

                <Card className="p-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="flex flex-col gap-1.5 text-[12px] font-medium text-[var(--muted-foreground)]">
                      Provider
                      <select
                        value={providerSettings.provider}
                        onChange={e =>
                          updateProvider({
                            provider:
                              e.target.value === 'claude' ||
                              e.target.value === 'openrouter' ||
                              e.target.value === 'azure'
                                ? e.target.value
                                : 'claude'
                          })
                        }
                        className="h-9 rounded-md border border-[var(--input)] bg-[var(--background)] px-3 text-[13px] text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                      >
                        <option value="claude">Claude Agent SDK</option>
                        <option value="openrouter">OpenRouter</option>
                        <option value="azure">Azure AI Foundry</option>
                      </select>
                    </label>
                    {providerSettings.provider === 'claude' && (
                      <label className="flex flex-col gap-1.5 text-[12px] font-medium text-[var(--muted-foreground)]">
                        Claude model
                        <input
                          value={providerSettings.claudeModel}
                          onChange={e => updateProvider({ claudeModel: e.target.value })}
                          placeholder="claude-sonnet-4-5-20250929"
                          className="h-9 rounded-md border border-[var(--input)] bg-[var(--background)] px-3 font-mono text-[13px] text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                        />
                      </label>
                    )}
                    {providerSettings.provider === 'openrouter' && (
                      <label className="flex flex-col gap-1.5 text-[12px] font-medium text-[var(--muted-foreground)]">
                        OpenRouter model
                        <input
                          value={providerSettings.openRouterModel}
                          onChange={e => updateProvider({ openRouterModel: e.target.value })}
                          placeholder="anthropic/claude-sonnet-4"
                          className="h-9 rounded-md border border-[var(--input)] bg-[var(--background)] px-3 font-mono text-[13px] text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                        />
                      </label>
                    )}
                    {providerSettings.provider === 'azure' && (
                      <label className="flex flex-col gap-1.5 text-[12px] font-medium text-[var(--muted-foreground)]">
                        Azure deployment/model
                        <input
                          value={providerSettings.azureModel}
                          onChange={e => updateProvider({ azureModel: e.target.value })}
                          placeholder="gpt-5.4"
                          className="h-9 rounded-md border border-[var(--input)] bg-[var(--background)] px-3 font-mono text-[13px] text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                        />
                      </label>
                    )}
                  </div>
                  {providerSettings.provider === 'claude' && (
                    <>
                      <label className="mt-4 flex flex-col gap-1.5 text-[12px] font-medium text-[var(--muted-foreground)]">
                        <span className="flex items-center gap-1.5">
                          <KeyRound size={14} /> Claude API key
                        </span>
                        <input
                          type="password"
                          value={providerSettings.claudeApiKey}
                          onChange={e => updateProvider({ claudeApiKey: e.target.value })}
                          placeholder="sk-ant-..."
                          className="h-9 rounded-md border border-[var(--input)] bg-[var(--background)] px-3 font-mono text-[13px] text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                        />
                      </label>
                      <p className="mt-2 text-[12px] text-[var(--muted-foreground)]">
                        Stored in this browser's localStorage. The server receives it as ANTHROPIC_API_KEY only for Claude requests and does not save it.
                      </p>
                    </>
                  )}
                  {providerSettings.provider === 'openrouter' && (
                    <>
                      <label className="mt-4 flex flex-col gap-1.5 text-[12px] font-medium text-[var(--muted-foreground)]">
                        <span className="flex items-center gap-1.5">
                          <KeyRound size={14} /> OpenRouter API key
                        </span>
                        <input
                          type="password"
                          value={providerSettings.openRouterApiKey}
                          onChange={e => updateProvider({ openRouterApiKey: e.target.value })}
                          placeholder="sk-or-..."
                          className="h-9 rounded-md border border-[var(--input)] bg-[var(--background)] px-3 font-mono text-[13px] text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                        />
                      </label>
                      <p className="mt-2 text-[12px] text-[var(--muted-foreground)]">
                        Stored in this browser's localStorage. The server receives it only for OpenRouter requests and does not save it.
                      </p>
                    </>
                  )}
                  {providerSettings.provider === 'azure' && (
                    <>
                      <label className="mt-4 flex flex-col gap-1.5 text-[12px] font-medium text-[var(--muted-foreground)]">
                        Azure Responses endpoint
                        <input
                          value={providerSettings.azureEndpoint}
                          onChange={e => updateProvider({ azureEndpoint: e.target.value })}
                          placeholder="https://...openai.azure.com/openai/responses?api-version=2025-04-01-preview"
                          className="h-9 rounded-md border border-[var(--input)] bg-[var(--background)] px-3 font-mono text-[13px] text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                        />
                      </label>
                      <label className="mt-4 flex flex-col gap-1.5 text-[12px] font-medium text-[var(--muted-foreground)]">
                        <span className="flex items-center gap-1.5">
                          <KeyRound size={14} /> Azure API key
                        </span>
                        <input
                          type="password"
                          value={providerSettings.azureApiKey}
                          onChange={e => updateProvider({ azureApiKey: e.target.value })}
                          placeholder="Azure OpenAI key"
                          className="h-9 rounded-md border border-[var(--input)] bg-[var(--background)] px-3 font-mono text-[13px] text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                        />
                      </label>
                      <p className="mt-2 text-[12px] text-[var(--muted-foreground)]">
                        Stored in this browser's localStorage. The server receives it only for Azure requests and does not save it.
                      </p>
                    </>
                  )}
                </Card>
              </div>

              <div className="mb-8">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-[var(--foreground)]">Agent Tools</h2>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    These are the EnergyOps tools auto-approved for the agent. Claude, OpenRouter, and Azure sessions share this tool surface.
                  </p>
                </div>

                <Card className="p-4">
                  <div className="grid gap-5 lg:grid-cols-2">
                    {Object.entries(toolsByGroup).map(([group, tools]) => (
                      <div key={group} className="min-w-0">
                        <div className="mb-2 text-[12px] font-semibold uppercase tracking-normal text-[var(--muted-foreground)]">
                          {group}
                        </div>
                        <div className="space-y-2">
                          {tools.map(tool => (
                            <div
                              key={tool.name}
                              className="rounded-md border border-[var(--border)] bg-[var(--muted)]/35 p-3"
                            >
                              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                                <span className="text-sm font-medium text-[var(--foreground)]">
                                  {labelFor(tool.name)}
                                </span>
                                <code className="break-all text-[11px] text-[var(--muted-foreground)]">
                                  {tool.name}
                                </code>
                              </div>
                              <p className="mt-1 text-[12px] leading-5 text-[var(--muted-foreground)]">
                                {tool.purpose}
                              </p>
                              {'conditional' in tool ? (
                                <p className="mt-1 text-[11px] leading-5 text-[var(--muted-foreground)]">
                                  {tool.conditional}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </>
          ) : (
            <>
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-[var(--foreground)]">Appearance</h2>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  Choose the console theme used across chat, widgets, and charts.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {THEMES.map(option => {
                  const selected = option.id === theme;
                  return (
                    <Card
                      key={option.id}
                      className={
                        selected
                          ? 'border-[var(--primary)] bg-[var(--card)]'
                          : 'bg-[var(--card)]'
                      }
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between gap-3">
                          <CardTitle>{option.name}</CardTitle>
                          {selected ? (
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)]">
                              <Check size={14} />
                            </span>
                          ) : null}
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="mb-3 flex gap-2">
                          {option.swatches.map(color => (
                            <span
                              key={color}
                              className="h-7 w-12 rounded-md border border-[var(--border)]"
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                        <p className="min-h-10 text-sm text-[var(--muted-foreground)]">
                          {option.description}
                        </p>
                        <Button
                          className="mt-4"
                          variant={selected ? 'primary' : 'default'}
                          onClick={() => onThemeChange(option.id)}
                        >
                          {selected ? 'Selected' : 'Use theme'}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
