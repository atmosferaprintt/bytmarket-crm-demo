/* Кнопки документов склада в шапке и хозяин окон: приёмка поставки, приход, перемещение, списание, пересчёт.
   Главная кнопка — «Принять поставку»: список ожидаемых закупок, по выбранной — приёмка. Ручной приход — в «⋯». */
import { useCallback, useState, type ReactNode } from 'react';
import { ArrowLeftRight, ChevronRight, ClipboardCheck, PackagePlus, Trash2, Truck } from 'lucide-react';
import { useSession } from '../../roles/session';
import { useDB } from '../../data/store';
import { indexes } from '../../data/selectors';
import { Button, Chip, EmptyState, Modal, MoreMenu, StatusChip, PURCHASE_STATE, fmt, type MenuItem } from '../../ui';
import PurchaseDrawer from '../purchases/PurchaseDrawer';
import { StockDocModal, type DocKind, type DocPreset } from './StockDocModal';
import { CountModal } from './CountModal';

type Open =
  | { kind: DocKind; preset?: DocPreset }
  | { kind: 'count'; preset?: undefined }
  | { kind: 'receive'; preset?: undefined }
  | { kind: 'purchase'; id: string; preset?: undefined };

export type OpenKind = DocKind | 'count' | 'receive';

export function useStockDocs() {
  const [state, setState] = useState<Open | null>(null);
  const open = useCallback((kind: OpenKind, preset?: DocPreset) => setState(kind === 'count' || kind === 'receive' ? { kind } : { kind, preset }), []);
  const close = useCallback(() => setState(null), []);
  const element: ReactNode = !state ? null : state.kind === 'count' ? (
    <CountModal onClose={close} />
  ) : state.kind === 'receive' ? (
    <ReceiveListModal onClose={close} onPick={(id) => setState({ kind: 'purchase', id })} onManual={() => setState({ kind: 'income' })} />
  ) : state.kind === 'purchase' ? (
    <PurchaseDrawer id={state.id} initialMode="receive" onClose={close} />
  ) : (
    <StockDocModal key={JSON.stringify(state)} kind={state.kind} preset={state.preset} onClose={close} onReceive={() => setState({ kind: 'receive' })} />
  );
  return { open, element };
}

/** «Перемещение», «⋯» (Приход без закупки, Списание, Пересчёт), главная «Принять поставку» — по правам роли. */
export function StockDocButtons({ open, extraMenu = [], primary = true }: { open: (kind: OpenKind) => void; extraMenu?: MenuItem[]; primary?: boolean }) {
  const { can } = useSession();
  const receive = can('receivePurchase');
  const menu: MenuItem[] = [
    { label: 'Приход без закупки', icon: <PackagePlus />, onClick: () => open('income'), hidden: !can('income') || !receive },
    { label: 'Списание', icon: <Trash2 />, onClick: () => open('writeoff'), hidden: !can('writeoff') },
    { label: 'Пересчёт', icon: <ClipboardCheck />, onClick: () => open('count'), hidden: !can('count') },
    ...extraMenu,
  ];
  return (
    <>
      {can('transfer') ? (
        <Button icon={<ArrowLeftRight />} onClick={() => open('transfer')}>
          Перемещение
        </Button>
      ) : null}
      <MoreMenu items={menu} />
      {receive ? (
        <Button variant={primary ? 'primary' : 'secondary'} icon={<Truck />} onClick={() => open('receive')}>
          Принять поставку
        </Button>
      ) : can('income') ? (
        <Button variant={primary ? 'primary' : 'secondary'} icon={<PackagePlus />} onClick={() => open('income')}>
          Приход
        </Button>
      ) : null}
    </>
  );
}

/** Ожидаемые поставки: заказанные и принятые частично закупки, ближайшие сверху. */
function ReceiveListModal({ onPick, onManual, onClose }: { onPick: (id: string) => void; onManual: () => void; onClose: () => void }) {
  const db = useDB();
  const { can } = useSession();
  const ix = indexes(db);
  const today = db.meta.today;
  const list = db.purchases.filter((p) => p.state === 'ordered' || p.state === 'partial').sort((a, b) => a.expectedAt.localeCompare(b.expectedAt));
  return (
    <Modal
      title="Принять поставку"
      sub="Выберите закупку, по которой приехал товар"
      onClose={onClose}
      footer={
        <>
          {can('income') ? (
            <Button variant="ghost" icon={<PackagePlus />} onClick={onManual}>
              Приход без закупки
            </Button>
          ) : null}
          <span className="spacer" />
          <Button onClick={onClose}>Закрыть</Button>
        </>
      }
    >
      {list.length === 0 ? (
        <EmptyState icon={<Truck />} title="Поставок не ждём">
          Все заказы поставщикам приняты
        </EmptyState>
      ) : (
        <div className="stock-recv-list">
          {list.map((pu) => {
            const late = pu.expectedAt < today ? fmt.daysBetween(pu.expectedAt, today) : 0;
            const rest = pu.lines.reduce((s, l) => s + Math.max(0, l.qty - (l.received ?? 0)), 0);
            const restLines = pu.lines.filter((l) => (l.received ?? 0) < l.qty).length;
            return (
              <button key={pu.id} type="button" className="stock-list-row" onClick={() => onPick(pu.id)}>
                <span style={{ minWidth: 0 }}>
                  <span className="stock-list-title">
                    <span>{ix.suppliers.get(pu.supplierId)?.name ?? 'Поставщик'}</span>
                    {pu.state === 'partial' ? <StatusChip s={PURCHASE_STATE.partial} /> : null}
                  </span>
                  <span className="stock-list-meta" style={{ display: 'block' }}>
                    Закупка № {pu.number} · ждём {fmt.count(restLines, 'позицию', 'позиции', 'позиций')}, {fmt.qty(rest)}
                  </span>
                </span>
                <span className="stock-list-side">
                  {late ? <Chip tone="bad">Опаздывает на {fmt.count(late, 'день', 'дня', 'дней')}</Chip> : <span className={pu.expectedAt === today ? 'w-700' : 'muted'}>{fmt.relDate(pu.expectedAt, today)}</span>}
                  <ChevronRight size={16} className="faint" />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
