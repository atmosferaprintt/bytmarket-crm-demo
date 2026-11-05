import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from '../../roles/session';
import { SectionLoading } from '../../shell/SectionFrame';
import OrdersPage from './OrdersPage';
import './sales.css';

const ReturnsPage = lazy(() => import('./ReturnsPage'));
const ChatsPage = lazy(() => import('./ChatsPage'));

/** Раздел «Продажи»: Заказы · Возвраты · Чаты (вкладки по ролям настроены в PageHeader). */
export default function Section() {
  const { role } = useSession();
  const returns = role === 'owner' || role === 'manager' || role === 'accountant';
  const chats = role === 'owner' || role === 'manager' || role === 'rep';
  return (
    <Suspense fallback={<SectionLoading />}>
      <Routes>
        <Route index element={<OrdersPage />} />
        <Route path="returns" element={returns ? <ReturnsPage /> : <Navigate to="/sales" replace />} />
        <Route path="chats" element={chats ? <ChatsPage /> : <Navigate to="/sales" replace />} />
        <Route path="*" element={<Navigate to="/sales" replace />} />
      </Routes>
    </Suspense>
  );
}
