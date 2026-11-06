import { state } from "../store.js";
import { esc, fm, fmtDate, icon, chip, empty } from "../ui.js";
import { actions, getF } from "../core.js";
import { num, round2, isOverdue, daysLate, toDate, sum, groupBy } from "../logic.js";
import { debts } from "../calc.js";

export function whatsappLink(phone, text) {
  let p = String(phone || "").replace(/[^\d+]/g, "");
  if (!p) return "";
  if (p.startsWith("+")) p = p.slice(1);
  else if (p.startsWith("00")) p = p.slice(2);
  else if (p.startsWith("0")) p = (state.shop.countryCode || "243") + p.slice(1);
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

function render() {
  const f = getF("debts.f", "all");
  const q = getF("debts.q").toLowerCase();
  const all = debts().sort((a, b) => (toDate(a.dueDate) || 0) - (toDate(b.dueDate) || 0));
  const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7);
  const list = all.filter((s) => {
    if (f === "overdue" && !isOverdue(s)) return false;
    if (f === "week" && !(toDate(s.dueDate) && toDate(s.dueDate) <= weekEnd)) return false;
    return !q || `${s.buyerName || ""} ${s.productName} ${s.brand}`.toLowerCase().includes(q);
  });
  const od = all.filter((s) => isOverdue(s));
  const byClient = [...groupBy(all.filter((s) => s.buyerName), (s) => s.buyerName).entries()]
    .map(([n, a]) => ({ n, rest: sum(a, (s) => s.remaining), cnt: a.length, late: a.some((s) => isOverdue(s)) }))
    .sort((a, b) => b.rest - a.rest);

  return `
    <div class="page-head"><div><h2>Créances clients</h2><p class="muted">Ventes avec un reste à payer</p></div></div>
    <div class="summary-bar">
      <div><span class="muted">Total à encaisser</span><strong>${fm(sum(all, (s) => s.remaining))}</strong></div>
      <div><span class="muted">En retard</span><strong class="${od.length ? "neg" : ""}">${fm(sum(od, (s) => s.remaining))}</strong></div>
      <div><span class="muted">Dossiers ouverts</span><strong>${all.length}</strong></div>
    </div>
    <div class="toolbar">
      <div class="search">${icon("search")}<input id="debts-q" class="input" placeholder="Rechercher un client ou un produit…" value="${esc(getF("debts.q"))}" data-filter="debts.q"></div>
      <select class="select" data-filter="debts.f">
        ${[["all", "Toutes"], ["overdue", "En retard"], ["week", "Échéance sous 7 jours"]].map(([v, l]) => `<option value="${v}" ${v === f ? "selected" : ""}>${l}</option>`).join("")}</select>
    </div>

    <section class="card flush">
      ${list.length ? `<table class="table responsive"><thead><tr><th>Client</th><th>Produit</th><th>Vendu le</th><th class="num">Total</th><th class="num">Payé</th><th class="num">Reste</th><th>Échéance</th><th></th></tr></thead><tbody>
        ${list.map((s) => {
          const late = isOverdue(s);
          const wa = s.buyerPhone ? whatsappLink(s.buyerPhone, `Bonjour ${s.buyerName || ""}, petit rappel de ${state.shop.name} : il reste ${fm(s.remaining)} à payer pour « ${s.brand || ""} ${s.productName} ». Échéance : ${fmtDate(s.dueDate)}. Merci !`) : "";
          return `<tr>
            <td data-label="Client"><strong>${esc(s.buyerName || "Anonyme")}</strong>${s.buyerPhone ? `<div class="muted small">${esc(s.buyerPhone)}</div>` : ""}</td>
            <td data-label="Produit">${esc(s.brand || "")} ${esc(s.productName)} × ${s.qty}</td>
            <td data-label="Vendu le">${fmtDate(s.date)}</td>
            <td data-label="Total" class="num">${fm(s.total)}</td>
            <td data-label="Payé" class="num">${fm(s.paid)}</td>
            <td data-label="Reste" class="num"><strong class="neg">${fm(s.remaining)}</strong></td>
            <td data-label="Échéance">${fmtDate(s.dueDate)} ${late ? chip(daysLate(s) + " j de retard", "red") : ""}</td>
            <td class="actions"><button class="btn sm primary" data-action="pay-sale" data-id="${s.id}">Encaisser</button>
              ${wa ? `<a class="btn sm ghost" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
              <button class="btn sm ghost" data-action="sale-detail" data-id="${s.id}">Détails</button></td></tr>`;
        }).join("")}</tbody></table>` : empty(all.length ? "Aucune créance pour ce filtre." : "Aucune créance : tous les clients ont payé 🎉", "wallet")}
    </section>

    ${byClient.length ? `<section class="card"><h3>Par client</h3>
      <table class="table compact"><thead><tr><th>Client</th><th class="num">Dossiers</th><th class="num">Reste dû</th></tr></thead><tbody>
      ${byClient.map((c) => `<tr><td>${esc(c.n)} ${c.late ? chip("en retard", "red") : ""}</td><td class="num">${c.cnt}</td><td class="num"><strong>${fm(c.rest)}</strong></td></tr>`).join("")}</tbody></table></section>` : ""}`;
}

export default { id: "debts", title: "Créances", label: "Créances", icon: "wallet", roles: ["admin", "employee"], render };
