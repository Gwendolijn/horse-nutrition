# model.py

from pyomo.environ import (
    ConcreteModel, Set, Param, Var, NonNegativeReals,
    Objective, Constraint, minimize
)


def build_diet_model(feed_table, horse_requirements):
    m = ConcreteModel()

    feeds = list(feed_table.keys())

    min_req_dict = horse_requirements.get("min_req", {})
    max_req_dict = horse_requirements.get("max_req", {})
    forage_feeds = horse_requirements.get("forage_feeds", [])

    # Collect all nutrients mentioned anywhere
    # (requirements, plus those used by the objective and ratio constraints)
    nutrients = sorted(
        set(min_req_dict) | set(max_req_dict) | {"starch", "calcium", "phosphorus"}
    )

    # Flatten data for Pyomo Params
    content_dict = {}
    for f in feeds:
        for n in nutrients:
            content_dict[(n, f)] = feed_table[f].get(n, 0.0)

    dms = {}
    for f in feeds:
        dms[f] = feed_table[f].get("dm", 1.0)

    # Sets
    m.FEEDS = Set(initialize=feeds)
    m.NUTRIENTS = Set(initialize=nutrients)
    m.MIN_NUTRIENTS = Set(initialize=list(min_req_dict.keys()))
    m.MAX_NUTRIENTS = Set(initialize=list(max_req_dict.keys()))
    m.FORAGE_FEEDS = Set(initialize=forage_feeds)

    # Params
    m.content = Param(m.NUTRIENTS, m.FEEDS, initialize=content_dict, default=0.0)
    m.min_req = Param(m.MIN_NUTRIENTS, initialize=min_req_dict)
    m.max_req = Param(m.MAX_NUTRIENTS, initialize=max_req_dict)
    m.dm = Param(m.FEEDS, initialize=dms)

    # Decision variables
    m.x = Var(m.FEEDS, domain=NonNegativeReals)

    # x is as-fed kg/day; feed table content is per kg dry matter,
    # so delivered amount of a nutrient is content * dm * x
    def delivered(model, n):
        return sum(model.content[n, f] * model.dm[f] * model.x[f] for f in model.FEEDS)

    m.delivered = delivered

    # Objective: minimise starch
    # todo: add feed prices and minimise cost (possibly as secondary objective)
    # optimising for minimum amount of different feeds used would make sense --> MILP
    def obj_rule(model):
        return delivered(model, "starch")

    m.obj = Objective(rule=obj_rule, sense=minimize)

    # Minimum nutrient constraints
    def min_nutrient_rule(model, n):
        return delivered(model, n) >= model.min_req[n]

    m.min_nutrient_con = Constraint(m.MIN_NUTRIENTS, rule=min_nutrient_rule)

    # Maximum nutrient constraints
    def max_nutrient_rule(model, n):
        return delivered(model, n) <= model.max_req[n]

    m.max_nutrient_con = Constraint(m.MAX_NUTRIENTS, rule=max_nutrient_rule)

    # 1.2 <= Ca / P <= 2.0
    min_ca_p_ratio = 1.2
    max_ca_p_ratio = 2.0

    def ca_p_min_rule(model):
        return delivered(model, "calcium") >= min_ca_p_ratio * delivered(model, "phosphorus")

    def ca_p_max_rule(model):
        return delivered(model, "calcium") <= max_ca_p_ratio * delivered(model, "phosphorus")

    m.ca_p_min = Constraint(rule=ca_p_min_rule)
    m.ca_p_max = Constraint(rule=ca_p_max_rule)

    # 3 <= Zn / Cu <= 4
    # disabled until the feed table has copper and zinc values
    min_zn_cu_ratio = 3.0
    max_zn_cu_ratio = 4.0

    def zn_cu_min_rule(model):
        return delivered(model, "zinc") >= min_zn_cu_ratio * delivered(model, "copper")

    def zn_cu_max_rule(model):
        return delivered(model, "zinc") <= max_zn_cu_ratio * delivered(model, "copper")

    #m.zn_cu_min = Constraint(rule=zn_cu_min_rule)
    #m.zn_cu_max = Constraint(rule=zn_cu_max_rule)

    # at least 60% of dry matter must be forage
    min_forage_ratio = 0.6

    def forage_ratio_rule(model):
        forage_dm = sum(model.dm[f] * model.x[f] for f in model.FORAGE_FEEDS)
        total_dm = sum(model.dm[f] * model.x[f] for f in model.FEEDS)
        return forage_dm >= min_forage_ratio * total_dm

    m.forage_ratio = Constraint(rule=forage_ratio_rule)

    # dry matter intake (DMI) is roughly 1.5 - 2.5 % of body weight (forage)
    min_dm_ratio = 0.015
    max_dm_ratio = 0.025 
    weight = 500

    def dm_min_rule(model):
        dm = sum(model.dm[f] * model.x[f] for f in model.FEEDS)
        return dm >= min_dm_ratio * weight

    def dm_max_rule(model):
        dm = sum(model.dm[f] * model.x[f] for f in model.FEEDS)
        return dm <= max_dm_ratio * weight

    m.dm_min = Constraint(rule=dm_min_rule)
    m.dm_max = Constraint(rule=dm_max_rule)

    return m