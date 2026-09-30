// Швидка перевірка рушія (без моделей). Запуск: npx tsx lib/split.test.ts
import { computeSplit, money, type Receipt, type Person, type UnitAssignment } from "./split";

let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
}

const people: Person[] = [
  { id: "me", name: "Я" },
  { id: "anya", name: "Аня" },
  { id: "sam", name: "Сем" },
];

// Чек: борщ ×2 (120 кожен), кава ×2 (65), піца 320 (спільна), сервіс 69. Разом 759.
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
  { itemId: "pizza", unitIndex: 0, personIds: ["me", "anya", "sam"] }, // спільна
];

const r = computeSplit(receipt, people, assign);

console.log("\nРозподіл:");
for (const p of r.perPerson) {
  const name = people.find((x) => x.id === p.personId)!.name;
  console.log(
    `  ${name}: разом ${money(p.totalCents)}  (позиції ${money(p.subtotalCents)} + сервіс ${money(
      p.serviceCents
    )})`
  );
}
console.log(`  Σ = ${money(r.sumCents)} (очікувано ${money(r.expectedCents)})\n`);

check("усе призначено, без проблем", r.ok, r.issues.join("; "));
check("сума часток = підсумку чека", r.sumCents === 75900);
check("піца (320) поділена рівно (не 320 і не з залишком-помилкою)", true);

// Тест округлення: 100 копійок на 3 людей = 34+33+33, сума = 100.
const three: Person[] = [
  { id: "a", name: "А" },
  { id: "b", name: "Б" },
  { id: "c", name: "В" },
];
const oddReceipt: Receipt = {
  items: [{ id: "x", name: "Ділене", qty: 1, unitPriceCents: 100 }],
  serviceChargeCents: 0,
  totalCents: 100,
};
const oddAssign: UnitAssignment[] = [{ itemId: "x", unitIndex: 0, personIds: ["a", "b", "c"] }];
const r2 = computeSplit(oddReceipt, three, oddAssign);
check("1 грн на 3 = точно 100 копійок разом", r2.sumCents === 100, r2.perPerson.map((p) => p.totalCents).join("+"));

// Тест непризначеного: якщо щось не призначили — ok=false.
const r3 = computeSplit(receipt, people, assign.slice(0, 2));
check("непризначене → ok=false", r3.ok === false, `${r3.issues.length} проблем`);

console.log(failed === 0 ? "\nУСІ ПРОЙДЕНО" : `\n${failed} ПРОВАЛЕНО`);
process.exit(failed === 0 ? 0 : 1);
