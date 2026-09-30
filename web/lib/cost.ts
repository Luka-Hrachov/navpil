// Оцінка вартості викликів Gemini 2.5 Flash.
//
// Цей файл НІЧОГО не викликає й нічого не рахує "по-справжньому" в грошах -
// він лише переводить токени (з usageMetadata відповіді Gemini, див.
// lib/gemini.ts) у долари за припущеними цінами нижче. Реальний рахунок
// Google може відрізнятись (тарифи змінюються, курс токенізації відрізняється
// для зображень/тексту, можливі знижки на обʼєм тощо).

/**
 * ПРИПУЩЕННЯ (не підтверджені живим рахунком): ціни Gemini 2.5 Flash, paid
 * tier, станом на підготовку цього виміру. Безкоштовний тариф (free tier)
 * Gemini API - НЕ нульова вартість: якщо реальне навантаження перевищить
 * безкоштовні ліміти (або клієнт свідомо хоче собівартість за платним
 * тарифом), рахунок піде за цінами нижче. Звірити на
 * https://ai.google.dev/pricing перед тим, як ці числа підуть у фінальний
 * звіт клієнту - ціни можуть відрізнятись за версією моделі, регіоном чи
 * датою.
 */
export const GEMINI_INPUT_USD_PER_1M_TOKENS = 0.3; // ПРИПУЩЕННЯ: $0.30 / 1M input tokens
export const GEMINI_OUTPUT_USD_PER_1M_TOKENS = 2.5; // ПРИПУЩЕННЯ: $2.50 / 1M output tokens

/** Токени одного виклику Gemini (з usageMetadata відповіді generateContent). */
export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

/**
 * Оцінка вартості ОДНОГО виклику Gemini в USD за припущеними цінами вище.
 * usage.total у розрахунку не бере участі напряму (він лише для логів/UI) -
 * рахунок Google завжди йде окремо за input і output токенами.
 */
export function costUsd(usage: TokenUsage): number {
  const inputUsd = (usage.input / 1_000_000) * GEMINI_INPUT_USD_PER_1M_TOKENS;
  const outputUsd = (usage.output / 1_000_000) * GEMINI_OUTPUT_USD_PER_1M_TOKENS;
  return inputUsd + outputUsd;
}

/**
 * Сумарна вартість за один чек/діалог: recognize + parse + можливі повтори
 * (ретраї через мережеві помилки, невдалий парсинг JSON тощо). Передай
 * usage-об'єкт КОЖНОГО фактичного виклику Gemini, що стався в межах одного
 * чек-діалогу, - функція підсумовує costUsd() по кожному з них.
 */
export function totalCostUsd(usages: TokenUsage[]): number {
  return usages.reduce((sum, usage) => sum + costUsd(usage), 0);
}
