/* Кассы и счета: остатки, движение по счёту с остатком, деньги у курьеров, смены кассы. */
import { useMemo, useState, type ReactNode } from 'react';
import { ArrowLeftRight, HandCoins } from 'lucide-react';
import type { AccountKey, Payment } from '../../data/types';
import { ACCOUNT_NAMES } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { accountBalances, courierCash, indexes, shiftSummary } from '../../data/selectors';
import { PageHeader } from '../../shell/PageHeader';
import { Button, Card, DataTable, Kpi, MoreMenu, Segmented, Select, StatusChip, fmt, type Column } from '../../ui';
import { MoneyModalHost, useMoneyMenu, type MoneyModal } from './actions';
import { ACCOUNT_KEYS, PERIOD_OPTIONS, clean, kindLabel, periodBounds, transferText, useMoneyPerms, type PeriodKey } from './lib';
import { useMoneyCounts } from './counts';
import { KpiLink, MoneyLi } from './parts';

interface MRow {
  key: string;
  at: string;
  number: number | null;
  kind: string;
  text: ReactNode;
  textPlain: string;
  inAmt: number;
  outAmt: number;
  balance: number;
  p: Payment | null;
}

export default function Accounts() {
  const db = useDB();
  const v = useDBVersion();
  const perms = useMoneyPerms();
  const counts = useMoneyCounts();
  const [modal, setModal] = useState<MoneyModal>(null);
  const [acc, setAcc] = useState<AccountKey>('shop_cash');
  const [period, setPeriod] = useState<PeriodKey>('d30');
  const menu = useMoneyMenu(setModal, ['transfer']);
  const today = db.meta.today;

  const bal = useMemo(() => accountBalances(db), [db, v]);
  const total = bal.shop_cash + bal.courier_cash + bal.bank;
  // касса магазина: размен лежит в ящике идущей смены, остальное — в сейфе; выручка смены войдёт в остаток при закрытии
  const drawer = useMemo(() => {
    const s = db.shifts.find((x) => !x.closedAt);
    if (!s) return null;
    const sum = shiftSummary(db, s.id);
    return { number: s.number, opening: s.openingCash, sales: sum.cash, seller: indexes(db).employees.get(s.sellerId)?.short ?? '' };
  }, [db, v]);

  const moves = useMemo(() => {
    const ix = indexes(db);
    const { from, to } = periodBounds(period, today, db.meta.startDate);
    const list = db.payments.filter((p) => p.status === 'posted' && (p.account === acc || p.toAccount === acc)).sort((a, b) => a.at.localeCompare(b.at) || a.number - b.number);
    let balance = 0;
    let opening = 0;
    const rows: MRow[] = [];
    for (const p of list) {
      let inAmt = 0;
      let outAmt = 0;
      if (p.kind === 'transfer' && p.toAccount) {
        if (p.toAccount === acc) inAmt = p.amount;
        else outAmt = p.amount;
      } else if (p.direction === 'in') inAmt = p.amount;
      else outAmt = p.amount;
      balance += inAmt - outAmt;
      const d = p.at.slice(0, 10);
      if (d < from) {
        opening = balance;
        continue;
      }
      if (d > to) continue;
      const client = p.clientId ? ix.clients.get(p.clientId) : undefined;
      const supplier = p.supplierId ? ix.suppliers.get(p.supplierId) : undefined;
      const who = client?.name ?? supplier?.name ?? (p.kind === 'expense' ? p.expenseCategory : null) ?? (p.kind === 'transfer' ? transferText(p) : clean(p.comment));
      const extra = p.kind === 'transfer' ? clean(p.comment) : p.kind === 'expense' ? (clean(p.comment) !== p.expenseCategory ? clean(p.comment) : '') : client || supplier ? clean(p.comment) : '';
      rows.push({
        key: p.id,
        at: p.at,
        number: p.number,
        kind: kindLabel(p),
        text: (
          <div className="money-party is-free">
            <div className="ellipsis w-600">{who}</div>
            {extra && extra !== who ? <div className="cell-sub ellipsis">{extra}</div> : null}
          </div>
        ),
        textPlain: `${who ?? ''} ${extra}`,
        inAmt,
        outAmt,
        balance,
        p,
      });
    }
    rows.push({
      key: 'opening',
      at: `${from}T00:00`,
      number: null,
      kind: 'Остаток на начало',
      text: <span className="w-600">На {fmt.date(from)}</span>,
      textPlain: 'Остаток на начало периода',
      inAmt: 0,
      outAmt: 0,
      balance: opening,
      p: null,
    });
    // деньги открытой смены ещё не проведены платежом — показываем строкой сверху
    if (acc !== 'courier_cash' && to >= today) {
      const open = db.shifts.find((s) => !s.closedAt);
      if (open) {
        const sum = shiftSummary(db, open.id);
        const amt = acc === 'shop_cash' ? sum.cash : sum.card;
        if (amt !== 0) {
          balance += amt;
          rows.push({
            key: 'open-shift',
            at: `${today}T23:59`,
            number: null,
            kind: 'Смена идёт',
            text: (
              <div className="money-party">
                <div className="ellipsis w-600">Смена № {open.number} · {ix.employees.get(open.sellerId)?.short}</div>
                <div className="cell-sub">{acc === 'shop_cash' ? 'Наличные по чекам' : 'Оплаты картой по чекам'}, до закрытия смены</div>
              </div>
            ),
            textPlain: `Смена ${open.number}`,
            inAmt: Math.max(0, amt),
            outAmt: Math.max(0, -amt),
            balance,
            p: null,
          });
        }
      }
    }
    return { rows, opening };
  }, [db, v, acc, period, today]);

  const couriers = useMemo(() => {
    return db.employees
      .filter((e) => e.roles.includes('courier') && e.active)
      .map((e) => {
        const cc = courierCash(db, e.id);
        let todayCash = 0;
        for (const d of db.deliveries) if (d.courierId === e.id && d.date === today && d.collectedMethod === 'cash') todayCash += d.collected;
        return { e, cc, todayCash };
      })
      .sort((a, b) => b.cc.onHand - a.cc.onHand);
  }, [db, v, today]);

  const shifts = useMemo(() => {
    const ix = indexes(db);
    return [...db.shifts]
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
      .slice(0, 7)
      .map((s) => ({ s, sum: shiftSummary(db, s.id), seller: ix.employees.get(s.sellerId)?.short ?? '—' }));
  }, [db, v]);

  const columns: Column<MRow>[] = [
    {
      key: 'at',
      header: 'Дата',
      sort: (r) => r.at,
      csv: (r) => r.at.replace('T', ' '),
      width: 120,
      render: (r) => (
        <div>
          <div className="nowrap">{fmt.relDate(r.at, today)}</div>
          {r.key === 'opening' ? null : <div className="cell-sub nowrap">{r.number ? `${fmt.time(r.at)} · № ${r.number}` : 'сейчас'}</div>}
        </div>
      ),
    },
    { key: 'kind', header: 'Вид', sort: (r) => r.kind, csv: (r) => r.kind, width: 150, render: (r) => <span className="money-kind">{r.kind}</span> },
    { key: 'text', header: 'Контрагент и назначение', csv: (r) => r.textPlain, render: (r) => r.text },
    {
      key: 'in',
      header: 'Приход',
      align: 'right',
      sort: (r) => r.inAmt,
      csv: (r) => r.inAmt || '',
      width: 120,
      render: (r) => (r.inAmt ? <span className="w-600">{fmt.money(r.inAmt)}</span> : null),
      total: (rs) => fmt.money(rs.reduce((s, r) => s + r.inAmt, 0)),
    },
    {
      key: 'out',
      header: 'Расход',
      align: 'right',
      sort: (r) => r.outAmt,
      csv: (r) => r.outAmt || '',
      width: 120,
      render: (r) => (r.outAmt ? <span className="w-600">{fmt.money(r.outAmt)}</span> : null),
      total: (rs) => fmt.money(rs.reduce((s, r) => s + r.outAmt, 0)),
    },
    {
      key: 'balance',
      header: 'Остаток',
      align: 'right',
      csv: (r) => r.balance,
      width: 130,
      render: (r) => <span className="ink-2">{fmt.money(r.balance)}</span>,
      total: () => fmt.money(bal[acc]),
    },
  ];


  return (
    <>
      <PageHeader
        section="money"
        counts={counts}
        actions={
          <>
            <MoreMenu items={menu} />
            {perms.transfer ? (
              <Button variant="primary" icon={<ArrowLeftRight />} title="Перемещение денег: инкассация из кассы на счёт, выдача размена" onClick={() => setModal({ kind: 'transfer', from: acc })}>
                Переместить
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid-4">
        {ACCOUNT_KEYS.map((a) => (
          <KpiLink key={a} label={`Движение: ${ACCOUNT_NAMES[a]}`} onClick={() => setAcc(a)}>
            <Kpi
              label={ACCOUNT_NAMES[a]}
              value={fmt.money(bal[a])}
              extra={
                a === 'shop_cash' ? (
                  drawer ? (
                    <div
                      className="money-kpi-lines"
                      title={`Размен в ящике смены № ${drawer.number} (${drawer.seller}). Кроме того, в ящике наличные по чекам этой смены — ${fmt.money(drawer.sales)}: они войдут в остаток кассы при закрытии смены`}
                    >
                      <span>
                        из них в ящике смены <b>{fmt.money(drawer.opening)}</b>
                      </span>
                      <span>
                        остальное в сейфе <b>{fmt.money(bal.shop_cash - drawer.opening)}</b>
                      </span>
                    </div>
                  ) : (
                    <div className="money-kpi-lines">
                      <span>смена закрыта — всё в сейфе</span>
                    </div>
                  )
                ) : undefined
              }
            />
          </KpiLink>
        ))}
        <Kpi label="Всего денег" value={fmt.money(total)} />
      </div>
      <div className="grid-2">
        <Card title="Деньги у курьеров" flush>
          <div className="list">
            {couriers.map(({ e, cc, todayCash }) => (
              <MoneyLi
                key={e.id}
                title={e.name}
                sub={
                  <>
                    {cc.onHand > 0 ? (
                      <StatusChip s={{ label: `Не сдал · ${fmt.count(cc.deliveries, 'доставка', 'доставки', 'доставок')}`, tone: 'warn' }} />
                    ) : (
                      <StatusChip s={{ label: 'Сдал всё', tone: 'ok' }} />
                    )}
                    <span>сегодня {fmt.money(todayCash)}</span>
                  </>
                }
                amount={fmt.money(cc.onHand)}
                action={
                  perms.transfer ? (
                    cc.onHand > 0 ? (
                      <Button size="sm" icon={<HandCoins />} onClick={() => setModal({ kind: 'handin', courierId: e.id })} title="Пересчитать и принять в кассу магазина">
                        Принять
                      </Button>
                    ) : (
                      <span className="money-act-gap" />
                    )
                  ) : null
                }
              />
            ))}
            {!couriers.length ? <div className="list-row muted">Курьеров нет</div> : null}
          </div>
        </Card>
        <Card title="Смены кассы" flush>
          <div className="list">
            {shifts.map(({ s, sum, seller }) => (
              <MoneyLi
                key={s.id}
                title={`Смена № ${s.number} · ${fmt.relDate(s.openedAt, today)}`}
                sub={
                  <>
                    {s.closedAt === null ? (
                      <StatusChip s={{ label: 'Идёт', tone: 'info' }} />
                    ) : sum.difference === 0 || sum.difference === null ? (
                      <StatusChip s={{ label: 'Сошлось', tone: 'ok' }} />
                    ) : sum.difference < 0 ? (
                      <StatusChip s={{ label: `Недостача ${fmt.money(-sum.difference)}`, tone: 'bad' }} />
                    ) : (
                      <StatusChip s={{ label: `Излишек ${fmt.money(sum.difference)}`, tone: 'warn' }} />
                    )}
                    <span>
                      {seller} · выручка {fmt.money(sum.total)}
                    </span>
                  </>
                }
                amount={
                  <span
                    className="money-li-stack"
                    title={`Наличные за смену ${fmt.money(sum.cash)} и размен ${fmt.money(s.openingCash)}${s.closedAt ? (sum.countedCash === null ? '' : ', по пересчёту при закрытии') : ', ожидается сейчас'}`}
                  >
                    <span className="money-li-cap">В кассе, с разменом {fmt.money(s.openingCash)}</span>
                    <span>{fmt.money(sum.countedCash ?? sum.expectedCash)}</span>
                  </span>
                }
              />
            ))}
          </div>
        </Card>
      </div>
      <div className="money-tight">
      <DataTable
        key={acc}
        id="money-accounts"
        title={`Движение: ${ACCOUNT_NAMES[acc].toLowerCase()}`}
        rows={moves.rows}
        columns={columns}
        rowKey={(r) => r.key}
        search={{ placeholder: 'Клиент, поставщик, комментарий', text: (r) => `${r.number ?? ''} ${r.kind} ${r.textPlain} ${r.inAmt || r.outAmt}` }}
        onRowClick={(r) => (r.p ? setModal({ kind: 'payment', paymentId: r.p.id }) : undefined)}
        toolbar={
          <>
            <Segmented<AccountKey> value={acc} onChange={setAcc} options={ACCOUNT_KEYS.map((a) => ({ value: a, label: ACCOUNT_NAMES[a] }))} ariaLabel="Счёт" />
            <Select size="sm" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)} options={PERIOD_OPTIONS} aria-label="Период" style={{ width: 170 }} />
          </>
        }
        defaultSort={{ key: 'at', dir: 'desc' }}
        exportName={`Движение — ${ACCOUNT_NAMES[acc]}`}
        totalLabel={() => 'Итого за период'}
        pageSize={25}
      />
      </div>
      <MoneyModalHost modal={modal} onClose={() => setModal(null)} onOpen={setModal} />
    </>
  );
}
