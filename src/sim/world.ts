import { GRID_CELL, INITIAL_COUNTS, JOURNAL_MAX, MAX_CREATURES, MAX_FOOD, MAX_MOTES, MAX_SHELTERS, SIM_DT, SPECIES_CAP } from './constants';
import { mutate, randomGenes, randomMaxAge } from './genome';
import { SpatialGrid } from './grid';
import { Rng, hashSeed } from './rng';
import { FLY, ROOT, SPARK, SILENT, type AudioFeatures, type Creature, type FoodPatch, type Intervention, type JournalEntry, type Mote, type Shelter, type SimEvent, type Species, type ToolAction } from './types';

export const WORLD_W = 1000;
export const WORLD_H = 625;
export const SAVE_VERSION = 3;

export interface WorldSnapshot {
  version: number;
  seedText: string;
  seedNum: number;
  rngState: number;
  time: number;
  nextId: number;
  intervention: Intervention;
  creatures: Creature[];
  motes: Mote[];
  foods: FoodPatch[];
  shelters: Shelter[];
  flows: Flow[];
  env: { activity: number; silence: number; calm: boolean };
  audio: AudioFeatures;
  birthBudget: number;
  stats: { births: number[]; deaths: number[]; notes: number[]; maxGen: number[]; actions: number; sporeTimer: number[]; firstBirthLogged: boolean[]; extinctLogged: boolean[] };
  journal: JournalEntry[];
}

export interface Flow {
  x: number; y: number; dx: number; dy: number; ttl: number; max: number;
}

/** Живий світ: фіксований крок, уся випадковість через власний Rng. */
export class World {
  seedText: string;
  seedNum: number;
  rng: Rng;
  time = 0;
  nextId = 1;
  creatures: Creature[] = [];
  motes: Mote[] = [];
  foods: FoodPatch[] = [];
  shelters: Shelter[] = [];
  flows: Flow[] = [];
  grid = new SpatialGrid(WORLD_W, WORLD_H, GRID_CELL, MAX_CREATURES + 8);
  audio: AudioFeatures = { ...SILENT };
  activity = 0.5;
  silenceTimer = 0;
  calm = false;
  events: SimEvent[] = [];
  journal: JournalEntry[] = [];
  births = [0, 0, 0];
  deaths = [0, 0, 0];
  notes = [0, 0, 0];
  maxGen = [0, 0, 0];
  firstBirthLogged = [false, false, false];
  extinctLogged = [false, false, false];
  sporeTimer = [20, 26, 34];
  birthBudget = 1.5;
  actions = 0;
  intervention: Intervention = 'none';
  recentBirths = 0;
  recentDeaths = 0;

  constructor(seedText: string, intervention: Intervention = 'none') {
    this.seedText = seedText;
    this.seedNum = hashSeed(seedText);
    this.rng = new Rng(this.seedNum);
    this.intervention = intervention;
    this.spawnInitial();
    if (intervention === 'food') {
      for (let i = 0; i < 3; i++) {
        this.foods.push({ x: this.rng.range(120, WORLD_W - 120), y: this.rng.range(100, WORLD_H - 100), r: 60, amount: 60 });
      }
    }
  }

  spawnInitial(): void {
    const counts = INITIAL_COUNTS;
    for (let sp = 0; sp < 3; sp++) {
      for (let i = 0; i < counts[sp]; i++) this.spawnCreature(sp as Species, 0, false);
    }
  }

  spawnCreature(sp: Species, gen: number, isBirth: boolean, px?: number, py?: number, parentGenes?: Creature['genes']): Creature {
    const c = this.buildCreature(sp, gen, isBirth, px, py, parentGenes);
    this.creatures.push(c);
    return c;
  }

  /** Створює істоту, але НЕ додає до світу (для відкладених народжень посеред кроку). */
  buildCreature(sp: Species, gen: number, isBirth: boolean, px?: number, py?: number, parentGenes?: Creature['genes']): Creature {
    const rng = this.rng;
    const genes = parentGenes ? mutate(sp, parentGenes, rng) : randomGenes(sp, rng);
    const x = px !== undefined ? clamp(px + rng.range(-26, 26), 20, WORLD_W - 20) : rng.range(60, WORLD_W - 60);
    const y = py !== undefined ? clamp(py + rng.range(-26, 26), 20, WORLD_H - 20) : rng.range(60, WORLD_H - 60);
    const c: Creature = {
      id: this.nextId++, sp, x, y, px: x, py: y,
      vx: 0, vy: 0, heading: rng.range(0, Math.PI * 2),
      age: isBirth ? 0 : rng.range(0, 30),
      maxAge: randomMaxAge(sp, rng),
      energy: isBirth ? 34 : rng.range(40, 80),
      gen, parent: 0, dormant: false,
      cooldown: rng.range(0, 2), actCooldown: 0, song: rng.range(0, 10),
      genes,
    };
    if (gen > this.maxGen[sp]) {
      this.maxGen[sp] = gen;
      if (isBirth && gen >= 1) this.log('generation', `Нове покоління: ${spName(sp)} · покоління ${gen}`);
    }
    return c;
  }

  setAudio(f: AudioFeatures): void {
    // Захист від перевантаження: стискаємо діапазон, різкі піки згладжуємо
    const cl = (v: number) => (v !== v || v < 0 ? 0 : v > 1 ? 1 : v);
    const a = this.audio;
    const k = 0.25;
    a.energy = a.energy + (cl(f.energy) - a.energy) * k;
    a.low = a.low + (cl(f.low) - a.low) * k;
    a.mid = a.mid + (cl(f.mid) - a.mid) * k;
    a.high = a.high + (cl(f.high) - a.high) * k;
    a.onset = a.onset + (cl(f.onset) - a.onset) * 0.5;
  }

  applyTool(act: ToolAction): void {
    this.actions++;
    if (act.kind === 'food') {
      if (this.foods.length >= MAX_FOOD) this.foods.shift();
      this.foods.push({ x: act.x, y: act.y, r: 55, amount: 70 });
    } else if (act.kind === 'shelter') {
      if (this.shelters.length >= MAX_SHELTERS) this.shelters.shift();
      this.shelters.push({ x: act.x, y: act.y, r: 90, ttl: 45, max: 45 });
    } else {
      if (this.flows.length >= 8) this.flows.shift();
      const m = Math.hypot(act.dx, act.dy) || 1;
      const boost = this.intervention === 'current' ? 1.6 : 1;
      this.flows.push({ x: act.x, y: act.y, dx: (act.dx / m) * 260 * boost, dy: (act.dy / m) * 260 * boost, ttl: 6, max: 6 });
    }
  }

  counts(): [number, number, number] {
    let a = 0, b = 0, cc = 0;
    for (const c of this.creatures) { if (c.sp === 0) a++; else if (c.sp === 1) b++; else cc++; }
    return [a, b, cc];
  }

  avgGenes(sp: Species): { speed: number; sense: number; size: number; note: number; n: number } {
    let n = 0, s = 0, se = 0, si = 0, no = 0;
    for (const c of this.creatures) {
      if (c.sp !== sp) continue;
      n++; s += c.genes.speed; se += c.genes.sense; si += c.genes.size; no += c.genes.note;
    }
    if (!n) return { speed: 0, sense: 0, size: 0, note: 0, n: 0 };
    return { speed: s / n, sense: se / n, size: si / n, note: no / n, n };
  }

  step(): void {
    const dt = SIM_DT;
    const rng = this.rng;
    this.time += dt;
    const au = this.audio;
    // Глобальний бюджет народжень: не більше ~1.2/с — популяція росте хвилями, а не вибухом
    this.birthBudget = Math.min(3, this.birthBudget + dt * 1.2);

    // Втручання другої долі
    let low = au.low, mid = au.mid, high = au.high, energy = au.energy;
    if (this.intervention === 'silence') { low *= 0.25; mid *= 0.25; high *= 0.25; energy *= 0.25; }
    if (this.intervention === 'food') { /* їжа вже додана + повільна регенерація */ }

    // Активність середовища
    const target = clamp01(energy * 1.4 + (low + mid + high) / 3 * 0.6);
    this.activity += (target - this.activity) * 0.04;
    if (target < 0.06) this.silenceTimer += dt; else this.silenceTimer = 0;
    this.calm = this.silenceTimer > 4;

    // Народження ресурсних частинок (мотів) зі звуку
    const moteBudget = MAX_MOTES - this.motes.length;
    if (moteBudget > 0) {
      const pLow = low * (this.intervention === 'food' ? 1.4 : 1);
      let want = 0;
      if (rng.next() < pLow * 0.5) want++;
      if (rng.next() < mid * 0.5) want++;
      if (rng.next() < high * 0.45) want++;
      if (rng.next() < au.onset * 0.8) want += 2;
      // Базовий мінімум, щоб тиша не вбивала світ: повільне тління ресурсів
      if (this.motes.length < 24 && rng.next() < 0.25) want++;
      want = Math.min(want, moteBudget, 5);
      for (let i = 0; i < want; i++) {
        const band = rng.next();
        this.motes.push({
          x: rng.range(30, WORLD_W - 30), y: rng.range(30, WORLD_H - 30),
          vx: rng.range(-12, 12), vy: rng.range(-12, 12),
          e: 8 + rng.next() * 14, life: rng.range(14, 30),
        });
        void band;
      }
    }

    // Оновлення мотів
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const m = this.motes[i];
      m.life -= dt;
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (m.x < 8 || m.x > WORLD_W - 8) m.vx *= -1;
      if (m.y < 8 || m.y > WORLD_H - 8) m.vy *= -1;
      if (m.life <= 0) { this.motes.splice(i, 1); }
    }

    // Їжа та притулки
    for (let i = this.foods.length - 1; i >= 0; i--) {
      const f = this.foods[i];
      f.amount -= dt * (this.intervention === 'food' ? 0.5 : 1.1);
      if (f.amount <= 0) this.foods.splice(i, 1);
    }
    if (this.intervention === 'food' && this.foods.length < 4 && rng.next() < 0.01) {
      this.foods.push({ x: rng.range(120, WORLD_W - 120), y: rng.range(100, WORLD_H - 100), r: 60, amount: 55 });
    }
    for (let i = this.shelters.length - 1; i >= 0; i--) {
      const s = this.shelters[i];
      s.ttl -= dt;
      if (s.ttl <= 0) this.shelters.splice(i, 1);
    }
    for (let i = this.flows.length - 1; i >= 0; i--) {
      const f = this.flows[i];
      f.ttl -= dt;
      if (f.ttl <= 0) this.flows.splice(i, 1);
    }

    this.grid.rebuild(this.creatures);

    const counts = this.counts();
    let total = this.creatures.length;
    this.recentBirths = 0; this.recentDeaths = 0;
    // Відкладені зміни: масив істот і сітку не чіпаємо посеред циклу,
    // інакше індекси сітки вказують на зсунуті/неіснуючі елементи.
    const dead = new Set<Creature>();
    const newborns: Creature[] = [];

    // Головний цикл істот
    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      if (!c || dead.has(c)) continue;
      c.px = c.x; c.py = c.y;
      c.age += dt;
      c.cooldown -= dt; c.actCooldown -= dt;

      const inShelter = this.insideShelter(c.x, c.y);
      // Метаболізм: тиша знижує витрати, притулок теж
      let drain = c.sp === ROOT ? 1.5 : c.sp === FLY ? 2.6 : 3.4;
      drain *= c.genes.size;
      if (this.silenceTimer > 2) drain *= 0.45;
      if (inShelter) drain *= 0.5;
      if (c.dormant) drain *= 0.4;
      c.energy -= drain * dt;

      // Живлення від частот свого діапазону
      const band = c.sp === ROOT ? low : c.sp === FLY ? mid : high;
      const gainRate = c.sp === ROOT ? 20 : c.sp === FLY ? 17 : 15 + au.onset * 22;
      c.energy += band * gainRate * dt * (c.dormant ? 0.5 : 1);

      // Спокій у тиші
      if (this.silenceTimer > 3 && c.energy < 45) c.dormant = true;
      if (band > 0.3 || c.energy > 70) c.dormant = false;

      // Пошук їжі: мот поблизу
      let tx = -1, ty = -1, best = Infinity;
      const sense = c.genes.sense;
      this.grid.query(c.x, c.y, sense, (o) => {
        if (o === c || o.sp !== c.sp) return;
        // Тяжіння до родичів слабке; головне — мотів шукаємо окремо
        return;
      });
      // Найближчий мот (лінійний пошук обмежений: мотів ≤ 220, істот ≤ 300 — прийнятно)
      for (let mi = 0; mi < this.motes.length; mi++) {
        const m = this.motes[mi];
        const dx = m.x - c.x, dy = m.y - c.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < sense * sense && d2 < best) { best = d2; tx = m.x; ty = m.y; }
      }
      // Плями їжі
      for (const f of this.foods) {
        const dx = f.x - c.x, dy = f.y - c.y;
        const d2 = dx * dx + dy * dy;
        const rr = (f.r + 20) * (f.r + 20);
        if (d2 < rr && d2 < best) { best = d2; tx = f.x; ty = f.y; }
      }

      // Керування рухом
      const sleepy = c.dormant ? 0.25 : 1;
      const sp = c.genes.speed * sleepy * (c.sp === SPARK && au.onset > 0.4 ? 1.8 : 1);
      let desX = 0, desY = 0;
      if (tx >= 0) {
        const dx = tx - c.x, dy = ty - c.y;
        const d = Math.hypot(dx, dy) || 1;
        desX = (dx / d) * sp; desY = (dy / d) * sp;
      } else {
        c.heading += rng.soft() * 1.6 * dt * 3;
        // Світляки люблять кола, кореневики майже стоять, іскри смикаються
        if (c.sp === FLY) c.heading += Math.sin(this.time * 1.7 + c.id) * 0.6 * dt;
        if (c.sp === SPARK) c.heading += rng.soft() * 4 * dt;
        desX = Math.cos(c.heading) * sp * 0.6;
        desY = Math.sin(c.heading) * sp * 0.6;
      }
      // Течія
      for (const f of this.flows) {
        const dx = c.x - f.x, dy = c.y - f.y;
        const d2 = dx * dx + dy * dy;
        const R = 190;
        if (d2 < R * R) {
          const w = (1 - Math.sqrt(d2) / R) * (f.ttl / f.max);
          desX += f.dx * w; desY += f.dy * w;
        }
      }
      const steer = c.sp === ROOT ? 1.2 : c.sp === FLY ? 2.4 : 3.2;
      c.vx += (desX - c.vx) * Math.min(1, steer * dt);
      c.vy += (desY - c.vy) * Math.min(1, steer * dt);
      c.x += c.vx * dt; c.y += c.vy * dt;
      if (c.x < 12) { c.x = 12; c.vx *= -0.6; c.heading = Math.PI - c.heading; }
      if (c.x > WORLD_W - 12) { c.x = WORLD_W - 12; c.vx *= -0.6; c.heading = Math.PI - c.heading; }
      if (c.y < 12) { c.y = 12; c.vy *= -0.6; c.heading = -c.heading; }
      if (c.y > WORLD_H - 12) { c.y = WORLD_H - 12; c.vy *= -0.6; c.heading = -c.heading; }

      // Поглинання мотів
      const eatR = 14 * c.genes.size + 6;
      for (let mi = this.motes.length - 1; mi >= 0; mi--) {
        const m = this.motes[mi];
        const dx = m.x - c.x, dy = m.y - c.y;
        if (dx * dx + dy * dy < eatR * eatR) {
          c.energy += m.e * (c.sp === ROOT ? 1.1 : 1);
          this.motes.splice(mi, 1);
          if (c.actCooldown <= 0 && this.events.length < 24) {
            c.actCooldown = 0.5 + rng.next();
            this.events.push({ type: 'eat', sp: c.sp, note: c.genes.note, x: c.x, y: c.y, power: 0.5 });
          }
          break;
        }
      }
      // Плями їжі
      for (const f of this.foods) {
        const dx = f.x - c.x, dy = f.y - c.y;
        if (dx * dx + dy * dy < (f.r * f.r) && f.amount > 0) {
          const bite = Math.min(f.amount, 14 * dt);
          f.amount -= bite; c.energy += bite * 1.2;
        }
      }

      // Близькість родичів → тихий «хор» (музична подія, не надто часто)
      if (c.cooldown <= 0) {
        let near = 0;
        this.grid.query(c.x, c.y, 70, (o) => { if (o !== c && !dead.has(o) && o.sp === c.sp) near++; });
        if (near >= 2) {
          c.cooldown = 3 + rng.next() * 4;
          c.song += 1;
          this.notes[c.sp]++;
          if (this.events.length < 24) {
            this.events.push({
              type: c.sp === ROOT ? 'pulse' : c.sp === FLY ? 'pollinate' : 'hit',
              sp: c.sp, note: c.genes.note, x: c.x, y: c.y, power: 0.4 + Math.min(0.6, near * 0.1),
            });
          }
        } else {
          c.cooldown = 0.8 + rng.next() * 1.5;
          // Поодиноке «мугикання» — рідше, залежить від енергії
          if (c.energy > 55 && rng.next() < 0.3) {
            this.notes[c.sp]++;
            if (this.events.length < 24) {
              this.events.push({ type: c.sp === SPARK ? 'tick' : 'pulse', sp: c.sp, note: c.genes.note, x: c.x, y: c.y, power: 0.35 });
            }
          }
        }
      }

      // Розмноження
      const cap = SPECIES_CAP[c.sp];
      if (c.energy > 115 && c.age > 18 && this.birthBudget >= 1 && counts[c.sp] < cap && total + newborns.length < MAX_CREATURES) {
        let mate: Creature | null = null;
        this.grid.query(c.x, c.y, 60, (o) => {
          if (o !== c && !dead.has(o) && o.sp === c.sp && o.energy > 60 && o.age > 10) { mate = o; return true; }
        });
        if (mate || (c.energy > 150 && rng.next() < 0.015)) {
          c.energy -= 65;
          this.birthBudget -= 1;
          const child = this.buildCreature(c.sp, c.gen + 1, true, c.x, c.y, c.genes);
          child.parent = c.id;
          newborns.push(child);
          counts[c.sp]++;
          this.births[c.sp]++;
          this.recentBirths++;
          this.events.push({ type: 'birth', sp: c.sp, note: child.genes.note, x: child.x, y: child.y, power: 0.9 });
          if (!this.firstBirthLogged[c.sp]) {
            this.firstBirthLogged[c.sp] = true;
            this.log('birth', `Перше народження: ${spName(c.sp)} (покоління ${child.gen})`);
          }
        }
      }

      // Смерть
      const tooOld = c.age > c.maxAge;
      const starved = c.energy <= 0;
      const sheltered = inShelter && starved && rng.next() < 0.7; // притулок інколи рятує
      if ((tooOld || starved) && !sheltered) {
        // Притулок уповільнює смерть від старості
        if (tooOld && inShelter && rng.next() < 0.5) { c.age -= 5; }
        else {
          dead.add(c);
          counts[c.sp]--; total--; this.deaths[c.sp]++; this.recentDeaths++;
          if (this.events.length < 24) this.events.push({ type: 'death', sp: c.sp, note: c.genes.note, x: c.x, y: c.y, power: 0.5 });
          continue;
        }
      }

      // Клампи — інваріанти для тестів
      if (!(c.energy >= -50 && c.energy <= 400)) c.energy = clamp(c.energy, -50, 400);
      c.x = clamp(c.x, 0, WORLD_W); c.y = clamp(c.y, 0, WORLD_H);
    }
    if (dead.size > 0) this.creatures = this.creatures.filter((c) => !dead.has(c));
    for (const n of newborns) this.creatures.push(n);

    // Спори виживання: якщо виду мало — шанс відродження (світ не вмирає від паузи)
    for (let sp = 0; sp < 3; sp++) {
      this.sporeTimer[sp] -= dt;
      if (counts[sp] === 0) {
        if (!this.extinctLogged[sp]) {
          this.extinctLogged[sp] = true;
          this.log('extinct', `Вид зник: ${spName(sp as Species)} — чекаємо спор…`);
        }
        if (this.sporeTimer[sp] <= 0) {
          this.sporeTimer[sp] = 18;
          const c = this.spawnCreature(sp as Species, 0, true);
          this.births[sp]++;
          this.extinctLogged[sp] = false;
          this.log('return', `${spName(sp as Species)} повертаються зі спор`);
          this.events.push({ type: 'wake', sp: sp as Species, note: c.genes.note, x: c.x, y: c.y, power: 1 });
        }
      } else {
        this.sporeTimer[sp] = 20 + sp * 6;
        if (counts[sp] > 0) this.extinctLogged[sp] = false;
      }
    }

    // Буря від різкої атаки (іскри шаленіють, але недовго)
    if (au.onset > 0.75 && this.events.length < 24) {
      this.events.push({ type: 'storm', sp: SPARK, note: 2, x: WORLD_W / 2, y: WORLD_H / 2, power: au.onset });
    }
  }

  insideShelter(x: number, y: number): boolean {
    for (const s of this.shelters) {
      const dx = x - s.x, dy = y - s.y;
      if (dx * dx + dy * dy < s.r * s.r) return true;
    }
    return false;
  }

  log(kind: JournalEntry['kind'], text: string): void {
    this.journal.push({ t: this.time, kind, text });
    if (this.journal.length > JOURNAL_MAX) this.journal.splice(0, this.journal.length - JOURNAL_MAX);
  }

  drainEvents(): SimEvent[] {
    if (!this.events.length) return this.events;
    const e = this.events;
    this.events = [];
    return e;
  }

  snapshot(): WorldSnapshot {
    return {
      version: SAVE_VERSION,
      seedText: this.seedText,
      seedNum: this.seedNum,
      rngState: this.rng.state,
      time: this.time,
      nextId: this.nextId,
      intervention: this.intervention,
      creatures: this.creatures.map((c) => ({ ...c, genes: { ...c.genes } })),
      motes: this.motes.map((m) => ({ ...m })),
      foods: this.foods.map((f) => ({ ...f })),
      shelters: this.shelters.map((s) => ({ ...s })),
      flows: this.flows.map((f) => ({ ...f })),
      env: { activity: this.activity, silence: this.silenceTimer, calm: this.calm },
      audio: { ...this.audio },
      birthBudget: this.birthBudget,
      stats: { births: [...this.births], deaths: [...this.deaths], notes: [...this.notes], maxGen: [...this.maxGen], actions: this.actions, sporeTimer: [...this.sporeTimer], firstBirthLogged: [...this.firstBirthLogged], extinctLogged: [...this.extinctLogged] },
      journal: this.journal.map((j) => ({ ...j })),
    };
  }

  static restore(s: WorldSnapshot): World {
    if (!s || typeof s !== 'object') throw new Error('Порожній файл збереження');
    if (s.version !== SAVE_VERSION) throw new Error(`Невідома версія збереження: ${String((s as { version?: unknown }).version)} (потрібна ${SAVE_VERSION})`);
    if (!Array.isArray(s.creatures) || s.creatures.length > MAX_CREATURES + 50) throw new Error('Пошкоджені дані істот');
    const w = new World(s.seedText || 'ECO', s.intervention || 'none');
    w.seedNum = s.seedNum >>> 0;
    w.rng = new Rng(1);
    w.rng.state = s.rngState >>> 0;
    w.time = num(s.time); w.nextId = num(s.nextId) || 1;
    w.creatures = s.creatures.map((c) => ({ ...c, genes: { ...c.genes } }));
    w.motes = s.motes.map((m) => ({ ...m }));
    w.foods = (s.foods || []).map((f) => ({ ...f }));
    w.shelters = (s.shelters || []).map((sh) => ({ ...sh }));
    w.flows = (s.flows || []).map((f) => ({ ...f }));
    w.activity = num(s.env.activity); w.silenceTimer = num(s.env.silence); w.calm = !!s.env.calm;
    if (s.audio) w.audio = { energy: num(s.audio.energy), low: num(s.audio.low), mid: num(s.audio.mid), high: num(s.audio.high), onset: num(s.audio.onset) };
    w.births = [...s.stats.births]; w.deaths = [...s.stats.deaths]; w.notes = [...s.stats.notes];
    w.maxGen = [...s.stats.maxGen]; w.actions = num(s.stats.actions);
    if (s.stats.sporeTimer) w.sporeTimer = [...s.stats.sporeTimer];
    if (s.stats.firstBirthLogged) w.firstBirthLogged = [...s.stats.firstBirthLogged];
    if (s.stats.extinctLogged) w.extinctLogged = [...s.stats.extinctLogged];
    if (typeof s.birthBudget === 'number' && Number.isFinite(s.birthBudget)) w.birthBudget = Math.min(3, Math.max(0, s.birthBudget));
    w.journal = (s.journal || []).map((j) => ({ ...j }));
    w.grid = new SpatialGrid(WORLD_W, WORLD_H, GRID_CELL, MAX_CREATURES + 8);
    return w;
  }

  clone(): World {
    return World.restore(this.snapshot());
  }
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}
function spName(sp: Species): string {
  return sp === ROOT ? 'Кореневики' : sp === FLY ? 'Світляки' : 'Іскри';
}

// Генерування короткого «Насіння світу»: ECO-XXXXXX-A (base36 насіння + індекс пропорцій)
export function encodeSeed(seedNum: number, aspectIdx: number): string {
  const s = seedNum.toString(36).toUpperCase().padStart(7, '0').slice(-6);
  return `ECO-${s}-${aspectIdx.toString(36).toUpperCase()}`;
}
export function decodeSeed(code: string): { seedText: string } | null {
  const m = /^ECO-([0-9A-Z]{6})-([0-9A-Z])$/i.exec(code.trim());
  if (!m) return null;
  return { seedText: 'seed-' + m[1].toLowerCase() + '-' + m[2].toLowerCase() };
}
export function randomSeedText(rng?: { next(): number }): string {
  const r = rng ? () => rng.next() : Math.random;
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = 'світ-';
  for (let i = 0; i < 5; i++) s += abc[Math.floor(r() * abc.length)];
  return s;
}
