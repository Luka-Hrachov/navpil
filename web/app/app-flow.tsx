"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import {
  computeSplit,
  money,
  type Person,
  type Receipt,
  type UnitAssignment,
} from "@/lib/split";

/* ------------------- мок-дані (замість моделей на цьому етапі) ------------------- */

const PEOPLE: Person[] = [
  { id: "me", name: "Я" },
  { id: "anya", name: "Аня" },
  { id: "sam", name: "Сем" },
];
const COLORS: Record<string, string> = { me: "var(--p1)", anya: "var(--p2)", sam: "var(--p3)" };

const SAMPLE: Receipt & { itemsMeta: { id: string; name: string; qty: number; unitPriceCents: number; confidence: number }[] } = {
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

// призначення після голосу (другу каву не сказали -> уточнимо)
const BASE_ASSIGN: UnitAssignment[] = [
  { itemId: "borsch", unitIndex: 0, personIds: ["me"] },
  { itemId: "borsch", unitIndex: 1, personIds: ["me"] },
  { itemId: "coffee", unitIndex: 0, personIds: ["me"] },
  { itemId: "pizza", unitIndex: 0, personIds: ["me", "anya", "sam"] },
];

type Screen = "upload" | "recognizing" | "confirm" | "listen" | "clarify" | "result";

const fade = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.25 } },
};

/* --------------------------------- застосунок --------------------------------- */

export default function AppFlow() {
  const [screen, setScreen] = useState<Screen>("upload");
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [assignments, setAssignments] = useState<UnitAssignment[]>([]);

  const receipt: Receipt = SAMPLE;

  const result = useMemo(
    () => computeSplit(receipt, PEOPLE, assignments),
    [assignments]
  );

  function pickPhoto() {
    setScreen("recognizing");
    window.setTimeout(() => setScreen("confirm"), 1400); // мок: «розпізнавання»
  }
  function confirmOk() {
    setScreen("listen");
  }
  function record() {
    setListening(true);
    window.setTimeout(() => {
      setTranscript(MOCK_TRANSCRIPT);
      setListening(false);
      setAssignments(BASE_ASSIGN);
      setScreen("clarify"); // друга кава неоднозначна
    }, 1700);
  }
  function answerClarify(personId: string) {
    setAssignments((a) => [...a, { itemId: "coffee", unitIndex: 1, personIds: [personId] }]);
    setScreen("result");
  }
  function correct() {
    // демо голосового виправлення: «другу каву брав Сем»
    setAssignments((a) => {
      const rest = a.filter((x) => !(x.itemId === "coffee" && x.unitIndex === 1));
      return [...rest, { itemId: "coffee", unitIndex: 1, personIds: ["sam"] }];
    });
  }
  function reset() {
    setScreen("upload");
    setTranscript("");
    setAssignments([]);
  }

  return (
    <main className="stage">
      <div className="phone">
        <Header />
        <AnimatePresence mode="wait">
          {screen === "upload" && (
            <motion.div key="upload" {...fade}>
              <Upload onPick={pickPhoto} />
            </motion.div>
          )}
          {screen === "recognizing" && (
            <motion.div key="rec" {...fade}>
              <Recognizing />
            </motion.div>
          )}
          {screen === "confirm" && (
            <motion.div key="confirm" {...fade}>
              <Confirm onOk={confirmOk} />
            </motion.div>
          )}
          {screen === "listen" && (
            <motion.div key="listen" {...fade}>
              <Listen listening={listening} transcript={transcript} onRecord={record} />
            </motion.div>
          )}
          {screen === "clarify" && (
            <motion.div key="clarify" {...fade}>
              <Clarify onAnswer={answerClarify} />
            </motion.div>
          )}
          {screen === "result" && (
            <motion.div key="result" {...fade}>
              <Result result={result} onCorrect={correct} onReset={reset} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}

/* --------------------------------- екрани --------------------------------- */

function Header() {
  return (
    <div className="top">
      <div className="logo">Н</div>
      <div className="brand">
        <h1>Навпіл</h1>
        <span>рахунок голосом</span>
      </div>
    </div>
  );
}

function Upload({ onPick }: { onPick: () => void }) {
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

function ReceiptRows({ editable = false }: { editable?: boolean }) {
  return (
    <div className="card">
      <h3>Чек · Ресторан «Веранда»</h3>
      {SAMPLE.itemsMeta.map((it) => (
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
          Сервіс <span className="q">10%</span>
        </span>
        <span className="amt">{money(SAMPLE.serviceChargeCents)}</span>
      </div>
      <div className="row total">
        <span className="nm">Разом</span>
        <span className="amt">{money(SAMPLE.totalCents)}</span>
      </div>
    </div>
  );
}

function Confirm({ onOk }: { onOk: () => void }) {
  return (
    <>
      <p className="screen-lead">Перевір, чи все правильно. Підсвічене — сумнівне.</p>
      <ReceiptRows editable />
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
  listening,
  transcript,
  onRecord,
}: {
  listening: boolean;
  transcript: string;
  onRecord: () => void;
}) {
  return (
    <>
      <ReceiptRows />
      <div className="mic-wrap">
        <motion.button
          className={`mic${listening ? " on" : ""}`}
          aria-label="Говорити"
          onClick={onRecord}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
        >
          <MicIcon />
        </motion.button>
        <span className="mic-cap">
          {listening ? "Слухаю…" : "Натисни і скажи, хто що брав"}
        </span>
      </div>
      {transcript && <div className="bubble">{transcript}</div>}
    </>
  );
}

function Clarify({ onAnswer }: { onAnswer: (id: string) => void }) {
  return (
    <div className="sheet">
      <p className="screen-lead">Дві кави — хто брав другу?</p>
      <div className="chips">
        {PEOPLE.map((p) => (
          <button key={p.id} className="chip-btn" onClick={() => onAnswer(p.id)}>
            <span className="ava sm" style={{ background: COLORS[p.id] }}>
              {p.name[0]}
            </span>
            {p.name}
          </button>
        ))}
      </div>
      <p className="mic-cap center">Обери або скажи голосом</p>
    </div>
  );
}

function Result({
  result,
  onCorrect,
  onReset,
}: {
  result: ReturnType<typeof computeSplit>;
  onCorrect: () => void;
  onReset: () => void;
}) {
  return (
    <>
      <div className="people">
        {result.perPerson.map((r) => {
          const p = PEOPLE.find((x) => x.id === r.personId)!;
          return (
            <motion.div
              key={r.personId}
              className="person"
              layout
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 22 }}
            >
              <div className="ava" style={{ background: COLORS[p.id] }}>
                {p.name[0]}
              </div>
              <div className="who">{p.name}</div>
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
          className="mic sm"
          aria-label="Виправити голосом"
          onClick={onCorrect}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
        >
          <MicIcon />
        </motion.button>
        <span className="mic-cap">Виправити голосом · напр. «другу каву брав Сем»</span>
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
