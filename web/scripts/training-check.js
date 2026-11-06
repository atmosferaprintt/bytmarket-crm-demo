// Проверка режима обучения: все роли × разделы меню. Считает номера на экране, наложения номеров и ошибки консоли.
// Запуск через mcp__playwright__browser_run_code_unsafe (filename). Снимки — output/v2/training/<роль>/...
async (page) => {
  const ROOT = '/Users/rabiatsahrudinova/Documents/ChatGPT/срм быт дом/output/v2/training';
  const BASE = 'http://127.0.0.1:5173/#';
  const ROLES = ['owner', 'seller', 'manager', 'rep', 'accountant', 'warehouse', 'dispatcher', 'courier'];
  const PHONE = { rep: true, courier: true };
  const report = [];
  const browser = page.context().browser();
  for (const role of ROLES) {
    const vps = PHONE[role] ? [{ w: 390, h: 844, tag: 'phone' }, { w: 1280, h: 800, tag: '1280' }] : [{ w: 1440, h: 900, tag: '1440' }, { w: 1280, h: 800, tag: '1280' }];
    for (const vp of vps) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
      const p = await ctx.newPage();
      const errors = [];
      p.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
      p.on('pageerror', (e) => errors.push('PAGE ' + e.message.slice(0, 300)));
      await p.addInitScript((r) => {
        localStorage.setItem('bm-session-v2', JSON.stringify({ employeeId: null, role: r }));
        localStorage.setItem('bm-training-v1', JSON.stringify({ on: true, seen: [] }));
      }, role);
      await p.goto(BASE + '/overview');
      await p.waitForTimeout(2200);
      const navLinks = await p.evaluate(() => [...document.querySelectorAll('.nav a.nav-item, .mobile-bar a')].map((a) => a.getAttribute('href')));
      const visited = new Set();
      const queue = [...new Set(navLinks)].filter(Boolean);
      while (queue.length) {
        const href = queue.shift();
        if (visited.has(href)) continue;
        visited.add(href);
        errors.length = 0;
        await p.goto('http://127.0.0.1:5173/' + href);
        await p.waitForTimeout(1500);
        // вкладки раздела
        const tabs = await p.evaluate(() => [...document.querySelectorAll('.page-head .tabs a')].map((a) => a.getAttribute('href')));
        for (const t of tabs) if (t && !visited.has(t) && !queue.includes(t)) queue.push(t);
        const info = await p.evaluate(() => {
          const bs = [...document.querySelectorAll('.hint-beacon')].map((b) => {
            const r = b.getBoundingClientRect();
            return { n: b.textContent.trim(), x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
          });
          const overlaps = [];
          for (let i = 0; i < bs.length; i++)
            for (let j = i + 1; j < bs.length; j++) {
              const d = Math.hypot(bs[i].x - bs[j].x, bs[i].y - bs[j].y);
              if (d < 18) overlaps.push(bs[i].n + '/' + bs[j].n);
            }
          const out = bs.filter((b) => b.x < 0 || b.y < 0 || b.x > innerWidth || b.y > innerHeight).map((b) => b.n);
          const slot = document.querySelector('.hint-slot-text, .hint-slot-inner');
          return { beacons: bs.length, overlaps, out, slot: slot ? slot.textContent.trim() : '' };
        });
        const name = href.replace(/^#\//, '').replace(/[/?=&]/g, '_') || 'root';
        let pop = '';
        if (info.beacons) {
          await p.locator('.hint-beacon').first().evaluate((e) => e.click());
          await p.waitForTimeout(350);
          pop = await p.evaluate(() => {
            const el = document.querySelector('.hint-pop');
            if (!el) return 'НЕТ ОКНА';
            const r = el.getBoundingClientRect();
            const inView = r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
            return (el.querySelector('.hint-pop-title, h3, strong')?.textContent || '').trim() + (inView ? '' : ' [ЗА КРАЕМ]');
          });
          await p.screenshot({ path: `${ROOT}/${role}/${vp.tag}-${name}.png` });
          await p.keyboard.press('Escape');
          await p.waitForTimeout(150);
        } else {
          await p.screenshot({ path: `${ROOT}/${role}/${vp.tag}-${name}-EMPTY.png` });
        }
        report.push({ role, vp: vp.tag, href, ...info, pop, errors: [...errors] });
      }
      await ctx.close();
    }
  }
  const bad = report.filter((r) => !r.beacons || r.overlaps.length || r.out.length || r.errors.length || /НЕТ|ЗА КРАЕМ/.test(r.pop));
  return {
    pages: report.length,
    totalBeacons: report.reduce((s, r) => s + r.beacons, 0),
    min: report.reduce((m, r) => Math.min(m, r.beacons), 99),
    bad: bad.map((r) => `${r.role} ${r.vp} ${r.href} b=${r.beacons} ov=${r.overlaps.join(',')} out=${r.out.join(',')} pop=${r.pop} err=${r.errors.join(' | ')}`),
    sample: report.slice(0, 200).map((r) => `${r.role} ${r.vp} ${r.href} b=${r.beacons}`),
  };
}
