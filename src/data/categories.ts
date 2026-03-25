import type { Category } from '@/types';

export const CATEGORIES: Category[] = [
  {
    id: 'electronics',
    name: 'Electronics',
    icon: '💻',
    subcategories: ['Computers', 'Phones', 'Audio', 'Cameras & Drones', 'Gaming', 'TV & Video'],
    listingCount: 48_210,
  },
  {
    id: 'fashion',
    name: 'Fashion',
    icon: '👗',
    subcategories: ['Shoes', 'Jackets & Coats', 'Tops', 'Dresses', 'Accessories', 'Bags'],
    listingCount: 36_540,
  },
  {
    id: 'home-garden',
    name: 'Home & Garden',
    icon: '🏡',
    subcategories: ['Appliances', 'Furniture', 'BBQs & Outdoor', 'Tools', 'Decor', 'Bedding'],
    listingCount: 29_880,
  },
  {
    id: 'sports',
    name: 'Sports & Outdoors',
    icon: '🏉',
    subcategories: ['Cycling', 'Fishing', 'Bags & Packs', 'Camping', 'Water Sports', 'Golf'],
    listingCount: 22_130,
  },
  {
    id: 'vehicles',
    name: 'Vehicles',
    icon: '🚗',
    subcategories: ['Cars', 'Bikes', 'Boats', 'Motorcycles', 'Parts & Accessories', 'Caravans'],
    listingCount: 18_760,
  },
  {
    id: 'property',
    name: 'Property',
    icon: '🏠',
    subcategories: ['Rentals', 'For Sale', 'Commercial', 'Flatmates', 'Holiday Rentals'],
    listingCount: 12_450,
  },
  {
    id: 'baby-kids',
    name: 'Baby & Kids',
    icon: '🧸',
    subcategories: ['Baby Gear', 'Toys & Games', 'Clothing', 'School', 'Furniture'],
    listingCount: 17_320,
  },
  {
    id: 'collectibles',
    name: 'Collectibles',
    icon: '🏺',
    subcategories: ['Sports Memorabilia', 'Jewellery & Watches', 'Art', 'Coins', 'Antiques', 'Books'],
    listingCount: 14_990,
  },
  {
    id: 'business',
    name: 'Tools & Equipment',
    icon: '🔧',
    subcategories: ['Power Tools', 'Office Furniture', 'Machinery', 'Safety Equipment', 'Catering'],
    listingCount: 9_840,
  },
];

export default CATEGORIES;

