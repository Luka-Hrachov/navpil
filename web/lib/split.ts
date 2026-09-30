// Детермінований рушій підрахунку. Усе в копійках (цілі числа), без float-похибок.
// Модель сюди НЕ втручається - вона лише дає структуру; суми рахує цей код.

export type Cents = number; // завжди ціле

export interface Item {
  id: string;
  name: string;
  qty: number;
  unitPriceCents: Cents; // ціна за одну одиницю
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
  serviceChargeCents: Cents; // сервісний збір як сума
  totalCents: Cents; // підсумок з чека (для перевірки інваріанта)
}

export interface PersonResult {
  personId: string;
  subtotalCents: Cents;
  serviceCents: Cents;
  totalCents: Cents;
}

export interface SplitResult {
  perPerson: PersonResult[];
  ok: boolean; // усе призначено й суми сходяться
  issues: string[]; // що не так (непризначене, розбіжність суми)
  sumCents: Cents; // сума всіх часток
  expectedCents: Cents; // позиції + сервіс
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
  const subtotal = new Map<string, Cents>(people.map((p) => [p.id, 0]));
  const issues: string[] = [];

  const byUnit = new Map<string, string[]>();
  for (const a of assignments) byUnit.set(unitKey(a.itemId, a.unitIndex), a.personIds);

  // 1) Розкидати кожну одиницю по її людях; залишок від ділення - за стабільним порядком.
  let itemsCents = 0;
  for (const it of receipt.items) {
    for (let u = 0; u < it.qty; u++) {
      itemsCents += it.unitPriceCents;
      const sharers = byUnit.get(unitKey(it.id, u));
      if (!sharers || sharers.length === 0) {
        issues.push(`Не призначено: ${it.name} (одиниця ${u + 1})`);
        continue;
      }
      const ppl = [...sharers].sort(
        (x, y) => (orderIndex.get(x) ?? 1e9) - (orderIndex.get(y) ?? 1e9)
      );
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

  // 2) Сервісний збір пропорційно до підсумку; залишок - тим, у кого найбільша дробова частина.
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

  // 4) Інваріанти.
  const sumCents = perPerson.reduce((a, b) => a + b.totalCents, 0);
  const expectedCents = itemsCents + svc;
  if (sumCents !== expectedCents) {
    issues.push(`Сума часток (${sumCents}) != позиції+сервіс (${expectedCents})`);
  }
  if (receipt.totalCents !== expectedCents) {
    issues.push(`Підсумок чека (${receipt.totalCents}) != позиції+сервіс (${expectedCents})`);
  }

  return { perPerson, ok: issues.length === 0, issues, sumCents, expectedCents };
}

/** Копійки -> рядок '123,45'. */
export function money(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}
