// Общая проверка: все роли × все доступные разделы и вкладки × ширины.
// Запуск через mcp__playwright__browser_run_code_unsafe (filename). Снимки — output/v2/qa/<роль>/...
async (page) => {
  const ROOT = '/Users/rabiatsahrudinova/Documents/ChatGPT/срм быт дом/output/v2/qa';
  const BASE = 'http://127.0.0.1:5173/#';
  const ROLES = ['owner', 'seller', 'manager', 'rep', 'accountant', 'warehouse', 'dispatcher', 'courier'];
  const PHONE = { rep: true, courier: true, owner: true };
  const report = [];
  const browser = page.context().browser();
  for (const role of ROLES) {
    for (const vp of [{ w: 1440, h: 900, tag: '1440' }, { w: 1280, h: 800, tag: '1280' }, ...(PHONE[role] ? [{ w: 390, h: 844, tag: 'phone' }] : [])]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
      const p = await ctx.newPage();
      const errors = [];
      p.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
      p.on('pageerror', (e) => errors.push('PAGE ' + e.message.slice(0, 300)));
      await p.addInitScript((r) => localStorage.setItem('bm-session-v2', JSON.stringify({ employeeId: null, role: r })), role);
      await p.goto(BASE + '/overview');
      await p.waitForTimeout(2500);
      // список ссылок меню и вкладок
      const navLinks = await p.evaluate(() => [...document.querySelectorAll('.nav a.nav-item, .mobile-bar a')].map((a) => a.getAttribute('href')));
      const visited = new Set();
      const queue = [...new Set(navLinks)].filter(Boolean);
      while (queue.length) {
        const href = queue.shift();
        if (visited.has(href)) continue;
        visited.add(href);
        errors.length = 0;
        await p.goto('http://127.0.0.1:5173/' + href);
        await p.waitForTimeout(1400);
        const tabs = await p.evaluate(() => [...document.querySelectorAll('.page-head .tabs a')].map((a) => a.getAttribute('href')));
        for (const t of tabs) if (t && !visited.has(t) && !queue.includes(t)) queue.push(t);
        const info = await p.evaluate(() => ({
          title: document.querySelector('.page-title')?.textContent ?? '',
          overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
          primaries: document.querySelectorAll('.content .btn-primary').length,
          upper: [...document.querySelectorAll('.content *')].filter((e) => e.children.length === 0 && e.textContent.trim().length > 3 && getComputedStyle(e).textTransform === 'uppercase').length,
          // надписи внутри рисунков упаковок (svg) — часть картинки, шкала шрифта к ним не относится
          sizes: [...new Set([...document.querySelectorAll('.content *')].filter((e) => e.children.length === 0 && e.textContent.trim() && !e.closest('svg')).map((e) => getComputedStyle(e).fontSize))],
          demoWords: (document.querySelector('.content')?.innerText.match(/демо|учебн|тестов/gi) || []).length,
          empty: document.querySelectorAll('.content .empty').length,
          failed: document.querySelectorAll('.content .notice.is-bad').length,
        }));
        const name = href.replace('#/', '').replace(/\//g, '_') || 'root';
        await p.screenshot({ path: `${ROOT}/${role}/${vp.tag}--${name}.png`, fullPage: true });
        report.push({ role, vp: vp.tag, href, ...info, errors: [...errors] });
      }
      await ctx.close();
    }
  }
  const bad = report.filter((r) => r.errors.length || r.overflowX || r.primaries > 1 || r.upper || r.demoWords || r.failed || r.sizes.some((s) => !['11px', '12px', '13px', '14px', '16px', '20px', '24px', '32px'].includes(s)));
  return JSON.stringify({ pages: report.length, problems: bad.map((r) => ({ role: r.role, vp: r.vp, href: r.href, errors: r.errors, overflowX: r.overflowX, primaries: r.primaries, upper: r.upper, demoWords: r.demoWords, failed: r.failed, badSizes: r.sizes.filter((s) => !['11px', '12px', '13px', '14px', '16px', '20px', '24px', '32px'].includes(s)) })) }, null, 1);
}
