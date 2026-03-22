// prisma/seed.ts
// ─── Database Seed ────────────────────────────────────────────────────────────
// Run: npx prisma db seed
// Configured in package.json: "prisma": { "seed": "tsx prisma/seed.ts" }
//
// Idempotent — safe to run multiple times (upsert throughout)

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

const CATEGORIES = [
  {
    id: 'electronics',
    name: 'Electronics',
    icon: '💻',
    slug: 'electronics',
    displayOrder: 1,
    subcategories: [
      'Mobile Phones',
      'Computers',
      'Tablets',
      'Audio',
      'Cameras & Drones',
      'TV & Home Theatre',
      'Gaming',
      'Wearables',
      'Networking',
      'Computer Parts',
    ],
  },
  {
    id: 'fashion',
    name: 'Fashion',
    icon: '👗',
    slug: 'fashion',
    displayOrder: 2,
    subcategories: [
      "Women's Clothing",
      "Men's Clothing",
      'Shoes',
      'Bags & Accessories',
      'Jackets & Coats',
      'Activewear',
      'Jewellery',
      'Watches',
    ],
  },
  {
    id: 'home-garden',
    name: 'Home & Garden',
    icon: '🏡',
    slug: 'home-garden',
    displayOrder: 3,
    subcategories: [
      'Furniture',
      'Appliances',
      'BBQs & Outdoor',
      'Garden & Landscaping',
      'Tools & Hardware',
      'Bedding & Bath',
      'Kitchen',
      'Lighting',
    ],
  },
  {
    id: 'sports',
    name: 'Sports & Outdoors',
    icon: '🏃',
    slug: 'sports',
    displayOrder: 4,
    subcategories: [
      'Cycling',
      'Running & Fitness',
      'Water Sports',
      'Snow Sports',
      'Camping & Hiking',
      'Bags & Packs',
      'Team Sports',
      'Golf',
    ],
  },
  {
    id: 'vehicles',
    name: 'Vehicles',
    icon: '🚗',
    slug: 'vehicles',
    displayOrder: 5,
    subcategories: [
      'Cars',
      'Bikes',
      'Boats & Marine',
      'Motorcycles',
      'Caravans & Campervans',
      'Trucks & Vans',
      'Car Parts & Accessories',
    ],
  },
  {
    id: 'property',
    name: 'Property',
    icon: '🏘️',
    slug: 'property',
    displayOrder: 6,
    subcategories: ['Rentals', 'For Sale', 'Flatmates', 'Sections'],
  },
  {
    id: 'baby-kids',
    name: 'Baby & Kids',
    icon: '🍼',
    slug: 'baby-kids',
    displayOrder: 7,
    subcategories: [
      'Baby Gear',
      "Children's Clothing",
      'Toys & Games',
      'Books',
      'Nursery Furniture',
    ],
  },
  {
    id: 'collectibles',
    name: 'Collectibles',
    icon: '🎨',
    slug: 'collectibles',
    displayOrder: 8,
    subcategories: [
      'Art',
      'Sports Memorabilia',
      'Coins & Stamps',
      'Jewellery & Watches',
      'Antiques',
      'Books & Comics',
    ],
  },
  {
    id: 'business',
    name: 'Business & Industrial',
    icon: '🔧',
    slug: 'business',
    displayOrder: 9,
    subcategories: [
      'Power Tools',
      'Office Furniture',
      'Industrial Equipment',
      'Catering',
      'Retail Fixtures',
    ],
  },
];

async function main() {
  console.log('🌱 Seeding categories…');

  for (const cat of CATEGORIES) {
    const { subcategories, ...catData } = cat;

    await prisma.category.upsert({
      where: { id: cat.id },
      update: { name: catData.name, icon: catData.icon, displayOrder: catData.displayOrder },
      create: catData,
    });

    for (const subName of subcategories) {
      const slug = subName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      await prisma.subcategory.upsert({
        where: { categoryId_slug: { categoryId: cat.id, slug } },
        update: { name: subName },
        create: { categoryId: cat.id, name: subName, slug },
      });
    }
  }

  console.log(`✅ Seeded ${CATEGORIES.length} categories`);

  // In development: seed a test admin user
  if (process.env.NODE_ENV !== 'production') {
    const { hashPassword } = await import('../src/server/lib/password');

    await prisma.user.upsert({
      where: { email: 'admin@kiwimart.test' },
      update: {},
      create: {
        email: 'admin@kiwimart.test',
        username: 'admin',
        displayName: 'KiwiMart Admin',
        emailVerified: new Date(),
        passwordHash: await hashPassword('AdminPassword123!'),
        isAdmin: true,
        sellerEnabled: true,
        agreedTermsAt: new Date(),
      },
    });

    await prisma.user.upsert({
      where: { email: 'buyer@kiwimart.test' },
      update: {},
      create: {
        email: 'buyer@kiwimart.test',
        username: 'testbuyer',
        displayName: 'Test Buyer',
        emailVerified: new Date(),
        passwordHash: await hashPassword('BuyerPassword123!'),
        region: 'Auckland',
        suburb: 'Ponsonby',
        agreedTermsAt: new Date(),
      },
    });

    await prisma.user.upsert({
      where: { email: 'seller@kiwimart.test' },
      update: {},
      create: {
        email: 'seller@kiwimart.test',
        username: 'testseller',
        displayName: 'Test Seller',
        emailVerified: new Date(),
        passwordHash: await hashPassword('SellerPassword123!'),
        sellerEnabled: true,
        region: 'Wellington',
        suburb: 'Te Aro',
        agreedTermsAt: new Date(),
      },
    });

    console.log('✅ Seeded 3 dev test users (admin / buyer / seller)');
    console.log('   admin@kiwimart.test  / AdminPassword123!');
    console.log('   buyer@kiwimart.test  / BuyerPassword123!');
    console.log('   seller@kiwimart.test / SellerPassword123!');
  }
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

