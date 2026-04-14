// ============================================================
// NUTRITION CALCULATOR V2 — DATA LAYER
// Extracted verbatim from V1 index.html (lines 28-641)
// ============================================================

// NUTRIENT KEYS & DISPLAY CONFIG
const NUTRIENT_KEYS = [
  "protein","carbs","fat","fiber","sat_fat","epa_dha",
  "calcium","iron","zinc","vit_d","vit_e","b12",
  "folate","vit_c","potassium","magnesium"
];

const NUTRIENT_LABELS = {
  protein:"Protein", carbs:"Carbs", fat:"Total Fat", fiber:"Fiber",
  sat_fat:"Sat Fat", epa_dha:"EPA+DHA", calcium:"Calcium", iron:"Iron",
  zinc:"Zinc", vit_d:"Vitamin D", vit_e:"Vitamin E", b12:"Vitamin B12",
  folate:"Folate", vit_c:"Vitamin C", potassium:"Potassium", magnesium:"Magnesium"
};

const NUTRIENT_UNITS = {
  protein:"g", carbs:"g", fat:"g", fiber:"g", sat_fat:"g", epa_dha:"mg",
  calcium:"mg", iron:"mg", zinc:"mg", vit_d:"IU", vit_e:"mg", b12:"mcg",
  folate:"mcg", vit_c:"mg", potassium:"mg", magnesium:"mg"
};

// Nutrient groupings for Dashboard display
const VITAMIN_KEYS = ["vit_d","vit_c","b12","vit_e","folate"];
const MINERAL_KEYS = ["calcium","iron","zinc","potassium","magnesium"];
const MACRO_KEYS = ["protein","carbs","fat","fiber","sat_fat","epa_dha"];

// Nutrient icons for Dashboard
const NUTRIENT_ICONS = {
  protein:"fitness_center", carbs:"grain", fat:"water_drop", fiber:"eco",
  sat_fat:"warning", epa_dha:"water_drop", calcium:"skeleton", iron:"hard_drive",
  zinc:"science", vit_d:"sunny", vit_e:"spa", b12:"pill",
  folate:"pill", vit_c:"health_and_safety", potassium:"science", magnesium:"science"
};

// ============================================================
// OBJECTIVES (from objectives.csv)
// ============================================================
const OBJECTIVES = {
  protein:   { min:116, max:145, type:"range" },
  carbs:     { min:363, max:508, type:"range" },
  fat:       { min:65,  max:85,  type:"range" },
  fiber:     { min:38,  max:null, type:"minimum" },
  sat_fat:   { min:null, max:28, type:"maximum" },
  epa_dha:   { min:250, max:1000, type:"range" },
  calcium:   { min:1000, max:null, type:"minimum" },
  iron:      { min:8,   max:null, type:"minimum" },
  zinc:      { min:11,  max:null, type:"minimum" },
  vit_d:     { min:800, max:2000, type:"range" },
  vit_e:     { min:15,  max:20, type:"range" },
  b12:       { min:2.4, max:null, type:"minimum" },
  folate:    { min:400, max:null, type:"minimum" },
  vit_c:     { min:90,  max:null, type:"minimum" },
  potassium: { min:3400, max:4000, type:"range" },
  magnesium: { min:420, max:null, type:"minimum" }
};

// Estimated daily calorie target (derived from macro objectives midpoints)
const CALORIE_TARGET = 2400;

// ============================================================
// INGREDIENTS — USDA-based estimates per default serving
// ============================================================
const INGREDIENTS = {
  pea_protein: {
    name:"Pea protein isolate", defaultQty:48, unit:"g", category:"protein",
    protein:38.4, carbs:1.4, fat:3.0, fiber:0.5, sat_fat:0.6,
    epa_dha:0, calcium:28, iron:8.1, zinc:0.96, vit_d:0,
    vit_e:0, b12:0, folate:40, vit_c:0, potassium:148, magnesium:44
  },
  soy_protein: {
    name:"Soy protein isolate", defaultQty:40, unit:"g", category:"protein",
    protein:36.0, carbs:1.0, fat:0.2, fiber:0, sat_fat:0,
    epa_dha:0, calcium:80, iron:4.0, zinc:0.4, vit_d:0,
    vit_e:0, b12:0, folate:58, vit_c:0, potassium:119, magnesium:25
  },
  rolled_oats_40: {
    name:"Rolled oats", defaultQty:40, unit:"g", category:"grain",
    protein:5.3, carbs:27.2, fat:2.7, fiber:4.0, sat_fat:0.5,
    epa_dha:0, calcium:22, iron:1.5, zinc:1.5, vit_d:0,
    vit_e:0.2, b12:0, folate:13, vit_c:0, potassium:147, magnesium:56
  },
  oatmeal_30: {
    name:"Oatmeal", defaultQty:30, unit:"g", category:"grain",
    protein:4.0, carbs:20.4, fat:2.0, fiber:3.0, sat_fat:0.4,
    epa_dha:0, calcium:16, iron:1.1, zinc:1.1, vit_d:0,
    vit_e:0.15, b12:0, folate:10, vit_c:0, potassium:110, magnesium:42
  },
  rice_cooked: {
    name:"Rice (cooked)", defaultQty:150, unit:"g", category:"grain",
    protein:4.0, carbs:53.0, fat:0.4, fiber:0.6, sat_fat:0.1,
    epa_dha:0, calcium:3, iron:0.3, zinc:0.8, vit_d:0,
    vit_e:0, b12:0, folate:5, vit_c:0, potassium:35, magnesium:12
  },
  peruvian_corn: {
    name:"Peruvian corn cancha", defaultQty:10, unit:"g", category:"grain",
    protein:0.9, carbs:7.5, fat:0.5, fiber:1.0, sat_fat:0.1,
    epa_dha:0, calcium:2, iron:0.3, zinc:0.2, vit_d:0,
    vit_e:0.1, b12:0, folate:5, vit_c:0, potassium:25, magnesium:12
  },
  corn_tortillas: {
    name:"Corn tortillas (2, ~60g)", defaultQty:60, unit:"g", category:"grain",
    protein:4.0, carbs:28.0, fat:2.0, fiber:3.0, sat_fat:0.3,
    epa_dha:0, calcium:80, iron:0.8, zinc:0.5, vit_d:0,
    vit_e:0.2, b12:0, folate:10, vit_c:0, potassium:100, magnesium:20
  },
  maya_nut: {
    name:"Maya nut", defaultQty:10, unit:"g", category:"seed",
    protein:1.1, carbs:6.5, fat:0.2, fiber:2.0, sat_fat:0.05,
    epa_dha:0, calcium:55, iron:0.4, zinc:0.2, vit_d:0,
    vit_e:0, b12:0, folate:8, vit_c:0, potassium:48, magnesium:15
  },
  flaxseed: {
    name:"Flaxseed", defaultQty:10, unit:"g", category:"seed",
    protein:1.8, carbs:2.9, fat:4.2, fiber:2.7, sat_fat:0.4,
    epa_dha:0, calcium:26, iron:0.6, zinc:0.4, vit_d:0,
    vit_e:0.3, b12:0, folate:9, vit_c:0, potassium:81, magnesium:39
  },
  chia_seeds: {
    name:"Chia seeds", defaultQty:12, unit:"g", category:"seed",
    protein:2.0, carbs:5.0, fat:4.2, fiber:4.1, sat_fat:0.4,
    epa_dha:0, calcium:76, iron:0.9, zinc:0.6, vit_d:0,
    vit_e:0.1, b12:0, folate:6, vit_c:0, potassium:49, magnesium:40
  },
  sesame_seeds: {
    name:"Sesame seeds", defaultQty:9, unit:"g", category:"seed",
    protein:1.6, carbs:2.1, fat:4.4, fiber:1.1, sat_fat:0.6,
    epa_dha:0, calcium:88, iron:1.3, zinc:0.7, vit_d:0,
    vit_e:0.2, b12:0, folate:9, vit_c:0, potassium:42, magnesium:32
  },
  almonds: {
    name:"Almonds (3)", defaultQty:4, unit:"g", category:"nut",
    protein:0.8, carbs:0.9, fat:2.0, fiber:0.5, sat_fat:0.15,
    epa_dha:0, calcium:10, iron:0.15, zinc:0.12, vit_d:0,
    vit_e:1.0, b12:0, folate:2, vit_c:0, potassium:28, magnesium:11
  },
  pumpkin_seeds: {
    name:"Pumpkin seeds", defaultQty:10, unit:"g", category:"seed",
    protein:3.0, carbs:1.4, fat:4.9, fiber:0.6, sat_fat:0.9,
    epa_dha:0, calcium:5, iron:0.8, zinc:0.8, vit_d:0,
    vit_e:0.3, b12:0, folate:6, vit_c:0, potassium:81, magnesium:55
  },
  hemp_seeds: {
    name:"Hemp seeds", defaultQty:10, unit:"g", category:"seed",
    protein:3.2, carbs:0.9, fat:4.9, fiber:0.4, sat_fat:0.5,
    epa_dha:0, calcium:7, iron:0.8, zinc:1.0, vit_d:0,
    vit_e:0.8, b12:0, folate:11, vit_c:0, potassium:120, magnesium:70
  },
  sunflower_seeds: {
    name:"Sunflower seeds", defaultQty:10, unit:"g", category:"seed",
    protein:2.1, carbs:2.0, fat:5.1, fiber:0.9, sat_fat:0.5,
    epa_dha:0, calcium:8, iron:0.5, zinc:0.5, vit_d:0,
    vit_e:3.5, b12:0, folate:23, vit_c:0.1, potassium:65, magnesium:33
  },
  papaya: {
    name:"Papaya (3 slices)", defaultQty:150, unit:"g", category:"fruit",
    protein:0.7, carbs:16.1, fat:0.4, fiber:2.7, sat_fat:0.1,
    epa_dha:0, calcium:30, iron:0.4, zinc:0.1, vit_d:0,
    vit_e:0.3, b12:0, folate:57, vit_c:92, potassium:257, magnesium:15
  },
  pineapple: {
    name:"Pineapple (3 slices)", defaultQty:150, unit:"g", category:"fruit",
    protein:0.8, carbs:19.8, fat:0.2, fiber:2.1, sat_fat:0.02,
    epa_dha:0, calcium:20, iron:0.4, zinc:0.2, vit_d:0,
    vit_e:0.03, b12:0, folate:27, vit_c:72, potassium:165, magnesium:18
  },
  banana: {
    name:"Banana (1 medium)", defaultQty:120, unit:"g", category:"fruit",
    protein:1.3, carbs:27.4, fat:0.2, fiber:3.1, sat_fat:0.1,
    epa_dha:0, calcium:6, iron:0.3, zinc:0.2, vit_d:0,
    vit_e:0, b12:0, folate:24, vit_c:10.4, potassium:430, magnesium:32
  },
  aloe_vera: {
    name:"Aloe vera (1 slice)", defaultQty:30, unit:"g", category:"fruit",
    protein:0.1, carbs:2.4, fat:0.1, fiber:0.1, sat_fat:0,
    epa_dha:0, calcium:9, iron:0.05, zinc:0.02, vit_d:0,
    vit_e:0, b12:0, folate:7, vit_c:1.2, potassium:26, magnesium:3
  },
  spinach: {
    name:"Spinach (raw)", defaultQty:80, unit:"g", category:"vegetable",
    protein:2.3, carbs:2.9, fat:0.3, fiber:1.8, sat_fat:0.05,
    epa_dha:0, calcium:79, iron:2.2, zinc:0.4, vit_d:0,
    vit_e:1.6, b12:0, folate:155, vit_c:22.5, potassium:446, magnesium:63
  },
  red_bell_pepper: {
    name:"Roasted red bell pepper", defaultQty:120, unit:"g", category:"vegetable",
    protein:1.2, carbs:8.6, fat:0.4, fiber:2.5, sat_fat:0.05,
    epa_dha:0, calcium:8, iron:0.5, zinc:0.3, vit_d:0,
    vit_e:1.9, b12:0, folate:55, vit_c:153, potassium:260, magnesium:14
  },
  creole_potatoes: {
    name:"Creole potatoes (3 small)", defaultQty:120, unit:"g", category:"vegetable",
    protein:2.4, carbs:20.5, fat:0.1, fiber:2.6, sat_fat:0.03,
    epa_dha:0, calcium:14, iron:0.9, zinc:0.4, vit_d:0,
    vit_e:0, b12:0, folate:19, vit_c:14.5, potassium:500, magnesium:28
  },
  avocado_third: {
    name:"Avocado (1/3)", defaultQty:55, unit:"g", category:"fruit",
    protein:1.0, carbs:4.5, fat:8.0, fiber:3.5, sat_fat:1.1,
    epa_dha:0, calcium:7, iron:0.3, zinc:0.35, vit_d:0,
    vit_e:1.1, b12:0, folate:44, vit_c:5.5, potassium:260, magnesium:16
  },
  veg_meat_lentil: {
    name:"Veg meat (lentil/chickpea)", defaultQty:81, unit:"g", category:"protein",
    protein:14.5, carbs:13.0, fat:2.5, fiber:5.4, sat_fat:0.3,
    epa_dha:0, calcium:25, iron:2.7, zinc:1.5, vit_d:0,
    vit_e:0.2, b12:0, folate:80, vit_c:1.5, potassium:310, magnesium:35
  },
  egg: {
    name:"Egg (1 whole)", defaultQty:50, unit:"g", category:"protein",
    protein:6.3, carbs:0.4, fat:5.0, fiber:0, sat_fat:1.6,
    epa_dha:0, calcium:28, iron:0.9, zinc:0.65, vit_d:41, vit_e:0.5,
    b12:0.5, folate:24, vit_c:0, potassium:69, magnesium:6
  },
  bean_soup: {
    name:"Bean soup (2 servings)", defaultQty:340, unit:"g", category:"protein",
    protein:24.3, carbs:61.6, fat:2.1, fiber:22.0, sat_fat:0.5,
    epa_dha:0, calcium:76, iron:5.9, zinc:2.4, vit_d:0,
    vit_e:0, b12:0, folate:194, vit_c:5.5, potassium:1096, magnesium:124
  },
  greek_yogurt: {
    name:"Greek yogurt (100g)", defaultQty:100, unit:"g", category:"dairy",
    protein:6.4, carbs:5.2, fat:5.9, fiber:0, sat_fat:3.5,
    epa_dha:0, calcium:132, iron:0.61, zinc:0.52, vit_d:13.6,
    vit_e:0.1, b12:0.75, folate:7, vit_c:0.5, potassium:141, magnesium:11
  },
  nutritional_yeast: {
    name:"Nutritional yeast (2 tbsp)", defaultQty:10, unit:"g", category:"supplement_food",
    protein:5.0, carbs:3.6, fat:0.5, fiber:2.0, sat_fat:0.1,
    epa_dha:0, calcium:2, iron:0.6, zinc:1.6, vit_d:0,
    vit_e:0, b12:8.0, folate:120, vit_c:0, potassium:100, magnesium:10
  },
  olive_oil: {
    name:"Olive oil (1 tbsp)", defaultQty:14, unit:"ml", category:"fat",
    protein:0, carbs:0, fat:14.0, fiber:0, sat_fat:1.9,
    epa_dha:0, calcium:0, iron:0.1, zinc:0, vit_d:0,
    vit_e:1.9, b12:0, folate:0, vit_c:0, potassium:0, magnesium:0
  },
  apple_cider_vinegar: {
    name:"Apple cider vinegar", defaultQty:15, unit:"ml", category:"condiment",
    protein:0, carbs:0.1, fat:0, fiber:0, sat_fat:0,
    epa_dha:0, calcium:1, iron:0, zinc:0, vit_d:0,
    vit_e:0, b12:0, folate:0, vit_c:0, potassium:11, magnesium:1
  },
  cinnamon: {
    name:"Cinnamon", defaultQty:3, unit:"g", category:"spice",
    protein:0.1, carbs:3.1, fat:0, fiber:2.1, sat_fat:0,
    epa_dha:0, calcium:5, iron:0.15, zinc:0.28, vit_d:0,
    vit_e:0, b12:0, folate:0, vit_c:0, potassium:13, magnesium:2
  },
  fortified_plant_milk: {
    name:"Fortified plant milk (1 serving)", defaultQty:250, unit:"ml", category:"dairy",
    protein:3.0, carbs:12.0, fat:3.6, fiber:1.0, sat_fat:0.5,
    epa_dha:0, calcium:653, iron:3.3, zinc:1.6, vit_d:136,
    vit_e:1.55, b12:0.5, folate:20, vit_c:1.6, potassium:200, magnesium:20
  },
  scotts_emulsion: {
    name:"Scott's Emulsion (1 tbsp)", defaultQty:15, unit:"ml", category:"supplement_food",
    protein:0, carbs:0, fat:4.5, fiber:0, sat_fat:1.0,
    epa_dha:300, calcium:130, iron:0, zinc:0, vit_d:340,
    vit_e:0, b12:0, folate:0, vit_c:0, potassium:0, magnesium:0
  },
  oat_milk: {
    name:"Oat milk (1 serving)", defaultQty:250, unit:"ml", category:"dairy",
    protein:3.0, carbs:16.0, fat:5.0, fiber:2.0, sat_fat:0.5,
    epa_dha:0, calcium:350, iron:0.3, zinc:0.5, vit_d:120,
    vit_e:0, b12:1.2, folate:0, vit_c:0, potassium:190, magnesium:20
  },
  almond_milk: {
    name:"Almond milk (1 serving)", defaultQty:250, unit:"ml", category:"dairy",
    protein:1.0, carbs:8.0, fat:2.5, fiber:1.0, sat_fat:0.2,
    epa_dha:0, calcium:450, iron:0.7, zinc:0.4, vit_d:100,
    vit_e:7.3, b12:1.2, folate:0, vit_c:0, potassium:170, magnesium:15
  },
  sweet_potato: {
    name:"Sweet potato (120g)", defaultQty:120, unit:"g", category:"vegetable",
    protein:1.9, carbs:24.0, fat:0.1, fiber:3.6, sat_fat:0.03,
    epa_dha:0, calcium:36, iron:0.7, zinc:0.4, vit_d:0,
    vit_e:0.3, b12:0, folate:6, vit_c:19.6, potassium:438, magnesium:30
  },
  quinoa_cooked: {
    name:"Quinoa (cooked, 150g)", defaultQty:150, unit:"g", category:"grain",
    protein:6.6, carbs:32.0, fat:2.8, fiber:4.0, sat_fat:0.3,
    epa_dha:0, calcium:24, iron:2.0, zinc:1.5, vit_d:0,
    vit_e:0.2, b12:0, folate:27, vit_c:0, potassium:230, magnesium:90
  },
  tofu: {
    name:"Firm tofu (100g)", defaultQty:100, unit:"g", category:"protein",
    protein:17.3, carbs:2.8, fat:8.7, fiber:2.3, sat_fat:1.3,
    epa_dha:0, calcium:350, iron:5.4, zinc:2.0, vit_d:0,
    vit_e:0.1, b12:0, folate:15, vit_c:0.2, potassium:237, magnesium:58
  },
  pear_cheese: {
    name:"Pear cheese (60g)", defaultQty:60, unit:"g", category:"snack",
    protein:4.0, carbs:1.0, fat:10.0, fiber:0, sat_fat:9.0,
    epa_dha:0, calcium:120, iron:0.1, zinc:0.5, vit_d:5,
    vit_e:0.1, b12:0.3, folate:3, vit_c:0, potassium:15, magnesium:5
  },
  pandeyuca: {
    name:"Pandeyuca (1 piece)", defaultQty:80, unit:"g", category:"snack",
    protein:3.0, carbs:25.0, fat:8.0, fiber:0.5, sat_fat:5.0,
    epa_dha:0, calcium:60, iron:0.3, zinc:0.3, vit_d:0,
    vit_e:0, b12:0.1, folate:5, vit_c:0, potassium:40, magnesium:8
  },
  supp_turmeric: {
    name:"Turmeric", defaultQty:1, unit:"cap", category:"supplement",
    protein:0, carbs:0, fat:0, fiber:0, sat_fat:0,
    epa_dha:0, calcium:0, iron:0, zinc:0, vit_d:0,
    vit_e:0, b12:0, folate:0, vit_c:0, potassium:0, magnesium:0
  },
  supp_krill: {
    name:"Krill", defaultQty:1, unit:"softgel", category:"supplement",
    protein:0, carbs:0, fat:1.0, fiber:0, sat_fat:0.2,
    epa_dha:200, calcium:0, iron:0, zinc:0, vit_d:0,
    vit_e:0, b12:0, folate:0, vit_c:0, potassium:0, magnesium:0
  },
  supp_omega3: {
    name:"Omega-3", defaultQty:1, unit:"softgel", category:"supplement",
    protein:0, carbs:0, fat:1.0, fiber:0, sat_fat:0.2,
    epa_dha:600, calcium:0, iron:0, zinc:0, vit_d:0,
    vit_e:0, b12:0, folate:0, vit_c:0, potassium:0, magnesium:0
  },
  supp_garlic: {
    name:"Garlic", defaultQty:1, unit:"softgel", category:"supplement",
    protein:0, carbs:0, fat:0, fiber:0, sat_fat:0,
    epa_dha:0, calcium:0, iron:0, zinc:0, vit_d:0,
    vit_e:0, b12:0, folate:0, vit_c:0, potassium:0, magnesium:0
  },
  supp_b12: {
    name:"B12", defaultQty:1, unit:"nugget", category:"supplement",
    protein:0, carbs:0, fat:0, fiber:0, sat_fat:0,
    epa_dha:0, calcium:0, iron:0, zinc:0, vit_d:0,
    vit_e:0, b12:5000, folate:0, vit_c:0, potassium:0, magnesium:0
  },
  supp_potassium: {
    name:"Potassium", defaultQty:1, unit:"tab", category:"supplement",
    protein:0, carbs:0, fat:0, fiber:0, sat_fat:0,
    epa_dha:0, calcium:0, iron:0, zinc:0, vit_d:0,
    vit_e:0, b12:0, folate:0, vit_c:0, potassium:99, magnesium:0
  },
  supp_lion: {
    name:"Lion's Mane", defaultQty:1, unit:"cap", category:"supplement",
    protein:0, carbs:0, fat:0, fiber:0, sat_fat:0,
    epa_dha:0, calcium:0, iron:0, zinc:0, vit_d:0,
    vit_e:0, b12:0, folate:0, vit_c:0, potassium:0, magnesium:0
  },
  supp_biosil: {
    name:"BioSil ch-OSA", defaultQty:1, unit:"cap", category:"supplement",
    protein:0, carbs:0, fat:0, fiber:0, sat_fat:0,
    epa_dha:0, calcium:0, iron:0, zinc:0, vit_d:0,
    vit_e:0, b12:0, folate:0, vit_c:0, potassium:0, magnesium:0
  },
  supp_coq: {
    name:"CoQ-10", defaultQty:1, unit:"cap", category:"supplement",
    protein:0, carbs:0, fat:0, fiber:0, sat_fat:0,
    epa_dha:0, calcium:0, iron:0, zinc:0, vit_d:0,
    vit_e:0, b12:0, folate:0, vit_c:0, potassium:0, magnesium:0
  },
  supp_ashwagandha: {
    name:"Ashwagandha", defaultQty:1, unit:"cap", category:"supplement",
    protein:0, carbs:0, fat:0, fiber:0, sat_fat:0,
    epa_dha:0, calcium:0, iron:0, zinc:0, vit_d:0,
    vit_e:0, b12:0, folate:0, vit_c:0, potassium:0, magnesium:0
  },
  supp_iron: {
    name:"Chelated Iron", defaultQty:1, unit:"tab", category:"supplement",
    protein:0, carbs:0, fat:0, fiber:0, sat_fat:0,
    epa_dha:0, calcium:0, iron:25, zinc:0, vit_d:0,
    vit_e:0, b12:0, folate:0, vit_c:0, potassium:0, magnesium:0
  },
  supp_vitc: {
    name:"Vit C 1000", defaultQty:1, unit:"tab", category:"supplement",
    protein:0, carbs:0, fat:0, fiber:0, sat_fat:0,
    epa_dha:0, calcium:0, iron:0, zinc:0, vit_d:0,
    vit_e:0, b12:0, folate:0, vit_c:1000, potassium:0, magnesium:0
  },
  supp_vitd: {
    name:"Vit D3 1000", defaultQty:1, unit:"tab", category:"supplement",
    protein:0, carbs:0, fat:0, fiber:0, sat_fat:0,
    epa_dha:0, calcium:0, iron:0, zinc:0, vit_d:1000,
    vit_e:0, b12:0, folate:0, vit_c:0, potassium:0, magnesium:0
  },
  supp_vitd2: {
    name:"Vit D3 2000", defaultQty:1, unit:"tab", category:"supplement",
    protein:0, carbs:0, fat:0, fiber:0, sat_fat:0,
    epa_dha:0, calcium:0, iron:0, zinc:0, vit_d:2000,
    vit_e:0, b12:0, folate:0, vit_c:0, potassium:0, magnesium:0
  },
  supp_vite: {
    name:"Vit E", defaultQty:1, unit:"softgel", category:"supplement",
    protein:0, carbs:0, fat:0, fiber:0, sat_fat:0,
    epa_dha:0, calcium:0, iron:0, zinc:0, vit_d:0,
    vit_e:268, b12:0, folate:0, vit_c:0, potassium:0, magnesium:0
  },
};

// ============================================================
// RECIPES
// ============================================================
const RECIPES = {
  morning_shake: {
    name: "Morning Shake", emoji: "\u{1F964}", type: "meal",
    verifiedTotal: {
      protein:51.8, carbs:64.5, fat:21.2, fiber:17.7, sat_fat:2.8,
      epa_dha:0, calcium:344, iron:13.4, zinc:4.6, vit_d:0,
      vit_e:2.1, b12:0, folate:151, vit_c:93.2, potassium:826, magnesium:255
    },
    ingredients: [
      { id:"pea_protein", swapGroup:"protein_powder" },
      { id:"rolled_oats_40", swapGroup:null },
      { id:"maya_nut", swapGroup:null },
      { id:"flaxseed", swapGroup:null },
      { id:"chia_seeds", swapGroup:null },
      { id:"sesame_seeds", swapGroup:null },
      { id:"almonds", swapGroup:null },
      { id:"papaya", swapGroup:"shake_fruit" },
      { id:"aloe_vera", swapGroup:null },
    ]
  },
  scotts_emulsion: {
    name: "Scott's Emulsion", emoji: "\u{1F41F}", type: "supplement_food",
    verifiedTotal: {
      protein:0, carbs:0, fat:4.5, fiber:0, sat_fat:1.0,
      epa_dha:300, calcium:130, iron:0, zinc:0, vit_d:340,
      vit_e:0, b12:0, folate:0, vit_c:0, potassium:0, magnesium:0
    },
    ingredients: [{ id:"scotts_emulsion", swapGroup:null }]
  },
  standard_lunch: {
    name: "Standard Lunch", emoji: "\u{1F957}", type: "meal",
    verifiedTotal: {
      protein:30.6, carbs:40.9, fat:32.3, fiber:14.9, sat_fat:4.3,
      epa_dha:0, calcium:223, iron:9.0, zinc:6.4, vit_d:0,
      vit_e:6.7, b12:8.0, folate:493, vit_c:189, potassium:1421, magnesium:292
    },
    ingredients: [
      { id:"veg_meat_lentil", swapGroup:"lunch_protein" },
      { id:"spinach", swapGroup:null },
      { id:"nutritional_yeast", swapGroup:null },
      { id:"peruvian_corn", swapGroup:null },
      { id:"pumpkin_seeds", swapGroup:"lunch_seeds" },
      { id:"sesame_seeds", swapGroup:null },
      { id:"hemp_seeds", swapGroup:"lunch_seeds" },
      { id:"red_bell_pepper", swapGroup:null },
      { id:"olive_oil", swapGroup:null },
      { id:"apple_cider_vinegar", swapGroup:null },
    ]
  },
  fortified_milk: {
    name: "Fortified Milk + Oatmeal", emoji: "\u{1F95B}", type: "meal",
    verifiedTotal: {
      protein:7.0, carbs:32.4, fat:5.6, fiber:4.0, sat_fat:0.9,
      epa_dha:0, calcium:669, iron:4.4, zinc:2.7, vit_d:136,
      vit_e:1.7, b12:0.5, folate:30, vit_c:1.6, potassium:310, magnesium:62
    },
    ingredients: [
      { id:"fortified_plant_milk", swapGroup:"milk" },
      { id:"oatmeal_30", swapGroup:null },
    ]
  },
  evening_shake: {
    name: "Evening Shake", emoji: "\u{1F319}", type: "meal",
    verifiedTotal: {
      protein:43.1, carbs:46.8, fat:11.0, fiber:14.5, sat_fat:1.1,
      epa_dha:0, calcium:258, iron:6.5, zinc:2.2, vit_d:0,
      vit_e:1.4, b12:0, folate:107, vit_c:10.4, potassium:768, magnesium:164
    },
    ingredients: [
      { id:"soy_protein", swapGroup:"protein_powder" },
      { id:"banana", swapGroup:"shake_fruit" },
      { id:"maya_nut", swapGroup:null },
      { id:"flaxseed", swapGroup:null },
      { id:"chia_seeds", swapGroup:null },
      { id:"almonds", swapGroup:null },
      { id:"cinnamon", swapGroup:null },
    ]
  },
  standard_dinner: {
    name: "Standard Dinner", emoji: "\u{1F372}", type: "meal",
    verifiedTotal: {
      protein:38.0, carbs:140.0, fat:15.6, fiber:28.7, sat_fat:3.3,
      epa_dha:0, calcium:128, iron:8.3, zinc:4.6, vit_d:41,
      vit_e:1.6, b12:0.5, folate:286, vit_c:25.5, potassium:1960, magnesium:186
    },
    ingredients: [
      { id:"bean_soup", swapGroup:null },
      { id:"rice_cooked", swapGroup:"dinner_grain" },
      { id:"avocado_third", swapGroup:null },
      { id:"egg", swapGroup:null },
      { id:"creole_potatoes", swapGroup:"dinner_tuber" },
    ]
  },
  greek_yogurt_meal: {
    name: "Greek Yogurt", emoji: "\u{1F944}", type: "snack",
    verifiedTotal: {
      protein:6.4, carbs:5.2, fat:5.9, fiber:0, sat_fat:3.5,
      epa_dha:0, calcium:132, iron:0.61, zinc:0.52, vit_d:13.6,
      vit_e:0.1, b12:0.75, folate:7, vit_c:0.5, potassium:141, magnesium:11
    },
    ingredients: [{ id:"greek_yogurt", swapGroup:null }]
  },
};

// Auto-generate supplement recipes from ingredients starting with "supp_"
const SUPPLEMENT_RECIPES = {};
Object.keys(INGREDIENTS).forEach(function(id) {
  if (id.startsWith("supp_")) {
    var ing = INGREDIENTS[id];
    var nutrients = {};
    NUTRIENT_KEYS.forEach(function(k) { nutrients[k] = ing[k] || 0; });
    SUPPLEMENT_RECIPES[id] = {
      name: ing.name, emoji: "\u{1F48A}", type: "supplement",
      verifiedTotal: nutrients,
      ingredients: [{ id: id, swapGroup: null }]
    };
  }
});

const SWAP_GROUPS = {
  protein_powder: ["pea_protein", "soy_protein"],
  shake_fruit: ["papaya", "pineapple", "banana"],
  milk: ["fortified_plant_milk", "oat_milk", "almond_milk"],
  lunch_protein: ["veg_meat_lentil", "tofu"],
  lunch_seeds: ["pumpkin_seeds", "hemp_seeds", "sunflower_seeds"],
  dinner_grain: ["rice_cooked", "quinoa_cooked"],
  dinner_tuber: ["creole_potatoes", "sweet_potato"],
};

// ============================================================
// UTILITIES — Pure calculation functions
// ============================================================
function emptyNutrients() {
  var n = {};
  NUTRIENT_KEYS.forEach(function(k) { n[k] = 0; });
  return n;
}

function getIngNutrients(id, qty) {
  var ing = INGREDIENTS[id];
  if (!ing) return emptyNutrients();
  var ratio = qty / ing.defaultQty;
  var n = {};
  NUTRIENT_KEYS.forEach(function(k) { n[k] = (ing[k] || 0) * ratio; });
  return n;
}

function computeMealNutrients(recipe, states) {
  if (!recipe || !states.length) return emptyNutrients();
  var hasMod = states.some(function(s, i) {
    var o = recipe.ingredients[i];
    if (!o) return true;
    return s.id !== o.id || s.qty !== (INGREDIENTS[o.id] ? INGREDIENTS[o.id].defaultQty : 1);
  });
  if (!hasMod) return Object.assign({}, recipe.verifiedTotal);
  var t = Object.assign({}, recipe.verifiedTotal);
  states.forEach(function(s, i) {
    var o = recipe.ingredients[i];
    if (!o) return;
    var oi = INGREDIENTS[o.id];
    if (!oi) return;
    var oq = oi.defaultQty;
    if (s.id !== o.id || s.qty !== oq) {
      var on = getIngNutrients(o.id, oq);
      var nn = getIngNutrients(s.id, s.qty);
      NUTRIENT_KEYS.forEach(function(k) { t[k] = t[k] - on[k] + nn[k]; });
    }
  });
  return t;
}

function getStatus(key, value) {
  var obj = OBJECTIVES[key];
  if (!obj) return { pct:0, closed:false, label:"?" };
  var min = obj.min, max = obj.max, type = obj.type;
  if (type === "maximum") {
    var closed = value < max;
    var pct = Math.round((value / max) * 100);
    return { pct: pct, closed: closed, label: closed ? "\u2705" : pct + "% \u26A0\uFE0F" };
  }
  if (type === "minimum") {
    var closed = value >= min;
    var pct = Math.round((value / min) * 100);
    return { pct: pct, closed: closed, label: closed ? "\u2705" : pct + "% \u2B1C" };
  }
  // range type
  if (value >= min && (max === null || value <= max))
    return { pct:100, closed:true, label:"\u2705" };
  if (value < min) {
    var pct = Math.round((value / min) * 100);
    return { pct: pct, closed:false, label: pct + "% \u2B1C" };
  }
  var pct = Math.round((value / max) * 100);
  return { pct: pct, closed:false, label: pct + "% \u26A0\uFE0F" };
}

function getTargetStr(key) {
  var o = OBJECTIVES[key]; if (!o) return "";
  var u = NUTRIENT_UNITS[key];
  if (o.type === "maximum") return "<" + o.max + u;
  if (o.type === "minimum") return "\u2265" + o.min + u;
  return o.min + "\u2013" + o.max + u;
}

function fmtVal(k, v) {
  return (Math.round(v * 10) / 10) + NUTRIENT_UNITS[k];
}

function getOpenGaps(totals) {
  var open = [];
  NUTRIENT_KEYS.forEach(function(k) {
    var s = getStatus(k, totals[k] || 0);
    if (!s.closed) {
      var o = OBJECTIVES[k], u = NUTRIENT_UNITS[k];
      if (o.type === "maximum") {
        open.push({ key: k, label: NUTRIENT_LABELS[k], detail: (Math.round(((totals[k]||0) - o.max)*10)/10) + u + " over", type: "over" });
      } else {
        var target = o.min;
        open.push({ key: k, label: NUTRIENT_LABELS[k], detail: "need ~" + (Math.round((target - (totals[k]||0))*10)/10) + u, type: "under" });
      }
    }
  });
  return open;
}

// Helper: compute calories from macros
function computeCalories(totals) {
  return Math.round((totals.protein || 0) * 4 + (totals.carbs || 0) * 4 + (totals.fat || 0) * 9);
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ============================================================
// STORAGE — V2 uses separate key, no migration
// ============================================================
var STORAGE_KEY_V2 = "nutrition_calc_v2";
var API_KEY_STORAGE = "nutrition_calc_v2_api_key";

function loadState() {
  try {
    var r = localStorage.getItem(STORAGE_KEY_V2);
    return r ? JSON.parse(r) : null;
  } catch(e) {
    console.warn("Failed to load state, using defaults:", e);
    return null;
  }
}

function saveState(s) {
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(s));
  } catch(e) {
    console.warn("Failed to save state:", e);
  }
}

var DEFAULT_STATE = {
  currentDate: todayStr(),
  dayLog: [],
  fatSolubleCarryover: { b12:0, vit_e:0, vit_d:0 },
  carryoverDaysRemaining: { b12:0, vit_e:0 },
  dayHistory: [],
  darkMode: true,
  themeMode: "dark",
  aiModel: "claude-haiku-4-5-20251001",
};
