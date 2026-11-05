/* Витрина деталей для проверки вида. Открывается по /kit.html, в меню не входит. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, Printer, Package, Truck, AlertTriangle } from 'lucide-react';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '../ui/tokens.css';
import '../ui/base.css';
import '../shell/shell.css';
import {
  Button, Card, Chip, DataTable, Drawer, Field, IconTile, Input, Kpi, Modal, MoneyInput, MoreMenu, Notice, ProgressBar, QtyInput,
  SearchInput, Segmented, Select, StatList, StatRow, StatusChip, Steps, Tabs, ToastStack, fmt, toast, ConfirmButton,
  ORDER_STATE, PAY_STATE, DELIVERY_STATE, overdueStatus,
} from '../ui';

interface Row { id: string; sku: string; name: string; brand: string; price: number; shop: number; wh: number; state: 'ok' | 'low' | 'out' }
const ROWS: Row[] = Array.from({ length: 140 }, (_, i) => ({
  id: String(i),
  sku: `БМ-${String(1000 + i).padStart(5, '0')}`,
  name: ['Fairy Лимон, средство для посуды, 450 мл', 'Persil Color, гель для стирки, 1,3 л', 'Domestos Свежесть, чистящий гель, 750 мл', 'Lenor Альпийские луга, кондиционер, 1 л', 'Санокс Ультра, чистящий гель, 750 мл'][i % 5],
  brand: ['Fairy', 'Persil', 'Domestos', 'Lenor', 'Санокс'][i % 5],
  price: [189, 599, 239, 329, 119][i % 5] + (i % 7) * 10,
  shop: (i * 7) % 23,
  wh: (i * 13) % 140,
  state: i % 11 === 0 ? 'out' : i % 6 === 0 ? 'low' : 'ok',
}));

function Kit() {
  const [tab, setTab] = useState('a');
  const [seg, setSeg] = useState('all');
  const [q, setQ] = useState('');
  const [qty, setQty] = useState(3);
  const [sum, setSum] = useState<number | ''>(12400);
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  return (
    <div className="content" style={{ maxWidth: 1360, margin: '0 auto', paddingTop: 24 }}>
      <div className="page-head">
        <h1 className="page-title">Витрина деталей</h1>
        <Tabs items={[{ key: 'a', label: 'Заказы', count: 12 }, { key: 'b', label: 'Возвраты' }, { key: 'c', label: 'Чаты', count: 3 }]} value={tab} onChange={setTab} />
        <div className="page-actions">
          <Button icon={<Printer />}>Печать</Button>
          <MoreMenu items={[{ label: 'Скачать для Excel', icon: <Package /> }, { label: 'sep', separator: true }, { label: 'Отменить заказ', danger: true }]} />
          <Button variant="primary" icon={<Plus />} onClick={() => toast('Заказ создан')}>Новый заказ</Button>
        </div>
      </div>
      <div className="grid-4">
        <Kpi label="Продажи за октябрь" value={fmt.money(4218400)} delta={{ text: fmt.delta(12.4), dir: 'up' }} extra={<ProgressBar value={4218} max={4500} />} />
        <Kpi label="Валовая прибыль" value={fmt.money(1102300)} delta={{ text: fmt.delta(-3.1), dir: 'down' }} />
        <Kpi label="Долги покупателей" value={fmt.money(684200)} delta={{ text: fmt.delta(8), dir: 'up' }} deltaGood="down" />
        <Kpi label="Стоимость остатков" value={fmt.moneyShort(6840000)} />
      </div>
      <div className="grid-3">
        <Card title="Кнопки" sub="Одна главная на экране">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Button variant="primary">Главная</Button>
            <Button>Второстепенная</Button>
            <Button variant="ghost">Тихая</Button>
            <Button variant="danger">Отменить</Button>
            <Button variant="dark">Тёмная</Button>
            <Button size="sm">Маленькая</Button>
            <ConfirmButton size="sm" onConfirm={() => toast('Отменено')}>С подтверждением</ConfirmButton>
          </div>
        </Card>
        <Card title="Чипы статусов">
          <div className="chips">
            <StatusChip s={ORDER_STATE.request} />
            <StatusChip s={ORDER_STATE.confirmed} />
            <StatusChip s={PAY_STATE.partial} />
            <StatusChip s={PAY_STATE.paid} />
            <StatusChip s={overdueStatus(6)} />
            <StatusChip s={DELIVERY_STATE.on_way} />
            <StatusChip s={DELIVERY_STATE.waiting} />
            <Chip tone="green">Акция −15 %</Chip>
            <Chip tone="outline">Отменён</Chip>
          </div>
          <div style={{ marginTop: 16 }}>
            <Steps items={[{ label: 'Заказ', state: 'done' }, { label: 'Сборка', state: 'done' }, { label: 'Отгрузка', state: 'current' }, { label: 'Оплата', state: 'todo' }]} />
          </div>
        </Card>
        <Card title="Поля">
          <div className="col-3">
            <SearchInput value={q} onChange={setQ} placeholder="Найти товар" />
            <div className="grid-2">
              <Field label="Клиент"><Select options={[{ value: '1', label: 'ИП Гамзатова · «Чистый дом»' }]} /></Field>
              <Field label="Сумма"><MoneyInput value={sum} onChange={setSum} /></Field>
            </div>
            <div className="row"><QtyInput value={qty} onChange={setQty} /><span className="muted">= {fmt.qty(qty * 12)}</span></div>
            <Field label="Комментарий" error="Нужно указать причину"><Input placeholder="Например: протечка" /></Field>
          </div>
        </Card>
      </div>
      <div className="grid-2">
        <Card title="Строки «подпись — значение»">
          <StatList>
            <StatRow label="Сумма заказа" value={fmt.money(48300)} />
            <StatRow label="Оплачено" value={fmt.money(35900)} />
            <StatRow label="Осталось оплатить" value={fmt.money(12400)} total />
          </StatList>
        </Card>
        <Card title="Сигналы" flush>
          <div className="list">
            {[1, 2, 3].map((i) => (
              <div key={i} className="list-row">
                <IconTile tone={i === 1 ? 'bad' : 'warn'}>{i === 1 ? <AlertTriangle /> : <Truck />}</IconTile>
                <div className="grow"><div className="w-600">Заканчивается Fairy 450 мл</div><div className="t-12 muted">Осталось на 2 дня · продаётся 18 шт в день</div></div>
                <Button size="sm">Заказать</Button>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Notice tone="warn" title="Клиент просрочил оплату">Долг 12 400 ₽, просрочка 6 дней. Подтвердить заказ может только владелец.</Notice>
      <div className="row">
        <Segmented value={seg} onChange={setSeg} options={[{ value: 'all', label: 'Все', count: 140 }, { value: 'low', label: 'Ниже минимума', count: 23 }]} />
        <Button onClick={() => setModal(true)}>Окно</Button>
        <Button onClick={() => setDrawer(true)}>Боковая панель</Button>
      </div>
      <DataTable
        id="kit-products"
        rows={ROWS}
        rowKey={(r) => r.id}
        exportName="Товары"
        search={{ placeholder: 'Название, артикул, штрихкод', text: (r) => `${r.name} ${r.sku}` }}
        filters={[{ key: 'st', showCounts: true, options: [{ value: 'all', label: 'Все' }, { value: 'low', label: 'Ниже минимума', test: (r) => r.state === 'low' }, { value: 'out', label: 'Нет в наличии', test: (r) => r.state === 'out' }] }]}
        defaultSort={{ key: 'name', dir: 'asc' }}
        onRowClick={() => setDrawer(true)}
        columns={[
          { key: 'sku', header: 'Артикул', render: (r) => <span className="muted">{r.sku}</span>, sort: (r) => r.sku, width: 110 },
          { key: 'name', header: 'Товар', render: (r) => <div><div className="cell-title">{r.name}</div><div className="cell-sub">{r.brand}</div></div>, sort: (r) => r.name },
          { key: 'price', header: 'Цена', align: 'right', render: (r) => fmt.price(r.price), sort: (r) => r.price },
          { key: 'shop', header: 'Магазин', align: 'right', render: (r) => fmt.num(r.shop), sort: (r) => r.shop, total: (rows) => fmt.num(rows.reduce((s, r) => s + r.shop, 0)) },
          { key: 'wh', header: 'Склад', align: 'right', render: (r) => fmt.num(r.wh), sort: (r) => r.wh, total: (rows) => fmt.num(rows.reduce((s, r) => s + r.wh, 0)) },
          { key: 'state', header: 'Статус', render: (r) => <Chip tone={r.state === 'out' ? 'bad' : r.state === 'low' ? 'warn' : 'ok'}>{r.state === 'out' ? 'Нет в наличии' : r.state === 'low' ? 'Ниже минимума' : 'В наличии'}</Chip> },
        ]}
      />
      {modal ? (
        <Modal title="Принять оплату" sub="ИП Гамзатова · «Чистый дом»" onClose={() => setModal(false)} footer={<><Button variant="ghost" onClick={() => setModal(false)}>Отмена</Button><Button variant="primary">Принять 12 400 ₽</Button></>}>
          <Field label="Сумма"><MoneyInput value={sum} onChange={setSum} size="lg" /></Field>
          <Segmented value="cash" onChange={() => undefined} options={[{ value: 'cash', label: 'Наличные' }, { value: 'card', label: 'Карта' }, { value: 'transfer', label: 'Перевод' }]} />
        </Modal>
      ) : null}
      {drawer ? (
        <Drawer title="Заказ № 1284" sub="ИП Гамзатова · «Чистый дом»" head={<div className="chips"><StatusChip s={ORDER_STATE.confirmed} /><StatusChip s={PAY_STATE.partial} /></div>} onClose={() => setDrawer(false)} footer={<><Button>Печать</Button><span className="spacer" /><Button variant="primary">Отгрузить</Button></>}>
          <StatList><StatRow label="Сумма" value={fmt.money(48300)} /><StatRow label="Осталось" value={fmt.money(12400)} total /></StatList>
        </Drawer>
      ) : null}
      <ToastStack />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Kit />);
