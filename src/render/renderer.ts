import { WORLD_H, WORLD_W, type World } from '../sim/world';

/** Canvas 2D-рендер: біолюмінесцентний сад під склом. Адаптивна якість + екорежим. */
export class Renderer {
  eco = false;
  private flashes: { x: number; y: number; r: number; a: number; hue: number }[] = [];
  private t = 0;
  fps = 60;
  private lastFpsT = 0;
  private autoDrop = 0;

  constructor(private canvas: HTMLCanvasElement) {}

  setEco(v: boolean): void {
    this.eco = v;
  }

  resize(cssW: number, cssH: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, this.eco ? 1 : 1.5);
    this.canvas.width = Math.max(2, Math.floor(cssW * dpr));
    this.canvas.height = Math.max(2, Math.floor(cssH * dpr));
  }

  flash(x: number, y: number, hue: number, big = false): void {
    if (this.eco && this.flashes.length > 12) return;
    if (this.flashes.length > 40) return;
    this.flashes.push({ x, y, r: big ? 8 : 4, a: 0.8, hue });
  }

  draw(w: World, now: number, quality: number): void {
    const cv = this.canvas;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    this.t = now / 1000;
    // fps для адаптиву
    if (this.lastFpsT) {
      const dt = now - this.lastFpsT;
      if (dt > 0) {
        this.fps += (1000 / dt - this.fps) * 0.05;
        if (this.fps < 28 && this.autoDrop < 3) { this.autoDrop++; }
        else if (this.fps > 50 && this.autoDrop > 0) { this.autoDrop--; }
      }
    }
    this.lastFpsT = now;
    const drop = this.eco ? 2 : this.autoDrop;
    const W = cv.width, H = cv.height;
    const s = Math.min(W / WORLD_W, H / WORLD_H);
    const ox = (W - WORLD_W * s) / 2, oy = (H - WORLD_H * s) / 2;
    void quality;

    // тло
    const bg = ctx.createRadialGradient(W / 2, H * 0.42, 10, W / 2, H / 2, Math.max(W, H) * 0.75);
    bg.addColorStop(0, '#0b1a2e');
    bg.addColorStop(0.5, '#060d1c');
    bg.addColorStop(1, '#02040a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // «скло»: тонка рамка світу
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);

    // далеке світіння
    if (drop < 2) {
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 5; i++) {
        const gx = WORLD_W * (0.15 + i * 0.18);
        const gy = WORLD_H * (0.3 + 0.4 * Math.abs(Math.sin(this.t * 0.1 + i * 2)));
        const g = ctx.createRadialGradient(gx, gy, 4, gx, gy, 210);
        g.addColorStop(0, 'rgba(40,120,160,0.10)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(gx - 220, gy - 220, 440, 440);
      }
      ctx.globalAlpha = 1;
    }

    // плями їжі
    for (const f of w.foods) {
      const a = Math.min(0.5, 0.16 + f.amount / 200);
      const g = ctx.createRadialGradient(f.x, f.y, 4, f.x, f.y, f.r);
      g.addColorStop(0, `rgba(150,255,170,${a})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill();
    }

    // притулки
    for (const sh of w.shelters) {
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 2.4);
      ctx.strokeStyle = `rgba(120,230,255,${0.35 + pulse * 0.25})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.arc(sh.x, sh.y, sh.r, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(120,230,255,0.05)';
      ctx.beginPath(); ctx.arc(sh.x, sh.y, sh.r, 0, 7); ctx.fill();
    }

    // течії
    for (const f of w.flows) {
      const a = Math.max(0, f.ttl / f.max);
      ctx.strokeStyle = `rgba(140,200,255,${0.5 * a})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(f.x - f.dx * 0.45, f.y - f.dy * 0.45);
      ctx.lineTo(f.x + f.dx * 0.45, f.y + f.dy * 0.45);
      ctx.stroke();
      // стрілка
      const ang = Math.atan2(f.dy, f.dx);
      ctx.beginPath();
      ctx.moveTo(f.x + f.dx * 0.45, f.y + f.dy * 0.45);
      ctx.lineTo(f.x + f.dx * 0.45 - Math.cos(ang - 0.4) * 16, f.y + f.dy * 0.45 - Math.sin(ang - 0.4) * 16);
      ctx.moveTo(f.x + f.dx * 0.45, f.y + f.dy * 0.45);
      ctx.lineTo(f.x + f.dx * 0.45 - Math.cos(ang + 0.4) * 16, f.y + f.dy * 0.45 - Math.sin(ang + 0.4) * 16);
      ctx.stroke();
    }

    // мотів — енергетичний пил
    ctx.fillStyle = 'rgba(200,255,220,0.5)';
    const moteStep = drop >= 2 ? 2 : 1;
    for (let i = 0; i < w.motes.length; i += moteStep) {
      const m = w.motes[i];
      if (!m) continue;
      ctx.globalAlpha = Math.min(0.7, 0.25 + m.e / 30);
      ctx.fillRect(m.x - 1.2, m.y - 1.2, 2.4, 2.4);
    }
    ctx.globalAlpha = 1;

    // істоти: інтерполяція між кроками для плавності
    const alpha = 1; // малюємо поточний стан (кроки часті)
    void alpha;
    for (const c of w.creatures) {
      const ix = c.x, iy = c.y;
      const eN = Math.min(1, c.energy / 120);
      if (c.sp === 0) {
        // Кореневики: повільна органічна бульба з корінцями
        const r = (9 + c.genes.size * 7) * (0.8 + eN * 0.4);
        const glow = ctx.createRadialGradient(ix, iy, 1, ix, iy, r * 2.4);
        glow.addColorStop(0, `hsla(${c.genes.hue},90%,62%,${0.5 + eN * 0.4})`);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(ix, iy, r * 2.4, 0, 7); ctx.fill();
        ctx.fillStyle = `hsl(${c.genes.hue},70%,48%)`;
        ctx.beginPath();
        const wob = Math.sin(this.t * 1.3 + c.id) * 1.5;
        ctx.ellipse(ix, iy, r, r * (0.72 + wob * 0.02), c.heading * 0.2, 0, 7);
        ctx.fill();
        // корінці
        ctx.strokeStyle = `hsla(${c.genes.hue},80%,60%,0.55)`;
        ctx.lineWidth = 1.4;
        for (let k = 0; k < 4; k++) {
          const a = c.heading + (k - 1.5) * 0.5 + Math.sin(this.t * 0.8 + c.id + k) * 0.15;
          ctx.beginPath();
          ctx.moveTo(ix, iy);
          ctx.quadraticCurveTo(ix + Math.cos(a) * r * 1.6, iy + Math.sin(a) * r * 1.6, ix + Math.cos(a) * r * 2.3, iy + Math.sin(a) * r * 2.3 + 4);
          ctx.stroke();
        }
        if (c.dormant) {
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.setLineDash([3, 4]);
          ctx.beginPath(); ctx.arc(ix, iy, r + 6, 0, 7); ctx.stroke();
          ctx.setLineDash([]);
        }
      } else if (c.sp === 1) {
        // Світляки: сяюче ядро + крила
        const r = 5 + c.genes.size * 4;
        const flap = Math.sin(this.t * 9 + c.id * 1.7);
        ctx.fillStyle = `hsla(${c.genes.hue},90%,70%,0.25)`;
        ctx.beginPath(); ctx.arc(ix, iy, r * 3, 0, 7); ctx.fill();
        ctx.fillStyle = `hsla(${c.genes.hue},95%,72%,${0.6 + eN * 0.4})`;
        ctx.beginPath(); ctx.arc(ix, iy, r, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.arc(ix - r * 0.25, iy - r * 0.25, r * 0.35, 0, 7); ctx.fill();
        ctx.fillStyle = `hsla(${c.genes.hue},80%,80%,0.5)`;
        const wa = c.heading;
        for (const side of [-1, 1]) {
          ctx.save();
          ctx.translate(ix, iy);
          ctx.rotate(wa + side * (0.7 + flap * 0.35));
          ctx.beginPath();
          ctx.ellipse(r * 1.2, 0, r * 1.1, r * 0.42, 0, 0, 7);
          ctx.fill();
          ctx.restore();
        }
        // слід
        if (drop < 2) {
          ctx.strokeStyle = `hsla(${c.genes.hue},90%,70%,0.35)`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(c.px, c.py);
          ctx.lineTo(ix, iy);
          ctx.stroke();
        }
      } else {
        // Іскри: гостра блискавка за швидкістю
        const vx = c.vx, vy = c.vy;
        const sp2 = Math.hypot(vx, vy);
        const ang = sp2 > 1 ? Math.atan2(vy, vx) : c.heading;
        const len = 10 + Math.min(26, sp2 * 0.09) + eN * 6;
        ctx.strokeStyle = `hsla(${c.genes.hue},95%,70%,${0.55 + eN * 0.4})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ix - Math.cos(ang) * len, iy - Math.sin(ang) * len);
        ctx.lineTo(ix, iy);
        ctx.lineTo(ix - Math.cos(ang + 0.5) * len * 0.5, iy - Math.sin(ang + 0.5) * len * 0.5);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(ix, iy, 2.4 + eN * 1.6, 0, 7); ctx.fill();
        ctx.fillStyle = `hsl(${c.genes.hue},95%,65%)`;
        ctx.beginPath(); ctx.arc(ix, iy, 4.5 + eN * 2, 0, 7); ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1;
      }
    }

    // спалахи подій
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      if (!f) continue;
      f.r += 1.6; f.a -= 0.03;
      if (f.a <= 0) { this.flashes.splice(i, 1); continue; }
      ctx.strokeStyle = `hsla(${f.hue},90%,70%,${f.a})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.stroke();
    }

    ctx.restore();

    // віньєтка скла
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,10,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }
}
