// POST /api/parse - розбір голосового транскрипту в призначення одиниць товару.
// БЕЗ ключа - чесна помилка (жодних вигаданих призначень на неіснуючі позиції).
// Мережевий виклик відбувається лише коли цей хендлер реально обробляє запит.

import type { ParseRequest } from "@/lib/api-types";
import { parseIntent } from "@/lib/gemini";

export async function POST(request: Request): Promise<Response> {
  let body: ParseRequest;
  try {
    body = (await request.json()) as ParseRequest;
  } catch {
    return Response.json({ error: "Некоректний запит." }, { status: 400 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return Response.json({ error: "Розбір голосу не налаштовано на сервері." }, { status: 503 });
  }

  const okBody =
    body &&
    typeof body.transcript === "string" &&
    body.transcript.trim().length > 0 &&
    body.receipt &&
    Array.isArray(body.receipt.items) &&
    Array.isArray(body.people);
  if (!okBody) {
    return Response.json({ error: "Відсутні або некоректні поля запиту." }, { status: 400 });
  }

  try {
    const result = await parseIntent(body);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Не вдалося розібрати голос.";
    console.error("[parse]", message);
    return Response.json({ error: message }, { status: 502 });
  }
}
