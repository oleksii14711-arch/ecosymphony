import type { AudioFeatures } from '../sim/types';

/** Аналіз зовнішнього звуку: енергія, 3 смуги, детекція атак. Працює з мікрофона, файла або демо. */
export class AudioAnalyzer {
  private analyser: AnalyserNode | null = null;
  private freq: Uint8Array = new Uint8Array(0);
  private prev = new Float32Array(0);
  private smooth: AudioFeatures = { energy: 0, low: 0, mid: 0, high: 0, onset: 0 };
  micHot = 0;

  attach(analyser: AnalyserNode): void {
    this.analyser = analyser;
    const n = analyser.frequencyBinCount;
    this.freq = new Uint8Array(n);
    this.prev = new Float32Array(n);
  }

  detach(): void {
    this.analyser = null;
  }

  get live(): boolean {
    return !!this.analyser;
  }

  /** Викликати ~10–15 разів на секунду. Повертає згладжені ознаки 0..1. */
  read(): AudioFeatures {
    const an = this.analyser;
    if (!an) {
      // Без входу — повільне згасання до тиші
      const s = this.smooth;
      s.energy *= 0.95; s.low *= 0.95; s.mid *= 0.95; s.high *= 0.95; s.onset *= 0.9;
      return { ...s };
    }
    an.getByteFrequencyData(this.freq as Uint8Array<ArrayBuffer>);
    const n = this.freq.length;
    const sr = an.context.sampleRate;
    const binHz = sr / 2 / n;
    let low = 0, mid = 0, high = 0, total = 0, flux = 0, cntL = 0, cntM = 0, cntH = 0;
    for (let i = 1; i < n; i++) {
      const v = this.freq[i] / 255;
      const f = i * binHz;
      total += v;
      const p = this.prev[i];
      const d = v - p;
      if (d > 0) flux += d;
      this.prev[i] = v;
      if (f < 240) { low += v; cntL++; }
      else if (f < 2200) { mid += v; cntM++; }
      else if (f < 9000) { high += v; cntH++; }
    }
    const norm = (sum: number, cnt: number) => (cnt ? sum / cnt : 0);
    // Компресія динаміки: корінь, щоб гучний звук не «заливав» світ
    const comp = (v: number) => Math.min(1, Math.sqrt(Math.max(0, v) * 2.2));
    const energy = comp(total / n * 3);
    const l = comp(norm(low, cntL) * 1.6);
    const m = comp(norm(mid, cntM) * 1.5);
    const h = comp(norm(high, cntH) * 1.7);
    const onset = Math.min(1, flux / 14);
    const s = this.smooth;
    const k = 0.4;
    s.energy += (energy - s.energy) * k;
    s.low += (l - s.low) * k;
    s.mid += (m - s.mid) * k;
    s.high += (h - s.high) * k;
    s.onset += (onset - s.onset) * 0.6;
    // Захист від фідбеку колонок: якщо все зашкалює довго — тимчасово приглушуємо вплив
    if (energy > 0.95 && l > 0.9 && h > 0.9) this.micHot++;
    else this.micHot = Math.max(0, this.micHot - 1);
    const out = { ...s };
    if (this.micHot > 40) { out.energy *= 0.4; out.low *= 0.4; out.mid *= 0.4; out.high *= 0.4; out.onset *= 0.3; }
    return out;
  }

  reset(): void {
    this.smooth = { energy: 0, low: 0, mid: 0, high: 0, onset: 0 };
    this.micHot = 0;
    this.prev.fill(0);
  }
}

/** Чистий синтез ознак для тестів: перевірка аналізу без мікрофона. */
export function synthFeatures(t: number): AudioFeatures {
  const low = 0.5 + 0.5 * Math.sin(t * 0.9);
  const mid = 0.5 + 0.5 * Math.sin(t * 1.7 + 1.3);
  const high = 0.5 + 0.5 * Math.sin(t * 3.1 + 2.1);
  const beat = Math.pow(Math.max(0, Math.sin(t * 2.4)), 8);
  return { energy: (low + mid + high) / 3, low, mid, high, onset: beat };
}
