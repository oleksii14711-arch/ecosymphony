import type { SimEvent, Species } from '../sim/types';

/**
 * Музичний рушій: процедурний синтез, пентатоніка, ритмічна сітка.
 * Жоден внутрішній звук НЕ повертається в аналізатор входу:
 * музика йде в master, а вхідний analyser слухає лише мікрофон/файл/демо-генератор.
 */
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const BASE = 110; // A2

export function noteFreq(degree: number, octaveShift = 0): number {
  const d = ((degree % PENTA.length) + PENTA.length) % PENTA.length;
  const oct = Math.floor(degree / PENTA.length);
  const semi = PENTA[d] + (oct + octaveShift) * 12;
  return BASE * Math.pow(2, semi / 12);
}

export class MusicEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  muted = false;
  volume = 0.6;
  private voices = 0;
  private lastPlay: number[] = [0, 0, 0];
  private gridNext = 0;
  bpm = 92;
  enabled = false;

  ensure(): AudioContext {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -18;
      this.comp.knee.value = 18;
      this.comp.ratio.value = 8;
      this.comp.attack.value = 0.004;
      this.comp.release.value = 0.24;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume * 0.5;
      this.master.connect(this.comp);
      this.comp.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.9;
      this.musicBus.connect(this.master);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  get sampleRate(): number {
    return this.ctx ? this.ctx.sampleRate : 44100;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : v * 0.5, this.ctx.currentTime, 0.05);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume * 0.5, this.ctx.currentTime, 0.03);
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Події світу → звук. Викликати раз на кадр з подіями лише СВІТУ, ЯКИЙ ЧУТИ. */
  handle(events: SimEvent[]): void {
    if (!this.enabled || !this.ctx || !this.musicBus || this.muted) return;
    if (this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const sixteenth = 60 / this.bpm / 4;
    if (this.gridNext < now) this.gridNext = now;
    for (const e of events) {
      if (this.voices > 14) break;
      const minGap = e.sp === 2 ? 0.09 : e.sp === 1 ? 0.22 : 0.5;
      const key = e.sp;
      const t = Math.max(now + 0.02, this.gridNext);
      if (t - this.lastPlay[key] < minGap) continue;
      this.lastPlay[key] = t;
      this.gridNext = t + sixteenth * 0.5;
      this.play(e, t);
    }
    // Затухання лічильника голосів — груба оцінка
    this.voices = Math.max(0, this.voices - events.length);
  }

  private play(e: SimEvent, t: number): void {
    if (!this.ctx || !this.musicBus) return;
    const sp: Species = e.sp;
    if (sp === 0) this.bass(e.note, t, e.power);
    else if (sp === 1) this.pluck(e.note, t, e.power);
    else this.perc(e, t);
  }

  private bass(degree: number, t: number, power: number): void {
    const ctx = this.ctx as AudioContext;
    const bus = this.musicBus as GainNode;
    const f = noteFreq(degree, -1);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = f * 2;
    const g = ctx.createGain();
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;
    const peak = 0.11 + power * 0.1;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.09);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 1.1);
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(bus);
    o.start(t); o2.start(t);
    o.stop(t + 1.25); o2.stop(t + 1.25);
    this.voices += 1;
  }

  private pluck(degree: number, t: number, power: number): void {
    const ctx = this.ctx as AudioContext;
    const bus = this.musicBus as GainNode;
    const f = noteFreq(degree, 1);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = ctx.createGain();
    const peak = 0.07 + power * 0.08;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.9);
    // легке вібрато
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const lg = ctx.createGain();
    lg.gain.value = f * 0.006;
    lfo.connect(lg); lg.connect(o.frequency);
    o.connect(g); g.connect(bus);
    o.start(t); lfo.start(t);
    o.stop(t + 1); lfo.stop(t + 1);
    this.voices += 1;
  }

  private perc(e: SimEvent, t: number): void {
    const ctx = this.ctx as AudioContext;
    const bus = this.musicBus as GainNode;
    if (e.type === 'storm' || e.type === 'hit' || e.type === 'tick') {
      // шумовий клац + високий пінг
      const len = Math.floor(ctx.sampleRate * 0.12);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 3800;
      const g = ctx.createGain();
      const peak = 0.05 + e.power * 0.07;
      g.gain.setValueAtTime(peak, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.14);
      src.connect(hp); hp.connect(g); g.connect(bus);
      src.start(t);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = noteFreq(e.note, 2) * 2;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(peak * 0.7, t);
      g2.gain.exponentialRampToValueAtTime(0.0008, t + 0.22);
      o.connect(g2); g2.connect(bus);
      o.start(t); o.stop(t + 0.25);
      this.voices += 1;
    } else {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(noteFreq(e.note, 2), t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06 + e.power * 0.05, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.4);
      o.connect(g); g.connect(bus);
      o.start(t); o.stop(t + 0.45);
      this.voices += 1;
    }
  }
}
