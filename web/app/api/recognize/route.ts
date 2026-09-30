// POST /api/recognize — розпізнавання фото чека.
// Без GEMINI_API_KEY повертає мок, що структурно й за значеннями збігається
// з поточними мок-даними застосунку (app/app-flow.tsx: SAMPLE).
// З ключем — реально виконає gemini.recognizeReceipt (мережевий виклик
// відбудеться лише коли цей route-хендлер реально обробить HTTP-запит,
// не під час написання/типчеку коду).

import type { RecognizeRequest, RecognizeResponse } from "@/lib/api-types";
import { recognizeReceipt } from "@/lib/gemini";

const MOCK_RESPONSE: RecognizeResponse = {
  receipt: {
    items: [
      { id: "borsch", name: "Борщ", qty: 2, unitPriceCents: 12000 },
      { id: "coffee", name: "Кава", qty: 2, unitPriceCents: 6500 },
      { id: "pizza", name: "Піца", qty: 1, unitPriceCents: 32000 },
    ],
    serviceChargeCents: 6900,
    totalCents: 75900,
  },
  itemsMeta: [
    { id: "borsch", name: "Борщ", qty: 2, unitPriceCents: 12000, confidence: 0.98 },
    { id: "coffee", name: "Кава", qty: 2, unitPriceCents: 6500, confidence: 0.71 },
    { id: "pizza", name: "Піца", qty: 1, unitPriceCents: 32000, confidence: 0.95 },
  ],
  source: "mock",
};

export async function POST(request: Request): Promise<Response> {
  let body: RecognizeRequest;
  try {
    body = (await request.json()) as RecognizeRequest;
  } catch {
    return Response.json(
      { ...MOCK_RESPONSE, error: "Некоректний JSON у тілі запиту." } satisfies RecognizeResponse,
      { status: 400 }
    );
  }

  // Немає ключа — мок. Це основний робочий режим цього агента: жодного
  // реального виклику Gemini тут не станеться.
  if (!process.env.GEMINI_API_KEY) {
    return Response.json(MOCK_RESPONSE);
  }

  if (!body?.imageBase64 || !body?.mimeType) {
    return Response.json(
      { ...MOCK_RESPONSE, error: "Відсутнє фото чека (imageBase64/mimeType)." } satisfies RecognizeResponse,
      { status: 400 }
    );
  }

  try {
    const result = await recognizeReceipt(body);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Невідома помилка виклику Gemini.";
    // Падаємо назад у мок, щоб застосунок лишався робочим навіть при збої моделі.
    return Response.json({ ...MOCK_RESPONSE, error: message } satisfies RecognizeResponse);
  }
}
