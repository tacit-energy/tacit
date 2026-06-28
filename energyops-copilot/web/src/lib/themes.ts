export const THEMES = [
  {
    id: 'tacit',
    name: 'Tacit',
    description: 'Tacit brand — Deep Ink surfaces with Signal Blue and Amber.',
    swatches: ['#14181f', '#2d6be0', '#d98a26']
  },
  {
    id: 'tacit-light',
    name: 'Tacit Light',
    description: 'Tacit brand on Paper — bright reports with Signal Blue and Amber.',
    swatches: ['#fbfbfc', '#2d6be0', '#e5e8ec']
  },
  {
    id: 'ember',
    name: 'Ember',
    description: 'Dark operations room with warm alerts.',
    swatches: ['#09090b', '#d97757', '#27272a']
  },
  {
    id: 'grid',
    name: 'Grid',
    description: 'Cool command-center palette for network views.',
    swatches: ['#080b12', '#38bdf8', '#1f2937']
  },
  {
    id: 'field',
    name: 'Field',
    description: 'Low-glare green palette for live plant monitoring.',
    swatches: ['#0d120b', '#84cc16', '#273321']
  },
  {
    id: 'light',
    name: 'Light',
    description: 'Bright theme for reports and shared screens.',
    swatches: ['#f8fafc', '#2563eb', '#e5e7eb']
  },
  {
    id: 'aurora',
    name: 'Aurora',
    description: 'Neon cyan and green over a deep polar night console.',
    swatches: ['#06111f', '#22d3ee', '#34d399']
  },
  {
    id: 'voltage',
    name: 'High Voltage',
    description: 'Charcoal operations view with electric yellow emphasis.',
    swatches: ['#0b0f14', '#facc15', '#2563eb']
  },
  {
    id: 'scada',
    name: 'Midnight SCADA',
    description: 'Retro phosphor green for dense industrial monitoring.',
    swatches: ['#030705', '#39ff88', '#10261a']
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    description: 'Technical drawing blues for topology-heavy sessions.',
    swatches: ['#071a33', '#60a5fa', '#12345f']
  },
  {
    id: 'mauve-glass',
    name: 'Mauve Glass',
    description: 'Official Mauve-inspired glass surfaces with soft radius and glow.',
    swatches: ['#120f18', '#c084fc', '#f0abfc']
  },
  {
    id: 'olive-command',
    name: 'Olive Command',
    description: 'Official Olive-inspired compact mode with gridded ops surfaces.',
    swatches: ['#11140c', '#a3e635', '#2e371c']
  },
  {
    id: 'taupe-paper',
    name: 'Taupe Paper',
    description: 'Official Taupe-inspired report style with double borders and serif text.',
    swatches: ['#f4efe6', '#7c4a2d', '#e8dccb']
  },
  {
    id: 'mist-minimal',
    name: 'Mist Minimal',
    description: 'Official Mist-inspired airy theme with soft panels and rounded controls.',
    swatches: ['#eef5f7', '#0f766e', '#dcebef']
  },
  {
    id: 'stone-terminal',
    name: 'Stone Terminal',
    description: 'Official Stone-inspired square mono console with scanline texture.',
    swatches: ['#0d0d0c', '#e7e5e4', '#f97316']
  }
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME: ThemeId = 'tacit';

export function isThemeId(value: string | null): value is ThemeId {
  return THEMES.some(theme => theme.id === value);
}
