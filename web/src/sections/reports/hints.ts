/* Подсказки режима обучения для раздела. Описание полей — web/src/shell/training/types.ts. */
import type { HintDef } from '../../shell/training/types';

const ALL = ['/reports', '/reports/clients', '/reports/staff', '/reports/promos', '/reports/delivery'];

export const hints: HintDef[] = [
  /* ---------- общее для всех вкладок отчётов ---------- */
  {
    id: 'reports.period',
    path: ALL,
    target: '[data-hint="period.nav"]',
    title: 'Период',
    text: 'Один на все вкладки отчётов и на обзор. Рядом выберите день, неделю, месяц или квартал, стрелками листайте назад.',
  },
  {
    id: 'reports.compare',
    path: ALL,
    target: '[data-hint="period.compare"]',
    title: 'С чем сравниваем',
    text: 'Проценты на плитках и в таблицах — к такому же отрезку прошлого периода: месяц к месяцу, день к тому же дню неделей раньше.',
  },
  {
    id: 'reports.export',
    path: ALL,
    device: 'desktop',
    order: 1005,
    target: '.rp-tight .table-toolbar-right > button[aria-label="Ещё действия"]',
    title: 'Выгрузка в Excel',
    text: 'Любую таблицу отчёта можно скачать — с текущими фильтрами и периодом в названии файла. Печать всей вкладки — в «⋯» вверху справа.',
  },
  {
    id: 'reports.how',
    path: ALL,
    order: 1006,
    target: '[data-hint="reports.how"]',
    title: 'Как считается',
    text: 'Раскройте, чтобы увидеть, что входит в каждую цифру: откуда выручка, как вычитаются возвраты, что значит «неполные данные».',
  },
  {
    id: 'reports.docs',
    path: ALL,
    target: '[data-hint="reports.docs"]',
    title: 'Из чего сложилась цифра',
    text: 'Документы за итогом: чеки, заказы, доставки или товары. Нажмите строку — откроется документ, итог — в последней строке.',
  },

  /* ---------- товары ---------- */
  {
    id: 'reports.products.profit',
    path: '/reports',
    target: '[data-hint="reports.products.profit"]',
    title: 'Прибыль после расходов',
    text: 'Валовая прибыль, ниже — расходы за период из журнала денег и что осталось после них. Так же считает обзор владельца.',
  },
  {
    id: 'reports.products.rank',
    path: '/reports',
    target: '[data-hint="reports.products.rank"]',
    title: 'Рейтинг товаров',
    text: 'Переключите: по выручке, количеству или прибыли — и отберите категорию. Нажмите товар — откроется его карточка.',
  },
  {
    id: 'reports.products.groups',
    path: '/reports',
    target: '[data-hint="reports.products.groups"]',
    title: 'Категории и бренды',
    text: 'Выручка, прибыль и маржа по группам. Нажмите строку — справа откроются товары группы с продажами.',
  },
  {
    id: 'reports.products.lists',
    path: '/reports',
    target: '[data-hint="reports.products.lists"]',
    title: 'Остатки и спрос',
    text: 'Готовые списки: оборачиваемость, без движения, низкая маржа, дефицит ходовых, ниже минимума, срок годности, не было в наличии.',
  },

  /* ---------- клиенты ---------- */
  {
    id: 'reports.clients.falling',
    path: '/reports/clients',
    target: '[data-hint="reports.clients.falling"]',
    title: 'Снизили активность',
    text: 'Клиенты, у которых за 30 дней покупок на 30 % меньше или нет совсем. В таблице ниже они — под фильтром «Снизили активность».',
  },
  {
    id: 'reports.clients.table',
    path: '/reports/clients',
    target: '[data-hint="reports.clients.table"]',
    title: 'Клиенты',
    text: 'Продажи, прибыль, частота покупок, долг и платит ли в срок. Нажмите клиента — откроется его карточка.',
  },
  {
    id: 'reports.clients.offer',
    path: '/reports/clients',
    target: '[data-hint="reports.clients.offer"]',
    title: 'Можно предложить',
    text: 'Категории, которые берут похожие клиенты, а этот у нас не берёт. Хороший повод для звонка менеджера или визита представителя.',
  },

  /* ---------- сотрудники ---------- */
  {
    id: 'reports.staff.plan',
    path: '/reports/staff',
    target: '[data-hint="reports.staff.plan"]',
    title: 'План магазина',
    text: 'Сколько процентов плана месяца уже продано. «По графику» — сколько должно быть к сегодняшнему дню.',
  },
  {
    id: 'reports.staff.table',
    path: '/reports/staff',
    target: '[data-hint="reports.staff.table"]',
    title: 'Сотрудники',
    text: 'Опт засчитывается ответственному за заказ, розница — продавцу. Полоса — план месяца, риска — где надо быть. Нажмите строку — подробности.',
  },
  {
    id: 'reports.staff.left',
    path: '/reports/staff',
    target: '[data-hint="reports.staff.left"]',
    title: 'Осталось',
    text: 'Сколько ещё продать до плана месяца. Зелёное «выполнен» — план закрыт.',
  },
  {
    id: 'reports.staff.visits',
    path: '/reports/staff',
    target: '[data-hint="reports.staff.visits"]',
    title: 'Визиты представителей',
    text: 'Назначено, сделано и пропущено, чем закончились визиты и частая причина отказа. Нажмите строку — все визиты представителя.',
  },
  {
    id: 'reports.staff.pick',
    path: '/reports/staff',
    target: '[data-hint="reports.staff.pick"]',
    title: 'Итоги сотрудника',
    text: 'Продажи, план и сколько осталось, скидки, долг его клиентов. Ниже — что продавал и все его чеки и заказы за период.',
  },

  /* ---------- акции ---------- */
  {
    id: 'reports.promos.discount',
    path: '/reports/promos',
    target: '[data-hint="reports.promos.discount"]',
    title: 'Скидка покупателям',
    text: 'Сколько покупатели сэкономили на акциях: обычная цена минус акционная. Ручные скидки продавцов сюда не входят.',
  },
  {
    id: 'reports.promos.table',
    path: '/reports/promos',
    target: '[data-hint="reports.promos.table"]',
    title: 'Акции',
    text: 'Выручка, скидка и прибыль по каждой акции. Нажмите строку — товары акции с продажами и остатком.',
  },
  {
    id: 'reports.promos.growth',
    path: '/reports/promos',
    target: '[data-hint="reports.promos.growth"]',
    title: 'Сработала ли акция',
    text: 'Выручка тех же товаров за дни акции против стольких же дней до неё. Пометка «заканчивался» — рост мог упереться в остаток, а не в акцию.',
  },

  /* ---------- доставка ---------- */
  {
    id: 'reports.delivery.ontime',
    path: '/reports/delivery',
    target: '[data-hint="reports.delivery.ontime"]',
    title: 'Вовремя',
    text: 'Доля доставок, врученных с первой попытки в свой интервал. Ниже — сколько опаздывают прямо сейчас.',
  },
  {
    id: 'reports.delivery.cash',
    path: '/reports/delivery',
    target: '[data-hint="reports.delivery.cash"]',
    title: 'Курьеры не сдали',
    text: 'Наличные, которые курьеры получили при вручении и ещё не сдали в кассу, — на сегодня, независимо от периода.',
  },
  {
    id: 'reports.delivery.outcomes',
    path: '/reports/delivery',
    target: '[data-hint="reports.delivery.outcomes"]',
    title: 'Чем закончились',
    text: 'Вовремя, с опозданием, не доставлены или ещё в работе. Ниже — отказы, «привезли не то» и недоплаты при вручении.',
  },
  {
    id: 'reports.delivery.reasons',
    path: '/reports/delivery',
    target: '[data-hint="reports.delivery.reasons"]',
    title: 'Почему не доставили',
    text: 'Причины, которые курьер указал при отметке «Не удалось». Частая причина — повод поменять интервалы или звонить заранее.',
  },
  {
    id: 'reports.delivery.couriers',
    path: '/reports/delivery',
    target: '[data-hint="reports.delivery.couriers"]',
    title: 'Курьеры',
    text: 'Доставки, опоздания и деньги по каждому курьеру. Нажмите строку — все его доставки за период.',
  },
  {
    id: 'reports.delivery.problems',
    path: '/reports/delivery',
    target: '[data-hint="reports.delivery.problems"]',
    title: 'Проблемные доставки',
    text: 'Опоздания, неудачи и повторные выезды с причиной. Нажмите строку — карточка доставки.',
  },
];
