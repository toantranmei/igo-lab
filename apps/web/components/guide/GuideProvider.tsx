'use client';
// PLACEHOLDER — replaced during implementation.
import { GuideContext, type GuideApi } from '@/lib/guide-api';
const api: GuideApi = { openPreview() {}, async startNext() {}, async startFast() {}, reopenPending() {}, isOpen: false };
export default function GuideProvider({ children }: { children: React.ReactNode }) {
  return <GuideContext.Provider value={api}>{children}</GuideContext.Provider>;
}
