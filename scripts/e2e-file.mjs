import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const out = {};
try {
  const p = await browser.newPage({ viewport: { width: 1200, height: 750 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String((e && e.message) || e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file:///C:/Users/admin/Documents/Проект по умолчанию/ecosymphony/dist/index.html', { waitUntil: 'load', timeout: 20000 });
  await p.waitForTimeout(2500);
  out.title = await p.title();
  out.overlay = await p.evaluate(() => !!document.getElementById('overlay'));
  out.counts = await p.evaluate(() => document.getElementById('statFly').textContent);
  out.errors = errs;
} catch (e) { out.fatal = String((e && e.message) || e); }
console.log(JSON.stringify(out, null, 1));
await browser.close();
