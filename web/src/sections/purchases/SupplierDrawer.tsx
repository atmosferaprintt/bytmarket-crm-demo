/* Карточка «Поставщик» в боковой панели: контакты, условия, закупки, долг и график платежей. */
import { useMemo, useState } from 'react';
import { FileText, Phone, Plus, Wallet } from 'lucide-react';
import type { EntityDrawerProps } from '../../shell/entities';
import { EntityLink, useOpenEntity } from '../../shell/entities';
import { useDB, useDBVersion } from '../../data/store';
import { indexes, supplierBalance } from '../../data/selectors';
import { get } from '../../data/idx';
import { PAY_METHOD_NAMES } from '../../data/types';
import { useSession } from '../../roles/session';
import { Button, Card, Chip, Drawer, EmptyState, Kpi, StatList, StatRow, StatusChip, PURCHASE_STATE, fmt, overdueStatus } from '../../ui';
import { purchaseRows } from './calc';
import { PaySupplierModal } from './PaySupplierModal';
import { NewPurchaseModal } from './NewPurchaseModal';
import { ActModal } from './ActModal';
import './purchases.css';

export default function EntityDrawer({ id, onClose }: EntityDrawerProps) {
  const db = useDB();
  const version = useDBVersion();
  const { can } = useSession();
  const seeCost = can('seeCost');
  const open = useOpenEntity();
  const ix = indexes(db);
  const [pay, setPay] = useState(false);
  const [create, setCreate] = useState(false);
  const [actOpen, setActOpen] = useState(false);
  const s = ix.suppliers.get(id);
  const today = db.meta.today;

  const data = useMemo(() => {
    if (!s) return null;
    const list = purchaseRows(db)
      .filter((r) => r.pu.supplierId === s.id)
      .sort((a, b) => b.pu.createdAt.localeCompare(a.pu.createdAt));
    const payments = db.payments.filter((p) => p.kind === 'supplier' && p.supplierId === s.id && p.status === 'posted').sort((a, b) => b.at.localeCompare(a.at));
    const products = db.products.filter((p) => p.supplierIds[0] === s.id && p.active).length;
    return { list, payments, products, bal: supplierBalance(db, s.id) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, version]);

  if (!s || !data)
    return (
      <Drawer title="Поставщик" onClose={onClose}>
        <EmptyState title="Поставщик не найден" />
      </Drawer>
    );

  const { list, payments, products, bal } = data;
  const canPay = can('paySupplier') && bal.debt > 0;
  const inWay = list.filter((r) => r.pu.state === 'ordered' || r.pu.state === 'partial');

  return (
    <Drawer
      wide
      title={s.name}
      sub={`ИНН ${s.inn} · ${fmt.count(products, 'товар', 'товара', 'товаров')} в каталоге`}
      onClose={onClose}
      head={
        seeCost && bal.overdue ? (
          <div className="chips">
            <StatusChip s={overdueStatus(Math.max(...bal.upcoming.filter((u) => u.dueDate < today).map((u) => fmt.daysBetween(u.dueDate, today))))} />
          </div>
        ) : undefined
      }
      footer={
        can('createPurchase') || canPay || seeCost ? (
          <>
            {seeCost ? (
              <Button icon={<FileText />} onClick={() => setActOpen(true)}>
                Акт сверки
              </Button>
            ) : null}
            <span className="spacer" />
            {can('createPurchase') ? (
              <Button variant={canPay ? 'secondary' : 'primary'} icon={<Plus />} onClick={() => setCreate(true)}>
                Новая закупка
              </Button>
            ) : null}
            {canPay ? (
              <Button variant="primary" icon={<Wallet />} onClick={() => setPay(true)}>
                Оплатить
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      <div className="grid-2">
        <StatList>
          <StatRow label="Контакт" value={s.contact} />
          <StatRow
            label="Телефон"
            value={
              <a href={`tel:${s.phone}`} className="row" style={{ gap: 6 }}>
                <Phone size={14} />
                {fmt.phone(s.phone)}
              </a>
            }
          />
          <StatRow label="ИНН" value={s.inn} />
        </StatList>
        <StatList>
          <StatRow label="Срок поставки" value={fmt.count(s.leadDays, 'день', 'дня', 'дней')} />
          <StatRow label="Наша отсрочка" value={s.deferDays ? fmt.count(s.deferDays, 'день', 'дня', 'дней') : 'предоплата'} />
          {seeCost ? <StatRow label="Минимальный заказ" value={s.minOrder ? fmt.money(s.minOrder) : 'нет'} /> : null}
          <StatRow label="В пути" value={inWay.length ? fmt.count(inWay.length, 'закупка', 'закупки', 'закупок') : 'нет'} />
        </StatList>
      </div>

      {seeCost ? (
        <div className="grid-3 pur-kpis">
          <Kpi label="Долг" value={fmt.money(bal.debt)} />
          <Kpi label="Просрочено" value={<span className={bal.overdue ? 'c-bad' : undefined}>{fmt.money(bal.overdue)}</span>} />
          <Kpi label="Аванс у поставщика" value={fmt.money(bal.advance)} />
        </div>
      ) : null}

      {seeCost ? (
        <Card flush title="График платежей">
          {bal.upcoming.length === 0 ? (
            <EmptyState title="Долгов нет">Все принятые закупки оплачены</EmptyState>
          ) : (
            <div className="list">
              {bal.upcoming.map((u) => {
                const pu = get(db, 'purchases', u.purchaseId);
                const late = u.dueDate < today ? fmt.daysBetween(u.dueDate, today) : 0;
                return (
                  <div key={u.purchaseId} className="list-row">
                    <div className="grow">
                      <EntityLink type="purchase" id={u.purchaseId}>
                        Закупка № {pu?.number}
                      </EntityLink>
                      <div className="cell-sub">принята {fmt.date(pu?.receivedAt ?? pu?.createdAt)}</div>
                    </div>
                    {late ? <StatusChip s={overdueStatus(late)} /> : <span className={u.dueDate <= fmt.addDays(today, 3) ? 'c-warn w-600 nowrap' : 'muted nowrap'}>до {fmt.date(u.dueDate)}</span>}
                    <span className="w-700 num pur-amount">{fmt.money(u.amount)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : null}

      <Card flush title="Закупки">
        {list.length === 0 ? (
          <EmptyState title="Закупок ещё не было" />
        ) : (
          <div className="list">
            {list.slice(0, 12).map((r) => (
              <button key={r.id} type="button" className="list-row" onClick={() => open('purchase', r.id)}>
                <div className="grow">
                  <div className="w-600">
                    № {r.pu.number} · {fmt.count(r.positions, 'позиция', 'позиции', 'позиций')}
                  </div>
                  <div className="cell-sub">
                    от {fmt.date(r.pu.createdAt)}
                    {r.pu.state === 'ordered' || r.pu.state === 'partial' ? ` · ждём ${fmt.relDate(r.pu.expectedAt, today)}` : ''}
                  </div>
                </div>
                {r.hasDiff ? <Chip tone="warn">Расхождение</Chip> : null}
                <StatusChip s={PURCHASE_STATE[r.pu.state]} />
                {seeCost ? <span className="w-600 num pur-amount">{fmt.money(r.amount)}</span> : null}
              </button>
            ))}
          </div>
        )}
      </Card>

      {seeCost && payments.length ? (
        <Card flush title="Оплаты">
          <div className="list">
            {payments.slice(0, 8).map((p) => (
              <div key={p.id} className="list-row">
                <div className="grow">
                  <div className="w-600">
                    Платёж № {p.number} · {PAY_METHOD_NAMES[p.method]}
                  </div>
                  <div className="cell-sub">
                    {fmt.dateTime(p.at)}
                    {p.allocations.length ? ` · закупки ${p.allocations.map((a) => `№ ${get(db, 'purchases', a.purchaseId)?.number ?? ''}`).join(', ')}` : ''}
                  </div>
                </div>
                <span className="w-700 num pur-amount">{fmt.money(p.amount)}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {pay ? <PaySupplierModal supplierId={s.id} onClose={() => setPay(false)} /> : null}
      {create ? <NewPurchaseModal supplierId={s.id} onClose={() => setCreate(false)} /> : null}
      {actOpen ? <ActModal s={s} onClose={() => setActOpen(false)} /> : null}
    </Drawer>
  );
}
