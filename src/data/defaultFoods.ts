import { trackedNutrientKeys, type FoodReference, type MealEntry, type MealItem, type Nutrients } from "../types";

export const defaultFoods: FoodReference[] = [
  {
    id: "egg-whole",
    name: "Ei",
    aliases: ["egg", "eier", "huehnerei"],
    category: "standard",
    source: "seed-estimate",
    nutrientsPer100g: {
      kcal: 143,
      protein: 12.6,
      carbs: 0.7,
      fat: 9.5,
      fiber: 0,
      vitaminD: 2,
      magnesium: 12,
      potassium: 138,
      calcium: 56,
      iodine: 49,
      iron: 1.8,
    },
  },
  {
    id: "bauernschnitte",
    name: "Bauernschnitte",
    aliases: ["bauernbrot", "brot", "schnitte"],
    category: "standard",
    source: "seed-estimate",
    nutrientsPer100g: {
      kcal: 230,
      protein: 8.5,
      carbs: 43,
      fat: 2.2,
      fiber: 6,
      magnesium: 46,
      potassium: 230,
      calcium: 35,
      iodine: 2,
      iron: 2.6,
    },
  },
  {
    id: "butter",
    name: "Butter",
    aliases: ["butter"],
    category: "standard",
    source: "seed-estimate",
    nutrientsPer100g: {
      kcal: 717,
      protein: 0.9,
      carbs: 0.1,
      fat: 81,
      fiber: 0,
      vitaminD: 1.5,
      calcium: 24,
    },
  },
  {
    id: "jam",
    name: "Marmelade",
    aliases: ["jam", "marmelade"],
    category: "standard",
    source: "seed-estimate",
    nutrientsPer100g: {
      kcal: 250,
      protein: 0.3,
      carbs: 60,
      fat: 0.1,
      fiber: 1,
      potassium: 80,
    },
  },
  {
    id: "beef-mince",
    name: "Rinderhack",
    aliases: ["hackfleisch", "rinderhack", "beef mince"],
    category: "standard",
    source: "seed-estimate",
    nutrientsPer100g: {
      kcal: 240,
      protein: 19,
      carbs: 0,
      fat: 18,
      fiber: 0,
      magnesium: 19,
      potassium: 305,
      iron: 2.3,
      zinc: 4.8,
    } as Nutrients,
  },
  {
    id: "steak",
    name: "Steak",
    aliases: ["rind", "steak", "beef"],
    category: "standard",
    source: "seed-estimate",
    nutrientsPer100g: {
      kcal: 190,
      protein: 27,
      carbs: 0,
      fat: 9,
      fiber: 0,
      magnesium: 22,
      potassium: 330,
      iron: 2.4,
    },
  },
  {
    id: "potatoes",
    name: "Kartoffeln",
    aliases: ["kartoffel", "kartoffeln", "potatoes"],
    category: "standard",
    source: "seed-estimate",
    nutrientsPer100g: {
      kcal: 77,
      protein: 2,
      carbs: 17,
      fat: 0.1,
      fiber: 2.2,
      magnesium: 23,
      potassium: 425,
      calcium: 12,
      iron: 0.8,
    },
  },
  {
    id: "doener",
    name: "Doener",
    aliases: ["doener", "doner", "kebab"],
    category: "standard",
    source: "seed-estimate",
    nutrientsPer100g: {
      kcal: 215,
      protein: 11,
      carbs: 23,
      fat: 9,
      fiber: 2.2,
      magnesium: 25,
      potassium: 260,
      calcium: 55,
      iron: 1.8,
    },
  },
];

export const mealTemplates = [
  {
    id: "standard-breakfast",
    label: "Standard Breakfast",
    mealType: "breakfast" as const,
    items: [
      { foodRefId: "egg-whole", name: "Ei", grams: 210 },
      { foodRefId: "bauernschnitte", name: "Bauernschnitte", grams: 75 },
      { foodRefId: "butter", name: "Butter", grams: 12 },
      { foodRefId: "jam", name: "Marmelade", grams: 20 },
    ],
    description: "3-4 Eier, Bauernschnitte, Butter, Marmelade, Salz und Basilikum",
  },
  {
    id: "hack-potatoes",
    label: "Hack + Kartoffeln",
    mealType: "lunch" as const,
    items: [
      { foodRefId: "beef-mince", name: "Rinderhack", grams: 300 },
      { foodRefId: "potatoes", name: "Kartoffeln", grams: 350 },
    ],
    description: "Rinderhack mit Kartoffeln",
  },
  {
    id: "steak-bread",
    label: "Steak + Brot",
    mealType: "lunch" as const,
    items: [
      { foodRefId: "steak", name: "Steak", grams: 250 },
      { foodRefId: "bauernschnitte", name: "Bauernschnitte", grams: 120 },
    ],
    description: "Steak mit Brot",
  },
  {
    id: "doener-dinner",
    label: "Doener",
    mealType: "dinner" as const,
    items: [{ foodRefId: "doener", name: "Doener", grams: 450 }],
    description: "Ein Doener als Abendessen",
  },
];

export function zeroNutrients(): Nutrients {
  return {
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0,
    omega3: 0,
    vitaminD: 0,
    magnesium: 0,
    potassium: 0,
    calcium: 0,
    iodine: 0,
    iron: 0,
    zinc: 0,
  };
}

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  const result = zeroNutrients();
  for (const key of trackedNutrientKeys) {
    const value = (a[key] ?? 0) + (b[key] ?? 0);
    if (value !== 0 || key in result) result[key] = value;
  }
  return result;
}

export const mergeNutrients = addNutrients;

export function scaleNutrients(per100g: Nutrients, grams: number): Nutrients {
  const factor = grams / 100;
  const result = zeroNutrients();
  for (const key of trackedNutrientKeys) {
    const value = (per100g[key] ?? 0) * factor;
    if (value !== 0 || key in result) result[key] = value;
  }
  return result;
}

export function scaledNutrients(food: FoodReference, grams: number): Nutrients {
  return scaleNutrients(food.nutrientsPer100g, grams);
}

export function findFoodReference(foods: FoodReference[], query: string): FoodReference | undefined {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return undefined;
  return foods.find((food) => {
    return (
      food.id.toLowerCase() === normalized ||
      food.name.toLowerCase() === normalized ||
      food.aliases.some((alias) => alias.toLowerCase() === normalized)
    );
  });
}

export function totalForItems(items: MealItem[]): Nutrients {
  return items.reduce((sum, item) => addNutrients(sum, item.nutrients ?? zeroNutrients()), zeroNutrients());
}

export function buildMealFromItems(params: {
  id: string;
  date: string;
  mealType: MealEntry["mealType"];
  mode: MealEntry["mode"];
  description: string;
  items: MealItem[];
  photo?: MealEntry["photo"];
  notes?: string;
}): MealEntry {
  const confidence = params.items.some((item) => item.confidence === "needs-gemini")
    ? "needs-gemini"
    : params.items.some((item) => item.confidence === "medium")
      ? "medium"
      : "high";

  return {
    id: params.id,
    date: params.date,
    capturedAt: new Date().toISOString(),
    mealType: params.mealType,
    mode: params.mode,
    description: params.description,
    items: params.items,
    total: totalForItems(params.items),
    confidence,
    photo: params.photo,
    notes: params.notes,
  };
}
