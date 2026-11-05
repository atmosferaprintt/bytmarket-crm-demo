import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { SectionLoading } from '../../shell/SectionFrame';
import { useDB } from '../../data/store';
import { ReportPeriodCtx } from './parts';
import { useSharedPeriod } from '../overview/period';
import '../overview/overview.css';
import './reports.css';

const Products = lazy(() => import('./ProductsReport'));
const Clients = lazy(() => import('./ClientsReport'));
const Staff = lazy(() => import('./StaffReport'));
const Promos = lazy(() => import('./PromosReport'));
const Delivery = lazy(() => import('./DeliveryReport'));

/** Раздел «Отчёты»: товары, клиенты, сотрудники, акции, доставка. Период один на все вкладки
    и тот же, что на обзоре: по умолчанию месяц, в первую неделю месяца — прошлый полный (defaultPeriod). */
export default function ReportsSection() {
  const db = useDB();
  const [period, setPeriod] = useSharedPeriod(db.meta.today);
  return (
    <ReportPeriodCtx.Provider value={{ period, setPeriod }}>
      <Suspense fallback={<SectionLoading />}>
        <Routes>
          <Route index element={<Products />} />
          <Route path="clients" element={<Clients />} />
          <Route path="staff" element={<Staff />} />
          <Route path="promos" element={<Promos />} />
          <Route path="delivery" element={<Delivery />} />
          <Route path="*" element={<Navigate to="/reports" replace />} />
        </Routes>
      </Suspense>
    </ReportPeriodCtx.Provider>
  );
}
