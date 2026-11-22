# solve.py

from pyomo.environ import SolverFactory, value
from data import feed_table, horse_requirements
from model import build_diet_model

m = build_diet_model(feed_table, horse_requirements)

solver = SolverFactory("glpk")
result = solver.solve(m, tee=False)

print("Status:", result.solver.status)
print("Termination:", result.solver.termination_condition)
print(f"Minimum daily starch: {value(m.obj):.2f} g\n")

print("Optimal ration (kg/day as fed):")
for f in m.FEEDS:
    print(f"  {f:10s} {value(m.x[f]):.3f}")

print("\nDelivered nutrients:")
for n in m.NUTRIENTS:
    print(f"  {n:12s} {value(m.delivered(m, n)):.2f}")