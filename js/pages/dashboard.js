import { state, isAdmin, unreadCount } from "../store.js";
import { esc, fm, fnum, fmtDate, fmtTime, icon, chip, empty } from "../ui.js";
import { getF, periodSelect, PERIODS } from "../core.js";
import { num, round2, sum, stockValues, isOverdue, daysLate, groupBy, startOfDay, toDate, toDate as td } from "../logic.js";
import { salesInPeriod, collectedInPeriod, expensesInPeriod, debts, lowStock, enrichedSales } from "../calc.js";

let charts = [];

const kpi = (label, value, sub = "", tone = "", ic = "trend") => `
  <div class="kpi ${tone}">
    <div class="kpi-ic">${icon(ic, 20)}</div>
    <div class="kpi-body"><div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ""}</div>
  </div>`;

function alerts() {
  const out = [];
  const admin = isAdmin();
  const low = lowStock();
  if (low.length) out.push({ tone: "warn", ic: "box", text: `${low.length} produit(s) en stock bas ou épuisé`, link: "#/stock" });
  const od = debts().filter((s) => isOverdue(s));
  if (od.length) out.push({ tone: "danger", ic: "clock", text: `${od.length} créance(s) en retard — ${fm(sum(od, (s) => s.remaining))}`, link: "#/debts" });
  if (admin) {
    const arrived = state.notices.filter((n) => n.status === "pending" && n.arrived);
    if (arrived.length) out.push({ tone: "info", ic: "truck", text: `${arrived.length} colis arrivé(s) à finaliser (frais de kilo)`, link: "#/orders" });
  } else {
    const wait = state.notices.filter((n) => n.status === "pending" && !n.arrived);
    if (wait.length) out.push({ tone: "info", ic: "truck", text: `${wait.length} commande(s) en attente de réception`, link: "#/arrivals" });
  }
  const un = unreadCount();
  if (un) out.push({ tone: "info", ic: "chat", text: `${un} message(s) non lu(s)`, link: "#/chat" });
  return out;
}

const alertsHtml = () => {
  const a = alerts();
  if (!a.length) return `<div class="alert ok">${icon("check")}<span>Tout est en ordre. Aucune alerte.</span></div>`;
  return a.map((x) => `<a class="alert ${x.tone}" href="${x.link}">${icon(x.ic)}<span>${x.text}</span></a>`).join("");
};

function recentSalesHtml(list, admin) {
  if (!list.length) return empty("Aucune vente pour le moment.", "cart");
  return `<ul class="list">${list.map((s) => `
    <li class="list-row">
      <div class="grow"><strong>${esc(s.brand ? s.brand + " " : "")}${esc(s.productName)}</strong> × ${s.qty}
        <div class="muted small">${esc(s.buyerName || "Anonyme")} · ${fmtDate(s.date)} ${fmtTime(s.date)}</div></div>
      <div class="right"><strong>${fm(s.total)}</strong>
        <div>${s.status === "paid" ? chip("Soldé", "green") : s.status === "partial" ? chip("Partiel", "amber") : chip("Impayé", "red")}</div></div>
    </li>`).join("")}</ul>`;
}

function adminView() {
  const period = getF("dash.period", "month");
  const label = PERIODS.find((p) => p[0] === period)[1].toLowerCase();
  const sales = salesInPeriod(period);
  const revenue = sum(sales, (s) => s.total);
  const known = sales.filter((s) => s.profit != null);
  const gross = sum(known, (s) => s.profit);
  const missingCost = sales.length - known.length;
  const exp = sum(expensesInPeriod(period), (e) => e.amount);
  const net = round2(gross - exp);
  const collected = collectedInPeriod(period);
  const d = debts();
  const dTotal = sum(d, (s) => s.remaining);
  const odCount = d.filter((s) => isOverdue(s)).length;
  const sv = stockValues(state.products, state.costs);
  const pendingOrders = state.orders.filter((o) => o.status === "pending");

  // Top produits
  const byProduct = [...groupBy(sales, (s) => `${s.brand || ""} ${s.productName}`.trim()).entries()]
    .map(([name, arr]) => ({ name, qty: sum(arr, (s) => s.qty), rev: sum(arr, (s) => s.total), profit: sum(arr.filter((s) => s.profit != null), (s) => s.profit) }))
    .sort((a, b) => b.profit - a.profit).slice(0, 5);

  return `
    <div class="page-head"><div><h2>Tableau de bord</h2><p class="muted">Vue d'ensemble de la boutique</p></div>
      <div>${periodSelect("dash.period")}</div></div>

    <div class="alerts">${alertsHtml()}</div>

    <div class="kpi-grid">
      ${kpi("Ventes (" + label + ")", fm(revenue), `${sales.length} vente(s)`, "blue", "cart")}
      ${kpi("Encaissé", fm(collected), "paiements reçus", "green", "wallet")}
      ${kpi("Bénéfice brut", fm(gross), missingCost ? `${missingCost} vente(s) sans coût connu` : "après coût de revient", "green", "trend")}
      ${kpi("Dépenses boutique", fm(exp), label, "amber", "receipt")}
      ${kpi("Bénéfice net", fm(net), "brut − dépenses", net >= 0 ? "green" : "red", "chart")}
      ${kpi("Créances clients", fm(dTotal), odCount ? `<span class="neg">${odCount} en retard</span>` : `${d.length} en cours`, odCount ? "red" : "blue", "clock")}
      ${kpi("Valeur du stock", fm(sv.atCost), `vente potentielle ${fm(sv.atSell)} · ${sv.units} article(s)`, "violet", "box")}
      ${kpi("Commandes en cours", pendingOrders.length, pendingOrders.length ? fm(sum(pendingOrders, (o) => o.totals?.totalCost)) + " engagés" : "aucune", "violet", "truck")}
    </div>

    <div class="grid-2">
      <section class="card"><h3>Ventes & bénéfice — 30 derniers jours</h3><div class="chart-box"><canvas id="ch-daily"></canvas></div></section>
      <section class="card"><h3>Ventes par catégorie (${label})</h3><div class="chart-box"><canvas id="ch-cat"></canvas></div></section>
    </div>

    <div class="grid-2">
      <section class="card"><div class="card-head"><h3>Produits les plus rentables</h3><a href="#/reports" class="link">Rapports</a></div>
        ${byProduct.length ? `<table class="table compact"><thead><tr><th>Produit</th><th class="num">Qté</th><th class="num">CA</th><th class="num">Bénéfice</th></tr></thead><tbody>
          ${byProduct.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${fnum(p.qty)}</td><td class="num">${fm(p.rev)}</td><td class="num pos">${fm(p.profit)}</td></tr>`).join("")}</tbody></table>` : empty("Pas encore de ventes sur cette période.", "chart")}
      </section>
      <section class="card"><div class="card-head"><h3>Dernières ventes</h3><a href="#/sales" class="link">Tout voir</a></div>
        ${recentSalesHtml(state.sales.filter((s) => s.status !== "cancelled").slice(0, 6), true)}</section>
    </div>`;
}

function employeeView() {
  const sales = salesInPeriod("today");
  const total = sum(sales, (s) => s.total);
  const collected = collectedInPeriod("today");
  const d = debts();
  return `
    <div class="page-head"><div><h2>Bonjour ${esc((state.me.name || "").split(" ")[0])} 👋</h2><p class="muted">Résumé de la journée</p></div>
      <button class="btn primary" data-action="new-sale">${icon("plus")} Nouvelle vente</button></div>
    <div class="alerts">${alertsHtml()}</div>
    <div class="kpi-grid">
      ${kpi("Ventes du jour", fm(total), `${sales.length} vente(s)`, "blue", "cart")}
      ${kpi("Encaissé aujourd'hui", fm(collected), "", "green", "wallet")}
      ${kpi("Reste à encaisser", fm(sum(d, (s) => s.remaining)), `${d.length} client(s)`, "amber", "clock")}
      ${kpi("Articles en stock", fnum(sum(state.products.filter((p) => !p.archived), (p) => p.qty)), `${state.products.filter((p) => !p.archived).length} référence(s)`, "violet", "box")}
    </div>
    <section class="card"><div class="card-head"><h3>Ventes du jour</h3><a href="#/sales" class="link">Historique</a></div>
      ${recentSalesHtml(sales, false)}</section>`;
}

function mountCharts() {
  charts.forEach((c) => c.destroy());
  charts = [];
  if (!window.Chart || !isAdmin()) return;
  const css = getComputedStyle(document.documentElement);
  const col = (n) => css.getPropertyValue(n).trim();
  const ink = col("--muted");
  const all = enrichedSales();

  // 30 jours
  const days = [];
  for (let i = 29; i >= 0; i--) { const d = startOfDay(new Date()); d.setDate(d.getDate() - i); days.push(d); }
  const key = (d) => d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
  const rev = new Map(days.map((d) => [key(d), 0])), prof = new Map(days.map((d) => [key(d), 0]));
  for (const s of all) {
    const d = toDate(s.date); if (!d) continue;
    const k = key(startOfDay(d));
    if (!rev.has(k)) continue;
    rev.set(k, rev.get(k) + num(s.total));
    if (s.profit != null) prof.set(k, prof.get(k) + s.profit);
  }
  const c1 = document.getElementById("ch-daily");
  if (c1) charts.push(new Chart(c1, {
    data: {
      labels: days.map((d) => d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })),
      datasets: [
        { type: "bar", label: "Ventes", data: days.map((d) => round2(rev.get(key(d)))), backgroundColor: col("--primary-soft-2"), borderRadius: 4 },
        { type: "line", label: "Bénéfice", data: days.map((d) => round2(prof.get(key(d)))), borderColor: col("--green"), backgroundColor: col("--green"), tension: .3, pointRadius: 2 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { color: ink, boxWidth: 12 } } },
      scales: { x: { ticks: { color: ink, maxTicksLimit: 8 }, grid: { display: false } }, y: { ticks: { color: ink }, grid: { color: col("--line") }, beginAtZero: true } } },
  }));

  // Catégories
  const period = getF("dash.period", "month");
  const cats = new Map();
  for (const s of salesInPeriod(period)) cats.set(s.category || "autre", (cats.get(s.category || "autre") || 0) + num(s.total));
  const c2 = document.getElementById("ch-cat");
  if (c2 && cats.size) {
    const names = { ordinateur: "Ordinateurs", telephone: "Téléphones", accessoire: "Accessoires", autre: "Autres" };
    charts.push(new Chart(c2, {
      type: "doughnut",
      data: { labels: [...cats.keys()].map((k) => names[k] || k), datasets: [{ data: [...cats.values()].map(round2), backgroundColor: [col("--primary"), col("--green"), col("--amber"), col("--violet")], borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "bottom", labels: { color: ink, boxWidth: 12 } } } },
    }));
  } else if (c2) {
    c2.parentElement.innerHTML = empty("Aucune vente sur la période.", "chart");
  }
}

export default {
  id: "dashboard", title: "Tableau de bord", label: "Tableau de bord", icon: "home", roles: ["admin", "employee"],
  render: () => (isAdmin() ? adminView() : employeeView()),
  mount: mountCharts,
};
