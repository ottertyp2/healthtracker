import type { FoodReference, Nutrients } from "../types";

type OpenFoodFactsProduct = {
  product?: {
    product_name?: string;
    brands?: string;
    nutriments?: Record<string, number | string>;
  };
  status?: number;
};

export async function lookupBarcode(barcode: string): Promise<FoodReference | null> {
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`);
  if (!response.ok) throw new Error("Open Food Facts lookup failed.");
  const data = (await response.json()) as OpenFoodFactsProduct;
  if (data.status !== 1 || !data.product) return null;

  const nutriments = data.product.nutriments ?? {};
  const sodium = numberFrom(nutriments.sodium_100g);
  const nutrients: Nutrients = {
    kcal: numberFrom(nutriments["energy-kcal_100g"]),
    protein: numberFrom(nutriments.proteins_100g),
    carbs: numberFrom(nutriments.carbohydrates_100g),
    fat: numberFrom(nutriments.fat_100g),
    fiber: numberFrom(nutriments.fiber_100g),
    sugar: numberFrom(nutriments.sugars_100g),
    saturatedFat: numberFrom(nutriments["saturated-fat_100g"]),
    monounsaturatedFat: numberFrom(nutriments["monounsaturated-fat_100g"]),
    polyunsaturatedFat: numberFrom(nutriments["polyunsaturated-fat_100g"]),
    transFat: numberFrom(nutriments["trans-fat_100g"]),
    omega3: numberFrom(nutriments["omega-3-fat_100g"]),
    omega6: numberFrom(nutriments["omega-6-fat_100g"]),
    cholesterol: numberFrom(nutriments.cholesterol_100g) * 1000,
    sodium: sodium ? sodium * 1000 : numberFrom(nutriments.salt_100g) * 393.4,
    salt: numberFrom(nutriments.salt_100g) * 1000,
    magnesium: numberFrom(nutriments.magnesium_100g) * 1000,
    potassium: numberFrom(nutriments.potassium_100g) * 1000,
    calcium: numberFrom(nutriments.calcium_100g) * 1000,
    phosphorus: numberFrom(nutriments.phosphorus_100g) * 1000,
    iron: numberFrom(nutriments.iron_100g) * 1000,
    zinc: numberFrom(nutriments.zinc_100g) * 1000,
    selenium: numberFrom(nutriments.selenium_100g) * 1000,
    copper: numberFrom(nutriments.copper_100g) * 1000,
    manganese: numberFrom(nutriments.manganese_100g) * 1000,
    vitaminA: numberFrom(nutriments["vitamin-a_100g"]) * 1000000,
    vitaminB1: numberFrom(nutriments["vitamin-b1_100g"]) * 1000,
    vitaminB2: numberFrom(nutriments["vitamin-b2_100g"]) * 1000,
    vitaminB3: numberFrom(nutriments["vitamin-pp_100g"] ?? nutriments["vitamin-b3_100g"]) * 1000,
    vitaminB5: numberFrom(nutriments["pantothenic-acid_100g"] ?? nutriments["vitamin-b5_100g"]) * 1000,
    vitaminB6: numberFrom(nutriments["vitamin-b6_100g"]) * 1000,
    biotin: numberFrom(nutriments.biotin_100g) * 1000000,
    folate: numberFrom(nutriments["vitamin-b9_100g"] ?? nutriments.folates_100g) * 1000000,
    vitaminB12: numberFrom(nutriments["vitamin-b12_100g"]) * 1000000,
    vitaminC: numberFrom(nutriments["vitamin-c_100g"]) * 1000,
    vitaminD: numberFrom(nutriments["vitamin-d_100g"]) * 1000000,
    vitaminE: numberFrom(nutriments["vitamin-e_100g"]) * 1000,
    vitaminK: numberFrom(nutriments["vitamin-k_100g"]) * 1000000,
  };

  const name = [data.product.product_name, data.product.brands].filter(Boolean).join(" | ") || `Barcode ${barcode}`;
  return {
    id: `off-${barcode}`,
    name,
    aliases: [barcode, data.product.product_name ?? ""].filter(Boolean),
    category: "product",
    source: "open-food-facts",
    nutrientsPer100g: nutrients,
  };
}

function numberFrom(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
