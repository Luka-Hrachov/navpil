"use client";

import { motion, Variants } from "framer-motion";
import { useEffect, useState } from "react";

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};

function useCountUp(to: number, dur = 650) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    let t0: number | null = null;
    const step = (ts: number) => {
      if (t0 === null) t0 = ts;
      const p = Math.min((ts - t0) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setV(to * e);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, dur]);
  return v;
}

const money = (n: number) => n.toFixed(2).replace(".", ",");

function PersonSum({ to }: { to: number }) {
  const v = useCountUp(to);
  return <div className="sum">{money(v)}</div>;
}

export default function ReceiptScreen() {
  return (
    <motion.div className="phone" variants={container} initial="hidden" animate="show">
      <motion.div className="top" variants={item}>
        <div className="logo">Н</div>
        <div className="brand">
          <h1>Навпіл</h1>
          <span>рахунок голосом</span>
        </div>
        <span className="chip">
          <span className="dot" />
          розпізнано
        </span>
      </motion.div>

      <motion.div className="card" variants={item}>
        <h3>Чек · Ресторан «Веранда»</h3>
        <div className="row">
          <span className="nm">
            Борщ <span className="q">×2</span>
          </span>
          <span className="amt">240,00</span>
        </div>
        <div className="row">
          <span className="nm">
            Кава <span className="q">×2</span>
          </span>
          <span className="amt">130,00</span>
        </div>
        <div className="row">
          <span className="nm">
            Піца <span className="tag">спільна</span>
          </span>
          <span className="amt">320,00</span>
        </div>
        <div className="row">
          <span className="nm">
            Сервіс <span className="q">10%</span>
          </span>
          <span className="amt">69,00</span>
        </div>
        <div className="row total">
          <span className="nm">Разом</span>
          <span className="amt">759,00</span>
        </div>
      </motion.div>

      <motion.div className="mic-wrap" variants={item}>
        <motion.button
          className="mic"
          aria-label="Говорити"
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
            <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
            <path d="M12 18v4" />
          </svg>
        </motion.button>
        <span className="mic-cap">натисни і скажи, хто що брав</span>
      </motion.div>

      <motion.div className="people" variants={item}>
        <div className="person">
          <div className="ava" style={{ background: "var(--p1)" }}>
            Я
          </div>
          <div className="who">Я</div>
          <PersonSum to={285} />
        </div>
        <div className="person">
          <div className="ava" style={{ background: "var(--p2)" }}>
            А
          </div>
          <div className="who">Аня</div>
          <PersonSum to={210} />
        </div>
        <div className="person">
          <div className="ava" style={{ background: "var(--p3)" }}>
            С
          </div>
          <div className="who">Сем</div>
          <PersonSum to={264} />
        </div>
      </motion.div>

      <motion.div className="settled" variants={item}>
        <span className="tick">✓</span> усе розкладено · сума сходиться
      </motion.div>
    </motion.div>
  );
}
