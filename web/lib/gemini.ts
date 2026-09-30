// Обгортка над Gemini REST API (generativelanguage.googleapis.com).
// УВАГА: цей файл лише ОПИСУЄ виклики. Жоден виклик тут не виконується сам по
// собі — fetch спрацює тільки в рантаймі, коли ці функції реально викличе
// route-хендлер (app/api/recognize, app/api/parse) під час обробки запиту.
//
// Модель НІЧОГО не рахує (жодних сум, часток, відсотків) — вона лише читає
// чек або розбирає голосову репліку в структуровані призначення. Підрахунок
// робить детермінований код у lib/split.ts.

import type { Item, Person, Receipt, UnitAssignment } from "@/lib/split";
import type {
  Clarification,
  ItemMeta,
  ParseRequest,
  ParseResponse,
  RecognizeRequest,
  RecognizeResponse,
} from "@/lib/api-types";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/* --------------------------------- низькорівневий виклик --------------------------------- */

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiContent {
  role: "user" | "model" | "system";
  parts: GeminiPart[];
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

/** Мінімальне підмножина OpenAPI-схеми, яку розуміє Gemini responseSchema. */
type GeminiSchema = {
  type: "OBJECT" | "ARRAY" | "STRING" | "NUMBER" | "INTEGER" | "BOOLEAN";
  properties?: Record<string, GeminiSchema>;
  items?: GeminiSchema;
  required?: string[];
  description?: string;
};

async function callGemini(params: {
  systemInstruction: string;
  contents: GeminiContent[];
  responseSchema: GeminiSchema;
}): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // route-хендлери самі перевіряють наявність ключа й ідуть у мок раніше,
    // ніж дійти сюди — це остання лінія оборони, якщо функцію викликали напряму.
    throw new Error("GEMINI_API_KEY не задано в оточенні.");
  }

  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: params.contents,
      systemInstruction: { role: "system", parts: [{ text: params.systemInstruction }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: params.responseSchema,
        temperature: 0,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API помилка ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = (await res.json()) as GeminiGenerateContentResponse;

  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini заблокував запит: ${data.promptFeedback.blockReason}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) {
    throw new Error("Gemini повернув порожню відповідь без тексту.");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Не вдалося розпарсити JSON-відповідь Gemini.");
  }
}

/* --------------------------------- recognizeReceipt --------------------------------- */

const RECOGNIZE_SYSTEM_PROMPT = `Ти розпізнаєш фото чека з ресторану або кафе (українською або іншою мовою, як на чеку).

Поверни СУВОРО JSON-об'єкт за наданою схемою. Без пояснень, без markdown, без тексту поза JSON.

Правила:
- Усі грошові суми — ЦІЛІ числа в КОПІЙКАХ (мінімальна грошова одиниця гривні), без float і без округлень "на око". Наприклад, 120,00 грн → 12000.
- Для кожної позиції чека:
  - id — короткий унікальний слаг ЛАТИНИЦЕЮ (напр. "borsch", "coffee", "pizza-margherita"), без пробілів;
  - name — назва позиції МОВОЮ ЧЕКА, як надруковано;
  - qty — кількість одиниць (ціле число, мінімум 1);
  - unitPriceCents — ціна ОДНІЄЇ одиниці товару в копійках (якщо на чеку вказана лише сума за рядок — подiли на qty і округли до цілого);
  - confidence — впевненість розпізнавання САМЕ ЦІЄЇ позиції, число від 0 до 1 (1 = абсолютно впевнений). Став нижче значення, якщо текст нечіткий, розмитий або сума не б'ється з підсумком.
- serviceChargeCents — сервісний збір/чайові, надруковані на чеку, в копійках. Якщо збору немає — 0.
- totalCents — підсумкова сума чека в копійках, як надруковано внизу чека.
- НІЧОГО не рахуй і не розподіляй між людьми — ти лише читаєш, що надруковано на чеку. Розподіл рахує окремий код.
- Якщо якесь число на фото нечітке — дай найкращу оцінку, але знизь confidence для цієї позиції.
- Відповідай ЛИШЕ JSON-об'єктом, що відповідає схемі нижче. Жодного тексту, коментарів чи markdown-огорожі поза JSON.`;

const RECOGNIZE_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "Короткий унікальний слаг латиницею" },
          name: { type: "STRING", description: "Назва позиції як на чеку" },
          qty: { type: "INTEGER", description: "Кількість одиниць, мінімум 1" },
          unitPriceCents: { type: "INTEGER", description: "Ціна однієї одиниці в копійках" },
          confidence: { type: "NUMBER", description: "Впевненість розпізнавання, 0..1" },
        },
        required: ["id", "name", "qty", "unitPriceCents", "confidence"],
      },
    },
    serviceChargeCents: { type: "INTEGER", description: "Сервісний збір у копійках, 0 якщо немає" },
    totalCents: { type: "INTEGER", description: "Підсумок чека в копійках" },
  },
  required: ["items", "serviceChargeCents", "totalCents"],
};

interface RecognizeGeminiItem {
  id: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  confidence: number;
}

interface RecognizeGeminiPayload {
  items: RecognizeGeminiItem[];
  serviceChargeCents: number;
  totalCents: number;
}

/**
 * Розпізнає фото чека через Gemini: витягує позиції (назва, кількість, ціна
 * за одиницю в копійках), сервісний збір, підсумок і confidence на позицію.
 * Модель НЕ рахує розподіл між людьми — лише читає чек.
 *
 * Мережевий виклик відбувається лише в момент реального виконання цієї
 * функції рантаймом (наприклад, з app/api/recognize/route.ts).
 */
export async function recognizeReceipt(req: RecognizeRequest): Promise<RecognizeResponse> {
  const raw = (await callGemini({
    systemInstruction: RECOGNIZE_SYSTEM_PROMPT,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: req.mimeType, data: req.imageBase64 } },
          { text: "Розпізнай цей чек і поверни JSON за схемою, вказаною в системній інструкції." },
        ],
      },
    ],
    responseSchema: RECOGNIZE_SCHEMA,
  })) as RecognizeGeminiPayload;

  if (!raw || !Array.isArray(raw.items)) {
    throw new Error("Gemini: відповідь не містить масив items.");
  }

  const items: Item[] = raw.items.map((it) => ({
    id: String(it.id),
    name: String(it.name),
    qty: Math.max(1, Math.round(Number(it.qty))),
    unitPriceCents: Math.max(0, Math.round(Number(it.unitPriceCents))),
  }));

  const itemsMeta: ItemMeta[] = raw.items.map((it) => ({
    id: String(it.id),
    name: String(it.name),
    qty: Math.max(1, Math.round(Number(it.qty))),
    unitPriceCents: Math.max(0, Math.round(Number(it.unitPriceCents))),
    confidence: Math.min(1, Math.max(0, Number(it.confidence))),
  }));

  const receipt: Receipt = {
    items,
    serviceChargeCents: Math.max(0, Math.round(Number(raw.serviceChargeCents ?? 0))),
    totalCents: Math.max(0, Math.round(Number(raw.totalCents ?? 0))),
  };

  return { receipt, itemsMeta, source: "gemini" };
}

/* --------------------------------- parseIntent --------------------------------- */

const PARSE_SYSTEM_PROMPT = `Ти розбираєш голосову репліку людини про те, хто що замовляв у ресторані чи кафе, і перетворюєш її на призначення ОДИНИЦЬ товару конкретним людям.

У USER-повідомленні тобі дадуть: транскрипт голосу, чек (JSON з позиціями: id, name, qty, unitPriceCents) і поточний список людей (JSON: id, name).

Поверни СУВОРО JSON-об'єкт за наданою схемою. Без пояснень, без markdown, без тексту поза JSON.

Правила:
- Для КОЖНОЇ окремої одиниці кожної позиції чека (unitIndex від 0 до qty-1 включно) визнач, кому вона належить, і додай запис до assignments: {itemId, unitIndex, personIds}. personIds — масив id людей: один елемент = одноосібно, кілька елементів = ділять цю одиницю порівну.
- Якщо в транскрипті згадано людину, якої немає в поточному списку people — додай її в people з новим id-слагом ЛАТИНИЦЕЮ (коротким, напр. "sam", "olya") і саме цей id використовуй в assignments. Загальна кількість людей (існуючі + нові) НЕ повинна перевищувати 3. Якщо людей уже 3 і згадано ще когось нового — НЕ додавай нову людину і онов позначай відповідні одиниці як неоднозначні через clarifications.
- Якщо для якоїсь одиниці товару з транскрипту неможливо однозначно визначити власника (взагалі не згадано, або сказано нечітко чи суперечливо) — НЕ вигадуй і НЕ додавай її в assignments. Натомість додай об'єкт у clarifications: {question, target: {itemId, unitIndex}, options}, де options — масив id УСІХ людей у фінальному списку people (існуючі + щойно додані), question — коротке природне запитання українською для користувача, напр. "Дві кави — хто брав другу?".
- Одиниця не може одночасно бути і в assignments, і в clarifications.
- Ти НЕ рахуєш жодних грошових сум чи часток — це рахує окремий детермінований код.
- Відповідай ЛИШЕ JSON-об'єктом, що відповідає схемі нижче. Жодного тексту, коментарів чи markdown-огорожі поза JSON.`;

const PARSE_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    people: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "id-слаг людини латиницею" },
          name: { type: "STRING", description: "Ім'я людини" },
        },
        required: ["id", "name"],
      },
    },
    assignments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          itemId: { type: "STRING" },
          unitIndex: { type: "INTEGER" },
          personIds: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["itemId", "unitIndex", "personIds"],
      },
    },
    clarifications: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          question: { type: "STRING" },
          target: {
            type: "OBJECT",
            properties: {
              itemId: { type: "STRING" },
              unitIndex: { type: "INTEGER" },
            },
            required: ["itemId", "unitIndex"],
          },
          options: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["question", "target", "options"],
      },
    },
  },
  required: ["people", "assignments", "clarifications"],
};

interface ParseGeminiPayload {
  people: Array<{ id: string; name: string }>;
  assignments: Array<{ itemId: string; unitIndex: number; personIds: string[] }>;
  clarifications: Array<{
    question: string;
    target: { itemId: string; unitIndex: number };
    options: string[];
  }>;
}

/**
 * Розбирає голосовий транскрипт у призначення одиниць товару людям через
 * Gemini. Повертає (можливо доповнений новими людьми) список people,
 * assignments на рівні одиниці товару та clarifications для неоднозначних
 * чи непризначених одиниць. Модель НЕ рахує суми.
 *
 * Мережевий виклик відбувається лише в момент реального виконання цієї
 * функції рантаймом (наприклад, з app/api/parse/route.ts).
 */
export async function parseIntent(req: ParseRequest): Promise<ParseResponse> {
  const userPrompt = [
    `Транскрипт голосу: ${JSON.stringify(req.transcript)}`,
    `Чек (JSON): ${JSON.stringify(req.receipt)}`,
    `Поточні люди (JSON): ${JSON.stringify(req.people)}`,
    "Визнач власника кожної одиниці товару й поверни JSON за схемою, вказаною в системній інструкції.",
  ].join("\n\n");

  const raw = (await callGemini({
    systemInstruction: PARSE_SYSTEM_PROMPT,
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    responseSchema: PARSE_SCHEMA,
  })) as ParseGeminiPayload;

  if (
    !raw ||
    !Array.isArray(raw.people) ||
    !Array.isArray(raw.assignments) ||
    !Array.isArray(raw.clarifications)
  ) {
    throw new Error("Gemini: відповідь не відповідає очікуваній схемі parseIntent.");
  }

  const people: Person[] = raw.people.slice(0, 3).map((p) => ({
    id: String(p.id),
    name: String(p.name),
  }));

  const assignments: UnitAssignment[] = raw.assignments.map((a) => ({
    itemId: String(a.itemId),
    unitIndex: Math.max(0, Math.round(Number(a.unitIndex))),
    personIds: (a.personIds ?? []).map(String),
  }));

  const clarifications: Clarification[] = raw.clarifications.map((c) => ({
    question: String(c.question),
    target: {
      itemId: String(c.target.itemId),
      unitIndex: Math.max(0, Math.round(Number(c.target.unitIndex))),
    },
    options: (c.options ?? []).map(String),
  }));

  return { people, assignments, clarifications, source: "gemini" };
}
