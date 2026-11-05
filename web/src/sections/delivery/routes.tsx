import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from '../../roles/session';
import { QueuePage } from './QueuePage';
import { RoutesPage } from './RoutesPage';
import { CashPage } from './CashPage';
import { CourierCash, CourierQueue } from './CourierPages';
import './delivery.css';

/** Раздел «Доставка»: доставки на день, маршруты курьеров, деньги курьеров. У курьера — «Заявки» карточками. */
export default function Section() {
  const { role } = useSession();
  const courier = role === 'courier';
  const planner = role === 'owner' || role === 'dispatcher';
  return (
    <Routes>
      <Route index element={courier ? <CourierQueue /> : <QueuePage />} />
      <Route path="routes" element={planner ? <RoutesPage /> : <Navigate to="/delivery" replace />} />
      <Route path="cash" element={courier ? <CourierCash /> : planner ? <CashPage /> : <Navigate to="/delivery" replace />} />
      <Route path="*" element={<Navigate to="/delivery" replace />} />
    </Routes>
  );
}
