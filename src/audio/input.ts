/**
 * Джерела зовнішнього звуку: мікрофон / файл / програмна демонстрація.
 * Важливо: внутрішня музика світу (MusicEngine) сюди НЕ підключається.
 */
export type InputKind = 'none' | 'demo' | 'mic' | 'file';

export class SoundInput {
  kind: InputKind = 'none';
  analyser: AnalyserNode | null = null;
  private ctx: AudioContext | null = null;
  private srcNodes: AudioNode[] = [];
  private stream: MediaStream | null = null;
  private demoTimer = 0;
  private demoNodes: OscillatorNode[] = [];
  fileName = '';
  status = '';

  constructor(private onStatus: (s: string) => void = () => undefined) {}

  ensureCtx(musicCtx: AudioContext | null): AudioContext {
    if (this.ctx) return this.ctx;
    if (musicCtx) { this.ctx = musicCtx; return this.ctx; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    return this.ctx;
  }

  setCtx(ctx: AudioContext): void {
    this.ctx = ctx;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  stopAll(): void {
    for (const n of this.srcNodes) {
      try { (n as OscillatorNode).stop?.(); } catch { /* noop */ }
      try { n.disconnect(); } catch { /* noop */ }
    }
    this.srcNodes = [];
    for (const o of this.demoNodes) {
      try { o.stop(); } catch { /* noop */ }
      try { o.disconnect(); } catch { /* noop */ }
    }
    this.demoNodes = [];
    if (this.demoTimer) { clearInterval(this.demoTimer); this.demoTimer = 0; }
    if (this.stream) { for (const t of this.stream.getTracks()) t.stop(); this.stream = null; }
    this.kind = 'none';
    this.analyser = null;
  }

  private makeAnalyser(): AnalyserNode {
    const ctx = this.ctx as AudioContext;
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0.72;
    this.analyser = an;
    return an;
  }

  setStatus(s: string): void {
    this.status = s;
    this.onStatus(s);
  }

  /** Програмна демонстрація: чутний луп, який АНАЛІЗУЄТЬСЯ тими ж FFT-засобами. */
  startDemo(ctx: AudioContext, audible: GainNode): void {
    this.stopAll();
    this.ctx = ctx;
    this.kind = 'demo';
    const an = this.makeAnalyser();
    // Ланцюг демо: бас + арпеджіо + шумові атаки → спліт: одна гілка в аналізатор, одна тиха в колонки
    const demoGain = ctx.createGain();
    demoGain.gain.value = 0.5;
    demoGain.connect(an);
    const toOut = ctx.createGain();
    toOut.gain.value = 0.35;
    demoGain.connect(toOut);
    toOut.connect(audible);
    this.srcNodes.push(demoGain, toOut);

    const bass = ctx.createOscillator();
    bass.type = 'sine'; bass.frequency.value = 55;
    const bassG = ctx.createGain(); bassG.gain.value = 0.5;
    bass.connect(bassG); bassG.connect(demoGain);
    bass.start();
    const bassLfo = ctx.createOscillator();
    bassLfo.frequency.value = 0.18;
    const bassLfoG = ctx.createGain(); bassLfoG.gain.value = 0.3;
    bassLfo.connect(bassLfoG); bassLfoG.connect(bassG.gain);
    bassLfo.start();
    this.demoNodes.push(bass, bassLfo);
    this.srcNodes.push(bassG, bassLfoG);

    const mid = ctx.createOscillator();
    mid.type = 'triangle';
    const midG = ctx.createGain(); midG.gain.value = 0.22;
    mid.connect(midG); midG.connect(demoGain);
    mid.start();
    this.demoNodes.push(mid);
    this.srcNodes.push(midG);
    const scale = [220, 261.6, 293.7, 329.6, 392, 440, 523.3];
    let step = 0;
    this.demoTimer = window.setInterval(() => {
      if (!this.ctx || this.kind !== 'demo') return;
      const t = this.ctx.currentTime;
      step++;
      mid.frequency.setTargetAtTime(scale[step % scale.length] as number, t, 0.05);
      // атака: короткий шумовий сплеск кожні 4 кроки
      if (step % 4 === 0) {
        const len = Math.floor(ctx.sampleRate * 0.08);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 3000;
        const g = ctx.createGain(); g.gain.value = 0.5;
        src.connect(hp); hp.connect(g); g.connect(demoGain);
        src.start();
      }
    }, 320);
    this.setStatus('Демонстрація звучить');
  }

  async startMic(ctx: AudioContext): Promise<void> {
    this.stopAll();
    this.ctx = ctx;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Браузер не підтримує мікрофон');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.stream = stream;
    const src = ctx.createMediaStreamSource(stream);
    const an = this.makeAnalyser();
    // Мікрофон → лише в аналізатор, НЕ в колонки (захист від свисту)
    src.connect(an);
    this.srcNodes.push(src);
    this.kind = 'mic';
    this.setStatus('Мікрофон слухає (звук колонок не повертається у вхід)');
  }

  async startFile(ctx: AudioContext, audible: GainNode, file: File): Promise<void> {
    this.stopAll();
    this.ctx = ctx;
    const extOk = /\.(mp3|wav|ogg|m4a|flac|webm)$/i.test(file.name) || file.type.startsWith('audio/');
    if (!extOk && file.type !== '') throw new Error(`Формат «${file.name}» не підтримується. Спробуйте MP3, WAV або OGG.`);
    const ab = await file.arrayBuffer();
    let buf: AudioBuffer;
    try {
      buf = await ctx.decodeAudioData(ab.slice(0));
    } catch {
      throw new Error(`Не вдалося прочитати «${file.name}». Спробуйте MP3, WAV або OGG.`);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const an = this.makeAnalyser();
    const g = ctx.createGain();
    g.gain.value = 0.8;
    src.connect(g); g.connect(an);
    an.connect(audible); // файл чути — це зовнішній звук, його аналіз чесний
    src.start();
    this.srcNodes.push(src, g);
    this.kind = 'file';
    this.fileName = file.name;
    this.setStatus(`Грає файл: ${file.name}`);
  }
}
