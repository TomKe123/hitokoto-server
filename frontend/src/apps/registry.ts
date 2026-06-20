import type { ComponentType } from 'react';
import { lazy } from 'react';
import type { ReactNode } from 'react';
import { CloudOutlined } from '@ant-design/icons';
import { createElement } from 'react';

/**
 * A preset application bundled into the platform's App Gallery.
 *
 * The gallery page and the router are both driven entirely by this registry,
 * so adding a new preset is a matter of appending an entry here — no gallery
 * or routing code needs to change.
 */
export interface AppPreset {
  /** Stable unique identifier. */
  id: string;
  /** Display name shown on the gallery card. */
  name: string;
  /** Short description shown on the gallery card. */
  description: string;
  /** Icon node rendered on the gallery card. */
  icon: ReactNode;
  /** Route path the card navigates to (also where the app is mounted). */
  route: string;
  /** Whether a signed-in user is required to open the app. */
  requiresAuth: boolean;
  /** The lazily-loaded application component mounted at `route`. */
  component: ComponentType;
  /** Optional thumbnail image URL for the gallery card. */
  thumbnail?: string;
}

const WallpaperPage = lazy(() => import('./wallpaper/WallpaperApp'));

export const APP_PRESETS: AppPreset[] = [
  {
    id: 'wallpaper',
    name: '滚动时钟壁纸',
    description: '全屏滚动时钟，集成天气、倒计时与一言。可绑定你自己的语录列表作为内容来源。',
    icon: createElement(CloudOutlined),
    route: '/apps/wallpaper',
    requiresAuth: true,
    component: WallpaperPage,
  },
];

export function getPresetByRoute(route: string): AppPreset | undefined {
  return APP_PRESETS.find((preset) => preset.route === route);
}
