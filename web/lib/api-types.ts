import type { Receipt, Person, UnitAssignment } from "@/lib/split";
import type { TokenUsage } from "@/lib/cost";

/**
 * Метадані одного виклику Gemini: час і токени (з usageMetadata відповіді) +
 * оцінна вартість у USD (див. lib/cost.ts::costUsd). ОПЦІЙНЕ поле на
 * відповідях API - додане пізніше, щоб не ламати наявних споживачів
 * (напр. app/app-flow.tsx), і відсутнє на "mock"-відповідях без реального
 * виклику моделі.
 */
export interface CallMeta {
  ms: number;
  tokens: TokenUsage;
  costUsd: number;
}

export interface ItemMeta {
  id: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  confidence: number;
}

export interface RecognizeRequest {
  imageBase64: string;
  mimeType: string;
}

export interface RecognizeResponse {
  receipt: Receipt;
  itemsMeta: ItemMeta[];
  source: "gemini" | "mock";
  error?: string;
  /** Час/токени/вартість цього виклику Gemini. Відсутнє на mock-відповідях. */
  meta?: CallMeta;
}

export interface Clarification {
  question: string;
  target: { itemId: string; unitIndex: number };
  options: string[]; // options = personId[]
}

export interface ParseRequest {
  transcript: string;
  receipt: Receipt;
  people: Person[];
  /** "correction" - репліка виправляє наявний розподіл (див. priorAssignments). */
  mode?: "initial" | "correction";
  /** Поточний розподіл (лише для mode="correction"): змінюємо ТІЛЬКИ згадане. */
  priorAssignments?: UnitAssignment[];
}

export interface ParseResponse {
  people: Person[];
  assignments: UnitAssignment[];
  clarifications: Clarification[];
  source: "gemini" | "mock";
  error?: string;
  /** Час/токени/вартість цього виклику Gemini. Відсутнє на mock-відповідях. */
  meta?: CallMeta;
}
