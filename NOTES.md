# Delivery notes — "Навпіл" (Split a receipt by voice)

Codebridge Product Builder test task. Prototype that photographs a restaurant
receipt and lets the user say, by voice, who ordered what — then computes each
person's exact share.

## Links

- **Live demo:** https://navpil.vercel.app — open in **Chrome** and allow the
  **microphone** (voice input uses the browser Web Speech API, which is
  Chromium-only).
- **Repository:** https://github.com/Luka-Hrachov/navpil (public). Run
  instructions in `web/README.md`.
- **Video walkthrough (≤3 min):** attached in the submission form.

## Key design decision — the model reads, the code computes

The single most important choice: **the language model never does arithmetic.**

- The model (Gemini 2.5 Flash) is used only to (a) read the receipt photo into
  structured items (name, qty, unit price in cents, per-item confidence) and
  (b) parse a voice transcript into structured assignments ("who gets which
  unit"). It is explicitly instructed to output JSON only and to compute
  nothing.
- **All money is computed by deterministic TypeScript** (`web/lib/split.ts`),
  in integer cents, with no floating point. This is what makes totals reconcile
  exactly and removes any chance of a "hallucinated" sum.

This directly targets the failure modes the brief calls out (double-counting,
float error, invented prices).

## Rounding & service-charge rules (deterministic, as implemented)

All amounts are integer cents. Two explicit remainder rules:

1. **Shared item.** A unit's price is split equally among its sharers
   (`floor(price / n)`). The leftover cents (fewer than `n`) are handed out one
   each in a **stable person order** — by name (Ukrainian collation), ties
   broken by id. Example: pizza 320,00 / 3 → 106,66 each, 2 leftover cents go to
   the first two people in stable order → 106,67 / 106,67 / 106,66.
2. **Service charge.** Distributed **proportionally to each person's subtotal**;
   each share is floored, then the leftover cents go to the **largest
   fractional remainder first**, ties broken by the same stable person order.

Enforced invariants (`SplitResult`): sum of all shares equals items + service;
every unit is counted exactly once; unassigned units and unknown people are
surfaced explicitly (`unassigned`, `unknownPeople`) instead of silently
dropped; a result is only marked `ok` when everything is assigned to known
people; a printed receipt total that disagrees with the computed total raises
`totalMismatch` (a likely photo-recognition error) rather than being trusted.

## Test set — inputs, expected vs actual

`test-assets/` holds 5 reproducible scenarios (documented in `TESTSET.md`), each
with a generated `receipt.png`, a `voice.txt` transcript, and an `expected.json`
ground truth written **before** running anything:

1. Normal split — everyone pays for their own.
2. Shared dish — one item split across all three + 10% service charge.
3. Voice correction — "actually Sam had the second coffee" re-assigns one unit.
4. Ambiguous repeat — two identical coffees, one mentioned → app must ask, not
   guess.
5. Partially unreadable receipt — one line is deliberately blurred → app must
   flag low confidence, not invent a price.

- **Expected vs actual (compute engine):** `test-assets/verify.ts` runs every
  ground truth through the real `computeSplit` — **0 discrepancies** across all
  5 scenarios (including the before/after states of scenarios 3 and 4).
- **Model steps (live):** recognize + parse were exercised against the real
  Gemini API (6 calls, all HTTP 200, valid JSON) — see Measurements.
- The audio recordings themselves are produced by the user from `voice.txt`;
  the product processes fresh input, not canned demo answers.

## One example of verifying model output

The "charger" case: the user says "I bought everything except the charger — my
friend bought the charger." The model returns only assignments (charger → the
friend, everything else → the user); `split.ts` then computes the cents and the
sum reconciles to the receipt total. If the model had invented a price or
mis-assigned, it would surface as `totalMismatch` or as an `unassigned` item —
the UI never shows an incomplete split as if it were final. This is the general
guard: the model's output is always reconciled against the printed total and the
"every unit assigned exactly once" invariant before anything is shown.

## Measurements (real run, 2026-09-30)

Full method and per-call table in `MEASUREMENT.md`. Measured on the free-tier
Gemini key, 3 receipts × (recognize + parse) = 6 calls:

| Step | avg time | avg cost* |
|---|---:|---:|
| recognize (photo → items) | ~5.8 s | ~$0.0032 |
| parse (voice → assignments) | ~4.7 s | ~$0.0030 |
| **one full receipt** | **~10.6 s** | **~$0.0062** |

- Deterministic compute (`split.ts`) is microseconds — time is essentially the
  Gemini network calls.
- Speech-to-text is the browser Web Speech API — **$0** variable cost, no paid
  intermediary.
- \*Cost uses **assumed** paid Gemini 2.5 Flash rates ($0.30 / 1M input,
  $2.50 / 1M output; verify at https://ai.google.dev/pricing). It **includes
  Gemini's "thinking" tokens**, which are billed at the output rate and, on this
  model, often exceed the visible response — pricing only the visible output
  undercounts several-fold.
- **Free-tier credits are not counted as $0 cost** (per the brief); the figures
  above are the paid-rate estimate. The actual run was on the free tier, so its
  real charge was $0.
- **Hosting is separate:** Vercel Hobby = $0 within plan limits, not mixed into
  the per-receipt variable cost above.

## AI tools & models — reused vs built

- **Models/services used:** Gemini 2.5 Flash (Google Generative Language API) for
  receipt vision + voice parsing; browser Web Speech API (`uk-UA`) for
  speech-to-text.
- **Built with:** Claude Code (Anthropic) as the coding assistant, under my
  direction and review.
- **Reused (off-the-shelf):** Next.js, React, Tailwind, Framer Motion; Gemini
  API; the browser Web Speech API; Satoshi font; Vercel hosting.
- **Written for this task:** the whole application — UI and flow, the
  deterministic split engine, the Gemini prompt + response-schema wrappers, the
  API routes, and the test set. No pre-existing product was submitted as new
  work.

## Scope and what is not done (honest)

- **Scope (per brief, intentionally narrow):** printed receipt up to ~10 rows,
  3 people, 1 currency, repeated items, one shared dish, a shown service charge.
  No accounts, payments, or store release.
- **Voice is Chrome-only.** The Web Speech API isn't fully supported in
  Firefox/Safari; the app needs Chrome + mic permission. STT quality varies with
  audio; a noisy phrase may need repeating.
- **No automated end-to-end UI test.** The compute engine has unit tests (15,
  all passing) and the test-set ground truth is verified against it; the full
  photo→voice→result path was exercised manually (no microphone in CI).
- **Latency ~10 s/receipt** is dominated by Gemini's thinking; it could be
  reduced by limiting the thinking budget, but that changes model behavior and
  would need re-checking against the test set, so it was left on.

## Time spent

Roughly 8 focused hours on 2026-09-30 (the brief's orientation budget).
