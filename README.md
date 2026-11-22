# Horse ration planner

A web page that works out a daily feed ration for a horse. You pick the feeds you have; it finds the ration that meets the nutritional requirements with as much of the energy from forage as possible, and then the least starch.

It is a static page with no server. The ration is a linear programming problem, solved in the browser with GLPK compiled to WebAssembly ([glpk.js](https://github.com/jvail/glpk.js), GPL-3.0, vendored in `vendor/`).

## Running it

- Locally: `python3 -m http.server 8123`, then open http://localhost:8123
- Published: push to GitHub and enable Pages for the root of the main branch.

## Files

- `index.html`, `style.css`: the page.
- `app.js`: the page's behaviour.
- `model.js`: the ration model (requirements, constraints and the two-step solve).
- `store.js`: the saved data (a shared feed library and several horses) and its formats: backup file (JSON), feed spreadsheet (CSV) and share link.
- `vendor/`: glpk.js and its licence.
- `python/`: the original Pyomo prototype.

Data is saved in the browser's local storage only. Moving it between devices is done with a share link or a file.

## Python prototype

`python/` holds the first version of the model, using Pyomo and GLPK. The web app has since moved ahead of it: more nutrients, mineral ratios, upper limits and the forage-first solve exist only in `model.js`.

Run with `cd python && python3 solve.py` (needs `pyomo` and the `glpsol` binary).

## Licence

GPL-3.0; see `LICENSE`. The page includes GLPK (via glpk.js), which is licensed under the GPL, so the project as a whole is distributed under the same terms.
