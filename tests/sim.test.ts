import { describe, expect, it } from 'vitest';
import { MAX_CREATURES } from '../src/sim/constants';
import { Rng } from '../src/sim/rng';
import { SILENT } from '../src/sim/types';
import { World } from '../src/sim/world';

function stepMany(w: World, n: number): void {
  for (let i = 0; i < n; i++) {
    w.setAudio({ energy: 0.4, low: 0.5, mid: 0.4, high: 0.3, onset: i % 30 === 0 ? 0.9 : 0 });
    w.step();
    w.drainEvents();
  }
}

describe('енергія та координати коректні', () => {
  it('інваріанти після 600 кроків', () => {
    const w = new World('test-invariants');
    stepMany(w, 600);
    for (const c of w.creatures) {
      expect(Number.isFinite(c.x)).toBe(true);
      expect(Number.isFinite(c.y)).toBe(true);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(1000);
      expect(c.y).toBeLessThanOrEqual(625);
      expect(Number.isFinite(c.energy)).toBe(true);
      expect(c.energy).toBeGreaterThanOrEqual(-50);
      expect(c.energy).toBeLessThanOrEqual(400);
    }
  });
});

describe('популяція обмежена', () => {
  it('не перевищує жорстку межу навіть з надлишком їжі', () => {
    const w = new World('test-cap');
    for (let i = 0; i < 200; i++) {
      w.setAudio({ energy: 1, low: 1, mid: 1, high: 1, onset: 1 });
      w.applyTool({ kind: 'food', x: 500, y: 300 });
      w.step();
      w.drainEvents();
      expect(w.creatures.length).toBeLessThanOrEqual(MAX_CREATURES);
    }
  });
});

describe('тиша не вбиває світ миттєво', () => {
  it('після 20 секунд тиші світ живий', () => {
    const w = new World('test-silence');
    stepMany(w, 100);
    for (let i = 0; i < 600; i++) {
      w.setAudio(SILENT);
      w.step();
      w.drainEvents();
    }
    expect(w.creatures.length).toBeGreaterThan(0);
  });
});

describe('детермінізм', () => {
  it('однакове насіння й дії дають однаковий результат', () => {
    const run = (): string => {
      const w = new World('test-determinism');
      const rng = new Rng(7);
      for (let i = 0; i < 300; i++) {
        w.setAudio({ energy: 0.3 + (i % 10) / 30, low: 0.5, mid: 0.4, high: 0.2, onset: i % 25 === 0 ? 1 : 0 });
        if (i === 50) w.applyTool({ kind: 'food', x: 200 + rng.next() * 100, y: 200 });
        if (i === 120) w.applyTool({ kind: 'current', x: 500, y: 300, dx: 100, dy: 40 });
        w.step();
        w.drainEvents();
      }
      return JSON.stringify(w.snapshot().creatures.map((c) => [c.sp, Math.round(c.x * 100), Math.round(c.y * 100), Math.round(c.energy * 100), c.gen]));
    };
    expect(run()).toBe(run());
  });
});

describe('збереження та відновлення', () => {
  it('restore дає ідентичний стан', () => {
    const w = new World('test-save');
    stepMany(w, 200);
    const snap = w.snapshot();
    const w2 = World.restore(JSON.parse(JSON.stringify(snap)) as ReturnType<World['snapshot']>);
    expect(w2.creatures.length).toBe(w.creatures.length);
    expect(w2.time).toBeCloseTo(w.time, 9);
    expect(w2.rng.state).toBe(w.rng.state);
    // подальші кроки збігаються
    for (let i = 0; i < 60; i++) {
      w.setAudio(SILENT); w2.setAudio(SILENT);
      w.step(); w2.step();
      w.drainEvents(); w2.drainEvents();
    }
    expect(w2.creatures.length).toBe(w.creatures.length);
  });

  it('відхиляє невірну версію', () => {
    const w = new World('test-save-bad');
    const snap = w.snapshot() as unknown as Record<string, unknown>;
    snap.version = 999;
    expect(() => World.restore(snap as unknown as Parameters<typeof World.restore>[0])).toThrow();
  });
});

describe('дві копії незалежні', () => {
  it('дії в одній копії не змінюють іншу', () => {
    const a = new World('test-clone');
    stepMany(a, 50);
    const b = a.clone();
    const before = JSON.stringify(b.snapshot().creatures.map((c) => c.energy));
    for (let i = 0; i < 100; i++) {
      a.setAudio({ energy: 1, low: 1, mid: 1, high: 1, onset: 0 });
      b.setAudio(SILENT);
      a.applyTool({ kind: 'food', x: 100, y: 100 });
      a.step(); b.step();
      a.drainEvents(); b.drainEvents();
    }
    const after = JSON.stringify(b.snapshot().creatures.map((c) => c.energy));
    // Б не отримувала їжі й жила в тиші — її стан не дорівнює стану А
    const aState = JSON.stringify(a.snapshot().creatures.map((c) => c.energy));
    expect(aState).not.toBe(after);
    void before;
  });
});

describe('темп зростання помірний', () => {
  it('за хвилину помірного звуку популяція не впирається в межу', () => {
    const w = new World('test-pace');
    for (let i = 0; i < 1800; i++) {
      w.setAudio({ energy: 0.5, low: 0.5, mid: 0.45, high: 0.35, onset: i % 40 === 0 ? 0.8 : 0 });
      w.step();
      w.drainEvents();
    }
    expect(w.creatures.length).toBeGreaterThan(40);
    expect(w.creatures.length).toBeLessThan(220);
    expect(w.births[0] + w.births[1] + w.births[2]).toBeGreaterThan(0);
  });
});

describe('інструменти змінюють симуляцію', () => {
  it('їжа, притулок і течія створюють об’єкти', () => {
    const w = new World('test-tools');
    w.applyTool({ kind: 'food', x: 100, y: 100 });
    w.applyTool({ kind: 'shelter', x: 200, y: 200 });
    w.applyTool({ kind: 'current', x: 300, y: 300, dx: 50, dy: 0 });
    expect(w.foods.length).toBe(1);
    expect(w.shelters.length).toBe(1);
    expect(w.flows.length).toBe(1);
  });
});
