// prisma/seed.ts
// ─── KiwiMart Comprehensive Dev/Test Seed ───────────────────────────────────
// Exercises EVERY feature in the application including Phase 4 additions.
// Run: npx prisma db seed

import { PrismaClient, Prisma } from "@prisma/client";
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
  await db.trustMetrics.deleteMany();
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

  const superAdmin = await db.user.create({
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

  const disputeAdmin = await db.user.create({
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

  function active(
    sellerId: string,
    title: string,
    desc: string,
    priceNzd: number,
    condition: "NEW" | "LIKE_NEW" | "GOOD" | "FAIR" | "PARTS",
    categoryId: string,
    subcategoryName: string,
    region: string,
    suburb: string,
    shipping: "COURIER" | "PICKUP" | "BOTH" = "BOTH",
    shippingNzd: number | null = 800,
    daysAgo: number = 7,
  ): LD {
    return {
      sellerId,
      title,
      description: desc,
      priceNzd,
      condition,
      status: "ACTIVE",
      categoryId,
      subcategoryName,
      region,
      suburb,
      shippingOption: shipping,
      shippingNzd,
      offersEnabled: true,
      publishedAt: ago(daysAgo * DAY),
      expiresAt: future(30 * DAY),
      createdAt: ago(daysAgo * DAY),
      viewCount: Math.floor(Math.random() * 200) + 10,
      watcherCount: Math.floor(Math.random() * 15),
    };
  }

  // ── ELECTRONICS ─────────────────────────────────────────────────────────

  // Mobile Phones
  const iphone = await L(
    active(
      mike.id,
      "iPhone 15 Pro Max 256GB — Natural Titanium",
      "Purchased from Apple NZ in November 2024. Excellent condition with original box, charger, and AppleCare+ until March 2026. Screen protector since day one — no scratches.",
      189900,
      "LIKE_NEW",
      "electronics",
      "Mobile Phones",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1695048133142-1a20484d2569"),
      img("photo-1592750475338-74b7b21085ab"),
      img("photo-1510557880182-3d4d3cba35a5"),
    ],
    [
      ["Storage", "256GB"],
      ["Colour", "Natural Titanium"],
      ["AppleCare+", "Until Mar 2026"],
    ],
  );

  const samsung = await L(
    active(
      mike.id,
      "Samsung Galaxy S24 Ultra 512GB — Titanium Grey",
      "Flagship Samsung with S-Pen. Bought Jan 2025. Dual SIM, NZ model. Comes with original box and Samsung case. Perfect screen, zero marks.",
      169900,
      "LIKE_NEW",
      "electronics",
      "Mobile Phones",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1610945265064-0e34e5519bbf"),
      img("photo-1511707171634-5f897ff02aa9"),
      img("photo-1598327106026-d9521da673d1"),
    ],
    [
      ["Storage", "512GB"],
      ["Colour", "Titanium Grey"],
      ["Warranty", "Samsung NZ"],
    ],
  );

  await L(
    active(
      mike.id,
      "Google Pixel 8 Pro 128GB — Obsidian",
      "Unlocked Pixel 8 Pro with amazing camera system. Perfect for photography enthusiasts. Clean IMEI, factory reset. Includes original charger.",
      89900,
      "GOOD",
      "electronics",
      "Mobile Phones",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1598327105666-5b89351aff97"),
      img("photo-1605236453806-6ff36851218e"),
    ],
  );

  // Computers
  const macbook = await L(
    active(
      mike.id,
      'MacBook Pro 14" M3 Pro — 18GB/512GB Space Black',
      "2024 MacBook Pro with M3 Pro chip. 96 battery cycles, AppleCare+ active. Used lightly for web development. Comes with original box, charger, and MagSafe cable.",
      289900,
      "LIKE_NEW",
      "electronics",
      "Computers",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1517336714731-489689fd1ca8"),
      img("photo-1611186871348-b1ce696e52c9"),
      img("photo-1541807084-5c52b6b3adef"),
      img("photo-1629131726692-1accd0c53ce0"),
    ],
    [
      ["Chip", "M3 Pro"],
      ["RAM", "18GB"],
      ["Storage", "512GB SSD"],
      ["Battery Cycles", "96"],
    ],
  );

  await L(
    active(
      mike.id,
      "Custom Gaming PC — RTX 4070 Super / Ryzen 7 7800X3D",
      "Built in Dec 2024. Meshify 2 case, 32GB DDR5, 1TB NVMe. Plays everything at 1440p max settings. Never overclocked. Includes all original boxes.",
      249900,
      "LIKE_NEW",
      "electronics",
      "Computers",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1587202372775-e229f172b9d7"),
      img("photo-1591488320449-011701bb6704"),
      img("photo-1593640408182-31c70c8268f5"),
    ],
    [
      ["GPU", "RTX 4070 Super"],
      ["CPU", "Ryzen 7 7800X3D"],
      ["RAM", "32GB DDR5"],
    ],
  );

  await L(
    active(
      mike.id,
      "Dell XPS 15 (2024) — i7/32GB/1TB",
      "Dell XPS 15 with OLED display. Stunning screen for creative work. Includes USB-C dock and carry sleeve. Light wear on palm rest.",
      199900,
      "GOOD",
      "electronics",
      "Computers",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1496181133206-80ce9b88a853"),
      img("photo-1588872657578-7efd1f1555ed"),
    ],
  );

  // Audio
  const airpods = await L(
    active(
      mike.id,
      "AirPods Pro 2nd Gen (USB-C) — Sealed Box",
      "Brand new sealed AirPods Pro 2 with USB-C charging case. NZ Apple warranty. Won in a raffle — I already have a pair.",
      39900,
      "NEW",
      "electronics",
      "Audio",
      "Auckland",
      "Newmarket",
      "COURIER",
      600,
    ),
    [
      img("photo-1588423771073-b8903fba2b76"),
      img("photo-1606220588913-b3aacb4d2f46"),
    ],
  );

  await L(
    active(
      mike.id,
      "Sony WH-1000XM5 Noise-Cancelling Headphones",
      "Industry-leading noise cancellation. Silver colour. Lightly used for commuting. Includes case, cables, and flight adapter.",
      34900,
      "LIKE_NEW",
      "electronics",
      "Audio",
      "Auckland",
      "Newmarket",
      "BOTH",
      500,
    ),
    [
      img("photo-1546435770-a3e426bf472b"),
      img("photo-1505740420928-5e560c06d30e"),
    ],
  );

  await L(
    active(
      mike.id,
      "JBL Charge 5 Portable Bluetooth Speaker — Teal",
      "Waterproof portable speaker with incredible bass. Perfect for summer BBQs. Battery lasts 20+ hours. Minor scuff on base.",
      14900,
      "GOOD",
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

  // Cameras & Drones
  await L(
    active(
      mike.id,
      "DJI Mini 4 Pro Fly More Combo",
      "Complete drone kit with 3 batteries, charging hub, carrying case. Registered with CAA NZ. Sub-249g so no licence needed. Only 12 flights.",
      129900,
      "LIKE_NEW",
      "electronics",
      "Cameras & Drones",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1473968512647-3e447244af8f"),
      img("photo-1507582020474-9a35b7d455d9"),
      img("photo-1527977966376-1c8408f9f108"),
    ],
  );

  await L(
    active(
      mike.id,
      "Sony A7C II Mirrorless Camera — Body Only",
      "Compact full-frame mirrorless. 33MP sensor. Perfect for travel and street photography. Low shutter count (8,200). Original box and warranty card.",
      249900,
      "LIKE_NEW",
      "electronics",
      "Cameras & Drones",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1516035069371-29a1b244cc32"),
      img("photo-1502920917128-1aa500764cbd"),
    ],
  );

  await L(
    active(
      mike.id,
      "GoPro Hero 12 Black Bundle",
      "GoPro Hero 12 with 3 batteries, head mount, chest mount, and 128GB SD card. Great for skiing and mountain biking. Some cosmetic wear.",
      49900,
      "GOOD",
      "electronics",
      "Cameras & Drones",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1526170375885-4d8ecf77b99f"),
      img("photo-1564466809058-bf4114d55352"),
    ],
  );

  // Gaming
  await L(
    active(
      mike.id,
      "PlayStation 5 Slim — Disc Edition + 2 Controllers",
      "PS5 Slim disc edition with two DualSense controllers (white + midnight black). Includes HDMI cable and power cord. Factory reset.",
      74900,
      "GOOD",
      "electronics",
      "TV & Home Theatre",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1606144042614-b2417e99c4e3"),
      img("photo-1622297845775-5ff3fef71d13"),
    ],
  );

  await L(
    active(
      mike.id,
      "Nintendo Switch OLED — White + Mario Kart 8",
      "Switch OLED with Mario Kart 8 Deluxe cartridge. Screen is immaculate. Joycons have no drift. Includes dock and carry case.",
      44900,
      "LIKE_NEW",
      "electronics",
      "TV & Home Theatre",
      "Auckland",
      "Newmarket",
    ),
    [
      img("photo-1578303512597-81e6cc155b3e"),
      img("photo-1612287230202-1ff1d85d1bdf"),
    ],
  );

  // ── FASHION ─────────────────────────────────────────────────────────────

  // Women's Clothing
  await L(
    active(
      aroha.id,
      "Kowtow Organic Cotton Midi Dress — Sage Green, Size M",
      "Beautiful ethical fashion piece from NZ brand Kowtow. 100% organic cotton. Worn twice for events. Like-new condition. True to size.",
      12900,
      "LIKE_NEW",
      "fashion",
      "Women's Clothing",
      "Waikato",
      "Hamilton Central",
      "COURIER",
      600,
    ),
    [
      img("photo-1595777457583-95e059d581b8"),
      img("photo-1572804013309-59a88b7e92f1"),
    ],
    [
      ["Brand", "Kowtow"],
      ["Size", "M"],
      ["Material", "Organic Cotton"],
    ],
  );

  await L(
    active(
      aroha.id,
      "Karen Walker Runaway Sunglasses — Tortoiseshell",
      "Iconic Karen Walker frames. Comes with original case and cleaning cloth. No scratches on lenses. Authentic — purchased from Karen Walker Britomart.",
      24900,
      "LIKE_NEW",
      "fashion",
      "Bags & Accessories",
      "Waikato",
      "Hamilton Central",
    ),
    [
      img("photo-1511499767150-a48a237f0083"),
      img("photo-1473496169904-658ba7c44d8a"),
    ],
  );

  await L(
    active(
      aroha.id,
      'Lululemon Align Leggings 25" — Black, Size 8',
      "Classic Align leggings in black. Super soft Nulu fabric. No pilling, great condition. Size 8 NZ.",
      6900,
      "GOOD",
      "fashion",
      "Women's Clothing",
      "Waikato",
      "Hamilton Central",
    ),
    [
      img("photo-1506629082955-511b1aa562c8"),
      img("photo-1548036328-c9fa89d128fa"),
    ],
  );

  // Men's Clothing
  await L(
    active(
      aroha.id,
      "Swanndri Original Wool Bush Shirt — Forest Green, XL",
      "Classic Kiwi bush shirt. Genuine Swanndri, made in NZ. Heavy wool, perfect for tramping. Worn but heaps of life left.",
      8900,
      "GOOD",
      "fashion",
      "Men's Clothing",
      "Waikato",
      "Hamilton Central",
    ),
    [
      img("photo-1594938298603-c8148c4dae35"),
      img("photo-1489987707025-afc232f7ea0f"),
    ],
  );

  const allbirds = await L(
    active(
      aroha.id,
      "Allbirds Wool Runners — Natural Grey, Men's 10",
      "NZ's favourite sustainable sneakers. Light wear on soles, uppers are clean. Machine washable. Original box included.",
      9900,
      "GOOD",
      "fashion",
      "Shoes",
      "Waikato",
      "Hamilton Central",
    ),
    [
      img("photo-1542291026-7eec264c27ff"),
      img("photo-1460353581641-37baddab0fa2"),
    ],
  );

  await L(
    active(
      aroha.id,
      "Huffer Classic Down Jacket — Black, Men's L",
      "Huffer puffer jacket. Warm and lightweight. Small mark on sleeve (barely noticeable). Great for Wellington winters.",
      12900,
      "FAIR",
      "fashion",
      "Jackets & Coats",
      "Waikato",
      "Hamilton Central",
    ),
    [
      img("photo-1544923246-77307dd270c3"),
      img("photo-1551028719-00167b16eac5"),
    ],
  );

  // Shoes
  await L(
    active(
      aroha.id,
      "Nike Air Max 90 — Triple White, Women's 7",
      "Classic Air Max 90 in all white. Worn a handful of times. Slight creasing on toe box. Comes with original box.",
      11900,
      "GOOD",
      "fashion",
      "Shoes",
      "Waikato",
      "Hamilton Central",
    ),
    [
      img("photo-1600185365926-3a2ce3cdb9eb"),
      img("photo-1606107557195-0e29a4b5b4aa"),
    ],
  );

  await L(
    active(
      aroha.id,
      "Dr. Martens 1460 Boots — Cherry Red, UK 9",
      "Genuine Doc Martens. Broken in and super comfortable. Minor scuffing adds character. Still waterproof.",
      14900,
      "FAIR",
      "fashion",
      "Shoes",
      "Waikato",
      "Hamilton Central",
    ),
    [
      img("photo-1520639888713-7851133b1ed0"),
      img("photo-1605812860427-4024433a70fd"),
    ],
  );

  // Jewellery
  const necklace = await L(
    active(
      aroha.id,
      "Pounamu Greenstone Koru Necklace — Hand-Carved",
      "Authentic NZ greenstone (pounamu) koru pendant on waxed cord. Hand-carved by West Coast artisan. Comes with certificate of authenticity.",
      15900,
      "NEW",
      "fashion",
      "Jewellery",
      "Waikato",
      "Hamilton Central",
      "COURIER",
      500,
    ),
    [
      img("photo-1515562141589-67f0d97e6e51"),
      img("photo-1535632066927-ab7c9ab60908"),
    ],
    [
      ["Material", "NZ Pounamu"],
      ["Artist", "West Coast Artisan"],
      ["Certificate", "Included"],
    ],
  );

  // ── HOME & GARDEN ───────────────────────────────────────────────────────

  // Furniture
  const couch = await L(
    active(
      rachel.id,
      "Freedom Modular Sofa — 3-Seater, Charcoal Linen",
      "Freedom Furniture modular sofa. Removable washable covers. Very comfortable. Moving house — must go. Pickup from Kelburn.",
      149900,
      "GOOD",
      "home-garden",
      "Furniture",
      "Wellington",
      "Kelburn",
      "PICKUP",
      null,
    ),
    [
      img("photo-1555041469-a586c61ea9bc"),
      img("photo-1493663284031-b7e3aefcae8e"),
      img("photo-1540574163026-643ea20ade25"),
    ],
    [
      ["Brand", "Freedom"],
      ["Seats", "3"],
      ["Material", "Linen"],
    ],
  );

  await L(
    active(
      rachel.id,
      "Solid Rimu Dining Table — Seats 6",
      "Beautiful native NZ timber dining table. Solid rimu with natural grain. Made by a local craftsman. Seats 6 comfortably. Minor surface marks from regular use.",
      89900,
      "GOOD",
      "home-garden",
      "Furniture",
      "Wellington",
      "Kelburn",
      "PICKUP",
      null,
    ),
    [
      img("photo-1617806118233-18e1de247200"),
      img("photo-1595428774223-ef52624120d2"),
    ],
  );

  await L(
    active(
      rachel.id,
      "IKEA KALLAX Shelving Unit 4x4 — White",
      "16-cube KALLAX shelving unit. Perfect for vinyl records or books. Disassembled and ready for pickup. All hardware included.",
      12900,
      "GOOD",
      "home-garden",
      "Furniture",
      "Wellington",
      "Kelburn",
      "PICKUP",
      null,
    ),
    [
      img("photo-1594620302200-9a762244a156"),
      img("photo-1598300042247-d088f8ab3a91"),
    ],
  );

  // Appliances
  const kitchenaid = await L(
    active(
      rachel.id,
      "KitchenAid Artisan Stand Mixer — Empire Red",
      "5-quart KitchenAid Artisan. Iconic red colour. Includes paddle, whisk, and dough hook. Barely used — received as gift but prefer my Breville.",
      59900,
      "LIKE_NEW",
      "home-garden",
      "Appliances",
      "Wellington",
      "Kelburn",
    ),
    [
      img("photo-1585515320310-259814833e62"),
      img("photo-1574269909862-7e1d70bb8078"),
    ],
    [
      ["Model", "Artisan"],
      ["Capacity", "5 Quart"],
      ["Colour", "Empire Red"],
    ],
  );

  await L(
    active(
      rachel.id,
      "Breville Barista Express Espresso Machine",
      "Make cafe-quality coffee at home. Built-in grinder. Includes tamper, milk jug, and cleaning kit. Descaled monthly. Small dent on drip tray.",
      44900,
      "GOOD",
      "home-garden",
      "Appliances",
      "Wellington",
      "Kelburn",
    ),
    [
      img("photo-1517668808822-9ebb02f2a0e6"),
      img("photo-1495474472287-4d71bcdd2085"),
    ],
  );

  await L(
    active(
      rachel.id,
      "Dyson V15 Detect Absolute Cordless Vacuum",
      "Dyson V15 with laser detection. Shows dust particles in real time. Battery still holds 60-minute charge. Wall mount included.",
      69900,
      "GOOD",
      "home-garden",
      "Appliances",
      "Wellington",
      "Kelburn",
    ),
    [
      img("photo-1558618666-fcd25c85f82e"),
      img("photo-1527515637462-cee1395c35b6"),
    ],
  );

  // BBQs & Outdoor
  await L(
    active(
      rachel.id,
      "Weber Spirit II E-310 3-Burner BBQ — Black",
      "Weber gas BBQ with 3 burners. Cast iron grill grates. Includes cover and gas bottle. Perfect for Kiwi summers. Ignition works perfectly.",
      59900,
      "GOOD",
      "home-garden",
      "BBQs & Outdoor",
      "Wellington",
      "Kelburn",
    ),
    [
      img("photo-1529690380740-babdb26fda38"),
      img("photo-1555939594-58d7cb561ad1"),
    ],
  );

  // Kitchen
  await L(
    active(
      rachel.id,
      "Le Creuset Dutch Oven 26cm — Marseille Blue",
      "Iconic Le Creuset cast iron pot. The 26cm is perfect for family-sized meals. Beautiful blue colour. Heavy but worth it.",
      29900,
      "GOOD",
      "home-garden",
      "Kitchen",
      "Wellington",
      "Kelburn",
    ),
    [
      img("photo-1585442420538-a6a0e7abb1d7"),
      img("photo-1584990347449-a6a6256d0f56"),
    ],
  );

  // Lighting
  await L(
    active(
      rachel.id,
      "Mid-Century Modern Floor Lamp — Brass & Walnut",
      "Stunning retro floor lamp with brass arm and walnut base. Adjustable height. LED bulb included. Adds instant style to any room.",
      19900,
      "GOOD",
      "home-garden",
      "Lighting",
      "Wellington",
      "Kelburn",
    ),
    [
      img("photo-1507473885765-e6ed057ab6fe"),
      img("photo-1513506003901-1e6a229e2d15"),
    ],
  );

  // ── SPORTS & OUTDOORS ───────────────────────────────────────────────────

  // Cycling
  const ebike = await L(
    active(
      tom.id,
      "Specialized Turbo Vado 4.0 E-Bike — Size L",
      "Premium commuter e-bike with Specialized 1.2 motor. 150km range. Hydraulic disc brakes. Serviced last month at Evolution Cycles Queenstown. Lights and mudguards included.",
      399900,
      "GOOD",
      "sports",
      "Cycling",
      "Otago",
      "Queenstown",
    ),
    [
      img("photo-1571068316344-75bc76f77890"),
      img("photo-1485965120184-e220f721d03e"),
      img("photo-1532298229144-0ec0c57515c7"),
    ],
    [
      ["Frame Size", "L (54cm)"],
      ["Motor", "Specialized 1.2"],
      ["Range", "~150km"],
    ],
  );

  await L(
    active(
      tom.id,
      "Trek Marlin 8 Mountain Bike — Size M",
      "Hardtail MTB perfect for NZ trails. Shimano Deore 1x12. RockShox Judy fork. Tubeless-ready wheels. Great bike for intermediate riders.",
      129900,
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
  );

  await L(
    active(
      tom.id,
      "Giro Aether MIPS Helmet — Matte Black, Size L",
      "Top-end road cycling helmet. MIPS protection. Excellent ventilation. No crashes, replaced due to upgrade.",
      14900,
      "LIKE_NEW",
      "sports",
      "Cycling",
      "Otago",
      "Queenstown",
    ),
    [
      img("photo-1557803175-29e4601a1a0a"),
      img("photo-1558618666-fcd25c85f82e"),
    ],
  );

  // Running & Fitness
  await L(
    active(
      tom.id,
      "Garmin Forerunner 265 — Black",
      "GPS running watch with AMOLED display. Tracks running, cycling, swimming. Heart rate, training readiness, body battery. 2 months old.",
      44900,
      "LIKE_NEW",
      "sports",
      "Running & Fitness",
      "Otago",
      "Queenstown",
    ),
    [
      img("photo-1523275335684-37898b6baf30"),
      img("photo-1508685096489-7aacd43bd3b1"),
    ],
  );

  await L(
    active(
      tom.id,
      "Rogue Echo Bike — Air Bike",
      "Brutal cardio machine. Full-body workout. Very sturdy. Barely used — that's the problem. Moving and can't take it. Pickup only Queenstown.",
      89900,
      "LIKE_NEW",
      "sports",
      "Running & Fitness",
      "Otago",
      "Queenstown",
      "PICKUP",
      null,
    ),
    [
      img("photo-1534438327276-14e5300c3a48"),
      img("photo-1517836357463-d25dfeac3438"),
    ],
  );

  // Water Sports
  const kayak = await L(
    active(
      tom.id,
      "Perception Pescador 12 Sit-On-Top Kayak — Sunset",
      "12-foot fishing/touring kayak. Incredibly stable. Rod holders, dry hatch, and comfortable seat. Perfect for NZ lakes and harbours.",
      89900,
      "GOOD",
      "sports",
      "Water Sports",
      "Otago",
      "Queenstown",
    ),
    [
      img("photo-1544551763-46a013bb70d5"),
      img("photo-1472745942893-4b9f730c7668"),
    ],
  );

  await L(
    active(
      tom.id,
      "O'Neill Psycho Tech 4/3mm Wetsuit — Men's MT",
      "Premium winter wetsuit. 4/3mm thickness perfect for Dunedin surf. Zipperless entry. Some minor fading but fully waterproof.",
      19900,
      "FAIR",
      "sports",
      "Water Sports",
      "Otago",
      "Queenstown",
    ),
    [
      img("photo-1506953823-6a3c8f0a305e"),
      img("photo-1535639818669-c059d2f038e6"),
    ],
  );

  // Camping & Hiking
  const tent = await L(
    active(
      tom.id,
      "MSR Hubba Hubba NX 2-Person Tent",
      "Ultralight backpacking tent. Perfect for NZ's Great Walks. 1.5kg packed weight. Sets up in under 3 minutes. Includes footprint.",
      49900,
      "GOOD",
      "sports",
      "Camping & Hiking",
      "Otago",
      "Queenstown",
    ),
    [
      img("photo-1504280390367-361c6d9f38f4"),
      img("photo-1478131143081-80f7f84ca84d"),
    ],
  );

  await L(
    active(
      tom.id,
      "Osprey Atmos AG 65L Backpack — Men's M",
      "Incredible comfort for multi-day tramping. Anti-Gravity suspension system. Rain cover included. Used on Milford Track — performed flawlessly.",
      24900,
      "GOOD",
      "sports",
      "Camping & Hiking",
      "Otago",
      "Queenstown",
    ),
    [
      img("photo-1622560480605-d83c853bc5c3"),
      img("photo-1553062407-98eeb64c6a62"),
    ],
  );

  await L(
    active(
      tom.id,
      "Jetboil Flash Cooking System",
      "Boils 500ml in 100 seconds. Compact, clips onto fuel canister. Essential for NZ tramping. Includes pot cozy and measuring cup.",
      9900,
      "GOOD",
      "sports",
      "Camping & Hiking",
      "Otago",
      "Queenstown",
    ),
    [
      img("photo-1510672981848-a1c4f1cb5ccc"),
      img("photo-1504851149312-7a075b496cc7"),
    ],
  );

  // Snow Sports
  await L(
    active(
      tom.id,
      "Burton Custom Snowboard 158cm + Union Force Bindings",
      "Burton Custom — the quiver killer. Paired with Union Force bindings (L). Board has some base scratches but edges are sharp. Freshly waxed.",
      44900,
      "GOOD",
      "sports",
      "Snow Sports",
      "Otago",
      "Queenstown",
    ),
    [
      img("photo-1551698618-1dfe5d97d256"),
      img("photo-1605540436563-5bca919ae766"),
    ],
  );

  await L(
    active(
      tom.id,
      "Smith I/O Mag Goggles — ChromaPop Sun Black",
      "Premium ski/snowboard goggles with magnetic lens swap. Includes low-light lens. Anti-fog works brilliantly. No scratches on either lens.",
      19900,
      "LIKE_NEW",
      "sports",
      "Snow Sports",
      "Otago",
      "Queenstown",
    ),
    [
      img("photo-1517483000871-1dbf64a6e1c6"),
      img("photo-1551524164-687a55dd1126"),
    ],
  );

  // Golf
  await L(
    active(
      tom.id,
      "TaylorMade Stealth 2 Driver 10.5° — Stiff Shaft",
      "TaylorMade's carbon-face driver. Low spin, long distance. Stiff flex, right-handed. Head cover included. A few sky marks on the crown.",
      39900,
      "GOOD",
      "sports",
      "Golf",
      "Otago",
      "Queenstown",
    ),
    [
      img("photo-1535131749006-b7f58c99034b"),
      img("photo-1587174486073-ae5e5cff23aa"),
    ],
  );

  // ── PROPERTY ────────────────────────────────────────────────────────────

  await L(
    active(
      rachel.id,
      "Sunny 2BR Apartment — Kelburn, Wellington",
      "Bright north-facing apartment near Victoria University. 2 bedrooms, 1 bathroom, open-plan living. Includes carpark. Available from April 1st. $550/week.",
      55000,
      "GOOD",
      "property",
      "Rentals",
      "Wellington",
      "Kelburn",
      "PICKUP",
      null,
      3,
    ),
    [
      img("photo-1502672260266-1c1ef2d93688"),
      img("photo-1560448204-e02f11c3d0e2"),
      img("photo-1513694203232-719a280e022f"),
    ],
  );

  await L(
    active(
      rachel.id,
      "Flatmate Wanted — Newtown, Wellington",
      "Room available in friendly 3-person flat. Close to hospital and shops. $230/week including internet. Must like cats.",
      23000,
      "GOOD",
      "property",
      "Flatmates",
      "Wellington",
      "Newtown",
      "PICKUP",
      null,
      5,
    ),
    [
      img("photo-1522708323590-d24dbb6b0267"),
      img("photo-1493809842364-78817add7ffb"),
    ],
  );

  await L(
    active(
      rachel.id,
      "Investment Property — 3BR House, Lower Hutt",
      "Solid 1960s weatherboard on 600m² section. Recently re-roofed. Three bedrooms, one bathroom, single garage. Currently tenanted at $600/wk. Motivated vendor.",
      62500000,
      "GOOD",
      "property",
      "For Sale",
      "Wellington",
      "Lower Hutt",
      "PICKUP",
      null,
      10,
    ),
    [
      img("photo-1570129477492-45c003edd2be"),
      img("photo-1512917774080-9991f1c4c750"),
    ],
  );

  // ── BABY & KIDS ─────────────────────────────────────────────────────────

  await L(
    active(
      aroha.id,
      "Bugaboo Fox 5 Complete Pram — Midnight Black",
      "Top-of-the-line pram with bassinet and seat. All-terrain wheels. Includes rain cover, sun canopy, and cup holder. Used for 10 months.",
      89900,
      "GOOD",
      "baby-kids",
      "Baby Gear",
      "Waikato",
      "Hamilton Central",
    ),
    [
      img("photo-1591088398332-8a7791972843"),
      img("photo-1519689680058-66b0120e6a2f"),
    ],
  );

  await L(
    active(
      aroha.id,
      "LEGO Technic Porsche 911 GT3 RS (42056)",
      "Complete set with instructions. All 2,704 pieces present. Built once, carefully disassembled. Original box slightly damaged. Great display piece.",
      39900,
      "GOOD",
      "baby-kids",
      "Toys & Games",
      "Waikato",
      "Hamilton Central",
    ),
    [
      img("photo-1560961911-ba7ef651a56c"),
      img("photo-1587654780291-39c9404d7dd5"),
    ],
  );

  await L(
    active(
      aroha.id,
      "Bundle of Children's Books (Age 3-7) — 25 Books",
      "Curated collection including Dr Seuss, Julia Donaldson, and NZ authors. Some have stickers on covers but all pages are clean. Great for new readers.",
      2900,
      "FAIR",
      "baby-kids",
      "Books",
      "Waikato",
      "Hamilton Central",
    ),
    [
      img("photo-1512820790803-83ca734da794"),
      img("photo-1544716278-ca5e3f4abd8c"),
    ],
  );

  await L(
    active(
      aroha.id,
      "Mocka Cot + Mattress — White",
      "Sturdy wooden cot converts to toddler bed. Includes inner-spring mattress. No bite marks on rails. Meets NZ safety standards.",
      17900,
      "GOOD",
      "baby-kids",
      "Nursery Furniture",
      "Waikato",
      "Hamilton Central",
    ),
    [
      img("photo-1522771739844-6a9f6d5f14af"),
      img("photo-1596461404969-9ae70f2830c1"),
    ],
  );

  await L(
    active(
      aroha.id,
      "Kids' Icebreaker Merino Thermal Set — Size 4",
      "NZ merino base layer set (top + bottoms). Excellent for skiing or cold school days. No holes or pilling. Quick-dry.",
      4900,
      "GOOD",
      "baby-kids",
      "Children's Clothing",
      "Waikato",
      "Hamilton Central",
    ),
    [
      img("photo-1519238263530-99bdd11df2ea"),
      img("photo-1471286174890-9c112ffca5b4"),
    ],
  );

  // ── COLLECTIBLES ────────────────────────────────────────────────────────

  await L(
    active(
      rachel.id,
      "1972 All Blacks Test Match Programme — vs Wales",
      "Original programme from the 1972 NZ vs Wales test. Good condition for its age. Some foxing on edges. A real piece of rugby history.",
      19900,
      "FAIR",
      "collectibles",
      "Sports Memorabilia",
      "Wellington",
      "Kelburn",
    ),
    [
      img("photo-1461896836934-bd45ba688117"),
      img("photo-1518091043644-c1d4457512c6"),
    ],
  );

  await L(
    active(
      rachel.id,
      "NZ Pre-Decimal Coin Set — 1933–1965 Collection",
      "Complete set of pre-decimal NZ coins including silver florins. Presented in display case. Some coins show circulation wear.",
      34900,
      "GOOD",
      "collectibles",
      "Coins & Stamps",
      "Wellington",
      "Kelburn",
    ),
    [
      img("photo-1621955964441-c173e01fca5c"),
      img("photo-1598537735707-1be73a39f120"),
    ],
  );

  const painting = await L(
    active(
      rachel.id,
      "Original Oil Painting — Milford Sound at Dawn",
      "Original oil on canvas by Wellington artist. 60x90cm. Captures the misty morning light at Milford Sound. Framed in native timber. Certificate of authenticity.",
      45000,
      "NEW",
      "collectibles",
      "Art",
      "Wellington",
      "Kelburn",
    ),
    [
      img("photo-1579762715118-a6f1d789cc15"),
      img("photo-1500462918059-b1a0cb512f1d"),
    ],
    [
      ["Medium", "Oil on Canvas"],
      ["Size", "60x90cm"],
      ["Frame", "NZ Native Timber"],
    ],
  );

  await L(
    active(
      rachel.id,
      "Antique Kauri Jewellery Box — c.1920",
      "Beautiful hand-crafted kauri wood jewellery box. Velvet-lined interior with mirror. Brass hinges and clasp. Minor patina adds character.",
      22900,
      "FAIR",
      "collectibles",
      "Antiques",
      "Wellington",
      "Kelburn",
    ),
    [
      img("photo-1570913149827-d2ac84ab3f9a"),
      img("photo-1584589167171-541ce45f1eea"),
    ],
  );

  await L(
    active(
      rachel.id,
      "First Edition — 'The Bone People' by Keri Hulme",
      "First edition, first printing of the 1984 Booker Prize winner. Dust jacket in good condition with minor shelf wear. A NZ literary treasure.",
      29900,
      "GOOD",
      "collectibles",
      "Books & Comics",
      "Wellington",
      "Kelburn",
    ),
    [
      img("photo-1544947950-fa07a98d237f"),
      img("photo-1512820790803-83ca734da794"),
    ],
  );

  // ── TOOLS & EQUIPMENT ───────────────────────────────────────────────────

  await L(
    active(
      tom.id,
      "Makita 18V LXT Drill/Impact Driver Combo Kit",
      "Makita's legendary combo kit. Includes drill driver, impact driver, 2x 5.0Ah batteries, dual charger, and carry bag. Contractor-grade.",
      44900,
      "GOOD",
      "business",
      "Power Tools",
      "Otago",
      "Queenstown",
    ),
    [
      img("photo-1504148455328-c376907d081c"),
      img("photo-1572981779307-38b8cabb2407"),
    ],
  );

  await L(
    active(
      tom.id,
      "Stanley FatMax 65-Piece Socket Set",
      "Complete metric and imperial socket set. Chrome vanadium steel. Lifetime warranty. Case has a crack but all pieces present.",
      8900,
      "GOOD",
      "business",
      "Hand Tools",
      "Otago",
      "Queenstown",
    ),
    [
      img("photo-1581783898377-1c85bf937427"),
      img("photo-1530124566582-a45a7e5fefb8"),
    ],
  );

  await L(
    active(
      rachel.id,
      "Herman Miller Aeron Chair — Size B, Graphite",
      "The gold standard of office chairs. Fully loaded with tilt limiter, lumbar support, and adjustable arms. Some wear on armrests.",
      89900,
      "GOOD",
      "business",
      "Office Furniture",
      "Wellington",
      "Kelburn",
    ),
    [
      img("photo-1580480055273-228ff5388ef8"),
      img("photo-1541558869434-2840d308329a"),
    ],
  );

  await L(
    active(
      tom.id,
      'Husqvarna 435e II Chainsaw — 16" Bar',
      "Reliable homeowner chainsaw. X-Torq engine for low emissions. Recently serviced with new chain. Includes carrying case and spare chain.",
      44900,
      "GOOD",
      "business",
      "Power Tools",
      "Otago",
      "Queenstown",
    ),
    [
      img("photo-1516478177764-9fe5bd7e9717"),
      img("photo-1585771724684-38269d6639fd"),
    ],
  );

  await L(
    active(
      tom.id,
      "3M Peltor X5A Ear Muffs — NRR 31dB",
      "Highest-rated 3M hearing protection. Perfect for chainsaw work, shooting, or loud machinery. Lightly used, clean pads.",
      5900,
      "LIKE_NEW",
      "business",
      "Safety Equipment",
      "Otago",
      "Queenstown",
    ),
    [
      img("photo-1504328345606-18bbc8c9d7d1"),
      img("photo-1581092160607-ee22621dd758"),
    ],
  );

  // ── DRAFT & SOLD listings ──────────────────────────────────────────────

  // Draft listing
  await L(
    {
      sellerId: mike.id,
      title: "iPhone 14 Pro — Space Black (Draft)",
      description: "Still writing this listing...",
      priceNzd: 99900,
      condition: "GOOD",
      status: "DRAFT",
      categoryId: "electronics",
      subcategoryName: "Mobile Phones",
      region: "Auckland",
      suburb: "Newmarket",
      shippingOption: "COURIER",
      shippingNzd: 800,
      createdAt: ago(1 * DAY),
    },
    [img("photo-1678911820864-e2c567c655d7")],
  );

  // Sold listings (used for completed orders)
  const soldMixer = await L(
    {
      sellerId: rachel.id,
      title: "Breville Bakery Boss Stand Mixer — Silver",
      description:
        "12-speed stand mixer with all attachments. Great for baking. Sold!",
      priceNzd: 29900,
      condition: "GOOD",
      status: "SOLD",
      categoryId: "home-garden",
      subcategoryName: "Appliances",
      region: "Wellington",
      suburb: "Kelburn",
      shippingOption: "COURIER",
      shippingNzd: 1500,
      publishedAt: ago(25 * DAY),
      soldAt: ago(20 * DAY),
      createdAt: ago(25 * DAY),
    },
    [img("photo-1594385208974-2f8bb2a76ddc")],
  );

  const soldHeadphones = await L(
    {
      sellerId: mike.id,
      title: "Bose QuietComfort Ultra Headphones",
      description:
        "Premium noise-cancelling headphones. CustomTune technology. Sold to happy buyer.",
      priceNzd: 42900,
      condition: "LIKE_NEW",
      status: "SOLD",
      categoryId: "electronics",
      subcategoryName: "Audio",
      region: "Auckland",
      suburb: "Newmarket",
      shippingOption: "COURIER",
      shippingNzd: 600,
      publishedAt: ago(28 * DAY),
      soldAt: ago(22 * DAY),
      createdAt: ago(28 * DAY),
    },
    [img("photo-1505740420928-5e560c06d30e")],
  );

  const soldJacket = await L(
    {
      sellerId: aroha.id,
      title: "Kathmandu Epiq Down Jacket — Women's 12",
      description:
        "800-fill goose down. Ultra-warm. Sold to a buyer heading to Queenstown.",
      priceNzd: 17900,
      condition: "GOOD",
      status: "SOLD",
      categoryId: "fashion",
      subcategoryName: "Jackets & Coats",
      region: "Waikato",
      suburb: "Hamilton Central",
      shippingOption: "COURIER",
      shippingNzd: 800,
      publishedAt: ago(22 * DAY),
      soldAt: ago(18 * DAY),
      createdAt: ago(22 * DAY),
    },
    [img("photo-1544923246-77307dd270c3")],
  );

  const soldWatch = await L(
    {
      sellerId: mike.id,
      title: "Apple Watch Series 9 — Midnight Aluminium 45mm",
      description: "Apple Watch with Sport Band. Great condition. Sold.",
      priceNzd: 54900,
      condition: "LIKE_NEW",
      status: "SOLD",
      categoryId: "electronics",
      subcategoryName: "Mobile Phones",
      region: "Auckland",
      suburb: "Newmarket",
      shippingOption: "COURIER",
      shippingNzd: 500,
      publishedAt: ago(20 * DAY),
      soldAt: ago(15 * DAY),
      createdAt: ago(20 * DAY),
    },
    [img("photo-1546868871-af0de0ae72be")],
  );

  const soldBike = await L(
    {
      sellerId: tom.id,
      title: "Giant Trance X Advanced 29 2 — Size M",
      description:
        "Full suspension trail bike. Fox 36 fork, Shimano XT groupset. Sold.",
      priceNzd: 379900,
      condition: "GOOD",
      status: "SOLD",
      categoryId: "sports",
      subcategoryName: "Cycling",
      region: "Otago",
      suburb: "Queenstown",
      shippingOption: "COURIER",
      shippingNzd: 6000,
      publishedAt: ago(30 * DAY),
      soldAt: ago(25 * DAY),
      createdAt: ago(30 * DAY),
    },
    [img("photo-1576435728678-68d0fbf94e91")],
  );

  const soldCamera = await L(
    {
      sellerId: mike.id,
      title: "Canon EOS R6 Mark II — Body Only",
      description: "Full-frame mirrorless. 24.2MP. Great autofocus. Sold.",
      priceNzd: 289900,
      condition: "LIKE_NEW",
      status: "SOLD",
      categoryId: "electronics",
      subcategoryName: "Cameras & Drones",
      region: "Auckland",
      suburb: "Newmarket",
      shippingOption: "COURIER",
      shippingNzd: 1000,
      publishedAt: ago(26 * DAY),
      soldAt: ago(21 * DAY),
      createdAt: ago(26 * DAY),
    },
    [img("photo-1516035069371-29a1b244cc32")],
  );

  const soldBackpack = await L(
    {
      sellerId: tom.id,
      title: "Arc'teryx Alpha SV Jacket — Men's L, Dynasty",
      description: "The ultimate hardshell. GORE-TEX Pro. Sold.",
      priceNzd: 89900,
      condition: "GOOD",
      status: "SOLD",
      categoryId: "fashion",
      subcategoryName: "Jackets & Coats",
      region: "Otago",
      suburb: "Queenstown",
      shippingOption: "COURIER",
      shippingNzd: 800,
      publishedAt: ago(24 * DAY),
      soldAt: ago(19 * DAY),
      createdAt: ago(24 * DAY),
    },
    [img("photo-1544923246-77307dd270c3")],
  );

  // Extra sold listings for dispute/refund orders
  const soldTablet = await L(
    {
      sellerId: mike.id,
      title: 'iPad Pro 12.9" M2 256GB — Space Grey',
      description: "iPad Pro with Magic Keyboard. Sold.",
      priceNzd: 149900,
      condition: "LIKE_NEW",
      status: "SOLD",
      categoryId: "electronics",
      subcategoryName: "Tablets",
      region: "Auckland",
      suburb: "Newmarket",
      shippingOption: "COURIER",
      shippingNzd: 800,
      publishedAt: ago(18 * DAY),
      soldAt: ago(14 * DAY),
      createdAt: ago(18 * DAY),
    },
    [img("photo-1544244015-0df4b3ffc6b0")],
  );

  const soldVase = await L(
    {
      sellerId: rachel.id,
      title: "Handmade Ceramic Vase — Large, Celadon Glaze",
      description: "Studio pottery vase. Sold.",
      priceNzd: 8900,
      condition: "NEW",
      status: "SOLD",
      categoryId: "home-garden",
      subcategoryName: "Kitchen",
      region: "Wellington",
      suburb: "Kelburn",
      shippingOption: "COURIER",
      shippingNzd: 1200,
      publishedAt: ago(20 * DAY),
      soldAt: ago(16 * DAY),
      createdAt: ago(20 * DAY),
    },
    [img("photo-1581783898377-1c85bf937427")],
  );

  const soldSpeaker = await L(
    {
      sellerId: tom.id,
      title: "Sonos Move 2 — Portable Speaker, Black",
      description: "Premium portable speaker. Sold.",
      priceNzd: 59900,
      condition: "LIKE_NEW",
      status: "SOLD",
      categoryId: "electronics",
      subcategoryName: "Audio",
      region: "Otago",
      suburb: "Queenstown",
      shippingOption: "COURIER",
      shippingNzd: 1000,
      publishedAt: ago(15 * DAY),
      soldAt: ago(10 * DAY),
      createdAt: ago(15 * DAY),
    },
    [img("photo-1608043152269-423dbba4e7e1")],
  );

  const soldArt = await L(
    {
      sellerId: rachel.id,
      title: "Vintage NZ Travel Poster — Mount Cook, Framed",
      description: "Reproduction vintage poster. Sold.",
      priceNzd: 12900,
      condition: "NEW",
      status: "SOLD",
      categoryId: "collectibles",
      subcategoryName: "Art",
      region: "Wellington",
      suburb: "Kelburn",
      shippingOption: "COURIER",
      shippingNzd: 1500,
      publishedAt: ago(22 * DAY),
      soldAt: ago(17 * DAY),
      createdAt: ago(22 * DAY),
    },
    [img("photo-1579762715118-a6f1d789cc15")],
  );

  const listingCount = await db.listing.count();
  console.log(`✅ ${listingCount} listings created`);

  // ══════════════════════════════════════════════════════════════════════════
  // ORDERS + ORDER EVENTS
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n📦 Creating orders and events...");

  async function E(
    orderId: string,
    type: string,
    actorId: string | null,
    actorRole: string,
    summary: string,
    metadata: Record<string, unknown> | null,
    createdAt: Date,
  ) {
    await db.orderEvent.create({
      data: {
        orderId,
        type,
        actorId,
        actorRole,
        summary,
        metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        createdAt,
      },
    });
  }

  // ── Group 1: COMPLETED orders (6) ──────────────────────────────────────

  // Completed 1: Sarah bought mixer from Rachel (normal completion)
  const comp1 = await db.order.create({
    data: {
      buyerId: sarah.id,
      sellerId: rachel.id,
      listingId: soldMixer,
      itemNzd: 29900,
      shippingNzd: 1500,
      totalNzd: 31400,
      status: "COMPLETED",
      stripePaymentIntentId: "pi_test_comp1",
      trackingNumber: "NZ100200300",
      dispatchedAt: ago(18 * DAY),
      deliveredAt: ago(16 * DAY),
      completedAt: ago(13 * DAY),
      shippingName: "Sarah Mitchell",
      shippingLine1: "42 Ponsonby Road",
      shippingCity: "Auckland",
      shippingRegion: "Auckland",
      shippingPostcode: "1011",
      createdAt: ago(20 * DAY),
    },
  });
  await E(
    comp1.id,
    "ORDER_CREATED",
    sarah.id,
    "BUYER",
    "Order placed for Breville Bakery Boss Stand Mixer",
    null,
    ago(20 * DAY),
  );
  await E(
    comp1.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment of $314.00 held in escrow",
    null,
    new Date(ago(20 * DAY).getTime() + 2 * MIN),
  );
  await E(
    comp1.id,
    "DISPATCHED",
    rachel.id,
    "SELLER",
    "Dispatched via NZ Post — tracking NZ100200300",
    {
      trackingNumber: "NZ100200300",
      courier: "NZ Post",
      estimatedDeliveryDate: ago(16 * DAY).toISOString(),
      dispatchPhotos: [img("photo-1594385208974-2f8bb2a76ddc")],
    },
    ago(18 * DAY),
  );
  await E(
    comp1.id,
    "DELIVERED",
    null,
    "SYSTEM",
    "Tracking shows item delivered",
    null,
    ago(16 * DAY),
  );
  await E(
    comp1.id,
    "DELIVERY_CONFIRMED_OK",
    sarah.id,
    "BUYER",
    "Buyer confirmed item received in good condition",
    { itemCondition: "ok" },
    ago(15 * DAY),
  );
  await E(
    comp1.id,
    "COMPLETED",
    null,
    "SYSTEM",
    "Order completed. Payment released to seller.",
    null,
    ago(13 * DAY),
  );

  // Completed 2: Emma bought headphones from Mike
  const comp2 = await db.order.create({
    data: {
      buyerId: emma.id,
      sellerId: mike.id,
      listingId: soldHeadphones,
      itemNzd: 42900,
      shippingNzd: 600,
      totalNzd: 43500,
      status: "COMPLETED",
      stripePaymentIntentId: "pi_test_comp2",
      trackingNumber: "NZ200300400",
      dispatchedAt: ago(20 * DAY),
      deliveredAt: ago(18 * DAY),
      completedAt: ago(15 * DAY),
      shippingName: "Emma Wilson",
      shippingLine1: "15 Riccarton Road",
      shippingCity: "Christchurch",
      shippingRegion: "Canterbury",
      shippingPostcode: "8041",
      createdAt: ago(22 * DAY),
    },
  });
  await E(
    comp2.id,
    "ORDER_CREATED",
    emma.id,
    "BUYER",
    "Order placed for Bose QuietComfort Ultra Headphones",
    null,
    ago(22 * DAY),
  );
  await E(
    comp2.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment of $435.00 held in escrow",
    null,
    new Date(ago(22 * DAY).getTime() + 2 * MIN),
  );
  await E(
    comp2.id,
    "DISPATCHED",
    mike.id,
    "SELLER",
    "Dispatched via courier — tracking NZ200300400",
    {
      trackingNumber: "NZ200300400",
      courier: "CourierPost",
      estimatedDeliveryDate: ago(18 * DAY).toISOString(),
      dispatchPhotos: [
        img("photo-1505740420928-5e560c06d30e"),
        img("photo-1505740420928-5e560c06d30f"),
      ],
    },
    ago(20 * DAY),
  );
  await E(
    comp2.id,
    "DELIVERED",
    null,
    "SYSTEM",
    "Tracking shows item delivered",
    null,
    ago(18 * DAY),
  );
  await E(
    comp2.id,
    "DELIVERY_CONFIRMED_OK",
    emma.id,
    "BUYER",
    "Buyer confirmed delivery",
    { itemCondition: "ok" },
    ago(17 * DAY),
  );
  await E(
    comp2.id,
    "COMPLETED",
    null,
    "SYSTEM",
    "Order completed. Payment released.",
    null,
    ago(15 * DAY),
  );

  // Completed 3: James bought jacket from Aroha
  const comp3 = await db.order.create({
    data: {
      buyerId: james.id,
      sellerId: aroha.id,
      listingId: soldJacket,
      itemNzd: 17900,
      shippingNzd: 800,
      totalNzd: 18700,
      status: "COMPLETED",
      stripePaymentIntentId: "pi_test_comp3",
      trackingNumber: "NZ300400500",
      dispatchedAt: ago(16 * DAY),
      deliveredAt: ago(14 * DAY),
      completedAt: ago(11 * DAY),
      shippingName: "James Cooper",
      shippingLine1: "8 Cuba Street",
      shippingCity: "Wellington",
      shippingRegion: "Wellington",
      shippingPostcode: "6011",
      createdAt: ago(18 * DAY),
    },
  });
  await E(
    comp3.id,
    "ORDER_CREATED",
    james.id,
    "BUYER",
    "Order placed for Kathmandu Epiq Down Jacket",
    null,
    ago(18 * DAY),
  );
  await E(
    comp3.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment of $187.00 held",
    null,
    new Date(ago(18 * DAY).getTime() + 2 * MIN),
  );
  await E(
    comp3.id,
    "DISPATCHED",
    aroha.id,
    "SELLER",
    "Dispatched via NZ Post",
    {
      trackingNumber: "NZ300400500",
      courier: "NZ Post",
      estimatedDeliveryDate: ago(14 * DAY).toISOString(),
    },
    ago(16 * DAY),
  );
  await E(
    comp3.id,
    "DELIVERED",
    null,
    "SYSTEM",
    "Item delivered",
    null,
    ago(14 * DAY),
  );
  await E(
    comp3.id,
    "DELIVERY_CONFIRMED_OK",
    james.id,
    "BUYER",
    "Buyer confirmed receipt",
    { itemCondition: "ok" },
    ago(13 * DAY),
  );
  await E(
    comp3.id,
    "COMPLETED",
    null,
    "SYSTEM",
    "Order completed.",
    null,
    ago(11 * DAY),
  );

  // Completed 4: Sarah bought watch from Mike
  const comp4 = await db.order.create({
    data: {
      buyerId: sarah.id,
      sellerId: mike.id,
      listingId: soldWatch,
      itemNzd: 54900,
      shippingNzd: 500,
      totalNzd: 55400,
      status: "COMPLETED",
      stripePaymentIntentId: "pi_test_comp4",
      trackingNumber: "NZ400500600",
      dispatchedAt: ago(14 * DAY),
      deliveredAt: ago(12 * DAY),
      completedAt: ago(9 * DAY),
      shippingName: "Sarah Mitchell",
      shippingLine1: "42 Ponsonby Road",
      shippingCity: "Auckland",
      shippingRegion: "Auckland",
      shippingPostcode: "1011",
      createdAt: ago(15 * DAY),
    },
  });
  await E(
    comp4.id,
    "ORDER_CREATED",
    sarah.id,
    "BUYER",
    "Order placed for Apple Watch Series 9",
    null,
    ago(15 * DAY),
  );
  await E(
    comp4.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment of $554.00 held",
    null,
    new Date(ago(15 * DAY).getTime() + 2 * MIN),
  );
  await E(
    comp4.id,
    "DISPATCHED",
    mike.id,
    "SELLER",
    "Dispatched via CourierPost",
    {
      trackingNumber: "NZ400500600",
      courier: "CourierPost",
      estimatedDeliveryDate: ago(12 * DAY).toISOString(),
      dispatchPhotos: [img("photo-1546868871-af0de0ae72be")],
    },
    ago(14 * DAY),
  );
  await E(
    comp4.id,
    "DELIVERED",
    null,
    "SYSTEM",
    "Item delivered",
    null,
    ago(12 * DAY),
  );
  await E(
    comp4.id,
    "DELIVERY_CONFIRMED_OK",
    sarah.id,
    "BUYER",
    "Confirmed in good condition",
    { itemCondition: "ok" },
    ago(11 * DAY),
  );
  await E(
    comp4.id,
    "COMPLETED",
    null,
    "SYSTEM",
    "Order completed.",
    null,
    ago(9 * DAY),
  );

  // Completed 5: Auto-completed (Emma bought bike from Tom, didn't confirm in 14 days)
  const comp5 = await db.order.create({
    data: {
      buyerId: emma.id,
      sellerId: tom.id,
      listingId: soldBike,
      itemNzd: 379900,
      shippingNzd: 6000,
      totalNzd: 385900,
      status: "COMPLETED",
      stripePaymentIntentId: "pi_test_comp5",
      trackingNumber: "NZ500600700",
      dispatchedAt: ago(24 * DAY),
      deliveredAt: ago(22 * DAY),
      completedAt: ago(8 * DAY),
      shippingName: "Emma Wilson",
      shippingLine1: "15 Riccarton Road",
      shippingCity: "Christchurch",
      shippingRegion: "Canterbury",
      shippingPostcode: "8041",
      createdAt: ago(25 * DAY),
    },
  });
  await E(
    comp5.id,
    "ORDER_CREATED",
    emma.id,
    "BUYER",
    "Order placed for Giant Trance X Advanced",
    null,
    ago(25 * DAY),
  );
  await E(
    comp5.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment of $3,859.00 held",
    null,
    new Date(ago(25 * DAY).getTime() + 2 * MIN),
  );
  await E(
    comp5.id,
    "DISPATCHED",
    tom.id,
    "SELLER",
    "Dispatched via courier",
    {
      trackingNumber: "NZ500600700",
      courier: "Mainfreight",
      estimatedDeliveryDate: ago(22 * DAY).toISOString(),
      dispatchPhotos: [img("photo-1576435728678-68d0fbf94e91")],
    },
    ago(24 * DAY),
  );
  await E(
    comp5.id,
    "DELIVERED",
    null,
    "SYSTEM",
    "Item delivered",
    null,
    ago(22 * DAY),
  );
  await E(
    comp5.id,
    "AUTO_COMPLETED",
    null,
    "SYSTEM",
    "Auto-completed: buyer did not report issues within 14 days",
    null,
    ago(8 * DAY),
  );
  await E(
    comp5.id,
    "COMPLETED",
    null,
    "SYSTEM",
    "Order auto-completed.",
    null,
    ago(8 * DAY),
  );

  // Completed 6: Completed after delivery issue resolved (James bought camera from Mike)
  const comp6 = await db.order.create({
    data: {
      buyerId: james.id,
      sellerId: mike.id,
      listingId: soldCamera,
      itemNzd: 289900,
      shippingNzd: 1000,
      totalNzd: 290900,
      status: "COMPLETED",
      stripePaymentIntentId: "pi_test_comp6",
      trackingNumber: "NZ600700800",
      dispatchedAt: ago(19 * DAY),
      deliveredAt: ago(17 * DAY),
      completedAt: ago(12 * DAY),
      shippingName: "James Cooper",
      shippingLine1: "8 Cuba Street",
      shippingCity: "Wellington",
      shippingRegion: "Wellington",
      shippingPostcode: "6011",
      createdAt: ago(21 * DAY),
    },
  });
  await E(
    comp6.id,
    "ORDER_CREATED",
    james.id,
    "BUYER",
    "Order placed for Canon EOS R6 Mark II",
    null,
    ago(21 * DAY),
  );
  await E(
    comp6.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment of $2,909.00 held",
    null,
    new Date(ago(21 * DAY).getTime() + 2 * MIN),
  );
  await E(
    comp6.id,
    "DISPATCHED",
    mike.id,
    "SELLER",
    "Dispatched via CourierPost",
    {
      trackingNumber: "NZ600700800",
      courier: "CourierPost",
      estimatedDeliveryDate: ago(17 * DAY).toISOString(),
      dispatchPhotos: [img("photo-1516035069371-29a1b244cc32")],
    },
    ago(19 * DAY),
  );
  await E(
    comp6.id,
    "DELIVERED",
    null,
    "SYSTEM",
    "Tracking shows item delivered",
    null,
    ago(17 * DAY),
  );
  await E(
    comp6.id,
    "DELIVERY_ISSUE_REPORTED",
    james.id,
    "BUYER",
    "Buyer reported: outer box was dented on arrival but camera seems fine inside",
    { issue: "Box was dented but contents appear intact" },
    ago(16 * DAY),
  );
  await E(
    comp6.id,
    "DELIVERY_CONFIRMED_OK",
    james.id,
    "BUYER",
    "Buyer confirmed item is actually fine after inspection",
    {
      itemCondition: "ok",
      note: "Camera works perfectly, was just the outer shipping box",
    },
    ago(14 * DAY),
  );
  await E(
    comp6.id,
    "COMPLETED",
    null,
    "SYSTEM",
    "Order completed.",
    null,
    ago(12 * DAY),
  );

  // ── Group 2: DISPATCHED orders (3) ─────────────────────────────────────

  // Dispatched 1: Overdue delivery (estimated delivery in the past)
  const disp1 = await db.order.create({
    data: {
      buyerId: sarah.id,
      sellerId: tom.id,
      listingId: soldBackpack,
      itemNzd: 89900,
      shippingNzd: 800,
      totalNzd: 90700,
      status: "DISPATCHED",
      stripePaymentIntentId: "pi_test_disp1",
      trackingNumber: "NZ700800901",
      dispatchedAt: ago(7 * DAY),
      shippingName: "Sarah Mitchell",
      shippingLine1: "42 Ponsonby Road",
      shippingCity: "Auckland",
      shippingRegion: "Auckland",
      shippingPostcode: "1011",
      createdAt: ago(8 * DAY),
    },
  });
  await E(
    disp1.id,
    "ORDER_CREATED",
    sarah.id,
    "BUYER",
    "Order placed",
    null,
    ago(8 * DAY),
  );
  await E(
    disp1.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment held",
    null,
    new Date(ago(8 * DAY).getTime() + 2 * MIN),
  );
  await E(
    disp1.id,
    "DISPATCHED",
    tom.id,
    "SELLER",
    "Dispatched via courier",
    {
      trackingNumber: "NZ700800901",
      courier: "CourierPost",
      estimatedDeliveryDate: ago(4 * DAY).toISOString(),
      dispatchPhotos: [img("photo-1544923246-77307dd270c3")],
    },
    ago(7 * DAY),
  );
  await E(
    disp1.id,
    "DELIVERY_REMINDER_SENT",
    null,
    "SYSTEM",
    "Reminder sent: has your item arrived?",
    null,
    ago(1 * DAY),
  );

  // Dispatched 2: Expected delivery tomorrow
  const disp2 = await db.order.create({
    data: {
      buyerId: james.id,
      sellerId: aroha.id,
      listingId: allbirds,
      itemNzd: 9900,
      shippingNzd: 600,
      totalNzd: 10500,
      status: "DISPATCHED",
      stripePaymentIntentId: "pi_test_disp2",
      trackingNumber: "NZ800900102",
      dispatchedAt: ago(2 * DAY),
      shippingName: "James Cooper",
      shippingLine1: "8 Cuba Street",
      shippingCity: "Wellington",
      shippingRegion: "Wellington",
      shippingPostcode: "6011",
      createdAt: ago(3 * DAY),
    },
  });
  await E(
    disp2.id,
    "ORDER_CREATED",
    james.id,
    "BUYER",
    "Order placed for Allbirds Wool Runners",
    null,
    ago(3 * DAY),
  );
  await E(
    disp2.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment held",
    null,
    new Date(ago(3 * DAY).getTime() + 2 * MIN),
  );
  await E(
    disp2.id,
    "DISPATCHED",
    aroha.id,
    "SELLER",
    "Dispatched",
    {
      trackingNumber: "NZ800900102",
      courier: "NZ Post",
      estimatedDeliveryDate: future(1 * DAY).toISOString(),
    },
    ago(2 * DAY),
  );

  // Dispatched 3: Dispatched today
  const disp3 = await db.order.create({
    data: {
      buyerId: emma.id,
      sellerId: rachel.id,
      listingId: kitchenaid,
      itemNzd: 59900,
      shippingNzd: 1500,
      totalNzd: 61400,
      status: "DISPATCHED",
      stripePaymentIntentId: "pi_test_disp3",
      trackingNumber: "NZ900100203",
      dispatchedAt: ago(2 * HOUR),
      shippingName: "Emma Wilson",
      shippingLine1: "15 Riccarton Road",
      shippingCity: "Christchurch",
      shippingRegion: "Canterbury",
      shippingPostcode: "8041",
      createdAt: ago(2 * DAY),
    },
  });
  await E(
    disp3.id,
    "ORDER_CREATED",
    emma.id,
    "BUYER",
    "Order placed for KitchenAid Artisan Stand Mixer",
    null,
    ago(2 * DAY),
  );
  await E(
    disp3.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment held",
    null,
    new Date(ago(2 * DAY).getTime() + 2 * MIN),
  );
  await E(
    disp3.id,
    "DISPATCHED",
    rachel.id,
    "SELLER",
    "Dispatched today",
    {
      trackingNumber: "NZ900100203",
      courier: "CourierPost",
      estimatedDeliveryDate: future(3 * DAY).toISOString(),
      dispatchPhotos: [img("photo-1585515320310-259814833e62")],
    },
    ago(2 * HOUR),
  );

  // ── Group 3: PAYMENT_HELD orders (2) ───────────────────────────────────

  // Payment held 1: Fresh (created today)
  const ph1 = await db.order.create({
    data: {
      buyerId: sarah.id,
      sellerId: aroha.id,
      listingId: necklace,
      itemNzd: 15900,
      shippingNzd: 500,
      totalNzd: 16400,
      status: "PAYMENT_HELD",
      stripePaymentIntentId: "pi_test_ph1",
      shippingName: "Sarah Mitchell",
      shippingLine1: "42 Ponsonby Road",
      shippingCity: "Auckland",
      shippingRegion: "Auckland",
      shippingPostcode: "1011",
      createdAt: ago(3 * HOUR),
    },
  });
  await E(
    ph1.id,
    "ORDER_CREATED",
    sarah.id,
    "BUYER",
    "Order placed for Pounamu Greenstone Koru Necklace",
    null,
    ago(3 * HOUR),
  );
  await E(
    ph1.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment of $164.00 held in escrow",
    null,
    ago(3 * HOUR - 2 * MIN),
  );

  // Payment held 2: 2 days old (dispatch reminder territory)
  const ph2 = await db.order.create({
    data: {
      buyerId: james.id,
      sellerId: rachel.id,
      listingId: painting,
      itemNzd: 45000,
      shippingNzd: 2000,
      totalNzd: 47000,
      status: "PAYMENT_HELD",
      stripePaymentIntentId: "pi_test_ph2",
      shippingName: "James Cooper",
      shippingLine1: "8 Cuba Street",
      shippingCity: "Wellington",
      shippingRegion: "Wellington",
      shippingPostcode: "6011",
      createdAt: ago(2 * DAY),
    },
  });
  await E(
    ph2.id,
    "ORDER_CREATED",
    james.id,
    "BUYER",
    "Order placed for Original Oil Painting — Milford Sound",
    null,
    ago(2 * DAY),
  );
  await E(
    ph2.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment of $470.00 held",
    null,
    new Date(ago(2 * DAY).getTime() + 2 * MIN),
  );

  // ── Group 4: AWAITING_PAYMENT (1) ──────────────────────────────────────

  const awp1 = await db.order.create({
    data: {
      buyerId: emma.id,
      sellerId: mike.id,
      listingId: samsung,
      itemNzd: 169900,
      shippingNzd: 800,
      totalNzd: 170700,
      status: "AWAITING_PAYMENT",
      shippingName: "Emma Wilson",
      shippingLine1: "15 Riccarton Road",
      shippingCity: "Christchurch",
      shippingRegion: "Canterbury",
      shippingPostcode: "8041",
      createdAt: ago(1 * HOUR),
    },
  });
  await E(
    awp1.id,
    "ORDER_CREATED",
    emma.id,
    "BUYER",
    "Order created — awaiting payment",
    null,
    ago(1 * HOUR),
  );

  // ── Group 5: DISPUTED orders (3) ───────────────────────────────────────

  // Dispute A: "Item damaged" — Sarah vs TechHub NZ (seller has NOT responded, within 72h)
  const dispA = await db.order.create({
    data: {
      buyerId: sarah.id,
      sellerId: mike.id,
      listingId: soldTablet,
      itemNzd: 149900,
      shippingNzd: 800,
      totalNzd: 150700,
      status: "DISPUTED",
      stripePaymentIntentId: "pi_test_dispA",
      trackingNumber: "NZ110220330",
      dispatchedAt: ago(10 * DAY),
      deliveredAt: ago(8 * DAY),
      disputeReason: "ITEM_DAMAGED",
      disputeOpenedAt: ago(1 * DAY),
      disputeNotes:
        "The iPad Pro screen has a visible crack across the bottom-left corner. It was not mentioned in the listing and was clearly present before shipping. I've attached photos of the damage.",
      disputeEvidenceUrls: [
        "disputes/sarah/evidence-crack-1.webp",
        "disputes/sarah/evidence-crack-2.webp",
      ],
      shippingName: "Sarah Mitchell",
      shippingLine1: "42 Ponsonby Road",
      shippingCity: "Auckland",
      shippingRegion: "Auckland",
      shippingPostcode: "1011",
      createdAt: ago(14 * DAY),
    },
  });
  await E(
    dispA.id,
    "ORDER_CREATED",
    sarah.id,
    "BUYER",
    'Order placed for iPad Pro 12.9" M2',
    null,
    ago(14 * DAY),
  );
  await E(
    dispA.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment held",
    null,
    new Date(ago(14 * DAY).getTime() + 2 * MIN),
  );
  await E(
    dispA.id,
    "DISPATCHED",
    mike.id,
    "SELLER",
    "Dispatched",
    {
      trackingNumber: "NZ110220330",
      courier: "CourierPost",
      estimatedDeliveryDate: ago(8 * DAY).toISOString(),
      dispatchPhotos: [
        img("photo-1544244015-0df4b3ffc6b0"),
        img("photo-1544244015-0df4b3ffc6b1"),
      ],
    },
    ago(10 * DAY),
  );
  await E(
    dispA.id,
    "DELIVERED",
    null,
    "SYSTEM",
    "Tracking shows delivered",
    null,
    ago(8 * DAY),
  );
  await E(
    dispA.id,
    "DISPUTE_OPENED",
    sarah.id,
    "BUYER",
    "Dispute opened: Item damaged — screen has visible crack",
    {
      reason: "ITEM_DAMAGED",
      description: "iPad screen cracked in bottom-left corner",
      evidenceCount: 2,
    },
    ago(1 * DAY),
  );

  // Dispute B: "Item not received" — Emma vs Peak Outdoors (past 72h, no seller response)
  const dispB = await db.order.create({
    data: {
      buyerId: emma.id,
      sellerId: tom.id,
      listingId: soldSpeaker,
      itemNzd: 59900,
      shippingNzd: 1000,
      totalNzd: 60900,
      status: "DISPUTED",
      stripePaymentIntentId: "pi_test_dispB",
      trackingNumber: "NZ220330440",
      dispatchedAt: ago(9 * DAY),
      disputeReason: "ITEM_NOT_RECEIVED",
      disputeOpenedAt: ago(4 * DAY),
      disputeNotes:
        "The seller says it was dispatched 9 days ago but I have never received it. Tracking shows no movement since day one. I think the package is lost.",
      shippingName: "Emma Wilson",
      shippingLine1: "15 Riccarton Road",
      shippingCity: "Christchurch",
      shippingRegion: "Canterbury",
      shippingPostcode: "8041",
      createdAt: ago(10 * DAY),
    },
  });
  await E(
    dispB.id,
    "ORDER_CREATED",
    emma.id,
    "BUYER",
    "Order placed for Sonos Move 2",
    null,
    ago(10 * DAY),
  );
  await E(
    dispB.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment held",
    null,
    new Date(ago(10 * DAY).getTime() + 2 * MIN),
  );
  await E(
    dispB.id,
    "DISPATCHED",
    tom.id,
    "SELLER",
    "Dispatched — no dispatch photos provided",
    { trackingNumber: "NZ220330440", courier: "NZ Post" },
    ago(9 * DAY),
  );
  await E(
    dispB.id,
    "DISPUTE_OPENED",
    emma.id,
    "BUYER",
    "Dispute opened: Item not received — tracking shows no movement",
    { reason: "ITEM_NOT_RECEIVED" },
    ago(4 * DAY),
  );
  // Auto-resolution queued (should auto-refund: no tracking movement, seller unresponsive, no dispatch photos)
  await E(
    dispB.id,
    "AUTO_RESOLVED",
    null,
    "SYSTEM",
    "Auto-resolution: REFUND queued (score: +70). Cooling period: 24 hours.",
    {
      decision: "AUTO_REFUND",
      score: 70,
      factors: {
        NO_TRACKING_NUMBER: false,
        TRACKING_NO_MOVEMENT_7D: true,
        NO_DISPATCH_PHOTOS: true,
        SELLER_UNRESPONSIVE_72H: true,
      },
      coolingPeriodEnds: future(20 * HOUR).toISOString(),
      status: "QUEUED",
    },
    ago(1 * DAY),
  );

  // Dispute C: "Not as described" — James vs Kiwi Home & Style (seller HAS responded)
  const dispC = await db.order.create({
    data: {
      buyerId: james.id,
      sellerId: rachel.id,
      listingId: soldVase,
      itemNzd: 8900,
      shippingNzd: 1200,
      totalNzd: 10100,
      status: "DISPUTED",
      stripePaymentIntentId: "pi_test_dispC",
      trackingNumber: "NZ330440550",
      dispatchedAt: ago(14 * DAY),
      deliveredAt: ago(12 * DAY),
      disputeReason: "ITEM_NOT_AS_DESCRIBED",
      disputeOpenedAt: ago(5 * DAY),
      disputeNotes:
        "The vase is much smaller than it appeared in the photos. The listing said 'Large' but it's barely 15cm tall. Very misleading.",
      sellerResponse:
        "I'm sorry the vase wasn't what you expected. The listing does say 'Large' which refers to the glaze style, not the physical size. I understand the confusion though. Happy to accept a return if you'd like to send it back at my expense.",
      sellerRespondedAt: ago(4 * DAY),
      shippingName: "James Cooper",
      shippingLine1: "8 Cuba Street",
      shippingCity: "Wellington",
      shippingRegion: "Wellington",
      shippingPostcode: "6011",
      createdAt: ago(16 * DAY),
    },
  });
  await E(
    dispC.id,
    "ORDER_CREATED",
    james.id,
    "BUYER",
    "Order placed for Handmade Ceramic Vase",
    null,
    ago(16 * DAY),
  );
  await E(
    dispC.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment held",
    null,
    new Date(ago(16 * DAY).getTime() + 2 * MIN),
  );
  await E(
    dispC.id,
    "DISPATCHED",
    rachel.id,
    "SELLER",
    "Dispatched",
    {
      trackingNumber: "NZ330440550",
      courier: "NZ Post",
      dispatchPhotos: [img("photo-1581783898377-1c85bf937427")],
    },
    ago(14 * DAY),
  );
  await E(
    dispC.id,
    "DELIVERED",
    null,
    "SYSTEM",
    "Delivered",
    null,
    ago(12 * DAY),
  );
  await E(
    dispC.id,
    "DISPUTE_OPENED",
    james.id,
    "BUYER",
    "Dispute opened: Item not as described — vase much smaller than expected",
    { reason: "ITEM_NOT_AS_DESCRIBED" },
    ago(5 * DAY),
  );
  await E(
    dispC.id,
    "DISPUTE_RESPONDED",
    rachel.id,
    "SELLER",
    "Seller responded: 'Large' refers to glaze style. Offered return.",
    null,
    ago(4 * DAY),
  );

  // ── Group 6: CANCELLED orders (2) ──────────────────────────────────────

  // Cancel A: Auto-approved within free window
  const canA = await db.order.create({
    data: {
      buyerId: emma.id,
      sellerId: aroha.id,
      listingId: necklace,
      itemNzd: 15900,
      shippingNzd: 500,
      totalNzd: 16400,
      status: "CANCELLED",
      stripePaymentIntentId: "pi_test_canA",
      cancelledBy: emma.id,
      cancelReason: "Changed my mind — found one locally",
      cancelledAt: ago(6 * DAY),
      createdAt: ago(6 * DAY + 2 * HOUR),
    },
  });
  await E(
    canA.id,
    "ORDER_CREATED",
    emma.id,
    "BUYER",
    "Order placed",
    null,
    ago(6 * DAY + 2 * HOUR),
  );
  await E(
    canA.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment held",
    null,
    ago(6 * DAY + 2 * HOUR - 2 * MIN),
  );
  await E(
    canA.id,
    "CANCEL_REQUESTED",
    emma.id,
    "BUYER",
    "Buyer requested cancellation: Changed my mind",
    { reason: "Changed my mind — found one locally" },
    ago(6 * DAY + 1 * HOUR),
  );
  await E(
    canA.id,
    "CANCEL_AUTO_APPROVED",
    null,
    "SYSTEM",
    "Cancellation auto-approved (within free window)",
    null,
    ago(6 * DAY + 1 * HOUR),
  );
  await E(
    canA.id,
    "CANCELLED",
    null,
    "SYSTEM",
    "Order cancelled. Payment refunded.",
    null,
    ago(6 * DAY),
  );

  // Cancel B: Seller-approved
  const canB = await db.order.create({
    data: {
      buyerId: james.id,
      sellerId: mike.id,
      listingId: airpods,
      itemNzd: 39900,
      shippingNzd: 600,
      totalNzd: 40500,
      status: "CANCELLED",
      stripePaymentIntentId: "pi_test_canB",
      cancelledBy: james.id,
      cancelReason: "Bought from another seller",
      cancelledAt: ago(5 * DAY),
      createdAt: ago(7 * DAY),
    },
  });
  await E(
    canB.id,
    "ORDER_CREATED",
    james.id,
    "BUYER",
    "Order placed for AirPods Pro 2nd Gen",
    null,
    ago(7 * DAY),
  );
  await E(
    canB.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment held",
    null,
    new Date(ago(7 * DAY).getTime() + 2 * MIN),
  );
  await E(
    canB.id,
    "CANCEL_REQUESTED",
    james.id,
    "BUYER",
    "Buyer requested cancellation: Bought from another seller",
    { reason: "Bought from another seller" },
    ago(6 * DAY),
  );
  await E(
    canB.id,
    "CANCEL_APPROVED",
    mike.id,
    "SELLER",
    "Seller approved cancellation: No worries, happy to cancel",
    { responseNote: "No worries, happy to cancel" },
    ago(5 * DAY),
  );
  await E(
    canB.id,
    "CANCELLED",
    null,
    "SYSTEM",
    "Order cancelled.",
    null,
    ago(5 * DAY),
  );

  // ── Group 7: REFUNDED orders (2) ───────────────────────────────────────

  // Refund A: Admin resolved dispute in buyer's favour
  const refA = await db.order.create({
    data: {
      buyerId: sarah.id,
      sellerId: rachel.id,
      listingId: soldArt,
      itemNzd: 12900,
      shippingNzd: 1500,
      totalNzd: 14400,
      status: "REFUNDED",
      stripePaymentIntentId: "pi_test_refA",
      trackingNumber: "NZ440550660",
      dispatchedAt: ago(20 * DAY),
      deliveredAt: ago(18 * DAY),
      disputeReason: "ITEM_NOT_AS_DESCRIBED",
      disputeOpenedAt: ago(15 * DAY),
      disputeNotes:
        "The poster is a cheap inkjet print, not a quality reproduction as described. The frame is also plastic, not wood.",
      sellerResponse:
        "The listing clearly says 'reproduction'. I believe the quality is fair for the price.",
      sellerRespondedAt: ago(14 * DAY),
      disputeResolvedAt: ago(12 * DAY),
      shippingName: "Sarah Mitchell",
      shippingLine1: "42 Ponsonby Road",
      shippingCity: "Auckland",
      shippingRegion: "Auckland",
      shippingPostcode: "1011",
      createdAt: ago(22 * DAY),
    },
  });
  await E(
    refA.id,
    "ORDER_CREATED",
    sarah.id,
    "BUYER",
    "Order placed",
    null,
    ago(22 * DAY),
  );
  await E(
    refA.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment held",
    null,
    new Date(ago(22 * DAY).getTime() + 2 * MIN),
  );
  await E(
    refA.id,
    "DISPATCHED",
    rachel.id,
    "SELLER",
    "Dispatched",
    { trackingNumber: "NZ440550660", courier: "NZ Post" },
    ago(20 * DAY),
  );
  await E(
    refA.id,
    "DELIVERED",
    null,
    "SYSTEM",
    "Delivered",
    null,
    ago(18 * DAY),
  );
  await E(
    refA.id,
    "DISPUTE_OPENED",
    sarah.id,
    "BUYER",
    "Dispute: Item not as described",
    null,
    ago(15 * DAY),
  );
  await E(
    refA.id,
    "DISPUTE_RESPONDED",
    rachel.id,
    "SELLER",
    "Seller responded",
    null,
    ago(14 * DAY),
  );
  await E(
    refA.id,
    "DISPUTE_RESOLVED",
    disputeAdmin.id,
    "ADMIN",
    "Dispute resolved in favour of buyer — refund issued",
    {
      favour: "buyer",
      resolution: "refund",
      reason: "Item significantly not as described",
    },
    ago(12 * DAY),
  );
  await E(
    refA.id,
    "REFUNDED",
    null,
    "SYSTEM",
    "Refund of $144.00 processed",
    null,
    ago(12 * DAY),
  );

  // Refund B: Auto-refunded by system (seller unresponsive)
  const refB = await db.order.create({
    data: {
      buyerId: emma.id,
      sellerId: tom.id,
      listingId: kayak,
      itemNzd: 89900,
      shippingNzd: 3000,
      totalNzd: 92900,
      status: "REFUNDED",
      stripePaymentIntentId: "pi_test_refB",
      trackingNumber: "NZ550660770",
      dispatchedAt: ago(18 * DAY),
      disputeReason: "ITEM_NOT_RECEIVED",
      disputeOpenedAt: ago(12 * DAY),
      disputeNotes:
        "Never received the kayak. Tracking hasn't updated since dispatch.",
      disputeResolvedAt: ago(8 * DAY),
      shippingName: "Emma Wilson",
      shippingLine1: "15 Riccarton Road",
      shippingCity: "Christchurch",
      shippingRegion: "Canterbury",
      shippingPostcode: "8041",
      createdAt: ago(20 * DAY),
    },
  });
  await E(
    refB.id,
    "ORDER_CREATED",
    emma.id,
    "BUYER",
    "Order placed",
    null,
    ago(20 * DAY),
  );
  await E(
    refB.id,
    "PAYMENT_HELD",
    null,
    "SYSTEM",
    "Payment held",
    null,
    new Date(ago(20 * DAY).getTime() + 2 * MIN),
  );
  await E(
    refB.id,
    "DISPATCHED",
    tom.id,
    "SELLER",
    "Dispatched",
    { trackingNumber: "NZ550660770", courier: "NZ Post" },
    ago(18 * DAY),
  );
  await E(
    refB.id,
    "DISPUTE_OPENED",
    emma.id,
    "BUYER",
    "Dispute: Item not received",
    null,
    ago(12 * DAY),
  );
  await E(
    refB.id,
    "AUTO_RESOLVED",
    null,
    "SYSTEM",
    "Auto-refunded: seller did not respond within 72 hours",
    { decision: "AUTO_REFUND", score: 75, status: "EXECUTED" },
    ago(9 * DAY),
  );
  await E(
    refB.id,
    "REFUNDED",
    null,
    "SYSTEM",
    "Auto-refund of $929.00 processed",
    null,
    ago(8 * DAY),
  );

  const orderCount = await db.order.count();
  console.log(`✅ ${orderCount} orders created with full event chains`);

  // ══════════════════════════════════════════════════════════════════════════
  // ORDER INTERACTIONS
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n🤝 Creating order interactions...");

  // Active 1: CANCEL_REQUEST — James on ph2 (painting order)
  const int1 = await db.orderInteraction.create({
    data: {
      orderId: ph2.id,
      type: "CANCEL_REQUEST",
      status: "PENDING",
      initiatedById: james.id,
      initiatorRole: "BUYER",
      reason:
        "Found a better price at a local gallery. Would like to cancel if possible.",
      expiresAt: future(48 * HOUR),
      autoAction: "AUTO_APPROVE",
      createdAt: ago(4 * HOUR),
    },
  });
  await E(
    ph2.id,
    "CANCEL_REQUESTED",
    james.id,
    "BUYER",
    "Buyer requested cancellation: Found better price locally",
    { interactionId: int1.id },
    ago(4 * HOUR),
  );

  // Active 2: RETURN_REQUEST — Emma on comp2 (headphones from Mike, completed)
  const int2 = await db.orderInteraction.create({
    data: {
      orderId: comp2.id,
      type: "RETURN_REQUEST",
      status: "PENDING",
      initiatedById: emma.id,
      initiatorRole: "BUYER",
      reason:
        "The colour is different from the listing photos. Listed as silver but they're more of a cream/beige colour.",
      expiresAt: future(72 * HOUR),
      autoAction: "AUTO_ESCALATE",
      createdAt: ago(6 * HOUR),
    },
  });
  await E(
    comp2.id,
    "RETURN_REQUESTED",
    emma.id,
    "BUYER",
    "Buyer requested return: Colour different from listing",
    { interactionId: int2.id },
    ago(6 * HOUR),
  );

  // Active 3: SHIPPING_DELAY — Rachel on disp3 (KitchenAid to Emma)
  const int3 = await db.orderInteraction.create({
    data: {
      orderId: disp3.id,
      type: "SHIPPING_DELAY",
      status: "PENDING",
      initiatedById: rachel.id,
      initiatorRole: "SELLER",
      reason:
        "Supplier delay — the courier pickup was rescheduled. New estimated delivery is 2 days later than originally quoted.",
      details: {
        newEstimatedDate: future(5 * DAY).toISOString(),
        originalEstimatedDate: future(3 * DAY).toISOString(),
      },
      expiresAt: future(7 * DAY),
      autoAction: "AUTO_APPROVE",
      createdAt: ago(1 * HOUR),
    },
  });
  await E(
    disp3.id,
    "SHIPPING_DELAY_NOTIFIED",
    rachel.id,
    "SELLER",
    "Seller notified of shipping delay: courier pickup rescheduled",
    { interactionId: int3.id },
    ago(1 * HOUR),
  );

  // Active 4: PARTIAL_REFUND_REQUEST — Sarah on comp4 (watch from Mike)
  const int4 = await db.orderInteraction.create({
    data: {
      orderId: comp4.id,
      type: "PARTIAL_REFUND_REQUEST",
      status: "PENDING",
      initiatedById: sarah.id,
      initiatorRole: "BUYER",
      reason:
        "There's a small scratch on the watch case that wasn't mentioned in the listing. Not dealbreaker but I'd like a partial refund.",
      details: { requestedAmount: 5000 },
      expiresAt: future(48 * HOUR),
      autoAction: "AUTO_ESCALATE",
      createdAt: ago(12 * HOUR),
    },
  });
  await E(
    comp4.id,
    "PARTIAL_REFUND_REQUESTED",
    sarah.id,
    "BUYER",
    "Buyer requested partial refund of $50.00: scratch not mentioned in listing",
    { interactionId: int4.id, amount: 5000 },
    ago(12 * HOUR),
  );

  // Active 5: DELIVERY_ISSUE on disp1 (overdue delivery — Sarah waiting for backpack)
  const int5 = await db.orderInteraction.create({
    data: {
      orderId: disp1.id,
      type: "CANCEL_REQUEST",
      status: "PENDING",
      initiatedById: sarah.id,
      initiatorRole: "BUYER",
      reason:
        "Package arrived damaged — outer box was crushed. Haven't opened inner packaging yet.",
      expiresAt: future(72 * HOUR),
      autoAction: "AUTO_ESCALATE",
      createdAt: ago(5 * HOUR),
    },
  });
  await E(
    disp1.id,
    "DELIVERY_ISSUE_REPORTED",
    sarah.id,
    "BUYER",
    "Buyer reported: package arrived damaged",
    { interactionId: int5.id },
    ago(5 * HOUR),
  );

  // Active 6: CANCEL_REQUEST about to expire (2 hours left) — on ph1
  const int6 = await db.orderInteraction.create({
    data: {
      orderId: ph1.id,
      type: "CANCEL_REQUEST",
      status: "PENDING",
      initiatedById: sarah.id,
      initiatorRole: "BUYER",
      reason: "Actually I want to keep it, but testing the system.",
      expiresAt: future(2 * HOUR),
      autoAction: "AUTO_APPROVE",
      createdAt: ago(46 * HOUR),
    },
  });
  await E(
    ph1.id,
    "CANCEL_REQUESTED",
    sarah.id,
    "BUYER",
    "Buyer requested cancellation (about to expire)",
    { interactionId: int6.id },
    ago(46 * HOUR),
  );

  // Historical 7: CANCEL_REQUEST — ACCEPTED (matches Cancel B)
  await db.orderInteraction.create({
    data: {
      orderId: canB.id,
      type: "CANCEL_REQUEST",
      status: "ACCEPTED",
      initiatedById: james.id,
      initiatorRole: "BUYER",
      reason: "Bought from another seller",
      responseById: mike.id,
      responseNote: "No worries, happy to cancel",
      respondedAt: ago(5 * DAY),
      resolvedAt: ago(5 * DAY),
      resolution: "CANCELLED",
      expiresAt: ago(3 * DAY),
      autoAction: "AUTO_APPROVE",
      createdAt: ago(6 * DAY),
    },
  });

  // Historical 8: RETURN_REQUEST — REJECTED by seller, 3 days ago
  await db.orderInteraction.create({
    data: {
      orderId: comp1.id,
      type: "RETURN_REQUEST",
      status: "REJECTED",
      initiatedById: sarah.id,
      initiatorRole: "BUYER",
      reason: "Mixer is louder than expected",
      responseById: rachel.id,
      responseNote:
        "Sorry, noise level is normal for this model. The listing accurately described the product.",
      respondedAt: ago(3 * DAY),
      resolvedAt: ago(3 * DAY),
      resolution: "REJECTED",
      expiresAt: ago(1 * DAY),
      autoAction: "AUTO_ESCALATE",
      createdAt: ago(5 * DAY),
    },
  });

  console.log("✅ 8 order interactions created (6 active, 2 historical)");

  // ══════════════════════════════════════════════════════════════════════════
  // TRUST METRICS
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n🛡️  Creating trust metrics...");

  const trustData = [
    {
      userId: sarah.id,
      totalOrders: 8,
      completedOrders: 6,
      disputeCount: 1,
      disputeRate: 12.5,
      disputesLast30Days: 0,
      averageResponseHours: 2,
      averageRating: 4.6,
      dispatchPhotoRate: 0,
      accountAgeDays: 60,
      isFlaggedForFraud: false,
    },
    {
      userId: james.id,
      totalOrders: 4,
      completedOrders: 2,
      disputeCount: 0,
      disputeRate: 0,
      disputesLast30Days: 0,
      averageResponseHours: null,
      averageRating: null,
      dispatchPhotoRate: 0,
      accountAgeDays: 30,
      isFlaggedForFraud: false,
    },
    {
      userId: emma.id,
      totalOrders: 6,
      completedOrders: 4,
      disputeCount: 1,
      disputeRate: 16.7,
      disputesLast30Days: 1,
      averageResponseHours: null,
      averageRating: null,
      dispatchPhotoRate: 0,
      accountAgeDays: 45,
      isFlaggedForFraud: false,
    },
    {
      userId: mike.id,
      totalOrders: 15,
      completedOrders: 12,
      disputeCount: 1,
      disputeRate: 6.7,
      disputesLast30Days: 0,
      averageResponseHours: 4,
      averageRating: 4.5,
      dispatchPhotoRate: 80,
      accountAgeDays: 90,
      isFlaggedForFraud: false,
    },
    {
      userId: rachel.id,
      totalOrders: 10,
      completedOrders: 8,
      disputeCount: 0,
      disputeRate: 0,
      disputesLast30Days: 0,
      averageResponseHours: 8,
      averageRating: 4.2,
      dispatchPhotoRate: 60,
      accountAgeDays: 75,
      isFlaggedForFraud: false,
    },
    {
      userId: tom.id,
      totalOrders: 8,
      completedOrders: 5,
      disputeCount: 2,
      disputeRate: 25,
      disputesLast30Days: 1,
      averageResponseHours: 12,
      averageRating: 3.8,
      dispatchPhotoRate: 40,
      accountAgeDays: 60,
      isFlaggedForFraud: false,
    },
    {
      userId: aroha.id,
      totalOrders: 5,
      completedOrders: 4,
      disputeCount: 0,
      disputeRate: 0,
      disputesLast30Days: 0,
      averageResponseHours: 2,
      averageRating: 4.7,
      dispatchPhotoRate: 100,
      accountAgeDays: 45,
      isFlaggedForFraud: false,
    },
  ];

  for (const tm of trustData) {
    await db.trustMetrics.create({
      data: { ...tm, lastComputedAt: new Date() },
    });
  }

  console.log("✅ 7 trust metrics records created");

  // ══════════════════════════════════════════════════════════════════════════
  // REVIEWS
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n⭐ Creating reviews...");

  // Review 1: Sarah → Rachel (comp1, mixer)
  const rev1 = await db.review.create({
    data: {
      orderId: comp1.id,
      sellerId: rachel.id,
      authorId: sarah.id,
      rating: 45,
      comment:
        "The mixer arrived beautifully packaged and works perfectly. Rachel was super responsive and even included a handwritten thank-you card. Love supporting local sellers!",
      sellerReply:
        "Thank you Sarah! So glad you're enjoying the mixer. Happy baking! 🎂",
      sellerRepliedAt: ago(12 * DAY),
      createdAt: ago(13 * DAY),
    },
  });
  await db.reviewTag.createMany({
    data: [
      { reviewId: rev1.id, tag: "GREAT_PACKAGING" },
      { reviewId: rev1.id, tag: "QUICK_COMMUNICATION" },
      { reviewId: rev1.id, tag: "AS_DESCRIBED" },
    ],
  });

  // Review 2: Emma → Mike (comp2, headphones)
  const rev2 = await db.review.create({
    data: {
      orderId: comp2.id,
      sellerId: mike.id,
      authorId: emma.id,
      rating: 50,
      comment:
        "Five stars! These headphones are incredible. Mike shipped them the same day and they arrived in perfect condition. Noise cancellation is amazing for my office.",
      createdAt: ago(14 * DAY),
    },
  });
  await db.reviewTag.createMany({
    data: [
      { reviewId: rev2.id, tag: "FAST_SHIPPING" },
      { reviewId: rev2.id, tag: "ACCURATE_DESCRIPTION" },
      { reviewId: rev2.id, tag: "AS_DESCRIBED" },
    ],
  });

  // Review 3: James → Aroha (comp3, jacket)
  const rev3 = await db.review.create({
    data: {
      orderId: comp3.id,
      sellerId: aroha.id,
      authorId: james.id,
      rating: 40,
      comment:
        "Good jacket, keeps me warm in Wellington wind. Slightly smaller than expected but wearable. Shipping was fast.",
      sellerReply:
        "Thanks James! Sorry about the sizing — Kathmandu does run a bit small. Glad it still works for you.",
      sellerRepliedAt: ago(10 * DAY),
      createdAt: ago(11 * DAY),
    },
  });
  await db.reviewTag.createMany({
    data: [{ reviewId: rev3.id, tag: "FAST_SHIPPING" }],
  });

  // Review 4: Sarah → Mike (comp4, watch)
  const rev4 = await db.review.create({
    data: {
      orderId: comp4.id,
      sellerId: mike.id,
      authorId: sarah.id,
      rating: 45,
      comment:
        "Apple Watch arrived quickly and in great condition. Battery health is excellent. Mike even factory reset it before sending which saved me time.",
      createdAt: ago(8 * DAY),
    },
  });
  await db.reviewTag.createMany({
    data: [
      { reviewId: rev4.id, tag: "FAST_SHIPPING" },
      { reviewId: rev4.id, tag: "ACCURATE_DESCRIPTION" },
      { reviewId: rev4.id, tag: "QUICK_COMMUNICATION" },
    ],
  });

  // Review 5: Emma → Tom (comp5, bike — auto-completed)
  const rev5 = await db.review.create({
    data: {
      orderId: comp5.id,
      sellerId: tom.id,
      authorId: emma.id,
      rating: 35,
      comment:
        "Bike is decent but had some issues with the rear derailleur that weren't mentioned. Had to take it for a $150 tune-up. Otherwise rides well on Christchurch trails.",
      createdAt: ago(7 * DAY),
    },
  });
  await db.reviewTag.createMany({
    data: [{ reviewId: rev5.id, tag: "FAIR_PRICING" }],
  });

  // Review 6: James → Mike (comp6, camera)
  const rev6 = await db.review.create({
    data: {
      orderId: comp6.id,
      sellerId: mike.id,
      authorId: james.id,
      rating: 45,
      comment:
        "Camera is fantastic. Low shutter count as described. The outer shipping box was dented but the camera inside was perfectly protected. Mike packed it really well.",
      sellerReply:
        "Glad the camera arrived safely despite the courier handling! Enjoy shooting with the R6 II.",
      sellerRepliedAt: ago(11 * DAY),
      createdAt: ago(12 * DAY),
    },
  });
  await db.reviewTag.createMany({
    data: [
      { reviewId: rev6.id, tag: "GREAT_PACKAGING" },
      { reviewId: rev6.id, tag: "ACCURATE_DESCRIPTION" },
      { reviewId: rev6.id, tag: "AS_DESCRIBED" },
    ],
  });

  // Reviews for order event: REVIEW_SUBMITTED
  await E(
    comp1.id,
    "REVIEW_SUBMITTED",
    sarah.id,
    "BUYER",
    "Buyer left a 4.5-star review",
    { rating: 45 },
    ago(13 * DAY),
  );
  await E(
    comp2.id,
    "REVIEW_SUBMITTED",
    emma.id,
    "BUYER",
    "Buyer left a 5-star review",
    { rating: 50 },
    ago(14 * DAY),
  );
  await E(
    comp3.id,
    "REVIEW_SUBMITTED",
    james.id,
    "BUYER",
    "Buyer left a 4-star review",
    { rating: 40 },
    ago(11 * DAY),
  );
  await E(
    comp4.id,
    "REVIEW_SUBMITTED",
    sarah.id,
    "BUYER",
    "Buyer left a 4.5-star review",
    { rating: 45 },
    ago(8 * DAY),
  );
  await E(
    comp5.id,
    "REVIEW_SUBMITTED",
    emma.id,
    "BUYER",
    "Buyer left a 3.5-star review",
    { rating: 35 },
    ago(7 * DAY),
  );
  await E(
    comp6.id,
    "REVIEW_SUBMITTED",
    james.id,
    "BUYER",
    "Buyer left a 4.5-star review",
    { rating: 45 },
    ago(12 * DAY),
  );

  console.log("✅ 6 reviews created with tags and events");

  // ══════════════════════════════════════════════════════════════════════════
  // OFFERS
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n💰 Creating offers...");

  // Pending offers
  await db.offer.create({
    data: {
      listingId: macbook,
      buyerId: sarah.id,
      sellerId: mike.id,
      amountNzd: 250000,
      note: "Would you consider $2,500? I can pick up from Newmarket today.",
      status: "PENDING",
      expiresAt: future(2 * DAY),
      createdAt: ago(1 * DAY),
    },
  });

  await db.offer.create({
    data: {
      listingId: ebike,
      buyerId: james.id,
      sellerId: tom.id,
      amountNzd: 350000,
      note: "Keen on the e-bike. Would $3,500 work? Cash on pickup.",
      status: "PENDING",
      expiresAt: future(2 * DAY),
      createdAt: ago(12 * HOUR),
    },
  });

  // Accepted offers
  await db.offer.create({
    data: {
      listingId: tent,
      buyerId: emma.id,
      sellerId: tom.id,
      amountNzd: 42000,
      note: "Would you take $420? I'm heading to Milford Track next week.",
      status: "ACCEPTED",
      respondedAt: ago(3 * DAY),
      expiresAt: ago(1 * DAY),
      paymentDeadline: future(1 * DAY),
      createdAt: ago(4 * DAY),
    },
  });

  await db.offer.create({
    data: {
      listingId: couch,
      buyerId: sarah.id,
      sellerId: rachel.id,
      amountNzd: 120000,
      note: "Happy to pick up this weekend. Would $1,200 work?",
      status: "ACCEPTED",
      respondedAt: ago(2 * DAY),
      expiresAt: ago(0),
      paymentDeadline: future(2 * DAY),
      createdAt: ago(3 * DAY),
    },
  });

  // Declined offers
  await db.offer.create({
    data: {
      listingId: iphone,
      buyerId: james.id,
      sellerId: mike.id,
      amountNzd: 150000,
      note: "Would you take $1,500?",
      status: "DECLINED",
      respondedAt: ago(5 * DAY),
      expiresAt: ago(3 * DAY),
      declineNote:
        "Sorry, lowest I can go is $1,800. It's basically brand new with AppleCare+.",
      createdAt: ago(6 * DAY),
    },
  });

  await db.offer.create({
    data: {
      listingId: kitchenaid,
      buyerId: emma.id,
      sellerId: rachel.id,
      amountNzd: 45000,
      note: "Is $450 fair? I see similar ones online for less.",
      status: "DECLINED",
      respondedAt: ago(4 * DAY),
      expiresAt: ago(2 * DAY),
      declineNote:
        "This is the Artisan model which retails for $999. $599 is already a great price.",
      createdAt: ago(5 * DAY),
    },
  });

  // Expired offer
  await db.offer.create({
    data: {
      listingId: kayak,
      buyerId: sarah.id,
      sellerId: tom.id,
      amountNzd: 70000,
      note: "Interested in the kayak. Would $700 work?",
      status: "EXPIRED",
      expiresAt: ago(1 * DAY),
      createdAt: ago(4 * DAY),
    },
  });

  // Countered offer
  await db.offer.create({
    data: {
      listingId: painting,
      buyerId: emma.id,
      sellerId: rachel.id,
      amountNzd: 35000,
      note: "Beautiful painting! Would you consider $350?",
      status: "DECLINED",
      respondedAt: ago(3 * DAY),
      expiresAt: ago(1 * DAY),
      declineNote:
        "I could do $400 — it's an original with certificate of authenticity.",
      createdAt: ago(4 * DAY),
    },
  });

  console.log("✅ 8 offers created");

  // ══════════════════════════════════════════════════════════════════════════
  // MESSAGES
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n💬 Creating messages...");

  async function thread(
    p1Id: string,
    p2Id: string,
    listingId: string | null,
    msgs: { senderId: string; body: string; hoursAgo: number; read: boolean }[],
  ) {
    const t = await db.messageThread.create({
      data: {
        participant1Id: p1Id,
        participant2Id: p2Id,
        listingId,
        lastMessageAt: ago(msgs[msgs.length - 1]!.hoursAgo * HOUR),
        createdAt: ago(msgs[0]!.hoursAgo * HOUR),
      },
    });
    for (const m of msgs) {
      await db.message.create({
        data: {
          threadId: t.id,
          senderId: m.senderId,
          body: m.body,
          read: m.read,
          readAt: m.read ? ago((m.hoursAgo - 0.5) * HOUR) : undefined,
          createdAt: ago(m.hoursAgo * HOUR),
        },
      });
    }
  }

  // Thread 1: Pre-purchase question about MacBook
  await thread(sarah.id, mike.id, macbook, [
    {
      senderId: sarah.id,
      body: "Hi! Is the MacBook still available? What's the battery health percentage?",
      hoursAgo: 48,
      read: true,
    },
    {
      senderId: mike.id,
      body: "Hey Sarah! Yes still available. Battery health is at 94% — only 96 cycles. Basically like new.",
      hoursAgo: 46,
      read: true,
    },
    {
      senderId: sarah.id,
      body: "That's great! Does it come with the original charger? And is the price negotiable at all?",
      hoursAgo: 44,
      read: true,
    },
    {
      senderId: mike.id,
      body: "Yep, original MagSafe charger and box included. I could do $2,800 for a quick sale. It's the M3 Pro which is the sweet spot for performance.",
      hoursAgo: 42,
      read: true,
    },
    {
      senderId: sarah.id,
      body: "Tempting! Let me think about it and I'll get back to you by tomorrow.",
      hoursAgo: 40,
      read: true,
    },
  ]);

  // Thread 2: Shipping timeline on dispatched order
  await thread(james.id, aroha.id, allbirds, [
    {
      senderId: james.id,
      body: "Hi! I ordered the Allbirds — any idea when they'll arrive in Wellington?",
      hoursAgo: 36,
      read: true,
    },
    {
      senderId: aroha.id,
      body: "Hi James! I shipped them yesterday from Hamilton. NZ Post usually takes 2-3 business days to Wellington. Tracking: NZ800900102",
      hoursAgo: 34,
      read: true,
    },
    {
      senderId: james.id,
      body: "Perfect, thanks for the quick dispatch!",
      hoursAgo: 32,
      read: true,
    },
    {
      senderId: aroha.id,
      body: "No worries! Let me know when they arrive 😊",
      hoursAgo: 30,
      read: false,
    },
  ]);

  // Thread 3: Buyer messaging about cancellation
  await thread(james.id, mike.id, airpods, [
    {
      senderId: james.id,
      body: "Hey Mike, I'm really sorry but I need to cancel my AirPods order. I found them cheaper locally.",
      hoursAgo: 150,
      read: true,
    },
    {
      senderId: mike.id,
      body: "No worries James! I'll approve the cancellation now. Hope you got a good deal!",
      hoursAgo: 148,
      read: true,
    },
    {
      senderId: james.id,
      body: "Thanks for being so understanding. I'll definitely buy from you in future.",
      hoursAgo: 146,
      read: true,
    },
    {
      senderId: mike.id,
      body: "Cheers mate. Happy to help anytime!",
      hoursAgo: 144,
      read: true,
    },
  ]);

  // Thread 4: Buyer asking about return
  await thread(emma.id, mike.id, soldHeadphones, [
    {
      senderId: emma.id,
      body: "Hi Mike, I love the headphones but the colour is slightly different from the photos — more cream than silver. Is a return possible?",
      hoursAgo: 8,
      read: true,
    },
    {
      senderId: mike.id,
      body: "Hi Emma, sorry about that! The listing photos were taken under studio lighting which may have looked more silver. I can look into a return for you.",
      hoursAgo: 6,
      read: true,
    },
    {
      senderId: emma.id,
      body: "That would be great. I've submitted a return request through the system. They still work perfectly, just not the colour I expected.",
      hoursAgo: 5,
      read: true,
    },
    {
      senderId: mike.id,
      body: "No problem, I'll review the return request. If you send them back I'll process a full refund once they arrive.",
      hoursAgo: 4,
      read: false,
    },
  ]);

  // Thread 5: Sizing question for fashion item
  await thread(sarah.id, aroha.id, null, [
    {
      senderId: sarah.id,
      body: "Hi! I'm interested in the Kowtow dress. I usually wear a size 10 NZ — do you think the M would fit?",
      hoursAgo: 72,
      read: true,
    },
    {
      senderId: aroha.id,
      body: "Hi Sarah! Kowtow runs true to NZ sizing. If you're usually a 10, the M should be perfect. It's a relaxed fit so there's some room.",
      hoursAgo: 70,
      read: true,
    },
    {
      senderId: sarah.id,
      body: "Great, thanks! What about the fabric — does it wrinkle easily?",
      hoursAgo: 68,
      read: true,
    },
    {
      senderId: aroha.id,
      body: "It's 100% organic cotton so it does crease a bit, but that's part of the charm! A quick steam and it looks perfect.",
      hoursAgo: 66,
      read: true,
    },
    {
      senderId: sarah.id,
      body: "Lovely, I'll have a think. The sage green colour is gorgeous.",
      hoursAgo: 64,
      read: true,
    },
  ]);

  // Thread 6: Seller proactively messaging about shipping delay
  await thread(rachel.id, emma.id, kitchenaid, [
    {
      senderId: rachel.id,
      body: "Hi Emma! Just a heads up — I shipped your KitchenAid this morning but the courier pickup was delayed by a day. New ETA is Thursday instead of Wednesday.",
      hoursAgo: 3,
      read: true,
    },
    {
      senderId: emma.id,
      body: "Thanks for letting me know Rachel! No rush at all — I appreciate the heads up.",
      hoursAgo: 2,
      read: true,
    },
    {
      senderId: rachel.id,
      body: "No worries! I've double-boxed it with extra bubble wrap. That mixer weighs a lot so I wanted to make sure it arrives safely!",
      hoursAgo: 1,
      read: false,
    },
  ]);

  // Thread 7: Post-purchase thank you
  await thread(sarah.id, rachel.id, soldMixer, [
    {
      senderId: sarah.id,
      body: "Rachel — the mixer arrived today and it's perfect! Thank you for the lovely packaging and the handwritten card. Really made my day!",
      hoursAgo: 300,
      read: true,
    },
    {
      senderId: rachel.id,
      body: "Oh I'm so glad! It was a joy to sell to you. If you ever need baking tips, I run a blog at kiwihomestyle.nz 😄",
      hoursAgo: 298,
      read: true,
    },
    {
      senderId: sarah.id,
      body: "I'll definitely check it out! Already left you a 5-star review 🌟",
      hoursAgo: 296,
      read: true,
    },
    {
      senderId: rachel.id,
      body: "You're too kind! Enjoy the mixer! 💛",
      hoursAgo: 294,
      read: true,
    },
  ]);

  // Thread 8: Collectible authenticity question
  await thread(james.id, rachel.id, painting, [
    {
      senderId: james.id,
      body: "Hi, I'm interested in the Milford Sound painting. Can you tell me more about the artist? Is the certificate of authenticity from a gallery?",
      hoursAgo: 96,
      read: true,
    },
    {
      senderId: rachel.id,
      body: "Hi James! The artist is a Wellington-based painter who exhibits at local galleries. The certificate is from her studio — it includes her signature, the title, and date of creation.",
      hoursAgo: 94,
      read: true,
    },
    {
      senderId: james.id,
      body: "That's reassuring, thank you. The colours in the listing photos look amazing. Is it true to life?",
      hoursAgo: 92,
      read: true,
    },
    {
      senderId: rachel.id,
      body: "I tried to photograph it in natural light to be as accurate as possible. The blues and greens are very vibrant in person. It's a stunning piece!",
      hoursAgo: 90,
      read: true,
    },
    {
      senderId: james.id,
      body: "I think I'll make an offer. Thanks for all the details!",
      hoursAgo: 88,
      read: true,
    },
  ]);

  const msgCount = await db.message.count();
  console.log(`✅ 8 message threads, ${msgCount} messages created`);

  // ══════════════════════════════════════════════════════════════════════════
  // NOTIFICATIONS
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n🔔 Creating notifications...");

  const notifications = [
    // Buyer notifications
    {
      userId: sarah.id,
      type: "ORDER_CREATED",
      title: "Order confirmed!",
      body: "Your order for Breville Bakery Boss Stand Mixer has been confirmed.",
      orderId: comp1.id,
      link: `/orders/${comp1.id}`,
      read: true,
      createdAt: ago(20 * DAY),
    },
    {
      userId: sarah.id,
      type: "ORDER_DISPATCHED",
      title: "Your item has been shipped!",
      body: "Great news! Kiwi Home & Style has dispatched your Breville Bakery Boss Stand Mixer.",
      orderId: comp1.id,
      link: `/orders/${comp1.id}`,
      read: true,
      createdAt: ago(18 * DAY),
    },
    {
      userId: sarah.id,
      type: "ORDER_COMPLETED",
      title: "Order complete!",
      body: "Your order for Breville Bakery Boss Stand Mixer is complete. Payment has been released to the seller.",
      orderId: comp1.id,
      link: `/orders/${comp1.id}`,
      read: true,
      createdAt: ago(13 * DAY),
    },
    {
      userId: emma.id,
      type: "ORDER_DISPATCHED",
      title: "Your item is on its way!",
      body: "TechHub NZ has dispatched your Bose QuietComfort Ultra Headphones.",
      orderId: comp2.id,
      link: `/orders/${comp2.id}`,
      read: true,
      createdAt: ago(20 * DAY),
    },
    {
      userId: sarah.id,
      type: "ORDER_DISPATCHED",
      title: "Dispatched!",
      body: "Peak Outdoors has dispatched your Arc'teryx jacket. Should arrive in a few days.",
      orderId: disp1.id,
      link: `/orders/${disp1.id}`,
      read: true,
      createdAt: ago(7 * DAY),
    },
    {
      userId: sarah.id,
      type: "DELIVERY_OVERDUE",
      title: "Has your item arrived?",
      body: "Your Arc'teryx jacket was expected to arrive 4 days ago. If you haven't received it, let us know.",
      orderId: disp1.id,
      link: `/orders/${disp1.id}`,
      read: false,
      createdAt: ago(1 * DAY),
    },
    {
      userId: sarah.id,
      type: "ORDER_DISPUTED",
      title: "Dispute filed",
      body: 'Your dispute for iPad Pro 12.9" M2 has been filed. TechHub NZ has 72 hours to respond.',
      orderId: dispA.id,
      link: `/orders/${dispA.id}`,
      read: true,
      createdAt: ago(1 * DAY),
    },
    {
      userId: emma.id,
      type: "ORDER_DISPUTED",
      title: "Dispute filed",
      body: "Your dispute for Sonos Move 2 has been filed. Peak Outdoors has 72 hours to respond.",
      orderId: dispB.id,
      link: `/orders/${dispB.id}`,
      read: true,
      createdAt: ago(4 * DAY),
    },
    {
      userId: sarah.id,
      type: "SYSTEM",
      title: "Refund processed",
      body: "Your refund of $144.00 for Vintage NZ Travel Poster has been processed.",
      orderId: refA.id,
      link: `/orders/${refA.id}`,
      read: true,
      createdAt: ago(12 * DAY),
    },
    {
      userId: emma.id,
      type: "SYSTEM",
      title: "Refund processed",
      body: "Your auto-refund of $929.00 for Perception Pescador 12 Kayak has been processed.",
      orderId: refB.id,
      link: `/orders/${refB.id}`,
      read: true,
      createdAt: ago(8 * DAY),
    },
    {
      userId: james.id,
      type: "OFFER_DECLINED",
      title: "Offer declined",
      body: "TechHub NZ declined your offer of $1,500.00 on iPhone 15 Pro Max.",
      listingId: iphone,
      link: `/listings/${iphone}`,
      read: true,
      createdAt: ago(5 * DAY),
    },
    {
      userId: emma.id,
      type: "ORDER_DISPATCHED",
      title: "Your KitchenAid is on its way!",
      body: "Kiwi Home & Style just dispatched your KitchenAid Artisan Stand Mixer.",
      orderId: disp3.id,
      link: `/orders/${disp3.id}`,
      read: false,
      createdAt: ago(2 * HOUR),
    },
    {
      userId: sarah.id,
      type: "SYSTEM",
      title: "Cancellation request submitted",
      body: "Your cancellation request for Pounamu Greenstone Koru Necklace has been submitted.",
      orderId: ph1.id,
      link: `/orders/${ph1.id}`,
      read: false,
      createdAt: ago(46 * HOUR),
    },
    // Seller notifications
    {
      userId: rachel.id,
      type: "ORDER_CREATED",
      title: "New order!",
      body: "Sarah Mitchell ordered your Breville Bakery Boss Stand Mixer — dispatch within 3 days.",
      orderId: comp1.id,
      link: `/orders/${comp1.id}`,
      read: true,
      createdAt: ago(20 * DAY),
    },
    {
      userId: mike.id,
      type: "ORDER_CREATED",
      title: "New order!",
      body: "Emma Wilson ordered your Bose QuietComfort Ultra Headphones — dispatch within 3 days.",
      orderId: comp2.id,
      link: `/orders/${comp2.id}`,
      read: true,
      createdAt: ago(22 * DAY),
    },
    {
      userId: aroha.id,
      type: "ORDER_CREATED",
      title: "New order from Sarah!",
      body: "Sarah Mitchell ordered your Pounamu Greenstone Koru Necklace — dispatch within 3 days.",
      orderId: ph1.id,
      link: `/orders/${ph1.id}`,
      read: false,
      createdAt: ago(3 * HOUR),
    },
    {
      userId: rachel.id,
      type: "ORDER_CREATED",
      title: "New order!",
      body: "James Cooper ordered your Original Oil Painting — Milford Sound. Dispatch within 3 days.",
      orderId: ph2.id,
      link: `/orders/${ph2.id}`,
      read: true,
      createdAt: ago(2 * DAY),
    },
    {
      userId: rachel.id,
      type: "DISPATCH_REMINDER",
      title: "Ready to dispatch?",
      body: "James is waiting for his Original Oil Painting! Please dispatch within 1 day.",
      orderId: ph2.id,
      link: `/orders/${ph2.id}`,
      read: false,
      createdAt: ago(1 * DAY),
    },
    {
      userId: mike.id,
      type: "ORDER_DISPUTED",
      title: "Dispute opened",
      body: 'Sarah Mitchell has opened a dispute on iPad Pro 12.9" M2: Item damaged. Respond within 72 hours.',
      orderId: dispA.id,
      link: `/orders/${dispA.id}`,
      read: false,
      createdAt: ago(1 * DAY),
    },
    {
      userId: tom.id,
      type: "ORDER_DISPUTED",
      title: "Dispute opened",
      body: "Emma Wilson has opened a dispute on Sonos Move 2: Item not received. Respond within 72 hours.",
      orderId: dispB.id,
      link: `/orders/${dispB.id}`,
      read: true,
      createdAt: ago(4 * DAY),
    },
    {
      userId: rachel.id,
      type: "REVIEW_RECEIVED",
      title: "New 4.5-star review!",
      body: "Sarah Mitchell left a 4.5-star review on your Breville Bakery Boss Stand Mixer.",
      orderId: comp1.id,
      link: `/orders/${comp1.id}`,
      read: true,
      createdAt: ago(13 * DAY),
    },
    {
      userId: mike.id,
      type: "REVIEW_RECEIVED",
      title: "New 5-star review!",
      body: "Emma Wilson left a 5-star review on your Bose QuietComfort Ultra Headphones.",
      orderId: comp2.id,
      link: `/orders/${comp2.id}`,
      read: true,
      createdAt: ago(14 * DAY),
    },
    {
      userId: mike.id,
      type: "OFFER_RECEIVED",
      title: "New offer!",
      body: 'Sarah Mitchell offered $2,500.00 on your MacBook Pro 14" M3 Pro.',
      listingId: macbook,
      link: `/listings/${macbook}`,
      read: false,
      createdAt: ago(1 * DAY),
    },
    {
      userId: mike.id,
      type: "SYSTEM",
      title: "Cancellation request",
      body: "James Cooper has requested cancellation on AirPods Pro 2nd Gen.",
      orderId: canB.id,
      link: `/orders/${canB.id}`,
      read: true,
      createdAt: ago(6 * DAY),
    },
    {
      userId: mike.id,
      type: "SYSTEM",
      title: "10 sales milestone!",
      body: "Congratulations! You've completed 10 sales on KiwiMart. Keep up the great work!",
      read: true,
      createdAt: ago(10 * DAY),
    },
    {
      userId: rachel.id,
      type: "SYSTEM",
      title: "Cancellation request from James",
      body: "James Cooper has requested cancellation on Original Oil Painting. Respond within 48 hours.",
      orderId: ph2.id,
      link: `/orders/${ph2.id}`,
      read: false,
      createdAt: ago(4 * HOUR),
    },
    // Admin notifications
    {
      userId: superAdmin.id,
      type: "ADMIN_ALERT",
      title: "New dispute requires attention",
      body: 'iPad Pro 12.9" M2 — Item damaged (Sarah vs TechHub NZ)',
      orderId: dispA.id,
      link: `/admin/disputes/${dispA.id}`,
      read: false,
      createdAt: ago(1 * DAY),
    },
    {
      userId: superAdmin.id,
      type: "ADMIN_ALERT",
      title: "Auto-resolution queued",
      body: "Sonos Move 2 — refund in 24 hours (Emma vs Peak Outdoors)",
      orderId: dispB.id,
      link: `/admin/disputes/${dispB.id}`,
      read: false,
      createdAt: ago(1 * DAY),
    },
    {
      userId: disputeAdmin.id,
      type: "ADMIN_ALERT",
      title: "Dispute needs decision",
      body: "Handmade Ceramic Vase — both parties responded. Review needed.",
      orderId: dispC.id,
      link: `/admin/disputes/${dispC.id}`,
      read: false,
      createdAt: ago(3 * DAY),
    },
    {
      userId: superAdmin.id,
      type: "ADMIN_ALERT",
      title: "High dispute rate alert",
      body: "Peak Outdoors has a 25% dispute rate (2 of 8 orders). Monitor closely.",
      read: true,
      createdAt: ago(2 * DAY),
    },
  ];

  for (const n of notifications) {
    await db.notification.create({ data: n });
  }

  console.log(`✅ ${notifications.length} notifications created`);

  // ══════════════════════════════════════════════════════════════════════════
  // WATCHLIST
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n👀 Creating watchlist items...");

  const watchItems = [
    { userId: emma.id, listingId: macbook, priceAtWatch: 289900 },
    { userId: emma.id, listingId: iphone, priceAtWatch: 189900 },
    { userId: emma.id, listingId: ebike, priceAtWatch: 399900 },
    { userId: emma.id, listingId: necklace, priceAtWatch: 15900 },
    { userId: emma.id, listingId: couch, priceAtWatch: 149900 },
    { userId: sarah.id, listingId: tent, priceAtWatch: 49900 },
    { userId: sarah.id, listingId: painting, priceAtWatch: 45000 },
    { userId: sarah.id, listingId: samsung, priceAtWatch: 169900 },
    { userId: james.id, listingId: kitchenaid, priceAtWatch: 59900 },
    { userId: james.id, listingId: kayak, priceAtWatch: 89900 },
  ];

  for (const w of watchItems) {
    await db.watchlistItem.create({
      data: {
        ...w,
        priceAlertEnabled: true,
        createdAt: ago(Math.random() * 10 * DAY),
      },
    });
  }

  console.log("✅ 10 watchlist items created");

  // ══════════════════════════════════════════════════════════════════════════
  // PAYOUTS
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n💸 Creating payouts...");

  const payoutOrders = [
    { order: comp1, sellerId: rachel.id, status: "PAID" as const, daysAgo: 10 },
    { order: comp2, sellerId: mike.id, status: "PAID" as const, daysAgo: 12 },
    { order: comp3, sellerId: aroha.id, status: "PAID" as const, daysAgo: 8 },
    { order: comp4, sellerId: mike.id, status: "PAID" as const, daysAgo: 6 },
    { order: comp5, sellerId: tom.id, status: "PAID" as const, daysAgo: 5 },
    { order: comp6, sellerId: mike.id, status: "PAID" as const, daysAgo: 9 },
    {
      order: disp3,
      sellerId: rachel.id,
      status: "PENDING" as const,
      daysAgo: 0,
    },
    {
      order: disp2,
      sellerId: aroha.id,
      status: "PENDING" as const,
      daysAgo: 0,
    },
  ];

  for (const p of payoutOrders) {
    const amount = p.order.totalNzd;
    const platformFee = Math.round(amount * 0.1);
    const stripeFee = Math.round(amount * 0.029) + 30;
    await db.payout.create({
      data: {
        orderId: p.order.id,
        userId: p.sellerId,
        amountNzd: amount - platformFee,
        platformFeeNzd: platformFee,
        stripeFeeNzd: stripeFee,
        status: p.status,
        initiatedAt: p.status === "PAID" ? ago(p.daysAgo * DAY) : null,
        paidAt: p.status === "PAID" ? ago((p.daysAgo - 1) * DAY) : null,
        createdAt:
          p.status === "PAID" ? ago((p.daysAgo + 2) * DAY) : ago(1 * DAY),
      },
    });
  }

  console.log("✅ 8 payouts created (6 paid, 2 pending)");

  // ══════════════════════════════════════════════════════════════════════════
  // AUDIT LOGS
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n📝 Creating audit logs...");

  const auditLogs = [
    {
      userId: sarah.id,
      action: "USER_LOGIN" as const,
      entityType: "User",
      entityId: sarah.id,
      createdAt: ago(1 * DAY),
    },
    {
      userId: mike.id,
      action: "USER_LOGIN" as const,
      entityType: "User",
      entityId: mike.id,
      createdAt: ago(2 * HOUR),
    },
    {
      userId: mike.id,
      action: "LISTING_CREATED" as const,
      entityType: "Listing",
      entityId: iphone,
      createdAt: ago(7 * DAY),
    },
    {
      userId: rachel.id,
      action: "LISTING_CREATED" as const,
      entityType: "Listing",
      entityId: couch,
      createdAt: ago(7 * DAY),
    },
    {
      userId: sarah.id,
      action: "ORDER_CREATED" as const,
      entityType: "Order",
      entityId: comp1.id,
      createdAt: ago(20 * DAY),
    },
    {
      userId: emma.id,
      action: "ORDER_CREATED" as const,
      entityType: "Order",
      entityId: comp2.id,
      createdAt: ago(22 * DAY),
    },
    {
      userId: sarah.id,
      action: "DISPUTE_OPENED" as const,
      entityType: "Order",
      entityId: dispA.id,
      createdAt: ago(1 * DAY),
    },
    {
      userId: emma.id,
      action: "DISPUTE_OPENED" as const,
      entityType: "Order",
      entityId: dispB.id,
      createdAt: ago(4 * DAY),
    },
    {
      userId: disputeAdmin.id,
      action: "DISPUTE_RESOLVED" as const,
      entityType: "Order",
      entityId: refA.id,
      metadata: { favour: "buyer" },
      createdAt: ago(12 * DAY),
    },
    {
      userId: superAdmin.id,
      action: "ADMIN_ACTION" as const,
      entityType: "User",
      entityId: mike.id,
      metadata: { action: "approve_seller" },
      createdAt: ago(10 * DAY),
    },
    {
      userId: mike.id,
      action: "SELLER_TERMS_ACCEPTED" as const,
      entityType: "User",
      entityId: mike.id,
      createdAt: ago(90 * DAY),
    },
    {
      userId: james.id,
      action: "CART_CHECKOUT" as const,
      entityType: "Order",
      entityId: canB.id,
      createdAt: ago(7 * DAY),
    },
    {
      userId: rachel.id,
      action: "DISPUTE_SELLER_RESPONDED" as const,
      entityType: "Order",
      entityId: dispC.id,
      createdAt: ago(4 * DAY),
    },
    {
      userId: superAdmin.id,
      action: "ADMIN_ACTION" as const,
      entityType: "Report",
      entityId: "report_resolved",
      metadata: { action: "resolve_report" },
      createdAt: ago(6 * DAY),
    },
    {
      userId: mike.id,
      action: "LISTING_UPDATED" as const,
      entityType: "Listing",
      entityId: macbook,
      createdAt: ago(3 * DAY),
    },
    {
      userId: sarah.id,
      action: "USER_REGISTER" as const,
      entityType: "User",
      entityId: sarah.id,
      createdAt: ago(45 * DAY),
    },
    {
      userId: emma.id,
      action: "PAYMENT_COMPLETED" as const,
      entityType: "Order",
      entityId: comp2.id,
      createdAt: ago(22 * DAY),
    },
  ];

  for (const log of auditLogs) {
    await db.auditLog.create({ data: log });
  }

  console.log(`✅ ${auditLogs.length} audit log entries created`);

  // ══════════════════════════════════════════════════════════════════════════
  // REPORTS
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n🚩 Creating reports...");

  await db.report.create({
    data: {
      reporterId: sarah.id,
      listingId: iphone,
      reason: "COUNTERFEIT",
      description:
        "This iPhone listing seems suspicious. The price is too good and the seller photos look stock. Please verify authenticity.",
      status: "OPEN",
      createdAt: ago(2 * DAY),
    },
  });

  await db.report.create({
    data: {
      reporterId: emma.id,
      targetUserId: tom.id,
      reason: "OTHER",
      description:
        "This seller has been very unresponsive and I suspect they may be selling items they don't actually have.",
      status: "REVIEWING",
      createdAt: ago(5 * DAY),
    },
  });

  await db.report.create({
    data: {
      reporterId: james.id,
      listingId: macbook,
      reason: "SPAM",
      description:
        "This listing was reposted multiple times with different titles. Seems like spam.",
      status: "RESOLVED",
      resolvedBy: superAdmin.id,
      resolvedAt: ago(6 * DAY),
      resolvedNote:
        "Listing appears legitimate. Seller was re-listing after price change. No action needed.",
      createdAt: ago(8 * DAY),
    },
  });

  console.log("✅ 3 reports created (1 open, 1 reviewing, 1 resolved)");

  // ══════════════════════════════════════════════════════════════════════════
  // DONE
  // ══════════════════════════════════════════════════════════════════════════

  console.log("\n════════════════════════════════════════════════════════════");
  console.log("🥝 KiwiMart seed complete!");
  console.log("════════════════════════════════════════════════════════════");

  // Final counts
  const counts = await Promise.all([
    db.user.count(),
    db.listing.count(),
    db.order.count(),
    db.orderEvent.count(),
    db.orderInteraction.count(),
    db.review.count(),
    db.offer.count(),
    db.messageThread.count(),
    db.message.count(),
    db.notification.count(),
    db.watchlistItem.count(),
    db.payout.count(),
    db.auditLog.count(),
    db.report.count(),
    db.trustMetrics.count(),
  ]);

  console.log(`
Users:              ${counts[0]}
Listings:           ${counts[1]}
Orders:             ${counts[2]}
Order Events:       ${counts[3]}
Order Interactions: ${counts[4]}
Reviews:            ${counts[5]}
Offers:             ${counts[6]}
Message Threads:    ${counts[7]}
Messages:           ${counts[8]}
Notifications:      ${counts[9]}
Watchlist Items:    ${counts[10]}
Payouts:            ${counts[11]}
Audit Logs:         ${counts[12]}
Reports:            ${counts[13]}
Trust Metrics:      ${counts[14]}
`);

  console.log("Credentials:");
  console.log("  Buyers:  sarah@kiwimart.test / BuyerPass123!");
  console.log("           james@kiwimart.test / BuyerPass123!");
  console.log("           emma@kiwimart.test  / BuyerPass123!");
  console.log("  Sellers: techhub@kiwimart.test  / SellerPass123!");
  console.log("           kiwihome@kiwimart.test / SellerPass123!");
  console.log("           peak@kiwimart.test     / SellerPass123!");
  console.log("           stylenz@kiwimart.test  / SellerPass123!");
  console.log("  Admins:  admin@kiwimart.test     / AdminPass123!");
  console.log("           disputes@kiwimart.test  / AdminPass123!");
  console.log("           content@kiwimart.test   / AdminPass123!");
  console.log("           finance@kiwimart.test   / AdminPass123!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
