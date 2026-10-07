import { GENE_RANGES, MAX_AGE } from './constants';
import type { Rng } from './rng';
import type { Genes, Species } from './types';

export const GENE_KEYS: (keyof Genes)[] = ['speed', 'sense', 'hue', 'note', 'size'];

export function clampGene(sp: Species, key: keyof Genes, v: number): number {
  const r = GENE_RANGES[sp][key];
  const c = v < r.min ? r.min : v > r.max ? r.max : v;
  return key === 'note' ? Math.round(c) : c;
}

export function randomGenes(sp: Species, rng: Rng): Genes {
  const r = GENE_RANGES[sp];
  // Стартові ознаки — довкола середини діапазону, щоб еволюції було куди рухатися
  const mid = (k: keyof Genes, spread: number) => {
    const g = r[k];
    const c = (g.min + g.max) / 2;
    return clampGene(sp, k, c + rng.soft() * (g.max - g.min) * spread);
  };
  return {
    speed: mid('speed', 0.22),
    sense: mid('sense', 0.22),
    hue: mid('hue', 0.35),
    note: clampGene(sp, 'note', r.note.min + rng.int(r.note.max - r.note.min + 1)),
    size: mid('size', 0.2),
  };
}

/** Нащадок отримує ознаки батька з невеликими мутаціями; зрідка — помітний стрибок. */
export function mutate(sp: Species, parent: Genes, rng: Rng): Genes {
  const r = GENE_RANGES[sp];
  const out = { ...parent };
  for (const k of GENE_KEYS) {
    if (k === 'note') {
      if (rng.chance(0.14)) out.note = clampGene(sp, 'note', parent.note + (rng.chance(0.5) ? 1 : -1));
      continue;
    }
    const span = r[k].max - r[k].min;
    const big = rng.chance(0.05);
    out[k] = clampGene(sp, k, parent[k] + rng.soft() * span * (big ? 0.22 : 0.06));
  }
  return out;
}

export function randomMaxAge(sp: Species, rng: Rng): number {
  const a = MAX_AGE[sp];
  return rng.range(a.min, a.max);
}
