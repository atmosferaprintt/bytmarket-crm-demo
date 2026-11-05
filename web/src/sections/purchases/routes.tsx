/* Раздел «Закупки»: Заказы поставщикам · Предложение на закупку · Поставщики (маршруты относительно /purchases). */
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from '../../roles/session';
import PurchasesPage from './PurchasesPage';
import SuggestPage from './SuggestPage';
import SuppliersPage from './SuppliersPage';
import '../stock/stock.css';
import './purchases.css';

export default function Section() {
  const { role } = useSession();
  return (
    <Routes>
      <Route index element={<PurchasesPage />} />
      <Route path="suggest" element={role === 'owner' || role === 'warehouse' ? <SuggestPage /> : <Navigate to="/purchases" replace />} />
      <Route path="suppliers" element={<SuppliersPage />} />
      <Route path="*" element={<Navigate to="/purchases" replace />} />
    </Routes>
  );
}
