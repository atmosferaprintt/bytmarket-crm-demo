import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from '../../roles/session';
import { SectionLoading } from '../../shell/SectionFrame';
import './money.css';

const Journal = lazy(() => import('./Journal'));
const Debts = lazy(() => import('./Debts'));
const Suppliers = lazy(() => import('./Suppliers'));
const Expenses = lazy(() => import('./Expenses'));
const Accounts = lazy(() => import('./Accounts'));

/** Раздел «Деньги». Владелец и бухгалтер видят все вкладки, менеджер — только долги своих клиентов. */
export default function Section() {
  const { role } = useSession();
  const full = role === 'owner' || role === 'accountant';
  const only = (el: JSX.Element) => (full ? el : <Navigate to="/money/debts" replace />);
  return (
    <Suspense fallback={<SectionLoading />}>
      <Routes>
        <Route index element={only(<Journal />)} />
        <Route path="debts" element={<Debts />} />
        <Route path="suppliers" element={only(<Suppliers />)} />
        <Route path="expenses" element={only(<Expenses />)} />
        <Route path="accounts" element={only(<Accounts />)} />
        <Route path="*" element={<Navigate to={full ? '/money' : '/money/debts'} replace />} />
      </Routes>
    </Suspense>
  );
}
