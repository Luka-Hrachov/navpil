// Детермінований рушій підрахунку. Усе в копійках (цілі числа), без float-похибок.
// Модель сюди НЕ втручається - вона лише дає структуру; суми рахує цей код.
// Рушій НЕ довіряє вхідним даним: невідомі люди, дублікати, порожні призначення
// обробляються явно (issues), а не тихо ламають суми.

export type Cents = number; // завжди ціле

export interface Item {
  id: string;
  name: string;
  qty: number;
  unitPriceCents: Cents;
}

export interface Person {
  id: string;
  name: string;
}

/** Призначення однієї одиниці товару: хто її ділить (порівну). */
export interface UnitAssignment {
  itemId: string;
  unitIndex: number; // 0..qty-1
  personIds: string[]; // 1 = чиясь; >1 = спільна
}

export interface Receipt {
  items: Item[];
  serviceChargeCents: Cents;
  totalCents: Cents; // підсумок з чека (для перевірки розпізнавання)
}

export interface PersonResult {
  personId: string;
  subtotalCents: Cents;
  serviceCents: Cents;
  totalCents: Cents;
}

export interface SplitResult {
  perPerson: PersonResult[];
  /** Усе призначено дійсним людям - можна показувати як готовий розподіл. */
  ok: boolean;
  /** Назви позицій, що лишились без власника (треба призначити/уточнити). */
  unassigned: string[];
  /** personId у призначеннях, яких немає серед people (баг даних) - їхні гроші НЕ враховані. */
  unknownPeople: string[];
  /** true, якщо надрукований підсумок чека не збігається з сумою позицій+сервіс (ймовірна помилка розпізнавання фото). */
  totalMismatch: boolean;
  sumCents: Cents; // фактично розподілена сума
  expectedCents: Cents; // усі позиції + сервіс
  receiptTotalCents: Cents; // підсумок, надрукований на чеку
}

/** Стабільний порядок людей: за іменем (укр), при рівності - за id. */
function stableOrder(people: Person[]): Person[] {
  return [...people].sort(
    (a, b) => a.name.localeCompare(b.name, "uk") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

const unitKey = (itemId: string, u: number) => `${itemId}#${u}`;

export function computeSplit(
  receipt: Receipt,
  people: Person[],
  assignments: UnitAssignment[]
): SplitResult {
  const order = stableOrder(people);
  const orderIndex = new Map(order.map((p, i) => [p.id, i]));
  const known = new Set(people.map((p) => p.id));
  const subtotal = new Map<string, Cents>(people.map((p) => [p.id, 0]));
  const unassigned: string[] = [];
  const unknownPeople = new Set<string>();

  const byUnit = new Map<string, string[]>();
  for (const a of assignments) byUnit.set(unitKey(a.itemId, a.unitIndex), a.personIds);

  // 1) Розкидати кожну одиницю по її ДІЙСНИХ людях; залишок від ділення - за стабільним порядком.
  let itemsCents = 0;
  for (const it of receipt.items) {
    const qty = Math.max(0, Math.floor(it.qty)); // від'ємне/дробове -> 0 одиниць
    for (let u = 0; u < qty; u++) {
      itemsCents += it.unitPriceCents;
      const raw = byUnit.get(unitKey(it.id, u)) ?? [];
      for (const pid of raw) if (!known.has(pid)) unknownPeople.add(pid);
      // дедуплікація + лише відомі люди
      const ppl = [...new Set(raw)]
        .filter((pid) => known.has(pid))
        .sort((x, y) => (orderIndex.get(x) ?? 1e9) - (orderIndex.get(y) ?? 1e9));
      if (ppl.length === 0) {
        unassigned.push(it.name);
        continue;
      }
      const base = Math.floor(it.unitPriceCents / ppl.length);
      let rem = it.unitPriceCents - base * ppl.length;
      for (const pid of ppl) {
        let add = base;
        if (rem > 0) {
          add += 1;
          rem -= 1;
        }
        subtotal.set(pid, (subtotal.get(pid) ?? 0) + add);
      }
    }
  }

  // 2) Сервісний збір пропорційно до підсумку; залишок - найбільша дробова частина, при рівності - алфавіт.
  const sumSub = [...subtotal.values()].reduce((a, b) => a + b, 0);
  const service = new Map<string, Cents>(people.map((p) => [p.id, 0]));
  const svc = receipt.serviceChargeCents;
  if (svc > 0 && sumSub > 0) {
    const fracs: { pid: string; frac: number }[] = [];
    let assigned = 0;
    for (const p of people) {
      const exact = (svc * (subtotal.get(p.id) ?? 0)) / sumSub;
      const fl = Math.floor(exact);
      service.set(p.id, fl);
      assigned += fl;
      fracs.push({ pid: p.id, frac: exact - fl });
    }
    let rem = svc - assigned;
    fracs.sort(
      (a, b) => b.frac - a.frac || (orderIndex.get(a.pid) ?? 0) - (orderIndex.get(b.pid) ?? 0)
    );
    for (let i = 0; i < fracs.length && rem > 0; i++) {
      service.set(fracs[i].pid, (service.get(fracs[i].pid) ?? 0) + 1);
      rem -= 1;
    }
  }

  // 3) Разом = підсумок + частка сервісу.
  const perPerson: PersonResult[] = people.map((p) => {
    const st = subtotal.get(p.id) ?? 0;
    const sv = service.get(p.id) ?? 0;
    return { personId: p.id, subtotalCents: st, serviceCents: sv, totalCents: st + sv };
  });

  const sumCents = perPerson.reduce((a, b) => a + b.totalCents, 0);
  const expectedCents = itemsCents + svc;
  const totalMismatch = receipt.totalCents > 0 && receipt.totalCents !== expectedCents;
  const ok = receipt.items.length > 0 && unassigned.length === 0 && unknownPeople.size === 0;

  return {
    perPerson,
    ok,
    unassigned,
    unknownPeople: [...unknownPeople],
    totalMismatch,
    sumCents,
    expectedCents,
    receiptTotalCents: receipt.totalCents,
  };
}

/** Копійки -> рядок '123,45'. Нецілі копійки округлюються (захист від некоректного вводу). */
export function money(cents: Cents): string {
  const c = Math.round(cents);
  const sign = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}
