# Navpil — Split a Receipt Using Voice

Photograph a restaurant receipt, say out loud who ordered what, and Navpil tells
everyone exactly how much they owe — down to the cent, with the service charge
split proportionally.

**Live demo:** [navpil.vercel.app](https://navpil.vercel.app)
(voice input needs **Chrome** — it uses the Web Speech API)

Test assignment for Codebridge — "Split a receipt using voice" (Product Builder role).

## How it works

1. Upload or photograph a receipt.
2. Confirm the recognized items (or correct them by voice).
3. Say who ordered what.
4. Answer clarifying questions for anything ambiguous (tap or voice).
5. See who owes what; correct by voice at any point and the split updates.

## Core idea: the model never touches money

The whole app is built around one architectural rule: **the AI model only reads
and parses — it never calculates.**

The model (Gemini 2.5 Flash) does exactly two things:

1. Reads the photographed receipt and extracts structured data — item names,
   quantities, unit prices (in cents), service charge, printed total, and a
   confidence score per item.
2. Parses a voice transcript into structured, unit-level assignments (who owns
   which unit of which item) and raises clarifying questions when something is
   ambiguous or unassigned.

All money math is done by deterministic TypeScript code (`lib/split.ts`):

- Every amount is an integer number of **cents** — no floating point.
- Each unit of each item is assigned to one or more people (a shared unit is
  split evenly, remainder included).
- The service charge is split **proportionally** to each person's subtotal.
- Rounding remainders (when a division doesn't come out even) are handed out by
  a fixed, deterministic rule: the largest fractional part gets the extra cent
  first; ties are broken alphabetically by name.
- The result carries explicit invariants — `ok` (everything assigned, no
  unknown people), `totalMismatch` (printed total vs. computed total),
  `unassigned`, `unknownPeople` — so an incomplete split is never shown as
  "settled".

This keeps the model out of the money path entirely: it cannot hallucinate a
price or introduce a rounding error, because it never produces a number that
ends up in a total.

## Stack

- **Next.js 16** (App Router, TypeScript) — one project for both the UI and the
  two backend API routes.
- **Tailwind CSS v4** + **Framer Motion** for styling and screen transitions.
- **Gemini 2.5 Flash** (Google AI Studio) for vision (reading the receipt) and
  text (parsing voice intent), called server-side from `app/api/recognize` and
  `app/api/parse`; responses are constrained to JSON via Gemini's
  `responseSchema`.
- **Speech-to-text:** the browser's Web Speech API
  (`SpeechRecognition` / `webkitSpeechRecognition`, `lang: "uk-UA"`) — no
  server-side STT, so it only works in browsers that implement it (Chrome).
- **Hosting:** Vercel.

## Screens / flow

```
upload → recognizing → confirm → listen → clarify → result
```

- **Upload** — take a photo or pick one from the gallery.
- **Recognizing** — the photo is sent to `/api/recognize`.
- **Confirm** — the recognized receipt is shown as a printed slip; low-confidence
  lines are highlighted for review.
- **Listen** — hold the mic and say who ordered what; the live transcript is
  shown while listening, then sent to `/api/parse`.
- **Clarify** — one question at a time for anything the model couldn't resolve
  (e.g. "who had the second coffee?"); answered by tapping a person chip.
- **Result** — per-person totals with the items each person is paying for. A
  "correct by voice" mic re-runs `/api/parse` and **merges** the new
  assignments into the existing split instead of starting over. A status line
  confirms the totals reconcile, or explains exactly what's still missing.

## Local setup

Requirements: **Node.js 20+**, **Chrome** (for voice input).

```bash
cd web
npm install
```

Create `web/.env.local` with your own Gemini API key (free, from
[Google AI Studio](https://aistudio.google.com/)):

```bash
GEMINI_API_KEY=your_key_here
```

Without a key, `/api/recognize` and `/api/parse` return an honest error
(HTTP 503) — the app never falls back to fake or mocked receipt data.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in Chrome.

## Tests

Deterministic split engine, no model calls involved:

```bash
cd web
npx tsx lib/split.test.ts
```

Covers: a full multi-person split, rounding remainders (e.g. splitting 1 cent
across 3 people, largest-fraction-first with alphabetical tiebreak on the
service charge), an unknown `personId`, duplicate `personIds`, an empty or
partial assignment, and a receipt whose printed total doesn't match the
computed one.

## Deploy

Hosted on **Vercel**, project root `web/`, with `GEMINI_API_KEY` set as a
server-side environment variable. See `DEPLOY.md` in the repository root for
the exact redeploy steps and secrets layout.

## Scope

Built to a deliberately narrow brief:

- One printed receipt, up to ~10 line items.
- A few people, one currency.
- Shared dishes, split evenly among assignees.
- A single service charge, split proportionally.
- Payments, accounts, and multi-currency are out of scope.

## Notes

- The recognition/parsing pipeline itself is language-agnostic (Gemini is
  multilingual), but the UI copy is Ukrainian only.
- Voice input depends on the Web Speech API, which in practice means Chrome.
