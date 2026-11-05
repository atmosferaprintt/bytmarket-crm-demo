import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Bookmark, Download, Trash2, Check } from 'lucide-react';
import { cx } from './cx';
import { Field, Input, SearchInput } from './Field';
import { Modal } from './Overlay';
import { Button } from './Button';
import { Segmented } from './Tabs';
import { MoreMenu, type MenuItem } from './Menu';
import { EmptyState } from './Card';
import { num } from './format';
import { toast } from './Toast';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** содержимое ячейки */
  render?: (row: T) => ReactNode;
  /** значение для сортировки; если задано — колонка сортируется */
  sort?: (row: T) => number | string | null;
  /** значение для выгрузки в CSV */
  csv?: (row: T) => string | number | null;
  /** заголовок колонки в CSV, если header — не строка */
  csvHeader?: string;
  align?: 'left' | 'right';
  width?: number | string;
  /** итог по отфильтрованным строкам */
  total?: (rows: T[]) => ReactNode;
  className?: string;
  hidden?: boolean;
}

export interface FilterOption<T> {
  value: string;
  label: ReactNode;
  test?: (row: T) => boolean;
}

export interface FilterDef<T> {
  key: string;
  label?: string;
  options: FilterOption<T>[]; // первая — «Все» без test
  showCounts?: boolean;
}

interface ViewState {
  search: string;
  filters: Record<string, string>;
  sort: { key: string; dir: 'asc' | 'desc' } | null;
}
interface SavedView extends ViewState {
  name: string;
}

export interface DataTableProps<T> {
  id?: string; // для сохранённых видов
  /** метка для подсказок режима обучения: data-hint на таблице */
  hint?: string;
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  search?: { placeholder?: string; text: (row: T) => string };
  filters?: FilterDef<T>[];
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  rowClassName?: (row: T) => string | undefined;
  toolbar?: ReactNode; // доп. элементы слева (селекты)
  toolbarRight?: ReactNode;
  menuItems?: MenuItem[];
  exportName?: string; // включает выгрузку CSV
  pageSize?: number;
  empty?: ReactNode;
  dense?: boolean;
  totalLabel?: (count: number) => ReactNode;
  hideToolbar?: boolean;
  presetViews?: SavedView[];
  card?: boolean;
  title?: ReactNode;
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/** Текст из заголовка-узла (для CSV): собирает строки из вложенных элементов. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ').trim();
  if (typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: ReactNode } }).props.children);
  return '';
}

function loadViews(id?: string): SavedView[] {
  if (!id) return [];
  try {
    const raw = localStorage.getItem(`bm-views-${id}`);
    return raw ? (JSON.parse(raw) as SavedView[]) : [];
  } catch {
    return [];
  }
}
function storeViews(id: string, views: SavedView[]) {
  try {
    localStorage.setItem(`bm-views-${id}`, JSON.stringify(views));
  } catch {
    /* хранилище недоступно — виды живут до перезагрузки */
  }
}

/** Таблица как в задании: поиск, фильтры, сортировка, итоги, сохранённые виды, выгрузка для Excel. */
export function DataTable<T>(props: DataTableProps<T>) {
  const { rows, columns, rowKey, search, filters = [], defaultSort, onRowClick, selectedKey, rowClassName, pageSize = 60, dense, id } = props;
  const visibleCols = columns.filter((c) => !c.hidden);
  const initialFilters = useMemo(() => Object.fromEntries(filters.map((f) => [f.key, f.options[0]?.value ?? ''])), [filters.map((f) => f.key).join('|')]);
  const [q, setQ] = useState('');
  const [fv, setFv] = useState<Record<string, string>>(initialFilters);
  const [sort, setSort] = useState<ViewState['sort']>(defaultSort ?? null);
  const [limit, setLimit] = useState(pageSize);
  const [views, setViews] = useState<SavedView[]>(() => loadViews(id));
  const [activeView, setActiveView] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const saveView = () => {
    const name = naming?.trim();
    if (!name || !id) return;
    const next = [...views.filter((v) => v.name !== name), { name, search: q, filters: fv, sort }];
    setViews(next);
    storeViews(id, next);
    setActiveView(name);
    setNaming(null);
    toast(`Вид «${name}» сохранён`);
  };
  const namingModal =
    naming !== null ? (
      <Modal
        title="Сохранить вид таблицы"
        sub="Запомним поиск, фильтры и сортировку"
        onClose={() => setNaming(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setNaming(null)}>
              Отмена
            </Button>
            <Button variant="primary" onClick={saveView} disabled={!naming.trim()}>
              Сохранить
            </Button>
          </>
        }
      >
        <Field label="Название">
          <Input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveView()} />
        </Field>
      </Modal>
    ) : null;

  useEffect(() => setLimit(pageSize), [q, fv, sort, pageSize]);

  const searched = useMemo(() => {
    if (!search || !q.trim()) return rows;
    const tokens = norm(q.trim()).split(/\s+/);
    return rows.filter((r) => {
      const t = norm(search.text(r));
      return tokens.every((tok) => t.includes(tok));
    });
  }, [rows, q, search]);

  const filtered = useMemo(() => {
    let out = searched;
    for (const f of filters) {
      const opt = f.options.find((o) => o.value === fv[f.key]);
      if (opt?.test) out = out.filter(opt.test);
    }
    return out;
  }, [searched, filters, fv]);

  const counts = useMemo(() => {
    const res: Record<string, Record<string, number>> = {};
    for (const f of filters) {
      if (!f.showCounts) continue;
      res[f.key] = {};
      // счётчики считаем по строкам с учётом поиска и остальных фильтров
      let base = searched;
      for (const g of filters) {
        if (g.key === f.key) continue;
        const opt = g.options.find((o) => o.value === fv[g.key]);
        if (opt?.test) base = base.filter(opt.test);
      }
      for (const o of f.options) res[f.key][o.value] = o.test ? base.filter(o.test).length : base.length;
    }
    return res;
  }, [searched, filters, fv]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return filtered;
    const get = col.sort;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'ru') * dir;
    });
  }, [filtered, sort, columns]);

  const shown = sorted.slice(0, limit);
  const hasTotals = visibleCols.some((c) => c.total);

  const toggleSort = (c: Column<T>) => {
    if (!c.sort) return;
    setActiveView(null);
    setSort((s) => (s?.key === c.key ? (s.dir === 'desc' ? { key: c.key, dir: 'asc' } : null) : { key: c.key, dir: typeof c.sort!(rows[0] as T) === 'number' ? 'desc' : 'asc' }));
  };

  const applyView = (v: SavedView) => {
    setQ(v.search);
    setFv({ ...initialFilters, ...v.filters });
    setSort(v.sort);
    setActiveView(v.name);
  };

  const exportCsv = () => {
    const head = visibleCols.map((c) => c.csvHeader ?? (typeof c.header === 'string' ? c.header : textOf(c.header) || c.key));
    const lines = sorted.map((r) =>
      visibleCols.map((c) => {
        const v = c.csv ? c.csv(r) : c.sort ? c.sort(r) : '';
        const s = v === null || v === undefined ? '' : String(v);
        return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }),
    );
    const csv = '﻿' + [head, ...lines].map((l) => l.join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${props.exportName ?? 'таблица'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`Выгружено строк: ${num(sorted.length)}`);
  };

  const allViews = [...(props.presetViews ?? []), ...views];
  const viewItems: MenuItem[] = [
    ...allViews.map((v) => ({
      label: v.name,
      icon: activeView === v.name ? <Check /> : <Bookmark />,
      onClick: () => applyView(v),
    })),
    ...(allViews.length ? [{ label: 'sep', separator: true } as MenuItem] : []),
    {
      label: 'Сохранить текущий вид',
      icon: <Bookmark />,
      onClick: () => setNaming(`Мой вид ${views.length + 1}`),
      hidden: !id,
    },
    ...views.map((v) => ({
      label: `Удалить «${v.name}»`,
      icon: <Trash2 />,
      danger: true,
      onClick: () => {
        const next = views.filter((x) => x.name !== v.name);
        setViews(next);
        if (id) storeViews(id, next);
        if (activeView === v.name) setActiveView(null);
      },
    })),
  ];

  const menu: MenuItem[] = [
    ...(props.menuItems ?? []),
    ...(props.exportName ? [{ label: 'Скачать для Excel (CSV)', icon: <Download />, onClick: exportCsv }] : []),
  ];

  const toolbar = props.hideToolbar ? null : (
    <div className="table-toolbar">
      {props.title ? <h2 className="card-title" style={{ marginRight: 8 }}>{props.title}</h2> : null}
      {search ? (
        <SearchInput
          value={q}
          onChange={(v) => {
            setQ(v);
            setActiveView(null);
          }}
          placeholder={search.placeholder ?? 'Поиск'}
        />
      ) : null}
      {filters.map((f) => (
        <Segmented
          key={f.key}
          ariaLabel={f.label}
          value={fv[f.key]}
          onChange={(v) => {
            setFv((s) => ({ ...s, [f.key]: v }));
            setActiveView(null);
          }}
          options={f.options.map((o) => ({ value: o.value, label: o.label, count: f.showCounts ? counts[f.key]?.[o.value] : undefined }))}
        />
      ))}
      {props.toolbar}
      <span className="table-toolbar-right">
      {props.toolbarRight}
      {id || props.presetViews?.length ? (
        <MoreMenu
          items={viewItems}
          label="Виды таблицы"
          trigger={
            <>
              <Bookmark />
              {activeView ?? 'Виды'}
            </>
          }
          size="md"
        />
      ) : null}
      {menu.length ? <MoreMenu items={menu} /> : null}
      </span>
    </div>
  );

  const table = (
    <>
      {toolbar}
      <div className="table-scroll">
        <table className={cx('table', dense && 'table-dense')}>
          <thead>
            <tr>
              {visibleCols.map((c) => {
                const sorted = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    className={cx(c.align === 'right' && 'num', c.sort && 'is-sortable', sorted && 'is-sorted', c.className)}
                    style={c.width ? { width: c.width } : undefined}
                    onClick={() => toggleSort(c)}
                    aria-sort={sorted ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    <span className="th-inner">
                      {c.header}
                      {c.sort ? sorted ? sort!.dir === 'asc' ? <ArrowUp /> : <ArrowDown /> : <ArrowUpDown style={{ opacity: 0.35 }} /> : null}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const k = rowKey(r);
              return (
                <tr
                  key={k}
                  className={cx(onRowClick && 'is-clickable', selectedKey === k && 'is-selected', rowClassName?.(r))}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                >
                  {visibleCols.map((c) => (
                    <td key={c.key} className={cx(c.align === 'right' && 'num', c.className)}>
                      {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          {hasTotals && sorted.length ? (
            <tfoot>
              <tr>
                {visibleCols.map((c, i) => (
                  <td key={c.key} className={cx(c.align === 'right' && 'num', c.className)}>
                    {i === 0 && !c.total ? props.totalLabel?.(sorted.length) ?? `Итого · ${num(sorted.length)}` : c.total ? c.total(sorted) : null}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {!sorted.length ? props.empty ?? <EmptyState title="Ничего не найдено">Измените поиск или фильтры</EmptyState> : null}
      {sorted.length > limit ? (
        <div className="table-foot">
          <span>
            Показано {num(shown.length)} из {num(sorted.length)}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLimit((l) => l + pageSize * 2)}>
            Показать ещё
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLimit(sorted.length)}>
            Показать все
          </button>
        </div>
      ) : !hasTotals && sorted.length ? (
        <div className="table-foot">{props.totalLabel?.(sorted.length) ?? `Найдено ${num(sorted.length)}`}</div>
      ) : null}
    </>
  );

  if (props.card === false)
    return (
      <>
        {table}
        {namingModal}
      </>
    );
  return (
    <section className="card table-card" data-hint={props.hint}>
      {table}
      {namingModal}
    </section>
  );
}
