// prisma/seed.ts
// ─── KiwiMart Production-Ready Seed ──────────────────────────────────────────
// Wipes the database then seeds comprehensive test data covering every feature.
// Run: npx tsx prisma/seed.ts

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL!,
});
const db = new PrismaClient({ adapter });

// ── Password helper ───────────────────────────────────────────────────────────
async function hash(password: string): Promise<string> {
  const { hashPassword } = await import('../src/server/lib/password');
  return hashPassword(password);
}

// ── Wipe database (reverse dependency order) ─────────────────────────────────
async function wipeDatabase() {
  console.log('🗑️  Wiping database...');
  await db.auditLog.deleteMany();
  await db.report.deleteMany();
  await db.phoneVerificationToken.deleteMany();
  await db.stripeEvent.deleteMany();
  await db.message.deleteMany();
  await db.messageThread.deleteMany();
  await db.review.deleteMany();
  await db.offer.deleteMany();
  await db.payout.deleteMany();
  await db.order.deleteMany();
  await db.watchlistItem.deleteMany();
  await db.listingAttribute.deleteMany();
  await db.listingImage.deleteMany();
  await db.listing.deleteMany();
  await db.passwordResetToken.deleteMany();
  await db.emailVerificationToken.deleteMany();
  await db.session.deleteMany();
  await db.account.deleteMany();
  await db.user.deleteMany();
  await db.subcategory.deleteMany();
  await db.category.deleteMany();
  await db.verificationToken.deleteMany();
  console.log('✅ Database wiped');
}

// ── Category definitions (IDs match src/data/categories.ts for UI compat) ────
const CATEGORIES = [
  {
    id: 'electronics', name: 'Electronics', icon: '💻', slug: 'electronics', displayOrder: 1,
    subcategories: ['Mobile Phones', 'Computers', 'Tablets', 'Audio', 'Cameras & Drones', 'TV & Home Theatre', 'Gaming', 'Wearables'],
  },
  {
    id: 'fashion', name: 'Fashion', icon: '👗', slug: 'fashion', displayOrder: 2,
    subcategories: ["Women's Clothing", "Men's Clothing", 'Shoes', 'Bags & Accessories', 'Jackets & Coats', 'Jewellery'],
  },
  {
    id: 'home-garden', name: 'Home & Garden', icon: '🏡', slug: 'home-garden', displayOrder: 3,
    subcategories: ['Furniture', 'Appliances', 'BBQs & Outdoor', 'Garden & Landscaping', 'Kitchen', 'Lighting'],
  },
  {
    id: 'sports', name: 'Sports & Outdoors', icon: '🏉', slug: 'sports', displayOrder: 4,
    subcategories: ['Cycling', 'Running & Fitness', 'Water Sports', 'Snow Sports', 'Camping & Hiking', 'Golf'],
  },
  {
    id: 'vehicles', name: 'Vehicles', icon: '🚗', slug: 'vehicles', displayOrder: 5,
    subcategories: ['Cars', 'Bikes', 'Boats & Marine', 'Motorcycles', 'Car Parts & Accessories'],
  },
  {
    id: 'property', name: 'Property', icon: '🏘️', slug: 'property', displayOrder: 6,
    subcategories: ['Rentals', 'For Sale', 'Flatmates'],
  },
  {
    id: 'baby-kids', name: 'Baby & Kids', icon: '🍼', slug: 'baby-kids', displayOrder: 7,
    subcategories: ['Baby Gear', "Children's Clothing", 'Toys & Games', 'Books', 'Nursery Furniture'],
  },
  {
    id: 'collectibles', name: 'Collectibles', icon: '🏺', slug: 'collectibles', displayOrder: 8,
    subcategories: ['Art', 'Sports Memorabilia', 'Coins & Stamps', 'Antiques', 'Books & Comics'],
  },
  {
    id: 'business', name: 'Tools & Equipment', icon: '🔧', slug: 'business', displayOrder: 9,
    subcategories: ['Power Tools', 'Hand Tools', 'Office Furniture', 'Industrial Equipment', 'Safety Equipment'],
  },
];

// ── Image helper — creates 3 seed images with safe=true so they show in search ─
async function addImages(listingId: string, urls: string[], title: string) {
  for (let i = 0; i < urls.length; i++) {
    await db.listingImage.create({
      data: {
        listingId,
        r2Key: urls[i],          // starts with 'http' → used directly by UI
        thumbnailKey: urls[i],
        altText: title,
        order: i,
        scanned: true,
        safe: true,
      },
    });
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {

  // ── STEP 1: Wipe ────────────────────────────────────────────────────────────
  await wipeDatabase();

  // ── STEP 2: Categories ──────────────────────────────────────────────────────
  console.log('\n📂 Creating categories...');
  for (const cat of CATEGORIES) {
    const { subcategories, ...catData } = cat;
    await db.category.create({ data: catData });
    for (const subName of subcategories) {
      const slug = subName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      await db.subcategory.create({ data: { categoryId: cat.id, name: subName, slug } });
    }
  }
  console.log(`✅ ${CATEGORIES.length} categories created`);

  // ── STEP 3: Hash passwords ───────────────────────────────────────────────────
  console.log('\n🔑 Hashing passwords...');
  const [buyerHash, sellerHash, adminHash] = await Promise.all([
    hash('BuyerPassword123!'),
    hash('SellerPassword123!'),
    hash('AdminPassword123!'),
  ]);

  // ── STEP 4: Users ────────────────────────────────────────────────────────────
  console.log('\n👤 Creating users...');

  const techdeals = await db.user.create({
    data: {
      email: 'techdeals@kiwimart.test',
      username: 'techdeals',
      displayName: 'TechDeals NZ',
      passwordHash: sellerHash,
      emailVerified: new Date(),
      phoneVerified: true,
      phoneVerifiedAt: new Date(Date.now() - 30 * 86400000),
      idVerified: true,
      idVerifiedAt: new Date(Date.now() - 60 * 86400000),
      bio: 'Premium electronics at unbeatable NZ prices. All items tested and verified before listing. Fast shipping nationwide.',
      sellerEnabled: true,
      stripeOnboarded: true,
      stripeAccountId: 'acct_1RTestTechDealsNZ01',
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      region: 'Auckland',
      suburb: 'Newmarket',
      agreedTermsAt: new Date(Date.now() - 90 * 86400000),
    },
  });

  const homestyle = await db.user.create({
    data: {
      email: 'homestyle@kiwimart.test',
      username: 'homestyle',
      displayName: 'HomeStyle NZ',
      passwordHash: sellerHash,
      emailVerified: new Date(),
      phoneVerified: true,
      phoneVerifiedAt: new Date(Date.now() - 20 * 86400000),
      idVerified: false,
      bio: 'Beautiful homewares and fashion finds. Based in Wellington. Local pickup welcome.',
      sellerEnabled: true,
      stripeOnboarded: true,
      stripeAccountId: 'acct_1RTestHomeStyleNZ02',
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      region: 'Wellington',
      suburb: 'Kelburn',
      agreedTermsAt: new Date(Date.now() - 60 * 86400000),
    },
  });

  const outdoorgear = await db.user.create({
    data: {
      email: 'outdoorgear@kiwimart.test',
      username: 'outdoorgear',
      displayName: 'OutdoorGear NZ',
      passwordHash: sellerHash,
      emailVerified: new Date(),
      phoneVerified: false,
      idVerified: true,
      idVerifiedAt: new Date(Date.now() - 14 * 86400000),
      bio: 'Quality outdoor and sports equipment. Christchurch based. Happy to ship or local pickup available.',
      sellerEnabled: true,
      stripeOnboarded: true,
      stripeAccountId: 'acct_1RTestOutdoorGearNZ3',
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      region: 'Canterbury',
      suburb: 'Christchurch City',
      agreedTermsAt: new Date(Date.now() - 30 * 86400000),
    },
  });

  const alice = await db.user.create({
    data: {
      email: 'buyer@kiwimart.test',
      username: 'alice_buys',
      displayName: 'Alice M',
      passwordHash: buyerHash,
      emailVerified: new Date(),
      phoneVerified: true,
      phoneVerifiedAt: new Date(Date.now() - 10 * 86400000),
      idVerified: false,
      sellerEnabled: false,
      region: 'Auckland',
      suburb: 'Ponsonby',
      agreedTermsAt: new Date(Date.now() - 45 * 86400000),
    },
  });

  await db.user.create({
    data: {
      email: 'buyer2@kiwimart.test',
      username: 'bob_nz',
      displayName: 'Bob T',
      passwordHash: buyerHash,
      emailVerified: new Date(),
      phoneVerified: false,
      sellerEnabled: false,
      region: 'Wellington',
      suburb: 'Te Aro',
      agreedTermsAt: new Date(Date.now() - 20 * 86400000),
    },
  });

  await db.user.create({
    data: {
      email: 'admin@kiwimart.test',
      username: 'admin',
      displayName: 'KiwiMart Admin',
      passwordHash: adminHash,
      emailVerified: new Date(),
      isAdmin: true,
      adminRole: 'SUPER_ADMIN',
      sellerEnabled: false,
      region: 'Auckland',
      suburb: 'Auckland CBD',
      agreedTermsAt: new Date(),
    },
  });

  // ── Role-specific admin accounts ────────────────────────────────────────────
  const adminAccounts = [
    { email: 'finance@kiwimart.test',  role: 'FINANCE_ADMIN',      name: 'Finance Admin',  username: 'finance_admin'  },
    { email: 'disputes@kiwimart.test', role: 'DISPUTES_ADMIN',     name: 'Disputes Admin', username: 'disputes_admin' },
    { email: 'safety@kiwimart.test',   role: 'TRUST_SAFETY_ADMIN', name: 'Safety Admin',   username: 'safety_admin'   },
    { email: 'support@kiwimart.test',  role: 'SUPPORT_ADMIN',      name: 'Support Admin',  username: 'support_admin'  },
    { email: 'sellers@kiwimart.test',  role: 'SELLER_MANAGER',     name: 'Seller Manager', username: 'sellers_admin'  },
    { email: 'readonly@kiwimart.test', role: 'READ_ONLY_ADMIN',    name: 'Read Only Admin', username: 'readonly_admin' },
  ] as const;

  for (const acc of adminAccounts) {
    await db.user.create({
      data: {
        email: acc.email,
        username: acc.username,
        displayName: acc.name,
        passwordHash: adminHash,
        emailVerified: new Date(),
        isAdmin: true,
        adminRole: acc.role,
        sellerEnabled: false,
        region: 'Auckland',
        suburb: 'Auckland CBD',
        agreedTermsAt: new Date(),
      },
    });
  }

  console.log('✅ 13 users created (3 sellers, 2 buyers, 7 admins)');

  // ── STEP 5: Listings ─────────────────────────────────────────────────────────
  console.log('\n🛍️  Creating listings...');

  // ── TechDeals NZ (7 listings) ────────────────────────────────────────────────

  // L1 — iPhone 15 Pro · Just Listed
  const l1 = await db.listing.create({ data: {
    sellerId: techdeals.id, title: 'iPhone 15 Pro 256GB — Pristine Condition',
    description: 'Bought new 3 months ago, upgrading to 15 Pro Max. Phone is in perfect condition, no scratches or marks. Comes with original box, charger, and unused EarPods. Battery health 99%. Face ID working perfectly. Unlocked to all NZ networks.',
    priceNzd: 149900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'electronics', subcategoryName: 'Mobile Phones',
    region: 'Auckland', suburb: 'Newmarket',
    shippingOption: 'COURIER', shippingNzd: 0,
    isNegotiable: false, isUrgent: false, shipsNationwide: true,
    offersEnabled: true, viewCount: 142, watcherCount: 8,
    publishedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86400000),
    createdAt: new Date(), // Just Listed badge
  }});
  await addImages(l1.id, [
    'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800',
    'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=800',
    'https://images.unsplash.com/photo-1585060544812-6b45742d762f?w=800',
  ], l1.title);

  // L2 — MacBook Pro · Price Dropped
  const l2 = await db.listing.create({ data: {
    sellerId: techdeals.id, title: 'MacBook Pro 14" M3 — Price Reduced!',
    description: 'M3 chip, 16GB RAM, 512GB SSD. Purchased 6 months ago for work, company provided a new one so this is surplus to requirements. Excellent condition with minor desk wear on the bottom. Comes with MagSafe charger. AppleCare valid until March 2026.',
    priceNzd: 289900, previousPriceNzd: 329900,
    priceDroppedAt: new Date(Date.now() - 1 * 86400000),
    condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'electronics', subcategoryName: 'Computers',
    region: 'Auckland', suburb: 'Newmarket',
    shippingOption: 'BOTH', shippingNzd: 0,
    isNegotiable: true, isUrgent: false, shipsNationwide: true,
    offersEnabled: true, viewCount: 389, watcherCount: 21,
    publishedAt: new Date(Date.now() - 7 * 86400000),
    expiresAt: new Date(Date.now() + 23 * 86400000),
  }});
  await addImages(l2.id, [
    'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=800',
    'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=800',
    'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800',
  ], l2.title);

  // L3 — Sony Headphones
  const l3 = await db.listing.create({ data: {
    sellerId: techdeals.id, title: 'Sony WH-1000XM5 Noise Cancelling — Barely Used',
    description: 'World-class noise cancellation, 30-hour battery life. Used only a handful of times. Still has protective film on ear cups. Comes with original case, cables and documentation. Perfect for travel or working from home.',
    priceNzd: 34900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'electronics', subcategoryName: 'Audio',
    region: 'Auckland', suburb: 'Newmarket',
    shippingOption: 'COURIER', shippingNzd: 0,
    isNegotiable: false, isUrgent: false, shipsNationwide: true,
    offersEnabled: true, viewCount: 203, watcherCount: 14,
    publishedAt: new Date(Date.now() - 5 * 86400000),
    expiresAt: new Date(Date.now() + 25 * 86400000),
  }});
  await addImages(l3.id, [
    'https://images.unsplash.com/photo-1585298723682-7115561c51b7?w=800',
    'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800',
    'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=800',
  ], l3.title);

  // L4 — Gaming PC · Urgent
  const l4 = await db.listing.create({ data: {
    sellerId: techdeals.id, title: 'Custom Gaming PC — Must Sell, Moving to Australia Next Week',
    description: 'RTX 4070, i7-13700K, 32GB DDR5, 1TB NVMe SSD. Built 8 months ago, runs everything at ultra settings. Moving overseas next week so need this gone ASAP. Will not last — serious buyers only.',
    priceNzd: 229900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'electronics', subcategoryName: 'Computers',
    region: 'Auckland', suburb: 'Newmarket',
    shippingOption: 'PICKUP', shippingNzd: null,
    isUrgent: true, isNegotiable: true, shipsNationwide: false,
    offersEnabled: true, viewCount: 511, watcherCount: 33,
    publishedAt: new Date(Date.now() - 2 * 86400000),
    expiresAt: new Date(Date.now() + 28 * 86400000),
  }});
  await addImages(l4.id, [
    'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800',
    'https://images.unsplash.com/photo-1587202372775-e229f172b9d7?w=800',
    'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800',
  ], l4.title);

  // L5 — iPad Air · Negotiable
  const l5 = await db.listing.create({ data: {
    sellerId: techdeals.id, title: 'iPad Air 5th Gen 64GB WiFi — Open to Offers',
    description: 'Great condition iPad Air, used mainly for reading and video calls. Screen is perfect with no scratches. Smart Folio case included (worth $120). Happy to consider reasonable offers.',
    priceNzd: 64900, condition: 'GOOD', status: 'ACTIVE',
    categoryId: 'electronics', subcategoryName: 'Tablets',
    region: 'Auckland', suburb: 'Newmarket',
    shippingOption: 'BOTH', shippingNzd: 0,
    isNegotiable: true, isUrgent: false, shipsNationwide: true,
    offersEnabled: true, viewCount: 178, watcherCount: 9,
    publishedAt: new Date(Date.now() - 10 * 86400000),
    expiresAt: new Date(Date.now() + 20 * 86400000),
  }});
  await addImages(l5.id, [
    'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=800',
    'https://images.unsplash.com/photo-1561154464-82e9adf32764?w=800',
    'https://images.unsplash.com/photo-1589739900266-43b2843f4c12?w=800',
  ], l5.title);

  // L6 — Samsung 65" TV · Ships NZ Wide
  const l6 = await db.listing.create({ data: {
    sellerId: techdeals.id, title: 'Samsung 65" QLED 4K Smart TV — Nationwide Delivery Available',
    description: 'QN65Q80C, bought 1 year ago. Stunning picture quality with QLED technology. Selling as upgrading to 85". All original remotes, manuals and stand hardware included. Can organise nationwide freight delivery.',
    priceNzd: 189900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'electronics', subcategoryName: 'TV & Home Theatre',
    region: 'Auckland', suburb: 'Newmarket',
    shippingOption: 'BOTH', shippingNzd: 15000,
    isNegotiable: false, isUrgent: false, shipsNationwide: true,
    offersEnabled: false, viewCount: 267, watcherCount: 17,
    publishedAt: new Date(Date.now() - 14 * 86400000),
    expiresAt: new Date(Date.now() + 16 * 86400000),
  }});
  await addImages(l6.id, [
    'https://images.unsplash.com/photo-1593359677879-a4bb92f4ead5?w=800',
    'https://images.unsplash.com/photo-1571415060716-baff5f717c37?w=800',
    'https://images.unsplash.com/photo-1461151304267-38535e780c79?w=800',
  ], l6.title);

  // L7 — AirPods Pro · SOLD (used for completed order)
  const l7 = await db.listing.create({ data: {
    sellerId: techdeals.id, title: 'AirPods Pro 2nd Generation — Case Only Light Use',
    description: 'Purchased 4 months ago. Active Noise Cancellation and Transparency mode working perfectly. Both earbuds and case in excellent condition. Original box and documentation included. Selling as received new pair as a gift.',
    priceNzd: 28900, condition: 'LIKE_NEW', status: 'SOLD',
    categoryId: 'electronics', subcategoryName: 'Audio',
    region: 'Auckland', suburb: 'Newmarket',
    shippingOption: 'COURIER', shippingNzd: 0,
    isNegotiable: false, isUrgent: false, shipsNationwide: true,
    offersEnabled: true, viewCount: 94, watcherCount: 4,
    publishedAt: new Date(Date.now() - 14 * 86400000),
    soldAt: new Date(Date.now() - 3 * 86400000),
    expiresAt: new Date(Date.now() + 16 * 86400000),
  }});
  await addImages(l7.id, [
    'https://images.unsplash.com/photo-1603351154351-5e2d0600bb77?w=800',
    'https://images.unsplash.com/photo-1572536147248-ac59a8abfa4b?w=800',
    'https://images.unsplash.com/photo-1588423771073-b8903fead0ab?w=800',
  ], l7.title);

  // ── HomeStyle NZ (6 listings) ────────────────────────────────────────────────

  // L8 — Sofa · Negotiable, Pickup
  const l8 = await db.listing.create({ data: {
    sellerId: homestyle.id, title: 'Danish Design 3-Seater Sofa — Excellent Condition',
    description: 'Beautiful mid-century modern sofa in oatmeal fabric. Bought from Freedom Furniture 18 months ago for $2,800. Moving house and it does not fit the new space. No stains, pets or smoke. Measurements: 220cm W x 90cm D x 82cm H. Wellington pickup only.',
    priceNzd: 119900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'home-garden', subcategoryName: 'Furniture',
    region: 'Wellington', suburb: 'Kelburn',
    shippingOption: 'PICKUP', shippingNzd: null,
    isNegotiable: true, isUrgent: false, shipsNationwide: false,
    offersEnabled: true, viewCount: 156, watcherCount: 12,
    publishedAt: new Date(Date.now() - 8 * 86400000),
    expiresAt: new Date(Date.now() + 22 * 86400000),
  }});
  await addImages(l8.id, [
    'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800',
    'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800',
    'https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?w=800',
  ], l8.title);

  // L9 — KitchenAid Mixer
  const l9 = await db.listing.create({ data: {
    sellerId: homestyle.id, title: 'KitchenAid Artisan Stand Mixer — Barely Used, Empire Red',
    description: 'Received as a wedding gift, already had one so this has only been used twice. 4.8L bowl, 10 speeds. All original attachments included: flat beater, dough hook, wire whip. RRP $999, selling to give it a good home.',
    priceNzd: 59900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'home-garden', subcategoryName: 'Kitchen',
    region: 'Wellington', suburb: 'Kelburn',
    shippingOption: 'BOTH', shippingNzd: 1500,
    isNegotiable: false, isUrgent: false, shipsNationwide: true,
    offersEnabled: true, viewCount: 88, watcherCount: 6,
    publishedAt: new Date(Date.now() - 12 * 86400000),
    expiresAt: new Date(Date.now() + 18 * 86400000),
  }});
  await addImages(l9.id, [
    'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800',
    'https://images.unsplash.com/photo-1567183547-1e2a74b1a2d6?w=800',
    'https://images.unsplash.com/photo-1565538810643-b5bdb714032a?w=800',
  ], l9.title);

  // L10 — Wool Winter Coat (Fashion)
  const l10 = await db.listing.create({ data: {
    sellerId: homestyle.id, title: "Trenery Wool Blend Winter Coat — Size 12, Camel",
    description: "Stunning wool blend coat from Trenery, worn only 3 times. Size 12, fits true to size. Dry cleaned before listing. No damage or pilling. Perfect for Wellington winters. Original price $599.",
    priceNzd: 18900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'fashion', subcategoryName: 'Jackets & Coats',
    region: 'Wellington', suburb: 'Kelburn',
    shippingOption: 'COURIER', shippingNzd: 0,
    isNegotiable: false, isUrgent: false, shipsNationwide: true,
    offersEnabled: false, viewCount: 73, watcherCount: 3,
    publishedAt: new Date(Date.now() - 9 * 86400000),
    expiresAt: new Date(Date.now() + 21 * 86400000),
  }});
  await addImages(l10.id, [
    'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=800',
    'https://images.unsplash.com/photo-1548624313-0396c75e4b1a?w=800',
    'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=800',
  ], l10.title);

  // L11 — Nike Air Max · Price Dropped
  const l11 = await db.listing.create({ data: {
    sellerId: homestyle.id, title: 'Nike Air Max 270 — Size 10, Barely Worn',
    description: 'Bought for a fun run that got cancelled. Worn twice around the block. Size 10 US / 44 EU. Original box included. No marks or scuffs. Selling well below retail.',
    priceNzd: 10900, previousPriceNzd: 14900,
    priceDroppedAt: new Date(Date.now() - 2 * 86400000),
    condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'fashion', subcategoryName: 'Shoes',
    region: 'Wellington', suburb: 'Kelburn',
    shippingOption: 'COURIER', shippingNzd: 0,
    isNegotiable: false, isUrgent: false, shipsNationwide: true,
    offersEnabled: true, viewCount: 211, watcherCount: 16,
    publishedAt: new Date(Date.now() - 15 * 86400000),
    expiresAt: new Date(Date.now() + 15 * 86400000),
  }});
  await addImages(l11.id, [
    'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800',
    'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=800',
    'https://images.unsplash.com/photo-1600185365483-26d0a4ea9e28?w=800',
  ], l11.title);

  // L12 — Dyson V11 Vacuum
  const l12 = await db.listing.create({ data: {
    sellerId: homestyle.id, title: 'Dyson V11 Animal Cordless Vacuum — Full Kit',
    description: 'Excellent suction, perfect for pet hair. All attachments present including the motorised floor tool, crevice tool and mini motorhead. Battery holds full charge. Comes with wall dock and charger.',
    priceNzd: 44900, condition: 'GOOD', status: 'ACTIVE',
    categoryId: 'home-garden', subcategoryName: 'Appliances',
    region: 'Wellington', suburb: 'Kelburn',
    shippingOption: 'COURIER', shippingNzd: 1200,
    isNegotiable: true, isUrgent: false, shipsNationwide: true,
    offersEnabled: true, viewCount: 124, watcherCount: 7,
    publishedAt: new Date(Date.now() - 6 * 86400000),
    expiresAt: new Date(Date.now() + 24 * 86400000),
  }});
  await addImages(l12.id, [
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
    'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800',
    'https://images.unsplash.com/photo-1527515637462-cff94eecc1ac?w=800',
  ], l12.title);

  // L13 — Outdoor Dining Set · Negotiable, Pickup
  const l13 = await db.listing.create({ data: {
    sellerId: homestyle.id, title: '6-Person Outdoor Dining Set — Aluminium Frame',
    description: 'Weather-resistant aluminium table and 6 chairs. Table: 180cm x 90cm. Used for one summer season, stored indoors over winter. All chairs have cushions in excellent condition. Wellington pickup preferred, can discuss freight.',
    priceNzd: 89900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'home-garden', subcategoryName: 'BBQs & Outdoor',
    region: 'Wellington', suburb: 'Kelburn',
    shippingOption: 'PICKUP', shippingNzd: null,
    isNegotiable: true, isUrgent: false, shipsNationwide: false,
    offersEnabled: true, viewCount: 97, watcherCount: 5,
    publishedAt: new Date(Date.now() - 11 * 86400000),
    expiresAt: new Date(Date.now() + 19 * 86400000),
  }});
  await addImages(l13.id, [
    'https://images.unsplash.com/photo-1595429035839-c99c298ffdde?w=800',
    'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=800',
    'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=800',
  ], l13.title);

  // ── OutdoorGear NZ (6 listings) ──────────────────────────────────────────────

  // L14 — Mountain Bike · Negotiable, Pickup
  const l14 = await db.listing.create({ data: {
    sellerId: outdoorgear.id, title: 'Trek Marlin 7 Mountain Bike 2023 — Medium Frame',
    description: '29" wheels, 1x12 drivetrain, hydraulic disc brakes. Ridden about 15 times on trails. Serviced 2 months ago. Some minor trail marks on the frame but mechanically perfect. Comes with pedals, bottle cage and rear mudguard.',
    priceNzd: 139900, condition: 'GOOD', status: 'ACTIVE',
    categoryId: 'sports', subcategoryName: 'Cycling',
    region: 'Canterbury', suburb: 'Christchurch City',
    shippingOption: 'PICKUP', shippingNzd: null,
    isNegotiable: true, isUrgent: false, shipsNationwide: false,
    offersEnabled: true, viewCount: 302, watcherCount: 19,
    publishedAt: new Date(Date.now() - 4 * 86400000),
    expiresAt: new Date(Date.now() + 26 * 86400000),
  }});
  await addImages(l14.id, [
    'https://images.unsplash.com/photo-1571188654248-7a89213915f7?w=800',
    'https://images.unsplash.com/photo-1502744688674-c619d1586c9e?w=800',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
  ], l14.title);

  // L15 — Camping Tent · Urgent
  const l15 = await db.listing.create({ data: {
    sellerId: outdoorgear.id, title: 'MSR Hubba Hubba 2-Person Tent — Moving Sale',
    description: 'Ultralight 2-person backpacking tent, 1.27kg. Used on 4 overnight trips. Both inner and fly in excellent condition. All pegs, poles and stuff sacks included. Retail $899, quick sale needed.',
    priceNzd: 44900, condition: 'GOOD', status: 'ACTIVE',
    categoryId: 'sports', subcategoryName: 'Camping & Hiking',
    region: 'Canterbury', suburb: 'Christchurch City',
    shippingOption: 'BOTH', shippingNzd: 1500,
    isUrgent: true, isNegotiable: true, shipsNationwide: true,
    offersEnabled: true, viewCount: 188, watcherCount: 11,
    publishedAt: new Date(Date.now() - 1 * 86400000),
    expiresAt: new Date(Date.now() + 29 * 86400000),
  }});
  await addImages(l15.id, [
    'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=800',
    'https://images.unsplash.com/photo-1537905569824-f89f14cceb68?w=800',
    'https://images.unsplash.com/photo-1478131143081-80f7f84ca84d?w=800',
  ], l15.title);

  // L16 — Home Gym Bundle · Pickup
  const l16 = await db.listing.create({ data: {
    sellerId: outdoorgear.id, title: 'Home Gym Bundle — Dumbbells, Bench and Resistance Bands',
    description: 'Adjustable dumbbell set (5-32.5kg each), padded weight bench, 5 resistance bands. All high quality, used regularly but well maintained. Great starter home gym set. Christchurch pickup only due to weight.',
    priceNzd: 69900, condition: 'GOOD', status: 'ACTIVE',
    categoryId: 'sports', subcategoryName: 'Running & Fitness',
    region: 'Canterbury', suburb: 'Christchurch City',
    shippingOption: 'PICKUP', shippingNzd: null,
    isNegotiable: true, isUrgent: false, shipsNationwide: false,
    offersEnabled: true, viewCount: 143, watcherCount: 8,
    publishedAt: new Date(Date.now() - 13 * 86400000),
    expiresAt: new Date(Date.now() + 17 * 86400000),
  }});
  await addImages(l16.id, [
    'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800',
    'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800',
    'https://images.unsplash.com/photo-1540497077202-7c8a3999166f?w=800',
  ], l16.title);

  // L17 — DeWalt Drill · Ships NZ (Tools & Equipment)
  const l17 = await db.listing.create({ data: {
    sellerId: outdoorgear.id, title: 'DeWalt 18V XR Brushless Drill and Driver Kit — 2 Batteries',
    description: 'DCD796 drill and DCF887 impact driver combo. 2x 5Ah batteries and dual charger included. Both in excellent working order. Used for a single renovation project. Full DeWalt TSTAK case included.',
    priceNzd: 47900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'business', subcategoryName: 'Power Tools',
    region: 'Canterbury', suburb: 'Christchurch City',
    shippingOption: 'COURIER', shippingNzd: 1500,
    isNegotiable: false, isUrgent: false, shipsNationwide: true,
    offersEnabled: false, viewCount: 67, watcherCount: 4,
    publishedAt: new Date(Date.now() - 3 * 86400000),
    expiresAt: new Date(Date.now() + 27 * 86400000),
  }});
  await addImages(l17.id, [
    'https://images.unsplash.com/photo-1504148455328-c376907d081c?w=800',
    'https://images.unsplash.com/photo-1572981779307-38b8cabb2407?w=800',
    'https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=800',
  ], l17.title);

  // L18 — Kayak · Pickup
  const l18 = await db.listing.create({ data: {
    sellerId: outdoorgear.id, title: 'Perception Pescador 12 Sit-on-Top Kayak — Includes Paddle',
    description: 'Stable, versatile kayak perfect for lakes, harbours and calm coastal waters. UV-resistant hull with minimal fading. Includes Werner paddle (worth $250), paddle leash and carry handles. Christchurch pickup.',
    priceNzd: 119900, condition: 'GOOD', status: 'ACTIVE',
    categoryId: 'sports', subcategoryName: 'Water Sports',
    region: 'Canterbury', suburb: 'Christchurch City',
    shippingOption: 'PICKUP', shippingNzd: null,
    isNegotiable: true, isUrgent: false, shipsNationwide: false,
    offersEnabled: true, viewCount: 91, watcherCount: 6,
    publishedAt: new Date(Date.now() - 16 * 86400000),
    expiresAt: new Date(Date.now() + 14 * 86400000),
  }});
  await addImages(l18.id, [
    'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800',
    'https://images.unsplash.com/photo-1482245294234-b3f2f8d5f1a4?w=800',
    'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=800',
  ], l18.title);

  // L19 — Ski Package · Just Listed
  const l19 = await db.listing.create({ data: {
    sellerId: outdoorgear.id, title: 'Complete Ski Package — Skis, Boots, Poles and Bag',
    description: '170cm Rossignol Experience 78 skis with Marker bindings, Salomon Quest Access 80 boots (size 27.5), poles and wheeled ski bag. Everything you need for the slopes. Used for 2 seasons.',
    priceNzd: 89900, condition: 'GOOD', status: 'ACTIVE',
    categoryId: 'sports', subcategoryName: 'Snow Sports',
    region: 'Canterbury', suburb: 'Christchurch City',
    shippingOption: 'COURIER', shippingNzd: 2500,
    isNegotiable: false, isUrgent: false, shipsNationwide: true,
    offersEnabled: true, viewCount: 12, watcherCount: 1,
    publishedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86400000),
    createdAt: new Date(), // Just Listed badge
  }});
  await addImages(l19.id, [
    'https://images.unsplash.com/photo-1548638618-1da1abb19fb0?w=800',
    'https://images.unsplash.com/photo-1547036967-23d11aacaee0?w=800',
    'https://images.unsplash.com/photo-1563808437-3bc07e3c4e81?w=800',
  ], l19.title);

  console.log('✅ 19 listings created (57 images)');

  // ── STEP 6: Watchlist ────────────────────────────────────────────────────────
  console.log('\n👁️  Creating watchlist entries...');
  await db.watchlistItem.createMany({
    data: [
      { userId: alice.id, listingId: l2.id },
      { userId: alice.id, listingId: l4.id },
      { userId: alice.id, listingId: l14.id },
    ],
  });
  // Denormalised watcher count (already set in listing data, update for accuracy)
  await db.listing.update({ where: { id: l2.id },  data: { watcherCount: { increment: 0 } } }); // already 21
  console.log('✅ 3 watchlist entries created (Alice watches MacBook, Gaming PC, Mountain Bike)');

  // ── STEP 7: Completed Order + Review + Payout ────────────────────────────────
  console.log('\n📦 Creating completed order, review and payout...');
  const order = await db.order.create({
    data: {
      buyerId: alice.id,
      sellerId: techdeals.id,
      listingId: l7.id,
      itemNzd: 28900,
      shippingNzd: 0,
      totalNzd: 28900,
      status: 'COMPLETED',
      stripePaymentIntentId: 'pi_test_seed_completed_001',
      stripeTransferId: 'tr_test_seed_completed_001',
      shippingName: 'Alice M',
      shippingLine1: '42 Ponsonby Road',
      shippingCity: 'Auckland',
      shippingRegion: 'Auckland',
      shippingPostcode: '1011',
      dispatchedAt: new Date(Date.now() - 5 * 86400000),
      deliveredAt:  new Date(Date.now() - 4 * 86400000),
      completedAt:  new Date(Date.now() - 3 * 86400000),
      createdAt:    new Date(Date.now() - 7 * 86400000),
    },
  });

  await db.review.create({
    data: {
      orderId:  order.id,
      sellerId: techdeals.id,
      authorId: alice.id,
      rating:   50,  // 50 = 5.0 stars (schema stores 1–50)
      comment:  'Fast shipping, item exactly as described. Great seller, would buy again!',
      approved: true,
      createdAt: new Date(Date.now() - 2 * 86400000),
    },
  });

  const stripeFeeNzd = Math.round(28900 * 0.019 + 30); // ~579 cents
  await db.payout.create({
    data: {
      orderId:        order.id,
      userId:         techdeals.id,
      amountNzd:      28900 - stripeFeeNzd,
      platformFeeNzd: 0,
      stripeFeeNzd,
      status:         'PAID',
      stripeTransferId: 'tr_test_seed_payout_001',
      initiatedAt:    new Date(Date.now() - 3 * 86400000),
      paidAt:         new Date(Date.now() - 2 * 86400000),
      createdAt:      new Date(Date.now() - 3 * 86400000),
    },
  });
  console.log('✅ 1 order, 1 review (5★), 1 payout created');

  // ── STEP 8: Message Thread ───────────────────────────────────────────────────
  console.log('\n💬 Creating message thread...');
  // participant IDs sorted lexicographically (KiwiMart messaging convention)
  const [p1Id, p2Id] = [alice.id, techdeals.id].sort();
  const twoHoursAgo = new Date(Date.now() - 2 * 3600000);
  const oneHourAgo  = new Date(Date.now() - 1 * 3600000);

  const thread = await db.messageThread.create({
    data: {
      participant1Id: p1Id,
      participant2Id: p2Id,
      listingId:      l2.id,
      lastMessageAt:  oneHourAgo,
      createdAt:      twoHoursAgo,
    },
  });

  await db.message.create({
    data: {
      threadId:  thread.id,
      senderId:  alice.id,
      body:      "Hi, is the MacBook Pro still available? Would you take $2,600 for it?",
      read:      true,
      readAt:    twoHoursAgo,
      createdAt: twoHoursAgo,
    },
  });

  await db.message.create({
    data: {
      threadId:  thread.id,
      senderId:  techdeals.id,
      body:      "Hi Alice! Yes still available. I can do $2,750 — it is in really great condition and still has AppleCare. Happy to video call if you want to see it.",
      read:      true,
      readAt:    oneHourAgo,
      createdAt: oneHourAgo,
    },
  });
  console.log('✅ 1 message thread, 2 messages created');

  // ── Credentials summary ──────────────────────────────────────────────────────
  console.log(`
╔════════════════════════════════════════════╗
║         KIWIMART TEST CREDENTIALS          ║
╠════════════════════════════════════════════╣
║ BUYERS                                     ║
║  buyer@kiwimart.test / BuyerPassword123!   ║
║  buyer2@kiwimart.test / BuyerPassword123!  ║
╠════════════════════════════════════════════╣
║ SELLERS                                    ║
║  techdeals@kiwimart.test                   ║
║  homestyle@kiwimart.test                   ║
║  outdoorgear@kiwimart.test                 ║
║  Password: SellerPassword123!              ║
╠════════════════════════════════════════════╣
║ ADMIN  (password: AdminPassword123!)       ║
║  admin@kiwimart.test    (SUPER_ADMIN)      ║
║  finance@kiwimart.test  (FINANCE_ADMIN)    ║
║  disputes@kiwimart.test (DISPUTES_ADMIN)   ║
║  safety@kiwimart.test   (TRUST_SAFETY)     ║
║  support@kiwimart.test  (SUPPORT_ADMIN)    ║
║  sellers@kiwimart.test  (SELLER_MANAGER)   ║
║  readonly@kiwimart.test (READ_ONLY_ADMIN)  ║
╚════════════════════════════════════════════╝
`);
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => db.$disconnect());
