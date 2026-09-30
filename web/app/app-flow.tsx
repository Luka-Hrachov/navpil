"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  computeSplit,
  money,
  type Person,
  type Receipt,
  type UnitAssignment,
} from "@/lib/split";
import {
  callParse,
  callRecognize,
  fileToBase64,
  startDictation,
  type DictationHandle,
} from "@/lib/client";
import type { Clarification, ItemMeta } from "@/lib/api-types";

/* ------------------- дефолти й запасні (fallback) дані ------------------- */
/* Використовуються, поки не прийшла відповідь бекенда, або якщо виклик
   API/голосу недоступний — застосунок і без ключа має лишатись робочим. */

const PEOPLE: Person[] = [
  { id: "me", name: "Я" },
  { id: "anya", name: "Аня" },
  { id: "sam", name: "Сем" },
];
const COLORS: Record<string, string> = { me: "var(--p1)", anya: "var(--p2)", sam: "var(--p3)" };

function colorFor(id: string): string {
  return COLORS[id] ?? "var(--accent)";
}

const SAMPLE: Receipt & { itemsMeta: ItemMeta[] } = {
  items: [
    { id: "borsch", name: "Борщ", qty: 2, unitPriceCents: 12000 },
    { id: "coffee", name: "Кава", qty: 2, unitPriceCents: 6500 },
    { id: "pizza", name: "Піца", qty: 1, unitPriceCents: 32000 },
  ],
  serviceChargeCents: 6900,
  totalCents: 75900,
  itemsMeta: [
    { id: "borsch", name: "Борщ", qty: 2, unitPriceCents: 12000, confidence: 0.98 },
    { id: "coffee", name: "Кава", qty: 2, unitPriceCents: 6500, confidence: 0.71 },
    { id: "pizza", name: "Піца", qty: 1, unitPriceCents: 32000, confidence: 0.95 },
  ],
};

const MOCK_TRANSCRIPT = "Борщ обидва мої, одну каву я, піцу ділимо втрьох.";

// запасні призначення, якщо /api/parse взагалі недоступний (мережева помилка)
const BASE_ASSIGN: UnitAssignment[] = [
  { itemId: "borsch", unitIndex: 0, personIds: ["me"] },
  { itemId: "borsch", unitIndex: 1, personIds: ["me"] },
  { itemId: "coffee", unitIndex: 0, personIds: ["me"] },
  { itemId: "pizza", unitIndex: 0, personIds: ["me", "anya", "sam"] },
];

const FALLBACK_CLARIFICATIONS: Clarification[] = [
  {
    question: "Дві кави — хто брав другу?",
    target: { itemId: "coffee", unitIndex: 1 },
    options: PEOPLE.map((p) => p.id),
  },
];

type Screen = "upload" | "recognizing" | "confirm" | "listen" | "clarify" | "result";
type DictMode = "idle" | "listen" | "correct";

const fade = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.25 } },
};

/* --------------------------------- застосунок --------------------------------- */

export default function AppFlow() {
  const [screen, setScreen] = useState<Screen>("upload");
  const [people, setPeople] = useState<Person[]>(PEOPLE);
  const [receipt, setReceipt] = useState<Receipt>(SAMPLE);
  const [itemsMeta, setItemsMeta] = useState<ItemMeta[]>(SAMPLE.itemsMeta);
  const [source, setSource] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [transcript, setTranscript] = useState("");
  const [dictMode, setDictMode] = useState<DictMode>("idle");
  const [parsing, setParsing] = useState(false);
  const dictationRef = useRef<DictationHandle | null>(null);

  const [assignments, setAssignments] = useState<UnitAssignment[]>([]);
  const [clarifications, setClarifications] = useState<Clarification[]>([]);
  const [clarifyIndex, setClarifyIndex] = useState(0);

  const result = useMemo(
    () => computeSplit(receipt, people, assignments),
    [receipt, people, assignments]
  );

  // якщо чекаємо уточнення, якого раптом нема (порожній масив/вихід за межі) — не зависати
  useEffect(() => {
    if (screen === "clarify" && !clarifications[clarifyIndex]) {
      setScreen("result");
    }
  }, [screen, clarifications, clarifyIndex]);

  // не лишати активне розпізнавання мовлення, якщо компонент розмонтовується
  useEffect(() => {
    return () => {
      dictationRef.current?.stop();
    };
  }, []);

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // дозволити повторний вибір того ж файлу
    if (!file) return;
    setNotice(null);
    setScreen("recognizing");
    try {
      const { imageBase64, mimeType } = await fileToBase64(file);
      const res = await callRecognize(imageBase64, mimeType);
      setReceipt(res.receipt);
      setItemsMeta(res.itemsMeta);
      setSource(res.source);
      if (res.error) setNotice(res.error);
      setScreen("confirm");
    } catch (err) {
      setNotice(
        err instanceof Error ? err.message : "Не вдалося розпізнати чек — показано приклад"
      );
      setReceipt(SAMPLE);
      setItemsMeta(SAMPLE.itemsMeta);
      setSource("mock");
      setScreen("confirm");
    }
  }

  function confirmOk() {
    setNotice(null);
    setScreen("listen");
  }

  async function finishListening(rawTranscript: string) {
    setDictMode("idle");
    dictationRef.current = null;
    const text = rawTranscript.trim() || MOCK_TRANSCRIPT;
    setTranscript(text);
    setParsing(true);
    try {
      const res = await callParse(text, receipt, people);
      setPeople(res.people.length > 0 ? res.people : people);
      setAssignments(res.assignments);
      setClarifications(res.clarifications);
      setClarifyIndex(0);
      setSource(res.source);
      if (res.error) setNotice(res.error);
      setScreen(res.clarifications.length > 0 ? "clarify" : "result");
    } catch (err) {
      setNotice(
        err instanceof Error ? err.message : "Не вдалося розібрати голос — показано приклад"
      );
      setAssignments(BASE_ASSIGN);
      setClarifications(FALLBACK_CLARIFICATIONS);
      setClarifyIndex(0);
      setScreen("clarify");
    } finally {
      setParsing(false);
    }
  }

  function record() {
    if (dictMode === "listen") {
      dictationRef.current?.stop();
      return;
    }
    setNotice(null);
    setTranscript("");
    const handle = startDictation(
      (text) => setTranscript(text),
      (finalText) => void finishListening(finalText),
      (reason) => {
        setDictMode("idle");
        dictationRef.current = null;
        setNotice(`Голосовий ввід не спрацював (${reason}) — спробуй ще раз`);
      }
    );
    if (!handle) {
      // Web Speech API недоступний у цьому браузері — падаємо на запасний мок-транскрипт,
      // але все одно проганяємо його через реальний /api/parse
      setDictMode("listen");
      window.setTimeout(() => {
        void finishListening(MOCK_TRANSCRIPT);
      }, 1200);
      return;
    }
    dictationRef.current = handle;
    setDictMode("listen");
  }

  function resolvePersonId(option: string): string {
    const byId = people.find((p) => p.id === option);
    if (byId) return byId.id;
    const byName = people.find((p) => p.name.toLowerCase() === option.toLowerCase());
    if (byName) return byName.id;
    return option;
  }

  function answerClarify(option: string) {
    const current = clarifications[clarifyIndex];
    if (current) {
      const personId = resolvePersonId(option);
      setAssignments((a) => [
        ...a.filter(
          (x) => !(x.itemId === current.target.itemId && x.unitIndex === current.target.unitIndex)
        ),
        { itemId: current.target.itemId, unitIndex: current.target.unitIndex, personIds: [personId] },
      ]);
    }
    const next = clarifyIndex + 1;
    if (next < clarifications.length) {
      setClarifyIndex(next);
    } else {
      setScreen("result");
    }
  }

  async function finishCorrection(rawTranscript: string) {
    setDictMode("idle");
    dictationRef.current = null;
    const text = rawTranscript.trim();
    if (!text) return;
    setParsing(true);
    try {
      const res = await callParse(text, receipt, people);
      setPeople(res.people.length > 0 ? res.people : people);
      if (res.assignments.length > 0) {
        setAssignments((prev) => mergeAssignments(prev, res.assignments));
      }
      setSource(res.source);
      if (res.error) setNotice(res.error);
      if (res.clarifications.length > 0) {
        setClarifications(res.clarifications);
        setClarifyIndex(0);
        setScreen("clarify");
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Не вдалося розібрати виправлення голосом");
    } finally {
      setParsing(false);
    }
  }

  function correct() {
    if (dictMode === "correct") {
      dictationRef.current?.stop();
      return;
    }
    setNotice(null);
    const handle = startDictation(
      () => {},
      (finalText) => void finishCorrection(finalText),
      (reason) => {
        setDictMode("idle");
        dictationRef.current = null;
        setNotice(`Голосовий ввід не спрацював (${reason})`);
      }
    );
    if (!handle) {
      // демо-фолбек без Web Speech API: «другу каву брав Сем», якщо така позиція/особа є
      setAssignments((a) => {
        const sam = people.find((p) => p.id === "sam");
        const hasSecondCoffee = itemsMeta.some((it) => it.id === "coffee" && it.qty > 1);
        if (!sam || !hasSecondCoffee) return a;
        const rest = a.filter((x) => !(x.itemId === "coffee" && x.unitIndex === 1));
        return [...rest, { itemId: "coffee", unitIndex: 1, personIds: [sam.id] }];
      });
      return;
    }
    dictationRef.current = handle;
    setDictMode("correct");
  }

  function reset() {
    dictationRef.current?.stop();
    dictationRef.current = null;
    setDictMode("idle");
    setParsing(false);
    setScreen("upload");
    setTranscript("");
    setAssignments([]);
    setClarifications([]);
    setClarifyIndex(0);
    setNotice(null);
    setSource(null);
    setReceipt(SAMPLE);
    setItemsMeta(SAMPLE.itemsMeta);
    setPeople(PEOPLE);
  }

  return (
    <main className="stage">
      <div className="phone">
        <Header source={source} />
        {notice && (
          <div className="settled warn" style={{ marginBottom: 4 }}>
            {notice}
          </div>
        )}
        <AnimatePresence mode="wait">
          {screen === "upload" && (
            <motion.div key="upload" {...fade}>
              <Upload onPick={handleFileChange} />
            </motion.div>
          )}
          {screen === "recognizing" && (
            <motion.div key="rec" {...fade}>
              <Recognizing />
            </motion.div>
          )}
          {screen === "confirm" && (
            <motion.div key="confirm" {...fade}>
              <Confirm receipt={receipt} itemsMeta={itemsMeta} onOk={confirmOk} />
            </motion.div>
          )}
          {screen === "listen" && (
            <motion.div key="listen" {...fade}>
              <Listen
                receipt={receipt}
                itemsMeta={itemsMeta}
                dictMode={dictMode}
                parsing={parsing}
                transcript={transcript}
                onRecord={record}
              />
            </motion.div>
          )}
          {screen === "clarify" && clarifications[clarifyIndex] && (
            <motion.div key={`clarify-${clarifyIndex}`} {...fade}>
              <Clarify
                question={clarifications[clarifyIndex].question}
                options={clarifications[clarifyIndex].options}
                people={people}
                onAnswer={answerClarify}
              />
            </motion.div>
          )}
          {screen === "result" && (
            <motion.div key="result" {...fade}>
              <Result
                people={people}
                result={result}
                dictMode={dictMode}
                onCorrect={correct}
                onReset={reset}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}

/** Мерджить нові UnitAssignment поверх старих за ключем (itemId, unitIndex). */
function mergeAssignments(prev: UnitAssignment[], next: UnitAssignment[]): UnitAssignment[] {
  const key = (a: UnitAssignment) => `${a.itemId}#${a.unitIndex}`;
  const map = new Map<string, UnitAssignment>(prev.map((a) => [key(a), a]));
  for (const a of next) map.set(key(a), a);
  return [...map.values()];
}

/* --------------------------------- екрани --------------------------------- */

function Header({ source }: { source: string | null }) {
  return (
    <div className="top">
      <div className="logo">Н</div>
      <div className="brand">
        <h1>Навпіл</h1>
        <span>рахунок голосом</span>
      </div>
      {source === "mock" && (
        <span className="chip">
          <span className="dot" />
          мок
        </span>
      )}
    </div>
  );
}

function Upload({ onPick }: { onPick: (e: ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <div className="upload">
      <div className="upload-art">🧾</div>
      <p className="upload-lead">Сфотографуй чек — і кожен дізнається свою частку.</p>
      <label className="btn-primary">
        Сфотографувати чек
        <input type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
      </label>
      <label className="btn-ghost">
        Завантажити з галереї
        <input type="file" accept="image/*" hidden onChange={onPick} />
      </label>
    </div>
  );
}

function Recognizing() {
  return (
    <div className="center-block">
      <div className="spinner" />
      <p className="mic-cap">Читаю чек…</p>
    </div>
  );
}

function ReceiptRows({
  receipt,
  itemsMeta,
  editable = false,
}: {
  receipt: Receipt;
  itemsMeta: ItemMeta[];
  editable?: boolean;
}) {
  const itemsCents = itemsMeta.reduce((s, it) => s + it.unitPriceCents * it.qty, 0);
  const svcPercent =
    itemsCents > 0 ? Math.round((receipt.serviceChargeCents / itemsCents) * 100) : null;
  return (
    <div className="card">
      <h3>Чек</h3>
      {itemsMeta.map((it) => (
        <div className={`row${editable && it.confidence < 0.8 ? " low" : ""}`} key={it.id}>
          <span className="nm">
            {it.name} {it.qty > 1 && <span className="q">×{it.qty}</span>}
            {editable && it.confidence < 0.8 && <span className="tag">перевір</span>}
          </span>
          <span className="amt">{money(it.unitPriceCents * it.qty)}</span>
        </div>
      ))}
      <div className="row">
        <span className="nm">
          Сервіс {svcPercent !== null && <span className="q">{svcPercent}%</span>}
        </span>
        <span className="amt">{money(receipt.serviceChargeCents)}</span>
      </div>
      <div className="row total">
        <span className="nm">Разом</span>
        <span className="amt">{money(receipt.totalCents)}</span>
      </div>
    </div>
  );
}

function Confirm({
  receipt,
  itemsMeta,
  onOk,
}: {
  receipt: Receipt;
  itemsMeta: ItemMeta[];
  onOk: () => void;
}) {
  return (
    <>
      <p className="screen-lead">Перевір, чи все правильно. Підсвічене — сумнівне.</p>
      <ReceiptRows receipt={receipt} itemsMeta={itemsMeta} editable />
      <div className="actions">
        <button className="btn-primary" onClick={onOk}>
          Все вірно
        </button>
      </div>
      <p className="mic-cap center">Виправити — тапни позицію або скажи голосом</p>
    </>
  );
}

function Listen({
  receipt,
  itemsMeta,
  dictMode,
  parsing,
  transcript,
  onRecord,
}: {
  receipt: Receipt;
  itemsMeta: ItemMeta[];
  dictMode: DictMode;
  parsing: boolean;
  transcript: string;
  onRecord: () => void;
}) {
  const listening = dictMode === "listen";
  const caption = parsing ? "Обробляю…" : listening ? "Слухаю…" : "Натисни і скажи, хто що брав";
  return (
    <>
      <ReceiptRows receipt={receipt} itemsMeta={itemsMeta} />
      <div className="mic-wrap">
        <motion.button
          className={`mic${listening ? " on" : ""}`}
          aria-label="Говорити"
          onClick={onRecord}
          disabled={parsing}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
        >
          <MicIcon />
        </motion.button>
        <span className="mic-cap">{caption}</span>
      </div>
      {transcript && <div className="bubble">{transcript}</div>}
    </>
  );
}

function Clarify({
  question,
  options,
  people,
  onAnswer,
}: {
  question: string;
  options: string[];
  people: Person[];
  onAnswer: (option: string) => void;
}) {
  return (
    <div className="sheet">
      <p className="screen-lead">{question}</p>
      <div className="chips">
        {options.map((opt) => {
          const person =
            people.find((p) => p.id === opt) ??
            people.find((p) => p.name.toLowerCase() === opt.toLowerCase());
          const label = person?.name ?? opt;
          const color = person ? colorFor(person.id) : "var(--accent)";
          return (
            <button key={opt} className="chip-btn" onClick={() => onAnswer(opt)}>
              <span className="ava sm" style={{ background: color }}>
                {label[0]?.toUpperCase()}
              </span>
              {label}
            </button>
          );
        })}
      </div>
      <p className="mic-cap center">Обери або скажи голосом</p>
    </div>
  );
}

function Result({
  people,
  result,
  dictMode,
  onCorrect,
  onReset,
}: {
  people: Person[];
  result: ReturnType<typeof computeSplit>;
  dictMode: DictMode;
  onCorrect: () => void;
  onReset: () => void;
}) {
  const correcting = dictMode === "correct";
  return (
    <>
      <div className="people">
        {result.perPerson.map((r) => {
          const p = people.find((x) => x.id === r.personId);
          const name = p?.name ?? r.personId;
          return (
            <motion.div
              key={r.personId}
              className="person"
              layout
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 22 }}
            >
              <div className="ava" style={{ background: colorFor(r.personId) }}>
                {name[0]?.toUpperCase()}
              </div>
              <div className="who">{name}</div>
              <div className="sum">{money(r.totalCents)}</div>
            </motion.div>
          );
        })}
      </div>

      {result.ok ? (
        <div className="settled">
          <span className="tick">✓</span> усе розкладено · сума сходиться
        </div>
      ) : (
        <div className="settled warn">Ще не все призначено</div>
      )}

      <div className="mic-wrap sm">
        <motion.button
          className={`mic sm${correcting ? " on" : ""}`}
          aria-label="Виправити голосом"
          onClick={onCorrect}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
        >
          <MicIcon />
        </motion.button>
        <span className="mic-cap">
          {correcting ? "Слухаю…" : "Виправити голосом · напр. «другу каву брав Сем»"}
        </span>
      </div>

      <div className="actions">
        <button className="btn-ghost" onClick={onReset}>
          Новий чек
        </button>
      </div>
    </>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <path d="M12 18v4" />
    </svg>
  );
}
