import { AudioAnalyzer, synthFeatures } from '../audio/analyze';
import { SoundInput } from '../audio/input';
import { MusicEngine } from '../audio/music';
import { Renderer } from '../render/renderer';
import { SIM_DT } from '../sim/constants';
import { Rng } from '../sim/rng';
import { SPECIES_NAMES, type AudioFeatures, type Intervention } from '../sim/types';
import { WORLD_H, WORLD_W, World, decodeSeed, encodeSeed, randomSeedText } from '../sim/world';

const SAVE_KEY = 'ecosymphony_save_v3';
const LS_SEED = 'ecosymphony_seed';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error('Немає елемента #' + id);
  return el;
}
function toast(msg: string, ms = 3200): void {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  window.clearTimeout((toast as unknown as { _h?: number })._h);
  (toast as unknown as { _h?: number })._h = window.setTimeout(() => t.classList.add('hidden'), ms);
}
function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss < 10 ? '0' : ''}${ss}`;
}

type Tool = 'none' | 'food' | 'current' | 'shelter';

export class App {
  private world: World;
  private worldB: World | null = null;
  private split = false;
  private listenB = false;
  private renderer: Renderer;
  private rendererB: Renderer | null = null;
  private music = new MusicEngine();
  private input = new SoundInput((s: string) => { $('ovStatus').textContent = s; });
  private analyzer = new AudioAnalyzer();
  private alive = false; // чи натиснуто «Оживити світ»
  private tool: Tool = 'none';
  private acc = 0;
  private lastT = 0;
  private paused = false;
  private journalLen = -1;
  private drag: { x: number; y: number } | null = null;
  private demoFeatureT = 0;

  constructor() {
    const seed = localStorage.getItem(LS_SEED) || randomSeedText();
    localStorage.setItem(LS_SEED, seed);
    this.world = new World(seed);
    const cv = $('cv') as HTMLCanvasElement;
    this.renderer = new Renderer(cv);
    this.bindUI();
    this.fit();
    window.addEventListener('resize', () => this.fit());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.paused = true;
        this.music.suspend();
      } else {
        this.paused = false;
        this.lastT = performance.now();
        if (this.alive) this.music.resume();
      }
    });
    this.lastT = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    window.setInterval(() => this.pollAudio(), 90);
    this.renderPanel();
  }

  // ---------- UI ----------
  private bindUI(): void {
    $('btnWake').addEventListener('click', () => {
      $('btnWake').classList.add('hidden');
      $('choiceRow').classList.remove('hidden');
      $('ovStatus').textContent = 'Оберіть джерело звуку: демонстрацію, мікрофон або свій файл.';
    });
    $('btnDemo').addEventListener('click', () => this.activate('demo'));
    $('btnMic').addEventListener('click', () => this.activate('mic'));
    $('btnFile').addEventListener('click', () => {
      ($('audioFile') as HTMLInputElement).click();
    });
    ($('audioFile') as HTMLInputElement).addEventListener('change', (ev) => {
      const inp = ev.target as HTMLInputElement;
      if (inp.files && inp.files[0]) void this.activate('file', inp.files[0]);
      inp.value = '';
    });

    const cv = $('cv') as HTMLCanvasElement;
    cv.addEventListener('pointerdown', (e) => this.onDown(e, cv, false));
    cv.addEventListener('pointermove', (e) => this.onMove(e, cv, false));
    window.addEventListener('pointerup', () => { this.drag = null; });

    $('toolFood').addEventListener('click', () => this.setTool('food'));
    $('toolCurrent').addEventListener('click', () => this.setTool('current'));
    $('toolShelter').addEventListener('click', () => this.setTool('shelter'));

    $('btnSound').addEventListener('click', () => {
      this.music.ensure();
      this.music.setMuted(!this.music.muted);
      $('btnSound').textContent = this.music.muted ? '🔈' : '🔇';
      toast(this.music.muted ? 'Звук вимкнено' : 'Звук увімкнено');
    });
    ($('vol') as HTMLInputElement).addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value) / 100;
      this.music.ensure();
      this.music.setVolume(v);
    });
    $('btnEco').addEventListener('click', () => {
      const v = !this.renderer.eco;
      this.renderer.setEco(v);
      if (this.rendererB) this.rendererB.setEco(v);
      $('btnEco').textContent = v ? '🌱' : '🍃';
      toast(v ? 'Екорежим: менше ефектів, довше життя батареї' : 'Повна якість ефектів');
    });
    $('btnPanel').addEventListener('click', () => $('panel').classList.toggle('open'));

    $('btnSplit').addEventListener('click', () => $('splitModal').classList.remove('hidden'));
    $('btnCancelSplit').addEventListener('click', () => $('splitModal').classList.add('hidden'));
    $('btnDoSplit').addEventListener('click', () => this.doSplit());
    $('btnUnsplit').addEventListener('click', () => this.unsplit());
    $('listenA').addEventListener('click', () => { this.listenB = false; this.syncListen(); });
    $('listenB').addEventListener('click', () => { this.listenB = true; this.syncListen(); });

    $('btnSeed').addEventListener('click', () => {
      $('panel').classList.add('open');
      void navigator.clipboard?.writeText(this.seedCode()).catch(() => undefined);
      toast('Насіння скопійовано: ' + this.seedCode());
    });
    $('btnCopySeed').addEventListener('click', () => {
      void navigator.clipboard?.writeText(this.seedCode()).catch(() => undefined);
      toast('Насіння скопійовано');
    });
    $('btnApplySeed').addEventListener('click', () => {
      const v = ($('seedInput') as HTMLInputElement).value.trim();
      const d = decodeSeed(v);
      if (!d) { toast('Невірний формат насіння. Приклад: ECO-A1B2C3-D'); return; }
      this.resetWorld(d.seedText);
      toast('Світ перероджено з насіння ' + v);
    });
    $('btnShot').addEventListener('click', () => this.snapshot());
    $('btnSaveLocal').addEventListener('click', () => this.saveLocal());
    $('btnLoadLocal').addEventListener('click', () => this.loadLocal());
    $('btnExport').addEventListener('click', () => this.exportJson());
    $('btnImport').addEventListener('click', () => ($('fileWorld') as HTMLInputElement).click());
    ($('fileWorld') as HTMLInputElement).addEventListener('change', (ev) => {
      const inp = ev.target as HTMLInputElement;
      const f = inp.files && inp.files[0];
      if (f) void this.importJson(f);
      inp.value = '';
    });
  }

  private setTool(t: Tool): void {
    this.tool = this.tool === t ? 'none' : t;
    for (const [id, name] of [['toolFood', 'food'], ['toolCurrent', 'current'], ['toolShelter', 'shelter']] as const) {
      $(id).classList.toggle('on', this.tool === name);
    }
    if (this.tool !== 'none') toast({ food: 'Торкніться світу — там з’явиться їжа', current: 'Проведіть по світу — створиться течія', shelter: 'Торкніться світу — стане притулок' }[this.tool]);
  }

  private seedCode(): string {
    return encodeSeed(this.world.seedNum, 3);
  }

  // ---------- Активація звуку ----------
  private async activate(kind: 'demo' | 'mic' | 'file', file?: File): Promise<void> {
    try {
      const ctx = this.music.ensure();
      this.music.enabled = true;
      this.music.resume();
      const audible = (this.music as unknown as { musicBus: GainNode }).musicBus;
      this.input.ensureCtx(ctx);
      this.input.setCtx(ctx);
      if (kind === 'demo') {
        this.input.startDemo(ctx, audible);
      } else if (kind === 'mic') {
        $('ovStatus').textContent = 'Просимо доступ до мікрофона…';
        try {
          await this.input.startMic(ctx);
        } catch (e) {
          $('ovStatus').textContent = 'Мікрофон недоступний — граємо далі без нього. Світ живе з демозвуком аналізу.';
          toast('Мікрофон відхилено або недоступний. Увімкнено тихий деморежим аналізу.');
          this.input.startDemo(ctx, audible);
          this.alive = true;
          $('overlay').classList.add('hidden');
          return;
        }
      } else if (kind === 'file' && file) {
        try {
          await this.input.startFile(ctx, audible, file);
        } catch (e) {
          toast((e as Error).message);
          $('ovStatus').textContent = (e as Error).message + ' Спробуйте демонстрацію.';
          return;
        }
      }
      if (this.input.analyser) this.analyzer.attach(this.input.analyser);
      this.alive = true;
      $('overlay').classList.add('hidden');
      toast('Світ чує вас. Низькі — корінням, середні — світлякам, різкі — іскрам.');
    } catch (e) {
      toast('Не вдалося увімкнути звук: ' + (e as Error).message + '. Світ продовжує жити німо.');
      this.alive = true;
      $('overlay').classList.add('hidden');
    }
  }

  private pollAudio(): void {
    if (document.hidden || this.paused) return;
    let f: AudioFeatures;
    if (this.alive && this.input.analyser) {
      f = this.analyzer.read();
    } else {
      // До активації та як запасний варіант: м'який синтетичний подих світу (не чутний)
      this.demoFeatureT += 0.09;
      f = synthFeatures(this.demoFeatureT);
      // У деморежимі до натискання — тихіше, щоб перші секунди були спокійними
      if (!this.alive) { f.energy *= 0.5; f.low *= 0.5; f.mid *= 0.5; f.high *= 0.5; f.onset *= 0.5; }
      // Якщо мікрофон відхилено, а демо не запущено — теж дихаємо синтетикою
      if (this.alive && !this.input.analyser) {
        this.demoFeatureT += 0.02;
        f = synthFeatures(this.demoFeatureT);
      }
    }
    this.world.setAudio(f);
    if (this.worldB) this.worldB.setAudio(f);
  }

  // ---------- Світ: кроки ----------
  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    if (this.paused || document.hidden) { this.lastT = now; return; }
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (!(dt >= 0) || dt > 0.25) dt = 0.025; // після повернення з фону — без стрибка
    this.acc += dt;
    let n = 0;
    while (this.acc >= SIM_DT && n < 5) {
      this.world.step();
      if (this.worldB) this.worldB.step();
      this.acc -= SIM_DT;
      n++;
    }
    if (n === 5) this.acc = 0;

    // музика — лише з того світу, який чути
    const audibleWorld = this.split && this.worldB ? (this.listenB ? this.worldB : this.world) : this.world;
    const evs = audibleWorld.drainEvents();
    // події нечутного світу просто відкидаємо, щоб не росли
    if (this.split && this.worldB) {
      if (this.listenB) this.world.drainEvents();
      else this.worldB.drainEvents();
    }
    if (this.alive) this.music.handle(evs);
    // спалахи для обох світів — забираємо події окремо? Вже забрали audible; для візуалу другої копії
    // використовуємо м'який індикатор через журнал/статистику, щоб не дублювати звук.
    this.render(now);
    this.renderStats();
  }

  private render(now: number): void {
    if (!this.split) {
      this.renderer.draw(this.world, now, 1);
    } else if (this.worldB && this.rendererB) {
      this.renderer.draw(this.world, now, 1);
      this.rendererB.draw(this.worldB, now, 1);
    }
  }

  private renderStats(): void {
    const [r, f, s] = this.world.counts();
    $('statRoot').textContent = String(r);
    $('statFly').textContent = String(f);
    $('statSpark').textContent = String(s);
    $('statTime').textContent = fmtTime(this.world.time);
    if (this.split && this.worldB) {
      const [r2, f2, s2] = this.worldB.counts();
      $('statA').textContent = `А: 🌰${r} ✨${f} ⚡${s} · нот ${this.world.notes.join('/')}`;
      $('statB').textContent = `Б: 🌰${r2} ✨${f2} ⚡${s2} · нот ${this.worldB.notes.join('/')}`;
      const gA = [0, 1, 2].map((sp) => this.world.avgGenes(sp as 0 | 1 | 2));
      const gB = [0, 1, 2].map((sp) => (this.worldB as World).avgGenes(sp as 0 | 1 | 2));
      $('compareBar').textContent =
        `Різниця за ${fmtTime(this.world.time)}: популяція А=${r + f + s} / Б=${r2 + f2 + s2} · ` +
        `макс. покоління А=${this.world.maxGen.join('/')} / Б=${(this.worldB as World).maxGen.join('/')} · ` +
        `середня швидкість світляків А=${gA[1].speed.toFixed(0)} / Б=${gB[1].speed.toFixed(0)} · ` +
        `середня нота іскор А=${gA[2].note.toFixed(1)} / Б=${gB[2].note.toFixed(1)}`;
    }
    // панель — не частіше ніж раз на ~0.5с
    if (this.world.journal.length !== this.journalLen) {
      this.journalLen = this.world.journal.length;
      this.renderPanel();
    } else if (Math.floor(this.world.time * 2) !== Math.floor((this.world.time - SIM_DT) * 2)) {
      this.renderPanelStats();
    }
    // порожній стан
    const total = r + f + s;
    const en = $('emptyNote');
    if (total === 0) {
      en.classList.remove('hidden');
      en.textContent = 'Світ спорожнів… зі спор от-от повернуться перші істоти. Додайте їжі або звуку.';
    } else en.classList.add('hidden');
  }

  private renderPanel(): void {
    this.renderPanelStats();
    const j = $('journal');
    const items = this.world.journal.slice(-30).reverse();
    j.innerHTML = items.length
      ? items.map((e) => `<div class="j"><small>${fmtTime(e.t)}</small>${escapeHtml(e.text)}</div>`).join('')
      : '<span class="fine">Поки тихо… перше народження з’явиться тут.</span>';
    $('seedCode').textContent = this.seedCode();
  }

  private renderPanelStats(): void {
    const [r, f, s] = this.world.counts();
    const gR = this.world.avgGenes(0);
    const gF = this.world.avgGenes(1);
    const gS = this.world.avgGenes(2);
    $('detailStats').innerHTML =
      `<div>🌰 Кореневики: <b>${r}</b> · народжень ${this.world.births[0]} · макс. покоління ${this.world.maxGen[0]}</div>` +
      `<div>✨ Світляки: <b>${f}</b> · народжень ${this.world.births[1]} · макс. покоління ${this.world.maxGen[1]}</div>` +
      `<div>⚡ Іскри: <b>${s}</b> · народжень ${this.world.deaths[2] >= 0 ? this.world.births[2] : 0} · макс. покоління ${this.world.maxGen[2]}</div>` +
      `<div class="fine">Середні ознаки — швидкість: 🌰 ${gR.speed.toFixed(0)} · ✨ ${gF.speed.toFixed(0)} · ⚡ ${gS.speed.toFixed(0)}; ` +
      `ноти: 🌰 ${gR.note.toFixed(1)} · ✨ ${gF.note.toFixed(1)} · ⚡ ${gS.note.toFixed(1)}</div>` +
      `<div class="fine">Активність середовища ${(this.world.activity * 100).toFixed(0)}% ${this.world.calm ? '· тиша (спокій)' : ''} · втручань пензлем: ${this.world.actions}</div>`;
  }

  // ---------- Інструменти ----------
  private toWorld(e: PointerEvent, cv: HTMLCanvasElement): { x: number; y: number } {
    const rect = cv.getBoundingClientRect();
    const px = (e.clientX - rect.left) / Math.max(1, rect.width);
    const py = (e.clientY - rect.top) / Math.max(1, rect.height);
    // renderer letterbox: обчислюємо так само
    const s = Math.min(rect.width / WORLD_W, rect.height / WORLD_H);
    const ox = (rect.width - WORLD_W * s) / 2;
    const oy = (rect.height - WORLD_H * s) / 2;
    const x = ((e.clientX - rect.left - ox) / s);
    const y = ((e.clientY - rect.top - oy) / s);
    void px; void py;
    return { x: Math.max(0, Math.min(WORLD_W, x)), y: Math.max(0, Math.min(WORLD_H, y)) };
  }

  private targetWorld(isB: boolean): World {
    if (isB && this.worldB) return this.worldB;
    return this.world;
  }

  private onDown(e: PointerEvent, cv: HTMLCanvasElement, isB: boolean): void {
    if (this.tool === 'none') return;
    const p = this.toWorld(e, cv);
    const w = this.targetWorld(isB);
    if (this.tool === 'food') w.applyTool({ kind: 'food', x: p.x, y: p.y });
    else if (this.tool === 'shelter') w.applyTool({ kind: 'shelter', x: p.x, y: p.y });
    else if (this.tool === 'current') this.drag = { x: p.x, y: p.y };
    if (this.tool !== 'current') toast('Втручання застосовано — спостерігайте за світом');
  }

  private onMove(e: PointerEvent, cv: HTMLCanvasElement, isB: boolean): void {
    if (this.tool !== 'current' || !this.drag || e.buttons === 0) return;
    const p = this.toWorld(e, cv);
    const dx = p.x - this.drag.x;
    const dy = p.y - this.drag.y;
    if (Math.hypot(dx, dy) > 30) {
      this.targetWorld(isB).applyTool({ kind: 'current', x: p.x, y: p.y, dx, dy });
      this.drag = { x: p.x, y: p.y };
    }
  }

  // ---------- Дві долі ----------
  private doSplit(): void {
    const sel = document.querySelector('input[name="interv"]:checked') as HTMLInputElement | null;
    const v = (sel ? sel.value : 'food') as Intervention;
    $('splitModal').classList.add('hidden');
    this.worldB = this.world.clone();
    this.worldB.intervention = v;
    if (v === 'food') {
      const rng = new Rng(this.worldB.rng.state);
      for (let i = 0; i < 3; i++) {
        this.worldB.foods.push({ x: 150 + rng.next() * 700, y: 120 + rng.next() * 400, r: 60, amount: 60 });
      }
    }
    this.worldB.log('split', `Долю розділено: втручання — ${v === 'food' ? 'більше їжі' : v === 'silence' ? 'тривала тиша' : 'сильніша течія'}`);
    this.world.log('split', 'Світ розділено на дві долі');
    this.split = true;
    this.listenB = false;
    $('singleWrap').classList.add('hidden');
    $('splitWrap').classList.remove('hidden');
    $('btnUnsplit').classList.remove('hidden');
    $('intTag').textContent = v === 'food' ? 'більше їжі' : v === 'silence' ? 'тривала тиша' : 'сильніша течія';
    const cvB = $('cvA') as HTMLCanvasElement; // cvA показує світ А
    void cvB;
    if (!this.rendererB) this.rendererB = new Renderer($('cvB') as HTMLCanvasElement);
    // переприв'язуємо: renderer малює А на cvA? Ні: renderer прив'язаний до #cv. Перемикаємо канваси:
    this.rebindCanvases();
    this.syncListen();
    this.fit();
    toast('Два світи живуть паралельно з однаковим кроком. Слухати можна один — перемикайте.');
  }

  private rebindCanvases(): void {
    // renderer (А) → cvA, rendererB (Б) → cvB
    (this.renderer as unknown as { canvas: HTMLCanvasElement }).canvas = $('cvA') as HTMLCanvasElement;
    if (this.rendererB) (this.rendererB as unknown as { canvas: HTMLCanvasElement }).canvas = $('cvB') as HTMLCanvasElement;
    const cvA = $('cvA') as HTMLCanvasElement;
    const cvB = $('cvB') as HTMLCanvasElement;
    cvA.onpointerdown = (e) => this.onDown(e, cvA, false);
    cvA.onpointermove = (e) => this.onMove(e, cvA, false);
    cvB.onpointerdown = (e) => this.onDown(e, cvB, true);
    cvB.onpointermove = (e) => this.onMove(e, cvB, true);
  }

  private syncListen(): void {
    $('listenA').classList.toggle('on', !this.listenB);
    $('listenB').classList.toggle('on', this.listenB);
  }

  private unsplit(): void {
    this.split = false;
    this.worldB = null;
    this.rendererB = null;
    $('splitWrap').classList.add('hidden');
    $('singleWrap').classList.remove('hidden');
    $('btnUnsplit').classList.add('hidden');
    (this.renderer as unknown as { canvas: HTMLCanvasElement }).canvas = $('cv') as HTMLCanvasElement;
    const cv = $('cv') as HTMLCanvasElement;
    cv.onpointerdown = null; cv.onpointermove = null;
    this.fit();
  }

  private resetWorld(seedText: string): void {
    this.unsplitIfNeeded();
    this.world = new World(seedText);
    localStorage.setItem(LS_SEED, seedText);
    this.journalLen = -1;
    this.renderPanel();
  }

  private unsplitIfNeeded(): void {
    if (this.split) this.unsplit();
  }

  private fit(): void {
    const fitOne = (id: string) => {
      const cv = $(id) as HTMLCanvasElement;
      const r = cv.getBoundingClientRect();
      const w = r.width || cv.parentElement?.clientWidth || window.innerWidth;
      const h = r.height || cv.parentElement?.clientHeight || 400;
      const tmp = new Renderer(cv);
      void tmp;
      (this.rendererFor(id) || this.renderer).resize(w, h);
    };
    if (!this.split) {
      const cv = $('cv') as HTMLCanvasElement;
      const parent = cv.parentElement as HTMLElement;
      const r = parent.getBoundingClientRect();
      this.renderer.resize(Math.max(50, r.width), Math.max(50, r.height));
    } else {
      for (const id of ['cvA', 'cvB']) {
        const cv = $(id) as HTMLCanvasElement;
        const r = cv.getBoundingClientRect();
        const w = Math.max(50, r.width || window.innerWidth / 2);
        const h = Math.max(50, r.height || 300);
        (id === 'cvA' ? this.renderer : this.rendererB as Renderer).resize(w, h);
      }
      void fitOne;
    }
  }

  private rendererFor(id: string): Renderer | null {
    if (id === 'cvA') return this.renderer;
    if (id === 'cvB') return this.rendererB;
    return this.renderer;
  }

  // ---------- Збереження ----------
  private saveLocal(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.world.snapshot()));
      $('saveStatus').textContent = `Збережено ${new Date().toLocaleTimeString()} · ${fmtTime(this.world.time)} · істот ${this.world.creatures.length}`;
      toast('Світ збережено в браузері');
    } catch {
      toast('Не вдалося зберегти: сховище переповнене або недоступне');
    }
  }

  private loadLocal(): void {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) { toast('Збереження не знайдено'); return; }
    try {
      const data = JSON.parse(raw) as Parameters<typeof World.restore>[0];
      this.unsplitIfNeeded();
      this.world = World.restore(data);
      this.journalLen = -1;
      this.renderPanel();
      toast('Світ відновлено');
    } catch (e) {
      toast('Збереження пошкоджене: ' + (e as Error).message);
    }
  }

  private exportJson(): void {
    const blob = new Blob([JSON.stringify(this.world.snapshot(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ecosymphony-${this.seedCode()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('JSON експортовано (з перевіркою версії при імпорті)');
  }

  private async importJson(f: File): Promise<void> {
    try {
      const text = await f.text();
      const data = JSON.parse(text) as Parameters<typeof World.restore>[0];
      this.unsplitIfNeeded();
      this.world = World.restore(data);
      this.journalLen = -1;
      this.renderPanel();
      toast('Світ імпортовано');
    } catch (e) {
      toast('Імпорт відхилено: ' + (e as Error).message);
    }
  }

  private snapshot(): void {
    const cv = (!this.split ? $('cv') : this.listenB ? $('cvB') : $('cvA')) as HTMLCanvasElement;
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = `ecosymphony-${Date.now()}.png`;
    a.click();
    toast('Знімок PNG збережено');
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

void SPECIES_NAMES;
