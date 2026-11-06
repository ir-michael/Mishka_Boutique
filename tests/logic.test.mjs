// Lancer : node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import {
  orderTotals, allocateCosts, suggestPrice, paymentStatus, remaining, isOverdue, daysLate,
  saleProfit, periodStart, inPeriod, stockValues, num, round2,
} from "../js/logic.js";

const order = {
  lines: [{ qty: 2, unitPrice: 300 }, { qty: 5, unitPrice: 40 }],           // 600 + 200 = 800
  expenses: [{ amount: 20 }, { amount: 30 }],                                 // 50
  freight: { total: 70 },                                                    // 70
};

test("totaux de commande : articles + dépenses + frais de kilo", () => {
  const t = orderTotals(order);
  assert.deepEqual(t, { itemsTotal: 800, expensesTotal: 50, freightTotal: 70, totalCost: 920 });
});

test("répartition au prorata de la valeur : la somme des coûts de revient = coût total de la commande", () => {
  const extra = 50 + 70;
  const a = allocateCosts(order.lines, extra, "value");
  // part du frais : 600/800 -> 90 pour l'ordinateur (45/unité), 30 pour les accessoires (6/unité)
  assert.equal(a[0].landedUnitCost, 345);
  assert.equal(a[1].landedUnitCost, 46);
  const total = a[0].landedUnitCost * 2 + a[1].landedUnitCost * 5;
  assert.equal(round2(total), 920);
});

test("répartition par unité", () => {
  const a = allocateCosts(order.lines, 70, "unit");   // 10 par unité
  assert.equal(a[0].landedUnitCost, 310);
  assert.equal(a[1].landedUnitCost, 50);
});

test("répartition avec prix d'achat à 0 ne produit pas NaN", () => {
  const a = allocateCosts([{ qty: 2, unitPrice: 0 }, { qty: 2, unitPrice: 0 }], 40, "value");
  assert.equal(a[0].landedUnitCost, 10);
});

test("coût de revient non entier : l'arrondi reste sous 1 centime au total", () => {
  const lines = [{ qty: 3, unitPrice: 33.33 }];
  const a = allocateCosts(lines, 10, "value");
  assert.ok(Math.abs(a[0].landedUnitCost * 3 - (3 * 33.33 + 10)) < 0.01);
});

test("prix de vente suggéré avec marge", () => {
  assert.equal(suggestPrice(345, 20), 414);
  assert.equal(suggestPrice(0, 20), 0);
});

test("statut de paiement : soldé / partiel / impayé", () => {
  assert.equal(paymentStatus(100, 100), "paid");
  assert.equal(paymentStatus(100, 120), "paid");
  assert.equal(paymentStatus(100, 40), "partial");
  assert.equal(paymentStatus(100, 0), "unpaid");
  assert.equal(remaining(100, 40), 60);
  assert.equal(remaining(100, 140), 0);
  assert.equal(remaining(99.99, 33.33), 66.66);
});

test("créance en retard : échéance dépassée seulement si un solde reste dû", () => {
  const now = new Date(2026, 10, 5, 10);
  assert.equal(isOverdue({ status: "partial", remaining: 10, dueDate: new Date(2026, 10, 4) }, now), true);
  assert.equal(isOverdue({ status: "partial", remaining: 10, dueDate: new Date(2026, 10, 5) }, now), false); // dû aujourd'hui = pas encore en retard
  assert.equal(isOverdue({ status: "paid", remaining: 0, dueDate: new Date(2026, 9, 1) }, now), false);
  assert.equal(isOverdue({ status: "cancelled", remaining: 10, dueDate: new Date(2026, 9, 1) }, now), false);
  assert.equal(isOverdue({ status: "unpaid", remaining: 10, dueDate: null }, now), false);
  assert.equal(daysLate({ dueDate: new Date(2026, 10, 1) }, now), 4);
});

test("bénéfice d'une vente = total − coût de revient × quantité ; inconnu si pas de coût", () => {
  assert.equal(saleProfit({ total: 828, qty: 2 }, 345), 138);
  assert.equal(saleProfit({ total: 100, qty: 1 }, null), null);
  assert.equal(saleProfit({ total: 100, qty: 1 }, 130), -30);
});

test("périodes", () => {
  const now = new Date(2026, 10, 5, 15, 30); // 5 nov. 2026
  assert.equal(periodStart("today", now).getDate(), 5);
  assert.equal(periodStart("7d", now).getDate(), 30);   // 30 oct.
  assert.equal(periodStart("month", now).getDate(), 1);
  assert.equal(periodStart("year", now).getMonth(), 0);
  assert.equal(periodStart("all", now), null);
  assert.equal(inPeriod(new Date(2026, 10, 1, 0, 1), "month", now), true);
  assert.equal(inPeriod(new Date(2026, 9, 31, 23, 59), "month", now), false);
});

test("valeur du stock au coût et au prix de vente", () => {
  const products = [{ id: "a", qty: 3, sellPrice: 400 }, { id: "b", qty: 10, sellPrice: 50 }, { id: "c", qty: 5, sellPrice: 10, archived: true }];
  const v = stockValues(products, { a: { unitCost: 345 }, b: { unitCost: 46 } });
  assert.deepEqual(v, { atCost: 1495, atSell: 1700, units: 13 });
});

test("num accepte les virgules françaises et ignore le texte", () => {
  assert.equal(num("12,5"), 12.5);
  assert.equal(num("abc"), 0);
  assert.equal(num(undefined), 0);
});
