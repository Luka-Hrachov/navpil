// Клієнтські хелпери: виклики бекенд-API ("@/app/api/*", їх реалізує інший агент
// за контрактом - див. "@/lib/api-types") + реальний голосовий ввід через Web Speech API.
// Тут НЕ робиться жодних прямих викликів моделі - тільки fetch на власні /api/* маршрути.

import type {
  ParseRequest,
  ParseResponse,
  RecognizeRequest,
  RecognizeResponse,
} from "@/lib/api-types";
import type { Person, Receipt } from "@/lib/split";

/* --------------------------------- фото -> base64 --------------------------------- */

/** Читає файл через FileReader і повертає base64 БЕЗ префікса "data:...;base64,". */
export function fileToBase64(file: File): Promise<{ imageBase64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Не вдалося прочитати файл зображення"));
        return;
      }
      const commaIdx = result.indexOf(",");
      const imageBase64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
      resolve({ imageBase64, mimeType: file.type || "image/jpeg" });
    };
    reader.onerror = () => reject(reader.error ?? new Error("Помилка читання файлу"));
    reader.readAsDataURL(file);
  });
}

/* --------------------------------- виклики API --------------------------------- */

async function postJson<TResponse>(url: string, body: unknown): Promise<TResponse> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`Немає з'єднання з ${url}`);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: string };
      detail = j?.error ? `: ${j.error}` : "";
    } catch {
      // ignore - тіло могло бути не-JSON
    }
    throw new Error(`Запит ${url} не вдався (${res.status})${detail}`);
  }
  return (await res.json()) as TResponse;
}

/** POST /api/recognize - розпізнати чек із фото. */
export function callRecognize(imageBase64: string, mimeType: string): Promise<RecognizeResponse> {
  const body: RecognizeRequest = { imageBase64, mimeType };
  return postJson<RecognizeResponse>("/api/recognize", body);
}

/** POST /api/parse - розібрати голосовий транскрипт у призначення одиниць. */
export function callParse(
  transcript: string,
  receipt: Receipt,
  people: Person[]
): Promise<ParseResponse> {
  const body: ParseRequest = { transcript, receipt, people };
  return postJson<ParseResponse>("/api/parse", body);
}

/* --------------------------------- голосовий ввід (Web Speech API) --------------------------------- */

/**
 * Мінімальні декларації Web Speech API - офіційних типів у lib.dom.d.ts немає,
 * а глобальний .d.ts тут навмисно не створюємо (щоб не конфліктувати з іншим агентом).
 */
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { readonly transcript: string };
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

export interface DictationHandle {
  /** Зупинити диктовку вручну (наприклад, повторний тап на мікрофон). */
  stop: () => void;
}

/**
 * Запускає розпізнавання мовлення (uk-UA, interim results).
 * - onResult(text, isFinal) викликається на кожен проміжний і фінальний фрагмент.
 * - onEnd(finalText) - коли розпізнавання завершилось (природно або через stop()).
 * - onError(reason) - помилка розпізнавання (наприклад, "not-allowed", "no-speech").
 *
 * Повертає null, якщо Web Speech API недоступний у цьому браузері - UI має
 * впасти на запасний мок-транскрипт замість реального голосу.
 */
export function startDictation(
  onResult: (transcript: string, isFinal: boolean) => void,
  onEnd: (finalTranscript: string) => void,
  onError: (reason: string) => void
): DictationHandle | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Ctor) return null;

  let recognition: SpeechRecognitionLike;
  try {
    recognition = new Ctor();
  } catch {
    return null;
  }

  recognition.lang = "uk-UA";
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;

  let finalTranscript = "";
  let stoppedManually = false;

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const item = event.results[i];
      const text = item?.[0]?.transcript ?? "";
      if (item?.isFinal) {
        finalTranscript += text;
      } else {
        interim += text;
      }
    }
    onResult((finalTranscript + interim).trim(), interim.length === 0);
  };

  recognition.onerror = (event) => {
    // "no-speech" / "aborted" при ручній зупинці - не показуємо як помилку користувачу тут,
    // рішення про UI-реакцію лишаємо викликаючому коду через onError.
    if (stoppedManually && (event.error === "aborted" || event.error === "no-speech")) return;
    onError(event.error || "unknown");
  };

  recognition.onend = () => {
    onEnd(finalTranscript.trim());
  };

  try {
    recognition.start();
  } catch {
    return null;
  }

  return {
    stop: () => {
      stoppedManually = true;
      try {
        recognition.stop();
      } catch {
        // ignore
      }
    },
  };
}
