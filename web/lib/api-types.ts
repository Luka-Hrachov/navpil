import type { Receipt, Person, UnitAssignment } from "@/lib/split";

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
}

export interface ParseResponse {
  people: Person[];
  assignments: UnitAssignment[];
  clarifications: Clarification[];
  source: "gemini" | "mock";
  error?: string;
}
