import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { SectionLoading } from '../../shell/SectionFrame';
import './register.css';

const SalePage = lazy(() => import('./SalePage'));
const ShiftPage = lazy(() => import('./ShiftPage'));
const ReceiptsPage = lazy(() => import('./ReceiptsPage'));

/** Раздел «Касса»: Продажа · Смена · Чеки. Маршруты относительно /register. */
export default function Section() {
  return (
    <Suspense fallback={<SectionLoading />}>
      <Routes>
        <Route index element={<SalePage />} />
        <Route path="shift" element={<ShiftPage />} />
        <Route path="receipts" element={<ReceiptsPage />} />
        <Route path="*" element={<Navigate to="/register" replace />} />
      </Routes>
    </Suspense>
  );
}
