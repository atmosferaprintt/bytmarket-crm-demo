/* Карточка платежа в боковой панели: сумма, кто, куда, распределение и действия бухгалтера. */
import { useMemo } from 'react';
import { BadgeCheck, FileSearch } from 'lucide-react';
import type { ID } from '../../data/types';
import { ACCOUNT_NAMES, PAY_METHOD_NAMES } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { indexes } from '../../data/selectors';
import { EntityLink } from '../../shell/entities';
import { Button, Chip, Drawer, Notice, PAYMENT_STATUS, StatList, StatRow, StatusChip, fmt } from '../../ui';
import type { SetModal } from './actions';
import { useConfirmPayment, useMoneyPerms } from './lib';
import { clean, kindLabel, transferText } from './lib';

export function PaymentDrawer({ paymentId, onClose, onOpen }: { paymentId: ID; onClose: () => void; onOpen: SetModal }) {
  const db = useDB();
  const v = useDBVersion();
  const perms = useMoneyPerms();
  const confirm = useConfirmPayment();
  const data = useMemo(() => {
    const p = db.payments.find((x) => x.id === paymentId);
    if (!p) return null;
    const ix = indexes(db);
    const purchases = new Map(db.purchases.map((x) => [x.id, x]));
    const shift = p.shiftId ? db.shifts.find((s) => s.id === p.shiftId) : undefined;
    return { p, ix, purchases, shift };
  }, [db, v, paymentId]);
  if (!data) return null;
  const { p, ix, purchases, shift } = data;
  const client = p.clientId ? ix.clients.get(p.clientId) : undefined;
  const supplier = p.supplierId ? ix.suppliers.get(p.supplierId) : undefined;
  const allocated = p.allocations.reduce((s, a) => s + a.amount, 0);
  const rest = p.amount - allocated;
  const isIn = p.direction === 'in' && p.kind !== 'transfer';

  let footer = null;
  if (p.status === 'pending' && perms.confirm)
    footer = (
      <Button
        variant="primary"
        icon={<BadgeCheck />}
        onClick={() => {
          const r = confirm(p.id);
          if (r.ok) onClose();
        }}
      >
        Подтвердить по выписке
      </Button>
    );
  if (p.status === 'unidentified' && perms.confirm)
    footer = (
      <Button variant="primary" icon={<FileSearch />} onClick={() => onOpen({ kind: 'identify', paymentId: p.id })}>
        Опознать
      </Button>
    );

  return (
    <Drawer
      title={`${kindLabel(p)} № ${p.number}`}
      sub={`${fmt.dateTime(p.at)} · ${ix.employees.get(p.authorId)?.name ?? '—'}`}
      head={
        <div className="chips">
          <StatusChip s={PAYMENT_STATUS[p.status]} />
          <Chip tone="outline">{PAY_METHOD_NAMES[p.method]}</Chip>
        </div>
      }
      onClose={onClose}
      footer={
        footer ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Закрыть
            </Button>
            <span className="spacer" />
            {footer}
          </>
        ) : undefined
      }
    >
      <div className="money-pay-sum">
        <span className="t-12 muted">{p.kind === 'transfer' ? 'Сумма' : isIn ? 'Приход' : 'Расход'}</span>
        <span className="t-32 w-700 num">
          {p.kind === 'transfer' ? '' : isIn ? '+' : '−'}
          {fmt.money(p.amount)}
        </span>
      </div>
      {p.status === 'pending' ? <Notice tone="warn">Клиент прислал скриншот перевода. Долг уменьшится после подтверждения по выписке банка.</Notice> : null}
      {p.status === 'unidentified' ? <Notice tone="bad">Деньги пришли на счёт, но плательщик не ясен. Найдите клиента и разнесите платёж.</Notice> : null}
      <StatList>
        {client ? (
          <StatRow
            label="Покупатель"
            value={
              <EntityLink type="client" id={client.id}>
                {client.name}
              </EntityLink>
            }
          />
        ) : null}
        {supplier ? (
          <StatRow
            label="Поставщик"
            value={
              <EntityLink type="supplier" id={supplier.id}>
                {supplier.name}
              </EntityLink>
            }
          />
        ) : null}
        {shift ? <StatRow label="Смена" value={`№ ${shift.number} · ${ix.employees.get(shift.sellerId)?.short ?? ''}`} /> : null}
        {p.expenseCategory ? <StatRow label="Категория" value={p.expenseCategory} /> : null}
        {p.kind === 'transfer' ? (
          <StatRow label="Перемещение" value={transferText(p)} />
        ) : (
          <StatRow label={isIn ? 'Куда' : 'Откуда'} value={ACCOUNT_NAMES[p.account]} />
        )}
        <StatRow label="Способ" value={PAY_METHOD_NAMES[p.method]} />
        {p.comment ? <StatRow label="Комментарий" value={<span className="money-wrap">{clean(p.comment)}</span>} /> : null}
      </StatList>
      {p.allocations.length || ((p.kind === 'client' || p.kind === 'supplier') && p.status !== 'unidentified') ? (
        <div className="col">
          <span className="t-14 w-700">Распределение</span>
          <StatList>
            {p.allocations.map((a, i) => {
              if (a.orderId) {
                const o = ix.orders.get(a.orderId);
                return (
                  <StatRow
                    key={i}
                    label={
                      <EntityLink type="order" id={a.orderId}>
                        Заказ № {o?.number ?? '—'}
                      </EntityLink>
                    }
                    value={fmt.money(a.amount)}
                  />
                );
              }
              if (a.purchaseId) {
                const pu = purchases.get(a.purchaseId);
                return (
                  <StatRow
                    key={i}
                    label={
                      <EntityLink type="purchase" id={a.purchaseId}>
                        Закупка № {pu?.number ?? '—'}
                      </EntityLink>
                    }
                    value={fmt.money(a.amount)}
                  />
                );
              }
              return null;
            })}
            {rest > 0 && (p.kind === 'client' || p.kind === 'supplier') ? <StatRow label="Аванс" value={fmt.money(rest)} /> : null}
            <StatRow label="Всего" value={fmt.money(p.amount)} total />
          </StatList>
        </div>
      ) : null}
    </Drawer>
  );
}
