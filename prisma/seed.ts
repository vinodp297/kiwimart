// prisma/seed.ts
// ─── KiwiMart Comprehensive Production Seed ─────────────────────────────────
// Complete wipe + rebuild with realistic NZ marketplace data.
// Run: npx prisma db seed

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

// ── Time helpers ──────────────────────────────────────────────────────────────
const DAY = 86400000;
const HOUR = 3600000;
const ago = (ms: number) => new Date(Date.now() - ms);
const future = (ms: number) => new Date(Date.now() + ms);

// ── Wipe database (reverse dependency order) ─────────────────────────────────
async function wipeDatabase() {
  console.log('🗑️  Wiping database...');
  await db.notification.deleteMany();
  await db.auditLog.deleteMany();
  await db.report.deleteMany();
  await db.blockedUser.deleteMany();
  await db.adminInvitation.deleteMany();
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

// ── Category definitions ─────────────────────────────────────────────────────
const CATEGORIES = [
  { id: 'electronics', name: 'Electronics', icon: '💻', slug: 'electronics', displayOrder: 1,
    subcategories: ['Mobile Phones', 'Computers', 'Tablets', 'Audio', 'Cameras & Drones', 'TV & Home Theatre', 'Gaming', 'Wearables'] },
  { id: 'fashion', name: 'Fashion', icon: '👗', slug: 'fashion', displayOrder: 2,
    subcategories: ["Women's Clothing", "Men's Clothing", 'Shoes', 'Bags & Accessories', 'Jackets & Coats', 'Jewellery'] },
  { id: 'home-garden', name: 'Home & Garden', icon: '🏡', slug: 'home-garden', displayOrder: 3,
    subcategories: ['Furniture', 'Appliances', 'BBQs & Outdoor', 'Garden & Landscaping', 'Kitchen', 'Lighting'] },
  { id: 'sports', name: 'Sports & Outdoors', icon: '🏉', slug: 'sports', displayOrder: 4,
    subcategories: ['Cycling', 'Running & Fitness', 'Water Sports', 'Snow Sports', 'Camping & Hiking', 'Golf'] },
  { id: 'vehicles', name: 'Vehicles', icon: '🚗', slug: 'vehicles', displayOrder: 5,
    subcategories: ['Cars', 'Bikes', 'Boats & Marine', 'Motorcycles', 'Car Parts & Accessories'] },
  { id: 'property', name: 'Property', icon: '🏘️', slug: 'property', displayOrder: 6,
    subcategories: ['Rentals', 'For Sale', 'Flatmates'] },
  { id: 'baby-kids', name: 'Baby & Kids', icon: '🍼', slug: 'baby-kids', displayOrder: 7,
    subcategories: ['Baby Gear', "Children's Clothing", 'Toys & Games', 'Books', 'Nursery Furniture'] },
  { id: 'collectibles', name: 'Collectibles', icon: '🏺', slug: 'collectibles', displayOrder: 8,
    subcategories: ['Art', 'Sports Memorabilia', 'Coins & Stamps', 'Antiques', 'Books & Comics'] },
  { id: 'business', name: 'Tools & Equipment', icon: '🔧', slug: 'business', displayOrder: 9,
    subcategories: ['Power Tools', 'Hand Tools', 'Office Furniture', 'Industrial Equipment', 'Safety Equipment'] },
];

// ── Image helper ──────────────────────────────────────────────────────────────
async function addImages(listingId: string, urls: string[], title: string) {
  for (let i = 0; i < urls.length; i++) {
    await db.listingImage.create({
      data: {
        listingId, r2Key: urls[i], thumbnailKey: urls[i], altText: title,
        order: i, scanned: true, safe: true,
      },
    });
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // ── STEP 1: Wipe ──────────────────────────────────────────────────────────
  await wipeDatabase();

  // ── STEP 2: Categories ────────────────────────────────────────────────────
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

  // ── STEP 3: Hash passwords ────────────────────────────────────────────────
  console.log('\n🔑 Hashing passwords...');
  const [buyerHash, sellerHash, adminHash] = await Promise.all([
    hash('BuyerPassword123!'),
    hash('SellerPassword123!'),
    hash('AdminPassword123!'),
  ]);

  // ── STEP 4: Users ─────────────────────────────────────────────────────────
  console.log('\n👤 Creating users...');

  // ── SELLERS (4) ───────────────────────────────────────────────────────────

  const techdeals = await db.user.create({ data: {
    email: 'techdeals@kiwimart.test', username: 'techdeals', displayName: 'TechDeals NZ',
    passwordHash: sellerHash, emailVerified: new Date(),
    phoneVerified: true, phoneVerifiedAt: ago(30 * DAY),
    idVerified: true, idVerifiedAt: ago(60 * DAY), idSubmittedAt: ago(65 * DAY),
    bio: 'Premium electronics at unbeatable NZ prices. All items tested and verified before listing. Fast shipping nationwide.',
    sellerEnabled: true, stripeOnboarded: true, stripeAccountId: 'acct_1RTestTechDealsNZ01',
    stripeChargesEnabled: true, stripePayoutsEnabled: true,
    sellerTermsAcceptedAt: ago(90 * DAY), onboardingCompleted: true, onboardingIntent: 'SELL',
    region: 'Auckland', suburb: 'Newmarket', agreedTermsAt: ago(90 * DAY),
  }});

  const homestyle = await db.user.create({ data: {
    email: 'homestyle@kiwimart.test', username: 'homestyle', displayName: 'HomeStyle NZ',
    passwordHash: sellerHash, emailVerified: new Date(),
    phoneVerified: true, phoneVerifiedAt: ago(20 * DAY),
    bio: 'Beautiful homewares and fashion finds. Based in Wellington. Local pickup welcome.',
    sellerEnabled: true, stripeOnboarded: true, stripeAccountId: 'acct_1RTestHomeStyleNZ02',
    stripeChargesEnabled: true, stripePayoutsEnabled: true,
    sellerTermsAcceptedAt: ago(60 * DAY), onboardingCompleted: true, onboardingIntent: 'BOTH',
    region: 'Wellington', suburb: 'Kelburn', agreedTermsAt: ago(60 * DAY),
  }});

  const outdoorgear = await db.user.create({ data: {
    email: 'outdoorgear@kiwimart.test', username: 'outdoorgear', displayName: 'OutdoorGear NZ',
    passwordHash: sellerHash, emailVerified: new Date(),
    idVerified: true, idVerifiedAt: ago(14 * DAY), idSubmittedAt: ago(20 * DAY),
    bio: 'Quality outdoor and sports equipment. Christchurch based. Happy to ship or local pickup available.',
    sellerEnabled: true, stripeOnboarded: true, stripeAccountId: 'acct_1RTestOutdoorGearNZ3',
    stripeChargesEnabled: true, stripePayoutsEnabled: true,
    sellerTermsAcceptedAt: ago(30 * DAY), onboardingCompleted: true, onboardingIntent: 'SELL',
    region: 'Canterbury', suburb: 'Christchurch City', agreedTermsAt: ago(30 * DAY),
  }});

  const fashionhub = await db.user.create({ data: {
    email: 'fashionhub@kiwimart.test', username: 'fashionhub', displayName: 'FashionHub NZ',
    passwordHash: sellerHash, emailVerified: new Date(),
    phoneVerified: true, phoneVerifiedAt: ago(15 * DAY),
    bio: 'Curated streetwear, designer fashion and sneakers. Authenticity guaranteed. Hamilton-based.',
    sellerEnabled: true, stripeOnboarded: true, stripeAccountId: 'acct_1RTestFashionHubNZ04',
    stripeChargesEnabled: true, stripePayoutsEnabled: true,
    sellerTermsAcceptedAt: ago(45 * DAY), onboardingCompleted: true, onboardingIntent: 'SELL',
    region: 'Waikato', suburb: 'Hamilton Central', agreedTermsAt: ago(45 * DAY),
  }});

  // ── BUYERS (3) ────────────────────────────────────────────────────────────

  const alice = await db.user.create({ data: {
    email: 'buyer@kiwimart.test', username: 'alice_buys', displayName: 'Alice M',
    passwordHash: buyerHash, emailVerified: new Date(),
    phoneVerified: true, phoneVerifiedAt: ago(10 * DAY),
    onboardingCompleted: true, onboardingIntent: 'BUY',
    region: 'Auckland', suburb: 'Ponsonby', agreedTermsAt: ago(45 * DAY),
  }});

  const ben = await db.user.create({ data: {
    email: 'buyer2@kiwimart.test', username: 'ben_nz', displayName: 'Ben T',
    passwordHash: buyerHash, emailVerified: new Date(),
    onboardingCompleted: true, onboardingIntent: 'BUY',
    region: 'Wellington', suburb: 'Te Aro', agreedTermsAt: ago(20 * DAY),
  }});

  const carol = await db.user.create({ data: {
    email: 'buyer3@kiwimart.test', username: 'carol_wgtn', displayName: 'Carol W',
    passwordHash: buyerHash, emailVerified: new Date(),
    phoneVerified: true, phoneVerifiedAt: ago(5 * DAY),
    onboardingCompleted: true, onboardingIntent: 'BOTH',
    region: 'Canterbury', suburb: 'Riccarton', agreedTermsAt: ago(15 * DAY),
  }});

  // ── ADMINS (7) ────────────────────────────────────────────────────────────

  await db.user.create({ data: {
    email: 'admin@kiwimart.test', username: 'admin', displayName: 'KiwiMart Admin',
    passwordHash: adminHash, emailVerified: new Date(),
    isAdmin: true, adminRole: 'SUPER_ADMIN', onboardingCompleted: true,
    region: 'Auckland', suburb: 'Auckland CBD', agreedTermsAt: new Date(),
  }});

  const adminAccounts = [
    { email: 'finance@kiwimart.test', role: 'FINANCE_ADMIN', name: 'Finance Admin', username: 'finance_admin' },
    { email: 'disputes@kiwimart.test', role: 'DISPUTES_ADMIN', name: 'Disputes Admin', username: 'disputes_admin' },
    { email: 'safety@kiwimart.test', role: 'TRUST_SAFETY_ADMIN', name: 'Safety Admin', username: 'safety_admin' },
    { email: 'support@kiwimart.test', role: 'SUPPORT_ADMIN', name: 'Support Admin', username: 'support_admin' },
    { email: 'sellers@kiwimart.test', role: 'SELLER_MANAGER', name: 'Seller Manager', username: 'sellers_admin' },
    { email: 'readonly@kiwimart.test', role: 'READ_ONLY_ADMIN', name: 'Read Only Admin', username: 'readonly_admin' },
  ] as const;

  for (const acc of adminAccounts) {
    await db.user.create({ data: {
      email: acc.email, username: acc.username, displayName: acc.name,
      passwordHash: adminHash, emailVerified: new Date(),
      isAdmin: true, adminRole: acc.role, onboardingCompleted: true,
      region: 'Auckland', suburb: 'Auckland CBD', agreedTermsAt: new Date(),
    }});
  }

  console.log('✅ 14 users created (4 sellers, 3 buyers, 7 admins)');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 5: LISTINGS (~45)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n🛍️  Creating listings...');

  // Helper to create listing + images
  type LD = Parameters<typeof db.listing.create>[0]['data'];
  async function L(data: LD, imgs: string[]): Promise<string> {
    const listing = await db.listing.create({ data });
    await addImages(listing.id, imgs, listing.title);
    return listing.id;
  }

  // ── ELECTRONICS (8 listings) ──────────────────────────────────────────────

  const iphone = await L({
    sellerId: techdeals.id, title: 'iPhone 15 Pro 256GB — Pristine Condition',
    description: 'Bought new 3 months ago, upgrading to 15 Pro Max. Phone is in perfect condition, no scratches or marks. Comes with original box, charger, and unused EarPods. Battery health 99%. Face ID working perfectly. Unlocked to all NZ networks.',
    priceNzd: 149900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'electronics', subcategoryName: 'Mobile Phones',
    region: 'Auckland', suburb: 'Newmarket', shippingOption: 'COURIER', shippingNzd: 0,
    shipsNationwide: true, offersEnabled: true, viewCount: 142, watcherCount: 8,
    publishedAt: ago(2 * DAY), expiresAt: future(28 * DAY),
  }, ['https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800',
      'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=800']);

  const macbook = await L({
    sellerId: techdeals.id, title: 'MacBook Pro 14" M3 — Price Reduced!',
    description: 'M3 chip, 16GB RAM, 512GB SSD. Purchased 6 months ago for work, company provided a new one so this is surplus. Excellent condition with minor desk wear on bottom. Comes with MagSafe charger. AppleCare valid until March 2027.',
    priceNzd: 289900, previousPriceNzd: 329900, priceDroppedAt: ago(1 * DAY),
    condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'electronics', subcategoryName: 'Computers',
    region: 'Auckland', suburb: 'Newmarket', shippingOption: 'BOTH', shippingNzd: 0,
    isNegotiable: true, shipsNationwide: true, offersEnabled: true, viewCount: 389, watcherCount: 21,
    publishedAt: ago(7 * DAY), expiresAt: future(23 * DAY),
  }, ['https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=800',
      'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800']);

  const headphones = await L({
    sellerId: techdeals.id, title: 'Sony WH-1000XM5 Noise Cancelling — Barely Used',
    description: 'World-class noise cancellation, 30-hour battery life. Used only a handful of times. Still has protective film on ear cups. Comes with original case, cables and documentation.',
    priceNzd: 34900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'electronics', subcategoryName: 'Audio',
    region: 'Auckland', suburb: 'Newmarket', shippingOption: 'COURIER', shippingNzd: 0,
    shipsNationwide: true, offersEnabled: true, viewCount: 203, watcherCount: 14,
    publishedAt: ago(5 * DAY), expiresAt: future(25 * DAY),
  }, ['https://images.unsplash.com/photo-1585298723682-7115561c51b7?w=800',
      'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800']);

  const gamingpc = await L({
    sellerId: techdeals.id, title: 'Custom Gaming PC — Must Sell, Moving to Australia',
    description: 'RTX 4070, i7-13700K, 32GB DDR5, 1TB NVMe SSD. Built 8 months ago, runs everything at ultra settings. Moving overseas next week. Serious buyers only.',
    priceNzd: 229900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'electronics', subcategoryName: 'Computers',
    region: 'Auckland', suburb: 'Newmarket', shippingOption: 'PICKUP',
    isUrgent: true, isNegotiable: true, offersEnabled: true, viewCount: 511, watcherCount: 33,
    publishedAt: ago(2 * DAY), expiresAt: future(28 * DAY),
  }, ['https://images.unsplash.com/photo-1587202372634-32705e3bf49c?w=800']);

  const ipad = await L({
    sellerId: techdeals.id, title: 'iPad Air 5th Gen 64GB WiFi — Open to Offers',
    description: 'Great condition iPad Air, used mainly for reading and video calls. Screen is perfect with no scratches. Smart Folio case included (worth $120).',
    priceNzd: 64900, condition: 'GOOD', status: 'ACTIVE',
    categoryId: 'electronics', subcategoryName: 'Tablets',
    region: 'Auckland', suburb: 'Newmarket', shippingOption: 'BOTH', shippingNzd: 0,
    isNegotiable: true, shipsNationwide: true, offersEnabled: true, viewCount: 178, watcherCount: 9,
    publishedAt: ago(10 * DAY), expiresAt: future(20 * DAY),
  }, ['https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=800']);

  const tv = await L({
    sellerId: techdeals.id, title: 'Samsung 65" QLED 4K Smart TV — Nationwide Delivery',
    description: 'QN65Q80C, bought 1 year ago. Stunning picture quality with QLED technology. Selling as upgrading to 85". All original remotes and stand included.',
    priceNzd: 189900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'electronics', subcategoryName: 'TV & Home Theatre',
    region: 'Auckland', suburb: 'Newmarket', shippingOption: 'BOTH', shippingNzd: 15000,
    shipsNationwide: true, viewCount: 267, watcherCount: 17,
    publishedAt: ago(14 * DAY), expiresAt: future(16 * DAY),
  }, ['https://images.unsplash.com/photo-1593359677879-a4bb92f4834c?w=800']);

  // SOLD listings (for completed orders)
  const airpods = await L({
    sellerId: techdeals.id, title: 'AirPods Pro 2nd Gen — Excellent Condition',
    description: 'Purchased 4 months ago. ANC and Transparency mode working perfectly. Original box included.',
    priceNzd: 28900, condition: 'LIKE_NEW', status: 'SOLD',
    categoryId: 'electronics', subcategoryName: 'Audio',
    region: 'Auckland', suburb: 'Newmarket', shippingOption: 'COURIER', shippingNzd: 0,
    shipsNationwide: true, offersEnabled: true, viewCount: 94, watcherCount: 4,
    publishedAt: ago(14 * DAY), soldAt: ago(3 * DAY),
  }, ['https://images.unsplash.com/photo-1603351154351-5e2d0600bb77?w=800']);

  const drone = await L({
    sellerId: techdeals.id, title: 'DJI Mini 4 Pro — Fly More Combo',
    description: 'Under 249g, no licence needed in NZ. 4K/60fps video, 48MP photos. Only 3 flights, immaculate. 3 batteries, charging hub, carrying bag.',
    priceNzd: 149900, condition: 'LIKE_NEW', status: 'SOLD',
    categoryId: 'electronics', subcategoryName: 'Cameras & Drones',
    region: 'Auckland', suburb: 'Newmarket', shippingOption: 'COURIER', shippingNzd: 0,
    shipsNationwide: true, viewCount: 312, watcherCount: 22,
    publishedAt: ago(21 * DAY), soldAt: ago(10 * DAY),
  }, ['https://images.unsplash.com/photo-1508614589041-895b88991e3e?w=800']);

  // ── HOME & GARDEN (6 listings) ────────────────────────────────────────────

  const sofa = await L({
    sellerId: homestyle.id, title: 'Danish Design 3-Seater Sofa — Excellent Condition',
    description: 'Beautiful mid-century modern sofa in oatmeal fabric. Bought from Freedom Furniture 18 months ago for $2,800. Moving house. No stains, pets or smoke. 220cm W x 90cm D.',
    priceNzd: 119900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'home-garden', subcategoryName: 'Furniture',
    region: 'Wellington', suburb: 'Kelburn', shippingOption: 'PICKUP',
    isNegotiable: true, offersEnabled: true, viewCount: 156, watcherCount: 12,
    publishedAt: ago(8 * DAY), expiresAt: future(22 * DAY),
  }, ['https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800']);

  const mixer = await L({
    sellerId: homestyle.id, title: 'KitchenAid Artisan Stand Mixer — Empire Red',
    description: 'Received as a wedding gift, already had one so barely used. 4.8L bowl, 10 speeds. All original attachments. RRP $999.',
    priceNzd: 59900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'home-garden', subcategoryName: 'Kitchen',
    region: 'Wellington', suburb: 'Kelburn', shippingOption: 'BOTH', shippingNzd: 1500,
    shipsNationwide: true, offersEnabled: true, viewCount: 88, watcherCount: 6,
    publishedAt: ago(12 * DAY), expiresAt: future(18 * DAY),
  }, ['https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800']);

  const vacuum = await L({
    sellerId: homestyle.id, title: 'Dyson V15 Detect — Full Accessory Kit',
    description: 'Dyson V15 with laser dust detection. All attachments, HEPA filtration. 8 months old, battery holds full charge.',
    priceNzd: 59900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'home-garden', subcategoryName: 'Appliances',
    region: 'Wellington', suburb: 'Kelburn', shippingOption: 'COURIER', shippingNzd: 1200,
    shipsNationwide: true, viewCount: 124, watcherCount: 7,
    publishedAt: ago(6 * DAY), expiresAt: future(24 * DAY),
  }, ['https://images.unsplash.com/photo-1558317374-067fb5f30001?w=800']);

  const bbq = await L({
    sellerId: homestyle.id, title: 'Weber Genesis E-325s Gas BBQ — NZ Compatible',
    description: 'Weber Genesis 3-burner BBQ. GS4 grilling system, iGrill compatible. Used 2 summers, cleaned after each use. Cover included. Wellington pickup.',
    priceNzd: 89900, condition: 'GOOD', status: 'ACTIVE',
    categoryId: 'home-garden', subcategoryName: 'BBQs & Outdoor',
    region: 'Wellington', suburb: 'Kelburn', shippingOption: 'PICKUP',
    isNegotiable: true, offersEnabled: true, viewCount: 97, watcherCount: 5,
    publishedAt: ago(11 * DAY), expiresAt: future(19 * DAY),
  }, ['https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800']);

  const diningset = await L({
    sellerId: homestyle.id, title: '6-Person Outdoor Dining Set — Aluminium Frame',
    description: 'Weather-resistant aluminium table (180x90cm) and 6 chairs. Used one summer season, stored indoors over winter. Cushions in excellent condition.',
    priceNzd: 89900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'home-garden', subcategoryName: 'BBQs & Outdoor',
    region: 'Wellington', suburb: 'Kelburn', shippingOption: 'PICKUP',
    isNegotiable: true, offersEnabled: true, viewCount: 65, watcherCount: 4,
    publishedAt: ago(9 * DAY), expiresAt: future(21 * DAY),
  }, ['https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=800']);

  // SOLD home listing (for order)
  const lamp = await L({
    sellerId: homestyle.id, title: 'Designer Floor Lamp — Tom Dixon Melt',
    description: 'Tom Dixon Melt floor lamp in gold. Statement piece. Purchased from ECC Wellington. Perfect working order.',
    priceNzd: 79900, condition: 'LIKE_NEW', status: 'SOLD',
    categoryId: 'home-garden', subcategoryName: 'Lighting',
    region: 'Wellington', suburb: 'Kelburn', shippingOption: 'BOTH', shippingNzd: 2000,
    shipsNationwide: true, viewCount: 56, watcherCount: 3,
    publishedAt: ago(20 * DAY), soldAt: ago(8 * DAY),
  }, ['https://images.unsplash.com/photo-1507473885765-e6ed057ab6fe?w=800']);

  // ── FASHION (6 listings) ──────────────────────────────────────────────────

  const coat = await L({
    sellerId: fashionhub.id, title: "Trenery Wool Blend Winter Coat — Size 12, Camel",
    description: "Stunning wool blend coat from Trenery, worn only 3 times. Size 12, fits true to size. Dry cleaned. No damage or pilling. Original price $599.",
    priceNzd: 18900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'fashion', subcategoryName: 'Jackets & Coats',
    region: 'Waikato', suburb: 'Hamilton Central', shippingOption: 'COURIER', shippingNzd: 0,
    shipsNationwide: true, viewCount: 73, watcherCount: 3,
    publishedAt: ago(9 * DAY), expiresAt: future(21 * DAY),
  }, ['https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=800']);

  const sneakers = await L({
    sellerId: fashionhub.id, title: 'Nike Air Max 270 — Size 10, Brand New',
    description: 'Bought for a fun run that got cancelled. Worn twice around the block. Size 10 US / 44 EU. Original box. No marks.',
    priceNzd: 10900, previousPriceNzd: 14900, priceDroppedAt: ago(2 * DAY),
    condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'fashion', subcategoryName: 'Shoes',
    region: 'Waikato', suburb: 'Hamilton Central', shippingOption: 'COURIER', shippingNzd: 0,
    shipsNationwide: true, offersEnabled: true, viewCount: 211, watcherCount: 16,
    publishedAt: ago(15 * DAY), expiresAt: future(15 * DAY),
  }, ['https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800']);

  const jordans = await L({
    sellerId: fashionhub.id, title: 'Air Jordan 1 Retro High OG Chicago — Size 10 DS',
    description: 'Deadstock. Never worn. Original box and accessories. StockX authenticated. Impossible to find in NZ.',
    priceNzd: 49900, condition: 'NEW', status: 'ACTIVE',
    categoryId: 'fashion', subcategoryName: 'Shoes',
    region: 'Waikato', suburb: 'Hamilton Central', shippingOption: 'COURIER', shippingNzd: 0,
    shipsNationwide: true, viewCount: 445, watcherCount: 28,
    publishedAt: ago(3 * DAY), expiresAt: future(27 * DAY),
  }, ['https://images.unsplash.com/photo-1597045566677-8cf032ed6634?w=800']);

  const handbag = await L({
    sellerId: fashionhub.id, title: 'Coach Tabby Shoulder Bag — Black Leather',
    description: 'Coach Tabby 26 in black. Signature hardware, adjustable strap. Used twice. Dust bag and care card included. RRP $895.',
    priceNzd: 44900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'fashion', subcategoryName: 'Bags & Accessories',
    region: 'Waikato', suburb: 'Hamilton Central', shippingOption: 'COURIER', shippingNzd: 0,
    shipsNationwide: true, offersEnabled: true, viewCount: 134, watcherCount: 9,
    publishedAt: ago(4 * DAY), expiresAt: future(26 * DAY),
  }, ['https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=800']);

  const watch = await L({
    sellerId: fashionhub.id, title: 'Seiko Presage SRPD37J1 — Japanese Automatic',
    description: 'Seiko Presage cocktail time. 40.5mm case, sapphire crystal, 4R35 movement. Worn 5 times. Box, papers, warranty card.',
    priceNzd: 59900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'fashion', subcategoryName: 'Jewellery',
    region: 'Waikato', suburb: 'Hamilton Central', shippingOption: 'COURIER', shippingNzd: 0,
    shipsNationwide: true, viewCount: 189, watcherCount: 11,
    publishedAt: ago(6 * DAY), expiresAt: future(24 * DAY),
  }, ['https://images.unsplash.com/photo-1524592094714-0f0654e20314?w=800']);

  // SOLD fashion listing
  const jacket = await L({
    sellerId: fashionhub.id, title: 'North Face Thermoball Eco Jacket — Size L',
    description: 'Recycled ThermoBall insulation. Lightweight, packable, warm. Worn one winter. Like new.',
    priceNzd: 17900, condition: 'LIKE_NEW', status: 'SOLD',
    categoryId: 'fashion', subcategoryName: 'Jackets & Coats',
    region: 'Waikato', suburb: 'Hamilton Central', shippingOption: 'COURIER', shippingNzd: 0,
    shipsNationwide: true, viewCount: 87, watcherCount: 5,
    publishedAt: ago(18 * DAY), soldAt: ago(7 * DAY),
  }, ['https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800']);

  // ── SPORTS & OUTDOORS (6 listings) ────────────────────────────────────────

  const mtb = await L({
    sellerId: outdoorgear.id, title: 'Trek Marlin 7 Mountain Bike 2023 — Medium',
    description: '29" wheels, 1x12 drivetrain, hydraulic disc brakes. Ridden about 15 times. Serviced 2 months ago. Minor trail marks but mechanically perfect.',
    priceNzd: 139900, condition: 'GOOD', status: 'ACTIVE',
    categoryId: 'sports', subcategoryName: 'Cycling',
    region: 'Canterbury', suburb: 'Christchurch City', shippingOption: 'PICKUP',
    isNegotiable: true, offersEnabled: true, viewCount: 302, watcherCount: 19,
    publishedAt: ago(4 * DAY), expiresAt: future(26 * DAY),
  }, ['https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800']);

  const tent = await L({
    sellerId: outdoorgear.id, title: 'MSR Hubba Hubba 2-Person Tent — Moving Sale',
    description: 'Ultralight 2-person backpacking tent, 1.27kg. Used on 4 overnight trips. All pegs, poles and stuff sacks included. Retail $899.',
    priceNzd: 44900, condition: 'GOOD', status: 'ACTIVE',
    categoryId: 'sports', subcategoryName: 'Camping & Hiking',
    region: 'Canterbury', suburb: 'Christchurch City', shippingOption: 'BOTH', shippingNzd: 1500,
    isUrgent: true, isNegotiable: true, shipsNationwide: true,
    offersEnabled: true, viewCount: 188, watcherCount: 11,
    publishedAt: ago(1 * DAY), expiresAt: future(29 * DAY),
  }, ['https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=800']);

  const homegym = await L({
    sellerId: outdoorgear.id, title: 'Home Gym Bundle — Dumbbells, Bench and Bands',
    description: 'Adjustable dumbbell set (5-32.5kg each), padded weight bench, 5 resistance bands. All high quality, well maintained.',
    priceNzd: 69900, condition: 'GOOD', status: 'ACTIVE',
    categoryId: 'sports', subcategoryName: 'Running & Fitness',
    region: 'Canterbury', suburb: 'Christchurch City', shippingOption: 'PICKUP',
    isNegotiable: true, offersEnabled: true, viewCount: 143, watcherCount: 8,
    publishedAt: ago(13 * DAY), expiresAt: future(17 * DAY),
  }, ['https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800']);

  const kayak = await L({
    sellerId: outdoorgear.id, title: 'Perception Pescador 12 Sit-on-Top Kayak',
    description: 'Stable, versatile kayak for lakes, harbours and calm coastal waters. UV-resistant hull. Includes Werner paddle (worth $250). Christchurch pickup.',
    priceNzd: 119900, condition: 'GOOD', status: 'ACTIVE',
    categoryId: 'sports', subcategoryName: 'Water Sports',
    region: 'Canterbury', suburb: 'Christchurch City', shippingOption: 'PICKUP',
    isNegotiable: true, offersEnabled: true, viewCount: 91, watcherCount: 6,
    publishedAt: ago(16 * DAY), expiresAt: future(14 * DAY),
  }, ['https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800']);

  const skipack = await L({
    sellerId: outdoorgear.id, title: 'Complete Ski Package — Skis, Boots, Poles, Bag',
    description: '170cm Rossignol Experience 78 skis with Marker bindings, Salomon boots (size 27.5), poles and wheeled ski bag. Used 2 seasons.',
    priceNzd: 89900, condition: 'GOOD', status: 'ACTIVE',
    categoryId: 'sports', subcategoryName: 'Snow Sports',
    region: 'Canterbury', suburb: 'Christchurch City', shippingOption: 'COURIER', shippingNzd: 2500,
    shipsNationwide: true, offersEnabled: true, viewCount: 45, watcherCount: 2,
    publishedAt: ago(1 * DAY), expiresAt: future(29 * DAY),
  }, ['https://images.unsplash.com/photo-1548638618-1da1abb19fb0?w=800']);

  // SOLD outdoor listing (for disputed order)
  const backpack = await L({
    sellerId: outdoorgear.id, title: 'Macpac Cascade 65L Tramping Pack',
    description: 'Macpac Cascade 65L in forest green. Used on 4 multi-day trips. Adjustable harness, hipbelt pockets. Perfect for Routeburn track.',
    priceNzd: 18900, condition: 'GOOD', status: 'SOLD',
    categoryId: 'sports', subcategoryName: 'Camping & Hiking',
    region: 'Canterbury', suburb: 'Christchurch City', shippingOption: 'COURIER', shippingNzd: 1500,
    shipsNationwide: true, viewCount: 67, watcherCount: 3,
    publishedAt: ago(25 * DAY), soldAt: ago(12 * DAY),
  }, ['https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800']);

  // ── TOOLS & EQUIPMENT (4 listings) ────────────────────────────────────────

  const drill = await L({
    sellerId: outdoorgear.id, title: 'DeWalt 18V XR Brushless Drill Kit — 2 Batteries',
    description: 'DCD796 drill and DCF887 impact driver combo. 2x 5Ah batteries and dual charger. Used for one renovation project. Full TSTAK case.',
    priceNzd: 47900, condition: 'LIKE_NEW', status: 'ACTIVE',
    categoryId: 'business', subcategoryName: 'Power Tools',
    region: 'Canterbury', suburb: 'Christchurch City', shippingOption: 'COURIER', shippingNzd: 1500,
    shipsNationwide: true, viewCount: 67, watcherCount: 4,
    publishedAt: ago(3 * DAY), expiresAt: future(27 * DAY),
  }, ['https://images.unsplash.com/photo-1581783898377-1c85bf937427?w=800']);

  await L({
    sellerId: outdoorgear.id, title: 'Bosch 12V Professional Hand Tool Set',
    description: 'Bosch Professional 12V system. Drill, impact driver, circular saw. 3 batteries, charger, bag. Compact and powerful.',
    priceNzd: 39900, condition: 'GOOD', status: 'ACTIVE',
    categoryId: 'business', subcategoryName: 'Hand Tools',
    region: 'Canterbury', suburb: 'Christchurch City', shippingOption: 'BOTH', shippingNzd: 1000,
    shipsNationwide: true, offersEnabled: true, viewCount: 34, watcherCount: 2,
    publishedAt: ago(5 * DAY), expiresAt: future(25 * DAY),
  }, ['https://images.unsplash.com/photo-1572981779307-38b8cabb2407?w=800']);

  await L({
    sellerId: homestyle.id, title: 'Herman Miller Aeron Chair — Size B, Graphite',
    description: 'The iconic office chair. PostureFit SL, fully adjustable arms, tilt limiter. 2 years old, perfect condition. RRP $2,400+.',
    priceNzd: 129900, condition: 'GOOD', status: 'ACTIVE',
    categoryId: 'business', subcategoryName: 'Office Furniture',
    region: 'Wellington', suburb: 'Kelburn', shippingOption: 'PICKUP',
    offersEnabled: true, viewCount: 201, watcherCount: 15,
    publishedAt: ago(7 * DAY), expiresAt: future(23 * DAY),
  }, ['https://images.unsplash.com/photo-1580480055273-228ff5388ef8?w=800']);

  // ── VEHICLES (3 listings) ─────────────────────────────────────────────────

  await L({
    sellerId: techdeals.id, title: '2019 Toyota Corolla GX Hatch — Low Km, One Owner',
    description: 'Reliable daily driver. 52,000km, full Toyota service history. WOF until Nov 2026. Reversing camera, Bluetooth, Apple CarPlay.',
    priceNzd: 2399900, condition: 'GOOD', status: 'ACTIVE',
    categoryId: 'vehicles', subcategoryName: 'Cars',
    region: 'Auckland', suburb: 'Newmarket', shippingOption: 'PICKUP',
    isNegotiable: true, offersEnabled: true, viewCount: 523, watcherCount: 31,
    publishedAt: ago(5 * DAY), expiresAt: future(25 * DAY),
  }, ['https://images.unsplash.com/photo-1590362891991-f776e747a588?w=800']);

  await L({
    sellerId: outdoorgear.id, title: 'Suzuki DR650 Adventure Motorcycle — 2020',
    description: '15,000km, excellent condition. Bark busters, aftermarket exhaust, rally windscreen. Ready for adventure touring.',
    priceNzd: 899900, condition: 'GOOD', status: 'ACTIVE',
    categoryId: 'vehicles', subcategoryName: 'Motorcycles',
    region: 'Canterbury', suburb: 'Christchurch City', shippingOption: 'PICKUP',
    isNegotiable: true, offersEnabled: true, viewCount: 187, watcherCount: 12,
    publishedAt: ago(3 * DAY), expiresAt: future(27 * DAY),
  }, ['https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=800']);

  // ── BABY & KIDS (3 listings) ──────────────────────────────────────────────

  await L({
    sellerId: homestyle.id, title: 'Bugaboo Fox 3 Pram — Midnight Black',
    description: 'Bugaboo Fox 3 complete. Bassinet, seat, rain cover, mosquito net. Used for 8 months. Excellent condition. RRP $2,200.',
    priceNzd: 109900, condition: 'GOOD', status: 'ACTIVE',
    categoryId: 'baby-kids', subcategoryName: 'Baby Gear',
    region: 'Wellington', suburb: 'Kelburn', shippingOption: 'PICKUP',
    isNegotiable: true, offersEnabled: true, viewCount: 145, watcherCount: 8,
    publishedAt: ago(6 * DAY), expiresAt: future(24 * DAY),
  }, ['https://images.unsplash.com/photo-1586368553683-3c7e1e0def8b?w=800']);

  await L({
    sellerId: fashionhub.id, title: 'LEGO Technic Porsche 911 GT3 RS — Sealed',
    description: 'LEGO set 42056. Factory sealed, never opened. Discontinued set, collector item. Perfect gift.',
    priceNzd: 69900, condition: 'NEW', status: 'ACTIVE',
    categoryId: 'baby-kids', subcategoryName: 'Toys & Games',
    region: 'Waikato', suburb: 'Hamilton Central', shippingOption: 'COURIER', shippingNzd: 0,
    shipsNationwide: true, viewCount: 234, watcherCount: 18,
    publishedAt: ago(2 * DAY), expiresAt: future(28 * DAY),
  }, ['https://images.unsplash.com/photo-1587654780291-39c9404d7dd0?w=800']);

  // ── COLLECTIBLES (3 listings) ─────────────────────────────────────────────

  await L({
    sellerId: fashionhub.id, title: 'Signed All Blacks Jersey — 2023 World Cup Squad',
    description: 'Framed All Blacks jersey signed by the 2023 Rugby World Cup squad. Certificate of authenticity from NZRU. Perfect condition.',
    priceNzd: 149900, condition: 'NEW', status: 'ACTIVE',
    categoryId: 'collectibles', subcategoryName: 'Sports Memorabilia',
    region: 'Waikato', suburb: 'Hamilton Central', shippingOption: 'COURIER', shippingNzd: 3000,
    shipsNationwide: true, viewCount: 312, watcherCount: 24,
    publishedAt: ago(10 * DAY), expiresAt: future(20 * DAY),
  }, ['https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800']);

  await L({
    sellerId: homestyle.id, title: 'Original NZ Landscape Oil Painting — Milford Sound',
    description: 'Original oil on canvas by Wellington artist. 90cm x 60cm, framed. Beautiful representation of Milford Sound at dawn.',
    priceNzd: 89900, condition: 'NEW', status: 'ACTIVE',
    categoryId: 'collectibles', subcategoryName: 'Art',
    region: 'Wellington', suburb: 'Kelburn', shippingOption: 'PICKUP',
    offersEnabled: true, viewCount: 78, watcherCount: 5,
    publishedAt: ago(12 * DAY), expiresAt: future(18 * DAY),
  }, ['https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=800']);

  // ── PROPERTY (2 listings) ─────────────────────────────────────────────────

  await L({
    sellerId: homestyle.id, title: 'Room Available — Kelburn Flat, 5 Min to Vic Uni',
    description: '1 room in a 3-bedroom flat. Sunny, warm, insulated. $250/week incl. water and internet. Available from April 1.',
    priceNzd: 25000, condition: 'GOOD', status: 'ACTIVE',
    categoryId: 'property', subcategoryName: 'Flatmates',
    region: 'Wellington', suburb: 'Kelburn', shippingOption: 'PICKUP',
    viewCount: 345, watcherCount: 22,
    publishedAt: ago(2 * DAY), expiresAt: future(28 * DAY),
  }, ['https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800']);

  const listingCount = await db.listing.count();
  console.log(`✅ ${listingCount} listings created`);

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 6: ORDERS (11 total)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n📦 Creating orders...');

  // ── 4 Completed orders ────────────────────────────────────────────────────

  const order1 = await db.order.create({ data: {
    buyerId: alice.id, sellerId: techdeals.id, listingId: airpods,
    itemNzd: 28900, shippingNzd: 0, totalNzd: 28900, status: 'COMPLETED',
    stripePaymentIntentId: 'pi_test_seed_001', stripeTransferId: 'tr_test_seed_001',
    shippingName: 'Alice M', shippingLine1: '42 Ponsonby Road', shippingCity: 'Auckland',
    shippingRegion: 'Auckland', shippingPostcode: '1011',
    dispatchedAt: ago(5 * DAY), deliveredAt: ago(4 * DAY), completedAt: ago(3 * DAY),
    createdAt: ago(7 * DAY),
  }});

  const order2 = await db.order.create({ data: {
    buyerId: ben.id, sellerId: techdeals.id, listingId: drone,
    itemNzd: 149900, shippingNzd: 0, totalNzd: 149900, status: 'COMPLETED',
    stripePaymentIntentId: 'pi_test_seed_002', stripeTransferId: 'tr_test_seed_002',
    shippingName: 'Ben T', shippingLine1: '15 Cuba Street', shippingCity: 'Wellington',
    shippingRegion: 'Wellington', shippingPostcode: '6011',
    dispatchedAt: ago(12 * DAY), deliveredAt: ago(11 * DAY), completedAt: ago(10 * DAY),
    createdAt: ago(14 * DAY),
  }});

  const order3 = await db.order.create({ data: {
    buyerId: carol.id, sellerId: homestyle.id, listingId: lamp,
    itemNzd: 79900, shippingNzd: 2000, totalNzd: 81900, status: 'COMPLETED',
    stripePaymentIntentId: 'pi_test_seed_003', stripeTransferId: 'tr_test_seed_003',
    shippingName: 'Carol W', shippingLine1: '8 Riccarton Road', shippingCity: 'Christchurch',
    shippingRegion: 'Canterbury', shippingPostcode: '8041',
    dispatchedAt: ago(10 * DAY), deliveredAt: ago(9 * DAY), completedAt: ago(8 * DAY),
    createdAt: ago(12 * DAY),
  }});

  const order4 = await db.order.create({ data: {
    buyerId: alice.id, sellerId: fashionhub.id, listingId: jacket,
    itemNzd: 17900, shippingNzd: 0, totalNzd: 17900, status: 'COMPLETED',
    stripePaymentIntentId: 'pi_test_seed_004', stripeTransferId: 'tr_test_seed_004',
    shippingName: 'Alice M', shippingLine1: '42 Ponsonby Road', shippingCity: 'Auckland',
    shippingRegion: 'Auckland', shippingPostcode: '1011',
    dispatchedAt: ago(9 * DAY), deliveredAt: ago(8 * DAY), completedAt: ago(7 * DAY),
    createdAt: ago(11 * DAY),
  }});

  // ── 2 Disputed orders ─────────────────────────────────────────────────────

  const order5 = await db.order.create({ data: {
    buyerId: ben.id, sellerId: outdoorgear.id, listingId: backpack,
    itemNzd: 18900, shippingNzd: 1500, totalNzd: 20400, status: 'DISPUTED',
    stripePaymentIntentId: 'pi_test_seed_005',
    shippingName: 'Ben T', shippingLine1: '15 Cuba Street', shippingCity: 'Wellington',
    shippingRegion: 'Wellington', shippingPostcode: '6011',
    dispatchedAt: ago(14 * DAY), deliveredAt: ago(13 * DAY),
    disputeReason: 'ITEM_NOT_AS_DESCRIBED', disputeOpenedAt: ago(12 * DAY),
    disputeNotes: 'Multiple tears on the shoulder straps that were not mentioned in the listing. The hip belt buckle is also broken.',
    createdAt: ago(16 * DAY),
  }});

  const order6 = await db.order.create({ data: {
    buyerId: carol.id, sellerId: techdeals.id, listingId: airpods, // reuse listing for variety
    itemNzd: 28900, shippingNzd: 0, totalNzd: 28900, status: 'DISPUTED',
    stripePaymentIntentId: 'pi_test_seed_006',
    shippingName: 'Carol W', shippingLine1: '8 Riccarton Road', shippingCity: 'Christchurch',
    shippingRegion: 'Canterbury', shippingPostcode: '8041',
    dispatchedAt: ago(6 * DAY),
    disputeReason: 'ITEM_NOT_RECEIVED', disputeOpenedAt: ago(2 * DAY),
    disputeNotes: 'Tracking shows delivered but I never received the package. My building has secure mailboxes.',
    createdAt: ago(8 * DAY),
  }});

  // ── 2 Dispatched orders (awaiting delivery confirmation) ──────────────────

  await db.order.create({ data: {
    buyerId: alice.id, sellerId: homestyle.id, listingId: mixer,
    itemNzd: 59900, shippingNzd: 1500, totalNzd: 61400, status: 'DISPATCHED',
    stripePaymentIntentId: 'pi_test_seed_007',
    shippingName: 'Alice M', shippingLine1: '42 Ponsonby Road', shippingCity: 'Auckland',
    shippingRegion: 'Auckland', shippingPostcode: '1011',
    trackingNumber: 'NZ123456789', trackingUrl: 'https://www.nzpost.co.nz/track',
    dispatchedAt: ago(2 * DAY),
    createdAt: ago(4 * DAY),
  }});

  await db.order.create({ data: {
    buyerId: ben.id, sellerId: fashionhub.id, listingId: sneakers,
    itemNzd: 10900, shippingNzd: 0, totalNzd: 10900, status: 'DISPATCHED',
    stripePaymentIntentId: 'pi_test_seed_008',
    shippingName: 'Ben T', shippingLine1: '15 Cuba Street', shippingCity: 'Wellington',
    shippingRegion: 'Wellington', shippingPostcode: '6011',
    trackingNumber: 'NZ987654321',
    dispatchedAt: ago(1 * DAY),
    createdAt: ago(3 * DAY),
  }});

  // ── 2 Payment held (seller needs to dispatch) ─────────────────────────────

  await db.order.create({ data: {
    buyerId: carol.id, sellerId: outdoorgear.id, listingId: drill,
    itemNzd: 47900, shippingNzd: 1500, totalNzd: 49400, status: 'PAYMENT_HELD',
    stripePaymentIntentId: 'pi_test_seed_009',
    shippingName: 'Carol W', shippingLine1: '8 Riccarton Road', shippingCity: 'Christchurch',
    shippingRegion: 'Canterbury', shippingPostcode: '8041',
    createdAt: ago(1 * DAY),
  }});

  await db.order.create({ data: {
    buyerId: alice.id, sellerId: fashionhub.id, listingId: handbag,
    itemNzd: 44900, shippingNzd: 0, totalNzd: 44900, status: 'PAYMENT_HELD',
    stripePaymentIntentId: 'pi_test_seed_010',
    shippingName: 'Alice M', shippingLine1: '42 Ponsonby Road', shippingCity: 'Auckland',
    shippingRegion: 'Auckland', shippingPostcode: '1011',
    createdAt: ago(12 * HOUR),
  }});

  // ── 1 Awaiting payment ────────────────────────────────────────────────────

  await db.order.create({ data: {
    buyerId: ben.id, sellerId: homestyle.id, listingId: vacuum,
    itemNzd: 59900, shippingNzd: 1200, totalNzd: 61100, status: 'AWAITING_PAYMENT',
    stripePaymentIntentId: 'pi_test_seed_011',
    shippingName: 'Ben T', shippingLine1: '15 Cuba Street', shippingCity: 'Wellington',
    shippingRegion: 'Wellington', shippingPostcode: '6011',
    createdAt: ago(2 * HOUR),
  }});

  console.log('✅ 11 orders created (4 completed, 2 disputed, 2 dispatched, 2 payment held, 1 awaiting)');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 7: REVIEWS (on completed orders)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n⭐ Creating reviews...');

  await db.review.create({ data: {
    orderId: order1.id, sellerId: techdeals.id, authorId: alice.id,
    rating: 50, comment: 'Fast shipping, item exactly as described. Great seller, would buy again!',
    approved: true, createdAt: ago(2 * DAY),
  }});

  await db.review.create({ data: {
    orderId: order2.id, sellerId: techdeals.id, authorId: ben.id,
    rating: 45, comment: 'Drone is amazing. Well packaged, arrived quickly. Minor scuff on case but drone itself is perfect.',
    sellerReply: 'Thanks Ben! Sorry about the case — happy to send a replacement if you want.',
    sellerRepliedAt: ago(9 * DAY),
    approved: true, createdAt: ago(10 * DAY),
  }});

  await db.review.create({ data: {
    orderId: order3.id, sellerId: homestyle.id, authorId: carol.id,
    rating: 50, comment: 'Stunning lamp! Even more beautiful in person. Carefully packed, arrived safely despite shipping.',
    approved: true, createdAt: ago(7 * DAY),
  }});

  await db.review.create({ data: {
    orderId: order4.id, sellerId: fashionhub.id, authorId: alice.id,
    rating: 40, comment: 'Jacket is warm and good quality. Took a couple extra days to ship but overall happy with the purchase.',
    approved: true, createdAt: ago(6 * DAY),
  }});

  console.log('✅ 4 reviews created');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 8: PAYOUTS (for completed orders)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n💰 Creating payouts...');

  for (const [order, seller, amount] of [
    [order1, techdeals, 28900],
    [order2, techdeals, 149900],
    [order3, homestyle, 81900],
    [order4, fashionhub, 17900],
  ] as const) {
    const fee = Math.round(Number(amount) * 0.019 + 30);
    await db.payout.create({ data: {
      orderId: order.id, userId: seller.id,
      amountNzd: Number(amount) - fee, platformFeeNzd: 0, stripeFeeNzd: fee,
      status: 'PAID', stripeTransferId: `tr_payout_${order.id.slice(-6)}`,
      initiatedAt: ago(3 * DAY), paidAt: ago(2 * DAY), createdAt: ago(3 * DAY),
    }});
  }

  console.log('✅ 4 payouts created');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 9: OFFERS
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n🤝 Creating offers...');

  // Pending offer
  await db.offer.create({ data: {
    listingId: macbook, buyerId: alice.id, sellerId: techdeals.id,
    amountNzd: 260000, note: 'Would you take $2,600? Can pick up today from Newmarket.',
    status: 'PENDING', expiresAt: future(2 * DAY), createdAt: ago(3 * HOUR),
  }});

  // Accepted offer
  await db.offer.create({ data: {
    listingId: sofa, buyerId: carol.id, sellerId: homestyle.id,
    amountNzd: 100000, note: 'Would you accept $1,000? Can pick up this weekend.',
    status: 'ACCEPTED', expiresAt: ago(1 * DAY),
    respondedAt: ago(2 * DAY), paymentDeadline: future(1 * DAY),
    createdAt: ago(3 * DAY),
  }});

  // Declined offer
  await db.offer.create({ data: {
    listingId: gamingpc, buyerId: ben.id, sellerId: techdeals.id,
    amountNzd: 180000, note: 'How about $1,800?',
    status: 'DECLINED', expiresAt: ago(1 * DAY),
    respondedAt: ago(2 * DAY), declineNote: 'Sorry, lowest I can go is $2,100. It is a premium build.',
    createdAt: ago(3 * DAY),
  }});

  // Expired offer
  await db.offer.create({ data: {
    listingId: tv, buyerId: carol.id, sellerId: techdeals.id,
    amountNzd: 170000,
    status: 'EXPIRED', expiresAt: ago(1 * DAY),
    createdAt: ago(3 * DAY),
  }});

  // Another pending
  await db.offer.create({ data: {
    listingId: mtb, buyerId: alice.id, sellerId: outdoorgear.id,
    amountNzd: 120000, note: 'Would you do $1,200? I can pick up from Chch this weekend.',
    status: 'PENDING', expiresAt: future(2 * DAY), createdAt: ago(5 * HOUR),
  }});

  console.log('✅ 5 offers created (2 pending, 1 accepted, 1 declined, 1 expired)');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 10: MESSAGE THREADS
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n💬 Creating message threads...');

  // Thread 1: Alice asking TechDeals about MacBook
  const [t1p1, t1p2] = [alice.id, techdeals.id].sort();
  const thread1 = await db.messageThread.create({ data: {
    participant1Id: t1p1, participant2Id: t1p2, listingId: macbook,
    lastMessageAt: ago(1 * HOUR), createdAt: ago(4 * HOUR),
  }});
  await db.message.create({ data: {
    threadId: thread1.id, senderId: alice.id,
    body: "Hi, is the MacBook Pro still available? Would you take $2,600 for it?",
    read: true, readAt: ago(3 * HOUR), createdAt: ago(4 * HOUR),
  }});
  await db.message.create({ data: {
    threadId: thread1.id, senderId: techdeals.id,
    body: "Hi Alice! Yes still available. I can do $2,750 — it is in really great condition and still has AppleCare. Happy to video call if you want to see it.",
    read: true, readAt: ago(2 * HOUR), createdAt: ago(3 * HOUR),
  }});
  await db.message.create({ data: {
    threadId: thread1.id, senderId: alice.id,
    body: "That works for me. I have sent an offer through the system. Can I pick up from Newmarket this afternoon?",
    read: false, createdAt: ago(1 * HOUR),
  }});

  // Thread 2: Ben and OutdoorGear about dispute
  const [t2p1, t2p2] = [ben.id, outdoorgear.id].sort();
  const thread2 = await db.messageThread.create({ data: {
    participant1Id: t2p1, participant2Id: t2p2, listingId: backpack,
    lastMessageAt: ago(6 * HOUR), createdAt: ago(13 * DAY),
  }});
  await db.message.create({ data: {
    threadId: thread2.id, senderId: ben.id,
    body: "Hi, the backpack arrived but the shoulder straps have tears that weren't mentioned in the listing. The hip belt buckle is also broken.",
    read: true, readAt: ago(12 * DAY), createdAt: ago(13 * DAY),
  }});
  await db.message.create({ data: {
    threadId: thread2.id, senderId: outdoorgear.id,
    body: "Sorry to hear that. The straps were fine when I shipped it. Could you send photos? Happy to work something out.",
    read: true, readAt: ago(12 * DAY), createdAt: ago(12 * DAY),
  }});
  await db.message.create({ data: {
    threadId: thread2.id, senderId: ben.id,
    body: "I have opened a dispute through the platform. The damage clearly predates shipping — the tears are worn, not fresh.",
    read: true, readAt: ago(11 * DAY), createdAt: ago(12 * DAY),
  }});

  // Thread 3: Carol and HomeStyle about sofa
  const [t3p1, t3p2] = [carol.id, homestyle.id].sort();
  const thread3 = await db.messageThread.create({ data: {
    participant1Id: t3p1, participant2Id: t3p2, listingId: sofa,
    lastMessageAt: ago(2 * DAY), createdAt: ago(5 * DAY),
  }});
  await db.message.create({ data: {
    threadId: thread3.id, senderId: carol.id,
    body: "Hi! Love the sofa. Is there any pet hair or smoke smell? I am quite sensitive to both.",
    read: true, readAt: ago(4 * DAY), createdAt: ago(5 * DAY),
  }});
  await db.message.create({ data: {
    threadId: thread3.id, senderId: homestyle.id,
    body: "Hi Carol, no pets and no smokers in the house. The sofa has been professionally cleaned. Happy to arrange a viewing if you like.",
    read: true, readAt: ago(3 * DAY), createdAt: ago(4 * DAY),
  }});
  await db.message.create({ data: {
    threadId: thread3.id, senderId: carol.id,
    body: "Perfect! I have made an offer for $1,000. If accepted I can come collect this Saturday.",
    read: true, readAt: ago(2 * DAY), createdAt: ago(3 * DAY),
  }});

  console.log('✅ 3 message threads, 9 messages created');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 11: WATCHLIST
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n👁️  Creating watchlist entries...');

  const watchEntries = [
    { userId: alice.id, listingId: macbook },
    { userId: alice.id, listingId: gamingpc },
    { userId: alice.id, listingId: mtb },
    { userId: alice.id, listingId: jordans },
    { userId: ben.id, listingId: headphones },
    { userId: ben.id, listingId: sofa },
    { userId: ben.id, listingId: tent },
    { userId: carol.id, listingId: iphone },
    { userId: carol.id, listingId: watch },
    { userId: carol.id, listingId: kayak },
    { userId: carol.id, listingId: handbag },
  ];
  await db.watchlistItem.createMany({ data: watchEntries });
  console.log(`✅ ${watchEntries.length} watchlist entries created`);

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 12: REPORTS
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n🚩 Creating reports...');

  await db.report.create({ data: {
    reporterId: alice.id, targetUserId: outdoorgear.id, listingId: backpack,
    reason: 'SCAM', description: 'Seller listed the backpack as "good condition" but it arrived with significant damage to the shoulder straps and a broken buckle. Photos in dispute.',
    status: 'OPEN', createdAt: ago(12 * DAY),
  }});

  await db.report.create({ data: {
    reporterId: ben.id, listingId: jordans,
    reason: 'COUNTERFEIT', description: 'These Jordans look suspicious. The stitching pattern does not match authentic pairs and the box label font is wrong. Might be replicas.',
    status: 'REVIEWING', createdAt: ago(5 * DAY),
  }});

  await db.report.create({ data: {
    reporterId: carol.id, targetUserId: fashionhub.id,
    reason: 'SPAM', description: 'This seller has listed the same jacket in 3 different categories with slightly different titles. Seems like spam to boost visibility.',
    status: 'DISMISSED', resolvedAt: ago(2 * DAY), resolvedNote: 'Seller has been warned about duplicate listings. No further action needed.',
    createdAt: ago(7 * DAY),
  }});

  console.log('✅ 3 reports created (1 open, 1 reviewing, 1 dismissed)');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 13: NOTIFICATIONS
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n🔔 Creating notifications...');

  const notifications = [
    // Alice
    { userId: alice.id, type: 'ORDER_PLACED', title: 'Order confirmed', body: 'Your order for AirPods Pro 2nd Gen has been confirmed.', link: '/dashboard/buyer', orderId: order1.id },
    { userId: alice.id, type: 'ORDER_COMPLETED', title: 'Order completed', body: 'Your AirPods Pro order has been completed. Payment released to seller.', link: '/dashboard/buyer', orderId: order1.id, read: true },
    { userId: alice.id, type: 'MESSAGE_RECEIVED', title: 'New message from TechDeals NZ', body: 'Hi Alice! Yes still available. I can do $2,750...', link: '/dashboard/buyer?tab=messages' },
    { userId: alice.id, type: 'OFFER_RECEIVED', title: 'You have a pending offer', body: 'Your offer of $2,600 for MacBook Pro 14" M3 is pending.', link: '/dashboard/buyer', listingId: macbook },
    { userId: alice.id, type: 'PRICE_DROP', title: 'Price dropped 12%!', body: '"MacBook Pro 14" M3" dropped from $3,299 to $2,899', link: `/listings/${macbook}`, listingId: macbook, read: true },
    // Ben
    { userId: ben.id, type: 'ORDER_PLACED', title: 'Order confirmed', body: 'Your order for DJI Mini 4 Pro has been confirmed.', link: '/dashboard/buyer', orderId: order2.id, read: true },
    { userId: ben.id, type: 'OFFER_DECLINED', title: 'Offer declined', body: 'Your offer of $1,800 for Gaming PC was declined.', link: '/dashboard/buyer', listingId: gamingpc, read: true },
    { userId: ben.id, type: 'DISPUTE_OPENED', title: 'Dispute opened', body: 'Your dispute for the Macpac Cascade backpack is being reviewed.', link: '/dashboard/buyer', orderId: order5.id },
    // Carol
    { userId: carol.id, type: 'ORDER_COMPLETED', title: 'Order completed', body: 'Your Designer Floor Lamp order has been completed.', link: '/dashboard/buyer', orderId: order3.id, read: true },
    { userId: carol.id, type: 'OFFER_ACCEPTED', title: 'Offer accepted!', body: 'Your offer of $1,000 for the Danish sofa was accepted!', link: '/dashboard/buyer', listingId: sofa },
    // TechDeals
    { userId: techdeals.id, type: 'OFFER_RECEIVED', title: 'New offer received', body: 'Alice M offered $2,600 for your MacBook Pro 14" M3.', link: '/dashboard/seller', listingId: macbook },
    { userId: techdeals.id, type: 'ORDER_PLACED', title: 'New sale!', body: 'You sold AirPods Pro 2nd Gen for $289.', link: '/dashboard/seller', orderId: order1.id, read: true },
    { userId: techdeals.id, type: 'REVIEW_RECEIVED', title: 'New 5-star review', body: 'Alice M left a 5-star review on your AirPods sale.', link: '/dashboard/seller', read: true },
    // HomeStyle
    { userId: homestyle.id, type: 'ORDER_PLACED', title: 'New sale!', body: 'You sold Designer Floor Lamp for $799.', link: '/dashboard/seller', orderId: order3.id, read: true },
    { userId: homestyle.id, type: 'OFFER_RECEIVED', title: 'New offer received', body: 'Carol W offered $1,000 for your Danish Sofa.', link: '/dashboard/seller', listingId: sofa },
    // OutdoorGear
    { userId: outdoorgear.id, type: 'DISPUTE_OPENED', title: 'Dispute opened on your sale', body: 'Ben T opened a dispute on the Macpac Cascade backpack order.', link: '/dashboard/seller', orderId: order5.id },
    { userId: outdoorgear.id, type: 'OFFER_RECEIVED', title: 'New offer received', body: 'Alice M offered $1,200 for your Trek Marlin 7.', link: '/dashboard/seller', listingId: mtb },
  ];

  for (const n of notifications) {
    await db.notification.create({ data: {
      userId: n.userId, type: n.type, title: n.title, body: n.body,
      link: n.link, listingId: n.listingId, orderId: n.orderId,
      read: n.read ?? false, createdAt: ago(Math.random() * 7 * DAY),
    }});
  }
  console.log(`✅ ${notifications.length} notifications created`);

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 14: AUDIT LOGS
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n📋 Creating audit logs...');

  const auditEntries = [
    { userId: alice.id, action: 'USER_REGISTER' as const, createdAt: ago(45 * DAY) },
    { userId: ben.id, action: 'USER_REGISTER' as const, createdAt: ago(20 * DAY) },
    { userId: carol.id, action: 'USER_REGISTER' as const, createdAt: ago(15 * DAY) },
    { userId: techdeals.id, action: 'SELLER_TERMS_ACCEPTED' as const, createdAt: ago(90 * DAY) },
    { userId: techdeals.id, action: 'ID_VERIFICATION_SUBMITTED' as const, createdAt: ago(65 * DAY) },
    { userId: techdeals.id, action: 'ID_VERIFICATION_APPROVED' as const, createdAt: ago(60 * DAY) },
    { userId: alice.id, action: 'ORDER_CREATED' as const, entityType: 'Order', entityId: order1.id, createdAt: ago(7 * DAY) },
    { userId: ben.id, action: 'DISPUTE_OPENED' as const, entityType: 'Order', entityId: order5.id, createdAt: ago(12 * DAY) },
  ];
  await db.auditLog.createMany({ data: auditEntries });
  console.log(`✅ ${auditEntries.length} audit log entries created`);

  // ── Credentials summary ────────────────────────────────────────────────────
  console.log(`
╔═══════════════════════════════════════════════╗
║          KIWIMART TEST CREDENTIALS            ║
╠═══════════════════════════════════════════════╣
║ BUYERS                                        ║
║  buyer@kiwimart.test  / BuyerPassword123!     ║
║  buyer2@kiwimart.test / BuyerPassword123!     ║
║  buyer3@kiwimart.test / BuyerPassword123!     ║
╠═══════════════════════════════════════════════╣
║ SELLERS                                       ║
║  techdeals@kiwimart.test  / SellerPassword123!║
║  homestyle@kiwimart.test  / SellerPassword123!║
║  outdoorgear@kiwimart.test/ SellerPassword123!║
║  fashionhub@kiwimart.test / SellerPassword123!║
╠═══════════════════════════════════════════════╣
║ ADMIN  (password: AdminPassword123!)          ║
║  admin@kiwimart.test     (SUPER_ADMIN)        ║
║  finance@kiwimart.test   (FINANCE_ADMIN)      ║
║  disputes@kiwimart.test  (DISPUTES_ADMIN)     ║
║  safety@kiwimart.test    (TRUST_SAFETY)       ║
║  support@kiwimart.test   (SUPPORT_ADMIN)      ║
║  sellers@kiwimart.test   (SELLER_MANAGER)     ║
║  readonly@kiwimart.test  (READ_ONLY_ADMIN)    ║
╚═══════════════════════════════════════════════╝
`);
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => db.$disconnect());
