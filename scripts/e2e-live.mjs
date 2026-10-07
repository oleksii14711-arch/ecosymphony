import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const out = {};
try {
  const p = await browser.newPage({ viewport: { width: 1280, height: 780 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String((e && e.message) || e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('https://oleksii14711-arch.github.io/ecosymphony/', { waitUntil: 'load', timeout: 30000 });
  await p.waitForTimeout(2500);
  out.title = await p.title();
  out.overlay = await p.evaluate(() => !document.getElementById('overlay').classList.contains('hidden'));
  await p.click('#btnWake');
  await p.click('#btnDemo');
  await p.waitForTimeout(5000);
  out.hidden = await p.evaluate(() => document.getElementById('overlay').classList.contains('hidden'));
  out.counts = await p.evaluate(() => ({
    root: document.getElementById('statRoot').textContent,
    fly: document.getElementById('statFly').textContent,
    spark: document.getElementById('statSpark').textContent,
    time: document.getElementById('statTime').textContent,
  }));
  out.journal = await p.evaluate(() => document.getElementById('journal').textContent.slice(0, 120));
  out.errors = errs;
  await p.screenshot({ path: 'e2e-live.png' });
} catch (e) { out.fatal = String((e && e.message) || e); }
console.log(JSON.stringify(out, null, 1));
await browser.close();
if ((out.errors || []).length) process.exitCode = 2;
