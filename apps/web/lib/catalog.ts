'use client';
import { useEffect, useState } from 'react';
import { Catalog, createCatalogApi, type CatalogApi, type CatalogData } from '@cl/example';
import { api } from './live-source';
import { useSession } from './session';

/**
 * Catalog shown in "Từ điển và tái sử dụng".
 * Example → the seed library. Live → the published workspace dictionary locked for the run;
 * the seed library stays available for reference under a "seed" label.
 */
export function useCatalog(atRelease: string | null = null): { catalog: CatalogApi; origin: 'seed' | 'live'; seed: CatalogApi; loading: boolean; showSeed: boolean; setShowSeed(v: boolean): void } {
  const { source, sessionId, state } = useSession();
  const [live, setLive] = useState<CatalogApi | null>(null);
  const [showSeed, setShowSeed] = useState(false);
  const isLive = source.mode === 'live';
  const version = state?.dictionary.version;
  useEffect(() => {
    if (!isLive) return;
    let on = true;
    api<CatalogData>(`/sessions/${sessionId}/catalog${atRelease ? `?release=${encodeURIComponent(atRelease)}` : ''}`)
      .then((d) => on && setLive(createCatalogApi({ ...d, origin: 'live' })))
      .catch(() => on && setLive(createCatalogApi({ version: 'rỗng', families: [], industries: [], competencies: [], roles: [], profiles: [], origin: 'live' })));
    return () => {
      on = false;
    };
  }, [isLive, sessionId, version, atRelease]);
  if (!isLive) return { catalog: Catalog, origin: 'seed', seed: Catalog, loading: false, showSeed: true, setShowSeed() {} };
  if (showSeed) return { catalog: Catalog, origin: 'seed', seed: Catalog, loading: false, showSeed, setShowSeed };
  return { catalog: live ?? createCatalogApi({ version: '…', families: [], industries: [], competencies: [], roles: [], profiles: [], origin: 'live' }), origin: 'live', seed: Catalog, loading: !live, showSeed, setShowSeed };
}
