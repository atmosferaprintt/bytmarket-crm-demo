/* Подробности документа склада в боковой панели. */
import { Printer } from 'lucide-react';
import { useDB } from '../../data/store';
import { indexes } from '../../data/selectors';
import { get } from '../../data/idx';
import { WRITEOFF_REASONS } from '../../data/types';
import { useSession } from '../../roles/session';
import { EntityLink } from '../../shell/entities';
import { Button, Chip, Drawer, EmptyState, StatList, StatRow, cx, fmt } from '../../ui';
import { DOC_KIND_NAMES, inBoxes } from './calc';
import { DocIcon, Route } from './DocBits';
import { usePrint } from './print';
import './stock.css';

export function StockDocDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const db = useDB();
  const { can } = useSession();
  const seeCost = can('seeCost');
  const ix = indexes(db);
  const printer = usePrint();
  const d = get(db, 'stockDocs', id);
  if (!d)
    return (
      <Drawer title="Документ" onClose={onClose}>
        <EmptyState title="Документ не найден" />
      </Drawer>
    );
  const author = ix.employees.get(d.authorId)?.name ?? '—';
  const title = `${DOC_KIND_NAMES[d.kind]} № ${d.number}`;
  const qty = d.lines.reduce((s, l) => s + l.qty, 0);
  const isCount = d.kind === 'count';
  const isWo = d.kind === 'writeoff';
  const diffs = isCount ? d.lines.filter((l) => l.qty !== (l.expected ?? l.qty)) : [];
  const loss = isWo ? d.lines.reduce((s, l) => s + l.qty * (ix.products.get(l.productId)?.cost ?? 0), 0) : 0;
  const pu = d.purchaseId ? get(db, 'purchases', d.purchaseId) : undefined;

  const lines = d.lines.map((l, i) => ({ l, i, p: ix.products.get(l.productId) }));

  const sheet = (
    <div className="stock-print-page">
      <h1>{title}</h1>
      <div className="stock-print-meta">
        <span>{fmt.dateTime(d.at)}</span>
        <span>{d.kind === 'transfer' ? `${d.from === 'shop' ? 'Магазин' : 'Склад'} — ${d.to === 'shop' ? 'Магазин' : 'Склад'}` : d.to === 'shop' || d.from === 'shop' ? 'Магазин' : 'Склад'}</span>
        <span>Автор: {author}</span>
        {d.comment ? <span>Основание: {d.comment}</span> : null}
      </div>
      <table>
        <thead>
          <tr>
            <th>№</th>
            <th>Товар</th>
            <th>Артикул</th>
            {isCount ? <th className="num">По учёту</th> : null}
            <th className="num">{isCount ? 'Факт' : 'Штук'}</th>
            {isWo ? <th>Причина</th> : null}
          </tr>
        </thead>
        <tbody>
          {lines.map(({ l, i, p }) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{p?.name}</td>
              <td>{p?.sku}</td>
              {isCount ? <td className="num">{l.expected ?? '—'}</td> : null}
              <td className="num">{l.qty}</td>
              {isWo ? <td>{l.reason ? WRITEOFF_REASONS[l.reason] : '—'}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="stock-print-sign">
        <span>Провёл: ____________ {author}</span>
        <span>Проверил: ____________</span>
      </div>
    </div>
  );

  return (
    <Drawer
      wide
      title={title}
      sub={`${fmt.dateTime(d.at)} · ${author}`}
      onClose={onClose}
      head={
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Chip tone="ok">Проведён</Chip>
          {isCount ? diffs.length ? <Chip tone="warn">Расхождений {diffs.length}</Chip> : <Chip tone="ok">Без расхождений</Chip> : null}
        </div>
      }
      footer={
        <>
          <span className="stock-doc-total">
            {fmt.count(d.lines.length, 'строка', 'строки', 'строк')} · {fmt.qty(qty)}
            {seeCost && isWo && loss ? <span className="muted"> · по себестоимости {fmt.money(loss)}</span> : null}
          </span>
          <span className="spacer" />
          <Button icon={<Printer />} onClick={() => printer.print(sheet)} data-hint="stock.docd-print">
            Печать
          </Button>
        </>
      }
    >
      <div className="row-3" style={{ alignItems: 'flex-start' }}>
        <DocIcon kind={d.kind} />
        <div className="grow" data-hint="stock.docd-info">
        <StatList>
          <StatRow label="Место" value={<Route kind={d.kind} from={d.from} to={d.to} />} />
          <StatRow label="Провёл" value={author} />
          {d.comment ? <StatRow label={isWo ? 'Комментарий' : 'Основание'} value={<span className="stock-basis" title={d.comment}>{d.comment}</span>} /> : null}
          {pu ? <StatRow label="Закупка" value={<EntityLink type="purchase" id={pu.id}>№ {pu.number}</EntityLink>} /> : null}
        </StatList>
        </div>
      </div>

      <section className="card is-flush" data-hint={isCount ? 'stock.docd-lines-count' : isWo ? 'stock.docd-lines-writeoff' : 'stock.docd-lines'}>
        <div className="table-scroll">
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Товар</th>
                {isCount ? <th className="num">По учёту</th> : null}
                <th className="num">{isCount ? 'Факт' : 'Количество'}</th>
                {isCount ? <th className="num">Разница</th> : null}
                {isWo ? <th>Причина</th> : null}
                {isWo && seeCost ? <th className="num">Сумма</th> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map(({ l, i, p }) => {
                const diff = isCount ? l.qty - (l.expected ?? l.qty) : 0;
                const boxes = p ? inBoxes(p, l.qty) : null;
                return (
                  <tr key={i}>
                    <td>
                      {p ? (
                        <EntityLink type="product" id={p.id}>
                          <span className="stock-doc-name" style={{ display: 'block' }}>{p.name}</span>
                        </EntityLink>
                      ) : (
                        '—'
                      )}
                      <div className="cell-sub">{p?.sku}</div>
                    </td>
                    {isCount ? <td className="num">{fmt.num(l.expected ?? null)}</td> : null}
                    <td className="num">
                      <span className="w-700">{fmt.qty(l.qty)}</span>
                      {boxes && !isCount ? <span className="muted"> · {boxes}</span> : null}
                    </td>
                    {isCount ? <td className={cx('num w-700', diff > 0 && 'c-ok', diff < 0 && 'c-bad')}>{diff === 0 ? <span className="faint">0</span> : `${diff > 0 ? '+' : '−'}${fmt.num(Math.abs(diff))}`}</td> : null}
                    {isWo ? <td>{l.reason ? WRITEOFF_REASONS[l.reason] : '—'}</td> : null}
                    {isWo && seeCost ? <td className="num">{p?.cost !== null && p?.cost !== undefined ? fmt.money(l.qty * p.cost) : '—'}</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {printer.element}
    </Drawer>
  );
}
