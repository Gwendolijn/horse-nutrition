// model.js — the ration LP, mirroring model.py.
// Amounts are as-fed kg/day; feed values are per kg dry matter (DM),
// so the delivered amount of a nutrient is content * dm * amount.

// step: rounding of preset requirements; digits: decimals shown in results.
// "trace" nutrients are shown in their own group in the UI.
// maxPer500: daily upper limit for a 500 kg horse, for nutrients that have one.
// maxFactor: daily upper limit as a multiple of the requirement.
export const NUTRIENTS = [
  // Upper limit: 10% above the requirement, so a ration can't overfeed energy.
  { key: "energy", label: "Energy", unit: "MJ", step: 0.5, digits: 1, maxFactor: 1.1 },
  { key: "protein", label: "Protein", unit: "g", step: 5, digits: 0 },
  { key: "calcium", label: "Calcium", unit: "g", step: 0.5, digits: 0 },
  { key: "phosphorus", label: "Phosphorus", unit: "g", step: 0.5, digits: 0 },
  { key: "magnesium", label: "Magnesium", unit: "g", step: 0.5, digits: 1 },
  { key: "copper", label: "Copper", unit: "mg", step: 1, digits: 0, trace: true },
  { key: "zinc", label: "Zinc", unit: "mg", step: 5, digits: 0, trace: true },
  { key: "manganese", label: "Manganese", unit: "mg", step: 5, digits: 0, trace: true },
  { key: "iron", label: "Iron", unit: "mg", step: 5, digits: 0, trace: true },
  // Upper limit: NRC's maximum tolerable 2 mg per kg dry matter, at an intake of 2% of body weight.
  { key: "selenium", label: "Selenium", unit: "mg", step: 0.01, digits: 2, trace: true, maxPer500: 20 },
  { key: "vitaminE", label: "Vitamin E", unit: "IU", step: 10, digits: 0, trace: true },
];

// Daily requirements of a 500 kg adult horse, from NRC (2007) "Nutrient
// Requirements of Horses"; scaled linearly with body weight.
// Energy is digestible energy (DE), converted from Mcal (1 Mcal = 4.184 MJ).
const MCAL = 4.184;
const per500 = (mcal, protein, calcium, phosphorus, magnesium, copper, zinc, manganese, iron, selenium, vitaminE) =>
  ({ energy: mcal * MCAL, protein, calcium, phosphorus, magnesium, copper, zinc, manganese, iron, selenium, vitaminE });
export const WORKLOADS = [
  { key: "maintenance", label: "No work", hint: "Resting or only turned out.",
    per500: per500(16.7, 630, 20, 14, 7.5, 100, 400, 400, 400, 1.0, 500) },
  { key: "light", label: "Light", hint: "1–3 hours a week, mostly walk and trot.",
    per500: per500(20.0, 699, 30, 18, 9.5, 100, 400, 400, 400, 1.0, 800) },
  { key: "moderate", label: "Moderate", hint: "3–5 hours a week, with canter and some jumping or skill work.",
    per500: per500(23.3, 768, 35, 21, 11.5, 112.5, 450, 450, 450, 1.13, 900) },
  { key: "heavy", label: "Heavy", hint: "4–5 hours a week, with fast canter, gallop or jumping.",
    per500: per500(26.6, 862, 40, 29, 15, 125, 500, 500, 500, 1.25, 1000) },
];

export function requirementsFor(weight, workloadKey) {
  const w = WORKLOADS.find((o) => o.key === workloadKey);
  if (!w) return null;
  const req = {};
  for (const n of NUTRIENTS) {
    const v = (w.per500[n.key] * weight) / 500;
    req[n.key] = Number((Math.round(v / n.step) * n.step).toFixed(2));
  }
  return req;
}

// Daily upper limits, scaled with body weight like the requirements.
export function maximumsFor(weight, req) {
  const max = {};
  for (const n of NUTRIENTS) {
    if (n.maxPer500) max[n.key] = Number(((n.maxPer500 * weight) / 500).toFixed(2));
    if (n.maxFactor) max[n.key] = Number((Math.ceil((req[n.key] * n.maxFactor) / n.step) * n.step).toFixed(2));
  }
  return max;
}

// A feed's own daily maximum in kg as fed; it is entered as grams per 100 kg
// body weight, which is how limits for oil and supplements are usually given.
export function feedMaxKg(feed, weight) {
  return feed.maxPer100kg > 0 ? (feed.maxPer100kg / 1000) * (weight / 100) : null;
}

// Mineral ratios, as num : den with an allowed range. Only calcium:phosphorus
// has NRC backing; the others are widely used practitioner guidelines.
// on: enforced by default. Typical hay is high in iron and manganese, so those
// two ratios take several times the balancer that the requirements alone need.
export const RATIOS = [
  { id: "ca_p", num: "calcium", den: "phosphorus", lo: 1.2, hi: 2.0, on: true },
  { id: "ca_mg", num: "calcium", den: "magnesium", lo: 1.5, hi: 2.5, on: true },
  { id: "zn_cu", num: "zinc", den: "copper", lo: 3, hi: 5, on: true },
  { id: "fe_cu", num: "iron", den: "copper", lo: null, hi: 5, on: true },
  { id: "mn_cu", num: "manganese", den: "copper", lo: null, hi: 5, on: true },
];

export const LIMITS = {
  minForage: 0.6, // share of dry matter
  dmi: [0.015, 0.025], // dry matter intake as share of body weight
};

// Each row is sum(coefs[i] * x[i]) >= lo, or <= hi.
export function buildRows(feeds, profile) {
  const row = (id, label, coef, lo, hi) => ({ id, label, coefs: feeds.map(coef), lo, hi });
  const rows = [];
  for (const n of NUTRIENTS) {
    const need = profile.req[n.key];
    if (need > 0) {
      rows.push(row(`min_${n.key}`, `${n.label} requirement`, (f) => f[n.key] * f.dm, need, null));
    }
  }
  for (const n of NUTRIENTS) {
    const max = profile.max?.[n.key];
    if (max > 0) rows.push(row(`max_${n.key}`, `${n.label} maximum`, (f) => f[n.key] * f.dm, null, max));
  }
  feeds.forEach((feed, i) => {
    const max = feedMaxKg(feed, profile.weight);
    if (max != null) rows.push(row(`feedmax_${i}`, `Maximum amount of ${feed.name}`, (f) => (f === feed ? 1 : 0), null, max));
  });
  // Amounts the user already feeds are a minimum: the solver keeps at least
  // that much and adds to it, of the same feed or others. (Keeping them exactly
  // would make "feed more hay" impossible to suggest.)
  feeds.forEach((feed, i) => {
    const kg = profile.fixedKg?.[feed.id];
    if (kg > 0) rows.push(row(`fixed_${i}`, `Keeping the amount of ${feed.name} you already feed`, (f) => (f === feed ? 1 : 0), kg, null));
  });
  for (const r of RATIOS) {
    if (!profile.ratios?.[r.id]) continue;
    const name = `${r.num} to ${r.den} ratio`;
    if (r.lo != null) rows.push(row(`${r.id}_min`, `Minimum ${name}`, (f) => (f[r.num] - r.lo * f[r.den]) * f.dm, 0, null));
    if (r.hi != null) rows.push(row(`${r.id}_max`, `Maximum ${name}`, (f) => (f[r.num] - r.hi * f[r.den]) * f.dm, null, 0));
  }
  rows.push(row("forage", "Minimum forage share",
    (f) => ((f.forage ? 1 : 0) - LIMITS.minForage) * f.dm, 0, null));
  rows.push(row("dm_min", "Minimum daily intake", (f) => f.dm, LIMITS.dmi[0] * profile.weight, null));
  rows.push(row("dm_max", "Maximum daily intake", (f) => f.dm, null, LIMITS.dmi[1] * profile.weight));
  return rows;
}

const varName = (i) => `x${i}`;

// The small per-kg term added to the starch objective breaks ties towards the
// least total feed, so starch-free feeds are not fed beyond what is needed.
const TIE_BREAK = 1e-3;

// objective: one coefficient per feed, to be minimised.
export function toLP(glpk, feeds, rows, objective) {
  return {
    name: "ration",
    objective: {
      direction: glpk.GLP_MIN,
      name: "objective",
      vars: objective.map((coef, i) => ({ name: varName(i), coef })),
    },
    subjectTo: rows.map((r) => ({
      name: r.id,
      vars: r.coefs.map((c, i) => ({ name: varName(i), coef: c })),
      bnds: r.lo != null
        ? { type: glpk.GLP_LO, lb: r.lo, ub: 0 }
        : { type: glpk.GLP_UP, ub: r.hi, lb: 0 },
    })),
  };
}

export function summarize(feeds, amounts, profile) {
  const total = (fn) => feeds.reduce((s, f, i) => s + fn(f) * amounts[i], 0);
  const delivered = {};
  for (const key of [...NUTRIENTS.map((n) => n.key), "starch"]) {
    delivered[key] = total((f) => f[key] * f.dm);
  }
  const dm = total((f) => f.dm);
  return {
    delivered,
    asFed: total(() => 1),
    dm,
    dmShare: dm / profile.weight,
    forageShare: dm > 0 ? total((f) => (f.forage ? f.dm : 0)) / dm : 0,
    ratios: Object.fromEntries(RATIOS.map((r) =>
      [r.id, delivered[r.den] > 0 ? delivered[r.num] / delivered[r.den] : null])),
  };
}

// Returns { ok: true, amounts, summary } or { ok: false, culprits }, where
// culprits are the requirements whose removal alone would make a ration possible.
//
// Solved in two steps, forage first: (1) find the least energy that has to
// come from non-forage feeds to meet the requirements, then (2) among the
// rations that use no more than that, pick the one with the least starch.
// Step 1 counts energy rather than weight so that a mineral balancer, which
// has no energy, is not traded against extra hay.
export async function solve(glpk, feeds, profile) {
  const rows = buildRows(feeds, profile);
  const nonForage = feeds.map((f) => (f.forage ? 0 : f.energy * f.dm));
  const starch = feeds.map((f) => f.starch * f.dm + TIE_BREAK);
  const run = async (rs, objective) => {
    const { result } = await glpk.solve(toLP(glpk, feeds, rs, objective), { msglev: glpk.GLP_MSG_OFF });
    if (result.status !== glpk.GLP_OPT) return null;
    return feeds.map((_, i) => {
      const v = result.vars[varName(i)] ?? 0;
      return v < 1e-7 ? 0 : v;
    });
  };
  const first = await run(rows, nonForage);
  if (!first) {
    const culprits = [];
    for (const r of rows) {
      if (await run(rows.filter((o) => o !== r), nonForage)) culprits.push(r.label);
    }
    return { ok: false, culprits };
  }
  const least = first.reduce((s, x, i) => s + nonForage[i] * x, 0);
  const cap = { id: "nonforage_cap", coefs: nonForage, lo: null, hi: least * (1 + 1e-6) + 1e-6 };
  const amounts = (await run([...rows, cap], starch)) ?? first;
  return { ok: true, amounts, summary: summarize(feeds, amounts, profile) };
}
