import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, FileUp, Pencil, Trash2, Wand2 } from 'lucide-react';
import { Button, Card, Checkbox, Chip, DataTable, MoreMenu, Notice, Segmented, Select, StatusChip, Textarea, fmt, toast, type Column, type FilterDef, type Tone } from '../../../ui';
import { dispatch, getDB, nowDemo, useDB, useDBVersion } from '../../../data/store';
import type { ID } from '../../../data/types';
import { useSession } from '../../../roles/session';
import { EntityLink } from '../../../shell/entities';
import { FIELDS, TEMPLATE_HEADER, buildCatalog, buildPreview, dryRun, guessMapping, parseTable, serializeTable, type FieldKey, type Mode, type PreviewRow, type RowStatus } from './importer';
import { buildSample } from './sample';
import { FixRowModal } from './FixRowModal';

const ROW_STATUS: Record<RowStatus, { label: string; tone: Tone }> = {
  error: { label: 'Ошибка', tone: 'bad' },
  dup: { label: 'Возможный дубль', tone: 'warn' },
  create: { label: 'Новый товар', tone: 'ok' },
  price: { label: 'Обновить цену', tone: 'info' },
  same: { label: 'Без изменений', tone: 'neutral' },
};
const STATUS_ORDER: RowStatus[] = ['error', 'dup', 'create', 'price', 'same'];

type LooseDispatch = (type: string, payload: unknown, actorId: ID) => { ok: true; id?: ID; info?: string } | { ok: false; error: string };

interface Result {
  created: ID[];
  updated: ID[];
  same: number;
  failed: string | null;
}

export function ProductImport() {
  const db = useDB();
  const version = useDBVersion();
  const { me } = useSession();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>('new');
  const [manual, setManual] = useState<{ sig: string; mapping: (FieldKey | null)[]; hasHeader: boolean } | null>(null);
  const [ack, setAck] = useState(false);
  const [fixing, setFixing] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const grid = useMemo(() => parseTable(text), [text]);
  const width = useMemo(() => grid.reduce((n, r) => Math.max(n, r.length), 0), [grid]);
  const headerSig = grid[0]?.join('\u0001') ?? '';
  // колонки угадываются по заголовкам; ручной выбор держится, пока не поменялась строка заголовков
  const guessed = useMemo(() => {
    const g = guessMapping(grid[0] ?? []);
    return { mapping: g.mapping, hasHeader: g.matched > 0 || !grid.length };
  }, [headerSig]);
  const own = manual?.sig === headerSig ? manual : null;
  const mapping = own?.mapping ?? guessed.mapping;
  const hasHeader = own?.hasHeader ?? guessed.hasHeader;
  const setHasHeader = (v: boolean) => setManual({ sig: headerSig, mapping, hasHeader: v });
  useEffect(() => setAck(false), [text, mode]);

  const catalog = useMemo(() => buildCatalog(db), [db, version]);
  const fullMapping = useMemo(() => Array.from({ length: width }, (_, i) => mapping[i] ?? null), [mapping, width]);
  const preview = useMemo(() => buildPreview(db, catalog, grid, fullMapping, hasHeader, mode), [db, version, catalog, grid, fullMapping, hasHeader, mode]);

  // пробный прогон теми же операциями на копии каталога: ловит всё, что не поймала проверка строк
  const dry = useMemo(() => (preview.counts.error === 0 && !preview.missing.length ? dryRun(db, preview.plan, me.id, nowDemo()) : new Map<number, string>()), [preview, db, version, me.id]);
  const rows = useMemo<PreviewRow[]>(
    () =>
      dry.size
        ? preview.rows.map((r) => (dry.has(r.line) ? { ...r, status: 'error' as const, op: null, issues: [...r.issues, { level: 'error' as const, text: dry.get(r.line)! }] } : r))
        : preview.rows,
    [preview, dry],
  );
  const counts = useMemo(() => {
    const c: Record<RowStatus, number> = { error: 0, dup: 0, create: 0, price: 0, same: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);
  const plan = useMemo(() => preview.plan.filter((p) => !dry.has(p.line)), [preview, dry]);
  const ready = !preview.missing.length && counts.error === 0 && plan.length > 0 && (counts.dup === 0 || ack);

  const setCells = (gi: number, cells: string[]) => setText(serializeTable(grid.map((r, i) => (i === gi ? cells : r))));
  const removeRow = (gi: number) => {
    setText(serializeTable(grid.filter((_, i) => i !== gi)));
    toast('Строка убрана из загрузки', 'info');
  };

  const pasteSample = () => {
    setResult(null);
    setMode('new');
    setText(buildSample(getDB()));
  };

  const downloadTemplate = () => {
    const csv = '﻿' + TEMPLATE_HEADER.join(';') + '\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Шаблон загрузки товаров.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Шаблон скачан: заполните в Excel и загрузите сюда');
  };

  const readFile = async (f: File) => {
    if (/\.(xlsx|xls|ods)$/i.test(f.name)) {
      toast('В Excel сохраните файл как «CSV (разделитель — точка с запятой)» или скопируйте ячейки и вставьте', 'error');
      return;
    }
    const buf = await f.arrayBuffer();
    let s: string;
    try {
      s = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      s = new TextDecoder('windows-1251').decode(buf); // так сохраняет CSV русский Excel
    }
    setResult(null);
    setText(s);
    toast(`Файл «${f.name}» прочитан`, 'info');
  };

  const runImport = () => {
    if (!ready) return;
    // ещё раз на свежей базе — «всё или ничего»
    const again = dryRun(getDB(), plan, me.id, nowDemo());
    if (again.size) {
      const [line, msg] = again.entries().next().value as [number, string];
      toast(`Ничего не загружено. Строка ${line}: ${msg}`, 'error');
      return;
    }
    const created: ID[] = [];
    const updated: ID[] = [];
    for (const { line, op } of plan) {
      const r = (dispatch as unknown as LooseDispatch)(op.type, op.payload, me.id);
      if (!r.ok) {
        setResult({ created, updated, same: counts.same, failed: `Строка ${line}: ${r.error}` });
        return;
      }
      if (op.type === 'product.create' && r.id) created.push(r.id);
      else updated.push(String(op.payload.productId));
    }
    setResult({ created, updated, same: counts.same, failed: null });
    setText('');
    const parts = [
      created.length ? fmt.count(created.length, 'новый товар', 'новых товара', 'новых товаров') : '',
      updated.length ? `цены у ${fmt.count(updated.length, 'товара', 'товаров', 'товаров')}` : '',
    ].filter(Boolean);
    toast(`Загружено: ${parts.join(', ')}`);
  };

  const columns = useMemo<Column<PreviewRow>[]>(() => {
    const badField = (r: PreviewRow, f: FieldKey) => r.issues.some((i) => i.level === 'error' && i.field === f);
    const cell = (r: PreviewRow, f: FieldKey, show: (r: PreviewRow) => string) =>
      badField(r, f) ? <span className="set-bad-value">{r.raw[f] || 'пусто'}</span> : r.raw[f] === undefined || r.raw[f] === '' ? <span className="faint">—</span> : show(r);
    const issueList = (r: PreviewRow) => {
      const list = [...r.issues].sort((a, b) => ['error', 'dup', 'note'].indexOf(a.level) - ['error', 'dup', 'note'].indexOf(b.level));
      if (!list.length && !r.change) return null;
      return (
        <div className="set-issues">
          {r.change ? <span className="ink-2 w-600">{r.change.charAt(0).toUpperCase() + r.change.slice(1)}</span> : null}
          {list.map((i, k) => (
            <span key={k} className={i.level === 'error' ? 'set-issue-error' : i.level === 'dup' ? 'set-issue-dup' : 'set-issue-note'}>
              {i.text}
            </span>
          ))}
        </div>
      );
    };
    return [
      { key: 'line', header: '№', width: 44, sort: (r) => r.line, render: (r) => <span className="muted">{r.line}</span> },
      {
        key: 'status',
        header: 'Проверка',
        sort: (r) => STATUS_ORDER.indexOf(r.status),
        render: (r) => <StatusChip s={ROW_STATUS[r.status]} />,
      },
      {
        key: 'name',
        header: 'Товар',
        sort: (r) => r.name,
        render: (r) => (
          <div style={{ minWidth: 280, maxWidth: 360, whiteSpace: 'normal' }}>
            <div className={badField(r, 'name') ? 'set-bad-value' : 'cell-title'}>{r.name || 'Без названия'}</div>
            <div className="cell-sub">
              {r.match ? (
                <>
                  В каталоге:{' '}
                  <EntityLink type="product" id={r.match.id}>
                    {r.match.sku}
                  </EntityLink>
                </>
              ) : (
                <>
                  <span className={badField(r, 'brand') ? 'set-bad-value' : undefined}>{r.brand?.name ?? (r.raw.brand || 'бренд не указан')}</span>
                  {' · '}
                  <span className={badField(r, 'category') ? 'set-bad-value' : undefined}>{r.category?.name ?? (r.raw.category || 'категория не указана')}</span>
                </>
              )}
            </div>
            {issueList(r)}
          </div>
        ),
      },
      { key: 'barcode', header: 'Штрихкод', render: (r) => cell(r, 'barcode', (x) => x.barcode ?? '') },
      { key: 'box', header: 'В коробке', align: 'right', sort: (r) => r.box, render: (r) => cell(r, 'box', (x) => (x.box !== null ? fmt.num(x.box) : '')) },
      { key: 'retail', header: 'Розница', align: 'right', sort: (r) => r.retail, render: (r) => cell(r, 'retail', (x) => fmt.price(x.retail)) },
      { key: 'wholesale', header: 'Опт', align: 'right', sort: (r) => r.wholesale, render: (r) => cell(r, 'wholesale', (x) => fmt.price(x.wholesale)) },
      { key: 'cost', header: 'Себестоимость', align: 'right', sort: (r) => r.cost, render: (r) => cell(r, 'cost', (x) => fmt.price(x.cost)) },
      { key: 'min', header: 'Минимум', align: 'right', sort: (r) => r.min, render: (r) => cell(r, 'min', (x) => (x.min !== null ? fmt.num(x.min) : '')) },
      {
        key: 'menu',
        header: '',
        width: 48,
        render: (r) => (
          <MoreMenu
            size="sm"
            label={`Строка ${r.line}`}
            items={[
              { label: 'Исправить', icon: <Pencil />, onClick: () => setFixing(r.gridIndex) },
              { label: 'Убрать из загрузки', icon: <Trash2 />, danger: true, onClick: () => removeRow(r.gridIndex) },
            ]}
          />
        ),
      },
    ];
  }, [grid]);

  const filters = useMemo<FilterDef<PreviewRow>[]>(
    () => [
      {
        key: 'status',
        label: 'Проверка',
        showCounts: true,
        options: [
          { value: 'all', label: 'Все' },
          { value: 'error', label: 'Ошибки', test: (r) => r.status === 'error' },
          { value: 'dup', label: 'Возможные дубли', test: (r) => r.status === 'dup' },
          { value: 'ok', label: 'Готовы', test: (r) => r.status === 'create' || r.status === 'price' || r.status === 'same' },
        ],
      },
    ],
    [],
  );

  const dataRows = hasHeader ? Math.max(0, grid.length - 1) : grid.length;
  const fixRow = fixing !== null ? rows.find((r) => r.gridIndex === fixing) : undefined;

  const setColumn = (i: number, f: FieldKey | null) => {
    const next = [...fullMapping];
    if (f) for (let k = 0; k < next.length; k++) if (next[k] === f) next[k] = null;
    next[i] = f;
    setManual({ sig: headerSig, mapping: next, hasHeader });
  };

  const foot =
    !result && dataRows > 0 ? (
      <div className="set-import-foot" style={{ width: '100%' }}>
        <span className="chips">
          <Chip>Строк: {fmt.num(rows.length)}</Chip>
          {counts.create ? <Chip tone="ok">Новых: {fmt.num(counts.create)}</Chip> : null}
          {counts.price ? <Chip tone="info">Обновить цену: {fmt.num(counts.price)}</Chip> : null}
          {counts.same ? <Chip>Без изменений: {fmt.num(counts.same)}</Chip> : null}
          {counts.dup ? <Chip tone="warn">Возможных дублей: {fmt.num(counts.dup)}</Chip> : null}
          {counts.error ? <Chip tone="bad">С ошибками: {fmt.num(counts.error)}</Chip> : null}
        </span>
        <span className="spacer" />
        {counts.error || preview.missing.length ? null : counts.dup ? (
          <Checkbox checked={ack} onChange={setAck}>
            Похожие названия проверил — это разные товары
          </Checkbox>
        ) : null}
        <Button variant="primary" icon={<FileUp />} disabled={!ready} onClick={runImport} style={{ marginLeft: 'auto' }} data-hint="settings.setup.load">
          {plan.length ? `Загрузить ${fmt.count(plan.length, 'строку', 'строки', 'строк')}` : 'Загрузить'}
        </Button>
      </div>
    ) : null;

  return (
    <Card
      hint="settings.setup.import"
      title="Загрузка товаров из таблицы"
      actions={
        <>
          <Button variant="ghost" icon={<Wand2 />} onClick={pasteSample} data-hint="settings.setup.sample">
            Вставить пример
          </Button>
          <Button icon={<Download />} onClick={downloadTemplate}>
            Скачать шаблон
          </Button>
          <Button icon={<FileUp />} onClick={() => fileRef.current?.click()}>
            Загрузить файл
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readFile(f);
              e.target.value = '';
            }}
          />
        </>
      }
      foot={foot}
    >
      <div className="col-4" style={{ gap: 18 }}>
        {result ? (
          <Notice
            tone={result.failed ? 'bad' : 'ok'}
            title={
              result.failed
                ? 'Загрузка остановилась'
                : `Загружено: ${[result.created.length ? fmt.count(result.created.length, 'новый товар', 'новых товара', 'новых товаров') : '', result.updated.length ? `обновлены цены у ${fmt.count(result.updated.length, 'товара', 'товаров', 'товаров')}` : ''].filter(Boolean).join(', ')}`
            }
            action={
              <div className="row">
                <Button size="sm" onClick={() => navigate('/products')}>
                  Открыть каталог
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
                  Загрузить ещё
                </Button>
              </div>
            }
          >
            {result.failed ? <div>{result.failed}</div> : null}
            {result.same ? <div>Без изменений: {fmt.count(result.same, 'строка', 'строки', 'строк')}</div> : null}
            <div className="set-result-list">
              {[...result.created, ...result.updated].map((id) => {
                const p = db.products.find((x) => x.id === id);
                return p ? (
                  <EntityLink key={id} type="product" id={id}>
                    {p.name}
                  </EntityLink>
                ) : null;
              })}
            </div>
          </Notice>
        ) : null}

        <div className="col">
          <Textarea
            className="set-paste"
            wrap="off"
            aria-label="Таблица товаров"
            rows={text ? 7 : 5}
            value={text}
            placeholder={'Скопируйте ячейки в Excel вместе со строкой заголовков и вставьте сюда.\nКолонки как в шаблоне: ' + TEMPLATE_HEADER.join(', ') + '.\nПодойдёт и файл CSV с разделителем «;».'}
            onChange={(e) => {
              setResult(null);
              setText(e.target.value);
            }}
          />
          {text ? (
            <div className="set-import-bar">
              <span className="t-13 muted">
                {fmt.count(dataRows, 'строка', 'строки', 'строк')} · {fmt.count(width, 'колонка', 'колонки', 'колонок')}
              </span>
              <Checkbox checked={hasHeader} onChange={setHasHeader}>
                Первая строка — заголовки
              </Checkbox>
              <span className="spacer" />
              <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => setText('')}>
                Очистить
              </Button>
            </div>
          ) : null}
        </div>

        {dataRows > 0 ? (
          <>
            <div className="col-3" data-hint="settings.setup.map">
              <div className="set-section-label">Колонки таблицы</div>
              <div className="set-map">
                {fullMapping.map((f, i) => (
                  <div key={i} className="set-map-item">
                    <span className="set-map-head">Колонка {i + 1}</span>
                    <span className="set-map-name ellipsis" title={grid[0]?.[i]}>
                      {hasHeader ? grid[0]?.[i] || 'без заголовка' : grid[0]?.[i] || '—'}
                    </span>
                    <Select
                      size="sm"
                      aria-label={`Колонка ${i + 1}`}
                      value={f ?? ''}
                      onChange={(e) => setColumn(i, (e.target.value || null) as FieldKey | null)}
                      placeholder="Не загружать"
                      options={FIELDS.map((x) => ({ value: x.key, label: x.label }))}
                    />
                  </div>
                ))}
              </div>
              {preview.missing.length ? (
                <Notice tone="bad" title="Не хватает колонок">
                  Укажите, где в таблице: {preview.missing.join(', ')}.
                </Notice>
              ) : null}
            </div>

            <div className="row-3" style={{ flexWrap: 'wrap' }} data-hint="settings.setup.mode">
              <span className="set-section-label">Режим</span>
              <Segmented
                ariaLabel="Режим загрузки"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'new', label: 'Добавить новые' },
                  { value: 'update', label: 'Добавить новые и обновить цены у найденных' },
                ]}
              />
            </div>

            {counts.error ? (
              <Notice tone="bad" title={`С ошибками: ${fmt.count(counts.error, 'строка', 'строки', 'строк')}`}>
                Загрузка идёт целиком: пока есть ошибка, не загрузится ни одна строка. Нажмите на строку, чтобы исправить, или уберите её через «⋯».
              </Notice>
            ) : null}
            <div className="set-preview" data-hint="settings.setup.preview">
              <DataTable
                card={false}
                rows={rows}
                columns={columns}
                rowKey={(r) => String(r.gridIndex)}
                search={{ placeholder: 'Найти строку', text: (r) => `${r.name} ${r.raw.brand ?? ''} ${r.raw.barcode ?? ''}` }}
                filters={filters}
                onRowClick={(r) => setFixing(r.gridIndex)}
                pageSize={100}
                totalLabel={(n) => fmt.count(n, 'строка', 'строки', 'строк')}
                dense
              />
            </div>
          </>
        ) : null}
      </div>

      {fixRow && fixing !== null ? (
        <FixRowModal
          row={fixRow}
          cells={grid[fixing] ?? []}
          mapping={fullMapping}
          catalog={catalog}
          onClose={() => setFixing(null)}
          onRemove={() => {
            removeRow(fixing);
            setFixing(null);
          }}
          onSave={(draft) => {
            const merged = [...(grid[fixing] ?? [])];
            draft.forEach((v, i) => {
              if (fullMapping[i]) merged[i] = v;
            });
            setCells(fixing, merged);
            setFixing(null);
          }}
        />
      ) : null}
    </Card>
  );
}
