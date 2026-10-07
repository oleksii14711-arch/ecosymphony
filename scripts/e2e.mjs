import { chromium } from 'playwright-core';

const URL = process.env.E2E_URL || 'http://127.0.0.1:4173/';
const errors = [];
const logs = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e && e.message || e)));

async function canvasPixels(id) {
  return page.evaluate((cid) => {
    const cv = document.getElementById(cid);
    if (!cv || !cv.width) return { n: 0, w: 0, h: 0 };
    const c = document.createElement('canvas');
    c.width = 160; c.height = 100;
    const g = c.getContext('2d');
    g.drawImage(cv, 0, 0, 160, 100);
    const d = g.getImageData(0, 0, 160, 100).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] + d[i + 1] + d[i + 2] > 24) lit++;
    }
    return { n: lit, w: cv.width, h: cv.height };
  }, id);
}

const out = {};
try {
  await page.goto(URL, { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(2500);
  out.overlayVisible = await page.evaluate(() => !document.getElementById('overlay').classList.contains('hidden'));
  out.demoModePixels = await canvasPixels('cv');

  // 1. Оживити світ -> вибір джерел
  await page.click('#btnWake');
  await page.waitForTimeout(300);
  out.choicesVisible = await page.evaluate(() => !document.getElementById('choiceRow').classList.contains('hidden'));

  // 2. Демонстрація
  await page.click('#btnDemo');
  await page.waitForTimeout(4000);
  out.overlayHidden = await page.evaluate(() => document.getElementById('overlay').classList.contains('hidden'));
  out.afterDemoPixels = await canvasPixels('cv');
  out.counts = await page.evaluate(() => ({
    root: document.getElementById('statRoot').textContent,
    fly: document.getElementById('statFly').textContent,
    spark: document.getElementById('statSpark').textContent,
    time: document.getElementById('statTime').textContent,
  }));
  out.journal = await page.evaluate(() => document.getElementById('journal').textContent.slice(0, 200));
  await page.screenshot({ path: 'e2e-desktop.png' });

  // 3. Інструмент їжа: клік по центру канваса
  await page.click('#toolFood');
  const box = await page.evaluate(() => { const r = document.getElementById('cv').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(500);

  // 4. Розділити долю
  await page.click('#btnSplit');
  await page.waitForTimeout(300);
  out.splitModal = await page.evaluate(() => !document.getElementById('splitModal').classList.contains('hidden'));
  await page.click('#btnDoSplit');
  await page.waitForTimeout(5000);
  out.splitVisible = await page.evaluate(() => !document.getElementById('splitWrap').classList.contains('hidden'));
  out.pixelsA = await canvasPixels('cvA');
  out.pixelsB = await canvasPixels('cvB');
  out.compare = await page.evaluate(() => document.getElementById('compareBar').textContent.slice(0, 300));
  await page.screenshot({ path: 'e2e-split.png' });

  // 5. Експорт JSON (перевірка, що не падає) + імпорт назад через localStorage збереження
  await page.click('#btnUnsplit');
  await page.click('#btnSaveLocal');
  await page.waitForTimeout(300);
  out.saveStatus = await page.evaluate(() => document.getElementById('saveStatus').textContent);
  await page.click('#btnLoadLocal');
  await page.waitForTimeout(500);

  // 6. Мобільний вигляд
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'e2e-mobile.png' });
  out.mobilePixels = await canvasPixels('cv');
} catch (e) {
  out.fatal = String(e && e.message || e);
}
out.consoleErrors = errors;
out.logs = logs.slice(0, 10);
console.log(JSON.stringify(out, null, 1));
await browser.close();
if (errors.length) process.exitCode = 2;
