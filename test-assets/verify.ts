// Звірка ground-truth для тестового набору "Навпіл" з реальним рушієм computeSplit.
// НІЯКИХ викликів моделей/мережі - лише детермінований імпорт lib/split.ts.
// Запуск (офлайн, без npx/мережі):
//   cd test-assets && ../web/node_modules/.bin/tsx verify.ts
import { computeSplit, money, type Receipt, type Person, type UnitAssignment } from "../web/lib/split";

let failed = 0;
function expect(scenario: string, label: string, actual: number, expected: number) {
  const ok = actual === expected;
  console.log(`${ok ? "OK" : "XX"} [${scenario}] ${label}: actual=${actual} expected=${expected}`);
  if (!ok) failed++;
}
function expectBool(scenario: string, label: string, actual: boolean, expected: boolean) {
  const ok = actual === expected;
  console.log(`${ok ? "OK" : "XX"} [${scenario}] ${label}: actual=${actual} expected=${expected}`);
  if (!ok) failed++;
}
function dump(scenario: string, r: ReturnType<typeof computeSplit>, people: Person[]) {
  for (const p of people) {
    const pr = r.perPerson.find((x) => x.personId === p.id)!;
    console.log(
      `   ${scenario} :: ${p.name.padEnd(8)} subtotal=${pr.subtotalCents} service=${pr.serviceCents} total=${pr.totalCents} (${money(pr.totalCents)} грн)`
    );
  }
  console.log(`   ${scenario} :: sum=${r.sumCents} expected=${r.expectedCents} receiptTotal=${r.receiptTotalCents} ok=${r.ok} unassigned=${JSON.stringify(r.unassigned)} totalMismatch=${r.totalMismatch}`);
}

// ============================================================
// Сценарій 1: normal - 3 людини, кожен за своє
// ============================================================
{
  const people: Person[] = [
    { id: "me", name: "Я" },
    { id: "nastya", name: "Настя" },
    { id: "igor", name: "Ігор" },
  ];
  const receipt: Receipt = {
    items: [
      { id: "cappuccino", name: "Капучино", qty: 1, unitPriceCents: 6500 },
      { id: "croissant", name: "Круасан з мигдалем", qty: 1, unitPriceCents: 8500 },
      { id: "latte", name: "Лате", qty: 1, unitPriceCents: 7500 },
      { id: "tiramisu", name: "Тірамісу", qty: 1, unitPriceCents: 12000 },
      { id: "americano", name: "Американо", qty: 1, unitPriceCents: 5500 },
      { id: "syrnyky", name: "Сирники", qty: 1, unitPriceCents: 13500 },
    ],
    serviceChargeCents: 0,
    totalCents: 53500,
  };
  const assignments: UnitAssignment[] = [
    { itemId: "cappuccino", unitIndex: 0, personIds: ["me"] },
    { itemId: "croissant", unitIndex: 0, personIds: ["me"] },
    { itemId: "latte", unitIndex: 0, personIds: ["nastya"] },
    { itemId: "tiramisu", unitIndex: 0, personIds: ["nastya"] },
    { itemId: "americano", unitIndex: 0, personIds: ["igor"] },
    { itemId: "syrnyky", unitIndex: 0, personIds: ["igor"] },
  ];
  const r = computeSplit(receipt, people, assignments);
  dump("scenario1", r, people);
  expectBool("scenario1", "ok", r.ok, true);
  expect("scenario1", "Я.total", r.perPerson.find((p) => p.personId === "me")!.totalCents, 15000);
  expect("scenario1", "Настя.total", r.perPerson.find((p) => p.personId === "nastya")!.totalCents, 19500);
  expect("scenario1", "Ігор.total", r.perPerson.find((p) => p.personId === "igor")!.totalCents, 19000);
  expect("scenario1", "sumCents", r.sumCents, 53500);
  expectBool("scenario1", "totalMismatch", r.totalMismatch, false);
}

// ============================================================
// Сценарій 2: shared - спільна піца на всіх + решта окремо, сервіс 10%
// ============================================================
{
  const people: Person[] = [
    { id: "me", name: "Я" },
    { id: "marko", name: "Марко" },
    { id: "yulya", name: "Юля" },
  ];
  const receipt: Receipt = {
    items: [
      { id: "pizza", name: "Піца Маргарита", qty: 1, unitPriceCents: 32000 },
      { id: "caesar", name: "Салат Цезар", qty: 1, unitPriceCents: 14500 },
      { id: "tiramisu", name: "Тірамісу", qty: 1, unitPriceCents: 11000 },
      { id: "mors", name: "Морс домашній", qty: 2, unitPriceCents: 4000 },
      { id: "coffee", name: "Кава", qty: 1, unitPriceCents: 5500 },
    ],
    serviceChargeCents: 7100,
    totalCents: 78100,
  };
  const assignments: UnitAssignment[] = [
    { itemId: "pizza", unitIndex: 0, personIds: ["me", "marko", "yulya"] },
    { itemId: "caesar", unitIndex: 0, personIds: ["me"] },
    { itemId: "tiramisu", unitIndex: 0, personIds: ["marko"] },
    { itemId: "mors", unitIndex: 0, personIds: ["marko"] },
    { itemId: "mors", unitIndex: 1, personIds: ["yulya"] },
    { itemId: "coffee", unitIndex: 0, personIds: ["yulya"] },
  ];
  const r = computeSplit(receipt, people, assignments);
  dump("scenario2", r, people);
  expectBool("scenario2", "ok", r.ok, true);
  expect("scenario2", "Я.total", r.perPerson.find((p) => p.personId === "me")!.totalCents, 27682);
  expect("scenario2", "Марко.total", r.perPerson.find((p) => p.personId === "marko")!.totalCents, 28234);
  expect("scenario2", "Юля.total", r.perPerson.find((p) => p.personId === "yulya")!.totalCents, 22184);
  expect("scenario2", "sumCents", r.sumCents, 78100);
  expectBool("scenario2", "totalMismatch", r.totalMismatch, false);
}

// ============================================================
// Сценарій 3: correction - ДО і ПІСЛЯ голосового виправлення
// "Насправді другу каву взяв Сем" -> coffee unitIndex=1 переходить від Олі до Сема
// ============================================================
{
  const people: Person[] = [
    { id: "me", name: "Я" },
    { id: "olya", name: "Оля" },
    { id: "sam", name: "Сем" },
  ];
  const receipt: Receipt = {
    items: [
      { id: "borsch", name: "Борщ", qty: 1, unitPriceCents: 12000 },
      { id: "salad", name: "Салат овочевий", qty: 1, unitPriceCents: 9500 },
      { id: "coffee", name: "Кава", qty: 2, unitPriceCents: 6500 },
      { id: "steak", name: "Стейк з телятини", qty: 1, unitPriceCents: 25000 },
    ],
    serviceChargeCents: 0,
    totalCents: 59500,
  };
  const before: UnitAssignment[] = [
    { itemId: "borsch", unitIndex: 0, personIds: ["me"] },
    { itemId: "salad", unitIndex: 0, personIds: ["olya"] },
    { itemId: "coffee", unitIndex: 0, personIds: ["olya"] },
    { itemId: "coffee", unitIndex: 1, personIds: ["olya"] }, // помилка: обидві кави записані на Олю
    { itemId: "steak", unitIndex: 0, personIds: ["sam"] },
  ];
  const rBefore = computeSplit(receipt, people, before);
  dump("scenario3-before", rBefore, people);
  expectBool("scenario3-before", "ok", rBefore.ok, true);
  expect("scenario3-before", "Я.total", rBefore.perPerson.find((p) => p.personId === "me")!.totalCents, 12000);
  expect("scenario3-before", "Оля.total", rBefore.perPerson.find((p) => p.personId === "olya")!.totalCents, 22500);
  expect("scenario3-before", "Сем.total", rBefore.perPerson.find((p) => p.personId === "sam")!.totalCents, 25000);

  // Голосове виправлення: "насправді другу каву брав Сем" -> coffee#1: olya -> sam
  const after: UnitAssignment[] = before.map((a) =>
    a.itemId === "coffee" && a.unitIndex === 1 ? { ...a, personIds: ["sam"] } : a
  );
  const rAfter = computeSplit(receipt, people, after);
  dump("scenario3-after", rAfter, people);
  expectBool("scenario3-after", "ok", rAfter.ok, true);
  expect("scenario3-after", "Я.total", rAfter.perPerson.find((p) => p.personId === "me")!.totalCents, 12000);
  expect("scenario3-after", "Оля.total", rAfter.perPerson.find((p) => p.personId === "olya")!.totalCents, 16000);
  expect("scenario3-after", "Сем.total", rAfter.perPerson.find((p) => p.personId === "sam")!.totalCents, 31500);
  expect("scenario3-after", "sumCents", rAfter.sumCents, 59500);
}

// ============================================================
// Сценарій 4: ambiguous - 2 однакові кави, сказано лише про одну -> clarification
// ============================================================
{
  const people: Person[] = [
    { id: "me", name: "Я" },
    { id: "liza", name: "Ліза" },
    { id: "taras", name: "Тарас" },
  ];
  const receipt: Receipt = {
    items: [
      { id: "cappuccino", name: "Капучино", qty: 2, unitPriceCents: 6000 },
      { id: "sandwich", name: "Сендвіч з куркою", qty: 1, unitPriceCents: 9500 },
      { id: "muffin", name: "Мафін чорничний", qty: 1, unitPriceCents: 5500 },
    ],
    serviceChargeCents: 0,
    totalCents: 27000,
  };
  // ДО уточнення: "Я взяв каву" -> unit0 призначено Я; unit1 не згадано зовсім
  const beforeClarify: UnitAssignment[] = [
    { itemId: "cappuccino", unitIndex: 0, personIds: ["me"] },
    { itemId: "cappuccino", unitIndex: 1, personIds: [] }, // не розпізнано з голосу
    { itemId: "sandwich", unitIndex: 0, personIds: ["liza"] },
    { itemId: "muffin", unitIndex: 0, personIds: ["taras"] },
  ];
  const rBefore = computeSplit(receipt, people, beforeClarify);
  dump("scenario4-before", rBefore, people);
  expectBool("scenario4-before", "ok (має бути false - непризначено)", rBefore.ok, false);
  expectBool("scenario4-before", "'Капучино' в unassigned", rBefore.unassigned.includes("Капучино"), true);
  expect("scenario4-before", "sumCents (без 2ї кави)", rBefore.sumCents, 21000);

  // ПІСЛЯ відповіді на clarification: "другу каву взяв Тарас"
  const afterClarify: UnitAssignment[] = [
    { itemId: "cappuccino", unitIndex: 0, personIds: ["me"] },
    { itemId: "cappuccino", unitIndex: 1, personIds: ["taras"] },
    { itemId: "sandwich", unitIndex: 0, personIds: ["liza"] },
    { itemId: "muffin", unitIndex: 0, personIds: ["taras"] },
  ];
  const rAfter = computeSplit(receipt, people, afterClarify);
  dump("scenario4-after", rAfter, people);
  expectBool("scenario4-after", "ok", rAfter.ok, true);
  expect("scenario4-after", "Я.total", rAfter.perPerson.find((p) => p.personId === "me")!.totalCents, 6000);
  expect("scenario4-after", "Ліза.total", rAfter.perPerson.find((p) => p.personId === "liza")!.totalCents, 9500);
  expect("scenario4-after", "Тарас.total", rAfter.perPerson.find((p) => p.personId === "taras")!.totalCents, 11500);
  expect("scenario4-after", "sumCents", rAfter.sumCents, 27000);
}

// ============================================================
// Сценарій 5: unreadable - одна позиція на фото розмита (Хумус з питою).
// Ground-truth нижче відповідає стану ПІСЛЯ підтвердження/виправлення користувачем
// (Екран 3 циклу "Виправити"); сама модель на цьому не тестується.
// ============================================================
{
  const people: Person[] = [
    { id: "me", name: "Я" },
    { id: "nastya", name: "Настя" },
    { id: "dmytro", name: "Дмитро" },
  ];
  const receipt: Receipt = {
    items: [
      { id: "burger", name: "Бургер класичний", qty: 1, unitPriceCents: 16500 },
      { id: "fries", name: "Картопля фрі", qty: 1, unitPriceCents: 5500 },
      { id: "hummus", name: "Хумус з питою", qty: 1, unitPriceCents: 13000 }, // <- розмита позиція на фото
      { id: "lemonade", name: "Лимонад домашній", qty: 1, unitPriceCents: 6000 },
      { id: "nuggets", name: "Наггетси", qty: 1, unitPriceCents: 9500 },
    ],
    serviceChargeCents: 5050,
    totalCents: 55550,
  };
  const assignments: UnitAssignment[] = [
    { itemId: "burger", unitIndex: 0, personIds: ["me"] },
    { itemId: "fries", unitIndex: 0, personIds: ["me"] },
    { itemId: "hummus", unitIndex: 0, personIds: ["nastya"] },
    { itemId: "lemonade", unitIndex: 0, personIds: ["dmytro"] },
    { itemId: "nuggets", unitIndex: 0, personIds: ["dmytro"] },
  ];
  const r = computeSplit(receipt, people, assignments);
  dump("scenario5", r, people);
  expectBool("scenario5", "ok", r.ok, true);
  expect("scenario5", "Я.total", r.perPerson.find((p) => p.personId === "me")!.totalCents, 24200);
  expect("scenario5", "Настя.total", r.perPerson.find((p) => p.personId === "nastya")!.totalCents, 14300);
  expect("scenario5", "Дмитро.total", r.perPerson.find((p) => p.personId === "dmytro")!.totalCents, 17050);
  expect("scenario5", "sumCents", r.sumCents, 55550);
  expectBool("scenario5", "totalMismatch", r.totalMismatch, false);
}

console.log(failed === 0 ? "\nУСІ СЦЕНАРІЇ ЗІЙШЛИСЯ" : `\n${failed} РОЗБІЖНОСТЕЙ`);
process.exit(failed === 0 ? 0 : 1);
