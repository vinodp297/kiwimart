// prisma/seed.ts
// Buyzi — Complete Fresh Seed
// 11 users: 3 buyers, 4 sellers, 4 admins
// All scenarios covered: every order status, disputes with
// evidence, pickup orders, offers, messages, reviews, payouts

if (process.env.NODE_ENV === "production") {
  console.error("ERROR: prisma/seed.ts must not be run in production.");
  process.exit(1);
}

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import { createHash } from "crypto";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const db = new PrismaClient({ adapter });

// ─── Helpers ────────────────────────────────────────────────────────────────

const now = new Date();
const ago = (ms: number) => new Date(now.getTime() - ms);
const future = (ms: number) => new Date(now.getTime() + ms);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function sha256(val: string) {
  return createHash("sha256").update(val).digest("hex");
}

// ─── Listing images ──────────────────────────────────────────────────────────
// Seed data uses Unsplash URLs directly — getImageUrl() returns any value
// starting with "http" as-is, so these render without R2 uploads.
// Returns 2–4 curated URLs per listing matched to category/title.

function pickListingImages(title: string): string[] {
  const t = title.toLowerCase();

  // Electronics — Laptops / MacBook
  if (t.includes("macbook"))
    return [
      "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800",
      "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=800",
      "https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2?w=800",
      "https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=800",
    ];
  if (t.includes("laptop") || t.includes("ipad") || t.includes("tablet"))
    return [
      "https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=800",
      "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=800",
      "https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2?w=800",
    ];

  // Electronics — Phones / iPhone
  if (t.includes("iphone") || t.includes("phone"))
    return [
      "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800",
      "https://images.unsplash.com/photo-1585792180666-f7347c490ee2?w=800",
    ];

  // Electronics — Cameras
  if (t.includes("camera") || t.includes("canon") || t.includes("eos"))
    return [
      "https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=800",
      "https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=800",
    ];

  // Electronics — Headphones / Audio / Speaker
  if (
    t.includes("headphone") ||
    t.includes("wh-1000") ||
    t.includes("speaker") ||
    t.includes("sonos")
  )
    return [
      "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800",
      "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=800",
    ];

  // Electronics — Watches (Apple Watch, Rolex)
  if (t.includes("watch") || t.includes("rolex") || t.includes("submariner"))
    return [
      "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800",
      "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800",
    ];

  // Electronics — TV / Samsung (generic electronics)
  if (t.includes("tv") || t.includes("television") || t.includes("samsung"))
    return [
      "https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=800",
      "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=800",
    ];

  // Furniture — Dining Table / Oak
  if (
    t.includes("dining table") ||
    t.includes("oak table") ||
    t.includes("oak dining")
  )
    return [
      "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800",
      "https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?w=800",
      "https://images.unsplash.com/photo-1506439773649-6e0eb8cfb237?w=800",
    ];

  // Furniture — Chair / Sofa / Armchair
  if (
    t.includes("chair") ||
    t.includes("sofa") ||
    t.includes("armchair") ||
    t.includes("couch")
  )
    return [
      "https://images.unsplash.com/photo-1538688525198-9b88f6f53126?w=800",
      "https://images.unsplash.com/photo-1506439773649-6e0eb8cfb237?w=800",
      "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800",
    ];

  // Furniture — Desk
  if (t.includes("desk"))
    return [
      "https://images.unsplash.com/photo-1533090481720-856c6e3c1fdc?w=800",
      "https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?w=800",
    ];

  // Furniture — Bed / Bedroom
  if (t.includes("bed") || t.includes("bedroom") || t.includes("mattress"))
    return [
      "https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=800",
      "https://images.unsplash.com/photo-1588046130717-0eb0c9a3ba15?w=800",
    ];

  // Fashion — Jacket / Coat / Down Jacket
  if (
    t.includes("jacket") ||
    t.includes("coat") ||
    t.includes("down jacket") ||
    t.includes("kathmandu")
  )
    return [
      "https://images.unsplash.com/photo-1584735175315-9d5df23be620?w=800",
      "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=800",
    ];

  // Fashion — Sneakers / Shoes
  if (t.includes("sneaker") || t.includes("shoe") || t.includes("boot"))
    return [
      "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800",
      "https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=800",
    ];

  // Fashion — Bag / Handbag
  if (t.includes("bag") || t.includes("handbag") || t.includes("tote"))
    return [
      "https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=800",
      "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=800",
    ];

  // Fashion — Clothes (generic)
  if (t.includes("cloth") || t.includes("wear") || t.includes("dress"))
    return [
      "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=800",
      "https://images.unsplash.com/photo-1584735175315-9d5df23be620?w=800",
    ];

  // Vehicles — Car
  if (
    t.includes("car") ||
    t.includes("vehicle") ||
    t.includes("sedan") ||
    t.includes("suv")
  )
    return [
      "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=800",
      "https://images.unsplash.com/photo-1502877338535-766e1452684a?w=800",
      "https://images.unsplash.com/photo-1511919884226-fd3cad34687c?w=800",
    ];

  // Vehicles — Motorbike
  if (
    t.includes("motorbike") ||
    t.includes("motorcycle") ||
    t.includes("scooter")
  )
    return [
      "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800",
      "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=800",
    ];

  // Sports — Bikes / Cycling
  if (
    t.includes("road bike") ||
    t.includes("giant defy") ||
    t.includes("bicycle") ||
    (t.includes("bike") && !t.includes("motorbike"))
  )
    return [
      "https://images.unsplash.com/photo-1517649763962-0c623066013b?w=800",
      "https://images.unsplash.com/photo-1449426468159-d96dbf08f19f?w=800",
    ];

  // Sports — Kayak / Water
  if (t.includes("kayak") || t.includes("canoe") || t.includes("paddle"))
    return [
      "https://images.unsplash.com/photo-1517649763962-0c623066013b?w=800",
      "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800",
    ];

  // Sports — Tent / Camping
  if (t.includes("tent") || t.includes("msr") || t.includes("camping"))
    return [
      "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800",
      "https://images.unsplash.com/photo-1593341646782-e0b495cff86d?w=800",
    ];

  // Sports — Fitness / Gym / Weights
  if (
    t.includes("weights") ||
    t.includes("dumbbell") ||
    t.includes("gym") ||
    t.includes("barbell")
  )
    return [
      "https://images.unsplash.com/photo-1526506118085-60ce8714f8c5?w=800",
      "https://images.unsplash.com/photo-1593341646782-e0b495cff86d?w=800",
    ];

  // Sports — Yoga
  if (t.includes("yoga") || t.includes("pilates"))
    return [
      "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800",
      "https://images.unsplash.com/photo-1593341646782-e0b495cff86d?w=800",
    ];

  // Home — Kitchen / Mugs / Cookware
  if (
    t.includes("mug") ||
    t.includes("ceramic") ||
    t.includes("kitchen") ||
    t.includes("cookware") ||
    t.includes("appliance")
  )
    return [
      "https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800",
      "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800",
    ];

  // Home — Garden / Plants / Craft / Wall Hanging / Macramé
  if (
    t.includes("garden") ||
    t.includes("plant") ||
    t.includes("craft") ||
    t.includes("macrame") ||
    t.includes("wall hanging") ||
    t.includes("supply") ||
    t.includes("supplies")
  )
    return [
      "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800",
      "https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?w=800",
    ];

  // Books / Media / Vinyl
  if (
    t.includes("book") ||
    t.includes("vinyl") ||
    t.includes("record") ||
    t.includes("dvd")
  )
    return [
      "https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?w=800",
      "https://images.unsplash.com/photo-1512820790803-83ca734da794?w=800",
    ];

  // Toys / Games / LEGO / Console
  if (
    t.includes("lego") ||
    t.includes("console") ||
    t.includes("gaming") ||
    t.includes("toy") ||
    t.includes("game")
  )
    return [
      "https://images.unsplash.com/photo-1558060370-d644479cb6f7?w=800",
      "https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=800",
    ];

  // Default fallback
  return [
    "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800",
    "https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=800",
  ];
}

// ─── Wipe ────────────────────────────────────────────────────────────────────

async function wipeDatabase() {
  console.log("🗑️  Wiping database...");
  // Delete in strict dependency order — children before parents
  await db.auditLog.deleteMany();
  await db.platformConfig.deleteMany();
  await db.dynamicListItem.deleteMany();
  await db.notification.deleteMany();
  await db.report.deleteMany();
  await db.reviewTag.deleteMany();
  await db.review.deleteMany();
  await db.message.deleteMany();
  await db.messageThread.deleteMany();
  await db.watchlistItem.deleteMany();
  await db.recentlyViewed.deleteMany();
  await db.offer.deleteMany();
  await db.payout.deleteMany();
  await db.pickupRescheduleRequest.deleteMany();
  await db.disputeEvidence.deleteMany();
  await db.dispute.deleteMany();
  await db.listingSnapshot.deleteMany();
  await db.orderInteraction.deleteMany();
  await db.orderEvent.deleteMany();
  await db.orderItem.deleteMany();
  await db.cartItem.deleteMany();
  await db.cart.deleteMany();
  await db.order.deleteMany();
  await db.listingPriceHistory.deleteMany();
  await db.listingAttribute.deleteMany();
  await db.listingImage.deleteMany();
  await db.listing.deleteMany();
  await db.trustMetrics.deleteMany();
  await db.verificationApplication.deleteMany();
  await db.phoneVerificationToken.deleteMany();
  await db.emailVerificationToken.deleteMany();
  await db.passwordResetToken.deleteMany();
  await db.adminInvitation.deleteMany();
  await db.stripeEvent.deleteMany();
  await db.blockedUser.deleteMany();
  await db.session.deleteMany();
  await db.account.deleteMany();
  await db.verificationToken.deleteMany();
  await db.subcategory.deleteMany();
  await db.category.deleteMany();
  await db.user.deleteMany();
  console.log("✅ Database wiped");
}

// ─── Categories ──────────────────────────────────────────────────────────────

async function seedCategories() {
  console.log("📂 Creating categories...");

  const cats = [
    {
      id: "cat-electronics",
      name: "Electronics",
      icon: "📱",
      slug: "electronics",
      displayOrder: 1,
    },
    {
      id: "cat-fashion",
      name: "Fashion",
      icon: "👗",
      slug: "fashion",
      displayOrder: 2,
    },
    {
      id: "cat-home",
      name: "Home & Garden",
      icon: "🏡",
      slug: "home-garden",
      displayOrder: 3,
    },
    {
      id: "cat-sports",
      name: "Sports & Outdoors",
      icon: "⚽",
      slug: "sports-outdoors",
      displayOrder: 4,
    },
    {
      id: "cat-baby",
      name: "Baby & Kids",
      icon: "🧸",
      slug: "baby-kids",
      displayOrder: 5,
    },
    {
      id: "cat-collectibles",
      name: "Collectibles",
      icon: "🏺",
      slug: "collectibles",
      displayOrder: 6,
    },
    {
      id: "cat-tools",
      name: "Tools & Equipment",
      icon: "🔧",
      slug: "tools-equipment",
      displayOrder: 7,
    },
    {
      id: "cat-vehicles",
      name: "Vehicles & Parts",
      icon: "🚗",
      slug: "vehicles-parts",
      displayOrder: 8,
    },
  ];

  const subcats: { categoryId: string; name: string; slug: string }[] = [
    // Electronics
    { categoryId: "cat-electronics", name: "Phones", slug: "phones" },
    { categoryId: "cat-electronics", name: "Laptops", slug: "laptops" },
    { categoryId: "cat-electronics", name: "Tablets", slug: "tablets" },
    { categoryId: "cat-electronics", name: "Audio", slug: "audio" },
    { categoryId: "cat-electronics", name: "Cameras", slug: "cameras" },
    { categoryId: "cat-electronics", name: "Gaming", slug: "gaming" },
    // Fashion
    {
      categoryId: "cat-fashion",
      name: "Mens Clothing",
      slug: "mens-clothing",
    },
    {
      categoryId: "cat-fashion",
      name: "Womens Clothing",
      slug: "womens-clothing",
    },
    { categoryId: "cat-fashion", name: "Shoes", slug: "shoes" },
    { categoryId: "cat-fashion", name: "Jewellery", slug: "jewellery" },
    // Home
    { categoryId: "cat-home", name: "Furniture", slug: "furniture" },
    { categoryId: "cat-home", name: "Kitchen", slug: "kitchen" },
    { categoryId: "cat-home", name: "Garden", slug: "garden" },
    // Sports
    { categoryId: "cat-sports", name: "Bikes", slug: "bikes" },
    { categoryId: "cat-sports", name: "Camping", slug: "camping" },
    { categoryId: "cat-sports", name: "Fitness", slug: "fitness" },
    // Baby
    { categoryId: "cat-baby", name: "Prams & Strollers", slug: "prams" },
    { categoryId: "cat-baby", name: "Clothing", slug: "clothing" },
    // Collectibles
    { categoryId: "cat-collectibles", name: "Art", slug: "art" },
    { categoryId: "cat-collectibles", name: "Coins", slug: "coins" },
    // Tools
    { categoryId: "cat-tools", name: "Power Tools", slug: "power-tools" },
    { categoryId: "cat-tools", name: "Hand Tools", slug: "hand-tools" },
    // Vehicles
    { categoryId: "cat-vehicles", name: "Car Parts", slug: "car-parts" },
  ];

  for (const cat of cats) {
    await db.category.create({ data: cat });
  }
  for (const sub of subcats) {
    await db.subcategory.create({ data: sub });
  }

  console.log(`✅ ${cats.length} categories, ${subcats.length} subcategories`);
  return { cats };
}

// ─── Users ───────────────────────────────────────────────────────────────────

async function seedUsers() {
  console.log("👤 Creating users...");

  const buyerPass = await argon2.hash("BuyerPass123!", {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
  const sellerPass = await argon2.hash("SellerPass123!", {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
  const adminPass = await argon2.hash("AdminPass123!", {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });

  // ── BUYERS ──────────────────────────────────────────────────────────────

  // Buyer 1 — Active buyer, normal orders, reviews, watchlist
  const buyer1 = await db.user.create({
    data: {
      email: "sarah@buyzi.test",
      username: "sarah_nz",
      displayName: "Sarah Mitchell",
      passwordHash: buyerPass,
      emailVerified: ago(30 * DAY),
      phone: "+6421111001",
      isPhoneVerified: true,
      phoneVerifiedAt: ago(25 * DAY),
      region: "Auckland",
      suburb: "Ponsonby",
      isOnboardingCompleted: true,
      hasMarketingConsent: true,
      agreedTermsAt: ago(30 * DAY),
      createdAt: ago(30 * DAY),
    },
  });

  // Buyer 2 — Dispute buyer, has open and resolved disputes
  const buyer2 = await db.user.create({
    data: {
      email: "james@buyzi.test",
      username: "james_auckland",
      displayName: "James Chen",
      passwordHash: buyerPass,
      emailVerified: ago(20 * DAY),
      phone: "+6421111002",
      isPhoneVerified: true,
      phoneVerifiedAt: ago(18 * DAY),
      region: "Wellington",
      suburb: "Thorndon",
      isOnboardingCompleted: true,
      agreedTermsAt: ago(20 * DAY),
      createdAt: ago(20 * DAY),
    },
  });

  // Buyer 3 — Pickup buyer, tests OTP flow and COP
  const buyer3 = await db.user.create({
    data: {
      email: "emma@buyzi.test",
      username: "emma_welly",
      displayName: "Emma Thompson",
      passwordHash: buyerPass,
      emailVerified: ago(15 * DAY),
      phone: "+6421111003",
      isPhoneVerified: true,
      phoneVerifiedAt: ago(14 * DAY),
      region: "Canterbury",
      suburb: "Riccarton",
      isOnboardingCompleted: true,
      agreedTermsAt: ago(15 * DAY),
      createdAt: ago(15 * DAY),
    },
  });

  // ── SELLERS ─────────────────────────────────────────────────────────────

  // Seller 1 — Gold tier, ID verified, many completed sales, trusted
  const seller1 = await db.user.create({
    data: {
      email: "mike@buyzi.test",
      username: "mike_tech",
      displayName: "Mike Anderson",
      passwordHash: sellerPass,
      emailVerified: ago(90 * DAY),
      phone: "+6421222001",
      isPhoneVerified: true,
      phoneVerifiedAt: ago(85 * DAY),
      idVerified: true,
      idVerifiedAt: ago(80 * DAY),
      isVerifiedSeller: true,
      verifiedSellerAt: ago(80 * DAY),
      sellerTermsAcceptedAt: ago(88 * DAY),
      stripeAccountId: "acct_test_mike",
      isStripeOnboarded: true,
      isStripeChargesEnabled: true,
      isStripePayoutsEnabled: true,
      region: "Auckland",
      suburb: "Newmarket",
      isOnboardingCompleted: true,
      agreedTermsAt: ago(90 * DAY),
      createdAt: ago(90 * DAY),
    },
  });

  // Seller 2 — New L1 seller, not verified, limited listings
  const seller2 = await db.user.create({
    data: {
      email: "rachel@buyzi.test",
      username: "rachel_crafts",
      displayName: "Rachel Green",
      passwordHash: sellerPass,
      emailVerified: ago(10 * DAY),
      phone: "+6421222002",
      isPhoneVerified: false,
      idVerified: false,
      sellerTermsAcceptedAt: ago(9 * DAY),
      stripeAccountId: "acct_test_rachel",
      isStripeOnboarded: true,
      isStripeChargesEnabled: true,
      isStripePayoutsEnabled: false,
      region: "Waikato",
      suburb: "Hamilton Central",
      isOnboardingCompleted: true,
      agreedTermsAt: ago(10 * DAY),
      createdAt: ago(10 * DAY),
    },
  });

  // Seller 3 — High dispute rate, downgrade candidate, Silver tier
  const seller3 = await db.user.create({
    data: {
      email: "tom@buyzi.test",
      username: "tom_outdoors",
      displayName: "Tom Wilson",
      passwordHash: sellerPass,
      emailVerified: ago(60 * DAY),
      phone: "+6421222003",
      isPhoneVerified: true,
      phoneVerifiedAt: ago(55 * DAY),
      idVerified: false,
      sellerTermsAcceptedAt: ago(58 * DAY),
      stripeAccountId: "acct_test_tom",
      isStripeOnboarded: true,
      isStripeChargesEnabled: true,
      isStripePayoutsEnabled: true,
      region: "Otago",
      suburb: "Queenstown",
      isOnboardingCompleted: true,
      agreedTermsAt: ago(60 * DAY),
      createdAt: ago(60 * DAY),
    },
  });

  // Seller 4 — Pickup specialist, handles COP and OTP orders
  const seller4 = await db.user.create({
    data: {
      email: "aroha@buyzi.test",
      username: "aroha_handmade",
      displayName: "Aroha Williams",
      passwordHash: sellerPass,
      emailVerified: ago(45 * DAY),
      phone: "+6421222004",
      isPhoneVerified: true,
      phoneVerifiedAt: ago(43 * DAY),
      idVerified: true,
      idVerifiedAt: ago(40 * DAY),
      isVerifiedSeller: true,
      verifiedSellerAt: ago(40 * DAY),
      sellerTermsAcceptedAt: ago(44 * DAY),
      stripeAccountId: "acct_test_aroha",
      isStripeOnboarded: true,
      isStripeChargesEnabled: true,
      isStripePayoutsEnabled: true,
      region: "Bay of Plenty",
      suburb: "Tauranga",
      isOnboardingCompleted: true,
      agreedTermsAt: ago(45 * DAY),
      createdAt: ago(45 * DAY),
    },
  });

  // ── ADMINS ──────────────────────────────────────────────────────────────

  const superAdmin = await db.user.create({
    data: {
      email: "admin@buyzi.test",
      username: "super_admin",
      displayName: "Admin User",
      passwordHash: adminPass,
      emailVerified: ago(120 * DAY),
      isAdmin: true,
      adminRole: "SUPER_ADMIN",
      isMfaEnabled: false,
      region: "Auckland",
      isOnboardingCompleted: true,
      createdAt: ago(120 * DAY),
    },
  });

  const disputesAdmin = await db.user.create({
    data: {
      email: "disputes@buyzi.test",
      username: "disputes_admin",
      displayName: "Disputes Admin",
      passwordHash: adminPass,
      emailVerified: ago(100 * DAY),
      isAdmin: true,
      adminRole: "DISPUTES_ADMIN",
      region: "Wellington",
      isOnboardingCompleted: true,
      createdAt: ago(100 * DAY),
    },
  });

  const contentAdmin = await db.user.create({
    data: {
      email: "content@buyzi.test",
      username: "content_admin",
      displayName: "Content Admin",
      passwordHash: adminPass,
      emailVerified: ago(100 * DAY),
      isAdmin: true,
      adminRole: "TRUST_SAFETY_ADMIN",
      region: "Auckland",
      isOnboardingCompleted: true,
      createdAt: ago(100 * DAY),
    },
  });

  const financeAdmin = await db.user.create({
    data: {
      email: "finance@buyzi.test",
      username: "finance_admin",
      displayName: "Finance Admin",
      passwordHash: adminPass,
      emailVerified: ago(100 * DAY),
      isAdmin: true,
      adminRole: "FINANCE_ADMIN",
      region: "Auckland",
      isOnboardingCompleted: true,
      createdAt: ago(100 * DAY),
    },
  });

  console.log("✅ 11 users created");
  return {
    buyer1,
    buyer2,
    buyer3,
    seller1,
    seller2,
    seller3,
    seller4,
    superAdmin,
    disputesAdmin,
    contentAdmin,
    financeAdmin,
  };
}

// ─── Listings ────────────────────────────────────────────────────────────────

async function seedListings(users: Awaited<ReturnType<typeof seedUsers>>) {
  console.log("🛍️  Creating listings...");
  const { seller1, seller2, seller3, seller4, contentAdmin } = users;

  // Helper to create listing with images
  async function makeListing(data: {
    sellerId: string;
    title: string;
    description: string;
    priceNzd: number;
    shippingNzd?: number;
    condition: "NEW" | "LIKE_NEW" | "GOOD" | "FAIR" | "PARTS";
    status:
      | "DRAFT"
      | "PENDING_REVIEW"
      | "NEEDS_CHANGES"
      | "ACTIVE"
      | "RESERVED"
      | "SOLD"
      | "EXPIRED"
      | "REMOVED";
    categoryId: string;
    subcategoryName?: string;
    region: string;
    suburb: string;
    shippingOption: "PICKUP" | "COURIER" | "BOTH";
    isOffersEnabled?: boolean;
    isNegotiable?: boolean;
    isUrgent?: boolean;
    shipsNationwide?: boolean;
    publishedAt?: Date;
    soldAt?: Date;
    createdAt?: Date;
    autoRiskScore?: number;
    autoRiskFlags?: string[];
    moderationNote?: string;
    moderatedBy?: string;
    moderatedAt?: Date;
    resubmissionCount?: number;
    previousPriceNzd?: number;
    priceDroppedAt?: Date;
  }) {
    const listing = await db.listing.create({
      data: {
        sellerId: data.sellerId,
        title: data.title,
        description: data.description,
        priceNzd: data.priceNzd,
        shippingNzd: data.shippingNzd ?? 0,
        condition: data.condition,
        status: data.status,
        categoryId: data.categoryId,
        subcategoryName: data.subcategoryName ?? null,
        region: data.region,
        suburb: data.suburb,
        shippingOption: data.shippingOption,
        isOffersEnabled: data.isOffersEnabled ?? true,
        isNegotiable: data.isNegotiable ?? false,
        isUrgent: data.isUrgent ?? false,
        shipsNationwide: data.shipsNationwide ?? false,
        publishedAt:
          data.publishedAt ?? (data.status === "ACTIVE" ? ago(7 * DAY) : null),
        soldAt: data.soldAt ?? null,
        expiresAt: data.status === "ACTIVE" ? future(23 * DAY) : null,
        createdAt: data.createdAt ?? ago(8 * DAY),
        autoRiskScore: data.autoRiskScore ?? null,
        autoRiskFlags: data.autoRiskFlags ?? [],
        moderationNote: data.moderationNote ?? null,
        moderatedBy: data.moderatedBy ?? null,
        moderatedAt: data.moderatedAt ?? null,
        resubmissionCount: data.resubmissionCount ?? 0,
        previousPriceNzd: data.previousPriceNzd ?? null,
        priceDroppedAt: data.priceDroppedAt ?? null,
      },
    });
    // Add 2–4 listing images — curated Unsplash URLs matched to the listing category.
    // getImageUrl() passes http(s) URLs through as-is, so no R2 upload needed.
    const imageUrls = pickListingImages(data.title);
    for (let i = 0; i < imageUrls.length; i++) {
      await db.listingImage.create({
        data: {
          listingId: listing.id,
          r2Key: imageUrls[i]!,
          thumbnailKey: imageUrls[i]!,
          order: i,
          isScanned: true,
          isSafe: true,
          scannedAt: ago(1 * HOUR),
          processedAt: ago(1 * HOUR),
        },
      });
    }
    return listing;
  }

  // ── SELLER 1 (Mike — Gold, ID verified) ─────────────────────────────────
  // Active listings for purchase
  const listingMacbook = await makeListing({
    sellerId: seller1.id,
    title: "MacBook Pro 14-inch M3 Pro Space Black",
    description:
      "MacBook Pro 14-inch with M3 Pro chip, 18GB RAM, 512GB SSD. Space Black. Purchased 6 months ago. Excellent condition, minimal use. Comes with original charger and box. Perfect for developers and creatives. No scratches, no dents. Battery health 97%.",
    priceNzd: 289900,
    shippingNzd: 800,
    condition: "LIKE_NEW",
    status: "ACTIVE",
    categoryId: "cat-electronics",
    subcategoryName: "Laptops",
    region: "Auckland",
    suburb: "Newmarket",
    shippingOption: "COURIER",
    isOffersEnabled: true,
    isNegotiable: true,
    shipsNationwide: true,
    previousPriceNzd: 309900,
    priceDroppedAt: ago(2 * DAY),
  });

  const listingIphone = await makeListing({
    sellerId: seller1.id,
    title: "iPhone 15 Pro Max 256GB Natural Titanium",
    description:
      "iPhone 15 Pro Max 256GB in Natural Titanium. Purchased new 4 months ago. Used carefully with case and screen protector from day one. Battery health 99%. No marks or scratches. Comes with original Apple box, unused charging cable and adapter. Selling as upgrading to different colour.",
    priceNzd: 189900,
    shippingNzd: 600,
    condition: "LIKE_NEW",
    status: "ACTIVE",
    categoryId: "cat-electronics",
    subcategoryName: "Phones",
    region: "Auckland",
    suburb: "Newmarket",
    shippingOption: "BOTH",
    isOffersEnabled: true,
    shipsNationwide: true,
  });

  const listingSamsungTv = await makeListing({
    sellerId: seller1.id,
    title: "Samsung 65-inch QLED 4K Smart TV QN90B",
    description:
      "Samsung 65-inch QLED 4K TV model QN90B. Purchased 18 months ago. Picture quality is outstanding — Neo Quantum HDR, 120Hz refresh rate. All original remotes and stands included. Minor usage only. Selling as moving to smaller apartment. Pick up preferred from Newmarket or can arrange courier at buyers cost.",
    priceNzd: 159900,
    shippingNzd: 8000,
    condition: "GOOD",
    status: "ACTIVE",
    categoryId: "cat-electronics",
    subcategoryName: "Gaming",
    region: "Auckland",
    suburb: "Newmarket",
    shippingOption: "BOTH",
    isOffersEnabled: true,
    isNegotiable: true,
    isUrgent: true,
  });

  // SOLD listings (used for completed orders)
  const listingSoldHeadphones = await makeListing({
    sellerId: seller1.id,
    title: "Sony WH-1000XM5 Wireless Headphones Black",
    description:
      "Sony WH-1000XM5 noise cancelling headphones in black. Used for 8 months. Excellent noise cancellation still works perfectly. Comes with original case and cables. Some light wear on ear cushions but fully functional.",
    priceNzd: 42900,
    shippingNzd: 600,
    condition: "GOOD",
    status: "SOLD",
    categoryId: "cat-electronics",
    subcategoryName: "Audio",
    region: "Auckland",
    suburb: "Newmarket",
    shippingOption: "COURIER",
    isOffersEnabled: false,
    soldAt: ago(22 * DAY),
    createdAt: ago(30 * DAY),
  });

  const listingSoldCamera = await makeListing({
    sellerId: seller1.id,
    title: "Canon EOS R6 Mark II Body Only",
    description:
      "Canon EOS R6 Mark II mirrorless camera body. Around 5000 shutter actuations. Fantastic autofocus, great in low light. No signs of damage. Comes with original battery, charger, strap and box. Selling as upgrading to R5 Mark II.",
    priceNzd: 289900,
    shippingNzd: 1000,
    condition: "LIKE_NEW",
    status: "SOLD",
    categoryId: "cat-electronics",
    subcategoryName: "Cameras",
    region: "Auckland",
    suburb: "Newmarket",
    shippingOption: "COURIER",
    isOffersEnabled: false,
    soldAt: ago(18 * DAY),
    createdAt: ago(25 * DAY),
  });

  const listingSoldWatch = await makeListing({
    sellerId: seller1.id,
    title: "Apple Watch Series 9 GPS 45mm Midnight",
    description:
      "Apple Watch Series 9 GPS 45mm in Midnight Aluminium with Midnight Sport Band. 6 months old. Always had screen protector. Battery health excellent. Comes with charger and extra sports band. Selling as received a new one as a gift.",
    priceNzd: 54900,
    shippingNzd: 500,
    condition: "LIKE_NEW",
    status: "SOLD",
    categoryId: "cat-electronics",
    subcategoryName: "Phones",
    region: "Auckland",
    suburb: "Newmarket",
    shippingOption: "COURIER",
    isOffersEnabled: false,
    soldAt: ago(15 * DAY),
    createdAt: ago(20 * DAY),
  });

  // ── SELLER 2 (Rachel — New L1 seller) ───────────────────────────────────
  // Listings in various moderation states for admin queue testing
  const listingPendingReview = await makeListing({
    sellerId: seller2.id,
    title: "Handmade Ceramic Mug Set of 4",
    description:
      "Beautiful handmade ceramic mugs in earthy tones. Each mug is unique — slight variations in glaze are part of the charm. Dishwasher safe. Approx 350ml capacity. Perfect for coffee or tea. Made locally in Hamilton.",
    priceNzd: 8900,
    shippingNzd: 1200,
    condition: "NEW",
    status: "PENDING_REVIEW",
    categoryId: "cat-home",
    subcategoryName: "Kitchen",
    region: "Waikato",
    suburb: "Hamilton Central",
    shippingOption: "COURIER",
    autoRiskScore: 35,
    autoRiskFlags: ["NEW_SELLER", "FIRST_LISTINGS"],
    createdAt: ago(2 * HOUR),
  });

  const listingNeedsChanges = await makeListing({
    sellerId: seller2.id,
    title: "Kids Bike 20 inch",
    description: "Kids bike for sale.",
    priceNzd: 4900,
    shippingNzd: 0,
    condition: "GOOD",
    status: "NEEDS_CHANGES",
    categoryId: "cat-sports",
    subcategoryName: "Bikes",
    region: "Waikato",
    suburb: "Hamilton Central",
    shippingOption: "PICKUP",
    autoRiskScore: 50,
    autoRiskFlags: ["NEW_SELLER", "SHORT_DESCRIPTION", "SINGLE_IMAGE"],
    moderationNote:
      "Please improve your description — tell buyers the brand, size, any defects, and what is included. The current description is too short for buyers to make an informed decision. Also add more photos showing the condition of the bike.",
    moderatedBy: contentAdmin.id,
    moderatedAt: ago(3 * HOUR),
    resubmissionCount: 0,
    createdAt: ago(6 * HOUR),
  });

  const listingHighRisk = await makeListing({
    sellerId: seller2.id,
    title: "Vintage Rolex Submariner Watch",
    description:
      "Vintage Rolex Submariner from the 1970s. Great condition for its age. Serial number available on request. Price firm.",
    priceNzd: 850000,
    shippingNzd: 2000,
    condition: "GOOD",
    status: "PENDING_REVIEW",
    categoryId: "cat-collectibles",
    subcategoryName: "Coins",
    region: "Waikato",
    suburb: "Hamilton Central",
    shippingOption: "COURIER",
    autoRiskScore: 80,
    autoRiskFlags: [
      "NEW_SELLER",
      "HIGH_VALUE_ITEM",
      "FIRST_LISTINGS",
      "SHORT_DESCRIPTION",
    ],
    createdAt: ago(1 * HOUR),
  });

  const listingDraft = await makeListing({
    sellerId: seller2.id,
    title: "Craft Supplies Bundle",
    description:
      "Various craft supplies including yarn, fabric, buttons and more.",
    priceNzd: 3500,
    shippingNzd: 800,
    condition: "NEW",
    status: "DRAFT",
    categoryId: "cat-home",
    subcategoryName: "Garden",
    region: "Waikato",
    suburb: "Hamilton Central",
    shippingOption: "COURIER",
    createdAt: ago(30 * MIN),
  });

  // ── SELLER 3 (Tom — High dispute rate) ──────────────────────────────────
  const listingKayak = await makeListing({
    sellerId: seller3.id,
    title: "Ocean Kayak Trident 13 Angler",
    description:
      "Ocean Kayak Trident 13 Angler fishing kayak. In good condition with some scratches on the hull from normal use. Comes with paddle, seat, and rod holders. Great stable platform for fishing. Selling as I have bought a motorised boat.",
    priceNzd: 89900,
    shippingNzd: 3000,
    condition: "GOOD",
    status: "ACTIVE",
    categoryId: "cat-sports",
    subcategoryName: "Camping",
    region: "Otago",
    suburb: "Queenstown",
    shippingOption: "BOTH",
    isOffersEnabled: true,
    isNegotiable: true,
  });

  const listingTent = await makeListing({
    sellerId: seller3.id,
    title: "MSR Hubba Hubba NX2 Tent",
    description:
      "MSR Hubba Hubba NX2 two-person backpacking tent. Used on 3 trips. Seams still well-sealed. All poles, pegs and guylines included. Footprint also included (sold separately normally). Storing due to back injury preventing further hiking.",
    priceNzd: 49900,
    shippingNzd: 1500,
    condition: "GOOD",
    status: "ACTIVE",
    categoryId: "cat-sports",
    subcategoryName: "Camping",
    region: "Otago",
    suburb: "Queenstown",
    shippingOption: "COURIER",
    isOffersEnabled: true,
  });

  // SOLD listings for disputed and refunded orders
  const listingSoldSpeaker = await makeListing({
    sellerId: seller3.id,
    title: "Sonos Move 2 Portable Speaker Black",
    description:
      "Sonos Move 2 portable speaker in black. About 8 months old. Great sound quality. Comes with charging base and original box. Battery lasts around 24 hours. Selling as upgrading to the fixed home system.",
    priceNzd: 59900,
    shippingNzd: 1000,
    condition: "LIKE_NEW",
    status: "SOLD",
    categoryId: "cat-electronics",
    subcategoryName: "Audio",
    region: "Otago",
    suburb: "Queenstown",
    shippingOption: "COURIER",
    isOffersEnabled: false,
    soldAt: ago(9 * DAY),
    createdAt: ago(14 * DAY),
  });

  const listingSoldTablet = await makeListing({
    sellerId: seller3.id,
    title: "iPad Pro 12.9-inch M2 256GB Space Grey",
    description:
      "iPad Pro 12.9-inch with M2 chip, 256GB, Space Grey WiFi. Comes with Apple Pencil 2nd gen and Magic Keyboard. Minor scuff on back corner. No screen damage. Face ID works perfectly. All original accessories included.",
    priceNzd: 149900,
    shippingNzd: 800,
    condition: "GOOD",
    status: "SOLD",
    categoryId: "cat-electronics",
    subcategoryName: "Tablets",
    region: "Otago",
    suburb: "Queenstown",
    shippingOption: "COURIER",
    isOffersEnabled: false,
    soldAt: ago(10 * DAY),
    createdAt: ago(16 * DAY),
  });

  // ── SELLER 4 (Aroha — Pickup specialist) ────────────────────────────────
  const listingPickupBike = await makeListing({
    sellerId: seller4.id,
    title: "Giant Defy Advanced 2 Road Bike Size M",
    description:
      "Giant Defy Advanced 2 road bike, size Medium. Carbon frame, Shimano 105 groupset. Purchased 2 years ago, ridden about 3000km. Well maintained, recently serviced. Tyres have plenty of life. Perfect bike for long-distance road riding. Pickup only from Tauranga — too large and fragile to ship.",
    priceNzd: 185000,
    shippingNzd: 0,
    condition: "GOOD",
    status: "ACTIVE",
    categoryId: "cat-sports",
    subcategoryName: "Bikes",
    region: "Bay of Plenty",
    suburb: "Tauranga",
    shippingOption: "PICKUP",
    isOffersEnabled: true,
    isNegotiable: true,
  });

  const listingCopFurniture = await makeListing({
    sellerId: seller4.id,
    title: "Solid Oak Dining Table 6-Seater",
    description:
      "Beautiful solid oak dining table seating 6 comfortably. 180cm x 90cm. Some minor marks from normal use but very solid and sturdy. No chairs included. This is a large heavy item so cash on pickup only from Tauranga. Buyer responsible for arranging transport.",
    priceNzd: 55000,
    shippingNzd: 0,
    condition: "GOOD",
    status: "ACTIVE",
    categoryId: "cat-home",
    subcategoryName: "Furniture",
    region: "Bay of Plenty",
    suburb: "Tauranga",
    shippingOption: "PICKUP",
    isOffersEnabled: false,
    isNegotiable: true,
  });

  const listingPickupSold = await makeListing({
    sellerId: seller4.id,
    title: "Kathmandu Epiq Down Jacket Womens Size 12",
    description:
      "Kathmandu Epiq Down Jacket in Navy, Womens Size 12. Excellent warmth-to-weight ratio. Worn a handful of times last winter. No damage or staining. All zips work perfectly. Comes in original stuff sack.",
    priceNzd: 17900,
    shippingNzd: 800,
    condition: "GOOD",
    status: "SOLD",
    categoryId: "cat-fashion",
    subcategoryName: "Womens Clothing",
    region: "Bay of Plenty",
    suburb: "Tauranga",
    shippingOption: "BOTH",
    isOffersEnabled: false,
    soldAt: ago(2 * DAY),
    createdAt: ago(5 * DAY),
  });

  const listingCopSold = await makeListing({
    sellerId: seller4.id,
    title: "Handmade Macrame Wall Hanging Large",
    description:
      "Large handmade macrame wall hanging, approximately 80cm wide and 120cm long. Made from natural cotton rope. Beautiful bohemian style, would suit a living room or bedroom. Cash on pickup from Tauranga only.",
    priceNzd: 12900,
    shippingNzd: 0,
    condition: "NEW",
    status: "SOLD",
    categoryId: "cat-collectibles",
    subcategoryName: "Art",
    region: "Bay of Plenty",
    suburb: "Tauranga",
    shippingOption: "PICKUP",
    isOffersEnabled: false,
    soldAt: ago(3 * DAY),
    createdAt: ago(6 * DAY),
  });

  console.log("✅ Listings created");

  return {
    // Active — for purchase
    listingMacbook,
    listingIphone,
    listingSamsungTv,
    listingKayak,
    listingTent,
    listingPickupBike,
    listingCopFurniture,
    // Moderation states
    listingPendingReview,
    listingNeedsChanges,
    listingHighRisk,
    listingDraft,
    // Sold — for orders
    listingSoldHeadphones,
    listingSoldCamera,
    listingSoldWatch,
    listingSoldSpeaker,
    listingSoldTablet,
    listingPickupSold,
    listingCopSold,
  };
}

// ─── Helper: create listing snapshot ────────────────────────────────────────

async function makeSnapshot(
  orderId: string,
  listing: {
    id: string;
    title: string;
    description: string;
    condition: "NEW" | "LIKE_NEW" | "GOOD" | "FAIR" | "PARTS";
    priceNzd: number;
    shippingNzd: number | null;
    shippingOption: "PICKUP" | "COURIER" | "BOTH";
    isNegotiable: boolean;
    categoryId: string;
  },
  categoryName: string,
) {
  return db.listingSnapshot.create({
    data: {
      orderId,
      listingId: listing.id,
      title: listing.title,
      description: listing.description,
      condition: listing.condition,
      priceNzd: listing.priceNzd,
      shippingNzd: listing.shippingNzd ?? 0,
      categoryName,
      subcategoryName: null,
      shippingOption: listing.shippingOption,
      isNegotiable: listing.isNegotiable,
      images: pickListingImages(listing.title).map((url, i) => ({
        r2Key: url,
        thumbnailKey: url,
        order: i,
      })),
      attributes: [],
      capturedAt: new Date(),
    },
  });
}

// ─── Helper: create order event ──────────────────────────────────────────────

async function makeEvent(
  orderId: string,
  type: string,
  actorId: string | null,
  actorRole: string,
  summary: string,
  metadata?: Record<string, unknown>,
  createdAt?: Date,
) {
  return db.orderEvent.create({
    data: {
      orderId,
      type,
      actorId,
      actorRole,
      summary,
      metadata: metadata as never,
      createdAt: createdAt ?? new Date(),
    },
  });
}

// ─── Orders ──────────────────────────────────────────────────────────────────

async function seedOrders(
  users: Awaited<ReturnType<typeof seedUsers>>,
  listings: Awaited<ReturnType<typeof seedListings>>,
) {
  console.log("📦 Creating orders...");
  const { buyer1, buyer2, buyer3, seller1, seller3, seller4, disputesAdmin } =
    users;
  const {
    listingSoldHeadphones,
    listingSoldCamera,
    listingSoldWatch,
    listingSoldSpeaker,
    listingSoldTablet,
    listingPickupSold,
    listingCopSold,
    listingMacbook,
    listingPickupBike,
    listingCopFurniture,
  } = listings;

  // ── GROUP 1: COMPLETED orders ────────────────────────────────────────────

  // comp1: Sarah bought Sony headphones from Mike — fully completed with review
  const comp1 = await db.order.create({
    data: {
      buyerId: buyer1.id,
      sellerId: seller1.id,
      listingId: listingSoldHeadphones.id,
      itemNzd: 42900,
      shippingNzd: 600,
      totalNzd: 43500,
      status: "COMPLETED",
      fulfillmentType: "SHIPPED",
      stripePaymentIntentId: "pi_test_comp1",
      trackingNumber: "NZ100200300",
      trackingUrl:
        "https://www.nzpost.co.nz/tools/tracking?trackid=NZ100200300",
      dispatchedAt: ago(20 * DAY),
      deliveredAt: ago(17 * DAY),
      completedAt: ago(14 * DAY),
      shippingName: "Sarah Mitchell",
      shippingLine1: "12 Ponsonby Road",
      shippingCity: "Auckland",
      shippingRegion: "Auckland",
      shippingPostcode: "1011",
      createdAt: ago(22 * DAY),
    },
  });
  await makeSnapshot(comp1.id, listingSoldHeadphones, "Electronics");
  await makeEvent(
    comp1.id,
    "ORDER_CREATED",
    buyer1.id,
    "BUYER",
    "Order placed by Sarah Mitchell",
    {},
    ago(22 * DAY),
  );
  await makeEvent(
    comp1.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment of $435.00 held in escrow",
    { amount: 43500 },
    ago(22 * DAY),
  );
  await makeEvent(
    comp1.id,
    "DISPATCHED",
    seller1.id,
    "SELLER",
    "Order dispatched via NZ Post",
    {
      courier: "NZ Post",
      trackingNumber: "NZ100200300",
      dispatchPhotos: [`orders/${comp1.id}/dispatch-1.webp`],
    },
    ago(20 * DAY),
  );
  await makeEvent(
    comp1.id,
    "DELIVERED",
    null,
    "SYSTEM",
    "Order marked as delivered",
    {},
    ago(17 * DAY),
  );
  await makeEvent(
    comp1.id,
    "DELIVERY_CONFIRMED_OK",
    buyer1.id,
    "BUYER",
    "Buyer confirmed item received in good condition",
    { itemCondition: "ok" },
    ago(15 * DAY),
  );
  await makeEvent(
    comp1.id,
    "COMPLETED",
    null,
    "SYSTEM",
    "Order completed, payout released to seller",
    {},
    ago(14 * DAY),
  );
  await makeEvent(
    comp1.id,
    "REVIEW_SUBMITTED",
    buyer1.id,
    "BUYER",
    "Buyer left a 4.5-star review",
    { rating: 45 },
    ago(14 * DAY),
  );

  // comp2: Sarah bought Canon camera from Mike
  const comp2 = await db.order.create({
    data: {
      buyerId: buyer1.id,
      sellerId: seller1.id,
      listingId: listingSoldCamera.id,
      itemNzd: 289900,
      shippingNzd: 1000,
      totalNzd: 290900,
      status: "COMPLETED",
      fulfillmentType: "SHIPPED",
      stripePaymentIntentId: "pi_test_comp2",
      trackingNumber: "NZ200300400",
      trackingUrl:
        "https://www.nzpost.co.nz/tools/tracking?trackid=NZ200300400",
      dispatchedAt: ago(17 * DAY),
      deliveredAt: ago(14 * DAY),
      completedAt: ago(11 * DAY),
      shippingName: "Sarah Mitchell",
      shippingLine1: "12 Ponsonby Road",
      shippingCity: "Auckland",
      shippingRegion: "Auckland",
      shippingPostcode: "1011",
      createdAt: ago(19 * DAY),
    },
  });
  await makeSnapshot(comp2.id, listingSoldCamera, "Electronics");
  await makeEvent(
    comp2.id,
    "ORDER_CREATED",
    buyer1.id,
    "BUYER",
    "Order placed by Sarah Mitchell",
    {},
    ago(19 * DAY),
  );
  await makeEvent(
    comp2.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment of $2,909.00 held in escrow",
    { amount: 290900 },
    ago(19 * DAY),
  );
  await makeEvent(
    comp2.id,
    "DISPATCHED",
    seller1.id,
    "SELLER",
    "Order dispatched via CourierPost",
    {
      courier: "CourierPost",
      trackingNumber: "NZ200300400",
      dispatchPhotos: [
        `orders/${comp2.id}/dispatch-1.webp`,
        `orders/${comp2.id}/dispatch-2.webp`,
      ],
    },
    ago(17 * DAY),
  );
  await makeEvent(
    comp2.id,
    "DELIVERED",
    null,
    "SYSTEM",
    "Order marked as delivered",
    {},
    ago(14 * DAY),
  );
  await makeEvent(
    comp2.id,
    "DELIVERY_CONFIRMED_OK",
    buyer1.id,
    "BUYER",
    "Buyer confirmed item received in good condition",
    { itemCondition: "ok" },
    ago(12 * DAY),
  );
  await makeEvent(
    comp2.id,
    "COMPLETED",
    null,
    "SYSTEM",
    "Order completed, payout released to seller",
    {},
    ago(11 * DAY),
  );

  // comp3: James bought Apple Watch from Mike
  const comp3 = await db.order.create({
    data: {
      buyerId: buyer2.id,
      sellerId: seller1.id,
      listingId: listingSoldWatch.id,
      itemNzd: 54900,
      shippingNzd: 500,
      totalNzd: 55400,
      status: "COMPLETED",
      fulfillmentType: "SHIPPED",
      stripePaymentIntentId: "pi_test_comp3",
      trackingNumber: "NZ300400500",
      dispatchedAt: ago(12 * DAY),
      deliveredAt: ago(9 * DAY),
      completedAt: ago(6 * DAY),
      shippingName: "James Chen",
      shippingLine1: "45 Lambton Quay",
      shippingCity: "Wellington",
      shippingRegion: "Wellington",
      shippingPostcode: "6011",
      createdAt: ago(14 * DAY),
    },
  });
  await makeSnapshot(comp3.id, listingSoldWatch, "Electronics");
  await makeEvent(
    comp3.id,
    "ORDER_CREATED",
    buyer2.id,
    "BUYER",
    "Order placed by James Chen",
    {},
    ago(14 * DAY),
  );
  await makeEvent(
    comp3.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment held in escrow",
    {},
    ago(14 * DAY),
  );
  await makeEvent(
    comp3.id,
    "DISPATCHED",
    seller1.id,
    "SELLER",
    "Order dispatched via NZ Post",
    { courier: "NZ Post", trackingNumber: "NZ300400500" },
    ago(12 * DAY),
  );
  await makeEvent(
    comp3.id,
    "DELIVERED",
    null,
    "SYSTEM",
    "Delivered",
    {},
    ago(9 * DAY),
  );
  await makeEvent(
    comp3.id,
    "DELIVERY_CONFIRMED_OK",
    buyer2.id,
    "BUYER",
    "Item received in good condition",
    {},
    ago(7 * DAY),
  );
  await makeEvent(
    comp3.id,
    "COMPLETED",
    null,
    "SYSTEM",
    "Order completed",
    {},
    ago(6 * DAY),
  );

  // ── GROUP 2: DISPATCHED orders ───────────────────────────────────────────

  // disp1: Sarah — dispatched, overdue delivery
  const disp1 = await db.order.create({
    data: {
      buyerId: buyer1.id,
      sellerId: seller1.id,
      listingId: listingSoldCamera.id,
      itemNzd: 289900,
      shippingNzd: 1000,
      totalNzd: 290900,
      status: "DISPATCHED",
      fulfillmentType: "SHIPPED",
      stripePaymentIntentId: "pi_test_disp1",
      trackingNumber: "NZ700800901",
      dispatchedAt: ago(7 * DAY),
      shippingName: "Sarah Mitchell",
      shippingLine1: "12 Ponsonby Road",
      shippingCity: "Auckland",
      shippingRegion: "Auckland",
      shippingPostcode: "1011",
      createdAt: ago(9 * DAY),
    },
  });
  await makeSnapshot(disp1.id, listingSoldCamera, "Electronics");
  await makeEvent(
    disp1.id,
    "ORDER_CREATED",
    buyer1.id,
    "BUYER",
    "Order placed",
    {},
    ago(9 * DAY),
  );
  await makeEvent(
    disp1.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment held",
    {},
    ago(9 * DAY),
  );
  await makeEvent(
    disp1.id,
    "DISPATCHED",
    seller1.id,
    "SELLER",
    "Dispatched via CourierPost",
    {
      courier: "CourierPost",
      trackingNumber: "NZ700800901",
      estimatedDelivery: ago(4 * DAY).toISOString(),
    },
    ago(7 * DAY),
  );
  await makeEvent(
    disp1.id,
    "DELIVERY_REMINDER_SENT",
    null,
    "SYSTEM",
    "Delivery reminder sent to buyer",
    {},
    ago(1 * DAY),
  );

  // disp2: James bought Sonos — dispatched, arriving tomorrow
  const disp2 = await db.order.create({
    data: {
      buyerId: buyer2.id,
      sellerId: seller3.id,
      listingId: listingSoldSpeaker.id,
      itemNzd: 59900,
      shippingNzd: 1000,
      totalNzd: 60900,
      status: "DISPATCHED",
      fulfillmentType: "SHIPPED",
      stripePaymentIntentId: "pi_test_disp2",
      trackingNumber: "NZ800900102",
      dispatchedAt: ago(3 * DAY),
      shippingName: "James Chen",
      shippingLine1: "45 Lambton Quay",
      shippingCity: "Wellington",
      shippingRegion: "Wellington",
      shippingPostcode: "6011",
      createdAt: ago(5 * DAY),
    },
  });
  await makeSnapshot(disp2.id, listingSoldSpeaker, "Electronics");
  await makeEvent(
    disp2.id,
    "ORDER_CREATED",
    buyer2.id,
    "BUYER",
    "Order placed",
    {},
    ago(5 * DAY),
  );
  await makeEvent(
    disp2.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment held",
    {},
    ago(5 * DAY),
  );
  await makeEvent(
    disp2.id,
    "DISPATCHED",
    seller3.id,
    "SELLER",
    "Dispatched via NZ Post",
    {
      courier: "NZ Post",
      trackingNumber: "NZ800900102",
      estimatedDelivery: future(1 * DAY).toISOString(),
    },
    ago(3 * DAY),
  );

  // ── GROUP 3: PAYMENT_HELD orders (awaiting dispatch) ────────────────────

  // ph1: Emma bought iPad — new order, seller needs to dispatch
  const ph1 = await db.order.create({
    data: {
      buyerId: buyer3.id,
      sellerId: seller3.id,
      listingId: listingSoldTablet.id,
      itemNzd: 149900,
      shippingNzd: 800,
      totalNzd: 150700,
      status: "PAYMENT_HELD",
      fulfillmentType: "SHIPPED",
      stripePaymentIntentId: "pi_test_ph1",
      shippingName: "Emma Thompson",
      shippingLine1: "8 Riccarton Road",
      shippingCity: "Christchurch",
      shippingRegion: "Canterbury",
      shippingPostcode: "8011",
      createdAt: ago(3 * HOUR),
    },
  });
  await makeSnapshot(ph1.id, listingSoldTablet, "Electronics");
  await makeEvent(
    ph1.id,
    "ORDER_CREATED",
    buyer3.id,
    "BUYER",
    "Order placed by Emma Thompson",
    {},
    ago(3 * HOUR),
  );
  await makeEvent(
    ph1.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment of $1,507.00 held in escrow",
    { amount: 150700 },
    ago(3 * HOUR),
  );

  // ph2: Sarah bought MacBook — older order, seller delayed
  const ph2 = await db.order.create({
    data: {
      buyerId: buyer1.id,
      sellerId: seller1.id,
      listingId: listingMacbook.id,
      itemNzd: 289900,
      shippingNzd: 800,
      totalNzd: 290700,
      status: "PAYMENT_HELD",
      fulfillmentType: "SHIPPED",
      stripePaymentIntentId: "pi_test_ph2",
      shippingName: "Sarah Mitchell",
      shippingLine1: "12 Ponsonby Road",
      shippingCity: "Auckland",
      shippingRegion: "Auckland",
      shippingPostcode: "1011",
      createdAt: ago(2 * DAY),
    },
  });
  await makeSnapshot(ph2.id, listingMacbook, "Electronics");
  await makeEvent(
    ph2.id,
    "ORDER_CREATED",
    buyer1.id,
    "BUYER",
    "Order placed",
    {},
    ago(2 * DAY),
  );
  await makeEvent(
    ph2.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment held in escrow",
    {},
    ago(2 * DAY),
  );

  // ── GROUP 4: DISPUTED orders ─────────────────────────────────────────────

  // dispA: James vs Tom — iPad damaged, seller NOT yet responded
  const dispA = await db.order.create({
    data: {
      buyerId: buyer2.id,
      sellerId: seller3.id,
      listingId: listingSoldTablet.id,
      itemNzd: 149900,
      shippingNzd: 800,
      totalNzd: 150700,
      status: "DISPUTED",
      fulfillmentType: "SHIPPED",
      stripePaymentIntentId: "pi_test_dispA",
      trackingNumber: "NZ400500600",
      dispatchedAt: ago(10 * DAY),
      deliveredAt: ago(8 * DAY),
      shippingName: "James Chen",
      shippingLine1: "45 Lambton Quay",
      shippingCity: "Wellington",
      shippingRegion: "Wellington",
      shippingPostcode: "6011",
      createdAt: ago(12 * DAY),
    },
  });
  await makeSnapshot(dispA.id, listingSoldTablet, "Electronics");
  await makeEvent(
    dispA.id,
    "ORDER_CREATED",
    buyer2.id,
    "BUYER",
    "Order placed",
    {},
    ago(12 * DAY),
  );
  await makeEvent(
    dispA.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment held",
    {},
    ago(12 * DAY),
  );
  await makeEvent(
    dispA.id,
    "DISPATCHED",
    seller3.id,
    "SELLER",
    "Dispatched via CourierPost",
    {
      courier: "CourierPost",
      trackingNumber: "NZ400500600",
      dispatchPhotos: [
        `orders/${dispA.id}/dispatch-1.webp`,
        `orders/${dispA.id}/dispatch-2.webp`,
      ],
    },
    ago(10 * DAY),
  );
  await makeEvent(
    dispA.id,
    "DELIVERED",
    null,
    "SYSTEM",
    "Delivered",
    {},
    ago(8 * DAY),
  );
  await makeEvent(
    dispA.id,
    "DISPUTE_OPENED",
    buyer2.id,
    "BUYER",
    "Buyer opened dispute: item damaged",
    { reason: "ITEM_DAMAGED" },
    ago(1 * DAY),
  );

  const disputeA = await db.dispute.create({
    data: {
      orderId: dispA.id,
      reason: "ITEM_DAMAGED",
      source: "STANDARD",
      status: "OPEN",
      buyerStatement:
        "The iPad arrived with a cracked screen. The screen has a visible crack running diagonally across it. The outer box also had dents suggesting it was dropped during transit. The item was not packaged adequately — just bubble wrap with no box. I have photos showing the damage.",
      openedAt: ago(1 * DAY),
    },
  });
  await db.disputeEvidence.createMany({
    data: [
      {
        disputeId: disputeA.id,
        uploadedBy: "BUYER",
        uploaderId: buyer2.id,
        r2Key: `disputes/${disputeA.id}/cracked-screen-1.webp`,
        fileType: "image",
        label: "Cracked screen — front view",
      },
      {
        disputeId: disputeA.id,
        uploadedBy: "BUYER",
        uploaderId: buyer2.id,
        r2Key: `disputes/${disputeA.id}/cracked-screen-2.webp`,
        fileType: "image",
        label: "Cracked screen — close up",
      },
      {
        disputeId: disputeA.id,
        uploadedBy: "BUYER",
        uploaderId: buyer2.id,
        r2Key: `disputes/${disputeA.id}/damaged-packaging.webp`,
        fileType: "image",
        label: "Damaged outer box",
      },
    ],
  });

  // dispB: Emma vs Mike — Sonos not received, seller responded with tracking
  const dispB = await db.order.create({
    data: {
      buyerId: buyer3.id,
      sellerId: seller1.id,
      listingId: listingSoldSpeaker.id,
      itemNzd: 59900,
      shippingNzd: 1000,
      totalNzd: 60900,
      status: "DISPUTED",
      fulfillmentType: "SHIPPED",
      stripePaymentIntentId: "pi_test_dispB",
      trackingNumber: "NZ500600700",
      dispatchedAt: ago(12 * DAY),
      shippingName: "Emma Thompson",
      shippingLine1: "8 Riccarton Road",
      shippingCity: "Christchurch",
      shippingRegion: "Canterbury",
      shippingPostcode: "8011",
      createdAt: ago(14 * DAY),
    },
  });
  await makeSnapshot(dispB.id, listingSoldSpeaker, "Electronics");
  await makeEvent(
    dispB.id,
    "ORDER_CREATED",
    buyer3.id,
    "BUYER",
    "Order placed",
    {},
    ago(14 * DAY),
  );
  await makeEvent(
    dispB.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment held",
    {},
    ago(14 * DAY),
  );
  await makeEvent(
    dispB.id,
    "DISPATCHED",
    seller1.id,
    "SELLER",
    "Dispatched via NZ Post",
    {
      courier: "NZ Post",
      trackingNumber: "NZ500600700",
      dispatchPhotos: [`orders/${dispB.id}/dispatch-1.webp`],
    },
    ago(12 * DAY),
  );
  await makeEvent(
    dispB.id,
    "DISPUTE_OPENED",
    buyer3.id,
    "BUYER",
    "Buyer opened dispute: item not received",
    { reason: "ITEM_NOT_RECEIVED" },
    ago(5 * DAY),
  );
  await makeEvent(
    dispB.id,
    "DISPUTE_SELLER_RESPONDED",
    seller1.id,
    "SELLER",
    "Seller provided tracking evidence",
    {},
    ago(3 * DAY),
  );

  const disputeB = await db.dispute.create({
    data: {
      orderId: dispB.id,
      reason: "ITEM_NOT_RECEIVED",
      source: "STANDARD",
      status: "SELLER_RESPONDED",
      buyerStatement:
        "It has been 12 days and I still have not received my Sonos speaker. The tracking shows it left Queenstown 12 days ago but has not been updated since. I believe it may be lost in transit.",
      sellerStatement:
        "I dispatched the item promptly on the day after purchase via NZ Post. I have the receipt and dispatch photos. The tracking number NZ500600700 shows the item was scanned at the Auckland sorting facility. I believe there may be a delay at the Christchurch end. I would suggest contacting NZ Post.",
      sellerRespondedAt: ago(3 * DAY),
      openedAt: ago(5 * DAY),
    },
  });
  await db.disputeEvidence.createMany({
    data: [
      {
        disputeId: disputeB.id,
        uploadedBy: "BUYER",
        uploaderId: buyer3.id,
        r2Key: `disputes/${disputeB.id}/tracking-screenshot.webp`,
        fileType: "image",
        label: "Tracking page screenshot — no movement",
      },
      {
        disputeId: disputeB.id,
        uploadedBy: "SELLER",
        uploaderId: seller1.id,
        r2Key: `disputes/${disputeB.id}/dispatch-receipt.webp`,
        fileType: "image",
        label: "NZ Post dispatch receipt",
      },
      {
        disputeId: disputeB.id,
        uploadedBy: "SELLER",
        uploaderId: seller1.id,
        r2Key: `disputes/${disputeB.id}/pre-dispatch-photo.webp`,
        fileType: "image",
        label: "Item pre-dispatch — shows condition",
      },
    ],
  });

  // ── GROUP 5: REFUNDED orders ─────────────────────────────────────────────

  // refA: Sarah vs Mike — dispute resolved, buyer won, admin decision
  const refA = await db.order.create({
    data: {
      buyerId: buyer1.id,
      sellerId: seller1.id,
      listingId: listingSoldHeadphones.id,
      itemNzd: 42900,
      shippingNzd: 600,
      totalNzd: 43500,
      status: "REFUNDED",
      fulfillmentType: "SHIPPED",
      stripePaymentIntentId: "pi_test_refA",
      trackingNumber: "NZ600700800",
      dispatchedAt: ago(25 * DAY),
      deliveredAt: ago(22 * DAY),
      shippingName: "Sarah Mitchell",
      shippingLine1: "12 Ponsonby Road",
      shippingCity: "Auckland",
      shippingRegion: "Auckland",
      shippingPostcode: "1011",
      createdAt: ago(27 * DAY),
    },
  });
  await makeSnapshot(refA.id, listingSoldHeadphones, "Electronics");
  await makeEvent(
    refA.id,
    "ORDER_CREATED",
    buyer1.id,
    "BUYER",
    "Order placed",
    {},
    ago(27 * DAY),
  );
  await makeEvent(
    refA.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment held",
    {},
    ago(27 * DAY),
  );
  await makeEvent(
    refA.id,
    "DISPATCHED",
    seller1.id,
    "SELLER",
    "Dispatched",
    { courier: "CourierPost", trackingNumber: "NZ600700800" },
    ago(25 * DAY),
  );
  await makeEvent(
    refA.id,
    "DELIVERED",
    null,
    "SYSTEM",
    "Delivered",
    {},
    ago(22 * DAY),
  );
  await makeEvent(
    refA.id,
    "DISPUTE_OPENED",
    buyer1.id,
    "BUYER",
    "Buyer opened dispute: item not as described",
    { reason: "ITEM_NOT_AS_DESCRIBED" },
    ago(20 * DAY),
  );
  await makeEvent(
    refA.id,
    "DISPUTE_SELLER_RESPONDED",
    seller1.id,
    "SELLER",
    "Seller responded to dispute",
    {},
    ago(18 * DAY),
  );
  await makeEvent(
    refA.id,
    "DISPUTE_RESOLVED",
    disputesAdmin.id,
    "ADMIN",
    "Admin resolved dispute in buyer's favour. Full refund issued.",
    { favour: "buyer", refundAmount: 43500 },
    ago(15 * DAY),
  );
  await makeEvent(
    refA.id,
    "REFUNDED",
    null,
    "SYSTEM",
    "Full refund of $435.00 processed",
    { amount: 43500 },
    ago(15 * DAY),
  );

  const disputeRefA = await db.dispute.create({
    data: {
      orderId: refA.id,
      reason: "ITEM_NOT_AS_DESCRIBED",
      source: "STANDARD",
      status: "RESOLVED_BUYER",
      buyerStatement:
        "The headphones were listed as GOOD condition but arrived with a broken left ear cup hinge and a deep scratch on the right side. None of this was disclosed in the listing.",
      sellerStatement:
        "The item was in good condition when I sent it. There must have been damage during transit.",
      adminNotes:
        "Listing described as GOOD condition with no mention of damage. Buyer photos clearly show hinge damage and deep scratch consistent with pre-existing damage, not transit damage. Seller dispatch photos not available. Ruling in buyer's favour.",
      resolution: "BUYER_WON",
      refundAmount: 43500,
      openedAt: ago(20 * DAY),
      sellerRespondedAt: ago(18 * DAY),
      resolvedAt: ago(15 * DAY),
    },
  });
  await db.disputeEvidence.createMany({
    data: [
      {
        disputeId: disputeRefA.id,
        uploadedBy: "BUYER",
        uploaderId: buyer1.id,
        r2Key: `disputes/${disputeRefA.id}/broken-hinge.webp`,
        fileType: "image",
        label: "Broken left ear cup hinge",
      },
      {
        disputeId: disputeRefA.id,
        uploadedBy: "BUYER",
        uploaderId: buyer1.id,
        r2Key: `disputes/${disputeRefA.id}/scratch.webp`,
        fileType: "image",
        label: "Deep scratch on right cup",
      },
      {
        disputeId: disputeRefA.id,
        uploadedBy: "SELLER",
        uploaderId: seller1.id,
        r2Key: `disputes/${disputeRefA.id}/seller-response.webp`,
        fileType: "image",
        label: "Seller claims transit damage",
      },
    ],
  });

  // refB: James vs Tom — auto-refunded, seller unresponsive
  const refB = await db.order.create({
    data: {
      buyerId: buyer2.id,
      sellerId: seller3.id,
      listingId: listingSoldSpeaker.id,
      itemNzd: 59900,
      shippingNzd: 1000,
      totalNzd: 60900,
      status: "REFUNDED",
      fulfillmentType: "SHIPPED",
      stripePaymentIntentId: "pi_test_refB",
      trackingNumber: "NZ700800901B",
      dispatchedAt: ago(18 * DAY),
      shippingName: "James Chen",
      shippingLine1: "45 Lambton Quay",
      shippingCity: "Wellington",
      shippingRegion: "Wellington",
      shippingPostcode: "6011",
      createdAt: ago(20 * DAY),
    },
  });
  await makeSnapshot(refB.id, listingSoldSpeaker, "Electronics");
  await makeEvent(
    refB.id,
    "ORDER_CREATED",
    buyer2.id,
    "BUYER",
    "Order placed",
    {},
    ago(20 * DAY),
  );
  await makeEvent(
    refB.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment held",
    {},
    ago(20 * DAY),
  );
  await makeEvent(
    refB.id,
    "DISPATCHED",
    seller3.id,
    "SELLER",
    "Dispatched",
    { courier: "NZ Post", trackingNumber: "NZ700800901B" },
    ago(18 * DAY),
  );
  await makeEvent(
    refB.id,
    "DISPUTE_OPENED",
    buyer2.id,
    "BUYER",
    "Buyer opened dispute: item not received",
    { reason: "ITEM_NOT_RECEIVED" },
    ago(12 * DAY),
  );
  await makeEvent(
    refB.id,
    "AUTO_RESOLVED",
    null,
    "SYSTEM",
    "Auto-resolved: seller unresponsive after 72 hours",
    {
      decision: "AUTO_REFUND",
      score: 75,
      factors: ["SELLER_UNRESPONSIVE_72H", "TRACKING_NO_MOVEMENT_7D"],
    },
    ago(9 * DAY),
  );
  await makeEvent(
    refB.id,
    "REFUNDED",
    null,
    "SYSTEM",
    "Full refund of $609.00 processed",
    { amount: 60900 },
    ago(8 * DAY),
  );

  await db.dispute.create({
    data: {
      orderId: refB.id,
      reason: "ITEM_NOT_RECEIVED",
      source: "STANDARD",
      status: "RESOLVED_BUYER",
      buyerStatement:
        "I have been waiting 18 days and the item has not arrived. Tracking shows no movement for 10 days.",
      autoResolutionScore: 75,
      autoResolutionReason:
        "Seller did not respond within 72 hours. Tracking shows no movement for 10+ days. Auto-refund triggered.",
      resolution: "BUYER_WON",
      refundAmount: 60900,
      openedAt: ago(12 * DAY),
      resolvedAt: ago(8 * DAY),
    },
  });

  // ── GROUP 6: CANCELLED orders ────────────────────────────────────────────

  // canA: Emma cancelled within free window
  const canA = await db.order.create({
    data: {
      buyerId: buyer3.id,
      sellerId: seller1.id,
      listingId: listingSoldWatch.id,
      itemNzd: 54900,
      shippingNzd: 500,
      totalNzd: 55400,
      status: "CANCELLED",
      fulfillmentType: "SHIPPED",
      stripePaymentIntentId: "pi_test_canA",
      cancelledBy: "BUYER",
      cancelReason: "Changed my mind — found a better deal locally",
      cancelledAt: ago(10 * DAY + 45 * MIN),
      shippingName: "Emma Thompson",
      shippingLine1: "8 Riccarton Road",
      shippingCity: "Christchurch",
      shippingRegion: "Canterbury",
      shippingPostcode: "8011",
      createdAt: ago(10 * DAY + 1 * HOUR),
    },
  });
  await makeSnapshot(canA.id, listingSoldWatch, "Electronics");
  await makeEvent(
    canA.id,
    "ORDER_CREATED",
    buyer3.id,
    "BUYER",
    "Order placed",
    {},
    ago(10 * DAY + 1 * HOUR),
  );
  await makeEvent(
    canA.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment held",
    {},
    ago(10 * DAY + 1 * HOUR),
  );
  await makeEvent(
    canA.id,
    "CANCEL_REQUESTED",
    buyer3.id,
    "BUYER",
    "Buyer requested cancellation within free window",
    { reason: "Changed my mind" },
    ago(10 * DAY + 45 * MIN),
  );
  await makeEvent(
    canA.id,
    "CANCEL_AUTO_APPROVED",
    null,
    "SYSTEM",
    "Cancellation auto-approved — within 60-minute window",
    {},
    ago(10 * DAY + 45 * MIN),
  );
  await makeEvent(
    canA.id,
    "CANCELLED",
    null,
    "SYSTEM",
    "Order cancelled, payment refunded",
    {},
    ago(10 * DAY + 45 * MIN),
  );

  // canB: James cancellation approved by seller
  const canB = await db.order.create({
    data: {
      buyerId: buyer2.id,
      sellerId: seller1.id,
      listingId: listingSoldHeadphones.id,
      itemNzd: 42900,
      shippingNzd: 600,
      totalNzd: 43500,
      status: "CANCELLED",
      fulfillmentType: "SHIPPED",
      stripePaymentIntentId: "pi_test_canB",
      cancelledBy: "BUYER",
      cancelReason: "Bought from another seller",
      cancelledAt: ago(8 * DAY),
      shippingName: "James Chen",
      shippingLine1: "45 Lambton Quay",
      shippingCity: "Wellington",
      shippingRegion: "Wellington",
      shippingPostcode: "6011",
      createdAt: ago(8 * DAY + 4 * HOUR),
    },
  });
  await makeSnapshot(canB.id, listingSoldHeadphones, "Electronics");
  await makeEvent(
    canB.id,
    "ORDER_CREATED",
    buyer2.id,
    "BUYER",
    "Order placed",
    {},
    ago(8 * DAY + 4 * HOUR),
  );
  await makeEvent(
    canB.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment held",
    {},
    ago(8 * DAY + 4 * HOUR),
  );
  await makeEvent(
    canB.id,
    "CANCEL_REQUESTED",
    buyer2.id,
    "BUYER",
    "Buyer requested cancellation — bought elsewhere",
    { reason: "Bought from another seller" },
    ago(8 * DAY + 2 * HOUR),
  );
  await makeEvent(
    canB.id,
    "CANCEL_APPROVED",
    seller1.id,
    "SELLER",
    "Seller approved cancellation",
    { note: "No worries, happy to cancel for you" },
    ago(8 * DAY + 1 * HOUR),
  );
  await makeEvent(
    canB.id,
    "CANCELLED",
    null,
    "SYSTEM",
    "Order cancelled, payment refunded",
    {},
    ago(8 * DAY),
  );

  // ── GROUP 7: PICKUP orders ────────────────────────────────────────────────

  // pickup1: Emma buying jacket from Aroha — ONLINE_PAYMENT_PICKUP, scheduling
  const pickup1 = await db.order.create({
    data: {
      buyerId: buyer3.id,
      sellerId: seller4.id,
      listingId: listingPickupSold.id,
      itemNzd: 17900,
      shippingNzd: 0,
      totalNzd: 17900,
      status: "AWAITING_PICKUP",
      fulfillmentType: "ONLINE_PAYMENT_PICKUP",
      stripePaymentIntentId: "pi_test_pickup1",
      pickupStatus: "SCHEDULING",
      rescheduleCount: 0,
      shippingName: "Emma Thompson",
      shippingLine1: "8 Riccarton Road",
      shippingCity: "Christchurch",
      shippingRegion: "Canterbury",
      shippingPostcode: "8011",
      createdAt: ago(2 * DAY),
    },
  });
  await makeSnapshot(pickup1.id, listingPickupSold, "Fashion");
  await makeEvent(
    pickup1.id,
    "ORDER_CREATED",
    buyer3.id,
    "BUYER",
    "Pickup order placed by Emma Thompson",
    {},
    ago(2 * DAY),
  );
  await makeEvent(
    pickup1.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment of $179.00 authorised and held",
    { amount: 17900 },
    ago(2 * DAY),
  );

  // Create message thread with pickup proposal
  const thread1 = await db.messageThread.create({
    data: {
      participant1Id: buyer3.id,
      participant2Id: seller4.id,
      listingId: listingPickupSold.id,
      lastMessageAt: ago(18 * HOUR),
    },
  });
  await db.message.create({
    data: {
      threadId: thread1.id,
      senderId: buyer3.id,
      body: JSON.stringify({
        type: "PICKUP_PROPOSAL",
        proposedBy: "BUYER",
        proposedTime: future(2 * DAY).toISOString(),
        location: "Tauranga City Centre",
      }),
      createdAt: ago(20 * HOUR),
    },
  });
  await db.message.create({
    data: {
      threadId: thread1.id,
      senderId: seller4.id,
      body: "Hi Emma! I can do that time. Works well for me. See you then!",
      createdAt: ago(18 * HOUR),
    },
  });

  // pickup2: James buying macrame from Aroha — OTP_INITIATED (test OTP = 123456)
  const pickup2 = await db.order.create({
    data: {
      buyerId: buyer2.id,
      sellerId: seller4.id,
      listingId: listingCopSold.id,
      itemNzd: 12900,
      shippingNzd: 0,
      totalNzd: 12900,
      status: "AWAITING_PICKUP",
      fulfillmentType: "ONLINE_PAYMENT_PICKUP",
      stripePaymentIntentId: "pi_test_pickup2",
      pickupStatus: "OTP_INITIATED",
      pickupScheduledAt: ago(30 * MIN),
      pickupWindowExpiresAt: future(30 * MIN),
      otpInitiatedAt: ago(5 * MIN),
      otpExpiresAt: future(25 * MIN),
      otpCodeHash: sha256("123456"),
      rescheduleCount: 0,
      shippingName: "James Chen",
      shippingLine1: "45 Lambton Quay",
      shippingCity: "Wellington",
      shippingRegion: "Wellington",
      shippingPostcode: "6011",
      createdAt: ago(1 * DAY),
    },
  });
  await makeSnapshot(pickup2.id, listingCopSold, "Collectibles");
  await makeEvent(
    pickup2.id,
    "ORDER_CREATED",
    buyer2.id,
    "BUYER",
    "Pickup order placed",
    {},
    ago(1 * DAY),
  );
  await makeEvent(
    pickup2.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment authorised and held",
    {},
    ago(1 * DAY),
  );
  await makeEvent(
    pickup2.id,
    "PICKUP_OTP_INITIATED",
    seller4.id,
    "SELLER",
    "Seller initiated pickup OTP — code sent to buyer via SMS",
    { otpSentTo: buyer2.phone },
    ago(5 * MIN),
  );

  // pickup3: Sarah with COP — cash on pickup, awaiting schedule
  const pickup3 = await db.order.create({
    data: {
      buyerId: buyer1.id,
      sellerId: seller4.id,
      listingId: listingCopFurniture.id,
      itemNzd: 55000,
      shippingNzd: 0,
      totalNzd: 55000,
      status: "AWAITING_PICKUP",
      fulfillmentType: "CASH_ON_PICKUP",
      stripePaymentIntentId: null,
      pickupStatus: "AWAITING_SCHEDULE",
      rescheduleCount: 0,
      shippingName: "Sarah Mitchell",
      shippingLine1: "12 Ponsonby Road",
      shippingCity: "Auckland",
      shippingRegion: "Auckland",
      shippingPostcode: "1011",
      createdAt: ago(1 * DAY),
    },
  });
  await makeSnapshot(pickup3.id, listingCopFurniture, "Home & Garden");
  await makeEvent(
    pickup3.id,
    "ORDER_CREATED",
    buyer1.id,
    "BUYER",
    "Cash on pickup order placed",
    {},
    ago(1 * DAY),
  );

  // Thread for COP order
  const thread3 = await db.messageThread.create({
    data: {
      participant1Id: buyer1.id,
      participant2Id: seller4.id,
      listingId: listingCopFurniture.id,
      lastMessageAt: ago(20 * HOUR),
    },
  });
  await db.message.create({
    data: {
      threadId: thread3.id,
      senderId: buyer1.id,
      body: "Hi! I am interested in the dining table. When can I come to view and pick it up?",
      createdAt: ago(22 * HOUR),
    },
  });
  await db.message.create({
    data: {
      threadId: thread3.id,
      senderId: seller4.id,
      body: "Hi Sarah! Happy to show you the table. I am available this weekend — Saturday or Sunday morning works well. Cash only please.",
      createdAt: ago(20 * HOUR),
      isRead: false,
    },
  });

  // pickup4: Completed pickup order (for history)
  const pickup4 = await db.order.create({
    data: {
      buyerId: buyer3.id,
      sellerId: seller4.id,
      listingId: listingPickupBike.id,
      itemNzd: 185000,
      shippingNzd: 0,
      totalNzd: 185000,
      status: "COMPLETED",
      fulfillmentType: "ONLINE_PAYMENT_PICKUP",
      stripePaymentIntentId: "pi_test_pickup4",
      pickupStatus: "COMPLETED",
      pickupScheduledAt: ago(5 * DAY),
      pickupWindowExpiresAt: ago(4 * DAY + 30 * HOUR),
      pickupConfirmedAt: ago(5 * DAY - 10 * MIN),
      rescheduleCount: 0,
      completedAt: ago(5 * DAY - 10 * MIN),
      shippingName: "Emma Thompson",
      shippingLine1: "8 Riccarton Road",
      shippingCity: "Christchurch",
      shippingRegion: "Canterbury",
      shippingPostcode: "8011",
      createdAt: ago(7 * DAY),
    },
  });
  await makeSnapshot(pickup4.id, listingPickupBike, "Sports & Outdoors");
  await makeEvent(
    pickup4.id,
    "ORDER_CREATED",
    buyer3.id,
    "BUYER",
    "Pickup order placed",
    {},
    ago(7 * DAY),
  );
  await makeEvent(
    pickup4.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment authorised",
    {},
    ago(7 * DAY),
  );
  await makeEvent(
    pickup4.id,
    "PICKUP_OTP_INITIATED",
    seller4.id,
    "SELLER",
    "OTP initiated at pickup",
    {},
    ago(5 * DAY),
  );
  await makeEvent(
    pickup4.id,
    "PICKUP_OTP_CONFIRMED",
    buyer3.id,
    "BUYER",
    "OTP confirmed — item collected",
    {},
    ago(5 * DAY - 10 * MIN),
  );
  await makeEvent(
    pickup4.id,
    "COMPLETED",
    null,
    "SYSTEM",
    "Pickup completed, payment captured and payout initiated",
    {},
    ago(5 * DAY - 10 * MIN),
  );

  console.log("✅ Orders created");

  return {
    comp1,
    comp2,
    comp3,
    disp1,
    disp2,
    ph1,
    ph2,
    dispA,
    dispB,
    disputeA,
    disputeB,
    refA,
    refB,
    canA,
    canB,
    pickup1,
    pickup2,
    pickup3,
    pickup4,
  };
}

// ─── Trust Metrics ───────────────────────────────────────────────────────────

async function seedTrustMetrics(users: Awaited<ReturnType<typeof seedUsers>>) {
  console.log("🛡️  Creating trust metrics...");
  const { buyer1, buyer2, buyer3, seller1, seller2, seller3, seller4 } = users;

  const metrics = [
    {
      userId: buyer1.id,
      totalOrders: 8,
      completedOrders: 6,
      disputeCount: 1,
      disputeRate: 12.5,
      disputesLast30Days: 0,
      averageResponseHours: 2,
      averageRating: null as number | null,
      dispatchPhotoRate: 0,
      accountAgeDays: 30,
    },
    {
      userId: buyer2.id,
      totalOrders: 5,
      completedOrders: 2,
      disputeCount: 2,
      disputeRate: 40.0,
      disputesLast30Days: 2,
      averageResponseHours: null as number | null,
      averageRating: null as number | null,
      dispatchPhotoRate: 0,
      accountAgeDays: 20,
    },
    {
      userId: buyer3.id,
      totalOrders: 4,
      completedOrders: 3,
      disputeCount: 0,
      disputeRate: 0,
      disputesLast30Days: 0,
      averageResponseHours: null as number | null,
      averageRating: null as number | null,
      dispatchPhotoRate: 0,
      accountAgeDays: 15,
    },
    {
      userId: seller1.id,
      totalOrders: 55,
      completedOrders: 52,
      disputeCount: 2,
      disputeRate: 3.6,
      disputesLast30Days: 0,
      averageResponseHours: 3,
      averageRating: 4.7,
      dispatchPhotoRate: 90,
      accountAgeDays: 90,
    },
    {
      userId: seller2.id,
      totalOrders: 0,
      completedOrders: 0,
      disputeCount: 0,
      disputeRate: 0,
      disputesLast30Days: 0,
      averageResponseHours: null as number | null,
      averageRating: null as number | null,
      dispatchPhotoRate: 0,
      accountAgeDays: 10,
    },
    {
      userId: seller3.id,
      totalOrders: 12,
      completedOrders: 7,
      disputeCount: 4,
      disputeRate: 33.3,
      disputesLast30Days: 2,
      averageResponseHours: 48,
      averageRating: 3.2,
      dispatchPhotoRate: 30,
      accountAgeDays: 60,
      isFlaggedForFraud: false,
    },
    {
      userId: seller4.id,
      totalOrders: 18,
      completedOrders: 17,
      disputeCount: 0,
      disputeRate: 0,
      disputesLast30Days: 0,
      averageResponseHours: 2,
      averageRating: 4.9,
      dispatchPhotoRate: 100,
      accountAgeDays: 45,
    },
  ];

  for (const m of metrics) {
    await db.trustMetrics.create({ data: m });
  }

  console.log(`✅ ${metrics.length} trust metric records created`);
}

// ─── Reviews ─────────────────────────────────────────────────────────────────

async function seedReviews(
  users: Awaited<ReturnType<typeof seedUsers>>,
  orders: Awaited<ReturnType<typeof seedOrders>>,
) {
  console.log("⭐ Creating reviews...");
  const { buyer1, buyer2, seller1 } = users;
  const { comp1, comp2, comp3 } = orders;

  const rev1 = await db.review.create({
    data: {
      orderId: comp1.id,
      subjectId: seller1.id,
      authorId: buyer1.id,
      reviewerRole: "BUYER",
      rating: 50,
      comment:
        "Excellent seller! Headphones were exactly as described, well packaged and arrived quickly. Mike responded promptly to my questions before purchase. Would definitely buy from again.",
      reply:
        "Thank you Sarah! Really glad the headphones arrived safely and you're happy with them. Enjoy!",
      repliedAt: ago(13 * DAY),
      isApproved: true,
      createdAt: ago(14 * DAY),
    },
  });
  await db.reviewTag.createMany({
    data: [
      { reviewId: rev1.id, tag: "FAST_SHIPPING" },
      { reviewId: rev1.id, tag: "ACCURATE_DESCRIPTION" },
      { reviewId: rev1.id, tag: "GREAT_PACKAGING" },
      { reviewId: rev1.id, tag: "AS_DESCRIBED" },
    ],
  });

  const rev2 = await db.review.create({
    data: {
      orderId: comp2.id,
      subjectId: seller1.id,
      authorId: buyer1.id,
      reviewerRole: "BUYER",
      rating: 45,
      comment:
        "Great camera, well described. Took a couple of extra days to dispatch but Mike kept me updated. Camera is in the condition described and works perfectly.",
      isApproved: true,
      createdAt: ago(11 * DAY),
    },
  });
  await db.reviewTag.createMany({
    data: [
      { reviewId: rev2.id, tag: "ACCURATE_DESCRIPTION" },
      { reviewId: rev2.id, tag: "QUICK_COMMUNICATION" },
    ],
  });

  const rev3 = await db.review.create({
    data: {
      orderId: comp3.id,
      subjectId: seller1.id,
      authorId: buyer2.id,
      reviewerRole: "BUYER",
      rating: 50,
      comment:
        "Perfect transaction. Watch arrived in immaculate condition as described. Fast shipping and great packaging.",
      reply: "Thank you James! Happy to help anytime.",
      repliedAt: ago(5 * DAY),
      isApproved: true,
      createdAt: ago(6 * DAY),
    },
  });
  await db.reviewTag.createMany({
    data: [
      { reviewId: rev3.id, tag: "FAST_SHIPPING" },
      { reviewId: rev3.id, tag: "GREAT_PACKAGING" },
      { reviewId: rev3.id, tag: "AS_DESCRIBED" },
    ],
  });

  console.log("✅ 3 reviews created");
}

// ─── Payouts ─────────────────────────────────────────────────────────────────

async function seedPayouts(
  users: Awaited<ReturnType<typeof seedUsers>>,
  orders: Awaited<ReturnType<typeof seedOrders>>,
) {
  console.log("💸 Creating payouts...");
  const { seller1, seller3, seller4 } = users;
  const { comp1, comp2, comp3, ph1, disp2, pickup4 } = orders;

  const platformFee = (total: number) => Math.floor(total * 0.1);
  const stripeFee = (total: number) => Math.floor(total * 0.029 + 30);
  const net = (total: number) => total - platformFee(total) - stripeFee(total);

  const payoutsData = [
    {
      orderId: comp1.id,
      userId: seller1.id,
      total: 43500,
      status: "PAID" as const,
      paidAt: ago(12 * DAY),
      stripeTransferId: "tr_test_comp1",
    },
    {
      orderId: comp2.id,
      userId: seller1.id,
      total: 290900,
      status: "PAID" as const,
      paidAt: ago(9 * DAY),
      stripeTransferId: "tr_test_comp2",
    },
    {
      orderId: comp3.id,
      userId: seller1.id,
      total: 55400,
      status: "PAID" as const,
      paidAt: ago(4 * DAY),
      stripeTransferId: "tr_test_comp3",
    },
    {
      orderId: ph1.id,
      userId: seller3.id,
      total: 150700,
      status: "PENDING" as const,
      paidAt: null as Date | null,
      stripeTransferId: null as string | null,
    },
    {
      orderId: disp2.id,
      userId: seller3.id,
      total: 60900,
      status: "PENDING" as const,
      paidAt: null as Date | null,
      stripeTransferId: null as string | null,
    },
    {
      orderId: pickup4.id,
      userId: seller4.id,
      total: 185000,
      status: "PAID" as const,
      paidAt: ago(4 * DAY),
      stripeTransferId: "tr_test_pickup4",
    },
  ];

  for (const p of payoutsData) {
    await db.payout.create({
      data: {
        orderId: p.orderId,
        userId: p.userId,
        amountNzd: net(p.total),
        platformFeeNzd: platformFee(p.total),
        stripeFeeNzd: stripeFee(p.total),
        status: p.status,
        stripeTransferId: p.stripeTransferId,
        initiatedAt: p.status === "PAID" ? ago(15 * DAY) : null,
        paidAt: p.paidAt,
      },
    });
  }

  console.log(`✅ ${payoutsData.length} payouts created`);
}

// ─── Offers ──────────────────────────────────────────────────────────────────

async function seedOffers(
  users: Awaited<ReturnType<typeof seedUsers>>,
  listings: Awaited<ReturnType<typeof seedListings>>,
) {
  console.log("🤝 Creating offers...");
  const { buyer1, buyer2, buyer3, seller1, seller3 } = users;
  const { listingMacbook, listingIphone, listingKayak, listingTent } = listings;

  await db.offer.createMany({
    data: [
      {
        listingId: listingMacbook.id,
        buyerId: buyer1.id,
        sellerId: seller1.id,
        amountNzd: 265000,
        note: "Would you take $2,650? I can pay immediately.",
        status: "PENDING",
        expiresAt: future(2 * DAY),
        createdAt: ago(3 * HOUR),
      },
      {
        listingId: listingIphone.id,
        buyerId: buyer2.id,
        sellerId: seller1.id,
        amountNzd: 175000,
        note: "Happy to pay $1,750 — firm.",
        status: "PENDING",
        expiresAt: future(1 * DAY),
        createdAt: ago(5 * HOUR),
      },
      {
        listingId: listingKayak.id,
        buyerId: buyer3.id,
        sellerId: seller3.id,
        amountNzd: 82000,
        note: "Would you accept $820?",
        status: "ACCEPTED",
        expiresAt: future(2 * DAY),
        paymentDeadlineAt: future(1 * DAY),
        respondedAt: ago(2 * HOUR),
        createdAt: ago(1 * DAY),
      },
      {
        listingId: listingTent.id,
        buyerId: buyer1.id,
        sellerId: seller3.id,
        amountNzd: 38000,
        note: "Can you do $380?",
        status: "DECLINED",
        expiresAt: future(1 * DAY),
        respondedAt: ago(4 * HOUR),
        declineReason:
          "Sorry, lowest I can do is $450 — it's a great tent worth every cent.",
        createdAt: ago(1 * DAY),
      },
      {
        listingId: listingMacbook.id,
        buyerId: buyer2.id,
        sellerId: seller1.id,
        amountNzd: 250000,
        status: "EXPIRED",
        expiresAt: ago(1 * HOUR),
        createdAt: ago(3 * DAY),
      },
    ],
  });

  console.log("✅ 5 offers created");
}

// ─── Messages ────────────────────────────────────────────────────────────────

async function seedMessages(
  users: Awaited<ReturnType<typeof seedUsers>>,
  listings: Awaited<ReturnType<typeof seedListings>>,
) {
  console.log("💬 Creating messages...");
  const { buyer1, buyer2, seller1, seller3 } = users;
  const { listingMacbook, listingKayak } = listings;

  const t1 = await db.messageThread.create({
    data: {
      participant1Id: buyer1.id,
      participant2Id: seller1.id,
      listingId: listingMacbook.id,
      lastMessageAt: ago(2 * HOUR),
    },
  });
  await db.message.createMany({
    data: [
      {
        threadId: t1.id,
        senderId: buyer1.id,
        body: "Hi! What is the battery health on the MacBook?",
        createdAt: ago(5 * HOUR),
      },
      {
        threadId: t1.id,
        senderId: seller1.id,
        body: "Hi Sarah! Battery health is 97% — barely used. It is a fantastic machine.",
        isRead: true,
        readAt: ago(4 * HOUR),
        createdAt: ago(4 * HOUR),
      },
      {
        threadId: t1.id,
        senderId: buyer1.id,
        body: "That is great. Would you take $2,700?",
        createdAt: ago(3 * HOUR),
      },
      {
        threadId: t1.id,
        senderId: seller1.id,
        body: "I could do $2,750 — that is my best price. It is worth it!",
        isRead: false,
        createdAt: ago(2 * HOUR),
      },
    ],
  });

  const t2 = await db.messageThread.create({
    data: {
      participant1Id: buyer2.id,
      participant2Id: seller3.id,
      listingId: listingKayak.id,
      lastMessageAt: ago(1 * DAY),
    },
  });
  await db.message.createMany({
    data: [
      {
        threadId: t2.id,
        senderId: buyer2.id,
        body: "Hi! Does the kayak come with a paddle? And how old are the hatches?",
        createdAt: ago(1 * DAY + 3 * HOUR),
      },
      {
        threadId: t2.id,
        senderId: seller3.id,
        body: "Yes it comes with a Werner paddle worth $300. Hatches are original and seal well. Had it 3 years but it is stored inside.",
        isRead: true,
        readAt: ago(1 * DAY + 1 * HOUR),
        createdAt: ago(1 * DAY + 2 * HOUR),
      },
      {
        threadId: t2.id,
        senderId: buyer2.id,
        body: "Great, that sounds good. Can I come to view it this weekend?",
        createdAt: ago(1 * DAY + 1 * HOUR),
      },
      {
        threadId: t2.id,
        senderId: seller3.id,
        body: "Sure, Saturday morning works. I am in Queenstown. Let me know what time suits.",
        isRead: false,
        createdAt: ago(1 * DAY),
      },
    ],
  });

  console.log("✅ 2 message threads, 8 messages created");
}

// ─── Watchlist ────────────────────────────────────────────────────────────────

async function seedWatchlist(
  users: Awaited<ReturnType<typeof seedUsers>>,
  listings: Awaited<ReturnType<typeof seedListings>>,
) {
  console.log("👀 Creating watchlist items...");
  const { buyer1, buyer2, buyer3 } = users;
  const {
    listingMacbook,
    listingIphone,
    listingKayak,
    listingTent,
    listingSamsungTv,
    listingPickupBike,
  } = listings;

  await db.watchlistItem.createMany({
    data: [
      {
        userId: buyer1.id,
        listingId: listingIphone.id,
        priceAtWatch: 189900,
        isPriceAlertEnabled: true,
        createdAt: ago(2 * DAY),
      },
      {
        userId: buyer1.id,
        listingId: listingSamsungTv.id,
        priceAtWatch: 159900,
        isPriceAlertEnabled: true,
        createdAt: ago(3 * DAY),
      },
      {
        userId: buyer2.id,
        listingId: listingMacbook.id,
        priceAtWatch: 289900,
        isPriceAlertEnabled: true,
        createdAt: ago(1 * DAY),
      },
      {
        userId: buyer2.id,
        listingId: listingKayak.id,
        priceAtWatch: 89900,
        isPriceAlertEnabled: false,
        createdAt: ago(4 * DAY),
      },
      {
        userId: buyer3.id,
        listingId: listingTent.id,
        priceAtWatch: 49900,
        isPriceAlertEnabled: true,
        createdAt: ago(2 * DAY),
      },
      {
        userId: buyer3.id,
        listingId: listingPickupBike.id,
        priceAtWatch: 185000,
        isPriceAlertEnabled: true,
        createdAt: ago(1 * DAY),
      },
    ],
  });

  console.log("✅ 6 watchlist items created");
}

// ─── Order Interactions ───────────────────────────────────────────────────────

async function seedInteractions(
  users: Awaited<ReturnType<typeof seedUsers>>,
  orders: Awaited<ReturnType<typeof seedOrders>>,
) {
  console.log("🤝 Creating order interactions...");
  const { buyer1, buyer2 } = users;
  const { ph2, disp1 } = orders;

  await db.orderInteraction.createMany({
    data: [
      {
        orderId: ph2.id,
        type: "CANCEL_REQUEST",
        status: "PENDING",
        initiatedById: buyer1.id,
        initiatorRole: "BUYER",
        reason:
          "The seller has not dispatched after 2 days. I need this for work and have found another option.",
        expiresAt: future(24 * HOUR),
        autoAction: "AUTO_ESCALATE",
        createdAt: ago(3 * HOUR),
      },
      {
        orderId: disp1.id,
        type: "RETURN_REQUEST",
        status: "PENDING",
        initiatedById: buyer2.id,
        initiatorRole: "BUYER",
        reason:
          "Item has not arrived after 7 days. Estimated delivery was 4 days ago.",
        expiresAt: future(48 * HOUR),
        autoAction: "AUTO_ESCALATE",
        createdAt: ago(1 * HOUR),
      },
    ],
  });

  console.log("✅ 2 order interactions created");
}

// ─── Notifications ────────────────────────────────────────────────────────────

async function seedNotifications(
  users: Awaited<ReturnType<typeof seedUsers>>,
  orders: Awaited<ReturnType<typeof seedOrders>>,
) {
  console.log("🔔 Creating notifications...");
  const {
    buyer1,
    buyer2,
    buyer3,
    seller1,
    seller2,
    seller3,
    seller4,
    superAdmin,
    disputesAdmin,
  } = users;
  const { comp1, ph1, dispA, dispB, pickup1, pickup2, refA } = orders;

  await db.notification.createMany({
    data: [
      // Buyer notifications
      {
        userId: buyer1.id,
        type: "ORDER_COMPLETED",
        title: "Order completed",
        body: "Your order for Sony WH-1000XM5 Headphones has been completed.",
        link: `/orders/${comp1.id}`,
        orderId: comp1.id,
        createdAt: ago(14 * DAY),
      },
      {
        userId: buyer1.id,
        type: "ORDER_DISPUTED",
        title: "Dispute update",
        body: "Your dispute for Sony WH-1000XM5 Headphones has been resolved in your favour. A full refund is being processed.",
        link: `/orders/${refA.id}`,
        orderId: refA.id,
        createdAt: ago(15 * DAY),
      },
      {
        userId: buyer2.id,
        type: "ORDER_DISPUTED",
        title: "Dispute opened",
        body: "Your dispute has been received. The seller has 72 hours to respond.",
        link: `/orders/${dispA.id}`,
        orderId: dispA.id,
        createdAt: ago(1 * DAY),
      },
      {
        userId: buyer3.id,
        type: "ORDER_PLACED",
        title: "Pickup order placed",
        body: "Your pickup order has been placed. Arrange a pickup time with the seller.",
        link: `/orders/${pickup1.id}`,
        orderId: pickup1.id,
        isRead: false,
        createdAt: ago(2 * DAY),
      },
      {
        userId: buyer2.id,
        type: "SYSTEM",
        title: "Pickup OTP ready",
        body: "Your seller has initiated pickup confirmation. Check your SMS for the 6-digit code.",
        link: `/orders/${pickup2.id}`,
        orderId: pickup2.id,
        isRead: false,
        createdAt: ago(5 * MIN),
      },
      // Seller notifications
      {
        userId: seller1.id,
        type: "ORDER_PLACED",
        title: "New order received",
        body: "Sarah Mitchell has purchased your Sony WH-1000XM5 Headphones.",
        link: `/orders/${comp1.id}`,
        orderId: comp1.id,
        isRead: true,
        createdAt: ago(22 * DAY),
      },
      {
        userId: seller3.id,
        type: "ORDER_PLACED",
        title: "New order received",
        body: "Emma Thompson has purchased your iPad Pro 12.9-inch.",
        link: `/orders/${ph1.id}`,
        orderId: ph1.id,
        isRead: false,
        createdAt: ago(3 * HOUR),
      },
      {
        userId: seller3.id,
        type: "ORDER_DISPUTED",
        title: "Dispute opened against you",
        body: "James Chen has opened a dispute for your iPad Pro 12.9-inch order. Please respond within 72 hours.",
        link: `/orders/${dispA.id}`,
        orderId: dispA.id,
        isRead: false,
        createdAt: ago(1 * DAY),
      },
      {
        userId: seller1.id,
        type: "ORDER_DISPUTED",
        title: "Dispute opened against you",
        body: "Emma Thompson has opened a dispute for your Sonos Move 2 order.",
        link: `/orders/${dispB.id}`,
        orderId: dispB.id,
        isRead: false,
        createdAt: ago(5 * DAY),
      },
      {
        userId: seller2.id,
        type: "LISTING_NEEDS_CHANGES",
        title: "Action required on your listing",
        body: "Your listing 'Kids Bike 20 inch' needs changes before it can go live.",
        isRead: false,
        createdAt: ago(3 * HOUR),
      },
      {
        userId: seller4.id,
        type: "ORDER_PLACED",
        title: "New pickup order",
        body: "Emma Thompson has placed a pickup order for your Kathmandu Epiq Down Jacket.",
        link: `/orders/${pickup1.id}`,
        orderId: pickup1.id,
        isRead: false,
        createdAt: ago(2 * DAY),
      },
      // Admin notifications
      {
        userId: superAdmin.id,
        type: "SYSTEM",
        title: "New listing in moderation queue",
        body: "A high-risk listing (score: 80) has been flagged for review.",
        link: "/admin/listings",
        isRead: false,
        createdAt: ago(1 * HOUR),
      },
      {
        userId: disputesAdmin.id,
        type: "SYSTEM",
        title: "New dispute requiring review",
        body: "James Chen has opened a dispute for an iPad Pro order. Seller has not responded.",
        isRead: false,
        createdAt: ago(1 * DAY),
      },
      {
        userId: superAdmin.id,
        type: "SYSTEM",
        title: "Seller high dispute rate alert",
        body: "Tom Wilson (tom_outdoors) has a dispute rate of 33.3% — above the 15% downgrade threshold.",
        link: "/admin/sellers",
        isRead: false,
        createdAt: ago(6 * HOUR),
      },
    ],
  });

  console.log("✅ 14 notifications created");
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────

async function seedAuditLogs(
  users: Awaited<ReturnType<typeof seedUsers>>,
  orders: Awaited<ReturnType<typeof seedOrders>>,
  listings: Awaited<ReturnType<typeof seedListings>>,
) {
  console.log("📝 Creating audit logs...");
  const {
    buyer1,
    buyer2,
    seller1,
    seller2,
    seller3,
    superAdmin,
    disputesAdmin,
  } = users;

  await db.auditLog.createMany({
    data: [
      {
        userId: buyer1.id,
        action: "USER_REGISTER",
        entityType: "User",
        entityId: buyer1.id,
        createdAt: ago(30 * DAY),
      },
      {
        userId: seller1.id,
        action: "SELLER_TERMS_ACCEPTED",
        entityType: "User",
        entityId: seller1.id,
        createdAt: ago(88 * DAY),
      },
      {
        userId: superAdmin.id,
        action: "SELLER_VERIFICATION_APPROVED",
        entityType: "User",
        entityId: seller1.id,
        metadata: { action: "approve_id_verification" },
        createdAt: ago(80 * DAY),
      },
      {
        userId: buyer1.id,
        action: "ORDER_CREATED",
        entityType: "Order",
        entityId: orders.comp1.id,
        createdAt: ago(22 * DAY),
      },
      {
        userId: buyer2.id,
        action: "DISPUTE_OPENED",
        entityType: "Order",
        entityId: orders.dispA.id,
        createdAt: ago(1 * DAY),
      },
      {
        userId: disputesAdmin.id,
        action: "DISPUTE_RESOLVED",
        entityType: "Order",
        entityId: orders.refA.id,
        metadata: { favour: "buyer", refundAmount: 43500 },
        createdAt: ago(15 * DAY),
      },
      {
        userId: seller1.id,
        action: "LISTING_CREATED",
        entityType: "Listing",
        entityId: listings.listingMacbook.id,
        createdAt: ago(8 * DAY),
      },
      {
        userId: seller2.id,
        action: "LISTING_CREATED",
        entityType: "Listing",
        entityId: listings.listingPendingReview.id,
        createdAt: ago(2 * HOUR),
      },
      {
        userId: superAdmin.id,
        action: "LISTING_NEEDS_CHANGES",
        entityType: "Listing",
        entityId: listings.listingNeedsChanges.id,
        metadata: { reason: "Short description and insufficient photos" },
        createdAt: ago(3 * HOUR),
      },
      {
        userId: buyer1.id,
        action: "USER_LOGIN",
        entityType: "User",
        entityId: buyer1.id,
        createdAt: ago(1 * HOUR),
      },
      {
        userId: seller3.id,
        action: "USER_LOGIN",
        entityType: "User",
        entityId: seller3.id,
        createdAt: ago(2 * HOUR),
      },
      {
        userId: superAdmin.id,
        action: "PLATFORM_CONFIG_UPDATED",
        entityType: "PlatformConfig",
        entityId: "seller.tier.gold.min_sales",
        metadata: {
          oldValue: "50",
          newValue: "50",
          label: "Gold tier — min sales",
        },
        createdAt: ago(5 * DAY),
      },
    ],
  });

  console.log("✅ 12 audit log entries created");
}

// ─── Reports ──────────────────────────────────────────────────────────────────

async function seedReports(
  users: Awaited<ReturnType<typeof seedUsers>>,
  listings: Awaited<ReturnType<typeof seedListings>>,
) {
  console.log("🚩 Creating reports...");
  const { buyer1, buyer2, seller3, superAdmin } = users;
  const { listingHighRisk, listingKayak } = listings;

  await db.report.createMany({
    data: [
      {
        reporterId: buyer1.id,
        listingId: listingHighRisk.id,
        reason: "COUNTERFEIT",
        description:
          "This Rolex listing looks suspicious. The price seems too low for a genuine Rolex Submariner and the photos appear to be stock images. Requesting verification.",
        status: "OPEN",
        createdAt: ago(1 * HOUR),
      },
      {
        reporterId: buyer2.id,
        targetUserId: seller3.id,
        reason: "SCAM",
        description:
          "I had a very bad experience with this seller. My item was not as described and they have been unresponsive to my dispute. I believe they may be operating fraudulently based on their dispute history.",
        status: "REVIEWING",
        createdAt: ago(3 * DAY),
      },
      {
        reporterId: buyer1.id,
        listingId: listingKayak.id,
        reason: "SPAM",
        description: "This listing seems to have been reposted multiple times.",
        status: "RESOLVED",
        resolvedBy: superAdmin.id,
        resolvedAt: ago(2 * DAY),
        resolvedNote:
          "Verified with seller — this is the first and only listing for this item. Report dismissed.",
        createdAt: ago(4 * DAY),
      },
    ],
  });

  console.log("✅ 3 reports created");
}

// ─── Verification Applications ────────────────────────────────────────────────

async function seedVerificationApplications(
  users: Awaited<ReturnType<typeof seedUsers>>,
) {
  console.log("🔐 Creating verification applications...");
  const { seller1, seller4, superAdmin } = users;

  await db.verificationApplication.create({
    data: {
      sellerId: seller1.id,
      status: "APPROVED",
      appliedAt: ago(82 * DAY),
      reviewedAt: ago(80 * DAY),
      reviewedBy: superAdmin.id,
      adminNotes:
        "All documents verified. Passport matches face in selfie. Approved.",
      documentType: "PASSPORT",
      documentFrontKey: `verifications/${seller1.id}/passport-front.webp`,
      selfieKey: `verifications/${seller1.id}/selfie.webp`,
    },
  });

  await db.verificationApplication.create({
    data: {
      sellerId: seller4.id,
      status: "APPROVED",
      appliedAt: ago(42 * DAY),
      reviewedAt: ago(40 * DAY),
      reviewedBy: superAdmin.id,
      adminNotes: "Drivers licence verified. Selfie matches. Approved.",
      documentType: "DRIVERS_LICENSE",
      documentFrontKey: `verifications/${seller4.id}/licence-front.webp`,
      documentBackKey: `verifications/${seller4.id}/licence-back.webp`,
      selfieKey: `verifications/${seller4.id}/selfie.webp`,
    },
  });

  console.log("✅ 2 verification applications created");
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  await wipeDatabase();
  await seedCategories();
  const users = await seedUsers();
  const listings = await seedListings(users);
  const orders = await seedOrders(users, listings);
  await seedTrustMetrics(users);
  await seedReviews(users, orders);
  await seedPayouts(users, orders);
  await seedOffers(users, listings);
  await seedMessages(users, listings);
  await seedWatchlist(users, listings);
  await seedInteractions(users, orders);
  await seedNotifications(users, orders);
  await seedAuditLogs(users, orders, listings);
  await seedReports(users, listings);
  await seedVerificationApplications(users);

  // Platform config and dynamic lists
  const { seedPlatformConfig } =
    await import("../src/lib/platform-config/config-seed");
  await seedPlatformConfig(db as never);

  const { seedDynamicLists } =
    await import("../src/lib/dynamic-lists/dynamic-list-seed");
  await seedDynamicLists(db as never);

  // Final counts
  const [
    userCount,
    listingCount,
    orderCount,
    disputeCount,
    evidenceCount,
    snapshotCount,
    eventCount,
    reviewCount,
    offerCount,
    messageCount,
    payoutCount,
    configCount,
    listItemCount,
  ] = await Promise.all([
    db.user.count(),
    db.listing.count(),
    db.order.count(),
    db.dispute.count(),
    db.disputeEvidence.count(),
    db.listingSnapshot.count(),
    db.orderEvent.count(),
    db.review.count(),
    db.offer.count(),
    db.message.count(),
    db.payout.count(),
    db.platformConfig.count(),
    db.dynamicListItem.count(),
  ]);

  const pickupCount = await db.order.count({
    where: { fulfillmentType: { not: "SHIPPED" } },
  });
  const disputedCount = await db.order.count({
    where: { status: "DISPUTED" },
  });
  const pendingListings = await db.listing.count({
    where: { status: "PENDING_REVIEW" },
  });

  console.log(`
════════════════════════════════════════════════════════════
🛒  Buyzi seed complete!
════════════════════════════════════════════════════════════
Users:                  ${userCount} (3 buyers, 4 sellers, 4 admins)
Listings:               ${listingCount}
  └─ Pending review:    ${pendingListings}
Orders:                 ${orderCount}
  └─ Pickup orders:     ${pickupCount}
  └─ Disputed:          ${disputedCount}
Disputes:               ${disputeCount}
Dispute Evidence:       ${evidenceCount}
Listing Snapshots:      ${snapshotCount}
Order Events:           ${eventCount}
Reviews:                ${reviewCount}
Offers:                 ${offerCount}
Messages:               ${messageCount}
Payouts:                ${payoutCount}
Platform Config:        ${configCount} keys
Dynamic List Items:     ${listItemCount}
════════════════════════════════════════════════════════════

Test accounts seeded — do NOT log credentials here (CI logs are retained).
  Check .env.local or docs/DEVELOPMENT.md for test account details.
  Do not run this seed against a production database.
════════════════════════════════════════════════════════════
  `);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
