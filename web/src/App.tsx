import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './shell/Layout';
import { SectionFrame } from './shell/SectionFrame';
import { SessionProvider, useSession } from './roles/session';
import type { SectionKey } from './roles/roles';
import { sectionByKey } from './shell/nav';

const SECTION_MODULES: Record<SectionKey, LazyExoticComponent<ComponentType>> = {
  overview: lazy(() => import('./sections/overview')),
  register: lazy(() => import('./sections/register/routes')),
  sales: lazy(() => import('./sections/sales/routes')),
  chats: lazy(() => import('./sections/sales/chatsRoutes')),
  clients: lazy(() => import('./sections/clients/routes')),
  products: lazy(() => import('./sections/products/routes')),
  stock: lazy(() => import('./sections/stock/routes')),
  purchases: lazy(() => import('./sections/purchases/routes')),
  money: lazy(() => import('./sections/money/routes')),
  delivery: lazy(() => import('./sections/delivery/routes')),
  reports: lazy(() => import('./sections/reports/routes')),
  settings: lazy(() => import('./sections/settings/routes')),
};

function Guarded({ section }: { section: SectionKey }) {
  const { sees } = useSession();
  const location = useLocation();
  if (!sees(section)) return <Navigate to="/overview" replace state={{ from: location.pathname }} />;
  const M = SECTION_MODULES[section];
  return (
    <SectionFrame name={sectionByKey(section).label}>
      <M />
    </SectionFrame>
  );
}

function AppRoutes() {
  const { role } = useSession();
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to={role === 'seller' ? '/register' : '/overview'} replace />} />
        {(Object.keys(SECTION_MODULES) as SectionKey[]).map((key) => (
          <Route key={key} path={`/${key}/*`} element={<Guarded section={key} />} />
        ))}
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <HashRouter>
      <SessionProvider>
        <AppRoutes />
      </SessionProvider>
    </HashRouter>
  );
}
