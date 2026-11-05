/* БытМаркет — модель данных демо. Договор между генератором, операциями и разделами.
   Суммы — целые рубли (number). Количество — в штуках (базовая единица), если не сказано иное.
   Даты: ISODate = 'YYYY-MM-DD', ISODateTime = 'YYYY-MM-DDTHH:mm'. «Сегодня» демо — DB.meta.today. */

export type ID = string;
export type ISODate = string;
export type ISODateTime = string;

/* ---------- люди и роли ---------- */
export type RoleKey =
  | 'owner'
  | 'seller'
  | 'manager'
  | 'rep'
  | 'accountant'
  | 'warehouse'
  | 'dispatcher'
  | 'courier';

export interface Employee {
  id: ID;
  name: string; // «Патимат Алиева»
  short: string; // «Патимат А.»
  roles: RoleKey[]; // первая — основная; совмещение ролей допустимо
  phone: string;
  active: boolean;
  hiredAt: ISODate;
}

/* ---------- каталог ---------- */
export type LocationKey = 'shop' | 'warehouse';
export const LOCATION_NAMES: Record<LocationKey, string> = { shop: 'Магазин', warehouse: 'Склад' };

export interface Category {
  id: ID;
  name: string; // «Стирка»
  parentId: ID | null; // подкатегории: «Стирка» → «Гели для стирки»
}

export interface Brand {
  id: ID;
  name: string;
}

export type PackKey = 'pcs' | 'pack' | 'box';
export interface Pack {
  key: PackKey;
  name: string; // «шт», «упак. 6 шт», «коробка 24 шт»
  qty: number; // штук в единице: 1, 6, 24
  barcode: string; // EAN-13
}

export interface ProductGroup {
  id: ID;
  name: string; // «Fairy, средство для посуды»
  brandId: ID;
  categoryId: ID;
}

export interface Product {
  id: ID;
  sku: string; // «БМ-01234»
  name: string; // полное имя: «Fairy Лимон, средство для посуды, 450 мл»
  groupId: ID | null; // варианты объёма и аромата — отдельные SKU в одной группе
  variant: string | null; // «450 мл · Лимон»
  brandId: ID;
  categoryId: ID;
  volume: string | null; // «450 мл», «3 кг», «20 шт»
  weightG: number | null;
  scent: string | null;
  packs: Pack[]; // packs[0] — всегда штука; дальше упаковка и/или коробка
  retailPrice: number; // за штуку
  wholesalePrice: number; // за штуку, ниже розницы
  cost: number | null; // последняя известная себестоимость; null — неизвестна
  minStock: number; // минимальный остаток по магазину и складу вместе
  active: boolean;
  supplierIds: ID[];
  expiryTracked: boolean; // учитывать партии и сроки годности
  marking: boolean; // подлежит маркировке
  createdAt: ISODate;
}

/* ---------- остатки ---------- */
export interface StockRow {
  productId: ID;
  location: LocationKey;
  onHand: number; // фактически лежит (без карантина)
  reserved: number; // зарезервировано под подтверждённые заказы; доступно = onHand − reserved
}

export interface Batch {
  id: ID;
  productId: ID;
  location: LocationKey;
  qty: number;
  expiry: ISODate;
  receivedAt: ISODate;
}

export type QuarantineState = 'check' | 'released' | 'written_off';
export interface QuarantineItem {
  id: ID;
  productId: ID;
  location: LocationKey;
  qty: number;
  source: 'return' | 'delivery_failed' | 'purchase_defect';
  sourceId: ID;
  state: QuarantineState;
  reason: string;
  createdAt: ISODateTime;
  decidedAt: ISODateTime | null;
  decidedBy: ID | null;
}

export type MovementKind =
  | 'initial' // начальный остаток
  | 'income' // приход от поставщика
  | 'sale' // продажа на кассе
  | 'ship' // отгрузка оптового заказа
  | 'transfer_out'
  | 'transfer_in'
  | 'writeoff'
  | 'count' // разница пересчёта
  | 'return_in' // возврат в продажу после проверки
  | 'reserve'
  | 'unreserve';

export interface Movement {
  id: ID;
  at: ISODateTime;
  productId: ID;
  location: LocationKey;
  dOnHand: number;
  dReserved: number;
  kind: MovementKind;
  docType: 'stockdoc' | 'purchase' | 'receipt' | 'order' | 'return' | 'delivery';
  docId: ID;
  authorId: ID;
}

export type StockDocKind = 'initial' | 'income' | 'transfer' | 'writeoff' | 'count';
export type WriteoffReason = 'leak' | 'damage' | 'expired' | 'shortage' | 'supplier_return' | 'other';
export const WRITEOFF_REASONS: Record<WriteoffReason, string> = {
  leak: 'Протечка',
  damage: 'Повреждение',
  expired: 'Просрочка',
  shortage: 'Недостача',
  supplier_return: 'Возврат поставщику',
  other: 'Другое',
};

export interface StockDocLine {
  productId: ID;
  qty: number; // для count — фактическое количество
  expected?: number; // для count — сколько было по учёту
  reason?: WriteoffReason;
}

export interface StockDoc {
  id: ID;
  number: number;
  kind: StockDocKind;
  at: ISODateTime;
  authorId: ID;
  from: LocationKey | null;
  to: LocationKey | null;
  lines: StockDocLine[];
  comment: string;
  purchaseId: ID | null;
}

/* ---------- клиенты ---------- */
export type ClientKind = 'person' | 'ip' | 'ooo';
export const CLIENT_KIND_NAMES: Record<ClientKind, string> = { person: 'Физлицо', ip: 'ИП', ooo: 'Организация' };
export type ClientSegment = 'retail' | 'shop' | 'horeca' | 'cleaning' | 'market';
export const CLIENT_SEGMENT_NAMES: Record<ClientSegment, string> = {
  retail: 'Розничный покупатель',
  shop: 'Магазин',
  horeca: 'Кафе и гостиницы',
  cleaning: 'Клининг',
  market: 'Рынок',
};
export type PriceType = 'retail' | 'wholesale';

export interface ClientPoint {
  id: ID;
  name: string; // «Магазин на Боевой»
  address: string; // «ул. Боевая, 61»
  district: string; // «Кировский район»
  lat: number;
  lng: number;
}

export interface ClientContact {
  id: ID;
  name: string;
  role: string; // «Владелец», «Закупщик», «Бухгалтер»
  phone: string;
}

export interface Client {
  id: ID;
  name: string; // «ИП Гамзатова · «Чистый дом»»
  kind: ClientKind;
  segment: ClientSegment;
  priceType: PriceType;
  inn: string | null;
  phone: string;
  points: ClientPoint[];
  contacts: ClientContact[];
  deferDays: number; // отсрочка оплаты, 0 — оплата сразу
  creditLimit: number; // 0 — без кредита
  ownerId: ID | null; // ответственный: менеджер или представитель. Единственный источник «чей клиент».
  orderEveryDays: number | null; // привычная частота заказа
  minOrder: number; // минимальная сумма заказа, 0 — нет
  note: string;
  createdAt: ISODate;
  active: boolean;
}

/* ---------- цены и акции ---------- */
export interface Promo {
  id: ID;
  name: string; // «Осенняя стирка»
  target: { type: 'products'; ids: ID[] } | { type: 'category'; id: ID } | { type: 'brand'; id: ID };
  kind: 'percent' | 'price';
  value: number; // процент или цена за штуку
  start: ISODate;
  end: ISODate;
  audience: 'all' | 'retail' | 'wholesale';
  active: boolean;
  createdBy: ID;
}

export interface PriceChange {
  id: ID;
  at: ISODateTime;
  productId: ID;
  retailFrom: number;
  retailTo: number;
  wholesaleFrom: number;
  wholesaleTo: number;
  authorId: ID;
}

/* ---------- оптовые заказы ---------- */
export interface OrderLine {
  productId: ID;
  pack: PackKey;
  packSize: number; // штук в выбранной упаковке на момент заказа (история не меняется)
  packQty: number; // сколько упаковок
  qty: number; // штук = packQty × packSize
  basePrice: number; // цена за штуку по типу цены клиента на момент заказа
  price: number; // итоговая цена за штуку после акции и ручной скидки
  promoId: ID | null;
  discountPct: number; // ручная скидка, %
  discountReason: string | null;
  cost: number | null; // себестоимость за штуку на момент заказа
  shipped: number; // отгружено штук
}

export type OrderState = 'draft' | 'request' | 'confirmed' | 'cancelled' | 'closed';
// draft — черновик; request — заявка представителя без резерва, ждёт подтверждения;
// confirmed — подтверждён, товар зарезервирован; closed — отгружен/доставлен полностью; cancelled — отменён.
export type PickState = 'none' | 'picking' | 'picked';
export type ShipState = 'none' | 'partial' | 'shipped' | 'delivered';
export type OrderSource = 'manager' | 'rep' | 'phone' | 'chat' | 'repeat';

export interface OrderEvent {
  at: ISODateTime;
  actorId: ID;
  text: string; // «Подтверждён, товар зарезервирован»
}

export interface Order {
  id: ID;
  number: number; // растёт по дате создания
  createdAt: ISODateTime;
  clientId: ID;
  pointId: ID | null;
  authorId: ID;
  ownerId: ID | null; // ответственный по заказу (обычно ответственный клиента)
  source: OrderSource;
  location: LocationKey; // откуда резерв и отгрузка (обычно склад)
  priceType: PriceType;
  lines: OrderLine[];
  state: OrderState;
  pick: PickState;
  ship: ShipState;
  fulfillment: 'delivery' | 'pickup';
  deliveryId: ID | null;
  dueDate: ISODate | null; // срок оплаты = дата отгрузки + отсрочка клиента
  comment: string;
  total: number; // сумма строк, целые рубли
  idempotencyKey: string | null;
  history: OrderEvent[];
  /** отмеченные при сборке товары — прогресс не теряется, если сборщик отвлёкся */
  pickChecked?: ID[];
}
// Оплата заказа не хранится в заказе: считается из Payment.allocations (selectors.orderPayment).

/* ---------- касса ---------- */
export interface Shift {
  id: ID;
  number: number;
  sellerId: ID;
  openedAt: ISODateTime;
  closedAt: ISODateTime | null;
  openingCash: number; // размен на начало
  countedCash: number | null; // пересчитано при закрытии
}

export interface ReceiptLine {
  productId: ID;
  pack: PackKey;
  packSize: number;
  packQty: number;
  qty: number;
  basePrice: number;
  price: number;
  promoId: ID | null;
  discountPct: number;
  discountReason: string | null;
  cost: number | null;
}

export interface Receipt {
  id: ID;
  number: number;
  shiftId: ID;
  at: ISODateTime;
  sellerId: ID;
  clientId: ID | null; // розничная продажа без карточки — null
  lines: ReceiptLine[];
  total: number;
  cash: number; // принято наличными (до сдачи)
  card: number;
  change: number;
  kind: 'sale' | 'refund';
  refundOf: ID | null;
  fiscal: 'not_connected'; // ККТ в демо не подключена: чек не фискальный
  idempotencyKey: string | null;
}

/* ---------- деньги ---------- */
export type AccountKey = 'shop_cash' | 'courier_cash' | 'bank';
export const ACCOUNT_NAMES: Record<AccountKey, string> = {
  shop_cash: 'Касса магазина',
  courier_cash: 'Деньги у курьеров',
  bank: 'Расчётный счёт',
};
export type PayMethod = 'cash' | 'card' | 'transfer';
export const PAY_METHOD_NAMES: Record<PayMethod, string> = { cash: 'Наличные', card: 'Карта', transfer: 'Перевод' };

export type PaymentKind =
  | 'client' // поступление от покупателя по заказам
  | 'shift' // выручка кассовой смены (одна запись на смену и способ)
  | 'supplier' // выплата поставщику
  | 'refund' // возврат денег покупателю
  | 'expense' // расход
  | 'transfer'; // перемещение между кассами и счётом (инкассация, сдача денег курьером)

export interface Allocation {
  orderId?: ID;
  purchaseId?: ID;
  amount: number;
}

export interface Payment {
  id: ID;
  number: number;
  at: ISODateTime;
  direction: 'in' | 'out';
  kind: PaymentKind;
  clientId: ID | null;
  supplierId: ID | null;
  amount: number; // всегда положительное
  method: PayMethod;
  account: AccountKey; // куда пришло / откуда ушло
  toAccount: AccountKey | null; // для transfer
  allocations: Allocation[]; // распределение по заказам или закупкам; сумма ≤ amount, остаток — аванс/переплата
  status: 'posted' | 'pending' | 'unidentified';
  // pending — клиент прислал скриншот перевода, ждём подтверждения банка; unidentified — пришло на счёт, плательщик не ясен
  shiftId: ID | null;
  deliveryId: ID | null;
  returnId: ID | null;
  expenseCategory: string | null;
  authorId: ID;
  comment: string;
  idempotencyKey: string | null;
  /** плательщик из банковской выписки — для неопознанных поступлений */
  payer?: { name: string; inn: string } | null;
}

export const EXPENSE_CATEGORIES = [
  'Аренда',
  'Зарплата',
  'Топливо и доставка',
  'Коммунальные услуги',
  'Связь и интернет',
  'Упаковка и расходники',
  'Реклама',
  'Ремонт и обслуживание',
  'Недостача',
] as const;

/* ---------- закупки ---------- */
export interface Supplier {
  id: ID;
  name: string; // «ООО «ЮгХимОпт»»
  inn: string;
  phone: string;
  contact: string;
  leadDays: number; // срок поставки
  deferDays: number; // отсрочка нам
  minOrder: number;
}

export interface PurchaseLine {
  productId: ID;
  boxSize: number; // кратность поставщика, штук в коробке
  boxes: number;
  qty: number; // заказано штук
  received: number | null; // принято фактически, штук
  defect: number; // из принятого — брак (в карантин)
  price: number; // закупочная цена за штуку
  diffReason: string | null;
}

export type PurchaseState = 'draft' | 'ordered' | 'partial' | 'received' | 'cancelled';
export interface Purchase {
  id: ID;
  number: number;
  supplierId: ID;
  createdAt: ISODateTime;
  expectedAt: ISODate;
  receivedAt: ISODateTime | null;
  state: PurchaseState;
  location: LocationKey; // обычно склад
  lines: PurchaseLine[];
  total: number; // по принятому (или заказанному, если не принято)
  dueDate: ISODate | null; // срок оплаты поставщику
  authorId: ID;
  approvedBy: ID | null;
  comment: string;
}

/* ---------- возвраты ---------- */
export type ReturnReason = 'defect' | 'not_fit' | 'wrong_item' | 'expired' | 'delivery_failed' | 'not_taken' | 'other';
export const RETURN_REASONS: Record<ReturnReason, string> = {
  defect: 'Брак',
  not_fit: 'Не подошёл',
  wrong_item: 'Привезли не то',
  expired: 'Истёк срок',
  delivery_failed: 'Не доставлен',
  not_taken: 'Клиент не взял при доставке',
  other: 'Другое',
};

export interface ReturnLine {
  productId: ID;
  qty: number;
  price: number; // по исходному документу
  reason: ReturnReason;
}

export interface Return {
  id: ID;
  number: number;
  at: ISODateTime;
  source: 'receipt' | 'order';
  receiptId: ID | null;
  orderId: ID | null;
  clientId: ID | null;
  location: LocationKey;
  lines: ReturnLine[];
  amount: number; // сумма возврата по строкам
  refundPaymentId: ID | null; // если деньги вернули
  authorId: ID;
  comment: string;
}

/* ---------- доставка ---------- */
export type DeliveryState = 'waiting' | 'assigned' | 'on_way' | 'delivered' | 'failed' | 'returned';
// waiting — ожидает назначения; failed — неудачная попытка (ждёт решения: повтор или возврат на склад)
export const DELIVERY_FAIL_REASONS = [
  'Клиента нет на месте',
  'Не дозвонились',
  'Отказ от товара',
  'Нет денег у клиента',
  'Перенос по просьбе клиента',
  'Не успели в интервал',
] as const;

export interface DeliveryAttempt {
  at: ISODateTime;
  courierId: ID;
  result: 'delivered' | 'failed';
  reason: string | null;
}

export interface Delivery {
  id: ID;
  number: number;
  orderId: ID;
  clientId: ID;
  pointId: ID | null;
  address: string;
  district: string;
  lat: number;
  lng: number;
  contactName: string;
  contactPhone: string;
  date: ISODate;
  interval: string; // «10:00–13:00»
  courierId: ID | null;
  state: DeliveryState;
  routeOrder: number; // порядок в маршруте курьера на день
  places: number; // количество мест
  weightKg: number;
  cost: number; // стоимость доставки для магазина (расход)
  fee: number; // сколько платит клиент за доставку, 0 — бесплатно
  collect: number; // сумма к получению при вручении (0 — оплачено заранее или по отсрочке)
  collected: number; // фактически получено курьером
  collectedMethod: PayMethod | null;
  handedIn: boolean; // курьер сдал деньги в кассу
  comment: string;
  attempts: DeliveryAttempt[];
  /** заметки по доставке: перенос с причиной, задержка курьера, пожелание клиента */
  notes?: DeliveryNote[];
  /** курьер задерживается: ожидаемое время приезда «15:30» */
  delayUntil?: string | null;
}
export interface DeliveryNote {
  at: ISODateTime;
  actorId: ID;
  text: string;
}

/* ---------- торговые представители ---------- */
export type VisitResult = 'order' | 'callback' | 'refusal';
export const REFUSAL_REASONS = [
  'Есть запас',
  'Дорого',
  'Нет денег',
  'Взяли у конкурента',
  'Нет места на полке',
  'Не берут у них',
] as const;

export interface Visit {
  id: ID;
  repId: ID;
  clientId: ID;
  pointId: ID | null;
  date: ISODate;
  time: string; // «10:30»
  routeOrder: number;
  state: 'planned' | 'done' | 'missed';
  result: VisitResult | null;
  refusalReason: string | null;
  comment: string;
  orderId: ID | null;
  doneAt: ISODateTime | null;
}

/* ---------- задачи ---------- */
export interface TaskLink {
  type: 'client' | 'order' | 'delivery' | 'product' | 'purchase' | 'payment' | 'supplier';
  id: ID;
}
/** Вид задачи: такие задачи закрываются сами, когда сделано то, о чём они (см. tasksAfterOp в ops.ts). */
export type TaskKind =
  | 'approve_order' // владельцу: согласовать заказ сверх условий — закрывается подтверждением или отменой заказа
  | 'confirm_requests' // менеджеру: подтвердить заявки — закрывается, когда заявок не осталось
  | 'send_invoice' // отправить счёт по заказу
  | 'remind_debt' // напомнить клиенту об оплате — закрывается напоминанием в WhatsApp или оплатой
  | 'call_debt' // позвонить по долгу — закрывается, когда просрочки нет
  | 'identify_payment' // разнести неопознанный платёж
  | 'check_transfer' // проверить перевод по выписке
  | 'pay_supplier' // оплатить поставщику
  | 'move_to_shop' // перенести товар со склада в магазин
  | 'pick_order' // собрать заказ
  | 'assign_couriers' // назначить курьеров — когда ожидающих не осталось
  | 'failed_delivery' // решить по неудачной доставке
  | 'courier_cash'; // принять деньги у курьера
export const TASK_KINDS: TaskKind[] = ['approve_order', 'confirm_requests', 'send_invoice', 'remind_debt', 'call_debt', 'identify_payment', 'check_transfer', 'pay_supplier', 'move_to_shop', 'pick_order', 'assign_couriers', 'failed_delivery', 'courier_cash'];
export interface Task {
  id: ID;
  title: string;
  assigneeId: ID;
  authorId: ID;
  due: ISODate;
  dueTime: string | null;
  priority: 'normal' | 'high';
  state: 'open' | 'done';
  link: TaskLink | null;
  createdAt: ISODateTime;
  doneAt: ISODateTime | null;
  /** вид задачи — такие закрываются сами, когда дело сделано */
  kind?: TaskKind;
}

/* ---------- чаты WhatsApp (пример подключения: сообщения хранятся в программе, наружу не уходят) ---------- */
/** Автосообщения по событиям: заказ принят, собран к самовывозу, курьер выехал, доставлен, оплата получена, ответ вне рабочего времени. */
export type WaAutoKey = 'confirmed' | 'pickup_ready' | 'on_way' | 'delivered' | 'payment' | 'away';
export const WA_AUTO_KEYS: WaAutoKey[] = ['confirmed', 'pickup_ready', 'on_way', 'delivered', 'payment', 'away'];
export interface ChatFile {
  name: string; // «Счёт № 3600.pdf»
  size: string; // «84 КБ»
  kind: 'pdf' | 'xlsx';
}
export interface ChatMessage {
  at: ISODateTime;
  from: 'client' | 'staff';
  authorId: ID | null; // у автосообщений — null
  text: string;
  orderId: ID | null;
  /** автосообщение по событию */
  auto?: WaAutoKey;
  /** вложение: счёт, акт сверки, прайс */
  file?: ChatFile;
  /** ключ события, чтобы одно событие не отправлялось дважды: «delivered:dl-12» */
  ref?: string;
  /** что отправили: счёт, напоминание об оплате, акт сверки, прайс */
  purpose?: ChatPurpose;
}
export type ChatPurpose = 'invoice' | 'reminder' | 'act' | 'price';
export interface Chat {
  id: ID;
  clientId: ID;
  channel: 'whatsapp';
  messages: ChatMessage[];
  unread: number;
  ownerId: ID | null;
}

/* ---------- план и журнал ---------- */
export interface SalesPlan {
  month: string; // 'YYYY-MM'
  employeeId: ID | null; // null — план магазина целиком
  amount: number; // выручка, ₽
  visits: number | null; // для представителей
}

export interface AuditEntry {
  id: ID;
  at: ISODateTime;
  actorId: ID;
  entity: 'product' | 'client' | 'order' | 'price' | 'promo' | 'payment' | 'stock' | 'settings' | 'employee' | 'delivery' | 'purchase';
  entityId: ID;
  text: string; // «Цена Fairy 450 мл: 189 → 199 ₽»
}

/* ---------- настройки ---------- */
export interface Settings {
  company: { name: string; legalName: string; inn: string; address: string; phone: string; bank: string; account: string };
  discountLimits: Record<RoleKey, number>; // максимальная ручная скидка, %
  minMarginPct: number; // минимальная допустимая наценка над себестоимостью, %
  defaultDeferDays: number;
  deliveryFee: number; // стоимость доставки для клиента по умолчанию
  freeDeliveryFrom: number; // бесплатная доставка от суммы
  whatsapp: WhatsAppSettings;
}

export interface WhatsAppSettings {
  connected: boolean;
  phone: string; // номер WhatsApp магазина
  since: ISODate | null; // подключён с
  auto: Record<WaAutoKey, boolean>;
  hours: { from: string; to: string }; // рабочее время для ответа вне часов
}

/* ---------- вся база демо ---------- */
export interface DB {
  meta: { seed: number; today: ISODate; startDate: ISODate; version: number };
  employees: Employee[];
  categories: Category[];
  brands: Brand[];
  groups: ProductGroup[];
  products: Product[];
  stock: StockRow[];
  batches: Batch[];
  quarantine: QuarantineItem[];
  movements: Movement[];
  stockDocs: StockDoc[];
  clients: Client[];
  promos: Promo[];
  priceChanges: PriceChange[];
  orders: Order[];
  shifts: Shift[];
  receipts: Receipt[];
  payments: Payment[];
  suppliers: Supplier[];
  purchases: Purchase[];
  returns: Return[];
  deliveries: Delivery[];
  visits: Visit[];
  tasks: Task[];
  chats: Chat[];
  plans: SalesPlan[];
  audit: AuditEntry[];
  settings: Settings;
  counters: Record<string, number>; // последние номера документов
}
