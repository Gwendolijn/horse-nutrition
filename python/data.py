# data.py

# todo: different horse profiles (weight / exercise)
horse_requirements = {
    "min_req": {
       "energy": 75, #MJ
       "protein": 700, #g
       #"lysine": 27, #g
       "calcium": 20, #g
       "phosphorus": 14#, #g
       #"magnesium": 7.5, #g
       #"sodium": 10, #g
       #"chloride": 40, #g
       #"potassium": 25, #g
       #"copper": 100, #mg
       #"zinc": 400, #mg
       #"manganese": 400, #mg
       #"iron": 400, #mg
       #"selenium": 1, #mg
       #"iodine": 3.5, #mg
       #"vitaminA": 15000, #IU
       #"vitaminD": 3000, #IU
       #"vitaminE": 500 #IU
    },
    "forage_feeds": ["grass_hay", "alfalfa_hay"],
}

# feed = water + dry matter
# nutrition is often expressed wrt dry matter weight (unit/kg DM)
feed_table = {
    "grass_hay": {
        "dm": 0.90,
        "energy": 8.0,
        "protein": 90,
        "calcium": 4.0,
        "phosphorus": 2.0,
        "starch": 15
    },

    "alfalfa_hay": {
        "dm": 0.90,
        "energy": 9.0,
        "protein": 170,
        "calcium": 14.0,
        "phosphorus": 2.5,
        "starch": 20
    },

    "oats": {
        "dm": 0.88,
        "energy": 13.0,
        "protein": 120,
        "calcium": 1.0,
        "phosphorus": 3.5,
        "starch": 430
    },

    "soybean_meal": {
        "dm": 0.90,
        "energy": 12.0,
        "protein": 440,
        "calcium": 3.0,
        "phosphorus": 6.5,
        "starch": 60
    },

    "beet_pulp": {
        "dm": 0.90,
        "energy": 11.5,
        "protein": 100,
        "calcium": 8.0,
        "phosphorus": 1.0,
        "starch": 20
    }
}