// Итоговые снимки главных экранов в output/demo-v2/. Каждый снимок — в чистом браузере с исходными данными.
// Запуск через mcp__playwright__browser_run_code_unsafe (filename: web/scripts/demo-shots.js).
async (page) => {
  const ROOT = '/Users/rabiatsahrudinova/Documents/ChatGPT/срм быт дом/output/demo-v2';
  const URL = 'http://127.0.0.1:5173/';
  const browser = page.context().browser();
  const S = {
    owner: { employeeId: 'e-gadzhiev', role: 'owner' },
    seller: { employeeId: 'e-alieva', role: 'seller' },
    manager: { employeeId: 'e-omarov', role: 'manager' },
    rep: { employeeId: 'e-rasulova', role: 'rep' },
    accountant: { employeeId: 'e-suleymanova', role: 'accountant' },
    warehouse: { employeeId: 'e-ibragimov', role: 'warehouse' },
    dispatcher: { employeeId: 'e-abakarova', role: 'dispatcher' },
    courier: { employeeId: 'e-musaev', role: 'courier' },
  };
  const DESK = { width: 1440, height: 900 };
  const PHONE = { width: 390, height: 844 };
  const shots = [
    ['01-владелец-обзор', 'owner', '/overview'],
    ['02-владелец-требует-внимания', 'owner', '/overview/attention'],
    ['03-продавец-касса', 'seller', '/register'],
    ['04-менеджер-заказы', 'manager', '/sales'],
    ['05-менеджер-рабочий-стол', 'manager', '/overview'],
    ['06-товары-каталог', 'owner', '/products'],
    ['07-склад-остатки', 'warehouse', '/stock'],
    ['08-закупки-предложение', 'owner', '/purchases/suggest'],
    ['09-бухгалтер-журнал-денег', 'accountant', '/money'],
    ['10-долги-покупателей', 'accountant', '/money/debts'],
    ['11-диспетчер-маршруты', 'dispatcher', '/delivery/routes'],
    ['12-отчёт-сотрудники', 'owner', '/reports/staff'],
    ['13-команда-и-права', 'owner', '/settings/team'],
    ['14-представитель-мой-день-телефон', 'rep', '/overview', PHONE],
    ['15-курьер-сегодня-телефон', 'courier', '/overview', PHONE],
    ['16-клиенты-1280', 'manager', '/clients', { width: 1280, height: 800 }],
    ['17-новый-оптовый-заказ', 'manager', '/sales/chats', DESK, async (p) => {
      await p.locator('.wa-parse').first().click();
      await p.waitForTimeout(900);
    }],
    ['18-карточка-заказа', 'owner', '/sales', DESK, async (p) => {
      await p.locator('.table tbody tr').nth(2).click();
      await p.waitForTimeout(900);
    }],
    ['19-карточка-товара', 'owner', '/products', DESK, async (p) => {
      await p.locator('.table tbody tr').first().click();
      await p.waitForTimeout(900);
    }],
    ['20-whatsapp-чаты', 'manager', '/sales/chats'],
    ['21-whatsapp-подключение', 'owner', '/settings/integrations', { width: 1440, height: 1000 }],
  ];
  const report = [];
  for (const [name, role, path, vp = DESK, act] of shots) {
    const phone = vp.width < 500;
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone });
    const p = await ctx.newPage();
    const errors = [];
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
    p.on('pageerror', (e) => errors.push('PAGE ' + e.message.slice(0, 200)));
    await p.addInitScript((s) => {
      if (!sessionStorage.getItem('shot-init')) {
        localStorage.clear();
        localStorage.setItem('bm-session-v2', JSON.stringify(s));
        sessionStorage.setItem('shot-init', '1');
      }
    }, S[role]);
    await p.goto(URL + '#' + path);
    await p.waitForTimeout(1800);
    if (act) await act(p);
    await p.screenshot({ path: `${ROOT}/${name}.png` });
    report.push({ name, errors });
    await ctx.close();
  }
  return JSON.stringify(report.filter((r) => r.errors.length));
}
