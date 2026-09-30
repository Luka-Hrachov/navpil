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

/* --------------------------------- дані --------------------------------- */

// Людина, яка користується застосунком. Усі інші люди беруться ТІЛЬКИ з голосу.
const ME: Person = { id: "me", name: "Я" };
const EMPTY_RECEIPT: Receipt = { items: [], serviceChargeCents: 0, totalCents: 0 };
const PALETTE = ["var(--p1)", "var(--p2)", "var(--p3)", "var(--accent-2)"];

// Стабільний колір людини: "Я" завжди перший, решта - за порядком появи.
function colorFor(id: string, people: Person[]): string {
  if (id === "me") return PALETTE[0];
  const others = people.filter((p) => p.id !== "me");
  const i = others.findIndex((p) => p.id === id);
  if (i < 0) return "var(--accent)";
  return PALETTE[(i % (PALETTE.length - 1)) + 1];
}

type Screen = "upload" | "recognizing" | "confirm" | "listen" | "clarify" | "result";
type DictMode = "idle" | "listen" | "correct";

const fade = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.25 } },
};

/** Мерджить нові UnitAssignment поверх старих за ключем (itemId, unitIndex). */
function mergeAssignments(prev: UnitAssignment[], next: UnitAssignment[]): UnitAssignment[] {
  const key = (a: UnitAssignment) => `${a.itemId}#${a.unitIndex}`;
  const map = new Map<string, UnitAssignment>(prev.map((a) => [key(a), a]));
  for (const a of next) map.set(key(a), a);
  return [...map.values()];
}

/* --------------------------------- застосунок --------------------------------- */

export default function AppFlow() {
  const [screen, setScreen] = useState<Screen>("upload");
  const [people, setPeople] = useState<Person[]>([ME]);
  const [receipt, setReceipt] = useState<Receipt>(EMPTY_RECEIPT);
  const [itemsMeta, setItemsMeta] = useState<ItemMeta[]>([]);
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

  // якщо чекаємо уточнення, якого раптом нема - не зависати
  useEffect(() => {
    if (screen === "clarify" && !clarifications[clarifyIndex]) setScreen("result");
  }, [screen, clarifications, clarifyIndex]);

  // зупинити активне розпізнавання мовлення при розмонтуванні
  useEffect(() => () => dictationRef.current?.stop(), []);

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setNotice(null);
    setScreen("recognizing");
    try {
      const { imageBase64, mimeType } = await fileToBase64(file);
      const res = await callRecognize(imageBase64, mimeType);
      if (!res.receipt.items.length) throw new Error("Не вдалося прочитати позиції чека");
      setReceipt(res.receipt);
      setItemsMeta(res.itemsMeta);
      setSource(res.source);
      if (res.error) setNotice(res.error);
      setScreen("confirm");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Не вдалося розпізнати чек. Спробуй інше фото");
      setScreen("upload");
    }
  }

  function confirmOk() {
    setNotice(null);
    setScreen("listen");
  }

  async function finishListening(rawTranscript: string) {
    setDictMode("idle");
    dictationRef.current = null;
    const text = rawTranscript.trim();
    setTranscript(text);
    if (!text) {
      setNotice("Не почув. Натисни і скажи ще раз");
      return;
    }
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
      setNotice(err instanceof Error ? err.message : "Не вдалося розібрати голос. Спробуй ще раз");
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
        setNotice(
          reason === "unsupported"
            ? "Голосовий ввід працює у Chrome. Відкрий застосунок у Chrome"
            : `Голосовий ввід не спрацював (${reason}). Спробуй ще раз`
        );
      }
    );
    if (!handle) {
      setNotice("Голосовий ввід працює у Chrome. Відкрий застосунок у Chrome");
      return;
    }
    dictationRef.current = handle;
    setDictMode("listen");
  }

  function resolvePersonId(option: string): string {
    const byId = people.find((p) => p.id === option);
    if (byId) return byId.id;
    const byName = people.find((p) => p.name.toLowerCase() === option.toLowerCase());
    return byName ? byName.id : option;
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
    if (next < clarifications.length) setClarifyIndex(next);
    else setScreen("result");
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
        setNotice(
          reason === "unsupported"
            ? "Голосовий ввід працює у Chrome"
            : `Голосовий ввід не спрацював (${reason})`
        );
      }
    );
    if (!handle) {
      setNotice("Голосовий ввід працює у Chrome");
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
    setReceipt(EMPTY_RECEIPT);
    setItemsMeta([]);
    setPeople([ME]);
  }

  return (
    <main className="stage">
      <div className="app">
        {screen !== "upload" && <Header source={source} />}
        {notice && (
          <div className="settled warn" style={{ marginBottom: 4 }}>
            {notice}
          </div>
        )}
        <AnimatePresence mode="wait" initial={false}>
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
          демо-режим
        </span>
      )}
    </div>
  );
}

function Upload({ onPick }: { onPick: (e: ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <div className="hero">
      <div className="hero-mark">Н</div>
      <h1>Навпіл</h1>
      <p className="tag">Сфотографуй чек, скажи хто що брав - і кожен бачить свою частку.</p>
      <ReceiptArt />
      <div className="steps">
        <div className="step">
          <div className="si">
            <CameraIcon />
          </div>
          Фото чека
        </div>
        <div className="step">
          <div className="si">
            <MicIcon />
          </div>
          Голос
        </div>
        <div className="step">
          <div className="si">
            <CheckIcon />
          </div>
          Готово
        </div>
      </div>
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
      <p className="mic-cap">Читаю чек...</p>
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
  const svcPercent = itemsCents > 0 ? Math.round((receipt.serviceChargeCents / itemsCents) * 100) : 0;
  return (
    <div className="receipt-wrap">
      <div className="receipt">
        <div className="r-head">
          <div className="r-title">Ч Е К</div>
          <div className="r-sub">розпізнано</div>
        </div>
        <hr className="r-div" />
        {itemsMeta.map((it) => (
          <div className={`r-item${editable && it.confidence < 0.8 ? " low" : ""}`} key={it.id}>
            <div className="r-row">
              <span className="r-name">{it.name}</span>
              <span className="r-dots" />
              <span className="r-amt">{money(it.unitPriceCents * it.qty)}</span>
            </div>
            {it.qty > 1 && (
              <div className="r-qty">
                {it.qty} x {money(it.unitPriceCents)}
              </div>
            )}
          </div>
        ))}
        {receipt.serviceChargeCents > 0 && (
          <>
            <hr className="r-div" />
            <div className="r-row">
              <span className="r-name">Сервіс {svcPercent}%</span>
              <span className="r-dots" />
              <span className="r-amt">{money(receipt.serviceChargeCents)}</span>
            </div>
          </>
        )}
        <hr className="r-div" />
        <div className="r-total">
          <span>РАЗОМ</span>
          <span>{money(receipt.totalCents)}</span>
        </div>
        <div className="r-barcode" />
        <div className="r-foot">{itemsMeta.length} поз.</div>
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
  const hasLow = itemsMeta.some((it) => it.confidence < 0.8);
  return (
    <>
      <p className="screen-lead">
        Перевір, чи все правильно.{hasLow ? " Підсвічене - сумнівне." : ""}
      </p>
      <ReceiptRows receipt={receipt} itemsMeta={itemsMeta} editable />
      <div className="actions">
        <button className="btn-primary" onClick={onOk}>
          Все вірно
        </button>
      </div>
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
  const caption = parsing
    ? "Обробляю..."
    : listening
      ? "Слухаю... натисни, щоб завершити"
      : "Натисни і скажи, хто що брав";
  return (
    <>
      <ReceiptRows receipt={receipt} itemsMeta={itemsMeta} />
      <div className="mic-wrap">
        <motion.button
          className={`mic${listening ? " on" : ""}`}
          aria-label={listening ? "Завершити" : "Говорити"}
          onClick={onRecord}
          disabled={parsing}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
        >
          {listening ? <StopIcon /> : <MicIcon />}
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
          const color = person ? colorFor(person.id, people) : "var(--accent)";
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
      <p className="mic-cap center">Обери варіант</p>
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
              <div className="ava" style={{ background: colorFor(r.personId, people) }}>
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
          <span className="tick">
            <CheckIcon />
          </span>{" "}
          усе розкладено - сума сходиться
        </div>
      ) : (
        <div className="settled warn">Ще не все призначено</div>
      )}

      <div className="mic-wrap sm">
        <motion.button
          className={`mic sm${correcting ? " on" : ""}`}
          aria-label={correcting ? "Завершити" : "Виправити голосом"}
          onClick={onCorrect}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
        >
          {correcting ? <StopIcon /> : <MicIcon />}
        </motion.button>
        <span className="mic-cap">
          {correcting ? "Слухаю... натисни, щоб завершити" : "Виправити голосом"}
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

/* --------------------------------- іконки --------------------------------- */

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <path d="M12 18v4" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h3l1.4-2h7.2L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="7" y="7" width="10" height="10" rx="2.5" />
    </svg>
  );
}

// Декоративна ілюстрація чека для лендінга (не дані - просто графіка).
function ReceiptArt() {
  return (
    <svg className="hero-art" viewBox="0 0 120 150" fill="none" aria-hidden="true">
      <path
        d="M22 6 H98 V128 l-6.3 6 -6.3 -6 -6.3 6 -6.3 -6 -6.3 6 -6.3 -6 -6.3 6 -6.3 -6 -6.3 6 -6.3 -6 -6.3 6 -6.3 -6 V6 Z"
        fill="var(--paper)"
      />
      <rect x="45" y="20" width="30" height="5" rx="2.5" fill="var(--paper-ink)" />
      <rect x="32" y="40" width="56" height="3.5" rx="1.75" fill="var(--paper-line)" />
      <rect x="32" y="52" width="56" height="3.5" rx="1.75" fill="var(--paper-line)" />
      <rect x="32" y="64" width="56" height="3.5" rx="1.75" fill="var(--paper-line)" />
      <rect x="32" y="76" width="34" height="3.5" rx="1.75" fill="var(--paper-line)" />
      <rect x="32" y="96" width="56" height="8" rx="4" fill="var(--accent)" />
    </svg>
  );
}
