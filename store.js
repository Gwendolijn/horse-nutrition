// store.js — the saved data (a feed library and several horses), and the three
// ways it moves in and out: backup file (JSON), feed spreadsheet (CSV) and
// share link. No DOM in here, so it can be tested on its own.

import { NUTRIENTS, RATIOS, WORKLOADS, requirementsFor, maximumsFor } from "./model.js";

export const STORAGE_KEY = "horsediet.v1";
export const APP_ID = "horse-ration-planner";

// Bump when the default feeds or the tracked nutrients change, so that data
// saved by an older version gets upgraded on load.
export const DATA_VERSION = 9;

// Feed values are per kg dry matter; dm is the dry matter fraction as fed.
const perKg = (n) => ({ key: n.key, label: n.label, unit: `${n.unit}/kg` });
export const FEED_FIELDS = [
  { key: "dm", label: "Dry matter", unit: "%", scale: 100 },
  ...NUTRIENTS.filter((n) => !n.trace).map(perKg),
  { key: "starch", label: "Starch", unit: "g/kg" },
];
export const FEED_TRACE_FIELDS = NUTRIENTS.filter((n) => n.trace).map(perKg);
// Optional: zero means no limit.
export const FEED_LIMIT_FIELD = { key: "maxPer100kg", label: "Maximum per day", unit: "g/100 kg" };
export const ALL_FEED_FIELDS = [...FEED_FIELDS, ...FEED_TRACE_FIELDS, FEED_LIMIT_FIELD];
export const MAX_NUTRIENTS = NUTRIENTS.filter((n) => n.maxPer500 || n.maxFactor);

// since: the DATA_VERSION that introduced the feed as a default.
// selected: ticked for a new horse.
const DEFAULT_FEEDS = [
  { since: 1, id: "grass_hay", name: "Grass hay", forage: true, selected: true, dm: 0.9,
    energy: 8.0, protein: 90, calcium: 4.0, phosphorus: 2.0, magnesium: 1.8, starch: 15,
    copper: 6, zinc: 25, manganese: 60, iron: 150, selenium: 0.05, vitaminE: 30, maxPer100kg: 0 },
  { since: 2, id: "oats", name: "Oats", forage: false, selected: true, dm: 0.88,
    energy: 13.0, protein: 120, calcium: 1.0, phosphorus: 3.5, magnesium: 1.4, starch: 430,
    copper: 5, zinc: 30, manganese: 40, iron: 80, selenium: 0.05, vitaminE: 15, maxPer100kg: 0 },
  // Placeholder values for a generic mineral feed (about 50-100 g per day);
  // products differ a lot, so replace these with the figures from the label.
  { since: 2, id: "mineral_balancer", name: "Mineral balancer", forage: false, selected: true, dm: 0.95,
    energy: 0, protein: 0, calcium: 100, phosphorus: 50, magnesium: 40, starch: 0,
    copper: 1000, zinc: 3500, manganese: 2000, iron: 0, selenium: 20, vitaminE: 10000, maxPer100kg: 0 },
  // Placeholder values for a generic copper and zinc supplement at 3:1 zinc
  // to copper, with no selenium; replace with the figures from the label.
  { since: 7, id: "copper_zinc", name: "Copper and zinc supplement", forage: false, selected: true, dm: 0.95,
    energy: 0, protein: 0, calcium: 0, phosphorus: 0, magnesium: 0, starch: 0,
    copper: 10000, zinc: 30000, manganese: 0, iron: 0, selenium: 0, vitaminE: 0, maxPer100kg: 0 },
  // Not ticked by default: an optional supplement. When ticked it is only
  // used where forage alone can't meet the requirements.
  { since: 3, id: "vegetable_oil", name: "Vegetable oil", forage: false, selected: false, dm: 1,
    energy: 37.7, protein: 0, calcium: 0, phosphorus: 0, magnesium: 0, starch: 0,
    copper: 0, zinc: 0, manganese: 0, iron: 0, selenium: 0, vitaminE: 0, maxPer100kg: 100 },
];

export const newId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const numOr = (v, fallback = 0) => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// --- shape of the data -------------------------------------------------------

// A feed with every field present and valid, or null if it has no name.
export function cleanFeed(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name ?? "").trim().slice(0, 80);
  if (!name) return null;
  const f = {
    id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 60) : newId("feed"),
    name,
    forage: !!raw.forage,
  };
  for (const fld of ALL_FEED_FIELDS) f[fld.key] = numOr(raw[fld.key]);
  f.dm = raw.dm == null ? 0.9 : Math.min(f.dm, 1);
  if (raw.edited) f.edited = true; // changed by the user, so never overwritten by new defaults
  return f;
}

// A horse with every field present and valid. With a preset workload the
// requirements always follow from weight and workload; only "custom" stores them.
export function cleanHorse(raw, validFeedIds) {
  const weight = numOr(raw.weight, 500);
  const workload = WORKLOADS.some((w) => w.key === raw.workload) ? raw.workload : "custom";
  const preset = requirementsFor(weight, workload);
  const req = {};
  for (const n of NUTRIENTS) req[n.key] = preset ? preset[n.key] : numOr(raw.req?.[n.key]);
  const max = maximumsFor(weight, req);
  if (!preset) for (const n of MAX_NUTRIENTS) max[n.key] = numOr(raw.max?.[n.key], max[n.key]);
  const ratios = {};
  for (const r of RATIOS) ratios[r.id] = !!(raw.ratios?.[r.id] ?? r.on);
  const feedIds = [...new Set(Array.isArray(raw.feedIds) ? raw.feedIds : [])]
    .filter((id) => validFeedIds.has(id));
  // Amounts already being fed, per feed id, in the unit the user typed them in.
  const fixed = {};
  for (const [id, fx] of Object.entries(raw.fixed && typeof raw.fixed === "object" ? raw.fixed : {})) {
    const amount = numOr(fx?.amount);
    if (validFeedIds.has(id) && amount > 0) fixed[id] = { amount, unit: fx.unit === "g" ? "g" : "kg" };
  }
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 60) : newId("horse"),
    name: String(raw.name ?? "").trim().slice(0, 60) || "Horse",
    weight, workload, req, max, ratios, feedIds, fixed,
  };
}

export function newHorse(name, feedIds) {
  return cleanHorse({ name, weight: 500, workload: "maintenance", feedIds }, new Set(feedIds));
}

export function defaults() {
  const feeds = DEFAULT_FEEDS.map(cleanFeed);
  const horse = newHorse("My horse", DEFAULT_FEEDS.filter((d) => d.selected).map((d) => d.id));
  return { version: DATA_VERSION, feeds, horses: [horse], current: horse.id };
}

// --- loading and saving ---------------------------------------------------------

export function load(storage) {
  let saved = null;
  try { saved = JSON.parse(storage.getItem(STORAGE_KEY)); } catch {}
  if (!saved || !Array.isArray(saved.feeds)) return defaults();
  try {
    return normalize(Array.isArray(saved.horses) ? saved : fromSingleHorse(saved));
  } catch (err) {
    console.error(err);
    return defaults();
  }
}

export function save(storage, state) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

// Versions 1-7 stored one horse at the top level, with ticks on the feeds.
function fromSingleHorse(saved) {
  const from = saved.version ?? 1;
  const feeds = saved.feeds;
  for (const { since, ...d } of DEFAULT_FEEDS) {
    const f = feeds.find((o) => o.id === d.id);
    if (f) {
      for (const fld of ALL_FEED_FIELDS) f[fld.key] ??= d[fld.key];
      for (const fld of FEED_TRACE_FIELDS) f[fld.key] ||= d[fld.key];
    } else if (since > from) feeds.push({ ...d });
  }
  const ratios = { ...saved.ratios };
  if (from < 6) Object.assign(ratios, { fe_cu: true, mn_cu: true }); // on by default since version 6
  const horse = {
    id: newId("horse"), name: "My horse", weight: saved.weight,
    workload: saved.workload ?? "custom", // saved before presets existed: keep the entered values
    req: saved.req, max: saved.max, ratios,
    feedIds: feeds.filter((f) => f.selected).map((f) => f.id),
  };
  return { version: DATA_VERSION, feeds, horses: [horse], current: horse.id };
}

function normalize(saved) {
  const from = saved.version ?? DATA_VERSION;
  const feeds = [];
  for (const raw of saved.feeds) {
    const f = cleanFeed(raw);
    if (f && !feeds.some((o) => o.id === f.id)) feeds.push(f);
  }
  // Default feeds introduced since the data was saved; deleted ones stay deleted.
  const fresh = DEFAULT_FEEDS.filter((d) => d.since > from && !feeds.some((f) => f.id === d.id));
  feeds.push(...fresh.map(cleanFeed));
  const ids = new Set(feeds.map((f) => f.id));
  const horses = [];
  for (const raw of saved.horses) {
    if (!raw || typeof raw !== "object") continue;
    const h = cleanHorse({ ...raw, feedIds: [...(raw.feedIds ?? []), ...fresh.filter((d) => d.selected).map((d) => d.id)] }, ids);
    if (horses.some((o) => o.id === h.id)) h.id = newId("horse");
    horses.push(h);
  }
  if (!horses.length) horses.push(newHorse("My horse", [...ids]));
  const current = horses.some((h) => h.id === saved.current) ? saved.current : horses[0].id;
  return { version: DATA_VERSION, feeds, horses, current };
}

// --- export and import ------------------------------------------------------------

// What to hand over: "all", "feeds" (the library only), or "horse" (one horse
// and the feeds ticked for it). compact drops everything that can be rebuilt,
// to keep share links short.
export function toPayload(state, scope, horseId, { compact = false } = {}) {
  const horse = state.horses.find((h) => h.id === horseId);
  let feeds = state.feeds;
  let horses = state.horses;
  if (scope === "feeds") horses = [];
  if (scope === "horse") {
    horses = [horse];
    feeds = state.feeds.filter((f) => horse.feedIds.includes(f.id));
  }
  if (compact) {
    feeds = feeds.map((f) => {
      const out = { id: f.id, name: f.name };
      if (f.forage) out.forage = true;
      for (const fld of ALL_FEED_FIELDS) if (f[fld.key]) out[fld.key] = f[fld.key];
      return out;
    });
    horses = horses.map((h) => {
      const out = { name: h.name, weight: h.weight, workload: h.workload, feedIds: h.feedIds };
      if (h.workload === "custom") Object.assign(out, { req: h.req, max: h.max });
      const ratios = Object.fromEntries(RATIOS.filter((r) => h.ratios[r.id] !== r.on).map((r) => [r.id, h.ratios[r.id]]));
      if (Object.keys(ratios).length) out.ratios = ratios;
      if (Object.keys(h.fixed).length) out.fixed = h.fixed;
      return out;
    });
  }
  return { app: APP_ID, version: DATA_VERSION, feeds, horses };
}

// Checks that parsed JSON is one of our files. Field-level cleaning happens on import.
export function parsePayload(obj) {
  if (!obj || typeof obj !== "object" || obj.app !== APP_ID || !Array.isArray(obj.feeds)) {
    throw new Error("This is not a ration planner file.");
  }
  const objects = (list) => (Array.isArray(list) ? list.filter((o) => o && typeof o === "object") : []);
  return { feeds: objects(obj.feeds), horses: objects(obj.horses) };
}

const nameKey = (s) => String(s).trim().toLowerCase();
const sameFeed = (a, b) => a.name === b.name && a.forage === b.forage
  && ALL_FEED_FIELDS.every((fld) => Math.abs(a[fld.key] - b[fld.key]) < 1e-9);
const horseKey = (h) => JSON.stringify([h.name, h.weight, h.workload, h.req, h.max, h.ratios, [...h.feedIds].sort(),
  Object.entries(h.fixed).sort(([a], [b]) => (a < b ? -1 : 1))]);

// Works out what an import would do, without doing it. Feeds and horses are
// matched by name: a match is updated (the incoming values win), anything else
// is added, and nothing is ever deleted. Incoming feeds may be partial (a
// spreadsheet without some columns); missing values keep what is already there.
// Returns { report, next }, where next is the state after the import.
export function planImport(state, payload) {
  const next = JSON.parse(JSON.stringify(state));
  const report = { feeds: { added: [], changed: [], same: 0 }, horses: { added: [], changed: [], same: 0 } };
  const idMap = new Map(); // incoming feed id -> id in the library

  for (const raw of payload.feeds) {
    if (typeof raw.name !== "string" || !raw.name.trim()) continue;
    const at = next.feeds.findIndex((f) => nameKey(f.name) === nameKey(raw.name));
    if (at >= 0) {
      const local = next.feeds[at];
      const merged = cleanFeed({ ...local, ...raw, id: local.id });
      if (sameFeed(local, merged)) report.feeds.same++;
      else {
        merged.edited = true;
        next.feeds[at] = merged;
        report.feeds.changed.push(merged.name);
      }
      if (raw.id) idMap.set(raw.id, local.id);
    } else {
      const taken = next.feeds.some((f) => f.id === raw.id);
      const f = cleanFeed({ ...raw, id: taken ? undefined : raw.id, edited: true });
      next.feeds.push(f);
      report.feeds.added.push(f.name);
      if (raw.id) idMap.set(raw.id, f.id);
    }
  }

  const ids = new Set(next.feeds.map((f) => f.id));
  let first = null;
  for (const raw of payload.horses) {
    const feedIds = (Array.isArray(raw.feedIds) ? raw.feedIds : []).map((id) => idMap.get(id)).filter(Boolean);
    const at = next.horses.findIndex((h) => nameKey(h.name) === nameKey(raw.name ?? ""));
    const fixed = Object.fromEntries(Object.entries(raw.fixed && typeof raw.fixed === "object" ? raw.fixed : {})
      .map(([id, fx]) => [idMap.get(id), fx]).filter(([id]) => id));
    const h = cleanHorse({ ...raw, id: at >= 0 ? next.horses[at].id : undefined, feedIds, fixed }, ids);
    if (at >= 0 && horseKey(next.horses[at]) === horseKey(h)) report.horses.same++;
    else if (at >= 0) {
      next.horses[at] = h;
      report.horses.changed.push(h.name);
    } else {
      next.horses.push(h);
      report.horses.added.push(h.name);
    }
    first ??= h.id;
  }
  if (first) next.current = first; // show what was just imported

  report.any = [report.feeds, report.horses].some((r) => r.added.length || r.changed.length);
  return { report, next };
}

// --- feed spreadsheet (CSV) ----------------------------------------------------------

const CSV_COLUMNS = [
  { key: "name", header: "Name" },
  { key: "forage", header: "Forage (yes/no)" },
  ...ALL_FEED_FIELDS.map((fld) => ({ key: fld.key, header: `${fld.label} (${fld.unit})`, scale: fld.scale ?? 1, numeric: true })),
];
const headerKey = (s) => s.split("(")[0].trim().toLowerCase();

// european: semicolons and decimal commas, which is what Excel expects in most
// of Europe; otherwise commas and decimal points.
export function feedsToCsv(feeds, { european = false } = {}) {
  const sep = european ? ";" : ",";
  const quote = (s) => (/[";,\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const cell = (f, col) => {
    if (col.key === "name") return quote(f.name);
    if (col.key === "forage") return f.forage ? "yes" : "no";
    const text = String(Math.round(f[col.key] * col.scale * 1e4) / 1e4);
    return european ? text.replace(".", ",") : text;
  };
  const lines = [CSV_COLUMNS.map((c) => quote(c.header)).join(sep)];
  for (const f of feeds) lines.push(CSV_COLUMNS.map((c) => cell(f, c)).join(sep));
  return "\uFEFF" + lines.join("\r\n") + "\r\n"; // the BOM makes Excel read it as UTF-8
}

function parseCsvRows(text, sep) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Reads a feed spreadsheet into an import payload. Accepts comma, semicolon or
// tab separated files and decimal commas. Columns are recognised by their
// header (the text before any unit in brackets); unknown columns are ignored,
// and empty cells or missing columns leave the value out.
export function csvToPayload(text) {
  text = text.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0];
  const count = (ch) => firstLine.split(ch).length - 1;
  const sep = [";", "\t", ","].reduce((best, ch) => (count(ch) > count(best) ? ch : best));
  const rows = parseCsvRows(text, sep);
  if (!rows.length) throw new Error("The file is empty.");
  const columns = rows[0].map((h) => CSV_COLUMNS.find((c) => headerKey(c.header) === headerKey(h)));
  if (!columns.some((c) => c?.key === "name")) throw new Error('No "Name" column found in the first row.');

  const yes = new Set(["yes", "y", "ja", "j", "true", "1", "x"]);
  const feeds = [];
  for (const row of rows.slice(1)) {
    const f = {};
    row.forEach((value, i) => {
      const col = columns[i];
      value = value.trim();
      if (!col || value === "") return;
      if (col.key === "name") f.name = value;
      else if (col.key === "forage") f.forage = yes.has(value.toLowerCase());
      else {
        let s = value.replace(/\s/g, "");
        if (sep !== ",") s = s.replace(",", ".");
        const n = parseFloat(s);
        if (Number.isFinite(n) && n >= 0) f[col.key] = n / col.scale;
      }
    });
    if (f.name) feeds.push(f);
  }
  if (!feeds.length) throw new Error("No feeds found in the file.");
  return { feeds, horses: [] };
}

// --- share link -------------------------------------------------------------------------

const toBase64Url = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromBase64Url = (text) => {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const pipe = async (bytes, stream) =>
  new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

// The data itself, packed into text that fits in a link: "z" + compressed, or
// "j" + plain where the browser can't compress.
export async function encodeShare(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream === "function") {
    try { return "z" + toBase64Url(await pipe(bytes, new CompressionStream("deflate-raw"))); } catch {}
  }
  return "j" + toBase64Url(bytes);
}

export async function decodeShare(text) {
  let bytes = fromBase64Url(text.slice(1));
  if (text[0] === "z") bytes = await pipe(bytes, new DecompressionStream("deflate-raw"));
  else if (text[0] !== "j") throw new Error("This link is not readable.");
  return parsePayload(JSON.parse(new TextDecoder().decode(bytes)));
}
