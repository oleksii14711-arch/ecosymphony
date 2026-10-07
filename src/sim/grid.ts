import type { Creature } from './types';

/** Просторова сітка зі зв'язними списками в типізованих масивах — без алокацій на кожному кроці. */
export class SpatialGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cell: number;
  private head: Int32Array;
  private next: Int32Array;
  private items: Creature[] = [];

  constructor(w: number, h: number, cell: number, capacity: number) {
    this.cell = cell;
    this.cols = Math.max(1, Math.ceil(w / cell));
    this.rows = Math.max(1, Math.ceil(h / cell));
    this.head = new Int32Array(this.cols * this.rows);
    this.next = new Int32Array(capacity);
  }

  rebuild(list: Creature[]): void {
    this.head.fill(-1);
    if (this.next.length < list.length) this.next = new Int32Array(list.length * 2);
    this.items = list;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const idx = this.cellIndex(c.x, c.y);
      this.next[i] = this.head[idx];
      this.head[idx] = i;
    }
  }

  cellIndex(x: number, y: number): number {
    let cx = Math.floor(x / this.cell);
    let cy = Math.floor(y / this.cell);
    if (cx < 0) cx = 0;
    else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  /** Викликає fn для кожної істоти в радіусі r. Якщо fn повертає true — пошук зупиняється. */
  query(x: number, y: number, r: number, fn: (c: Creature, d2: number) => boolean | void): void {
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor((x - r) / this.cell));
    const x1 = Math.min(this.cols - 1, Math.floor((x + r) / this.cell));
    const y0 = Math.max(0, Math.floor((y - r) / this.cell));
    const y1 = Math.min(this.rows - 1, Math.floor((y + r) / this.cell));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        let i = this.head[cy * this.cols + cx];
        let guard = this.items.length + 8;
        while (i !== -1 && guard-- > 0) {
          if (i < 0 || i >= this.items.length) break;
          const c = this.items[i];
          if (!c) break;
          const dx = c.x - x;
          const dy = c.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2 && fn(c, d2) === true) return;
          i = this.next[i];
        }
      }
    }
  }
}
