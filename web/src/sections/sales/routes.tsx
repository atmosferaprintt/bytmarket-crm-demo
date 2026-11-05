import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from '../../roles/session';
import { SectionLoading } from '../../shell/SectionFrame';
import OrdersPage from './OrdersPage';
import './sales.css';

const ReturnsPage = lazy(() => import('./ReturnsPage'));

/** Старый адрес вкладки «Чаты» ведёт в отдельный раздел, с выбранным клиентом. */
function ToChats() {
  const { search } = useLocation();
  return <Navigate to={`/chats${search}`} replace />;
}

/** Раздел «Продажи»: Заказы · Возвраты (вкладки по ролям настроены в PageHeader). Чаты — отдельный раздел /chats. */
export default function Section() {
  const { role } = useSession();
  const returns = role === 'owner' || role === 'manager' || role === 'accountant';
  return (
    <Suspense fallback={<SectionLoading />}>
      <Routes>
        <Route index element={<OrdersPage />} />
        <Route path="returns" element={returns ? <ReturnsPage /> : <Navigate to="/sales" replace />} />
        <Route path="chats" element={<ToChats />} />
        <Route path="*" element={<Navigate to="/sales" replace />} />
      </Routes>
    </Suspense>
  );
}
