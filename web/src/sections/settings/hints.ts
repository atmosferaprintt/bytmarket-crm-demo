/* Подсказки режима обучения для раздела. Описание полей — web/src/shell/training/types.ts. */
import type { HintDef } from '../../shell/training/types';

const TEAM = '/settings/team';
const SETUP = '/settings/setup';
const INT = '/settings/integrations';

export const hints: HintDef[] = [
  /* ---------- компания ---------- */
  {
    id: 'settings.requisites',
    path: '/settings',
    target: '[data-hint="settings.requisites"]',
    title: 'Реквизиты',
    text: 'Название, ИНН, адрес, банк и счёт магазина. Они попадают в счета, накладные и акты сверки.',
  },
  {
    id: 'settings.doc',
    path: '/settings',
    target: '[data-hint="settings.doc"]',
    title: 'Так видит клиент',
    text: 'Шапка счёта с вашими реквизитами — меняется, пока вы печатаете. Пустое поле помечено «не заполнено».',
  },
  {
    id: 'settings.limits',
    path: '/settings',
    target: '[data-hint="settings.limits"]',
    title: 'Лимиты скидок',
    text: 'Сколько процентов ручной скидки может дать каждый, кто продаёт. Больше лимита касса не пропустит — такую скидку даёт только владелец.',
  },
  {
    id: 'settings.margin',
    path: '/settings',
    target: '[data-hint="settings.margin"]',
    title: 'Наценка и отсрочка',
    text: 'Ниже минимальной наценки к себестоимости программа предупредит о цене; сразу видно, сколько оптовых цен уже ниже. Отсрочка подставится новым оптовым клиентам.',
  },
  {
    id: 'settings.delivery',
    path: '/settings',
    target: '[data-hint="settings.delivery"]',
    title: 'Доставка',
    text: 'Сколько стоит доставка для клиента и от какой суммы заказа она бесплатна.',
  },
  {
    id: 'settings.save',
    path: '/settings',
    order: 1005, // после полей: сначала что заполнить, потом сохранить
    target: '[data-hint="settings.save"]',
    title: 'Сохранить',
    text: 'Изменения действуют после сохранения и пишутся в журнал изменений. Передумали — «Отменить изменения» рядом.',
  },

  /* ---------- команда и права ---------- */
  {
    id: 'settings.team.view',
    path: TEAM,
    target: '[data-hint="settings.team.view"]',
    title: 'Три вида',
    text: 'Сотрудники, что может каждая роль и журнал изменений: кто, когда и что поменял в программе.',
  },
  {
    id: 'settings.team.add',
    path: TEAM,
    order: 1005,
    target: '[data-hint="settings.team.add"]',
    title: 'Добавить сотрудника',
    text: 'Имя, телефон, с какого дня работает и роли. Один человек может совмещать роли — например, продавец и склад.',
  },
  {
    id: 'settings.team.table',
    path: TEAM,
    target: '[data-hint="settings.team.table"]',
    title: 'Сотрудники',
    text: 'Роли, телефон и последнее изменение каждого. Нажмите строку — карточка: поменять роли, закрыть доступ, посмотреть программу его глазами.',
  },
  {
    id: 'settings.team.roles',
    path: TEAM,
    target: '[data-hint="settings.team.roles"]',
    title: 'Роли',
    text: 'Кто в какой роли и какой у роли лимит скидки. «Посмотреть глазами» откроет программу так, как её видит этот сотрудник.',
  },
  {
    id: 'settings.team.matrix',
    path: TEAM,
    target: '[data-hint="settings.team.matrix"]',
    title: 'Что может каждая роль',
    text: 'Галочка — роль это может. Замок — отдельные ограничения: закупочные цены, прибыль, чужие клиенты, скидки, списания, выгрузка.',
  },
  {
    id: 'settings.team.audit',
    path: TEAM,
    target: '[data-hint="settings.team.audit"]',
    title: 'Журнал изменений',
    text: 'Важные действия: цены, оплаты, остатки, роли, настройки. Отберите по разделу, сотруднику и периоду. Нажмите запись — откроется документ.',
  },
  {
    id: 'settings.emp.roles',
    path: TEAM,
    target: '[data-hint="settings.emp.roles"]',
    title: 'Роли сотрудника',
    text: 'Отметьте одну или несколько ролей, первая — основная. От ролей зависят экраны и права. Новые права действуют после «Сохранить».',
  },
  {
    id: 'settings.emp.access',
    path: TEAM,
    target: '[data-hint="settings.emp.access"]',
    title: 'Доступ к программе',
    text: 'Уволился или в отпуске — закройте доступ: войти и проводить операции он не сможет, а его история останется.',
  },
  {
    id: 'settings.emp.look',
    path: TEAM,
    target: '[data-hint="settings.emp.look"]',
    title: 'Посмотреть глазами',
    text: 'Откроет программу так, как её видит этот сотрудник. Вернуться — внизу меню, «Кто работает».',
  },
  {
    id: 'settings.add.roles',
    path: TEAM,
    target: '[data-hint="settings.add.roles"]',
    title: 'Роли',
    text: 'Можно отметить несколько — первая станет основной. Под названием роли — что она делает.',
  },

  /* ---------- подготовка к работе ---------- */
  {
    id: 'settings.setup.steps',
    path: SETUP,
    target: '[data-hint="settings.setup.steps"]',
    title: 'Шаги подготовки',
    text: 'Товары, остатки, деньги и проверка перед запуском. Под каждым шагом — сколько внесено и готов ли он.',
  },
  {
    id: 'settings.setup.import',
    path: SETUP,
    target: '[data-hint="settings.setup.import"]',
    title: 'Загрузка таблицей',
    text: 'Скопируйте ячейки из Excel вместе с заголовками и вставьте в поле ниже или загрузите файл CSV. Нужные колонки — в «Скачать шаблон».',
  },
  {
    id: 'settings.setup.sample',
    path: SETUP,
    target: '[data-hint="settings.setup.sample"]',
    title: 'Попробовать на примере',
    text: 'Вставит таблицу из 10 товаров: две строки с ошибками и одна похожая на товар из каталога. Посмотрите, как идёт проверка, до загрузки своих.',
  },
  {
    id: 'settings.setup.map',
    path: SETUP,
    target: '[data-hint="settings.setup.map"]',
    title: 'Колонки',
    text: 'Программа сама узнаёт колонки по заголовкам. Ошиблась — выберите, что лежит в колонке, или «Не загружать».',
  },
  {
    id: 'settings.setup.mode',
    path: SETUP,
    target: '[data-hint="settings.setup.mode"]',
    title: 'Режим загрузки',
    text: 'Только новые товары или ещё и новые цены у тех, что уже есть в каталоге: их программа находит по штрихкоду.',
  },
  {
    id: 'settings.setup.preview',
    path: SETUP,
    target: '[data-hint="settings.setup.preview"]',
    title: 'Проверка строк',
    text: 'Ошибки и возможные дубли видно до загрузки. Нажмите строку, чтобы исправить, или уберите её через «⋯».',
  },
  {
    id: 'settings.setup.load',
    path: SETUP,
    target: '[data-hint="settings.setup.load"]',
    title: 'Загрузить',
    text: 'Таблица загружается целиком: пока есть хоть одна ошибка, кнопка не нажмётся. Похожие названия подтвердите галочкой рядом.',
  },
  {
    id: 'settings.setup.fix',
    path: SETUP,
    target: '[data-hint="settings.setup.fix"]',
    title: 'Исправить строку',
    text: 'Красным — ячейки, которые не прошли проверку. Бренд и категорию можно выбрать из подсказок при вводе.',
  },
  {
    id: 'settings.setup.checks',
    path: SETUP,
    target: '[data-hint="settings.setup.checks"]',
    title: 'Сводка перед запуском',
    text: 'Что ещё не готово: реквизиты, товары без себестоимости, минус на остатке, неопознанные платежи, клиенты без ИНН. Стрелка справа откроет, где это исправить.',
  },

  /* ---------- подключения ---------- */
  {
    id: 'settings.wa.stats',
    path: INT,
    target: '[data-hint="settings.wa.stats"]',
    title: 'WhatsApp магазина',
    text: 'Номер, на который пишут клиенты, сколько диалогов, кто ждёт ответа и сколько заказов пришло из переписки. Сама переписка — в «Чатах».',
  },
  {
    id: 'settings.wa.auto',
    path: INT,
    target: '[data-hint="settings.wa.auto"]',
    title: 'Автосообщения',
    text: 'Уходят клиенту сами: заказ принят, собран, курьер выехал, доставлен, оплата получена. Переключатель включает и выключает, справа — сколько ушло за 7 дней.',
  },
  {
    id: 'settings.wa.preview',
    path: INT,
    target: '[data-hint="settings.wa.preview"]',
    title: 'Так видит клиент',
    text: 'Нажмите автосообщение слева — здесь появится последнее отправленное, как его видит клиент в WhatsApp.',
  },
  {
    id: 'settings.kkt',
    path: INT,
    target: '[data-hint="settings.kkt"]',
    title: 'Касса и ККТ',
    text: 'Сейчас чеки печатаются, но в налоговую не уходят. После подключения ККТ чек будет уходить через ОФД сразу при оплате.',
  },
  {
    id: 'settings.bank',
    path: INT,
    target: '[data-hint="settings.bank"]',
    title: 'Банк',
    text: 'Переводы бухгалтер подтверждает вручную по выписке. Здесь видно, сколько переводов ждут подтверждения и сколько денег не опознано.',
  },
  {
    id: 'settings.1c',
    path: INT,
    target: '[data-hint="settings.1c"]',
    title: '1С',
    text: 'Весь учёт ведётся здесь, 1С не нужна. Понадобится бухгалтерия в 1С — можно настроить выгрузку раз в день.',
  },
  {
    id: 'settings.backup',
    path: INT,
    target: '[data-hint="settings.backup"]',
    title: 'Резервная копия',
    text: 'Сейчас всё хранится в этом браузере. Для настоящей работы — копия раз в сутки на отдельный сервер и проверка восстановления раз в месяц.',
  },
  {
    id: 'settings.reset',
    path: INT,
    target: '[data-hint="settings.reset"]',
    title: 'Вернуть исходные данные',
    text: 'Сотрёт все изменения и вернёт данные на 5 ноября. Программа переспросит прямо в кнопке.',
  },
];
