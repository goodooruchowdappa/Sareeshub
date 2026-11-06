export const SITE = {
  name: "Sarees Hub",
  tagline: "Find saree shops, weavers & sarees near you",
  description:
    "Discover saree shops, handloom weavers, wholesalers and showrooms on a map. Browse pure pattu, semi pattu, Kanchipuram, Banarasi and more — then call, WhatsApp or get directions.",
  locale: "en_IN",
  themeColor: "#7a1f2b",
};

export const SHOP_KINDS = [
  { value: "shop", label: "Saree shop", plural: "Saree shops" },
  { value: "weaver", label: "Handloom weaver", plural: "Weavers" },
  { value: "cooperative", label: "Weavers' co-op society", plural: "Co-op societies" },
  { value: "manufacturer", label: "Manufacturer", plural: "Manufacturers" },
  { value: "wholesaler", label: "Wholesaler", plural: "Wholesalers" },
  { value: "showroom", label: "Showroom", plural: "Showrooms" },
  { value: "boutique", label: "Designer boutique", plural: "Boutiques" },
] as const;
export type ShopKind = (typeof SHOP_KINDS)[number]["value"];
export const kindLabel = (k: string) => SHOP_KINDS.find((x) => x.value === k)?.label ?? "Saree shop";

export const TAG_CATEGORIES = [
  { value: "fabric", label: "Fabric" },
  { value: "weave", label: "Weave / region" },
  { value: "work", label: "Zari & work" },
  { value: "occasion", label: "Occasion" },
  { value: "style", label: "Style & trust" },
  { value: "other", label: "Other" },
] as const;
export const categoryLabel = (c: string) => TAG_CATEGORIES.find((x) => x.value === c)?.label ?? "Other";

export const SAREE_COLORS = [
  "Red", "Maroon", "Pink", "Magenta", "Orange", "Mustard", "Yellow", "Gold", "Green", "Parrot Green",
  "Bottle Green", "Teal", "Blue", "Navy", "Peacock Blue", "Purple", "Lavender", "Wine", "Black", "White",
  "Cream", "Beige", "Grey", "Silver", "Brown", "Multicolour",
];

export const PRICE_BANDS = [
  { label: "Under ₹2,000", min: undefined, max: 2000 },
  { label: "₹2,000 – ₹5,000", min: 2000, max: 5000 },
  { label: "₹5,000 – ₹15,000", min: 5000, max: 15000 },
  { label: "₹15,000 – ₹40,000", min: 15000, max: 40000 },
  { label: "Above ₹40,000", min: 40000, max: undefined },
];
