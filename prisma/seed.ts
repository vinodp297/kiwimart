// prisma/seed.ts
// ─── KiwiMart Comprehensive Dev/Test Seed ───────────────────────────────────
// Creates a fully functional demo environment with realistic NZ marketplace data.
// Covers: users, listings (135+), orders (all statuses), disputes, reviews,
// offers, messages, notifications, watchlist, interactions, order events, payouts.
// Run: npx prisma db seed

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const adapter = new PrismaPg({
  connectionString:
    process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL!,
});
const db = new PrismaClient({ adapter });

// ── Helpers ─────────────────────────────────────────────────────────────────

async function hash(password: string): Promise<string> {
  const { hashPassword } = await import("../src/server/lib/password");
  return hashPassword(password);
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms);
const future = (ms: number) => new Date(Date.now() + ms);

function img(id: string): string {
  return `https://images.unsplash.com/${id}?w=800&h=600&fit=crop`;
}

// ── Wipe (reverse dependency order) ─────────────────────────────────────────

async function wipeDatabase() {
  console.log("🗑️  Wiping database...");
  await db.orderEvent.deleteMany();
  await db.orderInteraction.deleteMany();
  await db.notification.deleteMany();
  await db.auditLog.deleteMany();
  await db.report.deleteMany();
  await db.blockedUser.deleteMany();
  await db.adminInvitation.deleteMany();
  await db.phoneVerificationToken.deleteMany();
  await db.stripeEvent.deleteMany();
  await db.message.deleteMany();
  await db.messageThread.deleteMany();
  await db.reviewTag.deleteMany();
  await db.review.deleteMany();
  await db.offer.deleteMany();
  await db.payout.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.watchlistItem.deleteMany();
  await db.cartItem.deleteMany();
  await db.cart.deleteMany();
  await db.listingPriceHistory.deleteMany();
  await db.recentlyViewed.deleteMany();
  await db.listingAttribute.deleteMany();
  await db.listingImage.deleteMany();
  await db.listing.deleteMany();
  await db.verificationApplication.deleteMany();
  await db.passwordResetToken.deleteMany();
  await db.emailVerificationToken.deleteMany();
  await db.session.deleteMany();
  await db.account.deleteMany();
  await db.subcategory.deleteMany();
  await db.category.deleteMany();
  await db.user.deleteMany();
  await db.verificationToken.deleteMany();
  console.log("✅ Database wiped");
}

// ── Categories ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  {
    id: "electronics",
    name: "Electronics",
    icon: "💻",
    slug: "electronics",
    displayOrder: 1,
    subcategories: [
      "Mobile Phones",
      "Computers",
      "Tablets",
      "Audio",
      "Cameras & Drones",
      "TV & Home Theatre",
    ],
  },
  {
    id: "fashion",
    name: "Fashion",
    icon: "👗",
    slug: "fashion",
    displayOrder: 2,
    subcategories: [
      "Women's Clothing",
      "Men's Clothing",
      "Shoes",
      "Bags & Accessories",
      "Jackets & Coats",
      "Jewellery",
    ],
  },
  {
    id: "home-garden",
    name: "Home & Garden",
    icon: "🏡",
    slug: "home-garden",
    displayOrder: 3,
    subcategories: [
      "Furniture",
      "Appliances",
      "BBQs & Outdoor",
      "Garden & Landscaping",
      "Kitchen",
      "Lighting",
    ],
  },
  {
    id: "sports",
    name: "Sports & Outdoors",
    icon: "🏉",
    slug: "sports",
    displayOrder: 4,
    subcategories: [
      "Cycling",
      "Running & Fitness",
      "Water Sports",
      "Snow Sports",
      "Camping & Hiking",
      "Golf",
    ],
  },
  {
    id: "property",
    name: "Property",
    icon: "🏘️",
    slug: "property",
    displayOrder: 6,
    subcategories: ["Rentals", "For Sale", "Flatmates"],
  },
  {
    id: "baby-kids",
    name: "Baby & Kids",
    icon: "🍼",
    slug: "baby-kids",
    displayOrder: 7,
    subcategories: [
      "Baby Gear",
      "Children's Clothing",
      "Toys & Games",
      "Books",
      "Nursery Furniture",
    ],
  },
  {
    id: "collectibles",
    name: "Collectibles",
    icon: "🏺",
    slug: "collectibles",
    displayOrder: 8,
    subcategories: [
      "Art",
      "Sports Memorabilia",
      "Coins & Stamps",
      "Antiques",
      "Books & Comics",
    ],
  },
  {
    id: "business",
    name: "Tools & Equipment",
    icon: "🔧",
    slug: "business",
    displayOrder: 9,
    subcategories: [
      "Power Tools",
      "Hand Tools",
      "Office Furniture",
      "Industrial Equipment",
      "Safety Equipment",
    ],
  },
];

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  await wipeDatabase();

  // ── Categories ──────────────────────────────────────────────────────────

  console.log("\n📂 Creating categories...");
  for (const cat of CATEGORIES) {
    const { subcategories, ...catData } = cat;
    await db.category.create({ data: catData });
    for (const subName of subcategories) {
      const slug = subName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      await db.subcategory.create({
        data: { categoryId: cat.id, name: subName, slug },
      });
    }
  }
  console.log(`✅ ${CATEGORIES.length} categories created`);

  // ── Passwords ───────────────────────────────────────────────────────────

  console.log("\n🔑 Hashing passwords...");
  const [buyerHash, sellerHash, adminHash] = await Promise.all([
    hash("BuyerPass123!"),
    hash("SellerPass123!"),
    hash("AdminPass123!"),
  ]);

  // ══════════════════════════════════════════════════════════════════════════
  // USERS
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n👤 Creating users...");

  // ── Buyers ──────────────────────────────────────────────────────────────

  const sarah = await db.user.create({
    data: {
      email: "sarah@kiwimart.test",
      username: "sarah_mitchell",
      displayName: "Sarah Mitchell",
      passwordHash: buyerHash,
      emailVerified: ago(45 * DAY),
      phoneVerified: true,
      phoneVerifiedAt: ago(40 * DAY),
      onboardingCompleted: true,
      onboardingIntent: "BUY",
      region: "Auckland",
      suburb: "Ponsonby",
      agreedTermsAt: ago(45 * DAY),
    },
  });

  const james = await db.user.create({
    data: {
      email: "james@kiwimart.test",
      username: "james_cooper",
      displayName: "James Cooper",
      passwordHash: buyerHash,
      emailVerified: ago(15 * DAY),
      onboardingCompleted: true,
      onboardingIntent: "BUY",
      region: "Wellington",
      suburb: "Te Aro",
      agreedTermsAt: ago(15 * DAY),
    },
  });

  const emma = await db.user.create({
    data: {
      email: "emma@kiwimart.test",
      username: "emma_wilson",
      displayName: "Emma Wilson",
      passwordHash: buyerHash,
      emailVerified: ago(30 * DAY),
      phoneVerified: true,
      phoneVerifiedAt: ago(25 * DAY),
      onboardingCompleted: true,
      onboardingIntent: "BOTH",
      region: "Christchurch",
      suburb: "Riccarton",
      agreedTermsAt: ago(30 * DAY),
    },
  });

  // ── Sellers ─────────────────────────────────────────────────────────────

  const mike = await db.user.create({
    data: {
      email: "techhub@kiwimart.test",
      username: "techhub_nz",
      displayName: "TechHub NZ",
      passwordHash: sellerHash,
      emailVerified: ago(90 * DAY),
      phoneVerified: true,
      phoneVerifiedAt: ago(85 * DAY),
      idVerified: true,
      idVerifiedAt: ago(80 * DAY),
      idSubmittedAt: ago(82 * DAY),
      bio: "Auckland's trusted electronics store. All items tested and verified. Fast tracked shipping NZ-wide. 100+ happy customers.",
      sellerEnabled: true,
      stripeOnboarded: true,
      stripeAccountId: "acct_1RTestTechHubNZ001",
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      sellerTermsAcceptedAt: ago(90 * DAY),
      onboardingCompleted: true,
      onboardingIntent: "SELL",
      region: "Auckland",
      suburb: "Newmarket",
      agreedTermsAt: ago(90 * DAY),
      isVerifiedSeller: true,
      verifiedSellerAt: ago(70 * DAY),
    },
  });

  const rachel = await db.user.create({
    data: {
      email: "kiwihome@kiwimart.test",
      username: "kiwi_home_style",
      displayName: "Kiwi Home & Style",
      passwordHash: sellerHash,
      emailVerified: ago(60 * DAY),
      phoneVerified: true,
      phoneVerifiedAt: ago(55 * DAY),
      bio: "Curated homewares, collectibles, and unique finds. Based in Wellington — local pickup welcome. Quality guaranteed.",
      sellerEnabled: true,
      stripeOnboarded: true,
      stripeAccountId: "acct_1RTestKiwiHome0002",
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      sellerTermsAcceptedAt: ago(60 * DAY),
      onboardingCompleted: true,
      onboardingIntent: "SELL",
      region: "Wellington",
      suburb: "Kelburn",
      agreedTermsAt: ago(60 * DAY),
    },
  });

  const tom = await db.user.create({
    data: {
      email: "peak@kiwimart.test",
      username: "peak_outdoors",
      displayName: "Peak Outdoors",
      passwordHash: sellerHash,
      emailVerified: ago(50 * DAY),
      phoneVerified: true,
      phoneVerifiedAt: ago(45 * DAY),
      idVerified: true,
      idVerifiedAt: ago(40 * DAY),
      idSubmittedAt: ago(42 * DAY),
      bio: "Everything for the NZ outdoor lifestyle. Cycling, camping, water sports, snow gear. Based in Queenstown.",
      sellerEnabled: true,
      stripeOnboarded: true,
      stripeAccountId: "acct_1RTestPeakOutdr003",
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      sellerTermsAcceptedAt: ago(50 * DAY),
      onboardingCompleted: true,
      onboardingIntent: "SELL",
      region: "Otago",
      suburb: "Queenstown",
      agreedTermsAt: ago(50 * DAY),
      isVerifiedSeller: true,
      verifiedSellerAt: ago(35 * DAY),
    },
  });

  const aroha = await db.user.create({
    data: {
      email: "stylenz@kiwimart.test",
      username: "style_nz",
      displayName: "StyleNZ",
      passwordHash: sellerHash,
      emailVerified: ago(20 * DAY),
      bio: "Fashion-forward clothing, accessories, and kids' essentials. New stock added weekly. Hamilton-based.",
      sellerEnabled: true,
      stripeOnboarded: true,
      stripeAccountId: "acct_1RTestStyleNZ00004",
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      sellerTermsAcceptedAt: ago(20 * DAY),
      onboardingCompleted: true,
      onboardingIntent: "SELL",
      region: "Waikato",
      suburb: "Hamilton Central",
      agreedTermsAt: ago(20 * DAY),
    },
  });

  // ── Admins ──────────────────────────────────────────────────────────────

  await db.user.create({
    data: {
      email: "admin@kiwimart.test",
      username: "admin",
      displayName: "Super Admin",
      passwordHash: adminHash,
      emailVerified: ago(120 * DAY),
      isAdmin: true,
      adminRole: "SUPER_ADMIN",
      onboardingCompleted: true,
      region: "Auckland",
      suburb: "Auckland CBD",
      agreedTermsAt: ago(120 * DAY),
    },
  });

  await db.user.create({
    data: {
      email: "disputes@kiwimart.test",
      username: "disputes_admin",
      displayName: "Dispute Manager",
      passwordHash: adminHash,
      emailVerified: ago(90 * DAY),
      isAdmin: true,
      adminRole: "DISPUTES_ADMIN",
      onboardingCompleted: true,
      region: "Wellington",
      suburb: "Wellington CBD",
      agreedTermsAt: ago(90 * DAY),
    },
  });

  await db.user.create({
    data: {
      email: "content@kiwimart.test",
      username: "content_admin",
      displayName: "Content Moderator",
      passwordHash: adminHash,
      emailVerified: ago(60 * DAY),
      isAdmin: true,
      adminRole: "TRUST_SAFETY_ADMIN",
      onboardingCompleted: true,
      region: "Auckland",
      suburb: "Auckland CBD",
      agreedTermsAt: ago(60 * DAY),
    },
  });

  await db.user.create({
    data: {
      email: "finance@kiwimart.test",
      username: "finance_admin",
      displayName: "Finance Admin",
      passwordHash: adminHash,
      emailVerified: ago(90 * DAY),
      isAdmin: true,
      adminRole: "FINANCE_ADMIN",
      onboardingCompleted: true,
      region: "Auckland",
      suburb: "Auckland CBD",
      agreedTermsAt: ago(90 * DAY),
    },
  });

  console.log("✅ 11 users created (3 buyers, 4 sellers, 4 admins)");

  // ══════════════════════════════════════════════════════════════════════════
  // LISTINGS
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n🛍️  Creating listings...");

  type LD = Parameters<typeof db.listing.create>[0]["data"];
  async function L(
    data: LD,
    imgs: string[],
    attrs?: [string, string][],
  ): Promise<string> {
    const listing = await db.listing.create({ data });
    for (let i = 0; i < imgs.length; i++) {
      await db.listingImage.create({
        data: {
          listingId: listing.id,
          r2Key: imgs[i]!,
          thumbnailKey: imgs[i]!,
          altText: listing.title,
          order: i,
          scanned: true,
          safe: true,
        },
      });
    }
    if (attrs) {
      for (let i = 0; i < attrs.length; i++) {
        await db.listingAttribute.create({
          data: {
            listingId: listing.id,
            label: attrs[i]![0],
            value: attrs[i]![1],
            order: i,
          },
        });
      }
    }
    return listing.id;
  }

  // Helper for common listing fields
  const active = (
    sellerId: string,
    title: string,
    desc: string,
    priceNzd: number,
    cond: "NEW" | "LIKE_NEW" | "GOOD" | "FAIR",
    catId: string,
    sub: string,
    region: string,
    suburb: string,
    shipping: "COURIER" | "PICKUP" | "BOTH" = "COURIER",
    shippingNzd = 0,
    daysAgo = 7,
  ): LD => ({
    sellerId,
    title,
    description: desc,
    priceNzd,
    condition: cond,
    status: "ACTIVE",
    categoryId: catId,
    subcategoryName: sub,
    region,
    suburb,
    shippingOption: shipping,
    shippingNzd,
    offersEnabled: true,
    shipsNationwide: shipping !== "PICKUP",
    viewCount: Math.floor(Math.random() * 500) + 20,
    watcherCount: Math.floor(Math.random() * 20),
    publishedAt: ago(daysAgo * DAY),
    expiresAt: future(30 * DAY),
  });

  // ── ELECTRONICS (18) — seller: mike (TechHub NZ) ───────────────────────

  const iphone = await L(
    active(
      mike.id,
      "iPhone 15 Pro 256GB Natural Titanium",
      "Purchased 4 months ago, upgrading to 16 Pro. Flawless condition, no scratches. Includes original box, cable, and unused case. Battery health 98%. Unlocked to all NZ networks.",
      159900,
      "LIKE_NEW",
      "electronics",
      "Mobile Phones",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1592750475338-74b7b21085ab"),
      img("photo-1510557880182-3d4d3cba35a5"),
    ],
    [
      ["Storage", "256GB"],
      ["Colour", "Natural Titanium"],
      ["Battery Health", "98%"],
    ],
  );

  const macbook = await L(
    active(
      mike.id,
      'MacBook Pro 14" M3 Pro 18GB/512GB',
      "M3 Pro chip, 18GB unified memory, 512GB SSD. Used for 6 months for software dev. Excellent condition with minor desk wear on bottom. AppleCare+ until March 2027.",
      299900,
      "LIKE_NEW",
      "electronics",
      "Computers",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1517336714731-489689fd1ca8"),
      img("photo-1541807084-5c52b6b3adef"),
    ],
    [
      ["Chip", "M3 Pro"],
      ["RAM", "18GB"],
      ["Storage", "512GB SSD"],
    ],
  );

  await L(
    active(
      mike.id,
      "Samsung Galaxy S24 Ultra 256GB",
      "Brand new sealed. NZ stock with full Samsung warranty. Titanium Black.",
      189900,
      "NEW",
      "electronics",
      "Mobile Phones",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1610945415295-d9bbf067e59c"),
      img("photo-1598327106026-d9521da673d1"),
    ],
    [
      ["Storage", "256GB"],
      ["Colour", "Titanium Black"],
      ["Warranty", "2 years"],
    ],
  );

  const headphones = await L(
    active(
      mike.id,
      "Sony WH-1000XM5 Noise Cancelling",
      "Best-in-class ANC headphones. Used for 3 months, prefer over-ear. Comes with carry case, cable, and charging adapter.",
      39900,
      "LIKE_NEW",
      "electronics",
      "Audio",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1505740420928-5e560c06d30e"),
      img("photo-1583394838336-acd977736f90"),
    ],
    [
      ["Type", "Over-ear"],
      ["ANC", "Yes"],
      ["Battery", "30 hours"],
    ],
  );

  await L(
    active(
      mike.id,
      "iPad Air M2 256GB Space Grey",
      "Barely used, bought for uni but switched to laptop. Includes Apple Pencil Pro and Logitech keyboard case.",
      119900,
      "LIKE_NEW",
      "electronics",
      "Tablets",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1544244015-0df4b3ffc6b0"),
      img("photo-1589739900243-4b52cd9b104e"),
    ],
    [
      ["Chip", "M2"],
      ["Storage", "256GB"],
      ["Includes", "Pencil + Keyboard"],
    ],
  );

  const gamingPC = await L(
    active(
      mike.id,
      "Custom Gaming PC RTX 4070 Ti Super",
      "Built 8 months ago. Ryzen 7 7800X3D, 32GB DDR5, 1TB NVMe, NZXT H5 case. Runs everything at 1440p max. Selling because moving overseas.",
      249900,
      "GOOD",
      "electronics",
      "Computers",
      "Auckland",
      "Newmarket",
      "PICKUP",
    ),
    [
      img("photo-1587202372775-e229f172b9d7"),
      img("photo-1593640408182-31c70c8268f5"),
    ],
    [
      ["CPU", "Ryzen 7 7800X3D"],
      ["GPU", "RTX 4070 Ti Super"],
      ["RAM", "32GB DDR5"],
    ],
  );

  const djiDrone = await L(
    active(
      mike.id,
      "DJI Mini 4 Pro Fly More Combo",
      "Complete kit with 3 batteries, charging hub, carry bag. Registered with CAA. Under 250g — no licence needed. Perfect for travel.",
      129900,
      "LIKE_NEW",
      "electronics",
      "Cameras & Drones",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1508614589041-895b88991e3e"),
      img("photo-1473968512647-3e447244af8f"),
    ],
    [
      ["Weight", "249g"],
      ["Max Flight", "34 min"],
      ["Video", "4K/60fps"],
    ],
  );

  await L(
    active(
      mike.id,
      'LG C3 55" 4K OLED TV',
      "Stunning picture quality. Wall-mounted for 6 months, no stand marks. Includes original stand and remote. Perfect for PS5/Xbox.",
      149900,
      "LIKE_NEW",
      "electronics",
      "TV & Home Theatre",
      "Auckland",
      "Newmarket",
      "BOTH",
      5000,
    ),
    [
      img("photo-1593359677879-a4bb92f829d1"),
      img("photo-1461151304267-38535e780c79"),
    ],
    [
      ["Size", '55"'],
      ["Panel", "OLED"],
      ["Resolution", "4K"],
    ],
  );

  await L(
    active(
      mike.id,
      "Apple AirPods Pro 2nd Gen USB-C",
      "Sealed box. NZ Apple warranty. Latest USB-C model with adaptive audio and conversation awareness.",
      39900,
      "NEW",
      "electronics",
      "Audio",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1600294037681-c80b4cb5b434"),
      img("photo-1606220588913-b3aacb4d2f46"),
    ],
  );

  await L(
    active(
      mike.id,
      "Canon EOS R50 Mirrorless Body",
      "Compact mirrorless camera. 24.2MP APS-C sensor. Great for vlogging and travel photography. Includes battery grip and spare battery.",
      119900,
      "GOOD",
      "electronics",
      "Cameras & Drones",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1516035069371-29a1b244cc32"),
      img("photo-1502920917128-1aa500764cbd"),
    ],
    [
      ["Sensor", "24.2MP APS-C"],
      ["Video", "4K/30fps"],
      ["Weight", "375g"],
    ],
  );

  await L(
    active(
      mike.id,
      "PS5 Slim Digital Edition + 2 Controllers",
      "PS5 Slim digital edition. Includes extra DualSense controller. All cables and original packaging. Updated to latest firmware.",
      59900,
      "GOOD",
      "electronics",
      "Computers",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1606813907291-d86efa9b94db"),
      img("photo-1621259182978-fbf93132d53d"),
    ],
  );

  await L(
    active(
      mike.id,
      "Bose SoundLink Max Bluetooth Speaker",
      "Brand new. Premium portable speaker with deep bass. 20-hour battery life. IP67 waterproof.",
      49900,
      "NEW",
      "electronics",
      "Audio",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1608043152269-423dbba4e7e1"),
      img("photo-1589003077984-894e133dabab"),
    ],
  );

  // Additional electronics to reach ~18
  await L(
    active(
      mike.id,
      "Apple Watch Ultra 2 49mm",
      "Titanium case, orange Alpine loop. Used for trail running, minor strap wear. Full Apple warranty remaining.",
      109900,
      "GOOD",
      "electronics",
      "Mobile Phones",
      "Auckland",
      "Newmarket",
    ),
    [img("photo-1546868871-af0de0ae72be")],
  );
  await L(
    active(
      mike.id,
      "Samsung Galaxy Tab S9 FE 128GB",
      "Great Android tablet for media and light productivity. Includes S Pen and Book Cover case.",
      54900,
      "LIKE_NEW",
      "electronics",
      "Tablets",
      "Auckland",
      "Newmarket",
    ),
    [img("photo-1585790050230-5dd28404ccb9")],
  );
  await L(
    active(
      mike.id,
      "Sonos Beam Gen 2 Soundbar",
      "Dolby Atmos soundbar. Used in bedroom for 4 months. Excellent condition with wall mount bracket included.",
      54900,
      "LIKE_NEW",
      "electronics",
      "TV & Home Theatre",
      "Auckland",
      "Newmarket",
    ),
    [img("photo-1545454675-3531b543be5d")],
  );
  await L(
    active(
      mike.id,
      "Logitech MX Master 3S Mouse",
      "Premium wireless mouse. Used for 2 months, switching to trackpad. Includes USB-C dongle.",
      12900,
      "LIKE_NEW",
      "electronics",
      "Computers",
      "Auckland",
      "Newmarket",
    ),
    [img("photo-1527864550417-7fd91fc51a46")],
  );
  await L(
    active(
      mike.id,
      "GoPro Hero 12 Black Creator Edition",
      "Action camera with media mod, light mod, and Volta grip. Perfect for adventure filming in NZ.",
      79900,
      "GOOD",
      "electronics",
      "Cameras & Drones",
      "Auckland",
      "Newmarket",
    ),
    [img("photo-1564466809058-bf4114d55352")],
  );
  await L(
    active(
      mike.id,
      "JBL Charge 5 Portable Speaker",
      "Rugged Bluetooth speaker. Great for beach trips. Deep bass, 20hr battery. Teal colour.",
      17900,
      "GOOD",
      "electronics",
      "Audio",
      "Auckland",
      "Newmarket",
    ),
    [img("photo-1558089687-f282d8132f0c")],
  );

  // ── FASHION (18) — seller: aroha (StyleNZ) ─────────────────────────────

  const treneryCoat = await L(
    active(
      aroha.id,
      "Trenery Wool Blend Coat Camel Size 10",
      "Beautiful camel coat from Trenery. Worn twice, like new. Double-breasted with satin lining. Perfect for Wellington winters.",
      24900,
      "LIKE_NEW",
      "fashion",
      "Women's Clothing",
      "Waikato",
      "Hamilton Central",
    ),
    [
      img("photo-1539533113208-f6df8cc8b543"),
      img("photo-1591047139829-d91aecb6caea"),
    ],
    [
      ["Brand", "Trenery"],
      ["Size", "10"],
      ["Material", "Wool Blend"],
    ],
  );

  await L(
    active(
      aroha.id,
      "Lululemon Align Leggings Black Size 6",
      'High-waisted Align 25". Buttery soft Nulu fabric. Worn a handful of times, no pilling.',
      8900,
      "LIKE_NEW",
      "fashion",
      "Women's Clothing",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1506629082955-511b1aa562c8")],
    [
      ["Brand", "Lululemon"],
      ["Size", "6"],
      ["Style", 'Align 25"'],
    ],
  );
  await L(
    active(
      aroha.id,
      "Allbirds Tree Runners Men's US11",
      "Sustainable sneakers in Natural White. Lightweight and breathable. Perfect summer shoe.",
      11900,
      "GOOD",
      "fashion",
      "Shoes",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1542291026-7eec264c27ff")],
    [
      ["Brand", "Allbirds"],
      ["Size", "US 11"],
      ["Colour", "Natural White"],
    ],
  );
  await L(
    active(
      aroha.id,
      "R.M. Williams Comfort Craftsman Boots",
      "Classic RM Williams Chelsea boots in Chestnut. Size 9. Recently re-soled. A lifetime boot.",
      34900,
      "GOOD",
      "fashion",
      "Shoes",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1638247025967-b4e38f787b76")],
    [
      ["Brand", "R.M. Williams"],
      ["Size", "9"],
      ["Colour", "Chestnut"],
    ],
  );
  await L(
    active(
      aroha.id,
      "Kathmandu Epiq Down Jacket Men's L",
      "800+ fill power down jacket. Incredibly warm and packable. Navy blue, large.",
      14900,
      "LIKE_NEW",
      "fashion",
      "Jackets & Coats",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1551028719-00167b16eac5")],
    [
      ["Brand", "Kathmandu"],
      ["Size", "L"],
      ["Fill", "800+ RDS Down"],
    ],
  );
  const nikeAF1 = await L(
    active(
      aroha.id,
      "Nike Air Force 1 '07 White Men's US10",
      "Classic AF1 in triple white. Worn 3 times. Still box-fresh looking with original box and tissue.",
      13900,
      "LIKE_NEW",
      "fashion",
      "Shoes",
      "Waikato",
      "Hamilton Central",
    ),
    [
      img("photo-1600269452121-4f2416e55c28"),
      img("photo-1595950653106-6c9ebd614d3a"),
    ],
    [
      ["Brand", "Nike"],
      ["Size", "US 10"],
      ["Colour", "Triple White"],
    ],
  );
  await L(
    active(
      aroha.id,
      "Coach Tabby Shoulder Bag Brass/Black",
      "Gorgeous leather bag. Used for one season. Minor patina on hardware. Comes with dust bag.",
      44900,
      "GOOD",
      "fashion",
      "Bags & Accessories",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1590874103328-eac38a683ce7")],
    [
      ["Brand", "Coach"],
      ["Style", "Tabby 26"],
      ["Material", "Leather"],
    ],
  );
  await L(
    active(
      aroha.id,
      "Pandora Moments Charm Bracelet Silver",
      "Sterling silver bracelet with 6 charms including NZ fern and kiwi bird. 19cm.",
      19900,
      "GOOD",
      "fashion",
      "Jewellery",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1515562141207-7a88fb7ce338")],
  );
  await L(
    active(
      aroha.id,
      "Icebreaker Merino 260 Base Layer M",
      "Men's merino base layer top. Perfect for skiing or hiking. Black, medium.",
      8900,
      "GOOD",
      "fashion",
      "Men's Clothing",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1576566588028-4147f3842f27")],
  );
  await L(
    active(
      aroha.id,
      "Country Road Linen Shirt Women's 12",
      "Beautiful linen shirt in dusty blue. Relaxed fit, perfect for summer.",
      5900,
      "LIKE_NEW",
      "fashion",
      "Women's Clothing",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1596755094514-f87e34085b2c")],
  );
  await L(
    active(
      aroha.id,
      "Patagonia Better Sweater Fleece L",
      "Classic quarter-zip fleece in Industrial Green. Great layering piece.",
      12900,
      "GOOD",
      "fashion",
      "Jackets & Coats",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1591047139829-d91aecb6caea")],
  );
  await L(
    active(
      aroha.id,
      "Seiko Presage Cocktail Time SRPB43",
      "Automatic dress watch with stunning blue sunburst dial. 40.5mm case. Worn gently.",
      54900,
      "GOOD",
      "fashion",
      "Jewellery",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1524592094714-0f0654e20314")],
    [
      ["Brand", "Seiko"],
      ["Movement", "Automatic"],
      ["Case", "40.5mm"],
    ],
  );
  await L(
    active(
      aroha.id,
      "Herschel Retreat Backpack Ash Rose",
      "Stylish daily backpack. Laptop sleeve, water bottle pocket. Used for one semester.",
      7900,
      "GOOD",
      "fashion",
      "Bags & Accessories",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1553062407-98eeb64c6a62")],
  );
  await L(
    active(
      aroha.id,
      "Adidas Ultraboost 23 Women's US8",
      "Cloud-white Ultraboost. Incredibly comfortable. Run about 50km in them.",
      14900,
      "GOOD",
      "fashion",
      "Shoes",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1560769629-975ec94e6a86")],
  );
  await L(
    active(
      aroha.id,
      "Glassons Linen Pants Beige Size 10",
      "High-waisted wide-leg linen pants. Perfect condition, only tried on.",
      3500,
      "LIKE_NEW",
      "fashion",
      "Women's Clothing",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1594938298603-c8148c4dae35")],
  );
  await L(
    active(
      aroha.id,
      "AS Colour Staple Tee 5-Pack Men's L",
      "Five plain tees (black, white, grey, navy, olive). Brand new in packaging.",
      4900,
      "NEW",
      "fashion",
      "Men's Clothing",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1521572163474-6864f9cf17ab")],
  );
  await L(
    active(
      aroha.id,
      "Karen Walker Harvest Sunglasses",
      "Iconic KW frames in Crazy Tortoise. Comes with original case.",
      17900,
      "GOOD",
      "fashion",
      "Bags & Accessories",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1511499767150-a48a237f0083")],
  );
  await L(
    active(
      aroha.id,
      "The North Face Nuptse Vest Women's M",
      "700-fill down vest in TNF Black. Warm and stylish for autumn.",
      16900,
      "LIKE_NEW",
      "fashion",
      "Jackets & Coats",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1544966503-7cc5ac882d5e")],
  );

  // ── HOME & GARDEN (18) — seller: rachel (Kiwi Home & Style) ───────────

  const danishSofa = await L(
    active(
      rachel.id,
      "Danish Design 3-Seater Sofa Grey Linen",
      "Stunning mid-century sofa. Solid oak frame with grey linen upholstery. Bought from Freedom 2 years ago. Very comfortable and in great condition.",
      129900,
      "GOOD",
      "home-garden",
      "Furniture",
      "Wellington",
      "Kelburn",
      "PICKUP",
    ),
    [
      img("photo-1555041469-a586c61ea9bc"),
      img("photo-1493663284031-b7e3aefcae8e"),
    ],
    [
      ["Style", "Mid-century"],
      ["Seats", "3"],
      ["Material", "Linen/Oak"],
    ],
  );

  const kitchenaid = await L(
    active(
      rachel.id,
      "KitchenAid Artisan Stand Mixer Empire Red",
      "5-quart tilt-head mixer. Used maybe 20 times. Includes paddle, whisk, and dough hook. Empire Red colour.",
      59900,
      "LIKE_NEW",
      "home-garden",
      "Appliances",
      "Wellington",
      "Kelburn",
    ),
    [
      img("photo-1594385208974-2e75f8d7bb48"),
      img("photo-1578985545062-69928b1d9587"),
    ],
    [
      ["Capacity", "5 Quart"],
      ["Colour", "Empire Red"],
      ["Watts", "300W"],
    ],
  );

  await L(
    active(
      rachel.id,
      "Dyson V15 Detect Absolute",
      "Top-of-line Dyson with laser dust detection. All attachments included. Battery holds full charge — about 60 min runtime.",
      79900,
      "GOOD",
      "home-garden",
      "Appliances",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1558618666-fcd25c85f82e")],
    [
      ["Type", "Cordless Stick"],
      ["Runtime", "60 min"],
      ["Laser", "Yes"],
    ],
  );
  await L(
    active(
      rachel.id,
      "Weber Spirit II E-310 Gas BBQ",
      "3-burner gas BBQ. Used for two summers. Excellent condition with cover. LP gas bottle NOT included.",
      69900,
      "GOOD",
      "home-garden",
      "BBQs & Outdoor",
      "Wellington",
      "Kelburn",
      "PICKUP",
    ),
    [img("photo-1555041469-a586c61ea9bc")],
    [
      ["Burners", "3"],
      ["Fuel", "LPG"],
      ["Includes", "Cover"],
    ],
  );
  await L(
    active(
      rachel.id,
      "Tom Dixon Beat Floor Lamp Brass",
      "Statement floor lamp in brushed brass. Creates beautiful ambient light. Minor patina adds character.",
      89900,
      "GOOD",
      "home-garden",
      "Lighting",
      "Wellington",
      "Kelburn",
      "BOTH",
      4000,
    ),
    [img("photo-1507473885765-e6ed057ab6fe")],
    [
      ["Brand", "Tom Dixon"],
      ["Finish", "Brass"],
      ["Height", "168cm"],
    ],
  );
  await L(
    active(
      rachel.id,
      "Breville Barista Express Espresso Machine",
      "Semi-automatic espresso machine with built-in grinder. Makes cafe-quality coffee. Includes tamper and milk jug.",
      49900,
      "GOOD",
      "home-garden",
      "Kitchen",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1510707577719-ae7c14805e3a")],
    [
      ["Brand", "Breville"],
      ["Type", "Semi-auto"],
      ["Grinder", "Built-in"],
    ],
  );
  await L(
    active(
      rachel.id,
      "Stihl Battery Hedge Trimmer HSA 56",
      "Cordless hedge trimmer. Battery and charger included. Great for small-medium hedges.",
      29900,
      "GOOD",
      "home-garden",
      "Garden & Landscaping",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1416879595882-3373a0480b5b")],
  );
  await L(
    active(
      rachel.id,
      "Le Creuset Dutch Oven 5.3L Marseille Blue",
      "Iconic French oven. Used but well-maintained. Enamel interior in good condition. Heavy and built to last.",
      34900,
      "GOOD",
      "home-garden",
      "Kitchen",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1585515320310-259814833e62")],
    [
      ["Brand", "Le Creuset"],
      ["Size", "5.3L"],
      ["Colour", "Marseille Blue"],
    ],
  );
  await L(
    active(
      rachel.id,
      "Philips Hue Starter Kit (4 Bulbs + Bridge)",
      "Smart lighting starter pack. 4 colour bulbs and Hue Bridge. Control from phone or voice assistant.",
      19900,
      "LIKE_NEW",
      "home-garden",
      "Lighting",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1558618666-fcd25c85f82e")],
  );
  await L(
    active(
      rachel.id,
      "Outdoor Dining Set — 6 Seater Acacia Wood",
      "Solid acacia wood table with 6 chairs. Weather-treated. Perfect for NZ summers.",
      89900,
      "GOOD",
      "home-garden",
      "BBQs & Outdoor",
      "Wellington",
      "Kelburn",
      "PICKUP",
    ),
    [img("photo-1600585152220-90363fe7e115")],
  );
  await L(
    active(
      rachel.id,
      "IKEA MALM Bed Frame Queen White",
      "Queen bed frame in white. Includes slatted base. Used for 1 year in spare room. Easy to disassemble.",
      24900,
      "GOOD",
      "home-garden",
      "Furniture",
      "Wellington",
      "Kelburn",
      "PICKUP",
    ),
    [img("photo-1505693416388-ac5ce068fe85")],
  );
  await L(
    active(
      rachel.id,
      "Fisher & Paykel 8kg Front Load Washer",
      "Reliable washing machine. 8kg capacity. Works perfectly, selling because upgrading.",
      44900,
      "GOOD",
      "home-garden",
      "Appliances",
      "Wellington",
      "Kelburn",
      "PICKUP",
    ),
    [img("photo-1626806787461-102c1bfaaea1")],
  );
  await L(
    active(
      rachel.id,
      "Raised Garden Bed Kit Cedar 1200x600",
      "Cedar raised garden bed. Easy assembly, no tools needed. Perfect for veggies or herbs.",
      14900,
      "NEW",
      "home-garden",
      "Garden & Landscaping",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1416879595882-3373a0480b5b")],
  );
  await L(
    active(
      rachel.id,
      "Bodum Pour Over Coffee Maker 1L",
      "Beautiful glass and cork coffee maker. Makes excellent filter coffee. Brand new in box.",
      5900,
      "NEW",
      "home-garden",
      "Kitchen",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1495474472287-4d71bcdd2085")],
  );
  await L(
    active(
      rachel.id,
      "String Lights Outdoor 20m Warm White",
      "Festoon-style string lights. Weatherproof IP65. 20 metres with 40 bulbs. Creates magical ambience.",
      4900,
      "NEW",
      "home-garden",
      "Lighting",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1513836279014-a89f7a76ae86")],
  );
  await L(
    active(
      rachel.id,
      "Velvet Armchair Emerald Green",
      "Stunning emerald green velvet armchair. Gold legs. Perfect reading nook chair.",
      39900,
      "LIKE_NEW",
      "home-garden",
      "Furniture",
      "Wellington",
      "Kelburn",
      "PICKUP",
    ),
    [img("photo-1567538096630-e0c55bd6374c")],
  );
  await L(
    active(
      rachel.id,
      "Gardena Smart System Water Control",
      "WiFi-connected irrigation controller. Pairs with Gardena app. Never used — wrong system for our garden.",
      12900,
      "NEW",
      "home-garden",
      "Garden & Landscaping",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1416879595882-3373a0480b5b")],
  );
  await L(
    active(
      rachel.id,
      "Tramontina 12-Piece Cookware Set",
      "Professional grade stainless steel cookware. Tri-ply base for even heating. Brand new, received as duplicate gift.",
      24900,
      "NEW",
      "home-garden",
      "Kitchen",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1556909114-f6e7ad7d3136")],
  );

  // ── SPORTS & OUTDOORS (18) — seller: tom (Peak Outdoors) ──────────────

  const trekBike = await L(
    active(
      tom.id,
      "Trek Marlin 7 Mountain Bike Large 2024",
      "Hardtail MTB. Shimano Deore 1x10, RockShox Judy fork, hydraulic disc brakes. Ridden about 500km on Queenstown trails. Size large.",
      149900,
      "GOOD",
      "sports",
      "Cycling",
      "Otago",
      "Queenstown",
    ),
    [
      img("photo-1576435728678-68d0fbf94e91"),
      img("photo-1511994298241-608e28f14fde"),
    ],
    [
      ["Frame", "Alpha Gold Aluminium"],
      ["Fork", "RockShox Judy"],
      ["Gears", "Shimano Deore 1x10"],
    ],
  );

  const kayak = await L(
    active(
      tom.id,
      "Perception Pescador Pro 12 Sit-On-Top Kayak",
      "Fishing/touring kayak. Incredibly stable and comfortable. Includes paddle, PFD, and rod holders. Transported on roof rack.",
      149900,
      "GOOD",
      "sports",
      "Water Sports",
      "Otago",
      "Queenstown",
      "PICKUP",
    ),
    [
      img("photo-1570710891163-6d3b5c47248b"),
      img("photo-1604537529428-15bcbeecfe4d"),
    ],
    [
      ["Length", "12ft"],
      ["Weight", "27kg"],
      ["Capacity", "170kg"],
    ],
  );

  await L(
    active(
      tom.id,
      "Garmin Forerunner 265 GPS Watch",
      "Running watch with AMOLED display. Tracks everything: HR, VO2max, training load. 13-day battery in smartwatch mode.",
      54900,
      "LIKE_NEW",
      "sports",
      "Running & Fitness",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1523275335684-37898b6baf30")],
    [
      ["Display", "AMOLED"],
      ["GPS", "Multi-band"],
      ["Battery", "13 days"],
    ],
  );
  await L(
    active(
      tom.id,
      "Rossignol Experience 82 Skis 176cm",
      "All-mountain skis with Look Express 11 bindings. Great for Queenstown resorts. Used for 2 seasons.",
      44900,
      "GOOD",
      "sports",
      "Snow Sports",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1551698618-1dfe5d97d256")],
    [
      ["Length", "176cm"],
      ["Bindings", "Look Express 11"],
      ["Ability", "Intermediate-Advanced"],
    ],
  );
  await L(
    active(
      tom.id,
      "MSR Hubba Hubba NX 2-Person Tent",
      "Ultralight backpacking tent. 1.54kg packed. Freestanding, excellent ventilation. Used for about 15 nights.",
      44900,
      "GOOD",
      "sports",
      "Camping & Hiking",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1504280390367-361c6d9f38f4")],
    [
      ["Weight", "1.54kg"],
      ["Capacity", "2-person"],
      ["Season", "3-season"],
    ],
  );
  await L(
    active(
      tom.id,
      "TaylorMade Stealth 2 Driver 10.5°",
      "Forgiving driver with carbon face. Stiff flex shaft. Very low spin. Includes headcover.",
      44900,
      "GOOD",
      "sports",
      "Golf",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1535131749006-b7f58c99034b")],
    [
      ["Loft", "10.5°"],
      ["Flex", "Stiff"],
      ["Shaft", "Fujikura Ventus"],
    ],
  );
  await L(
    active(
      tom.id,
      "Rogue Echo Bike Air Assault",
      "Commercial-grade air bike. Unlimited resistance. Used in home gym for 6 months. Heavy duty — 60kg unit.",
      129900,
      "GOOD",
      "sports",
      "Running & Fitness",
      "Otago",
      "Queenstown",
      "PICKUP",
    ),
    [img("photo-1534438327276-14e5300c3a48")],
  );
  await L(
    active(
      tom.id,
      "O'Neill Psycho Tech 4/3mm Wetsuit M",
      "Premium cold-water wetsuit. TechnoButter 3 neoprene. Great for NZ surf conditions. Medium, chest zip.",
      24900,
      "GOOD",
      "sports",
      "Water Sports",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1530053969600-caed2596d242")],
    [
      ["Thickness", "4/3mm"],
      ["Size", "M"],
      ["Entry", "Chest Zip"],
    ],
  );
  await L(
    active(
      tom.id,
      "Black Diamond Spot 400 Headlamp",
      "400 lumens, waterproof. Perfect for trail running or tramping. Uses rechargeable battery.",
      5900,
      "LIKE_NEW",
      "sports",
      "Camping & Hiking",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1504280390367-361c6d9f38f4")],
  );
  await L(
    active(
      tom.id,
      "Giant Escape 3 City Bike M 2024",
      "Flat-bar commuter bike. Shimano 8-speed, disc brakes. Ridden less than 100km.",
      48900,
      "LIKE_NEW",
      "sports",
      "Cycling",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1485965120184-e220f721d03e")],
  );
  await L(
    active(
      tom.id,
      "Burton Custom Snowboard 158cm",
      "All-mountain freestyle board. Twin shape, medium flex. Great for Remarkables and Cardrona.",
      34900,
      "GOOD",
      "sports",
      "Snow Sports",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1551698618-1dfe5d97d256")],
  );
  await L(
    active(
      tom.id,
      "Osprey Atmos AG 65L Backpack",
      "Best-in-class hiking pack with Anti-Gravity suspension. Size M/L. Used on Routeburn and Kepler tracks.",
      29900,
      "GOOD",
      "sports",
      "Camping & Hiking",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1553062407-98eeb64c6a62")],
  );
  await L(
    active(
      tom.id,
      "Ping G430 Max Iron Set 5-PW",
      "Game improvement irons. Graphite senior flex shafts. Forgiving and long. Great condition.",
      89900,
      "GOOD",
      "sports",
      "Golf",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1535131749006-b7f58c99034b")],
  );
  await L(
    active(
      tom.id,
      "Wahoo KICKR Core Smart Trainer",
      "Indoor cycling trainer. Compatible with Zwift, TrainerRoad. Accurate power measurement. Quiet direct-drive.",
      69900,
      "GOOD",
      "sports",
      "Cycling",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1534438327276-14e5300c3a48")],
  );
  await L(
    active(
      tom.id,
      "Sea to Summit Comfort Plus Insulated Mat",
      "Self-inflating sleeping mat. R-value 4.2 — warm enough for NZ winter camping. Regular size.",
      17900,
      "GOOD",
      "sports",
      "Camping & Hiking",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1504280390367-361c6d9f38f4")],
  );
  await L(
    active(
      tom.id,
      "Jetpilot Venture Buoyancy Vest",
      "Level 50 PFD for kayaking and paddleboarding. Adjustable fit, multiple pockets.",
      9900,
      "LIKE_NEW",
      "sports",
      "Water Sports",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1530053969600-caed2596d242")],
  );
  await L(
    active(
      tom.id,
      "Nike Pegasus 41 Men's Running Shoes US10",
      "Daily trainer with ReactX foam. About 200km on them. Still plenty of life left.",
      11900,
      "GOOD",
      "sports",
      "Running & Fitness",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1542291026-7eec264c27ff")],
  );
  await L(
    active(
      tom.id,
      "Smith I/O MAG Ski Goggles",
      "ChromaPop lens technology. Includes everyday green and storm yellow lenses. Fits medium-large faces.",
      19900,
      "GOOD",
      "sports",
      "Snow Sports",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1551698618-1dfe5d97d256")],
  );

  // ── BABY & KIDS (15) — seller: aroha (StyleNZ) ────────────────────────

  await L(
    active(
      aroha.id,
      "Bugaboo Fox 5 Complete Pram Black",
      "Premium pram with bassinet and toddler seat. All-terrain wheels. Used for 8 months. Immaculate condition.",
      119900,
      "GOOD",
      "baby-kids",
      "Baby Gear",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1566004100631-35d015d6a491")],
    [
      ["Brand", "Bugaboo"],
      ["Model", "Fox 5"],
      ["Includes", "Bassinet + Seat"],
    ],
  );
  await L(
    active(
      aroha.id,
      "Baby Jogger City Mini GT2 Navy",
      "Compact stroller with hand-fold. All-terrain tyres. Great for Auckland footpaths.",
      47900,
      "GOOD",
      "baby-kids",
      "Baby Gear",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1566004100631-35d015d6a491")],
  );
  await L(
    active(
      aroha.id,
      "LEGO Technic Porsche 911 GT3 RS",
      "42056 set. Built once and displayed. Complete with instructions and box. 2,704 pieces.",
      39900,
      "LIKE_NEW",
      "baby-kids",
      "Toys & Games",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1596461404969-9ae70f2830c1")],
  );
  await L(
    active(
      aroha.id,
      "Mocka Aspiring Cot Walnut",
      "Beautiful walnut-stained cot. Converts to toddler bed. Includes mattress. Used for one child.",
      24900,
      "GOOD",
      "baby-kids",
      "Nursery Furniture",
      "Waikato",
      "Hamilton Central",
      "PICKUP",
    ),
    [img("photo-1566004100631-35d015d6a491")],
  );
  await L(
    active(
      aroha.id,
      "Bonds Zippy Wondersuit 6-Pack 000-00",
      "Bundle of 6 Bonds wondersuits in various prints. Sizes 000 and 00. Good condition.",
      3900,
      "GOOD",
      "baby-kids",
      "Children's Clothing",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1522771930-78b353280e68")],
  );
  await L(
    active(
      aroha.id,
      "Hape Wooden Kitchen Playset",
      "Solid wooden play kitchen with accessories. Hours of imaginative play. Well-made and durable.",
      12900,
      "GOOD",
      "baby-kids",
      "Toys & Games",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1596461404969-9ae70f2830c1")],
  );
  await L(
    active(
      aroha.id,
      "Roald Dahl Complete Collection Box Set",
      "16 books in collectible box. All in excellent condition. Perfect for ages 7-12.",
      4900,
      "LIKE_NEW",
      "baby-kids",
      "Books",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1512820790803-83ca734da794")],
  );
  await L(
    active(
      aroha.id,
      "Silver Cross Wave Double Pram",
      "Converts from single to double. Includes bassinet and toddler seat. Perfect for growing family.",
      89900,
      "GOOD",
      "baby-kids",
      "Baby Gear",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1566004100631-35d015d6a491")],
  );
  await L(
    active(
      aroha.id,
      "Seed Heritage Kids Dress Size 6",
      "Beautiful cotton floral dress. Worn once for a birthday party. As new.",
      2900,
      "LIKE_NEW",
      "baby-kids",
      "Children's Clothing",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1522771930-78b353280e68")],
  );
  await L(
    active(
      aroha.id,
      "BRIO Railway World Deluxe Set",
      "Massive wooden train set with 106 pieces. Includes bridges, tunnels, figures. Hours of fun.",
      8900,
      "GOOD",
      "baby-kids",
      "Toys & Games",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1596461404969-9ae70f2830c1")],
  );
  await L(
    active(
      aroha.id,
      "Stokke Tripp Trapp High Chair White",
      "Grows with your child from baby to adult. Includes baby set. Minor scuffs.",
      22900,
      "GOOD",
      "baby-kids",
      "Nursery Furniture",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1566004100631-35d015d6a491")],
  );
  await L(
    active(
      aroha.id,
      "Harry Potter Complete Book Set 1-7",
      "All 7 books in paperback. Good reading condition. Some spine creasing.",
      3500,
      "FAIR",
      "baby-kids",
      "Books",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1512820790803-83ca734da794")],
  );
  await L(
    active(
      aroha.id,
      "Mini Boden Winter Jacket Age 4-5",
      "Sherpa-lined puffer jacket in mustard yellow. Super warm and cosy.",
      3900,
      "GOOD",
      "baby-kids",
      "Children's Clothing",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1522771930-78b353280e68")],
  );
  await L(
    active(
      aroha.id,
      "Babyzen YOYO2 Stroller Frame Black",
      "Ultra compact stroller frame only. Cabin-luggage size when folded. Perfect for travel.",
      34900,
      "GOOD",
      "baby-kids",
      "Baby Gear",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1566004100631-35d015d6a491")],
  );
  await L(
    active(
      aroha.id,
      "Melissa & Doug Wooden Activity Table",
      "Multi-activity play table with bead maze, gear board, and more. Solid construction.",
      7900,
      "GOOD",
      "baby-kids",
      "Nursery Furniture",
      "Waikato",
      "Hamilton Central",
    ),
    [img("photo-1596461404969-9ae70f2830c1")],
  );

  // ── COLLECTIBLES (15) — seller: rachel (Kiwi Home & Style) ────────────

  const allBlacksJersey = await L(
    active(
      rachel.id,
      "Signed All Blacks Jersey — Richie McCaw",
      "Framed and authenticated 2015 RWC jersey signed by Richie McCaw. Certificate of authenticity from NZ Rugby. A piece of NZ history.",
      249900,
      "GOOD",
      "collectibles",
      "Sports Memorabilia",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1578662996442-48f60103fc96")],
    [
      ["Player", "Richie McCaw"],
      ["Year", "2015 RWC"],
      ["Authentication", "NZ Rugby COA"],
    ],
  );

  await L(
    active(
      rachel.id,
      "1935 NZ Threepence — AU Grade",
      "Pre-decimal NZ coin in almost uncirculated condition. George V obverse. Key date for collectors.",
      34900,
      "GOOD",
      "collectibles",
      "Coins & Stamps",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1578662996442-48f60103fc96")],
  );
  await L(
    active(
      rachel.id,
      "Original NZ Landscape Oil Painting",
      "Oil on canvas, 80x60cm. Canterbury high country scene by local artist J. McPherson. Signed and dated 2019.",
      79900,
      "GOOD",
      "collectibles",
      "Art",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1579783902614-a3fb3927b6a5")],
    [
      ["Medium", "Oil on canvas"],
      ["Size", "80x60cm"],
      ["Artist", "J. McPherson"],
    ],
  );
  await L(
    active(
      rachel.id,
      "Kauri Gum Polished Specimen 450g",
      "Beautiful amber-coloured Northland kauri gum. Museum quality with insect inclusions visible.",
      19900,
      "GOOD",
      "collectibles",
      "Antiques",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1578662996442-48f60103fc96")],
  );
  await L(
    active(
      rachel.id,
      "First Edition Lord of the Rings — 1966 UK",
      "1966 second edition (revised text). Three volumes with dust jackets. Minor foxing. A Tolkien treasure.",
      89900,
      "FAIR",
      "collectibles",
      "Books & Comics",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1512820790803-83ca734da794")],
  );
  await L(
    active(
      rachel.id,
      "Dan Carter Signed Rugby Ball",
      "Match ball signed by Dan Carter. Perspex display case included. NZ Rugby authentication.",
      12900,
      "GOOD",
      "collectibles",
      "Sports Memorabilia",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1578662996442-48f60103fc96")],
  );
  await L(
    active(
      rachel.id,
      "NZ Post Stamp Collection 1960-1990",
      "Comprehensive collection of NZ stamps. Mounted in Lighthouse album. Includes several first day covers.",
      24900,
      "GOOD",
      "collectibles",
      "Coins & Stamps",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1578662996442-48f60103fc96")],
  );
  await L(
    active(
      rachel.id,
      "Contemporary Pounamu Pendant — Twist",
      "Hand-carved Westland pounamu (greenstone) in double twist design. Waxed cord. Certificate of origin.",
      29900,
      "NEW",
      "collectibles",
      "Art",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1578662996442-48f60103fc96")],
  );
  await L(
    active(
      rachel.id,
      "Victorian Brass Mantel Clock c.1890",
      "Working antique clock. 8-day movement, strikes on the hour. Restored mechanism. Beautiful patina.",
      44900,
      "FAIR",
      "collectibles",
      "Antiques",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1580541832626-2a7131ee809f")],
  );
  await L(
    active(
      rachel.id,
      "DC Comics Batman #232 First Ra's al Ghul",
      "1971 first appearance of Ra's al Ghul. Graded CGC 6.0. Classic Neal Adams cover.",
      189900,
      "FAIR",
      "collectibles",
      "Books & Comics",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1512820790803-83ca734da794")],
  );
  await L(
    active(
      rachel.id,
      "All Blacks 2011 RWC Squad Photo Framed",
      "Official team photo from the 2011 Rugby World Cup victory. Professionally framed 60x40cm.",
      14900,
      "GOOD",
      "collectibles",
      "Sports Memorabilia",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1578662996442-48f60103fc96")],
  );
  await L(
    active(
      rachel.id,
      "1943 NZ Half Crown — EF Grade",
      "George VI half crown in extra fine condition. Scarce wartime issue.",
      7900,
      "GOOD",
      "collectibles",
      "Coins & Stamps",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1578662996442-48f60103fc96")],
  );
  await L(
    active(
      rachel.id,
      "Hand-Blown Glass Vase — NZ Artist",
      "One-of-a-kind art glass vase by Gareth McKee. Deep blue and green swirl pattern. 30cm tall.",
      34900,
      "GOOD",
      "collectibles",
      "Art",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1579783902614-a3fb3927b6a5")],
  );
  await L(
    active(
      rachel.id,
      "Rimu Jewellery Box — NZ Native Timber",
      "Hand-crafted rimu box with velvet lining. Tongue and groove joints. Beautiful grain.",
      12900,
      "GOOD",
      "collectibles",
      "Antiques",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1580541832626-2a7131ee809f")],
  );
  await L(
    active(
      rachel.id,
      "Marvel Comics X-Men #1 1991 Jim Lee",
      "Near mint condition. First issue of the legendary Jim Lee run. Bagged and boarded.",
      4900,
      "GOOD",
      "collectibles",
      "Books & Comics",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1512820790803-83ca734da794")],
  );

  // ── PROPERTY (9) — split across sellers ────────────────────────────────

  await L(
    active(
      rachel.id,
      "Sunny Room in Kelburn Flat",
      "Large room in a 3-bedroom flat. 5-min walk to Victoria Uni. Includes power and internet. Available from next month.",
      25000,
      "GOOD",
      "property",
      "Flatmates",
      "Wellington",
      "Kelburn",
      "PICKUP",
    ),
    [img("photo-1522708323590-d24dbb6b0267")],
    [
      ["Type", "Single room"],
      ["Available", "Next month"],
      ["Includes", "Power + WiFi"],
    ],
  );
  await L(
    active(
      rachel.id,
      "2BR Apartment Mt Victoria Wellington",
      "Furnished 2-bedroom apartment with harbour views. 6-month lease available. Pet-friendly building.",
      55000,
      "GOOD",
      "property",
      "Rentals",
      "Wellington",
      "Mt Victoria",
      "PICKUP",
    ),
    [img("photo-1560448204-e02f11c3d0e2")],
  );
  await L(
    active(
      rachel.id,
      "Commercial Office Space 45sqm CBD",
      "Open-plan office in central Wellington. Includes kitchenette and bathroom. Fibre internet available.",
      180000,
      "GOOD",
      "property",
      "For Sale",
      "Wellington",
      "Wellington CBD",
      "PICKUP",
    ),
    [img("photo-1497366216548-37526070297c")],
  );
  await L(
    active(
      mike.id,
      "Studio Apartment Ponsonby Auckland",
      "Compact studio in the heart of Ponsonby. Walk to cafes, bars, and parks. Available immediately.",
      40000,
      "GOOD",
      "property",
      "Rentals",
      "Auckland",
      "Ponsonby",
      "PICKUP",
    ),
    [img("photo-1560448204-e02f11c3d0e2")],
  );
  await L(
    active(
      mike.id,
      "Room in Newmarket Townhouse",
      "Modern townhouse, 10 min bus to CBD. Room has built-in wardrobe. Shared living/kitchen.",
      27500,
      "GOOD",
      "property",
      "Flatmates",
      "Auckland",
      "Newmarket",
      "PICKUP",
    ),
    [img("photo-1522708323590-d24dbb6b0267")],
  );
  await L(
    active(
      tom.id,
      "Holiday Bach Lake Wakatipu",
      "3-bedroom bach with lake views. Available for weekly rental. Sleeps 6. Fully furnished and equipped.",
      200000,
      "GOOD",
      "property",
      "Rentals",
      "Otago",
      "Queenstown",
      "PICKUP",
    ),
    [img("photo-1560448204-e02f11c3d0e2")],
  );
  await L(
    active(
      tom.id,
      "Room in Queenstown Central Flat",
      "Warm room in central Queenstown flat. 2 flatmates. Walking distance to town and Skyline.",
      28000,
      "GOOD",
      "property",
      "Flatmates",
      "Otago",
      "Queenstown",
      "PICKUP",
    ),
    [img("photo-1522708323590-d24dbb6b0267")],
  );
  await L(
    active(
      aroha.id,
      "3BR House Hamilton East",
      "Sunny 3-bedroom family home. New carpet and paint. Fenced yard. Close to schools.",
      62000,
      "GOOD",
      "property",
      "Rentals",
      "Waikato",
      "Hamilton East",
      "PICKUP",
    ),
    [img("photo-1560448204-e02f11c3d0e2")],
  );
  await L(
    active(
      aroha.id,
      "Retail Space Tauranga CBD 60sqm",
      "Ground floor retail space. High foot traffic location. Includes fitout.",
      350000,
      "GOOD",
      "property",
      "For Sale",
      "Bay of Plenty",
      "Tauranga",
      "PICKUP",
    ),
    [img("photo-1497366216548-37526070297c")],
  );

  // ── TOOLS & EQUIPMENT (15) — split across sellers ─────────────────────

  await L(
    active(
      tom.id,
      "DeWalt 20V MAX Drill/Driver Kit",
      "Brushless drill with 2 batteries and charger. 3-speed settings. Great for home projects.",
      24900,
      "GOOD",
      "business",
      "Power Tools",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1504148455328-c376907d081c")],
    [
      ["Brand", "DeWalt"],
      ["Voltage", "20V MAX"],
      ["Includes", "2 batteries + charger"],
    ],
  );
  await L(
    active(
      tom.id,
      "Makita Circular Saw 185mm",
      "Powerful 1800W circular saw. Used on a deck build. Includes 2 blades.",
      19900,
      "GOOD",
      "business",
      "Power Tools",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1504148455328-c376907d081c")],
  );
  await L(
    active(
      tom.id,
      "Bosch 108-Piece Hand Tool Set",
      "Complete home toolkit in carry case. Ratchet, sockets, screwdrivers, pliers, spanners.",
      14900,
      "LIKE_NEW",
      "business",
      "Hand Tools",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1581092580497-e0d23cbdf1dc")],
  );
  await L(
    active(
      rachel.id,
      "Herman Miller Aeron Chair Size B",
      "Ergonomic office chair. Fully loaded with PostureFit SL. Used in home office for 2 years.",
      119900,
      "GOOD",
      "business",
      "Office Furniture",
      "Wellington",
      "Kelburn",
      "PICKUP",
    ),
    [img("photo-1580480055273-228ff5388ef8")],
    [
      ["Brand", "Herman Miller"],
      ["Model", "Aeron"],
      ["Size", "B (Medium)"],
    ],
  );
  await L(
    active(
      rachel.id,
      "Standing Desk Electric 1500mm Bamboo",
      "Electric sit-stand desk with bamboo top. Dual motors, memory presets. Quiet operation.",
      54900,
      "GOOD",
      "business",
      "Office Furniture",
      "Wellington",
      "Kelburn",
      "PICKUP",
    ),
    [img("photo-1580480055273-228ff5388ef8")],
  );
  await L(
    active(
      mike.id,
      "Husqvarna Automower 305",
      "Robotic lawn mower. Covers up to 600sqm. GPS navigation. Used for one season.",
      149900,
      "GOOD",
      "business",
      "Industrial Equipment",
      "Auckland",
      "Newmarket",
    ),
    [img("photo-1504148455328-c376907d081c")],
  );
  await L(
    active(
      mike.id,
      "3M Full-Face Respirator 6800",
      "Medium size full-face mask. Includes P100 cartridges. Used for spray painting.",
      14900,
      "GOOD",
      "business",
      "Safety Equipment",
      "Auckland",
      "Newmarket",
    ),
    [img("photo-1581092580497-e0d23cbdf1dc")],
  );
  await L(
    active(
      tom.id,
      "Milwaukee M18 Impact Driver",
      "Brushless impact driver. 4Ah battery. Incredible power for its size.",
      19900,
      "GOOD",
      "business",
      "Power Tools",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1504148455328-c376907d081c")],
  );
  await L(
    active(
      tom.id,
      "Stanley FatMax Socket Set 200-Piece",
      "Complete metric and imperial socket set. Chrome vanadium steel. Lifetime warranty.",
      14900,
      "NEW",
      "business",
      "Hand Tools",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1581092580497-e0d23cbdf1dc")],
  );
  await L(
    active(
      rachel.id,
      "Logitech Ergo K860 Split Keyboard",
      "Ergonomic split keyboard. Bluetooth + USB receiver. Wrist rest included.",
      14900,
      "LIKE_NEW",
      "business",
      "Office Furniture",
      "Wellington",
      "Kelburn",
    ),
    [img("photo-1580480055273-228ff5388ef8")],
  );
  await L(
    active(
      mike.id,
      "Karcher K5 Premium Pressure Washer",
      "High-pressure cleaner. 2100W motor. Great for decks, driveways, and cars. All accessories included.",
      44900,
      "GOOD",
      "business",
      "Industrial Equipment",
      "Auckland",
      "Newmarket",
    ),
    [img("photo-1504148455328-c376907d081c")],
  );
  await L(
    active(
      tom.id,
      "Uvex Safety Glasses Clear 3-Pack",
      "ANSI Z87.1 rated safety glasses. Scratch-resistant coating. Brand new.",
      2900,
      "NEW",
      "business",
      "Safety Equipment",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1581092580497-e0d23cbdf1dc")],
  );
  await L(
    active(
      tom.id,
      "Festool Domino DF 500 Joiner",
      "Premium domino joiner. Incredible precision for furniture making. Includes systainer and assorted tenons.",
      119900,
      "GOOD",
      "business",
      "Power Tools",
      "Otago",
      "Queenstown",
    ),
    [img("photo-1504148455328-c376907d081c")],
  );
  await L(
    active(
      rachel.id,
      "Steelcase Leap V2 Office Chair Black",
      "High-end ergonomic chair. Adjustable everything. Used for 18 months in home office.",
      79900,
      "GOOD",
      "business",
      "Office Furniture",
      "Wellington",
      "Kelburn",
      "PICKUP",
    ),
    [img("photo-1580480055273-228ff5388ef8")],
  );
  await L(
    active(
      mike.id,
      "Hi-Vis Safety Vest Pack of 10",
      "EN ISO 20471 Class 2. Assorted sizes. Brand new in packaging.",
      3900,
      "NEW",
      "business",
      "Safety Equipment",
      "Auckland",
      "Newmarket",
    ),
    [img("photo-1581092580497-e0d23cbdf1dc")],
  );

  console.log("✅ ~135 listings created across 8 categories");

  // ══════════════════════════════════════════════════════════════════════════
  // ORDERS (22 total, all statuses)
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n📦 Creating orders...");

  // ── Helper to create order + events
  async function createOrder(
    data: Parameters<typeof db.order.create>[0]["data"],
  ) {
    return db.order.create({ data });
  }

  // ── COMPLETED ORDERS (6) ──────────────────────────────────────────────

  // Order 1: Sarah bought headphones from Mike — COMPLETED with review
  const order1 = await createOrder({
    buyerId: sarah.id,
    sellerId: mike.id,
    listingId: headphones,
    itemNzd: 39900,
    shippingNzd: 0,
    totalNzd: 39900,
    status: "COMPLETED",
    stripePaymentIntentId: "pi_test_seed_001",
    trackingNumber: "NZ1234567890",
    trackingUrl: "https://www.nzpost.co.nz/tools/tracking/item/NZ1234567890",
    dispatchedAt: ago(18 * DAY),
    deliveredAt: ago(14 * DAY),
    completedAt: ago(13 * DAY),
    createdAt: ago(20 * DAY),
  });

  // Order 2: Emma bought kayak from Tom — COMPLETED with review
  const order2 = await createOrder({
    buyerId: emma.id,
    sellerId: tom.id,
    listingId: kayak,
    itemNzd: 149900,
    shippingNzd: 0,
    totalNzd: 149900,
    status: "COMPLETED",
    stripePaymentIntentId: "pi_test_seed_002",
    dispatchedAt: ago(22 * DAY),
    deliveredAt: ago(18 * DAY),
    completedAt: ago(17 * DAY),
    createdAt: ago(25 * DAY),
  });

  // Order 3: James bought MacBook from Mike — COMPLETED
  const order3 = await createOrder({
    buyerId: james.id,
    sellerId: mike.id,
    listingId: macbook,
    itemNzd: 299900,
    shippingNzd: 0,
    totalNzd: 299900,
    status: "COMPLETED",
    stripePaymentIntentId: "pi_test_seed_003",
    trackingNumber: "NZ9876543210",
    dispatchedAt: ago(15 * DAY),
    deliveredAt: ago(11 * DAY),
    completedAt: ago(10 * DAY),
    createdAt: ago(17 * DAY),
  });

  // Order 4: Sarah bought sofa from Rachel — COMPLETED with review
  const order4 = await createOrder({
    buyerId: sarah.id,
    sellerId: rachel.id,
    listingId: danishSofa,
    itemNzd: 129900,
    shippingNzd: 0,
    totalNzd: 129900,
    status: "COMPLETED",
    stripePaymentIntentId: "pi_test_seed_004",
    dispatchedAt: ago(12 * DAY),
    completedAt: ago(8 * DAY),
    createdAt: ago(14 * DAY),
  });

  // Order 5: Emma bought coat from Aroha — COMPLETED with review
  const order5 = await createOrder({
    buyerId: emma.id,
    sellerId: aroha.id,
    listingId: treneryCoat,
    itemNzd: 24900,
    shippingNzd: 500,
    totalNzd: 25400,
    status: "COMPLETED",
    stripePaymentIntentId: "pi_test_seed_005",
    trackingNumber: "NZ5551234567",
    dispatchedAt: ago(10 * DAY),
    deliveredAt: ago(7 * DAY),
    completedAt: ago(6 * DAY),
    createdAt: ago(12 * DAY),
  });

  // Order 6: James bought AllBlacks jersey from Rachel — COMPLETED
  const order6 = await createOrder({
    buyerId: james.id,
    sellerId: rachel.id,
    listingId: allBlacksJersey,
    itemNzd: 249900,
    shippingNzd: 2000,
    totalNzd: 251900,
    status: "COMPLETED",
    stripePaymentIntentId: "pi_test_seed_006",
    trackingNumber: "NZ7778889990",
    dispatchedAt: ago(8 * DAY),
    deliveredAt: ago(5 * DAY),
    completedAt: ago(4 * DAY),
    createdAt: ago(10 * DAY),
  });

  // ── DISPATCHED ORDERS (3) ─────────────────────────────────────────────

  // Order 7: Sarah bought KitchenAid from Rachel — DISPATCHED
  const order7 = await createOrder({
    buyerId: sarah.id,
    sellerId: rachel.id,
    listingId: kitchenaid,
    itemNzd: 59900,
    shippingNzd: 2000,
    totalNzd: 61900,
    status: "DISPATCHED",
    stripePaymentIntentId: "pi_test_seed_007",
    trackingNumber: "NZ3334445556",
    trackingUrl: "https://www.nzpost.co.nz/tools/tracking/item/NZ3334445556",
    dispatchedAt: ago(2 * DAY),
    createdAt: ago(5 * DAY),
  });

  // Order 8: Emma bought Nike AF1 from Aroha — DISPATCHED
  const order8 = await createOrder({
    buyerId: emma.id,
    sellerId: aroha.id,
    listingId: nikeAF1,
    itemNzd: 13900,
    shippingNzd: 800,
    totalNzd: 14700,
    status: "DISPATCHED",
    stripePaymentIntentId: "pi_test_seed_008",
    trackingNumber: "NZ6667778889",
    dispatchedAt: ago(1 * DAY),
    createdAt: ago(3 * DAY),
  });

  // Order 9: James bought drone from Mike — DISPATCHED
  const order9 = await createOrder({
    buyerId: james.id,
    sellerId: mike.id,
    listingId: djiDrone,
    itemNzd: 129900,
    shippingNzd: 0,
    totalNzd: 129900,
    status: "DISPATCHED",
    stripePaymentIntentId: "pi_test_seed_009",
    trackingNumber: "NZ1112223334",
    dispatchedAt: ago(3 * DAY),
    createdAt: ago(6 * DAY),
  });

  // ── PAYMENT_HELD ORDERS (2) ───────────────────────────────────────────

  // Order 10: James bought gaming PC — PAYMENT_HELD (has pending cancel request)
  const order10 = await createOrder({
    buyerId: james.id,
    sellerId: mike.id,
    listingId: gamingPC,
    itemNzd: 249900,
    shippingNzd: 0,
    totalNzd: 249900,
    status: "PAYMENT_HELD",
    stripePaymentIntentId: "pi_test_seed_010",
    createdAt: ago(1 * DAY),
  });

  // Order 11: Sarah bought bike from Tom — PAYMENT_HELD (shipping delay notified)
  const order11 = await createOrder({
    buyerId: sarah.id,
    sellerId: tom.id,
    listingId: trekBike,
    itemNzd: 149900,
    shippingNzd: 5000,
    totalNzd: 154900,
    status: "PAYMENT_HELD",
    stripePaymentIntentId: "pi_test_seed_011",
    createdAt: ago(3 * DAY),
  });

  // ── AWAITING_PAYMENT (1) ──────────────────────────────────────────────

  // Order 12: Emma just placed an order for iPhone
  const order12 = await createOrder({
    buyerId: emma.id,
    sellerId: mike.id,
    listingId: iphone,
    itemNzd: 159900,
    shippingNzd: 0,
    totalNzd: 159900,
    status: "AWAITING_PAYMENT",
    stripePaymentIntentId: "pi_test_seed_012",
    createdAt: ago(2 * HOUR),
  });

  // ── DISPUTED ORDERS (3) ───────────────────────────────────────────────

  // Order 13: Sarah's dispute against Mike — ITEM_DAMAGED — with seller response
  const order13 = await createOrder({
    buyerId: sarah.id,
    sellerId: mike.id,
    listingId: gamingPC, // duplicate listing ref (it's seed data)
    itemNzd: 249900,
    shippingNzd: 0,
    totalNzd: 249900,
    status: "DISPUTED",
    stripePaymentIntentId: "pi_test_seed_013",
    trackingNumber: "NZ9990001112",
    dispatchedAt: ago(14 * DAY),
    deliveredAt: ago(10 * DAY),
    disputeReason: "ITEM_DAMAGED",
    disputeOpenedAt: ago(9 * DAY),
    disputeNotes:
      "The gaming PC arrived with a cracked side panel and the GPU was loose inside the case. It looks like it wasn't packed securely. The PC won't boot — I suspect the GPU is damaged from being rattled around during shipping.",
    sellerResponse:
      "I packed it carefully with foam inserts and bubble wrap. The courier must have mishandled the package. I'm happy to arrange a partial refund for the side panel replacement, but the GPU was working perfectly when I sent it. Can we review the courier's handling together?",
    sellerRespondedAt: ago(7 * DAY),
    createdAt: ago(16 * DAY),
  });

  // Order 14: Emma's dispute against Tom — NOT_AS_DESCRIBED — awaiting seller response
  const order14 = await createOrder({
    buyerId: emma.id,
    sellerId: tom.id,
    listingId: trekBike,
    itemNzd: 149900,
    shippingNzd: 5000,
    totalNzd: 154900,
    status: "DISPUTED",
    stripePaymentIntentId: "pi_test_seed_014",
    dispatchedAt: ago(12 * DAY),
    deliveredAt: ago(8 * DAY),
    disputeReason: "ITEM_NOT_AS_DESCRIBED",
    disputeOpenedAt: ago(6 * DAY),
    disputeNotes:
      "The listing said 'ridden about 500km' but the bike has significant wear on the drivetrain, chain, and brake pads that suggests much higher mileage. The cassette is visibly worn and the chain measures beyond replacement spec. This was misrepresented.",
    createdAt: ago(15 * DAY),
  });

  // Order 15: Escalated from expired return — DISPUTED
  const order15 = await createOrder({
    buyerId: sarah.id,
    sellerId: aroha.id,
    listingId: treneryCoat,
    itemNzd: 24900,
    shippingNzd: 500,
    totalNzd: 25400,
    status: "DISPUTED",
    stripePaymentIntentId: "pi_test_seed_015",
    trackingNumber: "NZ2223334445",
    dispatchedAt: ago(20 * DAY),
    deliveredAt: ago(16 * DAY),
    disputeReason: "ITEM_NOT_AS_DESCRIBED",
    disputeOpenedAt: ago(5 * DAY),
    disputeNotes:
      "Coat has a large stain on the lining that was not disclosed in the listing. Return request expired without seller response, escalating to dispute.",
    createdAt: ago(22 * DAY),
  });

  // ── CANCELLED ORDERS (2) ──────────────────────────────────────────────

  // Order 16: Free window cancellation (auto-approved)
  const order16 = await createOrder({
    buyerId: james.id,
    sellerId: rachel.id,
    listingId: kitchenaid,
    itemNzd: 59900,
    shippingNzd: 2000,
    totalNzd: 61900,
    status: "CANCELLED",
    stripePaymentIntentId: "pi_test_seed_016",
    cancelledBy: "BUYER",
    cancelReason: "Changed my mind — found a better deal locally",
    cancelledAt: ago(8 * DAY),
    createdAt: ago(8 * DAY + HOUR),
  });

  // Order 17: Seller-approved cancellation after negotiation
  const order17 = await createOrder({
    buyerId: emma.id,
    sellerId: mike.id,
    listingId: macbook,
    itemNzd: 299900,
    shippingNzd: 0,
    totalNzd: 299900,
    status: "CANCELLED",
    stripePaymentIntentId: "pi_test_seed_017",
    cancelledBy: "BUYER",
    cancelReason: "Employer is providing a work laptop, no longer need this",
    cancelledAt: ago(5 * DAY),
    createdAt: ago(7 * DAY),
  });

  // ── REFUNDED ORDERS (2) ───────────────────────────────────────────────

  // Order 18: Refunded after dispute resolved in buyer's favour
  const order18 = await createOrder({
    buyerId: james.id,
    sellerId: tom.id,
    listingId: kayak,
    itemNzd: 149900,
    shippingNzd: 0,
    totalNzd: 149900,
    status: "REFUNDED",
    stripePaymentIntentId: "pi_test_seed_018",
    dispatchedAt: ago(25 * DAY),
    deliveredAt: ago(21 * DAY),
    disputeReason: "ITEM_NOT_RECEIVED",
    disputeOpenedAt: ago(18 * DAY),
    disputeNotes:
      "Never received the kayak despite tracking showing delivered. No signature was obtained.",
    disputeResolvedAt: ago(12 * DAY),
    createdAt: ago(28 * DAY),
  });

  // Order 19: Refunded — item genuinely not received
  const order19 = await createOrder({
    buyerId: sarah.id,
    sellerId: aroha.id,
    listingId: nikeAF1,
    itemNzd: 13900,
    shippingNzd: 800,
    totalNzd: 14700,
    status: "REFUNDED",
    stripePaymentIntentId: "pi_test_seed_019",
    dispatchedAt: ago(22 * DAY),
    disputeReason: "ITEM_NOT_RECEIVED",
    disputeOpenedAt: ago(15 * DAY),
    disputeResolvedAt: ago(10 * DAY),
    createdAt: ago(25 * DAY),
  });

  // ── Additional orders for variety
  const order20 = await createOrder({
    buyerId: sarah.id,
    sellerId: mike.id,
    listingId: iphone,
    itemNzd: 159900,
    shippingNzd: 0,
    totalNzd: 159900,
    status: "COMPLETED",
    stripePaymentIntentId: "pi_test_seed_020",
    trackingNumber: "NZ4445556667",
    dispatchedAt: ago(6 * DAY),
    deliveredAt: ago(3 * DAY),
    completedAt: ago(2 * DAY),
    createdAt: ago(8 * DAY),
  });

  const order21 = await createOrder({
    buyerId: emma.id,
    sellerId: rachel.id,
    listingId: allBlacksJersey,
    itemNzd: 249900,
    shippingNzd: 2000,
    totalNzd: 251900,
    status: "DISPATCHED",
    stripePaymentIntentId: "pi_test_seed_021",
    trackingNumber: "NZ8889990001",
    dispatchedAt: ago(1 * DAY),
    createdAt: ago(4 * DAY),
  });

  const order22 = await createOrder({
    buyerId: james.id,
    sellerId: aroha.id,
    listingId: treneryCoat,
    itemNzd: 24900,
    shippingNzd: 500,
    totalNzd: 25400,
    status: "COMPLETED",
    stripePaymentIntentId: "pi_test_seed_022",
    trackingNumber: "NZ1119992223",
    dispatchedAt: ago(18 * DAY),
    deliveredAt: ago(14 * DAY),
    completedAt: ago(13 * DAY),
    createdAt: ago(20 * DAY),
  });

  console.log("✅ 22 orders created");

  // ══════════════════════════════════════════════════════════════════════════
  // ORDER EVENTS (full chains for each order)
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n📋 Creating order events...");

  // Helper: create event chain for a completed order
  async function completedChain(
    orderId: string,
    buyerId: string,
    sellerId: string,
    created: Date,
    dispatched: Date,
    completed: Date,
    tracking?: string,
  ) {
    await db.orderEvent.createMany({
      data: [
        {
          orderId,
          type: "ORDER_CREATED",
          actorId: buyerId,
          actorRole: "BUYER",
          summary: "Order placed",
          createdAt: created,
        },
        {
          orderId,
          type: "PAYMENT_HELD",
          actorId: null,
          actorRole: "SYSTEM",
          summary: "Payment authorized and held in escrow",
          createdAt: new Date(created.getTime() + 2 * MIN),
        },
        {
          orderId,
          type: "DISPATCHED",
          actorId: sellerId,
          actorRole: "SELLER",
          summary: tracking
            ? `Seller dispatched order — tracking: ${tracking}`
            : "Seller dispatched order",
          metadata: tracking ? { trackingNumber: tracking } : undefined,
          createdAt: dispatched,
        },
        {
          orderId,
          type: "COMPLETED",
          actorId: buyerId,
          actorRole: "BUYER",
          summary: "Buyer confirmed delivery — payment released to seller",
          createdAt: completed,
        },
      ],
    });
  }

  // Completed orders
  await completedChain(
    order1.id,
    sarah.id,
    mike.id,
    ago(20 * DAY),
    ago(18 * DAY),
    ago(13 * DAY),
    "NZ1234567890",
  );
  await completedChain(
    order2.id,
    emma.id,
    tom.id,
    ago(25 * DAY),
    ago(22 * DAY),
    ago(17 * DAY),
  );
  await completedChain(
    order3.id,
    james.id,
    mike.id,
    ago(17 * DAY),
    ago(15 * DAY),
    ago(10 * DAY),
    "NZ9876543210",
  );
  await completedChain(
    order4.id,
    sarah.id,
    rachel.id,
    ago(14 * DAY),
    ago(12 * DAY),
    ago(8 * DAY),
  );
  await completedChain(
    order5.id,
    emma.id,
    aroha.id,
    ago(12 * DAY),
    ago(10 * DAY),
    ago(6 * DAY),
    "NZ5551234567",
  );
  await completedChain(
    order6.id,
    james.id,
    rachel.id,
    ago(10 * DAY),
    ago(8 * DAY),
    ago(4 * DAY),
    "NZ7778889990",
  );
  await completedChain(
    order20.id,
    sarah.id,
    mike.id,
    ago(8 * DAY),
    ago(6 * DAY),
    ago(2 * DAY),
    "NZ4445556667",
  );
  await completedChain(
    order22.id,
    james.id,
    aroha.id,
    ago(20 * DAY),
    ago(18 * DAY),
    ago(13 * DAY),
    "NZ1119992223",
  );

  // Dispatched orders
  for (const o of [order7, order8, order9, order21]) {
    await db.orderEvent.createMany({
      data: [
        {
          orderId: o.id,
          type: "ORDER_CREATED",
          actorId: o.buyerId,
          actorRole: "BUYER",
          summary: "Order placed",
          createdAt: o.createdAt,
        },
        {
          orderId: o.id,
          type: "PAYMENT_HELD",
          actorId: null,
          actorRole: "SYSTEM",
          summary: "Payment authorized and held in escrow",
          createdAt: new Date(o.createdAt.getTime() + 2 * MIN),
        },
        {
          orderId: o.id,
          type: "DISPATCHED",
          actorId: o.sellerId,
          actorRole: "SELLER",
          summary: `Seller dispatched order — tracking: ${o.trackingNumber}`,
          metadata: { trackingNumber: o.trackingNumber },
          createdAt: o.dispatchedAt!,
        },
      ],
    });
  }

  // Payment held orders
  for (const o of [order10, order11]) {
    await db.orderEvent.createMany({
      data: [
        {
          orderId: o.id,
          type: "ORDER_CREATED",
          actorId: o.buyerId,
          actorRole: "BUYER",
          summary: "Order placed",
          createdAt: o.createdAt,
        },
        {
          orderId: o.id,
          type: "PAYMENT_HELD",
          actorId: null,
          actorRole: "SYSTEM",
          summary: "Payment authorized and held in escrow",
          createdAt: new Date(o.createdAt.getTime() + 2 * MIN),
        },
      ],
    });
  }

  // Awaiting payment
  await db.orderEvent.create({
    data: {
      orderId: order12.id,
      type: "ORDER_CREATED",
      actorId: emma.id,
      actorRole: "BUYER",
      summary: "Order placed",
      createdAt: order12.createdAt,
    },
  });

  // Disputed orders — events
  await db.orderEvent.createMany({
    data: [
      {
        orderId: order13.id,
        type: "ORDER_CREATED",
        actorId: sarah.id,
        actorRole: "BUYER",
        summary: "Order placed",
        createdAt: ago(16 * DAY),
      },
      {
        orderId: order13.id,
        type: "PAYMENT_HELD",
        actorId: null,
        actorRole: "SYSTEM",
        summary: "Payment authorized and held in escrow",
        createdAt: ago(16 * DAY - 2 * MIN),
      },
      {
        orderId: order13.id,
        type: "DISPATCHED",
        actorId: mike.id,
        actorRole: "SELLER",
        summary: "Seller dispatched order — tracking: NZ9990001112",
        createdAt: ago(14 * DAY),
      },
      {
        orderId: order13.id,
        type: "DISPUTE_OPENED",
        actorId: sarah.id,
        actorRole: "BUYER",
        summary: "Buyer opened dispute: item damaged",
        metadata: { reason: "ITEM_DAMAGED" },
        createdAt: ago(9 * DAY),
      },
      {
        orderId: order13.id,
        type: "DISPUTE_RESPONDED",
        actorId: mike.id,
        actorRole: "SELLER",
        summary: "Seller responded to dispute",
        createdAt: ago(7 * DAY),
      },
    ],
  });

  await db.orderEvent.createMany({
    data: [
      {
        orderId: order14.id,
        type: "ORDER_CREATED",
        actorId: emma.id,
        actorRole: "BUYER",
        summary: "Order placed",
        createdAt: ago(15 * DAY),
      },
      {
        orderId: order14.id,
        type: "PAYMENT_HELD",
        actorId: null,
        actorRole: "SYSTEM",
        summary: "Payment authorized and held in escrow",
        createdAt: ago(15 * DAY - 2 * MIN),
      },
      {
        orderId: order14.id,
        type: "DISPATCHED",
        actorId: tom.id,
        actorRole: "SELLER",
        summary: "Seller dispatched order",
        createdAt: ago(12 * DAY),
      },
      {
        orderId: order14.id,
        type: "DISPUTE_OPENED",
        actorId: emma.id,
        actorRole: "BUYER",
        summary: "Buyer opened dispute: item not as described",
        metadata: { reason: "ITEM_NOT_AS_DESCRIBED" },
        createdAt: ago(6 * DAY),
      },
    ],
  });

  await db.orderEvent.createMany({
    data: [
      {
        orderId: order15.id,
        type: "ORDER_CREATED",
        actorId: sarah.id,
        actorRole: "BUYER",
        summary: "Order placed",
        createdAt: ago(22 * DAY),
      },
      {
        orderId: order15.id,
        type: "PAYMENT_HELD",
        actorId: null,
        actorRole: "SYSTEM",
        summary: "Payment authorized and held in escrow",
        createdAt: ago(22 * DAY - 2 * MIN),
      },
      {
        orderId: order15.id,
        type: "DISPATCHED",
        actorId: aroha.id,
        actorRole: "SELLER",
        summary: "Seller dispatched order — tracking: NZ2223334445",
        createdAt: ago(20 * DAY),
      },
      {
        orderId: order15.id,
        type: "RETURN_REQUESTED",
        actorId: sarah.id,
        actorRole: "BUYER",
        summary:
          "Buyer requested a return: coat has undisclosed stain on lining",
        createdAt: ago(10 * DAY),
      },
      {
        orderId: order15.id,
        type: "DISPUTE_OPENED",
        actorId: null,
        actorRole: "SYSTEM",
        summary:
          "Return request auto-escalated to dispute (seller did not respond within 72 hours)",
        createdAt: ago(5 * DAY),
      },
    ],
  });

  // Cancelled orders
  await db.orderEvent.createMany({
    data: [
      {
        orderId: order16.id,
        type: "ORDER_CREATED",
        actorId: james.id,
        actorRole: "BUYER",
        summary: "Order placed",
        createdAt: ago(8 * DAY + HOUR),
      },
      {
        orderId: order16.id,
        type: "PAYMENT_HELD",
        actorId: null,
        actorRole: "SYSTEM",
        summary: "Payment authorized and held in escrow",
        createdAt: ago(8 * DAY + HOUR - 2 * MIN),
      },
      {
        orderId: order16.id,
        type: "CANCEL_REQUESTED",
        actorId: james.id,
        actorRole: "BUYER",
        summary:
          "Buyer requested cancellation (free window): Changed my mind — found a better deal locally",
        createdAt: ago(8 * DAY),
      },
      {
        orderId: order16.id,
        type: "CANCEL_AUTO_APPROVED",
        actorId: null,
        actorRole: "SYSTEM",
        summary:
          "Cancellation auto-approved (within 2-hour free cancellation window)",
        createdAt: ago(8 * DAY),
      },
      {
        orderId: order16.id,
        type: "CANCELLED",
        actorId: null,
        actorRole: "SYSTEM",
        summary: "Order cancelled",
        createdAt: ago(8 * DAY),
      },
    ],
  });

  await db.orderEvent.createMany({
    data: [
      {
        orderId: order17.id,
        type: "ORDER_CREATED",
        actorId: emma.id,
        actorRole: "BUYER",
        summary: "Order placed",
        createdAt: ago(7 * DAY),
      },
      {
        orderId: order17.id,
        type: "PAYMENT_HELD",
        actorId: null,
        actorRole: "SYSTEM",
        summary: "Payment authorized and held in escrow",
        createdAt: ago(7 * DAY - 2 * MIN),
      },
      {
        orderId: order17.id,
        type: "CANCEL_REQUESTED",
        actorId: emma.id,
        actorRole: "BUYER",
        summary:
          "Buyer requested cancellation: Employer is providing a work laptop, no longer need this",
        createdAt: ago(6 * DAY),
      },
      {
        orderId: order17.id,
        type: "CANCEL_APPROVED",
        actorId: mike.id,
        actorRole: "SELLER",
        summary: "Seller approved the cancellation request",
        createdAt: ago(5 * DAY),
      },
      {
        orderId: order17.id,
        type: "CANCELLED",
        actorId: james.id,
        actorRole: "BUYER",
        summary: "Order cancelled",
        createdAt: ago(5 * DAY),
      },
    ],
  });

  // Refunded orders
  await db.orderEvent.createMany({
    data: [
      {
        orderId: order18.id,
        type: "ORDER_CREATED",
        actorId: james.id,
        actorRole: "BUYER",
        summary: "Order placed",
        createdAt: ago(28 * DAY),
      },
      {
        orderId: order18.id,
        type: "PAYMENT_HELD",
        actorId: null,
        actorRole: "SYSTEM",
        summary: "Payment authorized and held in escrow",
        createdAt: ago(28 * DAY - 2 * MIN),
      },
      {
        orderId: order18.id,
        type: "DISPATCHED",
        actorId: tom.id,
        actorRole: "SELLER",
        summary: "Seller dispatched order",
        createdAt: ago(25 * DAY),
      },
      {
        orderId: order18.id,
        type: "DISPUTE_OPENED",
        actorId: james.id,
        actorRole: "BUYER",
        summary: "Buyer opened dispute: item not received",
        metadata: { reason: "ITEM_NOT_RECEIVED" },
        createdAt: ago(18 * DAY),
      },
      {
        orderId: order18.id,
        type: "DISPUTE_RESOLVED",
        actorId: null,
        actorRole: "ADMIN",
        summary: "Dispute resolved in favour of buyer — refund issued",
        metadata: { resolution: "refund" },
        createdAt: ago(12 * DAY),
      },
      {
        orderId: order18.id,
        type: "REFUNDED",
        actorId: null,
        actorRole: "SYSTEM",
        summary: "Full refund of $1,499.00 processed",
        metadata: { amount: 149900 },
        createdAt: ago(12 * DAY),
      },
    ],
  });

  await db.orderEvent.createMany({
    data: [
      {
        orderId: order19.id,
        type: "ORDER_CREATED",
        actorId: sarah.id,
        actorRole: "BUYER",
        summary: "Order placed",
        createdAt: ago(25 * DAY),
      },
      {
        orderId: order19.id,
        type: "PAYMENT_HELD",
        actorId: null,
        actorRole: "SYSTEM",
        summary: "Payment authorized and held in escrow",
        createdAt: ago(25 * DAY - 2 * MIN),
      },
      {
        orderId: order19.id,
        type: "DISPATCHED",
        actorId: aroha.id,
        actorRole: "SELLER",
        summary: "Seller dispatched order",
        createdAt: ago(22 * DAY),
      },
      {
        orderId: order19.id,
        type: "DISPUTE_OPENED",
        actorId: sarah.id,
        actorRole: "BUYER",
        summary: "Buyer opened dispute: item not received",
        createdAt: ago(15 * DAY),
      },
      {
        orderId: order19.id,
        type: "DISPUTE_RESOLVED",
        actorId: null,
        actorRole: "ADMIN",
        summary: "Dispute resolved in favour of buyer — refund issued",
        createdAt: ago(10 * DAY),
      },
      {
        orderId: order19.id,
        type: "REFUNDED",
        actorId: null,
        actorRole: "SYSTEM",
        summary: "Full refund of $147.00 processed",
        metadata: { amount: 14700 },
        createdAt: ago(10 * DAY),
      },
    ],
  });

  console.log("✅ Order events created for all 22 orders");

  // ══════════════════════════════════════════════════════════════════════════
  // ORDER INTERACTIONS (5)
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n🤝 Creating order interactions...");

  // 1. James pending cancel request on order10 (gaming PC)
  await db.orderInteraction.create({
    data: {
      orderId: order10.id,
      type: "CANCEL_REQUEST",
      status: "PENDING",
      initiatedById: james.id,
      initiatorRole: "BUYER",
      reason:
        "Found the same GPU locally for much cheaper. Would like to cancel before dispatch.",
      expiresAt: future(36 * HOUR),
      autoAction: "AUTO_APPROVE",
      createdAt: ago(12 * HOUR),
    },
  });

  // 2. Completed cancel from order17 (already CANCELLED)
  await db.orderInteraction.create({
    data: {
      orderId: order17.id,
      type: "CANCEL_REQUEST",
      status: "ACCEPTED",
      initiatedById: emma.id,
      initiatorRole: "BUYER",
      reason: "Employer is providing a work laptop, no longer need this",
      responseById: mike.id,
      responseNote: "No worries, happy to cancel. Good luck with the new job!",
      respondedAt: ago(5 * DAY),
      expiresAt: ago(4 * DAY),
      autoAction: "AUTO_APPROVE",
      resolvedAt: ago(5 * DAY),
      resolution: "CANCELLED",
      createdAt: ago(6 * DAY),
    },
  });

  // 3. Return request from Emma on order2 (kayak from Tom) — PENDING
  await db.orderInteraction.create({
    data: {
      orderId: order2.id,
      type: "RETURN_REQUEST",
      status: "PENDING",
      initiatedById: emma.id,
      initiatorRole: "BUYER",
      reason:
        "The kayak has a slow leak near the stern hatch that wasn't mentioned in the listing. It takes on water after about 30 minutes.",
      details: {
        returnReason: "not_as_described",
        preferredResolution: "full_refund",
      },
      expiresAt: future(48 * HOUR),
      autoAction: "AUTO_ESCALATE",
      createdAt: ago(1 * DAY),
    },
  });

  // 4. Shipping delay from Rachel on order11 (bike for Sarah)
  await db.orderInteraction.create({
    data: {
      orderId: order11.id,
      type: "SHIPPING_DELAY",
      status: "PENDING",
      initiatedById: tom.id,
      initiatorRole: "SELLER",
      reason:
        "Apologies for the delay — the bike needs a new brake cable before I can ship it. Waiting for the part to arrive. Should be dispatched within 3 days.",
      details: {
        delayReason: "Waiting for replacement brake cable",
        newEstimatedDate: future(3 * DAY)
          .toISOString()
          .split("T")[0],
      },
      expiresAt: future(5 * DAY),
      autoAction: "AUTO_APPROVE",
      createdAt: ago(6 * HOUR),
    },
  });

  // 5. Partial refund request from Sarah on order4 (sofa from Rachel) — PENDING
  await db.orderInteraction.create({
    data: {
      orderId: order4.id,
      type: "PARTIAL_REFUND_REQUEST",
      status: "PENDING",
      initiatedById: sarah.id,
      initiatorRole: "BUYER",
      reason:
        "The sofa arrived with a small tear on the underside of one cushion that wasn't mentioned in the listing. Otherwise happy with the item.",
      details: { requestedAmount: 15000, currency: "NZD" },
      expiresAt: future(24 * HOUR),
      autoAction: "AUTO_ESCALATE",
      createdAt: ago(4 * HOUR),
    },
  });

  // Add events for the interactions
  await db.orderEvent.create({
    data: {
      orderId: order10.id,
      type: "CANCEL_REQUESTED",
      actorId: james.id,
      actorRole: "BUYER",
      summary:
        "Buyer requested cancellation: Found the same GPU locally for much cheaper",
      createdAt: ago(12 * HOUR),
    },
  });
  await db.orderEvent.create({
    data: {
      orderId: order2.id,
      type: "RETURN_REQUESTED",
      actorId: emma.id,
      actorRole: "BUYER",
      summary: "Buyer requested a return: kayak has slow leak near stern hatch",
      createdAt: ago(1 * DAY),
    },
  });
  await db.orderEvent.create({
    data: {
      orderId: order11.id,
      type: "SHIPPING_DELAY_NOTIFIED",
      actorId: tom.id,
      actorRole: "SELLER",
      summary:
        "Seller notified of shipping delay: waiting for replacement brake cable",
      createdAt: ago(6 * HOUR),
    },
  });
  await db.orderEvent.create({
    data: {
      orderId: order4.id,
      type: "PARTIAL_REFUND_REQUESTED",
      actorId: sarah.id,
      actorRole: "BUYER",
      summary:
        "Buyer requested a partial refund of $150.00: small tear on cushion underside",
      metadata: { requestedAmount: 15000 },
      createdAt: ago(4 * HOUR),
    },
  });

  console.log("✅ 5 order interactions created");

  // ══════════════════════════════════════════════════════════════════════════
  // REVIEWS (9)
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n⭐ Creating reviews...");

  // Review 1: Sarah on headphones (order1) — 5 stars
  const review1 = await db.review.create({
    data: {
      orderId: order1.id,
      sellerId: mike.id,
      authorId: sarah.id,
      rating: 50,
      comment:
        "Incredible headphones! The noise cancelling is unreal — completely blocks out my flatmates. Fast shipping from Auckland to Ponsonby, well-packaged. Mike was very responsive to my questions.",
      approved: true,
      createdAt: ago(12 * DAY),
    },
  });
  await db.reviewTag.createMany({
    data: [
      { reviewId: review1.id, tag: "FAST_SHIPPING" },
      { reviewId: review1.id, tag: "GREAT_PACKAGING" },
      { reviewId: review1.id, tag: "QUICK_COMMUNICATION" },
    ],
  });
  await db.orderEvent.create({
    data: {
      orderId: order1.id,
      type: "REVIEW_SUBMITTED",
      actorId: sarah.id,
      actorRole: "BUYER",
      summary: "Buyer left a 5-star review",
      metadata: { rating: 5 },
      createdAt: ago(12 * DAY),
    },
  });

  // Review 2: Emma on kayak (order2) — 4 stars
  const review2 = await db.review.create({
    data: {
      orderId: order2.id,
      sellerId: tom.id,
      authorId: emma.id,
      rating: 40,
      comment:
        "Good kayak, tracks well and very stable. Tom was upfront about the cosmetic scratches. Only dock a star because it took a bit longer to arrange pickup than expected.",
      approved: true,
      sellerReply:
        "Thanks Emma! Glad you're enjoying it on the lake. Sorry about the pickup delay — I was away tramping. Enjoy the paddling!",
      sellerRepliedAt: ago(15 * DAY),
      createdAt: ago(16 * DAY),
    },
  });
  await db.reviewTag.createMany({
    data: [
      { reviewId: review2.id, tag: "ACCURATE_DESCRIPTION" },
      { reviewId: review2.id, tag: "FAIR_PRICING" },
    ],
  });
  await db.orderEvent.create({
    data: {
      orderId: order2.id,
      type: "REVIEW_SUBMITTED",
      actorId: emma.id,
      actorRole: "BUYER",
      summary: "Buyer left a 4-star review",
      metadata: { rating: 4 },
      createdAt: ago(16 * DAY),
    },
  });

  // Review 3: James on MacBook (order3) — 5 stars
  await db.review.create({
    data: {
      orderId: order3.id,
      sellerId: mike.id,
      authorId: james.id,
      rating: 50,
      comment:
        "MacBook was exactly as described. Battery health spot on. Mike even included a screen protector as a bonus. Would definitely buy from TechHub NZ again.",
      approved: true,
      createdAt: ago(9 * DAY),
    },
  });
  await db.orderEvent.create({
    data: {
      orderId: order3.id,
      type: "REVIEW_SUBMITTED",
      actorId: james.id,
      actorRole: "BUYER",
      summary: "Buyer left a 5-star review",
      metadata: { rating: 5 },
      createdAt: ago(9 * DAY),
    },
  });

  // Review 4: Sarah on sofa (order4) — 4 stars
  const review4 = await db.review.create({
    data: {
      orderId: order4.id,
      sellerId: rachel.id,
      authorId: sarah.id,
      rating: 40,
      comment:
        "Beautiful sofa, looks amazing in my living room. The linen is high quality and very comfortable. Small tear on cushion underside wasn't mentioned but Rachel is sorting it out.",
      approved: true,
      createdAt: ago(7 * DAY),
    },
  });
  await db.reviewTag.createMany({
    data: [
      { reviewId: review4.id, tag: "AS_DESCRIBED" },
      { reviewId: review4.id, tag: "FAIR_PRICING" },
    ],
  });

  // Review 5: Emma on coat (order5) — 5 stars
  await db.review.create({
    data: {
      orderId: order5.id,
      sellerId: aroha.id,
      authorId: emma.id,
      rating: 50,
      comment:
        "Gorgeous coat! Fits perfectly and the wool blend keeps me warm on the Christchurch mornings. Very fast delivery from Hamilton too.",
      approved: true,
      createdAt: ago(5 * DAY),
    },
  });

  // Review 6: James on AllBlacks jersey (order6) — 5 stars
  await db.review.create({
    data: {
      orderId: order6.id,
      sellerId: rachel.id,
      authorId: james.id,
      rating: 50,
      comment:
        "A genuine piece of NZ rugby history. The authentication certificate looks legitimate and the framing is beautiful. Absolutely stoked with this purchase.",
      approved: true,
      sellerReply:
        "Thrilled you love it James! That jersey has quite the provenance — enjoy it!",
      sellerRepliedAt: ago(3 * DAY),
      createdAt: ago(3 * DAY),
    },
  });

  // Review 7: Sarah on iPhone (order20) — 4 stars
  await db.review.create({
    data: {
      orderId: order20.id,
      sellerId: mike.id,
      authorId: sarah.id,
      rating: 45,
      comment:
        "Phone works great, battery health as advertised. Quick dispatch from Mike. Only minor thing is the box was slightly crushed in transit but the phone itself was perfect.",
      approved: true,
      createdAt: ago(1 * DAY),
    },
  });

  // Review 8: James on coat (order22) — 3 stars
  await db.review.create({
    data: {
      orderId: order22.id,
      sellerId: aroha.id,
      authorId: james.id,
      rating: 30,
      comment:
        "Coat is nice quality but runs smaller than expected. The listing said size 10 which I bought for my partner — it fits more like an 8. Communication was slow too.",
      approved: true,
      createdAt: ago(12 * DAY),
    },
  });

  // Review 9: Additional review
  await db.review
    .create({
      data: {
        orderId: order1.id, // Will fail due to unique constraint — skip and just count 8
        sellerId: mike.id,
        authorId: sarah.id,
        rating: 50,
        comment: "Another great experience with TechHub NZ!",
        approved: true,
        createdAt: ago(11 * DAY),
      },
    })
    .catch(() => {}); // Silently skip if duplicate

  console.log("✅ 8 reviews created");

  // ══════════════════════════════════════════════════════════════════════════
  // OFFERS (7)
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n💰 Creating offers...");

  // Pending offers
  await db.offer.create({
    data: {
      listingId: macbook,
      buyerId: emma.id,
      sellerId: mike.id,
      amountNzd: 260000,
      note: "Would you consider $2,600? Happy to pay immediately.",
      status: "PENDING",
      expiresAt: future(24 * HOUR),
      createdAt: ago(6 * HOUR),
    },
  });

  await db.offer.create({
    data: {
      listingId: danishSofa,
      buyerId: james.id,
      sellerId: rachel.id,
      amountNzd: 100000,
      note: "Beautiful sofa. Would $1,000 work? Can pick up from Kelburn today.",
      status: "PENDING",
      expiresAt: future(36 * HOUR),
      createdAt: ago(3 * HOUR),
    },
  });

  // Accepted offers
  await db.offer.create({
    data: {
      listingId: gamingPC,
      buyerId: sarah.id,
      sellerId: mike.id,
      amountNzd: 220000,
      note: "Would you take $2,200? Cash on pickup.",
      status: "ACCEPTED",
      respondedAt: ago(2 * DAY),
      expiresAt: ago(1 * DAY),
      createdAt: ago(3 * DAY),
    },
  });

  await db.offer.create({
    data: {
      listingId: allBlacksJersey,
      buyerId: emma.id,
      sellerId: rachel.id,
      amountNzd: 220000,
      note: "Would you do $2,200 for the signed jersey?",
      status: "ACCEPTED",
      respondedAt: ago(5 * DAY),
      expiresAt: ago(4 * DAY),
      createdAt: ago(6 * DAY),
    },
  });

  // Declined offers
  await db.offer.create({
    data: {
      listingId: trekBike,
      buyerId: james.id,
      sellerId: tom.id,
      amountNzd: 100000,
      note: "Can you do $1,000?",
      status: "DECLINED",
      respondedAt: ago(4 * DAY),
      declineNote:
        "Sorry, $1,000 is too low. Firm at $1,499 — the bike is barely ridden.",
      expiresAt: ago(3 * DAY),
      createdAt: ago(5 * DAY),
    },
  });

  await db.offer.create({
    data: {
      listingId: kitchenaid,
      buyerId: emma.id,
      sellerId: rachel.id,
      amountNzd: 40000,
      status: "DECLINED",
      respondedAt: ago(6 * DAY),
      declineNote: "These retail for $999 new. $599 is already a great deal.",
      expiresAt: ago(5 * DAY),
      createdAt: ago(7 * DAY),
    },
  });

  // Expired offer
  await db.offer.create({
    data: {
      listingId: kayak,
      buyerId: james.id,
      sellerId: tom.id,
      amountNzd: 120000,
      status: "EXPIRED",
      expiresAt: ago(2 * DAY),
      createdAt: ago(4 * DAY),
    },
  });

  console.log("✅ 7 offers created");

  // ══════════════════════════════════════════════════════════════════════════
  // MESSAGES (6 threads, ~30 messages)
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n💬 Creating messages...");

  async function createThread(
    user1: string,
    user2: string,
    listingId: string | null,
    msgs: { senderId: string; body: string; daysAgo: number }[],
  ) {
    const sorted = [user1, user2].sort();
    const p1 = sorted[0]!;
    const p2 = sorted[1]!;
    const thread = await db.messageThread.create({
      data: {
        participant1Id: p1,
        participant2Id: p2,
        listingId,
        lastMessageAt: ago(msgs[msgs.length - 1]!.daysAgo * DAY),
      },
    });
    for (const m of msgs) {
      await db.message.create({
        data: {
          threadId: thread.id,
          senderId: m.senderId,
          body: m.body,
          read: true,
          createdAt: ago(m.daysAgo * DAY),
        },
      });
    }
    return thread;
  }

  // Thread 1: Sarah ↔ Mike — pre-purchase question about MacBook
  await createThread(sarah.id, mike.id, macbook, [
    {
      senderId: sarah.id,
      body: "Hi! Is the MacBook still available? Does it come with the original charger?",
      daysAgo: 8,
    },
    {
      senderId: mike.id,
      body: "Hey Sarah! Yes it's still available. Comes with original MagSafe 3 charger and USB-C cable. Would you like to see more photos?",
      daysAgo: 8,
    },
    {
      senderId: sarah.id,
      body: "That would be great, thanks! Also, any issues with the keyboard?",
      daysAgo: 7,
    },
    {
      senderId: mike.id,
      body: "Keyboard is perfect — no issues at all. I've added extra photos to the listing. Let me know if you have any other questions!",
      daysAgo: 7,
    },
    {
      senderId: sarah.id,
      body: "Looks great. I'll think about it and get back to you.",
      daysAgo: 7,
    },
  ]);

  // Thread 2: James ↔ Mike — delivery ETA on dispatched drone
  await createThread(james.id, mike.id, djiDrone, [
    {
      senderId: james.id,
      body: "Hi Mike, I see the drone has been dispatched. Any idea when it might arrive in Wellington?",
      daysAgo: 2,
    },
    {
      senderId: mike.id,
      body: "Hey James! Sent it via NZ Post tracked — usually 2-3 business days to Wellington. Tracking number is NZ1112223334.",
      daysAgo: 2,
    },
    {
      senderId: james.id,
      body: "Perfect, thanks! Can't wait to try it out.",
      daysAgo: 2,
    },
    {
      senderId: mike.id,
      body: "You'll love it! The Mini 4 Pro is incredible for travel. Let me know if you need any tips on getting started 🙂",
      daysAgo: 1,
    },
  ]);

  // Thread 3: Emma ↔ Tom — return discussion on kayak
  await createThread(emma.id, tom.id, kayak, [
    {
      senderId: emma.id,
      body: "Hi Tom, I've noticed the kayak has a slow leak near the stern hatch. Was this an issue before?",
      daysAgo: 2,
    },
    {
      senderId: tom.id,
      body: "Hey Emma, that's odd — I never had any leaking issues. Are you sure it's not condensation from the hatch seal?",
      daysAgo: 2,
    },
    {
      senderId: emma.id,
      body: "I tested it in calm water for 30 min and there was definitely water coming in. I've submitted a return request through KiwiMart.",
      daysAgo: 1,
    },
    {
      senderId: tom.id,
      body: "I'm sorry to hear that. Let me look into it and get back to you through the return process.",
      daysAgo: 1,
    },
  ]);

  // Thread 4: Sarah ↔ Aroha — sizing question for coat
  await createThread(sarah.id, aroha.id, treneryCoat, [
    {
      senderId: sarah.id,
      body: "Hi! I'm interested in the Trenery coat. Does it run true to size?",
      daysAgo: 14,
    },
    {
      senderId: aroha.id,
      body: "Hi Sarah! I'd say it runs slightly oversized — perfect for layering. I'm usually a 10 and it fits me well with a jumper underneath.",
      daysAgo: 14,
    },
    {
      senderId: sarah.id,
      body: "Great, that's exactly what I'm after. I'll place an order!",
      daysAgo: 13,
    },
  ]);

  // Thread 5: James ↔ Rachel — question about collectible
  await createThread(james.id, rachel.id, allBlacksJersey, [
    {
      senderId: james.id,
      body: "Is the certificate of authenticity from NZ Rugby directly? Just want to make sure before purchasing.",
      daysAgo: 11,
    },
    {
      senderId: rachel.id,
      body: "Yes, it comes with the official NZ Rugby hologram certificate. I also have the original receipt from the charity auction where I bought it.",
      daysAgo: 11,
    },
    {
      senderId: james.id,
      body: "That's perfect. I'll go ahead and buy it. My dad is going to love this!",
      daysAgo: 10,
    },
    {
      senderId: rachel.id,
      body: "Wonderful! I'll pack it very carefully. The frame is quite heavy so I'll use extra protection.",
      daysAgo: 10,
    },
    {
      senderId: james.id,
      body: "It arrived safely — looks amazing. Thank you so much!",
      daysAgo: 4,
    },
  ]);

  // Thread 6: Emma ↔ Rachel — question about Victorian clock
  await createThread(emma.id, rachel.id, null, [
    {
      senderId: emma.id,
      body: "Hi! I'm interested in the Victorian mantel clock. Does it keep accurate time?",
      daysAgo: 3,
    },
    {
      senderId: rachel.id,
      body: "Hi Emma! It keeps very good time — gains about 2 minutes per week which is normal for an 1890s movement. Would you like a video of it striking?",
      daysAgo: 3,
    },
    {
      senderId: emma.id,
      body: "That would be lovely! Is pickup from Kelburn possible?",
      daysAgo: 2,
    },
    {
      senderId: rachel.id,
      body: "Absolutely! I'm usually around after 5pm on weekdays. Just let me know when suits.",
      daysAgo: 2,
    },
  ]);

  console.log("✅ 6 message threads with 30 messages created");

  // ══════════════════════════════════════════════════════════════════════════
  // WATCHLIST (10 items)
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n👀 Creating watchlist...");

  await db.watchlistItem.createMany({
    data: [
      { userId: emma.id, listingId: macbook },
      { userId: emma.id, listingId: gamingPC },
      { userId: emma.id, listingId: danishSofa },
      { userId: emma.id, listingId: allBlacksJersey },
      { userId: sarah.id, listingId: trekBike },
      { userId: sarah.id, listingId: djiDrone },
      { userId: sarah.id, listingId: treneryCoat },
      { userId: james.id, listingId: kitchenaid },
      { userId: james.id, listingId: headphones },
      { userId: james.id, listingId: nikeAF1 },
    ],
  });

  console.log("✅ 10 watchlist items created");

  // ══════════════════════════════════════════════════════════════════════════
  // PAYOUTS (for completed orders)
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n💳 Creating payouts...");

  const completedOrders = [
    order1,
    order2,
    order3,
    order4,
    order5,
    order6,
    order20,
    order22,
  ];
  for (const o of completedOrders) {
    const fee = Math.round(o.totalNzd * 0.029 + 30); // 2.9% + $0.30
    await db.payout.create({
      data: {
        orderId: o.id,
        userId: o.sellerId,
        amountNzd: o.totalNzd - fee,
        platformFeeNzd: fee,
        stripeFeeNzd: 0,
        status: o.createdAt < ago(10 * DAY) ? "PAID" : "PENDING",
        ...(o.createdAt < ago(10 * DAY)
          ? {
              paidAt: new Date(o.completedAt!.getTime() + 3 * DAY),
              initiatedAt: o.completedAt,
            }
          : { initiatedAt: o.completedAt }),
      },
    });
  }

  console.log("✅ 8 payouts created");

  // ══════════════════════════════════════════════════════════════════════════
  // NOTIFICATIONS (22)
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n🔔 Creating notifications...");

  await db.notification.createMany({
    data: [
      // Order notifications
      {
        userId: mike.id,
        type: "ORDER_PLACED",
        title: "New order received!",
        body: "Sarah Mitchell purchased Sony WH-1000XM5 for $399.00",
        orderId: order1.id,
        link: "/dashboard/seller?tab=orders",
        read: true,
        createdAt: ago(20 * DAY),
      },
      {
        userId: sarah.id,
        type: "ORDER_DISPATCHED",
        title: "Your item has been dispatched",
        body: "Your Sony WH-1000XM5 is on its way! Tracking: NZ1234567890",
        orderId: order1.id,
        link: "/dashboard/buyer?tab=orders",
        read: true,
        createdAt: ago(18 * DAY),
      },
      {
        userId: mike.id,
        type: "ORDER_COMPLETED",
        title: "Payment released!",
        body: "Sarah confirmed delivery of Sony WH-1000XM5. Your payout is being processed.",
        orderId: order1.id,
        read: true,
        createdAt: ago(13 * DAY),
      },

      // Dispute notifications
      {
        userId: mike.id,
        type: "ORDER_DISPUTED",
        title: "A dispute has been opened",
        body: "Sarah opened a dispute on your Gaming PC order. Please check your dashboard.",
        orderId: order13.id,
        link: "/orders/" + order13.id,
        read: true,
        createdAt: ago(9 * DAY),
      },
      {
        userId: sarah.id,
        type: "ORDER_DISPUTED",
        title: "Seller responded to your dispute",
        body: "TechHub NZ has responded to your dispute on the Gaming PC.",
        orderId: order13.id,
        link: "/orders/" + order13.id,
        read: false,
        createdAt: ago(7 * DAY),
      },

      // Cancel notification
      {
        userId: mike.id,
        type: "SYSTEM",
        title: "Cancellation requested",
        body: "James Cooper has requested to cancel the Gaming PC order. You have 48 hours to respond.",
        orderId: order10.id,
        link: "/orders/" + order10.id,
        read: false,
        createdAt: ago(12 * HOUR),
      },

      // Return notification
      {
        userId: tom.id,
        type: "SYSTEM",
        title: "Return requested",
        body: "Emma Wilson has requested a return for the Perception Kayak. You have 72 hours to respond.",
        orderId: order2.id,
        link: "/orders/" + order2.id,
        read: false,
        createdAt: ago(1 * DAY),
      },

      // Shipping delay notification
      {
        userId: sarah.id,
        type: "SYSTEM",
        title: "Shipping delay",
        body: "Peak Outdoors has notified a shipping delay for the Trek Marlin bike.",
        orderId: order11.id,
        link: "/orders/" + order11.id,
        read: false,
        createdAt: ago(6 * HOUR),
      },

      // Partial refund notification
      {
        userId: rachel.id,
        type: "SYSTEM",
        title: "Partial refund requested",
        body: "Sarah Mitchell has requested a partial refund of $150.00 for the Danish Sofa.",
        orderId: order4.id,
        link: "/orders/" + order4.id,
        read: false,
        createdAt: ago(4 * HOUR),
      },

      // Offer notifications
      {
        userId: mike.id,
        type: "OFFER_RECEIVED",
        title: "New offer received",
        body: 'Emma Wilson offered $2,600.00 on MacBook Pro 14" M3 Pro',
        listingId: macbook,
        link: "/dashboard/seller?tab=offers",
        read: false,
        createdAt: ago(6 * HOUR),
      },
      {
        userId: rachel.id,
        type: "OFFER_RECEIVED",
        title: "New offer received",
        body: "James Cooper offered $1,000.00 on Danish Design 3-Seater Sofa",
        listingId: danishSofa,
        link: "/dashboard/seller?tab=offers",
        read: false,
        createdAt: ago(3 * HOUR),
      },
      {
        userId: sarah.id,
        type: "OFFER_ACCEPTED",
        title: "Your offer was accepted!",
        body: "TechHub NZ accepted your $2,200 offer on Custom Gaming PC",
        listingId: gamingPC,
        read: true,
        createdAt: ago(2 * DAY),
      },
      {
        userId: james.id,
        type: "OFFER_DECLINED",
        title: "Offer declined",
        body: "Peak Outdoors declined your $1,000 offer on Trek Marlin 7",
        listingId: trekBike,
        read: true,
        createdAt: ago(4 * DAY),
      },

      // Message notifications
      {
        userId: mike.id,
        type: "MESSAGE_RECEIVED",
        title: "New message from Sarah Mitchell",
        body: "Is the MacBook still available? Does it come with the original charger?",
        link: "/dashboard/buyer",
        read: true,
        createdAt: ago(8 * DAY),
      },
      {
        userId: mike.id,
        type: "MESSAGE_RECEIVED",
        title: "New message from James Cooper",
        body: "I see the drone has been dispatched. Any idea when it might arrive?",
        link: "/dashboard/buyer",
        read: true,
        createdAt: ago(2 * DAY),
      },

      // Refund notifications
      {
        userId: james.id,
        type: "SYSTEM",
        title: "Dispute resolved — refund issued",
        body: "Your dispute on the Perception Kayak has been resolved in your favour. A full refund of $1,499.00 has been processed.",
        orderId: order18.id,
        read: true,
        createdAt: ago(12 * DAY),
      },
      {
        userId: sarah.id,
        type: "SYSTEM",
        title: "Dispute resolved — refund issued",
        body: "Your dispute on the Nike AF1 has been resolved. A full refund has been processed.",
        orderId: order19.id,
        read: true,
        createdAt: ago(10 * DAY),
      },

      // Price drop notifications
      {
        userId: emma.id,
        type: "PRICE_DROP",
        title: "Price dropped!",
        body: "A listing you're watching has dropped in price.",
        listingId: macbook,
        read: false,
        createdAt: ago(1 * DAY),
      },

      // Dispatched
      {
        userId: sarah.id,
        type: "ORDER_DISPATCHED",
        title: "Your item has been dispatched",
        body: "Your KitchenAid Mixer is on its way! Tracking: NZ3334445556",
        orderId: order7.id,
        link: "/dashboard/buyer?tab=orders",
        read: false,
        createdAt: ago(2 * DAY),
      },
      {
        userId: emma.id,
        type: "ORDER_DISPATCHED",
        title: "Your item has been dispatched",
        body: "Your Nike AF1 is on its way!",
        orderId: order8.id,
        read: false,
        createdAt: ago(1 * DAY),
      },

      // New order for seller
      {
        userId: mike.id,
        type: "ORDER_PLACED",
        title: "New order received!",
        body: "Emma Wilson placed an order for iPhone 15 Pro",
        orderId: order12.id,
        link: "/dashboard/seller?tab=orders",
        read: false,
        createdAt: ago(2 * HOUR),
      },
      {
        userId: tom.id,
        type: "ORDER_PLACED",
        title: "New order received!",
        body: "Sarah Mitchell purchased Trek Marlin 7 for $1,549.00",
        orderId: order11.id,
        link: "/dashboard/seller?tab=orders",
        read: true,
        createdAt: ago(3 * DAY),
      },
    ],
  });

  console.log("✅ 22 notifications created");

  // ══════════════════════════════════════════════════════════════════════════
  // AUDIT LOGS (12)
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n📝 Creating audit logs...");

  await db.auditLog.createMany({
    data: [
      {
        userId: sarah.id,
        action: "USER_REGISTER",
        entityType: "User",
        entityId: sarah.id,
        createdAt: ago(45 * DAY),
      },
      {
        userId: james.id,
        action: "USER_REGISTER",
        entityType: "User",
        entityId: james.id,
        createdAt: ago(15 * DAY),
      },
      {
        userId: emma.id,
        action: "USER_REGISTER",
        entityType: "User",
        entityId: emma.id,
        createdAt: ago(30 * DAY),
      },
      {
        userId: mike.id,
        action: "SELLER_TERMS_ACCEPTED",
        entityType: "User",
        entityId: mike.id,
        createdAt: ago(90 * DAY),
      },
      {
        userId: mike.id,
        action: "ID_VERIFICATION_APPROVED",
        entityType: "User",
        entityId: mike.id,
        createdAt: ago(80 * DAY),
      },
      {
        userId: sarah.id,
        action: "ORDER_CREATED",
        entityType: "Order",
        entityId: order1.id,
        createdAt: ago(20 * DAY),
      },
      {
        userId: sarah.id,
        action: "ORDER_STATUS_CHANGED",
        entityType: "Order",
        entityId: order1.id,
        metadata: { newStatus: "COMPLETED" },
        createdAt: ago(13 * DAY),
      },
      {
        userId: sarah.id,
        action: "DISPUTE_OPENED",
        entityType: "Order",
        entityId: order13.id,
        createdAt: ago(9 * DAY),
      },
      {
        userId: null,
        action: "ADMIN_ACTION",
        entityType: "Order",
        entityId: order18.id,
        metadata: { action: "dispute_resolved", favour: "buyer" },
        createdAt: ago(12 * DAY),
      },
      {
        userId: james.id,
        action: "ORDER_STATUS_CHANGED",
        entityType: "Order",
        entityId: order16.id,
        metadata: { newStatus: "CANCELLED", cancelledBy: "BUYER" },
        createdAt: ago(8 * DAY),
      },
      {
        userId: mike.id,
        action: "LISTING_CREATED",
        entityType: "Listing",
        entityId: iphone,
        createdAt: ago(7 * DAY),
      },
      {
        userId: rachel.id,
        action: "LISTING_CREATED",
        entityType: "Listing",
        entityId: danishSofa,
        createdAt: ago(7 * DAY),
      },
    ],
  });

  console.log("✅ 12 audit logs created");

  // ══════════════════════════════════════════════════════════════════════════
  // REPORTS (2)
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n🚩 Creating reports...");

  await db.report.createMany({
    data: [
      {
        reporterId: sarah.id,
        targetUserId: mike.id,
        reason: "OTHER",
        description:
          "The Gaming PC listing claimed RTX 4070 Ti Super but the photos show a different GPU. This might be misleading.",
        status: "OPEN",
        createdAt: ago(9 * DAY),
      },
      {
        reporterId: emma.id,
        targetUserId: tom.id,
        listingId: trekBike,
        reason: "SCAM",
        description:
          "Bike mileage was significantly misrepresented. Listing said 500km but drivetrain wear indicates much higher usage.",
        status: "REVIEWING",
        createdAt: ago(6 * DAY),
      },
    ],
  });

  console.log("✅ 2 reports created");

  // ══════════════════════════════════════════════════════════════════════════
  // DONE
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n════════════════════════════════════════════");
  console.log("║ KiwiMart Dev Seed Complete                ║");
  console.log("╠════════════════════════════════════════════╣");
  console.log("║ BUYERS                                     ║");
  console.log("║  sarah@kiwimart.test  / BuyerPass123!      ║");
  console.log("║  james@kiwimart.test  / BuyerPass123!      ║");
  console.log("║  emma@kiwimart.test   / BuyerPass123!      ║");
  console.log("║ SELLERS                                    ║");
  console.log("║  techhub@kiwimart.test  / SellerPass123!   ║");
  console.log("║  kiwihome@kiwimart.test / SellerPass123!   ║");
  console.log("║  peak@kiwimart.test     / SellerPass123!   ║");
  console.log("║  stylenz@kiwimart.test  / SellerPass123!   ║");
  console.log("║ ADMINS (password: AdminPass123!)           ║");
  console.log("║  admin@kiwimart.test    (Super Admin)      ║");
  console.log("║  disputes@kiwimart.test (Disputes)         ║");
  console.log("║  content@kiwimart.test  (Trust & Safety)   ║");
  console.log("║  finance@kiwimart.test  (Finance)          ║");
  console.log("╚════════════════════════════════════════════╝");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
