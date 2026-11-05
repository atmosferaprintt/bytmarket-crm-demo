/* Карточки сущностей в боковой панели, открываются из любого раздела: ?open=order:ID
   Ссылка: <EntityLink type="order" id={o.id}>№ {o.number}</EntityLink>
   Программно: const open = useOpenEntity(); open('client', id); */
import { Component, lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Drawer, Notice } from '../ui';

export type EntityType = 'order' | 'client' | 'product' | 'purchase' | 'delivery' | 'supplier' | 'receipt';

export interface EntityDrawerProps {
  id: string;
  onClose: () => void;
}

const DRAWERS: Record<EntityType, ComponentType<EntityDrawerProps>> = {
  order: lazy(() => import('../sections/sales/OrderDrawer')),
  client: lazy(() => import('../sections/clients/ClientDrawer')),
  product: lazy(() => import('../sections/products/ProductDrawer')),
  purchase: lazy(() => import('../sections/purchases/PurchaseDrawer')),
  supplier: lazy(() => import('../sections/purchases/SupplierDrawer')),
  delivery: lazy(() => import('../sections/delivery/DeliveryDrawer')),
  receipt: lazy(() => import('../sections/register/ReceiptDrawer')),
};

export function useOpenEntity() {
  const [params, setParams] = useSearchParams();
  return (type: EntityType, id: string) => {
    const next = new URLSearchParams(params);
    next.set('open', `${type}:${id}`);
    setParams(next);
  };
}

export function useCloseEntity() {
  const [params, setParams] = useSearchParams();
  return () => {
    const next = new URLSearchParams(params);
    next.delete('open');
    setParams(next);
  };
}

export function EntityLink({ type, id, children, className }: { type: EntityType; id: string; children: ReactNode; className?: string }) {
  const open = useOpenEntity();
  return (
    <button
      type="button"
      className={className ?? 'entity-link'}
      onClick={(e) => {
        e.stopPropagation();
        open(type, id);
      }}
    >
      {children}
    </button>
  );
}

class DrawerBoundary extends Component<{ onClose: () => void; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error)
      return (
        <Drawer title="Карточка не открылась" onClose={this.props.onClose}>
          <Notice tone="bad" title="Ошибка при показе карточки">
            {this.state.error.message}
          </Notice>
        </Drawer>
      );
    return this.props.children;
  }
}

function LoadingDrawer({ onClose }: { onClose: () => void }) {
  return (
    <Drawer title="Открываем…" onClose={onClose}>
      <div className="section-loading">
        <Loader2 className="spin" />
      </div>
    </Drawer>
  );
}

export function EntityHost() {
  const [params] = useSearchParams();
  const close = useCloseEntity();
  const raw = params.get('open');
  if (!raw) return null;
  const [type, id] = raw.split(':') as [EntityType, string];
  const D = DRAWERS[type];
  if (!D || !id) return null;
  return (
    <DrawerBoundary key={raw} onClose={close}>
      <Suspense fallback={<LoadingDrawer onClose={close} />}>
        <D id={id} onClose={close} />
      </Suspense>
    </DrawerBoundary>
  );
}
