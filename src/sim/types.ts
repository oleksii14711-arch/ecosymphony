export const ROOT = 0;
export const FLY = 1;
export const SPARK = 2;
export type Species = 0 | 1 | 2;
export const SPECIES_LIST: Species[] = [ROOT, FLY, SPARK];

export const SPECIES_NAMES = ['Кореневики', 'Світляки', 'Іскри'] as const;
export const SPECIES_NAMES_GEN = ['кореневиків', 'світляків', 'іскор'] as const;

export interface Genes {
  /** Крейсерська швидкість, одиниць світу за секунду */
  speed: number;
  /** Радіус чутливості */
  sense: number;
  /** Відтінок кольору (градуси) */
  hue: number;
  /** Ступінь пентатоніки, яку істота «співає» */
  note: number;
  /** Розмір тіла: впливає на поглинання та витрати */
  size: number;
}

export interface Creature {
  id: number;
  sp: Species;
  x: number;
  y: number;
  /** Позиція на попередньому кроці — для плавної інтерполяції рендеру */
  px: number;
  py: number;
  vx: number;
  vy: number;
  heading: number;
  age: number;
  maxAge: number;
  energy: number;
  gen: number;
  parent: number;
  dormant: boolean;
  cooldown: number;
  actCooldown: number;
  song: number;
  genes: Genes;
}

export interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  e: number;
  life: number;
}

export interface FoodPatch {
  x: number;
  y: number;
  r: number;
  amount: number;
}

export interface Shelter {
  x: number;
  y: number;
  r: number;
  ttl: number;
  max: number;
}

/** Ознаки зовнішнього звуку в діапазоні 0..1 */
export interface AudioFeatures {
  energy: number;
  low: number;
  mid: number;
  high: number;
  onset: number;
}

export interface EnvState extends AudioFeatures {
  activity: number;
  silence: number;
  calm: boolean;
  stormCd: number;
}

export type Intervention = 'none' | 'food' | 'silence' | 'current';

export interface WorldStats {
  births: number[];
  deaths: number[];
  notes: number[];
  maxGen: number[];
  firstBirthLogged: boolean[];
  extinct: boolean[];
  sporeTimer: number[];
  actions: number;
}

export interface JournalEntry {
  t: number;
  kind: 'birth' | 'generation' | 'extinct' | 'return' | 'split' | 'info';
  text: string;
}

export type SimEventType = 'pulse' | 'eat' | 'pollinate' | 'hit' | 'tick' | 'birth' | 'death' | 'storm' | 'wake';

export interface SimEvent {
  type: SimEventType;
  sp: Species;
  note: number;
  x: number;
  y: number;
  power: number;
}

export type ToolAction =
  | { kind: 'food'; x: number; y: number }
  | { kind: 'shelter'; x: number; y: number }
  | { kind: 'current'; x: number; y: number; dx: number; dy: number };

export const SILENT: AudioFeatures = { energy: 0, low: 0, mid: 0, high: 0, onset: 0 };
