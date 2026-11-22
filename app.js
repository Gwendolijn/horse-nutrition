// app.js — UI for the ration planner. The model lives in model.js.

import GLPK from "./vendor/glpk.js";
import { NUTRIENTS, LIMITS, RATIOS, WORKLOADS, requirementsFor, maximumsFor, feedMaxKg, solve } from "./model.js";

import {
  FEED_FIELDS, FEED_TRACE_FIELDS, FEED_LIMIT_FIELD, ALL_FEED_FIELDS, MAX_NUTRIENTS,
  load, save, defaults, newHorse, newId, cleanFeed,
  toPayload, parsePayload, planImport, feedsToCsv, csvToPayload, encodeShare, decodeShare,
} from "./store.js";

const label = (key) => NUTRIENTS.find((n) => n.key === key).label;
const ratioName = (r) => `${label(r.num)} : ${label(r.den).toLowerCase()}`;
const ratioRange = (r) => (r.lo != null ? `${r.lo}–${r.hi}` : `max ${r.hi}`);

// state: { feeds (the library, shared by all horses), horses, current (a horse id) }
let state = load(localStorage);
let glpk = null;
let solveSeq = 0;

const horse = () => state.horses.find((o) => o.id === state.current);

// --- tiny DOM helper ---------------------------------------------------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  el.append(...children.flat().filter((c) => c != null));
  return el;
}

const $ = (id) => document.getElementById(id);
const fmt = (v, digits = 1) =>
  v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const num = (v) => {
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

function numberField(label, unit, value, name, onInput) {
  const input = h("input", { type: "number", inputMode: "decimal", min: "0", step: "any", value: String(value), name });
  if (onInput) input.addEventListener("input", () => onInput(num(input.value)));
  return h("label", { className: "field" }, label,
    h("span", { className: "unit" }, input, h("span", {}, unit)));
}

// A button that asks for a second tap before doing something destructive.
function confirmButton(text, armedText, action) {
  const btn = h("button", { type: "button", className: "link danger" }, text);
  let timer = null;
  btn.addEventListener("click", () => {
    if (timer) { clearTimeout(timer); timer = null; btn.textContent = text; action(); return; }
    btn.textContent = armedText;
    timer = setTimeout(() => { timer = null; btn.textContent = text; }, 4000);
  });
  return btn;
}

function renderAll() {
  renderHorses();
  renderProfile();
  renderFeeds();
}

// --- horses --------------------------------------------------------------

function renderHorses() {
  const select = (id) => { state.current = id; renderAll(); changed(); };
  $("horses").replaceChildren(
    h("div", { className: "seg" },
      state.horses.map((o) =>
        h("label", {},
          h("input", { type: "radio", name: "horse", value: o.id, checked: o.id === state.current, onchange: () => select(o.id) }),
          h("span", {}, o.name))),
      h("button", { type: "button", className: "btn ghost pill", onclick: () => {
        // A new horse starts with the same feeds ticked as the current one.
        const added = newHorse(`Horse ${state.horses.length + 1}`, horse().feedIds);
        state.horses.push(added);
        select(added.id);
        const name = $("profile").querySelector("input[name=horse-name]");
        name.focus();
        name.select();
      } }, "+ Add horse")));
}

// --- profile -------------------------------------------------------------

// Weight and workload fill in the requirements; editing a requirement by hand
// switches the workload to "Custom" so the entered values are kept.
function renderProfile() {
  const hz = horse(); // everything in this card belongs to the current horse
  const nameInput = h("input", { name: "horse-name", value: hz.name, maxLength: 60, autocomplete: "off" });
  nameInput.addEventListener("input", () => {
    hz.name = nameInput.value.trim() || "Horse";
    $("horses").querySelector("input:checked + span").textContent = hz.name;
    changed();
  });
  const options = [...WORKLOADS, { key: "custom", label: "Custom", hint: "Your own requirement values." }];
  const hint = h("p", { className: "hint seg-hint" });
  const reqFields = NUTRIENTS.map((n) =>
    numberField(n.label, `${n.unit}/day`, hz.req[n.key], n.key, (v) => {
      hz.req[n.key] = v;
      setWorkload("custom");
      changed();
    }));

  const maxFields = MAX_NUTRIENTS.map((n) =>
    numberField(`${n.label} maximum`, `${n.unit}/day`, hz.max[n.key], `max_${n.key}`, (v) => {
      hz.max[n.key] = v;
      setWorkload("custom");
      changed();
    }));

  const setWorkload = (key) => {
    hz.workload = key;
    $("profile").querySelector(`input[name=workload][value=${key}]`).checked = true;
    hint.textContent = options.find((o) => o.key === key).hint;
    const req = requirementsFor(hz.weight, key);
    if (!req) return;
    hz.req = req;
    hz.max = maximumsFor(hz.weight, req);
    NUTRIENTS.forEach((n, i) => { reqFields[i].querySelector("input").value = String(req[n.key]); });
    MAX_NUTRIENTS.forEach((n, i) => { maxFields[i].querySelector("input").value = String(hz.max[n.key]); });
  };

  $("profile").replaceChildren(
    h("div", { className: "fields" },
      h("label", { className: "field" }, "Name", nameInput),
      numberField("Body weight", "kg", hz.weight, "weight", (v) => {
        hz.weight = v;
        setWorkload(hz.workload);
        renderFeeds(); // per-feed maximums depend on the weight
        changed();
      })),
    h("fieldset", { className: "seg" },
      h("legend", {}, "Workload"),
      options.map((o) =>
        h("label", {},
          h("input", { type: "radio", name: "workload", value: o.key, onchange: () => { setWorkload(o.key); changed(); } }),
          h("span", {}, o.label)))),
    hint,
    h("h3", {}, "Daily requirements"),
    h("div", { className: "fields" }, reqFields.filter((_, i) => !NUTRIENTS[i].trace),
      maxFields.filter((_, i) => !MAX_NUTRIENTS[i].trace)),
    h("h3", {}, "Trace minerals and vitamins"),
    h("div", { className: "fields" }, reqFields.filter((_, i) => NUTRIENTS[i].trace),
      maxFields.filter((_, i) => MAX_NUTRIENTS[i].trace)),
    h("details", { className: "ratios" },
      h("summary", {}, "Mineral ratios to keep"),
      RATIOS.map((r) =>
      h("label", { className: "check" },
        h("input", { type: "checkbox", checked: !!hz.ratios[r.id], onchange: (e) => { hz.ratios[r.id] = e.target.checked; changed(); } }),
        h("span", {}, `${ratioName(r)} `, h("span", { className: "sub" }, `${ratioRange(r)} : 1`))))),
    state.horses.length > 1
      ? confirmButton("Delete this horse", `Tap again to delete ${hz.name}`, () => {
          state.horses = state.horses.filter((o) => o !== hz);
          state.current = state.horses[0].id;
          renderAll();
          changed();
        })
      : "",
  );
  setWorkload(hz.workload);
}

// --- feeds ---------------------------------------------------------------

function renderFeeds() {
  const hz = horse();
  const tick = (f, on) => {
    hz.feedIds = hz.feedIds.filter((id) => id !== f.id);
    if (on) hz.feedIds.push(f.id);
    changed();
  };
  $("feeds").replaceChildren(...state.feeds.map((f) =>
    h("li", {},
      h("label", {},
        h("input", { type: "checkbox", checked: hz.feedIds.includes(f.id), onchange: (e) => tick(f, e.target.checked) }),
        h("span", {},
          h("span", { className: "feed-name" }, f.name),
          h("span", { className: "feed-meta" },
            `${f.forage ? "Forage" : "Concentrate"} · ${fmt(f.energy)} MJ · ${fmt(f.starch, 0)} g starch per kg`
              + (feedMaxKg(f, hz.weight) != null ? ` · max ${fmt(feedMaxKg(f, hz.weight) * 1000, 0)} g a day` : "")))),
      h("button", { type: "button", className: "link", onclick: () => openFeedDialog(f), "aria-label": `Edit ${f.name}` }, "Edit"))));
}

let editing = null;

function openFeedDialog(f) {
  editing = f;
  const form = $("feed-form");
  $("feed-dialog-title").textContent = f ? "Edit feed" : "Add feed";
  $("feed-delete").hidden = !f;
  form.elements.name.value = f ? f.name : "";
  form.elements.forage.checked = f ? f.forage : false;
  const field = (fld) => {
    const optional = fld === FEED_LIMIT_FIELD;
    const raw = f ? f[fld.key] * (fld.scale ?? 1) : fld.key === "dm" ? 90 : "";
    const value = raw === "" || (optional && !raw) ? "" : Math.round(raw * 1000) / 1000;
    const el = numberField(fld.label, fld.unit, value, fld.key);
    el.querySelector("input").required = FEED_FIELDS.includes(fld);
    return el;
  };
  $("feed-fields").replaceChildren(
    h("div", { className: "fields" }, FEED_FIELDS.map(field)),
    h("h3", {}, "Trace minerals and vitamins"),
    h("div", { className: "fields" }, FEED_TRACE_FIELDS.map(field)),
    h("h3", {}, "Limit"),
    h("div", { className: "fields" }, field(FEED_LIMIT_FIELD)),
  );
  $("feed-dialog").showModal();
}

$("feed-form").addEventListener("submit", (e) => {
  const form = e.target;
  const values = { name: form.elements.name.value.trim(), forage: form.elements.forage.checked };
  for (const fld of ALL_FEED_FIELDS) values[fld.key] = num(form.elements[fld.key].value) / (fld.scale ?? 1);
  values.dm = Math.min(values.dm, 1);
  values.edited = true;
  if (editing) Object.assign(editing, values);
  else {
    const added = cleanFeed({ id: newId("feed"), ...values });
    state.feeds.push(added);
    horse().feedIds.push(added.id); // ticked for the horse you are looking at
  }
  renderFeeds();
  changed();
});

$("feed-cancel").addEventListener("click", () => $("feed-dialog").close());
$("feed-delete").addEventListener("click", () => {
  state.feeds = state.feeds.filter((f) => f !== editing);
  for (const o of state.horses) o.feedIds = o.feedIds.filter((id) => id !== editing.id);
  $("feed-dialog").close();
  renderFeeds();
  changed();
});
$("add-feed").addEventListener("click", () => openFeedDialog(null));

// --- your data: share link, files, reset ----------------------------------------

const status = (text) => { $("data-status").textContent = text; };

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  h("a", { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const today = () => new Date().toISOString().slice(0, 10);
// Excel in most of Europe expects semicolons and decimal commas.
const europeanNumbers = () => (1.5).toLocaleString().includes(",");

$("export-backup").addEventListener("click", () => {
  download(`horse-ration-backup-${today()}.json`, JSON.stringify(toPayload(state, "all"), null, 2), "application/json");
  status("Backup file saved to your downloads.");
});

$("export-feeds").addEventListener("click", () => {
  download("horse-feeds.csv", feedsToCsv(state.feeds, { european: europeanNumbers() }), "text/csv");
  status("Feed spreadsheet saved to your downloads. Edit it and import it again to update your feeds.");
});

$("import-file").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // so the same file can be picked again
  if (!file) return;
  try {
    const text = await file.text();
    const payload = text.trimStart().startsWith("{") ? parsePayload(JSON.parse(text)) : csvToPayload(text);
    previewImport(payload, `From ${file.name}`);
  } catch (err) {
    status(`Couldn't read ${file.name}: ${err.message}`);
  }
});

// Nothing is imported silently: show what would change and ask.
let pendingImport = null;

function previewImport(payload, source) {
  const { report, next } = planImport(state, payload);
  const group = (title, names) => (names.length
    ? h("div", {}, h("h3", {}, `${title} (${names.length})`), h("ul", {}, names.map((n) => h("li", {}, n))))
    : null);
  const same = report.feeds.same + report.horses.same;
  $("import-body").replaceChildren(...[
    h("p", { className: "hint" }, source),
    group("New feeds", report.feeds.added),
    group("Feeds that will be updated", report.feeds.changed),
    group("New horses", report.horses.added),
    group("Horses that will be replaced", report.horses.changed),
    report.any
      ? h("p", { className: "hint" },
          (same ? `${same} other item${same === 1 ? " is" : "s are"} already the same. ` : "")
          + "Nothing of yours is deleted; items with the same name take the incoming values.")
      : h("p", {}, "Everything in here is already in your planner, so there is nothing to import."),
  ].filter(Boolean));
  $("import-confirm").hidden = !report.any;
  $("import-cancel").textContent = report.any ? "Cancel" : "Close";
  pendingImport = report.any ? next : null;
  $("import-dialog").showModal();
}

$("import-cancel").addEventListener("click", () => $("import-dialog").close());
$("import-form").addEventListener("submit", () => {
  if (!pendingImport) return;
  state = pendingImport;
  pendingImport = null;
  renderAll();
  changed();
  status("Imported.");
});

// Share link: the data travels inside the link itself, after the #, which
// browsers never send to a server.
const SHARE_PREFIX = "#share=";

async function updateShareLink() {
  const scope = $("share-form").elements.scope.value;
  const data = await encodeShare(toPayload(state, scope, state.current, { compact: true }));
  const link = `${location.origin}${location.pathname}${SHARE_PREFIX}${data}`;
  $("share-link").value = link;
  $("share-note").textContent = link.length > 2000
    ? "This link is long and some chat apps may cut it off. For this much data, a backup file is the safer route."
    : "Anyone who opens the link sees what it would add, and chooses whether to import it.";
}

$("share").addEventListener("click", () => {
  const form = $("share-form");
  $("share-horse-label").textContent = `${horse().name} and the feeds ticked for it`;
  form.elements.scope.value = "horse";
  $("share-native").hidden = !navigator.share;
  $("share-copy").textContent = "Copy link";
  updateShareLink();
  $("share-dialog").showModal();
});
$("share-form").addEventListener("change", updateShareLink);
$("share-close").addEventListener("click", () => $("share-dialog").close());
$("share-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("share-link").value);
    $("share-copy").textContent = "Copied";
  } catch {
    $("share-link").select(); // clipboard blocked: leave it selected for a manual copy
    $("share-copy").textContent = "Press Ctrl/Cmd+C";
  }
});
$("share-native").addEventListener("click", () => {
  navigator.share({ title: "Horse ration planner", url: $("share-link").value }).catch(() => {});
});

async function openSharedLink() {
  if (!location.hash.startsWith(SHARE_PREFIX)) return;
  const data = location.hash.slice(SHARE_PREFIX.length);
  history.replaceState(null, "", location.pathname + location.search); // don't re-offer on reload
  try {
    previewImport(await decodeShare(data), "From a shared link");
  } catch (err) {
    status("That share link couldn't be read; it may have been cut off when it was sent.");
  }
}
window.addEventListener("hashchange", openSharedLink);

$("reset-slot").append(confirmButton("Reset everything to defaults", "Tap again to reset; this removes all your horses and feeds", () => {
  state = defaults();
  renderAll();
  changed();
  status("Everything was reset.");
}));

// --- solving and results ---------------------------------------------------

function changed() {
  save(localStorage, state);
  update();
}

async function update() {
  if (!glpk) return;
  const seq = ++solveSeq;
  const hz = horse();
  const feeds = state.feeds.filter((f) => hz.feedIds.includes(f.id) && f.dm > 0);
  const out = $("result");
  $("result-title").textContent = state.horses.length > 1 ? `Daily ration for ${hz.name}` : "Daily ration";
  if (!(hz.weight > 0)) return out.replaceChildren(notice("Enter a body weight", "The intake limits depend on it."));
  if (feeds.length === 0) return out.replaceChildren(notice("No feeds selected", "Tick at least one feed to get a ration."));
  // A required nutrient that no selected feed contains: say so directly.
  const missing = NUTRIENTS.filter((n) => hz.req[n.key] > 0 && !feeds.some((f) => f[n.key] > 0));
  if (missing.length) {
    return out.replaceChildren(notice("No ration fits these feeds",
      "None of the selected feeds contain the following. Add a feed that does (a mineral balancer, for example), or enter the values on your feeds:",
      missing.map((n) => n.label)));
  }
  let res;
  try {
    res = await solve(glpk, feeds, hz);
  } catch (err) {
    console.error(err);
    if (seq === solveSeq) out.replaceChildren(notice("Something went wrong", "The solver failed on this input."));
    return;
  }
  if (seq !== solveSeq) return; // a newer change is already being solved
  out.replaceChildren(...(res.ok ? renderRation(feeds, res, hz) : [renderInfeasible(res)]));
}

function notice(title, text, items = []) {
  return h("div", { className: "notice" }, h("strong", {}, title), text,
    items.length ? h("ul", {}, items.map((i) => h("li", {}, i))) : null);
}

function renderInfeasible(res) {
  return res.culprits.length
    ? notice("No ration fits these feeds",
        "The selected feeds can't meet every requirement at once. A ration would exist if any one of these were relaxed:",
        res.culprits)
    : notice("No ration fits these feeds",
        "Several requirements conflict at once. Try adding more feeds, or check the requirement values.");
}

function renderRation(feeds, { amounts, summary }, hz) {
  const used = feeds.map((f, i) => ({ f, kg: amounts[i] })).filter((u) => u.kg > 0).sort((a, b) => b.kg - a.kg);
  const max = Math.max(...used.map((u) => u.kg));
  const check = (ok) => (ok ? "✓" : "✗");
  const [dmLo, dmHi] = LIMITS.dmi;
  const eps = 1e-6;

  return [
    h("ul", { className: "ration" }, used.map((u) =>
      h("li", {},
        h("span", {}, u.f.name),
        h("span", { className: "amount" }, u.kg < 1 ? `${fmt(u.kg * 1000, 0)} g` : `${fmt(u.kg, 2)} kg`),
        h("span", { className: "bar" }, h("i", { style: `width:${(u.kg / max) * 100}%` }))))),
    h("p", { className: "totals" },
      `${fmt(summary.asFed, 2)} kg per day as fed · ${fmt(summary.delivered.starch, 0)} g starch`),

    h("h3", {}, "Nutrients per day"),
    h("div", { className: "table-wrap" },
      h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "Ration"), h("th", {}, "Needed"), h("th", {}, ""))),
        h("tbody", {}, NUTRIENTS.map((n) =>
          h("tr", {},
            h("td", {}, n.label),
            h("td", {}, `${fmt(summary.delivered[n.key], n.digits)} ${n.unit}`),
            h("td", { className: "sub" }, `${fmt(hz.req[n.key], n.digits)} ${n.unit}`),
            h("td", {}, check(summary.delivered[n.key] >= hz.req[n.key] - eps))))))),

    h("h3", {}, "Balance checks"),
    h("div", { className: "table-wrap" },
      h("table", {},
        h("tbody", {},
          RATIOS.map((r) => {
            const v = summary.ratios[r.id];
            const ok = v != null && (r.lo == null || v >= r.lo - eps) && v <= r.hi + eps;
            return h("tr", {},
              h("td", {}, ratioName(r), hz.ratios[r.id] ? null : h("span", { className: "sub" }, " (not kept)")),
              h("td", {}, v == null ? "–" : `${fmt(v, 2)} : 1`),
              h("td", { className: "sub" }, ratioRange(r)),
              h("td", {}, check(ok)));
          }),
          MAX_NUTRIENTS.filter((n) => hz.max[n.key] > 0).map((n) =>
            h("tr", {},
              h("td", {}, `${n.label} upper limit`),
              h("td", {}, `${fmt(summary.delivered[n.key], n.digits)} ${n.unit}`),
              h("td", { className: "sub" }, `max ${fmt(hz.max[n.key], n.digits)} ${n.unit}`),
              h("td", {}, check(summary.delivered[n.key] <= hz.max[n.key] + eps)))),
          h("tr", {},
            h("td", {}, "Forage share of dry matter"),
            h("td", {}, `${fmt(summary.forageShare * 100, 0)}%`),
            h("td", { className: "sub" }, `min ${LIMITS.minForage * 100}%`),
            h("td", {}, check(summary.forageShare >= LIMITS.minForage - eps))),
          h("tr", {},
            h("td", {}, `Dry matter (${fmt(summary.dm, 1)} kg) vs body weight`),
            h("td", {}, `${fmt(summary.dmShare * 100, 2)}%`),
            h("td", { className: "sub" }, `${dmLo * 100}–${dmHi * 100}%`),
            h("td", {}, check(summary.dmShare >= dmLo - eps && summary.dmShare <= dmHi + eps)))))),
  ];
}

// --- start ---------------------------------------------------------------

renderAll();
openSharedLink();
GLPK().then((g) => { glpk = g; update(); }).catch((err) => {
  console.error(err);
  $("result").replaceChildren(notice("Solver failed to load", "Try reloading the page."));
});
