import { lazy, Suspense, useMemo } from 'react';
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { SectionLoading } from '../../shell/SectionFrame';
import { useDB } from '../../data/store';
import { ReportPeriodCtx } from './parts';
import { periodFromRange, rangeFromQuery, useSharedPeriod } from '../overview/period';
import '../overview/overview.css';
import './reports.css';

const Products = lazy(() => import('./ProductsReport'));
const Clients = lazy(() => import('./ClientsReport'));
const Staff = lazy(() => import('./StaffReport'));
const Promos = lazy(() => import('./PromosReport'));
const Delivery = lazy(() => import('./DeliveryReport'));

/** Раздел «Отчёты»: товары, клиенты, сотрудники, акции, доставка. Период один на все вкладки
    и тот же, что на обзоре: по умолчанию месяц, в первую неделю месяца — прошлый полный (defaultPeriod).
    С плитки обзора приходит «?from=…&to=…» — открывается ровно этот период. */
export default function ReportsSection() {
  const db = useDB();
  const [params] = useSearchParams();
  const from = params.get('from');
  const to = params.get('to');
  const urlPeriod = useMemo(() => {
    const r = rangeFromQuery(params);
    return r ? periodFromRange(r, db.meta.today) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, db.meta.today]);
  const [period, setPeriod] = useSharedPeriod(db.meta.today, urlPeriod);
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
