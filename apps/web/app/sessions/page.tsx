import { Suspense } from 'react';
import SessionsScreen from '@/components/sessions/SessionsScreen';

export const metadata = { title: 'Quản lý phiên · Competence Lab' };
export default function Page() {
  return (
    <Suspense>
      <SessionsScreen />
    </Suspense>
  );
}
