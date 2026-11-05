/* Журнал денег: все поступления, выплаты, расходы и перемещения. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HandCoins } from 'lucide-react';
import type { AccountKey, Payment, PaymentKind } from '../../data/types';
import { ACCOUNT_NAMES, PAY_METHOD_NAMES } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { indexes, shiftSummary } from '../../data/selectors';
import { nowAt } from '../overview/analytics';
import { PageHeader } from '../../shell/PageHeader';
import { EntityLink } from '../../shell/entities';
import { Button, DataTable, Kpi, MoreMenu, PAYMENT_STATUS, Select, StatusChip, cx, fmt, type Column, type FilterDef } from '../../ui';
import { MoneyModalHost, useMoneyMenu, type MoneyModal } from './actions';
import { ACCOUNT_KEYS, KIND_SHORT, clean, kindLabel, periodBounds, periodLabel, transferText, useMoneyPerms, usePeriodFromUrl, type PeriodKey } from './lib';
import { useMoneyCounts } from './counts';
import { useNarrow } from './parts';

interface JRow {
  p: Payment;
  kind: PaymentKind | 'initial';
  party: ReactNode;
  partyText: string;
  purpose: ReactNode;
  purposeText: string;
  inAmt: number;
  outAmt: number;
  /** перемещение между своими кассами при «все счета» — в итог не входит */
  internal: boolean;
  author: string;
  /** идущая смена: деньги по чекам ещё не проведены платежом — строка для итога, не документ */
  virtual?: boolean;
}

/** Дата для Excel: «05.11.2026». */
const xlDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

const KIND_ORDER: (PaymentKind | 'initial')[] = ['client', 'shift', 'supplier', 'refund', 'expense', 'transfer'];

export default function Journal() {
  const db = useDB();
  const v = useDBVersion();
  const perms = useMoneyPerms();
  const [params] = useSearchParams();
  const fromUrl = usePeriodFromUrl('d30', params);
  const custom = fromUrl.custom;
  const [modal, setModal] = useState<MoneyModal>(null);
  const [periodRaw, setPeriod] = useState<PeriodKey>(fromUrl.initial);
  // пришли по ссылке с другим периодом — показываем его; ушли со ссылки — обычный выбор
  const customKey = custom ? `${custom.from}|${custom.to}` : '';
  useEffect(() => {
    if (customKey) setPeriod('custom');
  }, [customKey]);
  const period: PeriodKey = periodRaw === 'custom' && !custom ? 'd30' : periodRaw;
  const [acc, setAcc] = useState<AccountKey | 'all'>('all');
  const menu = useMoneyMenu(setModal, ['accept']);
  const counts = useMoneyCounts();
  const today = db.meta.today;
  const narrow = useNarrow();

  const rows = useMemo<JRow[]>(() => {
    const ix = indexes(db);
    const { from, to } = periodBounds(period, today, db.meta.startDate, custom);
    const purchases = new Map(db.purchases.map((x) => [x.id, x]));
    const shifts = new Map(db.shifts.map((x) => [x.id, x]));
    const deliveries = new Map(db.deliveries.map((x) => [x.id, x]));
    const out: JRow[] = [];
    for (const p of db.payments) {
      const d = p.at.slice(0, 10);
      if (d < from || d > to) continue;
      if (acc !== 'all' && p.account !== acc && p.toAccount !== acc) continue;
      const kind: JRow['kind'] = p.kind === 'transfer' && !p.toAccount ? 'initial' : p.kind;
      let party: ReactNode = <span className="faint">—</span>;
      let partyText = '';
      let purpose: ReactNode = null;
      let purposeText = '';
      const client = p.clientId ? ix.clients.get(p.clientId) : undefined;
      const supplier = p.supplierId ? ix.suppliers.get(p.supplierId) : undefined;
      if (client) {
        party = (
          <EntityLink type="client" id={client.id}>
            {client.name}
          </EntityLink>
        );
        partyText = client.name;
      } else if (supplier) {
        party = (
          <EntityLink type="supplier" id={supplier.id}>
            {supplier.name}
          </EntityLink>
        );
        partyText = supplier.name;
      } else if (p.kind === 'shift') {
        const s = p.shiftId ? shifts.get(p.shiftId) : undefined;
        partyText = s ? `Продавец ${ix.employees.get(s.sellerId)?.short ?? ''}` : 'Касса';
        party = <span className="w-600">{partyText}</span>;
      } else if (p.kind === 'expense') {
        partyText = p.expenseCategory ?? 'Расход';
        party = <span className="w-600">{partyText}</span>;
      } else if (p.kind === 'transfer' && p.deliveryId) {
        const del = deliveries.get(p.deliveryId);
        const cur = del?.courierId ? ix.employees.get(del.courierId) : undefined;
        if (cur) {
          partyText = `Курьер ${cur.short}`;
          party = <span className="w-600">{partyText}</span>;
        }
      } else if (p.kind === 'transfer') {
        partyText = p.toAccount ? clean(p.comment) || 'Перемещение' : 'Остаток на начало учёта';
        party = <span className="w-600">{partyText}</span>;
      } else if (p.status === 'unidentified') {
        partyText = 'Плательщик не ясен';
        party = <span className="c-bad w-600">{partyText}</span>;
      }
      // назначение
      const orderLinks = p.allocations.filter((a) => a.orderId);
      const purchaseLinks = p.allocations.filter((a) => a.purchaseId);
      const allocated = p.allocations.reduce((s, a) => s + a.amount, 0);
      if (orderLinks.length) {
        const nums = orderLinks.map((a) => ix.orders.get(a.orderId!)?.number ?? 0);
        purposeText = (orderLinks.length > 1 ? 'Заказы ' : 'Заказ ') + nums.map((n) => `№ ${n}`).join(', ');
        purpose = (
          <>
            {orderLinks.length > 1 ? 'Заказы ' : 'Заказ '}
            {orderLinks.map((a, i) => (
              <span key={a.orderId}>
                {i ? ', ' : ''}
                <EntityLink type="order" id={a.orderId!} className="entity-link money-link">
                  № {nums[i]}
                </EntityLink>
              </span>
            ))}
            {p.kind === 'client' && p.amount > allocated ? `, аванс ${fmt.money(p.amount - allocated)}` : ''}
          </>
        );
      } else if (purchaseLinks.length) {
        const nums = purchaseLinks.map((a) => purchases.get(a.purchaseId!)?.number ?? 0);
        purposeText = (purchaseLinks.length > 1 ? 'Закупки ' : 'Закупка ') + nums.map((n) => `№ ${n}`).join(', ');
        purpose = (
          <>
            {purchaseLinks.length > 1 ? 'Закупки ' : 'Закупка '}
            {purchaseLinks.map((a, i) => (
              <span key={a.purchaseId}>
                {i ? ', ' : ''}
                <EntityLink type="purchase" id={a.purchaseId!} className="entity-link money-link">
                  № {nums[i]}
                </EntityLink>
              </span>
            ))}
          </>
        );
      } else if (p.kind === 'transfer') {
        purposeText = p.toAccount ? transferText(p) : ACCOUNT_NAMES[p.account];
        purpose = purposeText;
      } else if (p.kind === 'client' && p.status === 'posted') {
        purposeText = 'Аванс без заказа';
        purpose = purposeText;
      } else {
        purposeText = clean(p.comment);
        purpose = purposeText;
      }
      // приход и расход с точки зрения выбранного счёта
      let inAmt = 0;
      let outAmt = 0;
      let internal = false;
      if (p.kind === 'transfer' && p.toAccount) {
        if (acc === 'all') {
          inAmt = p.amount;
          outAmt = p.amount;
          internal = true;
        } else if (p.account === acc) outAmt = p.amount;
        else inAmt = p.amount;
      } else if (kind === 'initial') {
        inAmt = p.amount;
        internal = acc === 'all';
      } else if (p.direction === 'in') inAmt = p.amount;
      else outAmt = p.amount;
      out.push({
        p,
        kind,
        party,
        partyText,
        purpose,
        purposeText,
        inAmt,
        outAmt,
        internal,
        author: ix.employees.get(p.authorId)?.short ?? '—',
      });
    }
    // идущая смена: наличные и карты по чекам войдут в журнал при закрытии смены, но деньги уже поступили —
    // так же считает «Поступило денег» на обзоре
    const open = to >= today ? db.shifts.find((x) => !x.closedAt) : undefined;
    if (open) {
      const sum = shiftSummary(db, open.id);
      const now = nowAt();
      const seller = ix.employees.get(open.sellerId)?.short ?? '';
      const parts: { account: AccountKey; amount: number; method: Payment['method'] }[] = [
        { account: 'shop_cash', amount: sum.cash, method: 'cash' },
        { account: 'bank', amount: sum.card, method: 'card' },
      ];
      for (const x of parts) {
        if (x.amount <= 0 || (acc !== 'all' && acc !== x.account)) continue;
        const p: Payment = {
          id: `open-shift-${x.account}`,
          number: 0,
          at: now,
          direction: 'in',
          kind: 'shift',
          clientId: null,
          supplierId: null,
          amount: x.amount,
          method: x.method,
          account: x.account,
          toAccount: null,
          allocations: [],
          status: 'posted',
          shiftId: open.id,
          deliveryId: null,
          returnId: null,
          expenseCategory: null,
          authorId: open.sellerId,
          comment: '',
          idempotencyKey: null,
        };
        const text = `Смена № ${open.number} идёт · ${seller}`;
        out.push({
          p,
          kind: 'shift',
          party: <span className="w-600">{text}</span>,
          partyText: text,
          purpose: x.method === 'cash' ? 'Наличные по чекам, проведутся при закрытии смены' : 'Оплаты картой по чекам, проведутся при закрытии смены',
          purposeText: x.method === 'cash' ? 'Наличные по чекам до закрытия смены' : 'Карты по чекам до закрытия смены',
          inAmt: x.amount,
          outAmt: 0,
          internal: false,
          author: seller,
          virtual: true,
        });
      }
    }
    return out;
  }, [db, v, period, acc, today, custom?.from, custom?.to]);

  const kpi = useMemo(() => {
    let inSum = 0;
    let outSum = 0;
    for (const r of rows) {
      if (r.internal || r.p.status !== 'posted') continue;
      inSum += r.inAmt;
      outSum += r.outAmt;
    }
    let pend = 0;
    let pendN = 0;
    let unid = 0;
    let unidN = 0;
    for (const p of db.payments) {
      if (p.status === 'pending') {
        pend += p.amount;
        pendN++;
      } else if (p.status === 'unidentified') {
        unid += p.amount;
        unidN++;
      }
    }
    return { inSum, outSum, pend, pendN, unid, unidN };
  }, [rows, db, v]);

  const counted = (r: JRow) => !r.internal && r.p.status === 'posted';

  const columns: Column<JRow>[] = [
    {
      key: 'at',
      header: 'Дата',
      sort: (r) => r.p.at,
      csv: (r) => xlDate(r.p.at),
      width: 100,
      render: (r) => (
        <div>
          <div className="nowrap">{fmt.relDate(r.p.at, today)}</div>
          <div className="cell-sub nowrap">{r.virtual ? 'сейчас · смена идёт' : `${fmt.time(r.p.at)} · № ${r.p.number}`}</div>
          {narrow ? <div className="cell-sub nowrap">{r.author}</div> : null}
        </div>
      ),
    },
    // в выгрузке для Excel время и номер — отдельными колонками; на экране они во второй строке даты
    { key: 'time', header: 'Время', className: 'money-csv-only', csv: (r) => (r.virtual ? '' : r.p.at.slice(11, 16)), render: () => null },
    { key: 'no', header: '№', className: 'money-csv-only', csv: (r) => (r.virtual ? '' : r.p.number), render: () => null },
    {
      key: 'kind',
      header: 'Вид',
      sort: (r) => kindLabel(r.p),
      csv: (r) => kindLabel(r.p),
      width: 104,
      render: (r) => <span className="money-kind">{kindLabel(r.p)}</span>,
    },
    {
      key: 'party',
      header: 'Контрагент и назначение',
      sort: (r) => r.partyText || 'я',
      csv: (r) => [r.partyText, r.purposeText].filter(Boolean).join(' — '),
      render: (r) => (
        <div className="money-party">
          <div className="ellipsis">{r.party}</div>
          {r.purpose ? <div className="cell-sub ellipsis">{r.purpose}</div> : null}
        </div>
      ),
    },
    {
      key: 'account',
      header: 'Касса или счёт',
      sort: (r) => ACCOUNT_NAMES[r.p.account],
      csv: (r) => `${ACCOUNT_NAMES[r.p.account]}, ${PAY_METHOD_NAMES[r.p.method].toLowerCase()}`,
      width: 120,
      render: (r) => (
        <div>
          <div className="nowrap">{ACCOUNT_NAMES[r.p.account]}</div>
          <div className="cell-sub">{PAY_METHOD_NAMES[r.p.method]}</div>
        </div>
      ),
    },
    {
      key: 'in',
      header: 'Приход',
      align: 'right',
      sort: (r) => r.inAmt,
      csv: (r) => r.inAmt || '',
      width: 96,
      render: (r) => (r.inAmt ? <span className={cx('w-600', !counted(r) && 'faint')}>{fmt.money(r.inAmt)}</span> : null),
      total: (rs) => fmt.money(rs.reduce((s, r) => s + (counted(r) ? r.inAmt : 0), 0)),
    },
    {
      key: 'out',
      header: 'Расход',
      align: 'right',
      sort: (r) => r.outAmt,
      csv: (r) => r.outAmt || '',
      width: 96,
      render: (r) => (r.outAmt ? <span className={cx('w-600', !counted(r) && 'faint')}>{fmt.money(r.outAmt)}</span> : null),
      total: (rs) => fmt.money(rs.reduce((s, r) => s + (counted(r) ? r.outAmt : 0), 0)),
    },
    {
      key: 'status',
      header: 'Статус',
      sort: (r) => r.p.status,
      csv: (r) => (r.virtual ? 'Смена идёт' : PAYMENT_STATUS[r.p.status].label),
      width: 150,
      render: (r) => (
        <div className="col money-jr-status">
          <StatusChip s={r.virtual ? { label: 'Смена идёт', tone: 'info' } : PAYMENT_STATUS[r.p.status]} />
          {r.p.status === 'pending' && perms.confirm ? (
            <button
              type="button"
              className="link-button t-12"
              title="Сверить с выпиской банка и подтвердить"
              onClick={(e) => {
                e.stopPropagation();
                setModal({ kind: 'confirm', paymentId: r.p.id });
              }}
            >
              Подтвердить
            </button>
          ) : null}
          {r.p.status === 'unidentified' && perms.confirm ? (
            <button
              type="button"
              className="link-button t-12"
              onClick={(e) => {
                e.stopPropagation();
                setModal({ kind: 'identify', paymentId: r.p.id });
              }}
            >
              Опознать
            </button>
          ) : null}
        </div>
      ),
    },
    { key: 'author', header: 'Автор', hidden: narrow, sort: (r) => r.author, csv: (r) => r.author, width: 80, render: (r) => <span className="nowrap ink-2">{r.author}</span> },
  ];

  const filters = useMemo<FilterDef<JRow>[]>(
    () => [
      {
        key: 'kind',
        label: 'Вид',
        showCounts: true,
        options: [
          { value: 'all', label: 'Все' },
          ...KIND_ORDER.map((k) => ({
            value: k,
            label: KIND_SHORT[k as PaymentKind],
            test: (r: JRow) => (k === 'transfer' ? r.kind === 'transfer' || r.kind === 'initial' : r.kind === k),
          })),
        ],
      },
      {
        key: 'status',
        label: 'Статус',
        showCounts: true,
        options: [
          { value: 'all', label: 'Все' },
          { value: 'posted', label: PAYMENT_STATUS.posted.label, test: (r: JRow) => r.p.status === 'posted' },
          { value: 'pending', label: PAYMENT_STATUS.pending.label, test: (r: JRow) => r.p.status === 'pending' },
          { value: 'unidentified', label: PAYMENT_STATUS.unidentified.label, test: (r: JRow) => r.p.status === 'unidentified' },
        ],
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        section="money"
        counts={counts}
        actions={
          <>
            <MoreMenu items={menu} />
            {perms.accept ? (
              <Button variant="primary" icon={<HandCoins />} onClick={() => setModal({ kind: 'accept' })}>
                Принять оплату
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid-4">
        <Kpi label="Поступило за период" value={fmt.money(kpi.inSum)} />
        <Kpi label="Выплачено за период" value={fmt.money(kpi.outSum)} />
        <Kpi label={`Ждут подтверждения · ${kpi.pendN}`} value={fmt.money(kpi.pend)} />
        <Kpi label={`Не опознано · ${kpi.unidN}`} value={<span className={kpi.unidN ? 'c-bad' : undefined}>{fmt.money(kpi.unid)}</span>} />
      </div>
      <div className="money-tight">
      <DataTable
        id="money-journal"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.p.id}
        search={{ placeholder: 'Номер, клиент, сумма', text: (r) => `${r.p.number} ${r.partyText} ${r.purposeText} ${r.p.comment} ${r.p.amount}` }}
        filters={filters}
        defaultSort={{ key: 'at', dir: 'desc' }}
        onRowClick={(r) => (r.virtual ? undefined : setModal({ kind: 'payment', paymentId: r.p.id }))}
        toolbar={
          <>
            <Select size="sm" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)} options={fromUrl.options} aria-label="Период" style={{ width: 170 }} />
            <Select
              size="sm"
              value={acc}
              onChange={(e) => setAcc(e.target.value as AccountKey | 'all')}
              options={[{ value: 'all', label: 'Все кассы и счета' }, ...ACCOUNT_KEYS.map((a) => ({ value: a, label: ACCOUNT_NAMES[a] }))]}
              aria-label="Касса или счёт"
              style={{ width: 170 }}
            />
          </>
        }
        exportName={`Журнал денег ${periodLabel(period, today, db.meta.startDate, custom)}${acc === 'all' ? '' : ' — ' + ACCOUNT_NAMES[acc]}`}
        totalLabel={(n) => `Итого · ${fmt.num(n)}`}
        pageSize={40}
      />
      </div>
      <MoneyModalHost modal={modal} onClose={() => setModal(null)} onOpen={setModal} />
    </>
  );
}

