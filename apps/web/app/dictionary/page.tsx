import { Suspense } from 'react';
import WorkspaceDictionary from '@/components/dictionary/WorkspaceDictionary';

export const metadata = { title: 'Từ điển chung · Competence Lab' };
export default function Page() {
  return (
    <Suspense>
      <WorkspaceDictionary />
    </Suspense>
  );
}
