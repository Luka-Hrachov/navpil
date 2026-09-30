// POST /api/parse - розбір голосового транскрипту в призначення одиниць товару.
// Без GEMINI_API_KEY повертає мок, що збігається з поточним сценарієм
// застосунку (app/app-flow.tsx: MOCK_TRANSCRIPT + BASE_ASSIGN + Clarify-екран
// про другу каву). З ключем - реально виконає gemini.parseIntent (мережевий
// виклик відбудеться лише коли цей route-хендлер реально обробить HTTP-запит,
// не під час написання/типчеку коду).

import type { ParseRequest, ParseResponse } from "@/lib/api-types";
import { parseIntent } from "@/lib/gemini";

function buildMockResponse(people: ParseRequest["people"]): ParseResponse {
  return {
    people,
    assignments: [
      { itemId: "borsch", unitIndex: 0, personIds: ["me"] },
      { itemId: "borsch", unitIndex: 1, personIds: ["me"] },
      { itemId: "coffee", unitIndex: 0, personIds: ["me"] },
      { itemId: "pizza", unitIndex: 0, personIds: ["me", "anya", "sam"] },
      // coffee unitIndex 1 навмисно лишається непризначеною - уточнюємо нижче.
    ],
    clarifications: [
      {
        question: "Дві кави - хто брав другу?",
        target: { itemId: "coffee", unitIndex: 1 },
        options: ["me", "anya", "sam"],
      },
    ],
    source: "mock",
  };
}

const EMPTY_MOCK_RESPONSE: ParseResponse = {
  people: [],
  assignments: [],
  clarifications: [],
  source: "mock",
};

export async function POST(request: Request): Promise<Response> {
  let body: ParseRequest;
  try {
    body = (await request.json()) as ParseRequest;
  } catch {
    return Response.json(
      { ...EMPTY_MOCK_RESPONSE, error: "Некоректний JSON у тілі запиту." } satisfies ParseResponse,
      { status: 400 }
    );
  }

  // Немає ключа - мок. Це основний робочий режим цього агента: жодного
  // реального виклику Gemini тут не станеться.
  if (!process.env.GEMINI_API_KEY) {
    return Response.json(buildMockResponse(body?.people ?? []));
  }

  if (!body?.transcript || !body?.receipt || !body?.people) {
    return Response.json(
      {
        ...buildMockResponse(body?.people ?? []),
        error: "Відсутні обов'язкові поля запиту (transcript/receipt/people).",
      } satisfies ParseResponse,
      { status: 400 }
    );
  }

  try {
    const result = await parseIntent(body);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Невідома помилка виклику Gemini.";
    // Падаємо назад у мок, щоб застосунок лишався робочим навіть при збої моделі.
    return Response.json({ ...buildMockResponse(body.people), error: message } satisfies ParseResponse);
  }
}
