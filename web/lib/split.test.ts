// Перевірка рушія (без моделей). Запуск: npx tsx lib/split.test.ts
import { computeSplit, money, type Receipt, type Person, type UnitAssignment } from "./split";

let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "OK" : "XX"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
}

const people: Person[] = [
  { id: "me", name: "Я" },
  { id: "anya", name: "Аня" },
  { id: "sam", name: "Сем" },
];

// Чек: борщ x2 (120), кава x2 (65), піца 320 (спільна), сервіс 69. Разом 759.
const receipt: Receipt = {
  items: [
    { id: "borsch", name: "Борщ", qty: 2, unitPriceCents: 12000 },
    { id: "coffee", name: "Кава", qty: 2, unitPriceCents: 6500 },
    { id: "pizza", name: "Піца", qty: 1, unitPriceCents: 32000 },
  ],
  serviceChargeCents: 6900,
  totalCents: 75900,
};
const assign: UnitAssignment[] = [
  { itemId: "borsch", unitIndex: 0, personIds: ["me"] },
  { itemId: "borsch", unitIndex: 1, personIds: ["anya"] },
  { itemId: "coffee", unitIndex: 0, personIds: ["me"] },
  { itemId: "coffee", unitIndex: 1, personIds: ["sam"] },
  { itemId: "pizza", unitIndex: 0, personIds: ["me", "anya", "sam"] },
];

const r = computeSplit(receipt, people, assign);
check("базовий: усе призначено, ok=true", r.ok, JSON.stringify(r.unassigned));
check("базовий: сума часток = 75900", r.sumCents === 75900, `${r.sumCents}`);
check("базовий: totalMismatch=false", r.totalMismatch === false);

// Округлення
const three: Person[] = [
  { id: "a", name: "А" },
  { id: "b", name: "Б" },
  { id: "c", name: "В" },
];
const rr = (cents: number) =>
  computeSplit(
    { items: [{ id: "x", name: "X", qty: 1, unitPriceCents: cents }], serviceChargeCents: 0, totalCents: cents },
    three,
    [{ itemId: "x", unitIndex: 0, personIds: ["a", "b", "c"] }]
  );
const r100 = rr(100);
check("1 грн на 3 = 34+33+33, сума 100", r100.sumCents === 100 && r100.perPerson.map((p) => p.totalCents).join("+") === "34+33+33");
const r10 = rr(10);
check("10 коп на 3 = 4+3+3, сума 10", r10.sumCents === 10 && r10.perPerson.map((p) => p.totalCents).join("+") === "4+3+3");

// Сервіс: рівні дробові частини -> зайва копійка алфавітно першій за іменем
const svcPeople: Person[] = [
  { id: "z", name: "Аня" },
  { id: "a", name: "Борис" },
  { id: "m", name: "Костя" },
];
const rSvc = computeSplit(
  {
    items: [
      { id: "i1", name: "Один", qty: 1, unitPriceCents: 100 },
      { id: "i2", name: "Два", qty: 1, unitPriceCents: 100 },
      { id: "i3", name: "Три", qty: 1, unitPriceCents: 100 },
    ],
    serviceChargeCents: 1,
    totalCents: 301,
  },
  svcPeople,
  [
    { itemId: "i1", unitIndex: 0, personIds: ["z"] },
    { itemId: "i2", unitIndex: 0, personIds: ["a"] },
    { itemId: "i3", unitIndex: 0, personIds: ["m"] },
  ]
);
check(
  "залишок сервісу -> алфавітно перша (Аня, id=z)",
  rSvc.perPerson.find((p) => p.personId === "z")!.serviceCents === 1 &&
    rSvc.perPerson.filter((p) => p.personId !== "z").every((p) => p.serviceCents === 0)
);

// ФІКС 1: невідомий personId -> unknownPeople, ok=false, гроші НЕ додані нікому реальному
const rUnknown = computeSplit(
  { items: [{ id: "u", name: "У", qty: 1, unitPriceCents: 900 }], serviceChargeCents: 0, totalCents: 900 },
  people,
  [{ itemId: "u", unitIndex: 0, personIds: ["ghost"] }]
);
check(
  "невідомий personId -> unknownPeople=[ghost], ok=false, нікому реальному не нараховано",
  rUnknown.unknownPeople.includes("ghost") &&
    rUnknown.ok === false &&
    rUnknown.perPerson.every((p) => p.totalCents === 0),
  JSON.stringify(rUnknown.unknownPeople)
);

// ФІКС 2: дублікат personIds -> рівний поділ
const rDup = computeSplit(
  { items: [{ id: "d", name: "Д", qty: 1, unitPriceCents: 300 }], serviceChargeCents: 0, totalCents: 300 },
  people,
  [{ itemId: "d", unitIndex: 0, personIds: ["me", "me", "anya"] }]
);
check(
  "дублікат personIds [me,me,anya] -> 150/150, а не 200/100",
  rDup.perPerson.find((p) => p.personId === "me")!.totalCents === 150 &&
    rDup.perPerson.find((p) => p.personId === "anya")!.totalCents === 150
);

// ФІКС 3: порожній personIds -> unassigned
const rEmptyA = computeSplit(
  { items: [{ id: "e", name: "Е", qty: 1, unitPriceCents: 500 }], serviceChargeCents: 0, totalCents: 500 },
  people,
  [{ itemId: "e", unitIndex: 0, personIds: [] }]
);
check("порожній personIds -> unassigned=[Е], ok=false", rEmptyA.unassigned.includes("Е") && rEmptyA.ok === false);

// ФІКС 4: непризначене -> ok=false, але сума РЕШТИ коректна
const rPartial = computeSplit(receipt, people, assign.slice(0, 2));
check(
  "часткове призначення -> ok=false, unassigned не порожній",
  rPartial.ok === false && rPartial.unassigned.length > 0
);

// ФІКС 5: totalMismatch окремо від unassigned (усе призначено, але підсумок з чека кривий)
const rMismatch = computeSplit({ ...receipt, totalCents: 99999 }, people, assign);
check(
  "кривий підсумок чека -> ok=true (усе призначено), totalMismatch=true",
  rMismatch.ok === true && rMismatch.totalMismatch === true
);

// money()
check("money: 15489 -> 154,89", money(15489) === "154,89");
check("money: 899 -> 8,99", money(899) === "8,99");
check("money: 5 -> 0,05", money(5) === "0,05");
check("money: нецілі округлюються", money(12345.67) === "123,46");

console.log(failed === 0 ? "\nУСІ ПРОЙДЕНО" : `\n${failed} ПРОВАЛЕНО`);
process.exit(failed === 0 ? 0 : 1);
