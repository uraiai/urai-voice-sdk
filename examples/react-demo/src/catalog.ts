export interface Product {
  sku: string;
  name: string;
  price: number;
  description: string;
}

export const CATALOG: Product[] = [
  { sku: "TENT-2P", name: "Ridgeline 2-person tent", price: 249, description: "Three-season tent, 2.1 kg, two doors." },
  { sku: "BAG-0C", name: "Summit 0°C sleeping bag", price: 179, description: "Down fill, packs to the size of a loaf of bread." },
  { sku: "STOVE-JET", name: "Jet canister stove", price: 89, description: "Boils a litre in three minutes." },
  { sku: "PACK-45", name: "Trailhead 45 L pack", price: 159, description: "Adjustable torso, hip-belt pockets, rain cover." },
  { sku: "LAMP-300", name: "Beam 300 headlamp", price: 39, description: "300 lumens, USB-C rechargeable." },
  { sku: "FILTER-SQ", name: "Squeeze water filter", price: 45, description: "Filters 0.1 micron, screws onto bottles." },
];

export const PAGES = ["products", "cart", "orders"] as const;
export type Page = (typeof PAGES)[number];

export interface CartLine {
  sku: string;
  quantity: number;
}

export function findProduct(sku: string): Product | undefined {
  return CATALOG.find((p) => p.sku.toLowerCase() === sku.toLowerCase());
}

export function searchProducts(query: string): Product[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return CATALOG.filter((p) => {
    const text = `${p.name} ${p.description} ${p.sku}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
