/* Раздел «Склад»: Остатки · Сборка · Документы · Карантин (маршруты относительно /stock). */
import { Navigate, Route, Routes } from 'react-router-dom';
import StockPage from './StockPage';
import DocsPage from './DocsPage';
import PickingPage from './PickingPage';
import QuarantinePage from './QuarantinePage';
import './stock.css';

export default function Section() {
  return (
    <Routes>
      <Route index element={<StockPage />} />
      <Route path="picking" element={<PickingPage />} />
      <Route path="docs" element={<DocsPage />} />
      <Route path="quarantine" element={<QuarantinePage />} />
      <Route path="*" element={<Navigate to="/stock" replace />} />
    </Routes>
  );
}
