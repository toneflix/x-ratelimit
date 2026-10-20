import { sanitizeSettings } from './endpoints';
import type { CapturedRecord, LimitEntry, StoredState } from './types';

export const STATE_KEYS = ['watched', 'recent', 'limits', 'settings'] as const;

/** Shapes raw storage.local contents into a full state object. */
export function normalizeState(raw: Record<string, unknown>): StoredState {
  return {
    watched: Array.isArray(raw.watched) ? (raw.watched as CapturedRecord[]) : [],
    recent: Array.isArray(raw.recent) ? (raw.recent as CapturedRecord[]) : [],
    limits: raw.limits && typeof raw.limits === 'object' ? (raw.limits as Record<string, LimitEntry>) : {},
    settings: sanitizeSettings(raw.settings),
  };
}
