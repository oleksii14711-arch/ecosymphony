import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const URL = 'http://127.0.0.1:4174/';
const browser = await chromium.launch();
const out = {};
try {
  const p = await browser.newPage({ viewport: { width: 1200, height: 750 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String((e && e.message) || e)));
  await p.goto(URL, { waitUntil: 'load', timeout: 20000 });
  await p.waitForTimeout(1500);
  await p.click('#btnWake');
  const probe = path.join(os.tmpdir(), 'notaudio.txt');
  fs.writeFileSync(probe, 'hello world');
  await p.setInputFiles('#audioFile', probe);
  await p.waitForTimeout(800);
  out.badFileToast = await p.evaluate(() => document.getElementById('toast').textContent);
  out.overlayStillThere = await p.evaluate(() => !document.getElementById('overlay').classList.contains('hidden'));
  await p.click('#btnMic');
  await p.waitForTimeout(4000);
  out.micOverlayHidden = await p.evaluate(() => document.getElementById('overlay').classList.contains('hidden'));
  out.micToast = await p.evaluate(() => document.getElementById('toast').textContent);
  out.flyCount = await p.evaluate(() => document.getElementById('statFly').textContent);
  out.pageErrors = errs;
} catch (e) { out.fatal = String((e && e.message) || e); }
console.log(JSON.stringify(out, null, 1));
await browser.close();
