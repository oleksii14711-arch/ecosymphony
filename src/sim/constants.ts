import type { Genes } from './types';

export const SIM_DT = 1 / 30;
export const MAX_CREATURES = 300;
export const SPECIES_CAP = [80, 130, 110];
export const MAX_MOTES = 220;
export const MAX_FOOD = 12;
export const MAX_SHELTERS = 6;
export const WORLD_AREA = 1600 * 1000;
export const CELL = 80;
export const GRID_CELL = 64;
export const FLOW_MAX = 170;
export const JOURNAL_MAX = 120;

/** Співвідношення сторін світу (ширина/висота), що кодуються у насінні */
export const ASPECTS = [0.46, 0.56, 0.75, 1.0, 1.33, 1.6, 1.78, 2.1];

export function nearestAspectIndex(aspect: number): number {
  let best = 0;
  for (let i = 1; i < ASPECTS.length; i++) {
    if (Math.abs(Math.log(ASPECTS[i] / aspect)) < Math.abs(Math.log(ASPECTS[best] / aspect))) best = i;
  }
  return best;
}

export interface GeneRange {
  min: number;
  max: number;
}

export type GeneRanges = Record<keyof Genes, GeneRange>;

export const GENE_RANGES: GeneRanges[] = [
  // Кореневики
  {
    speed: { min: 4, max: 24 },
    sense: { min: 40, max: 130 },
    hue: { min: 14, max: 52 },
    note: { min: 0, max: 4 },
    size: { min: 0.7, max: 1.6 },
  },
  // Світляки
  {
    speed: { min: 30, max: 125 },
    sense: { min: 60, max: 190 },
    hue: { min: 135, max: 195 },
    note: { min: 0, max: 9 },
    size: { min: 0.6, max: 1.35 },
  },
  // Іскри
  {
    speed: { min: 80, max: 250 },
    sense: { min: 40, max: 140 },
    hue: { min: 275, max: 335 },
    note: { min: 0, max: 5 },
    size: { min: 0.5, max: 1.15 },
  },
];

export const MAX_AGE = [
  { min: 130, max: 210 },
  { min: 70, max: 115 },
  { min: 38, max: 62 },
];

export const INITIAL_COUNTS = [16, 24, 14];
