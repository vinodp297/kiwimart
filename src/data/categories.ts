import type { Category } from "@/types";

// Category IDs match the `Category.id` values in the database (seed.ts).
// Subcategory names match the `Subcategory.name` values in the database.
// These are used for the category dropdown, pills, and search filtering.
export const CATEGORIES: Category[] = [
  {
    id: "cat-electronics",
    name: "Electronics",
    icon: "💻",
    subcategories: [
      "Phones",
      "Laptops",
      "Tablets",
      "Audio",
      "Cameras",
      "Gaming",
    ],
    listingCount: 48_210,
  },
  {
    id: "cat-fashion",
    name: "Fashion",
    icon: "👗",
    subcategories: ["Womens Clothing", "Mens Clothing", "Shoes", "Jewellery"],
    listingCount: 36_540,
  },
  {
    id: "cat-home",
    name: "Home & Garden",
    icon: "🏡",
    subcategories: ["Furniture", "Kitchen", "Garden"],
    listingCount: 29_880,
  },
  {
    id: "cat-sports",
    name: "Sports & Outdoors",
    icon: "🏉",
    subcategories: ["Bikes", "Camping", "Fitness"],
    listingCount: 22_130,
  },
  {
    id: "cat-baby",
    name: "Baby & Kids",
    icon: "🧸",
    subcategories: ["Prams & Strollers", "Clothing"],
    listingCount: 17_320,
  },
  {
    id: "cat-collectibles",
    name: "Collectibles",
    icon: "🏺",
    subcategories: ["Art", "Coins"],
    listingCount: 14_990,
  },
  {
    id: "cat-tools",
    name: "Tools & Equipment",
    icon: "🔧",
    subcategories: ["Power Tools", "Hand Tools"],
    listingCount: 9_840,
  },
  {
    id: "cat-vehicles",
    name: "Vehicles & Parts",
    icon: "🚗",
    subcategories: ["Car Parts"],
    listingCount: 8_120,
  },
];

export default CATEGORIES;
