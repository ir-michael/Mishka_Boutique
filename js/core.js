// Registre partagé : actions (clics), soumissions de formulaires, filtres, re-rendu.
export const actions = {};   // data-action="nom"  -> actions.nom(el, event)
export const submits = {};   // data-submit="nom"  -> submits.nom(form, event)
export const inputs = {};    // data-input="nom"   -> inputs.nom(el, event)  (événement input/change)
export const filters = {};   // data-filter="page.cle" -> valeur courante

let renderFn = () => {};
export const setRender = (f) => { renderFn = f; };
export const rerender = () => renderFn();
export const getF = (key, def = "") => (key in filters ? filters[key] : def);
export const setF = (key, val) => { filters[key] = val; };

export const PERIODS = [
  ["today", "Aujourd'hui"], ["7d", "7 jours"], ["month", "Ce mois"], ["year", "Cette année"], ["all", "Tout"],
];
export const periodSelect = (key, def = "month") => {
  const cur = getF(key, def);
  return `<select class="select" data-filter="${key}" aria-label="Période">${PERIODS.map(([v, l]) =>
    `<option value="${v}" ${v === cur ? "selected" : ""}>${l}</option>`).join("")}</select>`;
};

export const navigate = (page) => { location.hash = "#/" + page; };
