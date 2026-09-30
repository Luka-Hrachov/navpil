// POST /api/recognize - розпізнавання фото чека через Gemini.
// БЕЗ ключа - чесна помилка (жодного фейкового чека: ділити гроші за
// вигаданими цифрами - неприпустимо). Мережевий виклик відбувається лише
// коли цей хендлер реально обробляє запит.

import type { RecognizeRequest } from "@/lib/api-types";
import { recognizeReceipt } from "@/lib/gemini";

export async function POST(request: Request): Promise<Response> {
  let body: RecognizeRequest;
  try {
    body = (await request.json()) as RecognizeRequest;
  } catch {
    return Response.json({ error: "Некоректний запит." }, { status: 400 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return Response.json(
      { error: "Розпізнавання не налаштовано на сервері." },
      { status: 503 }
    );
  }

  if (!body?.imageBase64 || typeof body.imageBase64 !== "string" || !body?.mimeType) {
    return Response.json({ error: "Відсутнє фото чека." }, { status: 400 });
  }
  // приблизна перевірка розміру (ліміт payload на Vercel ~4.5 МБ)
  if (body.imageBase64.length > 6_000_000) {
    return Response.json(
      { error: "Фото завелике - стисни або зменш роздільність." },
      { status: 413 }
    );
  }

  try {
    const result = await recognizeReceipt(body);
    if (result.meta) {
      const { ms, tokens, costUsd } = result.meta;
      console.log(
        `[cost] recognize ms=${ms} tokens=in:${tokens.input}/out:${tokens.output}/total:${tokens.total} $=${costUsd.toFixed(6)}`
      );
    }
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Не вдалося розпізнати чек.";
    console.error("[recognize]", message);
    return Response.json({ error: message }, { status: 502 });
  }
}
