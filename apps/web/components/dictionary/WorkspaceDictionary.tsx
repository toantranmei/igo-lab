'use client';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { SessionListItem } from '@cl/contract';
import { SessionProvider } from '@/lib/session';
import { api } from '@/lib/live-source';
import { WorkspaceShell, useLastSession } from '@/components/shell/AppHeader';
import DictionaryScreen from './DictionaryScreen';

/**
 * The workspace dictionary in the shared zone. The screen reads the dictionary through a session's state (that is
 * where the published versions and the trace links live); the dictionary itself is the same for every session, so
 * any session gives the same content: the one in ?s=, else the last one opened, else the most recent.
 */
export default function WorkspaceDictionary() {
  const params = useSearchParams();
  const last = useLastSession();
  const [sid, setSid] = useState<string | null>(null);
  const [none, setNone] = useState(false);
  useEffect(() => {
    const asked = params.get('s');
    if (asked) return setSid(asked);
    if (last) return setSid(last);
    api<SessionListItem[]>('/sessions')
      .then((xs) => {
        const latest = [...xs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
        if (latest) setSid(latest.id);
        else setNone(true);
      })
      .catch(() => setNone(true));
  }, [params, last]);
  return (
    <WorkspaceShell active="dictionary" title="Từ điển chung của workspace" note="Một từ điển duy nhất cho cả workspace. Mỗi phiên đọc bản đã công bố làm nền và, khi được duyệt, ghi bản mới vào đây; phiên không có từ điển riêng.">
      {sid ? (
        <SessionProvider sessionId={sid}>
          <section className="tab active" id="dictionary">
            <DictionaryScreen scope="workspace" />
          </section>
        </SessionProvider>
      ) : none ? (
        <p className="dim">Chưa có phiên nào nên từ điển còn rỗng. Tạo phiên ở mục Phiên.</p>
      ) : (
        <p className="dim">Đang tải từ điển…</p>
      )}
    </WorkspaceShell>
  );
}
