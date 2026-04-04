// prisma/seed-production.ts
// ─── Production Simulation Seed ─────────────────────────────────────────────
// Run: npx tsx prisma/seed-production.ts
// Creates 27 users, 120 listings, 35 orders, reviews, messages, watchlist,
// offers, and payouts for a realistic NZ marketplace simulation.

import {
  PrismaClient,
  type OrderStatus,
  type OfferStatus,
  type PayoutStatus,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const adapter = new PrismaPg({
  connectionString:
    process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}
function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 3_600_000);
}
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function $(dollars: number): number {
  return Math.round(dollars * 100);
}
function img(id: string): string {
  return `https://images.unsplash.com/${id}?w=800&h=600&fit=crop`;
}

const descTemplates: Record<string, [string, string]> = {
  electronics: [
    "Thoroughly tested and verified working. Includes all original accessories unless noted otherwise. Photos show the actual item — what you see is what you get.",
    "Fast tracked courier dispatch from New Zealand. Secure payment through KiwiMart escrow for your peace of mind. Check my other listings for more great tech deals.",
  ],
  fashion: [
    "Genuine article in the condition stated. Carefully stored and well maintained. Happy to provide measurements or additional photos on request.",
    "Packaged with care for safe delivery. Tracked courier throughout NZ. See my other listings for more quality items.",
  ],
  "home-garden": [
    "Well maintained and in full working order. Cleaned and ready for its new home. Photos accurately represent the item.",
    "Based in the Waikato region. Courier available for most items, larger pieces pickup only. Check my profile for more home and garden deals.",
  ],
  sports: [
    "Regularly serviced and well looked after. Perfect for NZ conditions. Happy to answer any questions about specs or sizing.",
    "Located in New Zealand. Can arrange courier for smaller items. Pickup welcome by arrangement.",
  ],
  "baby-kids": [
    "Safety checked and thoroughly cleaned before listing. Comes from a smoke-free, pet-free home. All items in the condition described.",
    "Fast dispatch via tracked courier. We take extra care packaging kids items. Check our other listings for bundle deals.",
  ],
  collectibles: [
    "Authenticated and verified genuine. Stored in controlled conditions. Certificate of authenticity included where stated.",
    "Carefully packaged for safe delivery. Tracked and insured courier. See my other listings for more NZ memorabilia.",
  ],
  business: [
    "Professional grade equipment in good working order. Suitable for trade use. Can demonstrate prior to purchase.",
    "Located in Canterbury. Pickup preferred for large items, courier available for smaller tools. Trade-ins welcome.",
  ],
  property: [
    "Available for viewing by appointment. References required. Bond equivalent to 4 weeks rent.",
    "Contact us to arrange a viewing. All applications processed through KiwiMart secure platform.",
  ],
};

function makeDesc(cat: string, specific: string): string {
  const tpl = descTemplates[cat] ?? descTemplates["electronics"] ?? ["", ""];
  const p2 = tpl[0] ?? "";
  const p3 = tpl[1] ?? "";
  return `${specific}\n\n${p2}\n\n${p3}`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Production simulation seed starting…\n");

  const { hashPassword } = await import("../src/server/lib/password");
  const hash = await hashPassword("Test1234!");
  console.log("✅ Password hashed");

  // ═══════════════════════════════════════════════════════════════════════════
  // USERS
  // ═══════════════════════════════════════════════════════════════════════════

  const sellerData = [
    {
      username: "TechDealsNZ",
      displayName: "TechDeals NZ",
      email: "techdeals@kiwimart.test",
      region: "Auckland",
      suburb: "Ponsonby",
      bio: "Auckland-based electronics reseller. All items personally tested before listing. Fast courier dispatch.",
      idVerified: true,
      created: "2022-06-15",
    },
    {
      username: "WelliTech",
      displayName: "WelliTech",
      email: "wellitech@kiwimart.test",
      region: "Wellington",
      suburb: "Te Aro",
      bio: "Wellington IT professional selling premium tech. Every item checked and tested.",
      idVerified: false,
      created: "2023-01-20",
    },
    {
      username: "AlpineWardrobe",
      displayName: "Alpine Wardrobe",
      email: "alpine@kiwimart.test",
      region: "Otago",
      suburb: "Queenstown",
      bio: "Queenstown outdoor gear and merino clothing specialist. Quality gear for NZ adventures.",
      idVerified: true,
      created: "2022-09-10",
    },
    {
      username: "SpinningWellie",
      displayName: "Spinning Wellie",
      email: "spinning@kiwimart.test",
      region: "Wellington",
      suburb: "Karori",
      bio: "Cyclist and gear enthusiast. Honest descriptions, fair prices.",
      idVerified: false,
      created: "2023-05-01",
    },
    {
      username: "RubyVault",
      displayName: "Ruby Vault",
      email: "rubyvault@kiwimart.test",
      region: "Auckland",
      suburb: "Eden Terrace",
      bio: "NZ sports memorabilia specialist. All items come with certificate of authenticity.",
      idVerified: true,
      created: "2022-03-22",
    },
    {
      username: "ChchCycles",
      displayName: "Chch Cycles",
      email: "chchcycles@kiwimart.test",
      region: "Canterbury",
      suburb: "Riccarton",
      bio: "Canterbury cycling specialist. New and used bikes, parts, and accessories.",
      idVerified: false,
      created: "2023-08-12",
    },
    {
      username: "HomeGoodsNZ",
      displayName: "HomeGoods NZ",
      email: "homegoods@kiwimart.test",
      region: "Waikato",
      suburb: "Hamilton",
      bio: "Quality home appliances and furniture at fair prices. Hamilton-based.",
      idVerified: false,
      created: "2023-03-18",
    },
    {
      username: "KidsStuffNZ",
      displayName: "Kids Stuff NZ",
      email: "kidsstuff@kiwimart.test",
      region: "Auckland",
      suburb: "Newmarket",
      bio: "Everything for babies and kids. All items safety checked before listing.",
      idVerified: true,
      created: "2022-11-05",
    },
    {
      username: "ProToolsChch",
      displayName: "Pro Tools Chch",
      email: "protools@kiwimart.test",
      region: "Canterbury",
      suburb: "Hornby",
      bio: "Professional tools and equipment. Trade-in welcome.",
      idVerified: false,
      created: "2024-01-15",
    },
    {
      username: "TaongaTreasures",
      displayName: "Taonga Treasures",
      email: "taonga@kiwimart.test",
      region: "Otago",
      suburb: "Dunedin",
      bio: "Authentic NZ Maori art and pounamu jewellery. Each piece comes with provenance.",
      idVerified: true,
      created: "2022-07-28",
    },
    {
      username: "BayPropertyNZ",
      displayName: "Bay Property NZ",
      email: "bayproperty@kiwimart.test",
      region: "Bay of Plenty",
      suburb: "Tauranga",
      bio: "Bay of Plenty property listings and rentals. Licensed agent.",
      idVerified: false,
      created: "2023-10-22",
    },
    {
      username: "NorthlandFinds",
      displayName: "Northland Finds",
      email: "northland@kiwimart.test",
      region: "Northland",
      suburb: "Whangarei",
      bio: "Northland treasure hunter. Mixed categories — fashion, outdoors, and more.",
      idVerified: false,
      created: "2024-02-08",
    },
  ];

  const buyerData = [
    {
      username: "jane_smith",
      displayName: "Jane Smith",
      email: "jane@kiwimart.test",
      region: "Auckland",
      suburb: "Ponsonby",
      created: "2023-02-14",
    },
    {
      username: "marcus_h",
      displayName: "Marcus Henderson",
      email: "marcus@kiwimart.test",
      region: "Wellington",
      suburb: "Newtown",
      created: "2023-06-20",
    },
    {
      username: "priya_m",
      displayName: "Priya Mehta",
      email: "priya@kiwimart.test",
      region: "Canterbury",
      suburb: "Merivale",
      created: "2023-04-10",
    },
    {
      username: "ben_o",
      displayName: "Ben O'Sullivan",
      email: "ben@kiwimart.test",
      region: "Otago",
      suburb: "Central Dunedin",
      created: "2023-08-15",
    },
    {
      username: "sarah_k",
      displayName: "Sarah Kim",
      email: "sarah@kiwimart.test",
      region: "Auckland",
      suburb: "Remuera",
      created: "2023-11-03",
    },
    {
      username: "james_t",
      displayName: "James Taylor",
      email: "james@kiwimart.test",
      region: "Waikato",
      suburb: "Flagstaff",
      created: "2023-05-28",
    },
    {
      username: "emma_w",
      displayName: "Emma Wilson",
      email: "emma@kiwimart.test",
      region: "Bay of Plenty",
      suburb: "Mount Maunganui",
      created: "2023-09-12",
    },
    {
      username: "liam_n",
      displayName: "Liam Nguyen",
      email: "liam@kiwimart.test",
      region: "Wellington",
      suburb: "Island Bay",
      created: "2024-01-07",
    },
    {
      username: "aroha_w",
      displayName: "Aroha Williams",
      email: "aroha@kiwimart.test",
      region: "Auckland",
      suburb: "Mangere",
      created: "2023-07-19",
    },
    {
      username: "connor_m",
      displayName: "Connor McLeod",
      email: "connor@kiwimart.test",
      region: "Canterbury",
      suburb: "Hornby",
      created: "2023-12-01",
    },
    {
      username: "fatima_a",
      displayName: "Fatima Al-Hassan",
      email: "fatima@kiwimart.test",
      region: "Auckland",
      suburb: "Papatoetoe",
      created: "2024-02-15",
    },
    {
      username: "david_p",
      displayName: "David Park",
      email: "david@kiwimart.test",
      region: "Wellington",
      suburb: "Karori",
      created: "2023-10-08",
    },
  ];

  // Seller IDs indexed by username
  const uid: Record<string, string> = {};

  for (const s of sellerData) {
    const u = await prisma.user.upsert({
      where: { email: s.email },
      update: {},
      create: {
        email: s.email,
        emailVerified: new Date(),
        username: s.username,
        displayName: s.displayName,
        passwordHash: hash,
        bio: s.bio,
        region: s.region,
        suburb: s.suburb,
        idVerified: s.idVerified,
        idVerifiedAt: s.idVerified ? new Date(s.created) : undefined,
        sellerEnabled: true,
        stripeOnboarded: true,
        stripeAccountId: `acct_test_${s.username.toLowerCase()}`,
        agreedTermsAt: new Date(s.created),
        createdAt: new Date(s.created),
      },
    });
    uid[s.username] = u.id;
  }
  console.log(`✅ ${sellerData.length} sellers`);

  for (const b of buyerData) {
    const u = await prisma.user.upsert({
      where: { email: b.email },
      update: {},
      create: {
        email: b.email,
        emailVerified: new Date(),
        username: b.username,
        displayName: b.displayName,
        passwordHash: hash,
        region: b.region,
        suburb: b.suburb,
        sellerEnabled: false,
        agreedTermsAt: new Date(b.created),
        createdAt: new Date(b.created),
      },
    });
    uid[b.username] = u.id;
  }
  console.log(`✅ ${buyerData.length} buyers`);

  // Keep existing test users
  for (const e of [
    "buyer@kiwimart.test",
    "seller@kiwimart.test",
    "admin@kiwimart.test",
  ]) {
    const ex = await prisma.user.findUnique({ where: { email: e } });
    if (ex) uid[ex.username] = ex.id;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LISTINGS (120)
  // ═══════════════════════════════════════════════════════════════════════════

  type LD = {
    t: string;
    p: number;
    c: "NEW" | "LIKE_NEW" | "GOOD" | "FAIR";
    s: string;
    cat: string;
    sub: string;
    r: string;
    sb: string;
    sh: "PICKUP" | "COURIER" | "BOTH";
    sp: number | null;
    o: boolean;
    im: string;
    d1: string;
    a: [string, string][];
  };

  // Fallback images per category
  const FI: Record<string, string[]> = {
    electronics: [
      "photo-1588872657578-7efd1f1555ed",
      "photo-1550009158-9ebf69173e03",
      "photo-1593305841991-05c297ba4575",
      "photo-1583394838336-acd977736f90",
      "photo-1517336714731-489689fd1ca8",
    ],
    fashion: [
      "photo-1441986300917-64674bd600d8",
      "photo-1560769629-975ec94e6a86",
      "photo-1509631179647-0177331693ae",
      "photo-1543163521-1bf539c55dd2",
    ],
    "home-garden": [
      "photo-1556909114-f6e7ad7d3136",
      "photo-1555041469-a586c61ea9bc",
      "photo-1584568694244-14fbdf83bd30",
      "photo-1556228578-8c89e6adf883",
    ],
    sports: [
      "photo-1571019614242-c5c5dee9f50b",
      "photo-1504280390367-361c6d9f38f4",
      "photo-1541625602330-2277a4c46182",
    ],
    "baby-kids": [
      "photo-1566004100631-35d015d6a491",
      "photo-1596461404969-9ae70f2830c1",
    ],
    collectibles: [
      "photo-1578662996442-48f60103fc96",
      "photo-1580541832626-2a7131ee809f",
    ],
    business: [
      "photo-1504148455328-c376907d081c",
      "photo-1581092580497-e0d23cbdf1dc",
    ],
    property: [
      "photo-1522708323590-d24dbb6b0267",
      "photo-1560448204-e02f11c3d0e2",
    ],
  };
  const fiIdx: Record<string, number> = {};
  function fallback(cat: string): string {
    if (!fiIdx[cat]) fiIdx[cat] = 0;
    const arr = FI[cat] ?? FI["electronics"] ?? [];
    const idx = fiIdx[cat] ?? 0;
    const id = arr[idx % arr.length] ?? "";
    fiIdx[cat] = idx + 1;
    return id;
  }

  const listings: LD[] = [
    // ── ELECTRONICS (25) ─── indices 0-24
    {
      t: "iPhone 15 Pro 256GB Space Black",
      p: 1150,
      c: "LIKE_NEW",
      s: "TechDealsNZ",
      cat: "electronics",
      sub: "Mobile Phones",
      r: "Auckland",
      sb: "Ponsonby",
      sh: "COURIER",
      sp: 12,
      o: true,
      im: "photo-1592750475338-74b7b21085ab",
      d1: "Stunning iPhone 15 Pro in Space Black with 256GB storage. Battery health at 94%, always used with premium case and screen protector. No scratches or dents anywhere.",
      a: [
        ["Brand", "Apple"],
        ["Model", "iPhone 15 Pro"],
        ["Storage", "256GB"],
        ["Colour", "Space Black"],
        ["Battery Health", "94%"],
      ],
    },
    {
      t: "Samsung Galaxy S24 Ultra 512GB",
      p: 950,
      c: "GOOD",
      s: "TechDealsNZ",
      cat: "electronics",
      sub: "Mobile Phones",
      r: "Auckland",
      sb: "Ponsonby",
      sh: "COURIER",
      sp: 12,
      o: true,
      im: "photo-1610945415295-d9bbf067e59c",
      d1: "Samsung Galaxy S24 Ultra with 512GB storage in Titanium Gray. Includes S Pen, original box and fast charger. Minor wear on edges from daily use.",
      a: [
        ["Brand", "Samsung"],
        ["Model", "Galaxy S24 Ultra"],
        ["Storage", "512GB"],
        ["Colour", "Titanium Gray"],
        ["RAM", "12GB"],
      ],
    },
    {
      t: "Sony WH-1000XM5 Headphones Black",
      p: 320,
      c: "LIKE_NEW",
      s: "TechDealsNZ",
      cat: "electronics",
      sub: "Audio",
      r: "Auckland",
      sb: "Ponsonby",
      sh: "COURIER",
      sp: 9,
      o: true,
      im: "photo-1590658268037-6bf12165a8df",
      d1: "Industry-leading noise cancelling headphones in black. 30-hour battery life, multipoint connection. Includes original carry case, cable and box. Used for only 3 months.",
      a: [
        ["Brand", "Sony"],
        ["Model", "WH-1000XM5"],
        ["Colour", "Black"],
        ["Battery Life", "30hrs"],
        ["Includes", "Original box & case"],
      ],
    },
    {
      t: "Apple AirPods Pro 2nd Gen USB-C",
      p: 220,
      c: "LIKE_NEW",
      s: "TechDealsNZ",
      cat: "electronics",
      sub: "Audio",
      r: "Auckland",
      sb: "Ponsonby",
      sh: "COURIER",
      sp: 8,
      o: false,
      im: "photo-1600294037681-c80b4cb5b434",
      d1: "AirPods Pro 2nd generation with USB-C MagSafe charging case. Active noise cancellation, adaptive transparency. Purchased 4 months ago, barely used.",
      a: [
        ["Brand", "Apple"],
        ["Model", "AirPods Pro 2"],
        ["Connector", "USB-C"],
        ["Features", "ANC, Adaptive Transparency"],
        ["Includes", "All ear tips, cable"],
      ],
    },
    {
      t: "PS5 Console Disc Edition Bundle",
      p: 550,
      c: "GOOD",
      s: "TechDealsNZ",
      cat: "electronics",
      sub: "Gaming",
      r: "Auckland",
      sb: "Ponsonby",
      sh: "BOTH",
      sp: 20,
      o: true,
      im: "photo-1606813907291-d86efa9b94db",
      d1: "PlayStation 5 Disc Edition with one DualSense controller and 3 games included (Spider-Man 2, God of War Ragnarok, Horizon). All in great working condition.",
      a: [
        ["Brand", "Sony"],
        ["Model", "PS5 Disc Edition"],
        ["Controllers", "1x DualSense"],
        ["Games", "3 included"],
        ["Condition", "Fully working"],
      ],
    },
    {
      t: "iPad Pro 12.9 inch M2 WiFi 256GB",
      p: 1200,
      c: "LIKE_NEW",
      s: "TechDealsNZ",
      cat: "electronics",
      sub: "Tablets",
      r: "Auckland",
      sb: "Ponsonby",
      sh: "COURIER",
      sp: 12,
      o: true,
      im: "photo-1544244015-0df4b3ffc6b0",
      d1: "iPad Pro 12.9-inch M2 chip with 256GB WiFi in Space Grey. Liquid Retina XDR display. Includes Apple Pencil 2 and Smart Folio case. Immaculate condition.",
      a: [
        ["Brand", "Apple"],
        ["Model", "iPad Pro 12.9 M2"],
        ["Storage", "256GB"],
        ["Connectivity", "WiFi"],
        ["Includes", "Apple Pencil 2, Smart Folio"],
      ],
    },
    {
      t: "Canon EOS R6 Mark II Body Only",
      p: 2800,
      c: "LIKE_NEW",
      s: "TechDealsNZ",
      cat: "electronics",
      sub: "Cameras & Drones",
      r: "Auckland",
      sb: "Ponsonby",
      sh: "COURIER",
      sp: 15,
      o: false,
      im: "photo-1527977966376-1c8408f9f108",
      d1: "Canon EOS R6 Mark II mirrorless camera body. 24.2MP full-frame sensor, 40fps continuous shooting, 4K 60p video. Only 3,200 shutter actuations. Mint condition.",
      a: [
        ["Brand", "Canon"],
        ["Model", "EOS R6 Mark II"],
        ["Sensor", "24.2MP Full Frame"],
        ["Shutter Count", "3,200"],
        ["Video", "4K 60fps"],
      ],
    },
    {
      t: "Apple Watch Series 9 45mm GPS",
      p: 480,
      c: "LIKE_NEW",
      s: "TechDealsNZ",
      cat: "electronics",
      sub: "Wearables",
      r: "Auckland",
      sb: "Ponsonby",
      sh: "COURIER",
      sp: 9,
      o: true,
      im: fallback("electronics"),
      d1: "Apple Watch Series 9 in 45mm Midnight Aluminium with GPS. Battery health 100%. Includes two sport bands (S/M and M/L) and magnetic charger.",
      a: [
        ["Brand", "Apple"],
        ["Model", "Watch Series 9"],
        ["Size", "45mm"],
        ["Connectivity", "GPS"],
        ["Battery Health", "100%"],
      ],
    },
    {
      t: "Samsung 65 inch QLED 4K Smart TV",
      p: 890,
      c: "GOOD",
      s: "TechDealsNZ",
      cat: "electronics",
      sub: "TV & Home Theatre",
      r: "Auckland",
      sb: "Ponsonby",
      sh: "PICKUP",
      sp: null,
      o: true,
      im: fallback("electronics"),
      d1: "Samsung 65-inch QLED 4K Smart TV with Tizen OS. Quantum dot display, 120Hz motion rate. Includes wall mount bracket and original remote. Collection only — large item.",
      a: [
        ["Brand", "Samsung"],
        ["Model", "QE65Q80B"],
        ["Screen Size", "65 inch"],
        ["Resolution", "4K QLED"],
        ["Smart TV", "Tizen OS"],
      ],
    },
    {
      t: "Bose QuietComfort 45 White",
      p: 280,
      c: "GOOD",
      s: "TechDealsNZ",
      cat: "electronics",
      sub: "Audio",
      r: "Auckland",
      sb: "Ponsonby",
      sh: "COURIER",
      sp: 9,
      o: true,
      im: fallback("electronics"),
      d1: "Bose QuietComfort 45 wireless headphones in white. Excellent noise cancelling, 24-hour battery. Minor wear on headband but fully functional. Includes case and cable.",
      a: [
        ["Brand", "Bose"],
        ["Model", "QuietComfort 45"],
        ["Colour", "White"],
        ["Battery Life", "24hrs"],
        ["Includes", "Case, USB-C cable"],
      ],
    },
    {
      t: "Xbox Series X Console 1TB",
      p: 520,
      c: "GOOD",
      s: "TechDealsNZ",
      cat: "electronics",
      sub: "Gaming",
      r: "Auckland",
      sb: "Ponsonby",
      sh: "COURIER",
      sp: 18,
      o: true,
      im: fallback("electronics"),
      d1: "Xbox Series X 1TB console with one wireless controller. 4K gaming at up to 120fps. Includes HDMI cable and power cord. Great condition, barely used.",
      a: [
        ["Brand", "Microsoft"],
        ["Model", "Xbox Series X"],
        ["Storage", "1TB SSD"],
        ["Resolution", "4K 120fps"],
        ["Controllers", "1 included"],
      ],
    },
    {
      t: "iPad Air M1 256GB Space Grey",
      p: 750,
      c: "LIKE_NEW",
      s: "TechDealsNZ",
      cat: "electronics",
      sub: "Tablets",
      r: "Auckland",
      sb: "Ponsonby",
      sh: "COURIER",
      sp: 12,
      o: true,
      im: fallback("electronics"),
      d1: "iPad Air 5th gen with M1 chip, 256GB in Space Grey. 10.9-inch Liquid Retina display. Includes Smart Keyboard Folio. Perfect for work and play.",
      a: [
        ["Brand", "Apple"],
        ["Model", "iPad Air M1"],
        ["Storage", "256GB"],
        ["Colour", "Space Grey"],
        ["Includes", "Smart Keyboard Folio"],
      ],
    },
    {
      t: "Logitech MX Master 3S Mouse",
      p: 95,
      c: "LIKE_NEW",
      s: "TechDealsNZ",
      cat: "electronics",
      sub: "Computer Parts",
      r: "Auckland",
      sb: "Ponsonby",
      sh: "COURIER",
      sp: 6,
      o: true,
      im: fallback("electronics"),
      d1: "Logitech MX Master 3S wireless mouse in Graphite. 8K DPI sensor, quiet clicks, USB-C charging. Pairs with up to 3 devices. Includes USB-C cable and receiver.",
      a: [
        ["Brand", "Logitech"],
        ["Model", "MX Master 3S"],
        ["Colour", "Graphite"],
        ["Connectivity", "Bluetooth + USB"],
        ["DPI", "8,000"],
      ],
    },
    // WelliTech electronics
    {
      t: "Apple MacBook Pro 14 inch M3 Pro",
      p: 2850,
      c: "LIKE_NEW",
      s: "WelliTech",
      cat: "electronics",
      sub: "Computers",
      r: "Wellington",
      sb: "Te Aro",
      sh: "COURIER",
      sp: 15,
      o: true,
      im: "photo-1517336714731-489689fd1ca8",
      d1: "MacBook Pro 14-inch with M3 Pro chip, 18GB unified memory and 512GB SSD in Space Black. Only 41 battery cycles. AppleCare+ until 2026. Immaculate condition.",
      a: [
        ["Brand", "Apple"],
        ["Model", "MacBook Pro 14 M3 Pro"],
        ["RAM", "18GB"],
        ["Storage", "512GB"],
        ["Battery Cycles", "41"],
      ],
    },
    {
      t: "Nintendo Switch OLED Model White",
      p: 380,
      c: "LIKE_NEW",
      s: "WelliTech",
      cat: "electronics",
      sub: "Gaming",
      r: "Wellington",
      sb: "Te Aro",
      sh: "COURIER",
      sp: 12,
      o: true,
      im: "photo-1578303512597-81e6cc155b3e",
      d1: "Nintendo Switch OLED model in white. Vibrant 7-inch OLED screen, wide adjustable stand, 64GB internal storage. Includes dock, Joy-Cons, and grip. Barely used.",
      a: [
        ["Brand", "Nintendo"],
        ["Model", "Switch OLED"],
        ["Colour", "White"],
        ["Storage", "64GB"],
        ["Includes", "Dock, Joy-Cons, Grip"],
      ],
    },
    {
      t: "DJI Mini 4 Pro with RC2 Controller",
      p: 1099,
      c: "GOOD",
      s: "WelliTech",
      cat: "electronics",
      sub: "Cameras & Drones",
      r: "Wellington",
      sb: "Te Aro",
      sh: "COURIER",
      sp: 15,
      o: true,
      im: "photo-1527977966376-1c8408f9f108",
      d1: "DJI Mini 4 Pro drone with RC2 controller (built-in screen). Under 249g, no CAA registration needed in NZ. 4K HDR video, omnidirectional obstacle sensing. Fly More combo.",
      a: [
        ["Brand", "DJI"],
        ["Model", "Mini 4 Pro"],
        ["Weight", "Under 249g"],
        ["Video", "4K HDR"],
        ["Controller", "RC2 with screen"],
      ],
    },
    {
      t: "Dell XPS 15 Intel i7 32GB RAM",
      p: 1450,
      c: "GOOD",
      s: "WelliTech",
      cat: "electronics",
      sub: "Computers",
      r: "Wellington",
      sb: "Te Aro",
      sh: "COURIER",
      sp: 18,
      o: true,
      im: fallback("electronics"),
      d1: "Dell XPS 15 laptop with 12th Gen Intel i7, 32GB RAM, 1TB SSD, and NVIDIA RTX 3050 Ti. 15.6-inch OLED 3.5K display. Great for creative work and development.",
      a: [
        ["Brand", "Dell"],
        ["Model", "XPS 15 9520"],
        ["CPU", "Intel i7-12700H"],
        ["RAM", "32GB"],
        ["GPU", "RTX 3050 Ti"],
      ],
    },
    {
      t: "GoPro Hero 12 Black Creator Edition",
      p: 420,
      c: "LIKE_NEW",
      s: "WelliTech",
      cat: "electronics",
      sub: "Cameras & Drones",
      r: "Wellington",
      sb: "Te Aro",
      sh: "COURIER",
      sp: 10,
      o: false,
      im: fallback("electronics"),
      d1: "GoPro Hero 12 Black with creator accessories. 5.3K video, HyperSmooth 6.0 stabilisation. Includes Volta grip, Media Mod, and Light Mod. Perfect for NZ adventures.",
      a: [
        ["Brand", "GoPro"],
        ["Model", "Hero 12 Black"],
        ["Video", "5.3K 60fps"],
        ["Stabilisation", "HyperSmooth 6.0"],
        ["Includes", "Creator Edition accessories"],
      ],
    },
    {
      t: "Sony A7 IV Mirrorless Camera Body",
      p: 2400,
      c: "LIKE_NEW",
      s: "WelliTech",
      cat: "electronics",
      sub: "Cameras & Drones",
      r: "Wellington",
      sb: "Te Aro",
      sh: "COURIER",
      sp: 15,
      o: false,
      im: fallback("electronics"),
      d1: "Sony A7 IV full-frame mirrorless camera body. 33MP sensor, real-time tracking AF, 4K 60p video. Only 5,400 shutter actuations. Professional workhorse camera.",
      a: [
        ["Brand", "Sony"],
        ["Model", "A7 IV (ILCE-7M4)"],
        ["Sensor", "33MP Full Frame"],
        ["Shutter Count", "5,400"],
        ["Video", "4K 60fps"],
      ],
    },
    {
      t: "JBL Flip 6 Bluetooth Speaker Teal",
      p: 120,
      c: "LIKE_NEW",
      s: "WelliTech",
      cat: "electronics",
      sub: "Audio",
      r: "Wellington",
      sb: "Te Aro",
      sh: "COURIER",
      sp: 8,
      o: true,
      im: fallback("electronics"),
      d1: "JBL Flip 6 portable Bluetooth speaker in Teal. Powerful JBL Pro Sound, IP67 waterproof and dustproof. 12-hour battery life. Perfect for beach, BBQ or tramping.",
      a: [
        ["Brand", "JBL"],
        ["Model", "Flip 6"],
        ["Colour", "Teal"],
        ["Waterproof", "IP67"],
        ["Battery", "12 hours"],
      ],
    },
    {
      t: "Ring Video Doorbell Pro 2 Nickel",
      p: 280,
      c: "NEW",
      s: "WelliTech",
      cat: "electronics",
      sub: "Networking",
      r: "Wellington",
      sb: "Te Aro",
      sh: "COURIER",
      sp: 10,
      o: false,
      im: fallback("electronics"),
      d1: "Brand new Ring Video Doorbell Pro 2 in Satin Nickel. 1536p HD video, head-to-toe view, 3D motion detection. Hardwired for reliable power. Still sealed in box.",
      a: [
        ["Brand", "Ring"],
        ["Model", "Video Doorbell Pro 2"],
        ["Video", "1536p HD"],
        ["Finish", "Satin Nickel"],
        ["Power", "Hardwired"],
      ],
    },
    {
      t: "Garmin Fenix 7 Solar GPS Watch",
      p: 650,
      c: "LIKE_NEW",
      s: "WelliTech",
      cat: "electronics",
      sub: "Wearables",
      r: "Wellington",
      sb: "Te Aro",
      sh: "COURIER",
      sp: 9,
      o: true,
      im: fallback("electronics"),
      d1: "Garmin Fenix 7 Solar multisport GPS watch with solar charging lens. Topo maps, multi-band GPS, pulse ox sensor. Up to 22 days battery with solar. Built for NZ outdoors.",
      a: [
        ["Brand", "Garmin"],
        ["Model", "Fenix 7 Solar"],
        ["Battery", "22 days + solar"],
        ["GPS", "Multi-band"],
        ["Maps", "TopoActive NZ"],
      ],
    },
    {
      t: "LG 27 inch 4K IPS Monitor USB-C",
      p: 420,
      c: "LIKE_NEW",
      s: "WelliTech",
      cat: "electronics",
      sub: "Computers",
      r: "Wellington",
      sb: "Te Aro",
      sh: "COURIER",
      sp: 20,
      o: true,
      im: fallback("electronics"),
      d1: "LG 27-inch 4K UHD IPS monitor with USB-C 96W Power Delivery. Daisy-chain support, HDR10, 60Hz. Perfect work-from-home display. Includes stand and all cables.",
      a: [
        ["Brand", "LG"],
        ["Model", "27UK850-W"],
        ["Resolution", "3840x2160"],
        ["Panel", "IPS"],
        ["USB-C PD", "96W"],
      ],
    },
    {
      t: "Raspberry Pi 4 Model B 8GB Kit",
      p: 180,
      c: "NEW",
      s: "WelliTech",
      cat: "electronics",
      sub: "Computer Parts",
      r: "Wellington",
      sb: "Te Aro",
      sh: "COURIER",
      sp: 8,
      o: false,
      im: fallback("electronics"),
      d1: "Raspberry Pi 4 Model B 8GB complete starter kit. Includes official case, 32GB microSD with Raspberry Pi OS, USB-C power supply, micro-HDMI cable, and heatsinks.",
      a: [
        ["Brand", "Raspberry Pi"],
        ["Model", "4 Model B"],
        ["RAM", "8GB"],
        ["Includes", "Case, SD, PSU, cables"],
        ["Condition", "New in box"],
      ],
    },
    {
      t: "Anker 65W USB-C GaN Charger",
      p: 45,
      c: "NEW",
      s: "WelliTech",
      cat: "electronics",
      sub: "Computer Parts",
      r: "Wellington",
      sb: "Te Aro",
      sh: "COURIER",
      sp: 5,
      o: false,
      im: fallback("electronics"),
      d1: "Anker 735 Charger (Nano II 65W) with GaN II technology. 3 ports (2x USB-C, 1x USB-A). Charges MacBook Pro at full speed. Compact travel-friendly design. Brand new sealed.",
      a: [
        ["Brand", "Anker"],
        ["Model", "735 Nano II 65W"],
        ["Ports", "2x USB-C, 1x USB-A"],
        ["Technology", "GaN II"],
        ["Includes", "USB-C cable"],
      ],
    },

    // ── FASHION (20) ─── indices 25-44
    {
      t: "Allbirds Wool Runners M10 Blizzard",
      p: 65,
      c: "GOOD",
      s: "AlpineWardrobe",
      cat: "fashion",
      sub: "Shoes",
      r: "Otago",
      sb: "Queenstown",
      sh: "COURIER",
      sp: 8,
      o: true,
      im: "photo-1542291026-7eec264c27ff",
      d1: "Allbirds Wool Runners in Blizzard colourway, men's size 10. Made from NZ merino wool. Comfortable everyday shoes with good tread remaining. Some normal wear.",
      a: [
        ["Brand", "Allbirds"],
        ["Model", "Wool Runners"],
        ["Size", "M10"],
        ["Colour", "Blizzard"],
        ["Material", "NZ Merino Wool"],
      ],
    },
    {
      t: "Icebreaker 200 Oasis Merino Top M",
      p: 85,
      c: "LIKE_NEW",
      s: "AlpineWardrobe",
      cat: "fashion",
      sub: "Men's Clothing",
      r: "Otago",
      sb: "Queenstown",
      sh: "COURIER",
      sp: 8,
      o: false,
      im: "photo-1521572163474-6864f9cf17ab",
      d1: "Icebreaker 200 Oasis long sleeve merino base layer in black, men's medium. 100% NZ merino wool, perfect for layering in winter or wearing alone. Barely worn.",
      a: [
        ["Brand", "Icebreaker"],
        ["Model", "200 Oasis LS"],
        ["Size", "Medium"],
        ["Material", "100% Merino"],
        ["Colour", "Black"],
      ],
    },
    {
      t: "R.M. Williams Craftsman Boots 10G",
      p: 320,
      c: "GOOD",
      s: "AlpineWardrobe",
      cat: "fashion",
      sub: "Shoes",
      r: "Otago",
      sb: "Queenstown",
      sh: "COURIER",
      sp: 12,
      o: true,
      im: fallback("fashion"),
      d1: "R.M. Williams Craftsman Chelsea boots in Chestnut yearling leather, size 10G. Classic Australian-made pull-on boots. Resoled once, plenty of life left.",
      a: [
        ["Brand", "R.M. Williams"],
        ["Model", "Craftsman"],
        ["Size", "10G"],
        ["Leather", "Chestnut Yearling"],
        ["Made In", "Australia"],
      ],
    },
    {
      t: "Icebreaker Merino Midlayer Jacket M",
      p: 120,
      c: "LIKE_NEW",
      s: "AlpineWardrobe",
      cat: "fashion",
      sub: "Jackets & Coats",
      r: "Otago",
      sb: "Queenstown",
      sh: "COURIER",
      sp: 8,
      o: false,
      im: "photo-1551028719-00167b16eac5",
      d1: "Icebreaker RealFleece Merino midlayer jacket in black, men's medium. Full zip, thumb loops, zippered pockets. Perfect tramping or skiing layer. Worn twice.",
      a: [
        ["Brand", "Icebreaker"],
        ["Model", "RealFleece Midlayer"],
        ["Size", "Medium"],
        ["Material", "Merino Blend"],
        ["Colour", "Black"],
      ],
    },
    {
      t: "Rodd and Gunn Sports Fit Shirt L",
      p: 55,
      c: "LIKE_NEW",
      s: "AlpineWardrobe",
      cat: "fashion",
      sub: "Men's Clothing",
      r: "Otago",
      sb: "Queenstown",
      sh: "COURIER",
      sp: 7,
      o: false,
      im: fallback("fashion"),
      d1: "Rodd & Gunn Gunn Oxford sports fit shirt in blue check, size large. Premium NZ brand, excellent quality cotton. Perfect for smart casual. Worn once to an event.",
      a: [
        ["Brand", "Rodd & Gunn"],
        ["Model", "Gunn Oxford"],
        ["Size", "Large"],
        ["Fit", "Sports Fit"],
        ["Colour", "Blue Check"],
      ],
    },
    {
      t: "New Balance 990v6 M10.5 Grey",
      p: 180,
      c: "LIKE_NEW",
      s: "AlpineWardrobe",
      cat: "fashion",
      sub: "Shoes",
      r: "Otago",
      sb: "Queenstown",
      sh: "COURIER",
      sp: 9,
      o: false,
      im: fallback("fashion"),
      d1: "New Balance 990v6 Made in USA in grey, men's 10.5. The iconic dad shoe. ENCAP midsole cushioning. Worn a handful of times, excellent condition with box.",
      a: [
        ["Brand", "New Balance"],
        ["Model", "990v6"],
        ["Size", "M10.5"],
        ["Colour", "Grey"],
        ["Made In", "USA"],
      ],
    },
    {
      t: "Patagonia Down Sweater Jacket M",
      p: 195,
      c: "GOOD",
      s: "AlpineWardrobe",
      cat: "fashion",
      sub: "Jackets & Coats",
      r: "Otago",
      sb: "Queenstown",
      sh: "COURIER",
      sp: 10,
      o: true,
      im: fallback("fashion"),
      d1: "Patagonia Down Sweater jacket in black, men's medium. 800-fill-power traceable down. Windproof, water-resistant shell. Great for NZ winters, light enough to pack.",
      a: [
        ["Brand", "Patagonia"],
        ["Model", "Down Sweater"],
        ["Size", "Medium"],
        ["Fill", "800-fill Down"],
        ["Colour", "Black"],
      ],
    },
    {
      t: "Seiko Presage Automatic Watch",
      p: 380,
      c: "LIKE_NEW",
      s: "AlpineWardrobe",
      cat: "fashion",
      sub: "Watches",
      r: "Otago",
      sb: "Queenstown",
      sh: "COURIER",
      sp: 9,
      o: false,
      im: fallback("fashion"),
      d1: "Seiko Presage Cocktail Time automatic watch with stunning blue sunburst dial. 40.5mm stainless steel case, Hardlex crystal. Keeps excellent time. Includes box and papers.",
      a: [
        ["Brand", "Seiko"],
        ["Model", "Presage SRPB41"],
        ["Movement", "Automatic 4R35"],
        ["Case", "40.5mm Steel"],
        ["Dial", "Blue Sunburst"],
      ],
    },
    {
      t: "Salomon Speedcross 6 Trail M10",
      p: 140,
      c: "GOOD",
      s: "AlpineWardrobe",
      cat: "fashion",
      sub: "Shoes",
      r: "Otago",
      sb: "Queenstown",
      sh: "COURIER",
      sp: 9,
      o: false,
      im: fallback("fashion"),
      d1: "Salomon Speedcross 6 trail running shoes, men's size 10. Aggressive mud-shedding tread. Contagrip MA outsole. Used for one season of trail running around Queenstown.",
      a: [
        ["Brand", "Salomon"],
        ["Model", "Speedcross 6"],
        ["Size", "M10"],
        ["Colour", "Black/Phantom"],
        ["Tread", "Contagrip MA"],
      ],
    },
    {
      t: "Arc'teryx Beta LT Jacket M Black",
      p: 480,
      c: "GOOD",
      s: "AlpineWardrobe",
      cat: "fashion",
      sub: "Jackets & Coats",
      r: "Otago",
      sb: "Queenstown",
      sh: "COURIER",
      sp: 12,
      o: true,
      im: fallback("fashion"),
      d1: "Arc'teryx Beta LT Gore-Tex jacket in black, men's medium. Lightweight waterproof shell for alpine use. Helmet-compatible StormHood. Used for two ski seasons.",
      a: [
        ["Brand", "Arc'teryx"],
        ["Model", "Beta LT"],
        ["Size", "Medium"],
        ["Material", "GORE-TEX"],
        ["Colour", "Black"],
      ],
    },
    // NorthlandFinds fashion
    {
      t: "Kathmandu Heli 3-in-1 Jacket L",
      p: 180,
      c: "GOOD",
      s: "NorthlandFinds",
      cat: "fashion",
      sub: "Jackets & Coats",
      r: "Northland",
      sb: "Whangarei",
      sh: "COURIER",
      sp: 10,
      o: true,
      im: fallback("fashion"),
      d1: "Kathmandu Heli 3-in-1 jacket in navy, size large. Waterproof outer shell with removable down inner jacket. Three jackets in one. Great all-round NZ jacket.",
      a: [
        ["Brand", "Kathmandu"],
        ["Model", "Heli 3-in-1"],
        ["Size", "Large"],
        ["Colour", "Navy"],
        ["Waterproof", "Yes"],
      ],
    },
    {
      t: "Lululemon Align Leggings 8 Black",
      p: 75,
      c: "LIKE_NEW",
      s: "NorthlandFinds",
      cat: "fashion",
      sub: "Activewear",
      r: "Northland",
      sb: "Whangarei",
      sh: "COURIER",
      sp: 8,
      o: false,
      im: fallback("fashion"),
      d1: "Lululemon Align high-rise leggings in black, size 8 (NZ). Buttery-soft Nulu fabric, 25-inch inseam. No pilling or fading. Worn only a few times to yoga.",
      a: [
        ["Brand", "Lululemon"],
        ["Model", 'Align HR 25"'],
        ["Size", "8"],
        ["Colour", "Black"],
        ["Fabric", "Nulu"],
      ],
    },
    {
      t: "Nike Air Max 270 M9 Black White",
      p: 95,
      c: "GOOD",
      s: "NorthlandFinds",
      cat: "fashion",
      sub: "Shoes",
      r: "Northland",
      sb: "Whangarei",
      sh: "COURIER",
      sp: 8,
      o: true,
      im: fallback("fashion"),
      d1: "Nike Air Max 270 in black/white, men's size 9. Large Max Air unit for all-day comfort. Good condition with normal wear. Cleaned and ready to go.",
      a: [
        ["Brand", "Nike"],
        ["Model", "Air Max 270"],
        ["Size", "M9"],
        ["Colour", "Black/White"],
        ["Cushioning", "Max Air"],
      ],
    },
    {
      t: "Country Road Linen Blazer 12 Camel",
      p: 110,
      c: "GOOD",
      s: "NorthlandFinds",
      cat: "fashion",
      sub: "Women's Clothing",
      r: "Northland",
      sb: "Whangarei",
      sh: "COURIER",
      sp: 9,
      o: false,
      im: fallback("fashion"),
      d1: "Country Road linen blend blazer in camel, women's size 12. Single-breasted, relaxed fit. Perfect for summer work-to-dinner transition. Dry cleaned and ready.",
      a: [
        ["Brand", "Country Road"],
        ["Model", "Linen Blazer"],
        ["Size", "12"],
        ["Colour", "Camel"],
        ["Material", "Linen Blend"],
      ],
    },
    {
      t: "Glassons Broderie Midi Dress 10",
      p: 35,
      c: "LIKE_NEW",
      s: "NorthlandFinds",
      cat: "fashion",
      sub: "Women's Clothing",
      r: "Northland",
      sb: "Whangarei",
      sh: "COURIER",
      sp: 7,
      o: false,
      im: fallback("fashion"),
      d1: "Glassons broderie anglaise midi dress in white, NZ size 10. Puff sleeves, tiered skirt, cotton fabric. Worn once to a garden party. As-new condition.",
      a: [
        ["Brand", "Glassons"],
        ["Size", "10"],
        ["Colour", "White"],
        ["Style", "Midi"],
        ["Material", "Cotton"],
      ],
    },
    {
      t: "Coach Leather Crossbody Bag Black",
      p: 220,
      c: "GOOD",
      s: "NorthlandFinds",
      cat: "fashion",
      sub: "Bags & Accessories",
      r: "Northland",
      sb: "Whangarei",
      sh: "COURIER",
      sp: 10,
      o: true,
      im: fallback("fashion"),
      d1: "Genuine Coach pebbled leather crossbody bag in black. Adjustable strap, zip closure, multiple card slots inside. Some light patina adds character. Authenticated.",
      a: [
        ["Brand", "Coach"],
        ["Model", "Crossbody"],
        ["Colour", "Black"],
        ["Material", "Pebbled Leather"],
        ["Authentic", "Yes"],
      ],
    },
    {
      t: "Levi's 501 Original Jeans 32x32",
      p: 65,
      c: "GOOD",
      s: "NorthlandFinds",
      cat: "fashion",
      sub: "Men's Clothing",
      r: "Northland",
      sb: "Whangarei",
      sh: "COURIER",
      sp: 8,
      o: false,
      im: fallback("fashion"),
      d1: "Levi's 501 Original Fit jeans in medium stonewash, 32x32. Classic straight leg, button fly. Broken in nicely with no rips or stains. Timeless denim.",
      a: [
        ["Brand", "Levi's"],
        ["Model", "501 Original"],
        ["Size", "32x32"],
        ["Colour", "Medium Stonewash"],
        ["Fit", "Straight"],
      ],
    },
    {
      t: "Pandora Charm Bracelet with 8 Charms",
      p: 195,
      c: "GOOD",
      s: "NorthlandFinds",
      cat: "fashion",
      sub: "Jewellery",
      r: "Northland",
      sb: "Whangarei",
      sh: "COURIER",
      sp: 8,
      o: true,
      im: fallback("fashion"),
      d1: "Pandora moments snake chain bracelet in sterling silver with 8 charms including NZ fern, Kiwi bird, heart clasp, and more. Original box included. Lovely collection.",
      a: [
        ["Brand", "Pandora"],
        ["Material", "Sterling Silver"],
        ["Charms", "8 included"],
        ["Includes", "Original box"],
        ["Bracelet Type", "Moments Snake Chain"],
      ],
    },
    {
      t: "Tommy Hilfiger Polo Shirt L Navy",
      p: 45,
      c: "LIKE_NEW",
      s: "NorthlandFinds",
      cat: "fashion",
      sub: "Men's Clothing",
      r: "Northland",
      sb: "Whangarei",
      sh: "COURIER",
      sp: 7,
      o: false,
      im: fallback("fashion"),
      d1: "Tommy Hilfiger classic fit polo shirt in navy, size large. Iconic flag logo on chest. 100% cotton pique. Perfect condition, worn once. Great everyday polo.",
      a: [
        ["Brand", "Tommy Hilfiger"],
        ["Model", "Classic Fit Polo"],
        ["Size", "Large"],
        ["Colour", "Navy"],
        ["Material", "Cotton Pique"],
      ],
    },
    {
      t: "Merrell Moab 3 Hiking Boots W8",
      p: 120,
      c: "GOOD",
      s: "NorthlandFinds",
      cat: "fashion",
      sub: "Shoes",
      r: "Northland",
      sb: "Whangarei",
      sh: "COURIER",
      sp: 9,
      o: false,
      im: fallback("fashion"),
      d1: "Merrell Moab 3 Mid Gore-Tex hiking boots, women's 8. Waterproof, Vibram outsole. Used for a few weekend tramps in Northland. Plenty of tread remaining.",
      a: [
        ["Brand", "Merrell"],
        ["Model", "Moab 3 Mid GTX"],
        ["Size", "W8"],
        ["Waterproof", "GORE-TEX"],
        ["Sole", "Vibram TC5+"],
      ],
    },

    // ── HOME & GARDEN (20) ─── indices 45-64
    {
      t: "Dyson V15 Detect Absolute Vacuum",
      p: 599,
      c: "GOOD",
      s: "HomeGoodsNZ",
      cat: "home-garden",
      sub: "Appliances",
      r: "Waikato",
      sb: "Hamilton",
      sh: "COURIER",
      sp: 18,
      o: true,
      im: "photo-1558317374-067fb5f30001",
      d1: "Dyson V15 Detect Absolute cordless vacuum with laser dust detection. Piezo sensor counts particles. Includes all attachments and wall dock. 60 min runtime.",
      a: [
        ["Brand", "Dyson"],
        ["Model", "V15 Detect Absolute"],
        ["Type", "Cordless Stick"],
        ["Runtime", "60 min"],
        ["Includes", "All attachments + dock"],
      ],
    },
    {
      t: "Weber Q2200 Gas BBQ with Stand",
      p: 395,
      c: "LIKE_NEW",
      s: "HomeGoodsNZ",
      cat: "home-garden",
      sub: "BBQs & Outdoor",
      r: "Waikato",
      sb: "Hamilton",
      sh: "PICKUP",
      sp: null,
      o: false,
      im: "photo-1556909114-f6e7ad7d3136",
      d1: "Weber Q2200 premium gas BBQ with portable cart stand. Cast aluminium lid and body. Electronic ignition. Used for one summer only. Pickup from Hamilton.",
      a: [
        ["Brand", "Weber"],
        ["Model", "Q2200"],
        ["Fuel", "LPG Gas"],
        ["Cooking Area", "2,368 sq cm"],
        ["Includes", "Portable cart stand"],
      ],
    },
    {
      t: "KitchenAid Artisan Stand Mixer Red",
      p: 550,
      c: "GOOD",
      s: "HomeGoodsNZ",
      cat: "home-garden",
      sub: "Kitchen",
      r: "Waikato",
      sb: "Hamilton",
      sh: "COURIER",
      sp: 20,
      o: true,
      im: fallback("home-garden"),
      d1: "KitchenAid Artisan 4.8L stand mixer in Empire Red. 300W motor, 10 speeds, planetary mixing action. Includes flat beater, dough hook, and wire whip. A kitchen icon.",
      a: [
        ["Brand", "KitchenAid"],
        ["Model", "Artisan 5KSM175"],
        ["Colour", "Empire Red"],
        ["Capacity", "4.8L"],
        ["Motor", "300W"],
      ],
    },
    {
      t: "Breville Barista Express Espresso",
      p: 680,
      c: "GOOD",
      s: "HomeGoodsNZ",
      cat: "home-garden",
      sub: "Kitchen",
      r: "Waikato",
      sb: "Hamilton",
      sh: "COURIER",
      sp: 18,
      o: true,
      im: fallback("home-garden"),
      d1: "Breville Barista Express espresso machine in brushed stainless steel. Built-in conical burr grinder, steam wand, 54mm portafilter. Makes excellent flat whites.",
      a: [
        ["Brand", "Breville"],
        ["Model", "Barista Express BES870"],
        ["Colour", "Stainless Steel"],
        ["Grinder", "Conical Burr"],
        ["Portafilter", "54mm"],
      ],
    },
    {
      t: "Herman Miller Aeron Chair Size B",
      p: 1150,
      c: "GOOD",
      s: "HomeGoodsNZ",
      cat: "home-garden",
      sub: "Furniture",
      r: "Waikato",
      sb: "Hamilton",
      sh: "BOTH",
      sp: 30,
      o: true,
      im: "photo-1586023492125-27b2c045efd7",
      d1: "Herman Miller Aeron ergonomic office chair, size B (medium). PostureFit SL lumbar support, fully adjustable arms. Remastered version. The gold standard of office seating.",
      a: [
        ["Brand", "Herman Miller"],
        ["Model", "Aeron Remastered"],
        ["Size", "B (Medium)"],
        ["Colour", "Graphite"],
        ["Features", "PostureFit SL, adjustable arms"],
      ],
    },
    {
      t: "IKEA MALM Queen Bed Frame White",
      p: 180,
      c: "GOOD",
      s: "HomeGoodsNZ",
      cat: "home-garden",
      sub: "Furniture",
      r: "Waikato",
      sb: "Hamilton",
      sh: "PICKUP",
      sp: null,
      o: false,
      im: fallback("home-garden"),
      d1: "IKEA MALM queen bed frame in white with Luroy slatted bed base. Clean, no damage. Easy to disassemble for transport. Mattress not included. Pickup Hamilton.",
      a: [
        ["Brand", "IKEA"],
        ["Model", "MALM"],
        ["Size", "Queen"],
        ["Colour", "White"],
        ["Includes", "Luroy slat base"],
      ],
    },
    {
      t: "Philips Air Fryer XXL 7.3L",
      p: 180,
      c: "LIKE_NEW",
      s: "HomeGoodsNZ",
      cat: "home-garden",
      sub: "Kitchen",
      r: "Waikato",
      sb: "Hamilton",
      sh: "COURIER",
      sp: 15,
      o: false,
      im: fallback("home-garden"),
      d1: "Philips Premium Airfryer XXL with 7.3L capacity — cooks for the whole family. Rapid Air technology, fat removal technology. Digital display. Used a handful of times.",
      a: [
        ["Brand", "Philips"],
        ["Model", "HD9867 XXL"],
        ["Capacity", "7.3L"],
        ["Technology", "Rapid Air"],
        ["Display", "Digital touchscreen"],
      ],
    },
    {
      t: "Bosch Series 8 Dishwasher Stainless",
      p: 850,
      c: "GOOD",
      s: "HomeGoodsNZ",
      cat: "home-garden",
      sub: "Appliances",
      r: "Waikato",
      sb: "Hamilton",
      sh: "PICKUP",
      sp: null,
      o: true,
      im: fallback("home-garden"),
      d1: "Bosch Series 8 freestanding dishwasher in stainless steel. PerfectDry with Zeolith, 14 place settings, 44dB whisper quiet. Energy efficient. Pickup only.",
      a: [
        ["Brand", "Bosch"],
        ["Model", "SMS8YCI03E"],
        ["Capacity", "14 place settings"],
        ["Noise", "44dB"],
        ["Drying", "PerfectDry Zeolith"],
      ],
    },
    {
      t: "Husqvarna Automower 315 Robot Mower",
      p: 1200,
      c: "GOOD",
      s: "HomeGoodsNZ",
      cat: "home-garden",
      sub: "Garden & Landscaping",
      r: "Waikato",
      sb: "Hamilton",
      sh: "BOTH",
      sp: 25,
      o: true,
      im: fallback("home-garden"),
      d1: "Husqvarna Automower 315 robotic lawn mower. Handles up to 1,500 sqm, slopes up to 40%. Weather timer, GPS-assisted navigation. Includes charging station and boundary wire.",
      a: [
        ["Brand", "Husqvarna"],
        ["Model", "Automower 315"],
        ["Area", "Up to 1,500 sqm"],
        ["Slope", "Up to 40%"],
        ["Includes", "Charging station + wire"],
      ],
    },
    {
      t: "Le Creuset 28cm Dutch Oven Cerise",
      p: 320,
      c: "GOOD",
      s: "HomeGoodsNZ",
      cat: "home-garden",
      sub: "Kitchen",
      r: "Waikato",
      sb: "Hamilton",
      sh: "COURIER",
      sp: 15,
      o: false,
      im: fallback("home-garden"),
      d1: "Le Creuset Signature 28cm round Dutch oven in Cerise (cherry red). Cast iron with enamel coating. Perfect for slow cooking, soups, and bread baking. A lifetime piece.",
      a: [
        ["Brand", "Le Creuset"],
        ["Model", "Signature Round"],
        ["Size", "28cm / 6.7L"],
        ["Colour", "Cerise"],
        ["Material", "Enamelled Cast Iron"],
      ],
    },
    {
      t: "Dyson TP09 Purifier Cool Formaldehyde",
      p: 480,
      c: "LIKE_NEW",
      s: "HomeGoodsNZ",
      cat: "home-garden",
      sub: "Appliances",
      r: "Waikato",
      sb: "Hamilton",
      sh: "COURIER",
      sp: 18,
      o: false,
      im: fallback("home-garden"),
      d1: "Dyson Purifier Cool Formaldehyde TP09 in white/gold. HEPA H13 filter captures 99.97% of particles. Detects and destroys formaldehyde. App controlled. Whisper quiet.",
      a: [
        ["Brand", "Dyson"],
        ["Model", "TP09 Purifier Cool"],
        ["Filter", "HEPA H13"],
        ["Features", "Formaldehyde sensor"],
        ["Colour", "White/Gold"],
      ],
    },
    {
      t: "Smeg FAB28 Retro Fridge Pastel Green",
      p: 890,
      c: "GOOD",
      s: "HomeGoodsNZ",
      cat: "home-garden",
      sub: "Appliances",
      r: "Waikato",
      sb: "Hamilton",
      sh: "PICKUP",
      sp: null,
      o: true,
      im: fallback("home-garden"),
      d1: "Smeg FAB28 retro-style fridge in Pastel Green. 270L capacity, energy efficient A++ rating. Iconic 1950s design. Perfect statement piece for your kitchen. Pickup only.",
      a: [
        ["Brand", "Smeg"],
        ["Model", "FAB28RPG5"],
        ["Colour", "Pastel Green"],
        ["Capacity", "270L"],
        ["Energy Rating", "A++"],
      ],
    },
    {
      t: "Weber Genesis E-335 3-Burner Gas BBQ",
      p: 1450,
      c: "GOOD",
      s: "HomeGoodsNZ",
      cat: "home-garden",
      sub: "BBQs & Outdoor",
      r: "Waikato",
      sb: "Hamilton",
      sh: "PICKUP",
      sp: null,
      o: true,
      im: fallback("home-garden"),
      d1: "Weber Genesis E-335 3-burner gas BBQ with sear station and side burner. GS4 grilling system, 787 sq in cooking area. Assembled and ready. Pickup Hamilton.",
      a: [
        ["Brand", "Weber"],
        ["Model", "Genesis E-335"],
        ["Burners", "3 + Sear + Side"],
        ["Cooking Area", "787 sq in"],
        ["System", "GS4"],
      ],
    },
    {
      t: "Nespresso Vertuo Next Coffee Machine",
      p: 165,
      c: "LIKE_NEW",
      s: "HomeGoodsNZ",
      cat: "home-garden",
      sub: "Kitchen",
      r: "Waikato",
      sb: "Hamilton",
      sh: "COURIER",
      sp: 12,
      o: false,
      im: fallback("home-garden"),
      d1: "Nespresso Vertuo Next in matte black with Aeroccino3 milk frother. Centrifusion technology for perfect crema. Includes 12 sample capsules. Used for 2 months only.",
      a: [
        ["Brand", "Nespresso"],
        ["Model", "Vertuo Next + Aeroccino3"],
        ["Colour", "Matte Black"],
        ["Technology", "Centrifusion"],
        ["Includes", "12 capsules"],
      ],
    },
    {
      t: "Milwaukee M18 FUEL Circular Saw",
      p: 280,
      c: "GOOD",
      s: "HomeGoodsNZ",
      cat: "home-garden",
      sub: "Tools & Hardware",
      r: "Waikato",
      sb: "Hamilton",
      sh: "COURIER",
      sp: 12,
      o: true,
      im: fallback("home-garden"),
      d1: "Milwaukee M18 FUEL 184mm circular saw (skin only — no battery). Brushless motor, 5,800 RPM. Cuts through anything. Great condition, used on one renovation project.",
      a: [
        ["Brand", "Milwaukee"],
        ["Model", "M18 FUEL 2732-20"],
        ["Blade", "184mm"],
        ["RPM", "5,800"],
        ["Type", "Skin Only"],
      ],
    },
    {
      t: "Ecovacs Deebot T20 Omni Robot Vacuum",
      p: 380,
      c: "LIKE_NEW",
      s: "HomeGoodsNZ",
      cat: "home-garden",
      sub: "Appliances",
      r: "Waikato",
      sb: "Hamilton",
      sh: "COURIER",
      sp: 15,
      o: false,
      im: fallback("home-garden"),
      d1: "Ecovacs Deebot T20 Omni robot vacuum and mop with auto-empty station. Hot water mop washing, auto-lift mop for carpets. LiDAR navigation. Used for 3 months.",
      a: [
        ["Brand", "Ecovacs"],
        ["Model", "Deebot T20 Omni"],
        ["Features", "Vacuum + Mop"],
        ["Navigation", "LiDAR"],
        ["Station", "Auto-empty + hot wash"],
      ],
    },
    {
      t: "Outdoor 6-Seater Teak Dining Set",
      p: 520,
      c: "GOOD",
      s: "HomeGoodsNZ",
      cat: "home-garden",
      sub: "BBQs & Outdoor",
      r: "Waikato",
      sb: "Hamilton",
      sh: "PICKUP",
      sp: null,
      o: true,
      im: fallback("home-garden"),
      d1: "Solid teak outdoor dining set with 6 chairs and 180cm table. Weather resistant, ages beautifully. Some natural greying — can be oiled back to golden. Pickup only.",
      a: [
        ["Brand", "Unbranded"],
        ["Material", "Solid Teak"],
        ["Seats", "6"],
        ["Table Size", "180cm x 90cm"],
        ["Condition", "Natural patina"],
      ],
    },
    {
      t: "Bose SoundLink Flex Speaker Blue",
      p: 320,
      c: "LIKE_NEW",
      s: "HomeGoodsNZ",
      cat: "home-garden",
      sub: "Appliances",
      r: "Waikato",
      sb: "Hamilton",
      sh: "COURIER",
      sp: 12,
      o: false,
      im: fallback("home-garden"),
      d1: "Bose SoundLink Flex portable Bluetooth speaker in Stone Blue. IP67 waterproof, 12-hour battery, PositionIQ technology. Incredible sound for its size. Like new in box.",
      a: [
        ["Brand", "Bose"],
        ["Model", "SoundLink Flex"],
        ["Colour", "Stone Blue"],
        ["Waterproof", "IP67"],
        ["Battery", "12 hours"],
      ],
    },
    {
      t: "Miele Complete C3 Vacuum Cleaner",
      p: 480,
      c: "GOOD",
      s: "HomeGoodsNZ",
      cat: "home-garden",
      sub: "Appliances",
      r: "Waikato",
      sb: "Hamilton",
      sh: "COURIER",
      sp: 15,
      o: false,
      im: fallback("home-garden"),
      d1: "Miele Complete C3 Cat & Dog canister vacuum. 890W Vortex motor, AirClean HEPA filter, electrobrush for pet hair. German engineering at its finest. Serviced recently.",
      a: [
        ["Brand", "Miele"],
        ["Model", "Complete C3 Cat & Dog"],
        ["Motor", "890W Vortex"],
        ["Filter", "AirClean HEPA"],
        ["Features", "Electrobrush, turbo nozzle"],
      ],
    },
    {
      t: "Traeger Pro 575 Pellet Grill Black",
      p: 880,
      c: "GOOD",
      s: "HomeGoodsNZ",
      cat: "home-garden",
      sub: "BBQs & Outdoor",
      r: "Waikato",
      sb: "Hamilton",
      sh: "PICKUP",
      sp: null,
      o: true,
      im: fallback("home-garden"),
      d1: "Traeger Pro 575 WiFi pellet grill in black. WiFIRE connected, D2 drivetrain, 575 sq in cooking area. Smoke, grill, bake, roast, braise, and BBQ. Pickup Hamilton.",
      a: [
        ["Brand", "Traeger"],
        ["Model", "Pro 575"],
        ["Fuel", "Wood Pellets"],
        ["Cooking Area", "575 sq in"],
        ["Connectivity", "WiFIRE app"],
      ],
    },

    // ── SPORTS & OUTDOORS (15) ─── indices 65-79
    {
      t: "Specialized Allez Sprint 54cm 2023",
      p: 2100,
      c: "GOOD",
      s: "SpinningWellie",
      cat: "sports",
      sub: "Cycling",
      r: "Wellington",
      sb: "Karori",
      sh: "PICKUP",
      sp: null,
      o: true,
      im: "photo-1558980664-769d59546b3d",
      d1: "Specialized Allez Sprint Comp 54cm in gloss tarmac black. Shimano 105 Di2 groupset. Race-ready aluminium frame with carbon fork. Recently serviced.",
      a: [
        ["Brand", "Specialized"],
        ["Model", "Allez Sprint Comp"],
        ["Size", "54cm"],
        ["Groupset", "Shimano 105 Di2"],
        ["Frame", "Aluminium"],
      ],
    },
    {
      t: "Trek Domane SL6 Disc 56cm 2023",
      p: 2800,
      c: "GOOD",
      s: "ChchCycles",
      cat: "sports",
      sub: "Cycling",
      r: "Canterbury",
      sb: "Riccarton",
      sh: "PICKUP",
      sp: null,
      o: true,
      im: fallback("sports"),
      d1: "Trek Domane SL6 Disc 56cm in Crimson to Dark Aquatic fade. Full carbon frame, Shimano Ultegra groupset. IsoSpeed decoupler for smooth rides. Ready to race or tour.",
      a: [
        ["Brand", "Trek"],
        ["Model", "Domane SL6 Disc"],
        ["Size", "56cm"],
        ["Groupset", "Shimano Ultegra"],
        ["Frame", "Full Carbon"],
      ],
    },
    {
      t: "Giant Revolt Advanced 2 Gravel 54cm",
      p: 1450,
      c: "LIKE_NEW",
      s: "SpinningWellie",
      cat: "sports",
      sub: "Cycling",
      r: "Wellington",
      sb: "Karori",
      sh: "PICKUP",
      sp: null,
      o: true,
      im: fallback("sports"),
      d1: "Giant Revolt Advanced 2 gravel bike in Cold Iron colourway, 54cm. Advanced-grade composite frame, Shimano GRX 400 groupset. Tubeless ready. 4 rides only.",
      a: [
        ["Brand", "Giant"],
        ["Model", "Revolt Advanced 2"],
        ["Size", "54cm"],
        ["Groupset", "Shimano GRX 400"],
        ["Frame", "Advanced Composite"],
      ],
    },
    {
      t: "Cannondale Treadwell 2 City Bike M",
      p: 480,
      c: "LIKE_NEW",
      s: "ChchCycles",
      cat: "sports",
      sub: "Cycling",
      r: "Canterbury",
      sb: "Riccarton",
      sh: "PICKUP",
      sp: null,
      o: false,
      im: fallback("sports"),
      d1: "Cannondale Treadwell 2 fitness hybrid in alpine, size medium. Lightweight SmartForm C3 aluminium, microSHIFT 8-speed. Perfect commuter bike. Like new condition.",
      a: [
        ["Brand", "Cannondale"],
        ["Model", "Treadwell 2"],
        ["Size", "Medium"],
        ["Gears", "8-speed microSHIFT"],
        ["Frame", "SmartForm C3 Alloy"],
      ],
    },
    {
      t: "Patagonia Black Hole 55L Duffel Bag",
      p: 155,
      c: "GOOD",
      s: "NorthlandFinds",
      cat: "sports",
      sub: "Bags & Packs",
      r: "Northland",
      sb: "Whangarei",
      sh: "COURIER",
      sp: 12,
      o: false,
      im: fallback("sports"),
      d1: "Patagonia Black Hole 55L duffel bag in black. Recycled polyester ripstop, weather resistant. Backpack straps, multiple pockets. Built to last. Well-used but solid.",
      a: [
        ["Brand", "Patagonia"],
        ["Model", "Black Hole Duffel 55L"],
        ["Colour", "Black"],
        ["Material", "Recycled Polyester"],
        ["Features", "Backpack straps"],
      ],
    },
    {
      t: "Macpac Zenith 65L Tramping Pack",
      p: 280,
      c: "GOOD",
      s: "SpinningWellie",
      cat: "sports",
      sub: "Camping & Hiking",
      r: "Wellington",
      sb: "Karori",
      sh: "COURIER",
      sp: 12,
      o: true,
      im: fallback("sports"),
      d1: "Macpac Zenith 65L tramping pack in carbon. NZ-designed for multi-day tramps. AzTec 210D ripstop, adjustable torso length, rain cover included. Solid condition.",
      a: [
        ["Brand", "Macpac"],
        ["Model", "Zenith 65L"],
        ["Colour", "Carbon"],
        ["Material", "AzTec 210D"],
        ["Includes", "Rain cover"],
      ],
    },
    {
      t: "Rip Curl E-Bomb 3/2mm Wetsuit M",
      p: 195,
      c: "GOOD",
      s: "NorthlandFinds",
      cat: "sports",
      sub: "Water Sports",
      r: "Northland",
      sb: "Whangarei",
      sh: "COURIER",
      sp: 12,
      o: false,
      im: fallback("sports"),
      d1: "Rip Curl E-Bomb 3/2mm chest zip wetsuit in black, men's medium. E5 Flash Lining for warmth. Great for NZ spring/summer surfing. No tears, sealed seams intact.",
      a: [
        ["Brand", "Rip Curl"],
        ["Model", "E-Bomb 3/2mm"],
        ["Size", "Medium"],
        ["Entry", "Chest Zip"],
        ["Lining", "E5 Flash"],
      ],
    },
    {
      t: "Torq 7ft6 Mini Mal Surfboard White",
      p: 420,
      c: "GOOD",
      s: "NorthlandFinds",
      cat: "sports",
      sub: "Water Sports",
      r: "Northland",
      sb: "Whangarei",
      sh: "PICKUP",
      sp: null,
      o: true,
      im: fallback("sports"),
      d1: "Torq 7'6\" TET Mini Mal surfboard in white. Epoxy construction, durable and lightweight. Great for intermediate surfers. Small ding on rail, professionally repaired.",
      a: [
        ["Brand", "Torq"],
        ["Model", "TET Mini Mal"],
        ["Length", "7'6\""],
        ["Construction", "Epoxy"],
        ["Fin Setup", "Thruster (FCS II)"],
      ],
    },
    {
      t: "Shimano Ultegra R8000 Groupset 11s",
      p: 680,
      c: "GOOD",
      s: "SpinningWellie",
      cat: "sports",
      sub: "Cycling",
      r: "Wellington",
      sb: "Karori",
      sh: "COURIER",
      sp: 15,
      o: true,
      im: fallback("sports"),
      d1: "Complete Shimano Ultegra R8000 mechanical groupset — 11-speed. Includes shifters, front and rear derailleurs, crankset (172.5mm, 50/34), cassette 11-28, chain, and brake callipers.",
      a: [
        ["Brand", "Shimano"],
        ["Model", "Ultegra R8000"],
        ["Speed", "11-speed"],
        ["Crank", "172.5mm 50/34"],
        ["Type", "Complete groupset"],
      ],
    },
    {
      t: "Garmin Edge 840 Cycling Computer",
      p: 380,
      c: "LIKE_NEW",
      s: "ChchCycles",
      cat: "sports",
      sub: "Cycling",
      r: "Canterbury",
      sb: "Riccarton",
      sh: "COURIER",
      sp: 9,
      o: false,
      im: fallback("sports"),
      d1: "Garmin Edge 840 GPS cycling computer with touchscreen and buttons. Multi-band GPS, ClimbPro, training status. Includes mounts, sensors, and charging cable.",
      a: [
        ["Brand", "Garmin"],
        ["Model", "Edge 840"],
        ["Display", '2.6" touchscreen'],
        ["GPS", "Multi-band"],
        ["Includes", "Speed/cadence sensors"],
      ],
    },
    {
      t: "Sea to Summit Spark III Sleeping Bag",
      p: 280,
      c: "LIKE_NEW",
      s: "NorthlandFinds",
      cat: "sports",
      sub: "Camping & Hiking",
      r: "Northland",
      sb: "Whangarei",
      sh: "COURIER",
      sp: 12,
      o: false,
      im: fallback("sports"),
      d1: "Sea to Summit Spark III 850-loft down sleeping bag. Comfort rating -1°C, regular size. Ultralight at 740g. Perfect for NZ alpine tramping. Used twice, stored uncompressed.",
      a: [
        ["Brand", "Sea to Summit"],
        ["Model", "Spark SpIII"],
        ["Fill", "850+ Loft Down"],
        ["Rating", "-1°C Comfort"],
        ["Weight", "740g"],
      ],
    },
    {
      t: "Salomon XT-6 Trail Shoes M10 Black",
      p: 165,
      c: "GOOD",
      s: "SpinningWellie",
      cat: "sports",
      sub: "Running & Fitness",
      r: "Wellington",
      sb: "Karori",
      sh: "COURIER",
      sp: 9,
      o: false,
      im: fallback("sports"),
      d1: "Salomon XT-6 ADV in black/phantom, men's 10. Advanced Chassis for stability on technical terrain. Contagrip MA outsole. Great dual-purpose trail/street shoe.",
      a: [
        ["Brand", "Salomon"],
        ["Model", "XT-6 ADV"],
        ["Size", "M10"],
        ["Colour", "Black/Phantom"],
        ["Outsole", "Contagrip MA"],
      ],
    },
    {
      t: "Hydro Flask 32oz Wide Mouth Agave",
      p: 45,
      c: "LIKE_NEW",
      s: "ChchCycles",
      cat: "sports",
      sub: "Camping & Hiking",
      r: "Canterbury",
      sb: "Riccarton",
      sh: "COURIER",
      sp: 6,
      o: false,
      im: fallback("sports"),
      d1: "Hydro Flask 32oz wide mouth insulated bottle in Agave. TempShield double-wall vacuum insulation. Keeps cold 24hrs, hot 12hrs. No dents. Flex Cap included.",
      a: [
        ["Brand", "Hydro Flask"],
        ["Model", "32oz Wide Mouth"],
        ["Colour", "Agave"],
        ["Insulation", "TempShield Vacuum"],
        ["Keeps Cold", "24 hours"],
      ],
    },
    {
      t: "TaylorMade SIM2 Driver 10.5 Stiff",
      p: 280,
      c: "GOOD",
      s: "NorthlandFinds",
      cat: "sports",
      sub: "Golf",
      r: "Northland",
      sb: "Whangarei",
      sh: "COURIER",
      sp: 12,
      o: true,
      im: fallback("sports"),
      d1: "TaylorMade SIM2 Max driver with 10.5° loft and stiff flex Fujikura Ventus shaft. Forged aluminium ring with carbon sole. Great distance and forgiveness off the tee.",
      a: [
        ["Brand", "TaylorMade"],
        ["Model", "SIM2 Max Driver"],
        ["Loft", "10.5°"],
        ["Shaft", "Fujikura Ventus Stiff"],
        ["Headcover", "Included"],
      ],
    },
    {
      t: "Bowflex SelectTech 552 Dumbbells Pair",
      p: 380,
      c: "GOOD",
      s: "SpinningWellie",
      cat: "sports",
      sub: "Running & Fitness",
      r: "Wellington",
      sb: "Karori",
      sh: "BOTH",
      sp: 20,
      o: true,
      im: fallback("sports"),
      d1: "Bowflex SelectTech 552 adjustable dumbbells — pair. Each adjusts from 2.3kg to 23.8kg in 15 increments. Replaces 15 sets of weights. Space-saving home gym essential.",
      a: [
        ["Brand", "Bowflex"],
        ["Model", "SelectTech 552"],
        ["Weight Range", "2.3-23.8kg each"],
        ["Increments", "15"],
        ["Quantity", "Pair"],
      ],
    },

    // ── BABY & KIDS (10) ─── indices 80-89
    {
      t: "Bugaboo Fox 5 Complete Pram Black",
      p: 850,
      c: "LIKE_NEW",
      s: "KidsStuffNZ",
      cat: "baby-kids",
      sub: "Baby Gear",
      r: "Auckland",
      sb: "Newmarket",
      sh: "COURIER",
      sp: 25,
      o: true,
      im: fallback("baby-kids"),
      d1: "Bugaboo Fox 5 complete pram in Midnight Black. Bassinet and toddler seat included. All-terrain wheels, one-hand fold. Used for 6 months only. Immaculate condition.",
      a: [
        ["Brand", "Bugaboo"],
        ["Model", "Fox 5"],
        ["Colour", "Midnight Black"],
        ["Includes", "Bassinet + seat"],
        ["Condition", "Immaculate"],
      ],
    },
    {
      t: "Baby Jogger City Mini GT2 Navy",
      p: 580,
      c: "GOOD",
      s: "KidsStuffNZ",
      cat: "baby-kids",
      sub: "Baby Gear",
      r: "Auckland",
      sb: "Newmarket",
      sh: "COURIER",
      sp: 20,
      o: true,
      im: fallback("baby-kids"),
      d1: "Baby Jogger City Mini GT2 all-terrain stroller in Windsor Navy. Forever Air rubber tyres, one-hand fold, UV 50+ canopy. Great for NZ walks and trails.",
      a: [
        ["Brand", "Baby Jogger"],
        ["Model", "City Mini GT2"],
        ["Colour", "Windsor Navy"],
        ["Tyres", "Forever Air Rubber"],
        ["Fold", "One-hand"],
      ],
    },
    {
      t: "BabyBjorn Bouncer Bliss Anthracite",
      p: 145,
      c: "LIKE_NEW",
      s: "KidsStuffNZ",
      cat: "baby-kids",
      sub: "Baby Gear",
      r: "Auckland",
      sb: "Newmarket",
      sh: "COURIER",
      sp: 9,
      o: false,
      im: "photo-1515488042361-ee00e0ddd4e4",
      d1: "BabyBjorn Bouncer Bliss in Anthracite mesh. Natural bouncing powered by baby's movements — no batteries needed. Machine washable seat. From 3.5kg to 13kg.",
      a: [
        ["Brand", "BabyBjorn"],
        ["Model", "Bouncer Bliss"],
        ["Colour", "Anthracite"],
        ["Material", "Mesh"],
        ["Weight Range", "3.5-13kg"],
      ],
    },
    {
      t: "LEGO Technic Bugatti Bolide 42151",
      p: 85,
      c: "NEW",
      s: "KidsStuffNZ",
      cat: "baby-kids",
      sub: "Toys & Games",
      r: "Auckland",
      sb: "Newmarket",
      sh: "COURIER",
      sp: 7,
      o: false,
      im: "photo-1587654780291-39c9404d746b",
      d1: "LEGO Technic Bugatti Bolide 42151 — brand new, factory sealed. 905 pieces, ages 9+. Authentic Bugatti details with W16 engine, rear spoiler, and racing colours.",
      a: [
        ["Brand", "LEGO"],
        ["Set", "Technic Bugatti Bolide"],
        ["Number", "42151"],
        ["Pieces", "905"],
        ["Condition", "New Sealed"],
      ],
    },
    {
      t: "LEGO Icons Eiffel Tower 10307",
      p: 320,
      c: "NEW",
      s: "KidsStuffNZ",
      cat: "baby-kids",
      sub: "Toys & Games",
      r: "Auckland",
      sb: "Newmarket",
      sh: "COURIER",
      sp: 12,
      o: false,
      im: fallback("baby-kids"),
      d1: "LEGO Icons Eiffel Tower 10307 — brand new, factory sealed. 10,001 pieces, the ultimate display model. Over 1.5m tall when complete. Incredible build experience.",
      a: [
        ["Brand", "LEGO"],
        ["Set", "Icons Eiffel Tower"],
        ["Number", "10307"],
        ["Pieces", "10,001"],
        ["Height", "150cm"],
      ],
    },
    {
      t: "Stokke Tripp Trapp High Chair Oak",
      p: 280,
      c: "GOOD",
      s: "KidsStuffNZ",
      cat: "baby-kids",
      sub: "Nursery Furniture",
      r: "Auckland",
      sb: "Newmarket",
      sh: "COURIER",
      sp: 15,
      o: true,
      im: fallback("baby-kids"),
      d1: "Stokke Tripp Trapp high chair in natural oak. Grows with your child from 6 months to adult. European beech wood. Includes baby set and harness. Minor wear marks.",
      a: [
        ["Brand", "Stokke"],
        ["Model", "Tripp Trapp"],
        ["Colour", "Natural Oak"],
        ["Material", "European Beech"],
        ["Includes", "Baby set + harness"],
      ],
    },
    {
      t: "Nanit Pro Smart Baby Monitor Camera",
      p: 280,
      c: "LIKE_NEW",
      s: "KidsStuffNZ",
      cat: "baby-kids",
      sub: "Baby Gear",
      r: "Auckland",
      sb: "Newmarket",
      sh: "COURIER",
      sp: 9,
      o: false,
      im: fallback("baby-kids"),
      d1: "Nanit Pro smart baby monitor with wall mount and floor stand. 1080p HD video, sleep tracking, breathing wear compatibility. 2-way audio, night vision. Used for 4 months.",
      a: [
        ["Brand", "Nanit"],
        ["Model", "Pro Camera"],
        ["Resolution", "1080p HD"],
        ["Features", "Sleep tracking, 2-way audio"],
        ["Includes", "Wall mount + floor stand"],
      ],
    },
    {
      t: "Little Tikes Cozy Coupe Classic Car",
      p: 65,
      c: "GOOD",
      s: "KidsStuffNZ",
      cat: "baby-kids",
      sub: "Toys & Games",
      r: "Auckland",
      sb: "Newmarket",
      sh: "BOTH",
      sp: 15,
      o: false,
      im: fallback("baby-kids"),
      d1: "Little Tikes Cozy Coupe classic ride-on car in red and yellow. Ages 1.5 to 5 years. Removable floor board, working horn. Some outdoor wear but fully functional and fun.",
      a: [
        ["Brand", "Little Tikes"],
        ["Model", "Cozy Coupe"],
        ["Ages", "1.5-5 years"],
        ["Colour", "Red/Yellow"],
        ["Features", "Removable floor, horn"],
      ],
    },
    {
      t: "Kids Bike 20 inch with Training Wheels",
      p: 95,
      c: "GOOD",
      s: "KidsStuffNZ",
      cat: "baby-kids",
      sub: "Toys & Games",
      r: "Auckland",
      sb: "Newmarket",
      sh: "BOTH",
      sp: 12,
      o: false,
      im: fallback("baby-kids"),
      d1: "Children's 20-inch bike with removable training wheels, suitable for ages 6-9. Shimano 6-speed gears, V-brakes, kickstand. Blue with flame decals. Ready to ride.",
      a: [
        ["Size", "20 inch"],
        ["Ages", "6-9 years"],
        ["Gears", "Shimano 6-speed"],
        ["Brakes", "V-brakes"],
        ["Includes", "Training wheels"],
      ],
    },
    {
      t: "Fisher-Price Deluxe Kick n Play Piano",
      p: 45,
      c: "GOOD",
      s: "KidsStuffNZ",
      cat: "baby-kids",
      sub: "Baby Gear",
      r: "Auckland",
      sb: "Newmarket",
      sh: "COURIER",
      sp: 9,
      o: false,
      im: fallback("baby-kids"),
      d1: "Fisher-Price Deluxe Kick n Play Piano gym. 4 ways to play, musical piano with lights, soft playmat. From newborn to toddler. Battery operated. Great condition, cleaned.",
      a: [
        ["Brand", "Fisher-Price"],
        ["Model", "Deluxe Kick n Play"],
        ["Ages", "Newborn+"],
        ["Features", "4 play positions, music, lights"],
        ["Power", "Battery"],
      ],
    },

    // ── COLLECTIBLES (10) ─── indices 100-109
    {
      t: "All Blacks 2023 RWC Signed Jersey",
      p: 750,
      c: "NEW",
      s: "RubyVault",
      cat: "collectibles",
      sub: "Sports Memorabilia",
      r: "Auckland",
      sb: "Eden Terrace",
      sh: "COURIER",
      sp: 12,
      o: false,
      im: "photo-1566577739112-5180d4bf9390",
      d1: "Official All Blacks 2023 Rugby World Cup jersey signed by the full squad. Frame-ready condition. Comes with Certificate of Authenticity from NZRU. A piece of NZ rugby history.",
      a: [
        ["Team", "All Blacks"],
        ["Event", "2023 RWC"],
        ["Signed By", "Full Squad"],
        ["Authentication", "NZRU COA"],
        ["Condition", "New, unframed"],
      ],
    },
    {
      t: "All Blacks 2011 RWC Champions Jersey",
      p: 950,
      c: "GOOD",
      s: "RubyVault",
      cat: "collectibles",
      sub: "Sports Memorabilia",
      r: "Auckland",
      sb: "Eden Terrace",
      sh: "COURIER",
      sp: 12,
      o: false,
      im: fallback("collectibles"),
      d1: "All Blacks 2011 Rugby World Cup Champions jersey signed by Richie McCaw, Dan Carter, and Ma'a Nonu. Framed with COA. The year NZ finally won it again on home soil.",
      a: [
        ["Team", "All Blacks"],
        ["Event", "2011 RWC"],
        ["Signed By", "McCaw, Carter, Nonu"],
        ["Authentication", "COA included"],
        ["Display", "Professionally framed"],
      ],
    },
    {
      t: "Richie McCaw Signed Photo Framed",
      p: 280,
      c: "GOOD",
      s: "RubyVault",
      cat: "collectibles",
      sub: "Sports Memorabilia",
      r: "Auckland",
      sb: "Eden Terrace",
      sh: "COURIER",
      sp: 12,
      o: false,
      im: fallback("collectibles"),
      d1: "Richie McCaw signed 16x20 photo lifting the Webb Ellis Cup in 2011. Professionally framed with plaque. Certificate of Authenticity included. A must for any rugby fan.",
      a: [
        ["Subject", "Richie McCaw"],
        ["Size", "16x20 inches"],
        ["Authentication", "COA included"],
        ["Display", "Framed with plaque"],
        ["Event", "2011 RWC Final"],
      ],
    },
    {
      t: "Jonah Lomu Signed All Blacks Card",
      p: 450,
      c: "GOOD",
      s: "RubyVault",
      cat: "collectibles",
      sub: "Sports Memorabilia",
      r: "Auckland",
      sb: "Eden Terrace",
      sh: "COURIER",
      sp: 8,
      o: false,
      im: fallback("collectibles"),
      d1: "Jonah Lomu signed trading card — authenticated and slabbed. The greatest winger to play the game. Extremely rare signed item. PSA/DNA authenticated.",
      a: [
        ["Subject", "Jonah Lomu"],
        ["Type", "Signed Trading Card"],
        ["Authentication", "PSA/DNA"],
        ["Condition", "Slabbed"],
        ["Rarity", "Rare"],
      ],
    },
    {
      t: "1987 RWC All Blacks Team Signed Ball",
      p: 680,
      c: "GOOD",
      s: "RubyVault",
      cat: "collectibles",
      sub: "Sports Memorabilia",
      r: "Auckland",
      sb: "Eden Terrace",
      sh: "COURIER",
      sp: 15,
      o: true,
      im: fallback("collectibles"),
      d1: "Match ball from the inaugural 1987 Rugby World Cup signed by the champion All Blacks team. Includes David Kirk, Grant Fox, Sean Fitzpatrick. Display case included.",
      a: [
        ["Team", "All Blacks"],
        ["Event", "1987 RWC (Inaugural)"],
        ["Signed By", "Full Team"],
        ["Display", "Glass case included"],
        ["Key Signatures", "Kirk, Fox, Fitzpatrick"],
      ],
    },
    {
      t: "Pounamu Koru Pendant Sterling Silver",
      p: 320,
      c: "GOOD",
      s: "TaongaTreasures",
      cat: "collectibles",
      sub: "Jewellery & Watches",
      r: "Otago",
      sb: "Dunedin",
      sh: "COURIER",
      sp: 8,
      o: false,
      im: "photo-1605100804763-247f67b3557e",
      d1: "Hand-carved NZ pounamu (greenstone) Koru pendant on sterling silver chain. Sourced from the West Coast of the South Island. Symbolises new beginnings and growth.",
      a: [
        ["Material", "NZ Pounamu"],
        ["Setting", "Sterling Silver"],
        ["Symbol", "Koru (new life)"],
        ["Origin", "West Coast, South Island"],
        ["Carver", "Local artisan"],
      ],
    },
    {
      t: "Vintage NZ Postage Stamps Collection",
      p: 180,
      c: "GOOD",
      s: "TaongaTreasures",
      cat: "collectibles",
      sub: "Coins & Stamps",
      r: "Otago",
      sb: "Dunedin",
      sh: "COURIER",
      sp: 6,
      o: true,
      im: fallback("collectibles"),
      d1: "Collection of 200+ vintage NZ postage stamps spanning 1940s to 1980s. Includes several first-day covers and commemorative issues. Organised in stock book.",
      a: [
        ["Type", "NZ Postage Stamps"],
        ["Period", "1940s-1980s"],
        ["Quantity", "200+"],
        ["Includes", "First-day covers"],
        ["Storage", "Stock book"],
      ],
    },
    {
      t: "Pounamu Toki Adze Carving Pendant",
      p: 480,
      c: "GOOD",
      s: "TaongaTreasures",
      cat: "collectibles",
      sub: "Art",
      r: "Otago",
      sb: "Dunedin",
      sh: "COURIER",
      sp: 9,
      o: false,
      im: fallback("collectibles"),
      d1: "Hand-carved pounamu Toki (adze) pendant on waxed cord. Deep green Inanga pounamu from Westland. The Toki represents strength and determination. Museum-quality carving.",
      a: [
        ["Material", "Inanga Pounamu"],
        ["Symbol", "Toki (strength)"],
        ["Origin", "Westland"],
        ["Cord", "Waxed cotton"],
        ["Quality", "Museum grade"],
      ],
    },
    {
      t: "NZ Pre-Decimal Coin Collection 1930-65",
      p: 220,
      c: "GOOD",
      s: "TaongaTreasures",
      cat: "collectibles",
      sub: "Coins & Stamps",
      r: "Otago",
      sb: "Dunedin",
      sh: "COURIER",
      sp: 6,
      o: true,
      im: fallback("collectibles"),
      d1: "NZ pre-decimal coin collection from 1930s to 1965. Includes halfpennies, pennies, threepence, sixpence, shillings, florins, half-crowns, and crowns. 50+ coins in album.",
      a: [
        ["Type", "NZ Pre-decimal Coins"],
        ["Period", "1930s-1965"],
        ["Quantity", "50+ coins"],
        ["Includes", "Multiple denominations"],
        ["Storage", "Coin album"],
      ],
    },
    {
      t: "Vintage Maori Carved Tiki Pendant",
      p: 380,
      c: "GOOD",
      s: "TaongaTreasures",
      cat: "collectibles",
      sub: "Antiques",
      r: "Otago",
      sb: "Dunedin",
      sh: "COURIER",
      sp: 9,
      o: false,
      im: fallback("collectibles"),
      d1: "Vintage carved bone Tiki pendant, estimated 1950s-60s. Traditional Hei-Tiki form representing the ancestor. Beautiful patina from age. A genuine taonga.",
      a: [
        ["Material", "Bone"],
        ["Style", "Hei-Tiki"],
        ["Estimated Age", "1950s-60s"],
        ["Significance", "Ancestor figure"],
        ["Type", "Vintage taonga"],
      ],
    },

    // ── BUSINESS & INDUSTRIAL (5) ─── indices 110-114
    {
      t: "Makita 18V LXT 10-Piece Combo Kit",
      p: 899,
      c: "NEW",
      s: "ProToolsChch",
      cat: "business",
      sub: "Power Tools",
      r: "Canterbury",
      sb: "Hornby",
      sh: "COURIER",
      sp: 15,
      o: true,
      im: "photo-1572981779307-38b8cabb2407",
      d1: "Makita 18V LXT 10-piece cordless combo kit — brand new in box. Includes hammer drill, impact driver, circular saw, recipro saw, grinder, and more. 4x 5.0Ah batteries.",
      a: [
        ["Brand", "Makita"],
        ["System", "18V LXT"],
        ["Pieces", "10 tools"],
        ["Batteries", "4x 5.0Ah"],
        ["Condition", "New in box"],
      ],
    },
    {
      t: "DeWalt 20V MAX XR 10-Piece Combo",
      p: 780,
      c: "GOOD",
      s: "ProToolsChch",
      cat: "business",
      sub: "Power Tools",
      r: "Canterbury",
      sb: "Hornby",
      sh: "COURIER",
      sp: 15,
      o: true,
      im: fallback("business"),
      d1: "DeWalt 20V MAX XR brushless 10-piece combo kit. Impact driver, drill, circular saw, grinder, oscillating tool, and more. 3x 5.0Ah batteries. Used on one residential build.",
      a: [
        ["Brand", "DeWalt"],
        ["System", "20V MAX XR"],
        ["Pieces", "10 tools"],
        ["Batteries", "3x 5.0Ah"],
        ["Motor", "Brushless"],
      ],
    },
    {
      t: "Milwaukee M18 FUEL 8-Piece Combo Kit",
      p: 1150,
      c: "LIKE_NEW",
      s: "ProToolsChch",
      cat: "business",
      sub: "Power Tools",
      r: "Canterbury",
      sb: "Hornby",
      sh: "COURIER",
      sp: 18,
      o: true,
      im: fallback("business"),
      d1: "Milwaukee M18 FUEL 8-piece combo kit. POWERSTATE brushless motors, REDLINK PLUS intelligence. Includes hammer drill, impact driver, circular saw, grinder, and more.",
      a: [
        ["Brand", "Milwaukee"],
        ["System", "M18 FUEL"],
        ["Pieces", "8 tools"],
        ["Technology", "POWERSTATE Brushless"],
        ["Batteries", "3x 6.0Ah HIGH OUTPUT"],
      ],
    },
    {
      t: "Festool Kapex KS 120 Sliding Compound",
      p: 1450,
      c: "GOOD",
      s: "ProToolsChch",
      cat: "business",
      sub: "Power Tools",
      r: "Canterbury",
      sb: "Hornby",
      sh: "BOTH",
      sp: 25,
      o: true,
      im: fallback("business"),
      d1: "Festool Kapex KS 120 EB sliding compound mitre saw. Dual laser line, adjustable speed, dust extraction. The benchmark for precision cutting. Well maintained, calibrated.",
      a: [
        ["Brand", "Festool"],
        ["Model", "Kapex KS 120 EB"],
        ["Cut Capacity", "305mm crosscut"],
        ["Features", "Dual laser, variable speed"],
        ["Dust Extraction", "Integrated"],
      ],
    },
    {
      t: "Industrial Steel Shelving 5-Bay Unit",
      p: 380,
      c: "GOOD",
      s: "ProToolsChch",
      cat: "business",
      sub: "Industrial Equipment",
      r: "Canterbury",
      sb: "Hornby",
      sh: "PICKUP",
      sp: null,
      o: true,
      im: fallback("business"),
      d1: "Heavy-duty industrial steel shelving — 5-bay longspan unit. Each shelf holds 300kg. Powder-coated grey finish. 2.4m high x 6m wide. Easy bolt-together assembly. Pickup only.",
      a: [
        ["Material", "Steel"],
        ["Bays", "5"],
        ["Shelf Capacity", "300kg each"],
        ["Dimensions", "2.4m H x 6m W"],
        ["Finish", "Powder-coated Grey"],
      ],
    },

    // ── PROPERTY (5) ─── indices 115-119
    {
      t: "2BR Furnished Apartment Wynyard Quarter",
      p: 2800,
      c: "GOOD",
      s: "BayPropertyNZ",
      cat: "property",
      sub: "Rentals",
      r: "Auckland",
      sb: "Wynyard Quarter",
      sh: "PICKUP",
      sp: null,
      o: false,
      im: "photo-1502672260266-1c1ef2d93688",
      d1: "Fully furnished 2-bedroom apartment in Wynyard Quarter, Auckland CBD. Ocean views, modern kitchen, secure parking. Walking distance to Viaduct and Britomart. $2,800 per month.",
      a: [
        ["Bedrooms", "2"],
        ["Furnished", "Yes"],
        ["Parking", "1 secure space"],
        ["Location", "Wynyard Quarter CBD"],
        ["Rent", "$2,800/month"],
      ],
    },
    {
      t: "1BR Modern Flat Te Aro Wellington",
      p: 1950,
      c: "GOOD",
      s: "BayPropertyNZ",
      cat: "property",
      sub: "Rentals",
      r: "Wellington",
      sb: "Te Aro",
      sh: "PICKUP",
      sp: null,
      o: false,
      im: fallback("property"),
      d1: "Modern 1-bedroom flat in the heart of Te Aro, Wellington. Open plan living, heat pump, double glazing. Close to Cuba Street and waterfront. $1,950 per month includes water.",
      a: [
        ["Bedrooms", "1"],
        ["Heating", "Heat pump"],
        ["Insulation", "Double glazed"],
        ["Location", "Te Aro"],
        ["Rent", "$1,950/month"],
      ],
    },
    {
      t: "3BR Family House Merivale Christchurch",
      p: 2400,
      c: "GOOD",
      s: "BayPropertyNZ",
      cat: "property",
      sub: "Rentals",
      r: "Canterbury",
      sb: "Merivale",
      sh: "PICKUP",
      sp: null,
      o: false,
      im: fallback("property"),
      d1: "Spacious 3-bedroom family home in Merivale, Christchurch. New kitchen, two bathrooms, single garage, fenced backyard. Zoned for Merivale School. $2,400 per month.",
      a: [
        ["Bedrooms", "3"],
        ["Bathrooms", "2"],
        ["Garage", "Single"],
        ["Section", "Fenced"],
        ["Rent", "$2,400/month"],
      ],
    },
    {
      t: "Studio Apartment Mount Maunganui",
      p: 1650,
      c: "GOOD",
      s: "BayPropertyNZ",
      cat: "property",
      sub: "Rentals",
      r: "Bay of Plenty",
      sb: "Mount Maunganui",
      sh: "PICKUP",
      sp: null,
      o: false,
      im: fallback("property"),
      d1: "Sunny studio apartment at the base of the Mount. 200m walk to beach. Kitchenette, bathroom, balcony with ocean glimpses. Perfect lock-and-leave. $1,650 per month.",
      a: [
        ["Type", "Studio"],
        ["Beach", "200m walk"],
        ["Features", "Balcony, ocean glimpses"],
        ["Location", "Mount Maunganui base"],
        ["Rent", "$1,650/month"],
      ],
    },
    {
      t: "2BR Townhouse Hamilton Central",
      p: 1850,
      c: "GOOD",
      s: "BayPropertyNZ",
      cat: "property",
      sub: "Rentals",
      r: "Waikato",
      sb: "Hamilton",
      sh: "PICKUP",
      sp: null,
      o: false,
      im: fallback("property"),
      d1: "Modern 2-bedroom townhouse in Hamilton CBD. Open plan living, internal garage, courtyard garden. Walk to Hamilton Gardens and river paths. $1,850 per month.",
      a: [
        ["Bedrooms", "2"],
        ["Garage", "Internal single"],
        ["Features", "Courtyard garden"],
        ["Location", "Hamilton CBD"],
        ["Rent", "$1,850/month"],
      ],
    },
  ];

  // Create all listings
  type LR = {
    id: string;
    sellerId: string;
    priceNzd: number;
    shippingNzd: number | null;
    title: string;
  };
  const lr: LR[] = [];
  const now = new Date();
  const _in30d = new Date(now.getTime() + 30 * 86_400_000);

  for (let i = 0; i < listings.length; i++) {
    const l = listings[i]!;
    const dAgo = randomInt(5, 85);
    const created = daysAgo(dAgo);
    const published = created;
    const expires = new Date(published.getTime() + 30 * 86_400_000);
    const sellerId = uid[l.s]!;
    const priceNzd = $(l.p);
    const shippingNzd = l.sp != null ? $(l.sp) : null;

    const listing = await prisma.listing.create({
      data: {
        sellerId,
        title: l.t,
        description: makeDesc(l.cat, l.d1),
        priceNzd,
        condition: l.c,
        status: "ACTIVE",
        categoryId: l.cat,
        subcategoryName: l.sub,
        region: l.r,
        suburb: l.sb,
        shippingOption: l.sh,
        shippingNzd,
        offersEnabled: l.o,
        viewCount: randomInt(50, 2000),
        watcherCount: randomInt(5, 150),
        publishedAt: published,
        expiresAt: expires,
        createdAt: created,
        images: {
          create: {
            r2Key: img(l.im),
            altText: l.t,
            order: 0,
            scanned: true,
            safe: true,
            scannedAt: created,
            width: 800,
            height: 600,
          },
        },
        attrs: {
          create: l.a.map(([label, value], idx) => ({
            label,
            value,
            order: idx,
          })),
        },
      },
    });
    lr.push({ id: listing.id, sellerId, priceNzd, shippingNzd, title: l.t });

    if ((i + 1) % 30 === 0) console.log(`   ... ${i + 1} listings`);
  }
  console.log(`✅ ${lr.length} listings created`);

  // ═══════════════════════════════════════════════════════════════════════════
  // ORDERS (35)
  // ═══════════════════════════════════════════════════════════════════════════

  type OD = {
    buyerKey: string;
    listingIdx: number;
    status: string;
    completedDaysAgo?: number;
    dispatchedDaysAgo?: number;
    tracking?: string;
  };

  const orderDefs: OD[] = [
    // Jane (8)
    {
      buyerKey: "jane_smith",
      listingIdx: 2,
      status: "COMPLETED",
      completedDaysAgo: 45,
      tracking: "NZ-COURIER-93847561",
    },
    {
      buyerKey: "jane_smith",
      listingIdx: 28,
      status: "COMPLETED",
      completedDaysAgo: 30,
      tracking: "NZPOST-77432891",
    },
    {
      buyerKey: "jane_smith",
      listingIdx: 93,
      status: "DISPATCHED",
      dispatchedDaysAgo: 3,
      tracking: "NZ-COURIER-11223344",
    },
    { buyerKey: "jane_smith", listingIdx: 0, status: "PAYMENT_HELD" },
    { buyerKey: "jane_smith", listingIdx: 45, status: "AWAITING_PAYMENT" },
    {
      buyerKey: "jane_smith",
      listingIdx: 100,
      status: "COMPLETED",
      completedDaysAgo: 60,
      tracking: "NZ-COURIER-55667788",
    },
    {
      buyerKey: "jane_smith",
      listingIdx: 25,
      status: "COMPLETED",
      completedDaysAgo: 20,
      tracking: "NZPOST-99001122",
    },
    { buyerKey: "jane_smith", listingIdx: 3, status: "CANCELLED" },
    // Marcus (4)
    {
      buyerKey: "marcus_h",
      listingIdx: 13,
      status: "COMPLETED",
      completedDaysAgo: 15,
      tracking: "NZ-COURIER-33445566",
    },
    {
      buyerKey: "marcus_h",
      listingIdx: 65,
      status: "DISPATCHED",
      dispatchedDaysAgo: 5,
      tracking: "COURIER-PICKUP-44556677",
    },
    { buyerKey: "marcus_h", listingIdx: 66, status: "DISPUTED" },
    {
      buyerKey: "marcus_h",
      listingIdx: 9,
      status: "COMPLETED",
      completedDaysAgo: 10,
      tracking: "NZPOST-88990011",
    },
    // Priya (3)
    {
      buyerKey: "priya_m",
      listingIdx: 47,
      status: "COMPLETED",
      completedDaysAgo: 25,
      tracking: "NZ-COURIER-12121212",
    },
    {
      buyerKey: "priya_m",
      listingIdx: 74,
      status: "COMPLETED",
      completedDaysAgo: 18,
      tracking: "NZ-COURIER-13131313",
    },
    {
      buyerKey: "priya_m",
      listingIdx: 36,
      status: "DISPATCHED",
      dispatchedDaysAgo: 2,
      tracking: "NZPOST-14141414",
    },
    // Ben (2)
    {
      buyerKey: "ben_o",
      listingIdx: 105,
      status: "COMPLETED",
      completedDaysAgo: 35,
      tracking: "NZ-COURIER-15151515",
    },
    {
      buyerKey: "ben_o",
      listingIdx: 76,
      status: "COMPLETED",
      completedDaysAgo: 22,
      tracking: "NZ-COURIER-16161616",
    },
    // Sarah (2)
    {
      buyerKey: "sarah_k",
      listingIdx: 90,
      status: "COMPLETED",
      completedDaysAgo: 28,
      tracking: "NZ-COURIER-17171717",
    },
    {
      buyerKey: "sarah_k",
      listingIdx: 14,
      status: "DISPATCHED",
      dispatchedDaysAgo: 4,
      tracking: "NZPOST-18181818",
    },
    // James (2)
    {
      buyerKey: "james_t",
      listingIdx: 49,
      status: "COMPLETED",
      completedDaysAgo: 40,
      tracking: "NZ-COURIER-19191919",
    },
    {
      buyerKey: "james_t",
      listingIdx: 110,
      status: "COMPLETED",
      completedDaysAgo: 12,
      tracking: "NZ-COURIER-20202020",
    },
    // Emma (3)
    {
      buyerKey: "emma_w",
      listingIdx: 48,
      status: "COMPLETED",
      completedDaysAgo: 33,
      tracking: "NZ-COURIER-21212121",
    },
    {
      buyerKey: "emma_w",
      listingIdx: 92,
      status: "COMPLETED",
      completedDaysAgo: 15,
      tracking: "NZPOST-22222222",
    },
    { buyerKey: "emma_w", listingIdx: 55, status: "PAYMENT_HELD" },
    // Liam (2)
    {
      buyerKey: "liam_n",
      listingIdx: 16,
      status: "COMPLETED",
      completedDaysAgo: 20,
      tracking: "NZ-COURIER-23232323",
    },
    {
      buyerKey: "liam_n",
      listingIdx: 19,
      status: "COMPLETED",
      completedDaysAgo: 8,
      tracking: "NZPOST-24242424",
    },
    // Aroha (3)
    {
      buyerKey: "aroha_w",
      listingIdx: 40,
      status: "COMPLETED",
      completedDaysAgo: 30,
      tracking: "NZ-COURIER-25252525",
    },
    {
      buyerKey: "aroha_w",
      listingIdx: 7,
      status: "COMPLETED",
      completedDaysAgo: 14,
      tracking: "NZ-COURIER-26262626",
    },
    {
      buyerKey: "aroha_w",
      listingIdx: 38,
      status: "DISPATCHED",
      dispatchedDaysAgo: 3,
      tracking: "NZPOST-27272727",
    },
    // Connor (2)
    {
      buyerKey: "connor_m",
      listingIdx: 111,
      status: "COMPLETED",
      completedDaysAgo: 25,
      tracking: "NZ-COURIER-28282828",
    },
    {
      buyerKey: "connor_m",
      listingIdx: 86,
      status: "COMPLETED",
      completedDaysAgo: 18,
      tracking: "PICKUP-29292929",
    },
    // Fatima (2)
    {
      buyerKey: "fatima_a",
      listingIdx: 94,
      status: "COMPLETED",
      completedDaysAgo: 20,
      tracking: "NZ-COURIER-30303030",
    },
    { buyerKey: "fatima_a", listingIdx: 42, status: "AWAITING_PAYMENT" },
    // David (2)
    {
      buyerKey: "david_p",
      listingIdx: 21,
      status: "COMPLETED",
      completedDaysAgo: 16,
      tracking: "NZ-COURIER-31313131",
    },
    {
      buyerKey: "david_p",
      listingIdx: 73,
      status: "COMPLETED",
      completedDaysAgo: 22,
      tracking: "NZ-COURIER-32323232",
    },
  ];

  type OR = {
    id: string;
    buyerId: string;
    sellerId: string;
    totalNzd: number;
    status: string;
    completedDaysAgo?: number;
    listingIdx: number;
  };
  const orderRecords: OR[] = [];

  for (const od of orderDefs) {
    const listing = lr[od.listingIdx]!;
    const buyerId = uid[od.buyerKey]!;
    const sellerId = listing.sellerId;
    const itemNzd = listing.priceNzd;
    const shipNzd = listing.shippingNzd ?? 0;
    const totalNzd = itemNzd + shipNzd;
    const createdAgo =
      (od.completedDaysAgo ?? od.dispatchedDaysAgo ?? randomInt(1, 10)) +
      randomInt(2, 7);

    const order = await prisma.order.create({
      data: {
        buyerId,
        sellerId,
        listingId: listing.id,
        itemNzd,
        shippingNzd: shipNzd,
        totalNzd,
        status: od.status as unknown as OrderStatus,
        trackingNumber: od.tracking ?? null,
        dispatchedAt:
          od.dispatchedDaysAgo != null
            ? daysAgo(od.dispatchedDaysAgo)
            : od.completedDaysAgo != null
              ? daysAgo(od.completedDaysAgo + 3)
              : null,
        completedAt:
          od.completedDaysAgo != null ? daysAgo(od.completedDaysAgo) : null,
        shippingName:
          buyerData.find((b) => b.username === od.buyerKey)?.displayName ??
          "Test Buyer",
        shippingCity:
          buyerData.find((b) => b.username === od.buyerKey)?.suburb ??
          "Auckland",
        shippingRegion:
          buyerData.find((b) => b.username === od.buyerKey)?.region ??
          "Auckland",
        createdAt: daysAgo(createdAgo),
      },
    });
    if (od.status === "DISPUTED") {
      await prisma.dispute.create({
        data: {
          orderId: order.id,
          reason: "ITEM_NOT_AS_DESCRIBED",
          source: "STANDARD",
          status: "OPEN",
          buyerStatement:
            "Item does not match listing description. Significant scratches not shown in photos.",
          openedAt: daysAgo(3),
        },
      });
    }
    orderRecords.push({
      id: order.id,
      buyerId,
      sellerId,
      totalNzd,
      status: od.status,
      completedDaysAgo: od.completedDaysAgo,
      listingIdx: od.listingIdx,
    });
  }
  console.log(`✅ ${orderRecords.length} orders`);

  // ═══════════════════════════════════════════════════════════════════════════
  // REVIEWS (for completed orders)
  // ═══════════════════════════════════════════════════════════════════════════

  const reviewComments = [
    {
      r: 50,
      c: "Sweet as condition, exactly as described. Fast shipping too. Cheers!",
      reply: "Cheers! Great buyer, highly recommended.",
    },
    {
      r: 50,
      c: "Mint item, packaged really well. Absolutely stoked with it!",
      reply: "Thanks heaps! Enjoy it.",
    },
    {
      r: 50,
      c: "Seller was super easy to deal with. Would buy again no question.",
      reply: "Sweet! Glad you're happy with it.",
    },
    {
      r: 50,
      c: "Great as, arrived next day. Highly recommend this seller!",
      reply: "No worries at all! Happy trading.",
    },
    {
      r: 50,
      c: "Exactly what I was after. Good honest seller. Choice!",
      reply: null,
    },
    {
      r: 50,
      c: "Choice condition for the price. Happy days! Would buy again.",
      reply: null,
    },
    {
      r: 50,
      c: "Packed well, fast postage. Legit seller. Thanks heaps!",
      reply: "Cheers mate! Enjoy.",
    },
    {
      r: 50,
      c: "Absolutely stoked. Better than expected! Top seller.",
      reply: "Thanks heaps! Really appreciate the review.",
    },
    {
      r: 50,
      c: "Arrived in perfect nick. Exactly as described. Legend!",
      reply: null,
    },
    {
      r: 50,
      c: "Quick dispatch, great comms, item exactly as listed. Sweet!",
      reply: null,
    },
    {
      r: 50,
      c: "So good! Really well packaged and fast shipping. 10/10",
      reply: "Cheers! Great to deal with.",
    },
    {
      r: 50,
      c: "Wicked seller, super fast replies and dispatch. Chur!",
      reply: null,
    },
    {
      r: 50,
      c: "Item was in even better condition than described. Buzzing!",
      reply: "Sweet as! Enjoy it.",
    },
    {
      r: 50,
      c: "Really happy with this purchase. Everything as described.",
      reply: null,
    },
    {
      r: 50,
      c: "Top-notch seller. Item arrived fast and well-packaged.",
      reply: null,
    },
    {
      r: 50,
      c: "Brilliant transaction. Would definitely buy from again.",
      reply: "Thanks! Great buyer.",
    },
    {
      r: 50,
      c: "Awesome quality, fair price. Can't complain at all!",
      reply: null,
    },
    {
      r: 50,
      c: "Super happy! Exactly what I needed. Fast shipping too.",
      reply: null,
    },
    {
      r: 40,
      c: "Good condition overall, minor mark not in photos but still happy.",
      reply: "Thanks for the feedback, sorry about that!",
    },
    {
      r: 40,
      c: "Item as described. Shipping took a bit longer than expected but all good.",
      reply: null,
    },
    {
      r: 40,
      c: "Decent quality, not quite as pristine as I hoped but fair for the price.",
      reply: null,
    },
    {
      r: 40,
      c: "Good item, works well. Packaging could have been better though.",
      reply: null,
    },
    {
      r: 40,
      c: "Solid purchase. Small cosmetic issue but functionally perfect.",
      reply: null,
    },
    {
      r: 30,
      c: "Item works but condition was worse than described. Average experience.",
      reply: "Sorry about that — happy to discuss.",
    },
    {
      r: 30,
      c: "Took a while to ship and comms were slow. Item itself is okay.",
      reply: null,
    },
  ];

  let reviewIdx = 0;
  let reviewCount = 0;
  for (const or of orderRecords) {
    if (or.status !== "COMPLETED") continue;
    const rv = reviewComments[reviewIdx % reviewComments.length]!;
    reviewIdx++;
    await prisma.review.create({
      data: {
        orderId: or.id,
        subjectId: or.sellerId,
        authorId: or.buyerId,
        reviewerRole: "BUYER",
        rating: rv.r,
        comment: rv.c,
        reply: rv.reply ?? null,
        repliedAt: rv.reply ? daysAgo((or.completedDaysAgo ?? 10) - 1) : null,
        createdAt: daysAgo((or.completedDaysAgo ?? 10) - randomInt(0, 2)),
      },
    });
    reviewCount++;
  }
  console.log(`✅ ${reviewCount} reviews`);

  // ═══════════════════════════════════════════════════════════════════════════
  // MESSAGES (20 threads, 80+ messages)
  // ═══════════════════════════════════════════════════════════════════════════

  type TD = {
    buyer: string;
    seller: string;
    listingIdx: number;
    msgs: [0 | 1, string][];
  };

  const threadDefs: TD[] = [
    // Jane ↔ TechDealsNZ (2 threads)
    {
      buyer: "jane_smith",
      seller: "TechDealsNZ",
      listingIdx: 0,
      msgs: [
        [0, "Hey, is the iPhone 15 Pro still available?"],
        [1, "Yep, still here! Happy to answer any questions."],
        [0, "What's the battery health like? And any scratches?"],
        [
          1,
          "Battery health is 94%, no scratches at all. Always used with a case and screen protector.",
        ],
        [0, "Sweet, I'll take it! Buying now."],
      ],
    },
    {
      buyer: "jane_smith",
      seller: "TechDealsNZ",
      listingIdx: 2,
      msgs: [
        [0, "Hi! Keen on the Sony headphones. Would you take $300?"],
        [
          1,
          "Best I can do is the listing price sorry — they're basically brand new.",
        ],
        [0, "No worries, fair enough. I'll go for the listing price."],
        [1, "Just shipped your way! Tracking is NZ-COURIER-93847561."],
        [0, "Arrived today — stoked with them! Cheers!"],
        [1, "Awesome, glad you're happy! Enjoy them."],
      ],
    },
    // Jane ↔ AlpineWardrobe (2 threads)
    {
      buyer: "jane_smith",
      seller: "AlpineWardrobe",
      listingIdx: 25,
      msgs: [
        [0, "Hey, are the Allbirds true to size? I'm usually a 10."],
        [
          1,
          "Yeah they run true to size. Really comfy straight out of the box.",
        ],
        [0, "Sweet, buying now. Can you post to Auckland?"],
        [1, "Yep, courier $8 tracked. Will send tomorrow morning!"],
      ],
    },
    {
      buyer: "jane_smith",
      seller: "AlpineWardrobe",
      listingIdx: 28,
      msgs: [
        [
          0,
          "Hi, what colour is the Icebreaker jacket? Hard to tell from the photo.",
        ],
        [1, "It's black — I can send more photos if you like?"],
        [0, "All good, I'll grab it. Looks perfect for winter."],
      ],
    },
    // Jane ↔ RubyVault
    {
      buyer: "jane_smith",
      seller: "RubyVault",
      listingIdx: 100,
      msgs: [
        [
          0,
          "Is the All Blacks jersey authenticated? Would love to see the COA.",
        ],
        [
          1,
          "100% legit — comes with NZRU Certificate of Authenticity. Happy to send a photo of it.",
        ],
        [0, "Amazing, I'll take it! Perfect gift for my dad."],
        [
          1,
          "Shipped today, tracking NZ-COURIER-55667788. Packaged extra carefully!",
        ],
        [0, "Arrived safely, dad is absolutely stoked. Cheers!"],
      ],
    },
    // Marcus ↔ WelliTech (2 threads)
    {
      buyer: "marcus_h",
      seller: "WelliTech",
      listingIdx: 13,
      msgs: [
        [0, "Hey, is the MacBook still under AppleCare?"],
        [
          1,
          "Yep, AppleCare+ until March 2026. Battery cycle count is only 41.",
        ],
        [0, "Awesome. Would you do $2,700?"],
        [
          1,
          "Firm at $2,850 sorry — it's basically new. Check the cycle count!",
        ],
        [0, "Fair enough, I'll pay full price. It's a beast of a machine."],
      ],
    },
    {
      buyer: "marcus_h",
      seller: "WelliTech",
      listingIdx: 9,
      msgs: [
        [0, "Do the Bose QC45 have the noise cancelling issue some had?"],
        [
          1,
          "No issues at all. Noise cancelling works perfectly. Just upgraded to XM5s.",
        ],
        [0, "Sweet, buying now!"],
      ],
    },
    // Marcus ↔ SpinningWellie
    {
      buyer: "marcus_h",
      seller: "SpinningWellie",
      listingIdx: 65,
      msgs: [
        [
          0,
          "Can I come test ride the Specialized this weekend? I'm in Newtown.",
        ],
        [1, "Yeah no worries, come round Saturday arvo. I'm in Karori."],
        [0, "Awesome, see you Saturday!"],
        [1, "Great to meet you! Just dispatched — enjoy the ride!"],
      ],
    },
    // Priya ↔ HomeGoodsNZ
    {
      buyer: "priya_m",
      seller: "HomeGoodsNZ",
      listingIdx: 47,
      msgs: [
        [0, "Does the KitchenAid come with the pasta attachment?"],
        [
          1,
          "No sorry, just the standard attachments (beater, hook, whip). Works perfectly though!",
        ],
        [0, "All good, I'll grab it anyway. Always wanted a red one!"],
      ],
    },
    // Ben ↔ TaongaTreasures
    {
      buyer: "ben_o",
      seller: "TaongaTreasures",
      listingIdx: 105,
      msgs: [
        [0, "Kia ora, is the pounamu from the West Coast?"],
        [
          1,
          "Kia ora! Yes, genuine Westland pounamu. Hand-carved by a local artisan in Hokitika.",
        ],
        [0, "Beautiful. Is it on a sterling chain or cord?"],
        [1, "Sterling silver chain, 50cm. Comes in a gift box too."],
        [0, "Rawe, I'll buy it now. Ngā mihi!"],
      ],
    },
    // Sarah ↔ KidsStuffNZ
    {
      buyer: "sarah_k",
      seller: "KidsStuffNZ",
      listingIdx: 90,
      msgs: [
        [0, "Hi! Does the Bugaboo come with the rain cover?"],
        [
          1,
          "Yes! Rain cover, mosquito net, and under-seat basket. All original accessories.",
        ],
        [0, "Amazing, buying it now. Our first baby is due in 6 weeks!"],
        [1, "Congratulations! Shipped and on its way. You'll love it!"],
      ],
    },
    // James ↔ HomeGoodsNZ
    {
      buyer: "james_t",
      seller: "HomeGoodsNZ",
      listingIdx: 49,
      msgs: [
        [0, "Is the Herman Miller Aeron the remastered version?"],
        [1, "Yes, the latest remastered version with PostureFit SL. Size B."],
        [0, "Can I pick up from Hamilton?"],
        [1, "Yep, or I can courier for $30. Up to you!"],
      ],
    },
    // Emma ↔ HomeGoodsNZ
    {
      buyer: "emma_w",
      seller: "HomeGoodsNZ",
      listingIdx: 48,
      msgs: [
        [0, "Hey, does the Breville make a decent flat white?"],
        [
          1,
          "Makes an excellent flat white once you dial in the grind. I'll include my settings card!",
        ],
        [0, "Ha! That's awesome. Buying now."],
      ],
    },
    // Liam ↔ WelliTech
    {
      buyer: "liam_n",
      seller: "WelliTech",
      listingIdx: 16,
      msgs: [
        [0, "Hi, what's the battery health on the Dell XPS?"],
        [1, "Battery report shows 92% health. Gets about 7 hours light use."],
        [0, "That's decent. Can I pick up from Te Aro?"],
        [1, "Sure thing, I'm usually around after 5pm weekdays."],
      ],
    },
    // Aroha ↔ NorthlandFinds
    {
      buyer: "aroha_w",
      seller: "NorthlandFinds",
      listingIdx: 40,
      msgs: [
        [0, "Is the Coach bag genuine? Can you show the serial?"],
        [
          1,
          "100% genuine, bought from the Coach store in Newmarket. Serial number photos coming.",
        ],
        [0, "Choice, looks legit. I'll buy it!"],
        [1, "Shipped! Tracking NZ-COURIER-25252525."],
      ],
    },
    // Connor ↔ ProToolsChch
    {
      buyer: "connor_m",
      seller: "ProToolsChch",
      listingIdx: 111,
      msgs: [
        [0, "Hey mate, are all the batteries still holding charge?"],
        [
          1,
          "Yeah all 3 batteries going strong. Used on one reno project, about 6 months of use.",
        ],
        [0, "Sweet as, I'll take the lot."],
      ],
    },
    // Fatima ↔ KidsStuffNZ
    {
      buyer: "fatima_a",
      seller: "KidsStuffNZ",
      listingIdx: 94,
      msgs: [
        [
          0,
          "Is the LEGO Eiffel Tower really 10,001 pieces?! Is it factory sealed?",
        ],
        [
          1,
          "Yep, 10,001 pieces! Factory sealed, never opened. It's an incredible set.",
        ],
        [0, "My husband is going to love this. Buying it for his birthday!"],
        [1, "Great choice! It's an amazing build. Shipped and on its way!"],
      ],
    },
    // David ↔ WelliTech
    {
      buyer: "david_p",
      seller: "WelliTech",
      listingIdx: 21,
      msgs: [
        [0, "Does the Garmin Fenix have the topo maps for NZ?"],
        [
          1,
          "Yep, TopoActive NZ maps pre-loaded. Works brilliantly on the trails.",
        ],
        [0, "Perfect. Buying now — keen to try it on the Rimutaka Incline."],
      ],
    },
    // Priya ↔ ChchCycles
    {
      buyer: "priya_m",
      seller: "ChchCycles",
      listingIdx: 74,
      msgs: [
        [0, "Can you post the Garmin Edge to Christchurch?"],
        [
          1,
          "Of course! $9 tracked courier, usually arrives next day within Canterbury.",
        ],
        [0, "Great, buying now!"],
        [1, "Dispatched! Tracking NZ-COURIER-13131313."],
        [0, "Arrived today — looks brand new! Cheers."],
      ],
    },
    // Emma ↔ KidsStuffNZ
    {
      buyer: "emma_w",
      seller: "KidsStuffNZ",
      listingIdx: 92,
      msgs: [
        [0, "Is the BabyBjorn bouncer suitable from newborn?"],
        [
          1,
          "Yes, from 3.5kg (roughly newborn). The mesh fabric is great for NZ summers too.",
        ],
        [0, "Awesome, buying it now. Thanks for the quick reply!"],
      ],
    },
  ];

  let totalMsgs = 0;
  for (const td of threadDefs) {
    const buyerId = uid[td.buyer]!;
    const sellerId = uid[td.seller]!;
    const listingId = lr[td.listingIdx]?.id ?? null;

    const thread = await prisma.messageThread.create({
      data: {
        participant1Id: buyerId,
        participant2Id: sellerId,
        listingId,
        lastMessageAt: hoursAgo(randomInt(1, 48)),
      },
    });

    for (let i = 0; i < td.msgs.length; i++) {
      const [who, body] = td.msgs[i]!;
      const senderId = who === 0 ? buyerId : sellerId;
      const isRead = i < td.msgs.length - 1; // last message unread
      await prisma.message.create({
        data: {
          threadId: thread.id,
          senderId,
          body,
          read: isRead,
          readAt: isRead ? hoursAgo(randomInt(1, 24)) : null,
          createdAt: hoursAgo((td.msgs.length - i) * randomInt(2, 12)),
        },
      });
      totalMsgs++;
    }
  }
  console.log(`✅ ${threadDefs.length} message threads, ${totalMsgs} messages`);

  // ═══════════════════════════════════════════════════════════════════════════
  // WATCHLIST (45 items)
  // ═══════════════════════════════════════════════════════════════════════════

  const watchDefs: [string, number[]][] = [
    ["jane_smith", [13, 65, 100, 45, 90, 105, 49, 18]], // 8
    ["marcus_h", [6, 15, 21, 4]], // 4
    ["priya_m", [28, 48, 31, 91]], // 4
    ["ben_o", [109, 108]], // 2
    ["sarah_k", [40, 39, 94, 42]], // 4
    ["james_t", [110, 112, 57]], // 3
    ["emma_w", [55, 58, 99, 95]], // 4
    ["liam_n", [10, 14, 23]], // 3
    ["aroha_w", [25, 37, 43, 41]], // 4
    ["connor_m", [113, 114, 77]], // 3
    ["fatima_a", [93, 97, 98]], // 3
    ["david_p", [19, 20, 12]], // 3
  ];

  let watchCount = 0;
  for (const [buyerKey, idxs] of watchDefs) {
    for (const idx of idxs) {
      await prisma.watchlistItem.create({
        data: { userId: uid[buyerKey]!, listingId: lr[idx]!.id },
      });
      watchCount++;
    }
  }
  console.log(`✅ ${watchCount} watchlist items`);

  // ═══════════════════════════════════════════════════════════════════════════
  // OFFERS (15)
  // ═══════════════════════════════════════════════════════════════════════════

  const offerDefs: {
    buyer: string;
    listingIdx: number;
    amount: number;
    status: string;
    note?: string;
    declineNote?: string;
  }[] = [
    // 5 PENDING
    {
      buyer: "jane_smith",
      listingIdx: 9,
      amount: 260,
      status: "PENDING",
      note: "Would you take $260? Happy to pay via BankTransfer too.",
    },
    {
      buyer: "marcus_h",
      listingIdx: 67,
      amount: 1300,
      status: "PENDING",
      note: "Keen on the Giant Revolt, would $1,300 work?",
    },
    {
      buyer: "priya_m",
      listingIdx: 48,
      amount: 600,
      status: "PENDING",
      note: "Would you consider $600 for the Breville?",
    },
    {
      buyer: "sarah_k",
      listingIdx: 14,
      amount: 340,
      status: "PENDING",
      note: "Hi, would you take $340 for the Switch?",
    },
    {
      buyer: "ben_o",
      listingIdx: 107,
      amount: 400,
      status: "PENDING",
      note: "Interested in the Pounamu Toki. Would $400 be okay?",
    },
    // 4 ACCEPTED
    {
      buyer: "jane_smith",
      listingIdx: 2,
      amount: 310,
      status: "ACCEPTED",
      note: "Would you do $310 for the Sonys?",
    },
    {
      buyer: "marcus_h",
      listingIdx: 13,
      amount: 2750,
      status: "ACCEPTED",
      note: "Any chance of $2,750 for the MacBook?",
    },
    {
      buyer: "aroha_w",
      listingIdx: 40,
      amount: 200,
      status: "ACCEPTED",
      note: "Would you take $200 for the Coach bag?",
    },
    {
      buyer: "james_t",
      listingIdx: 49,
      amount: 1050,
      status: "ACCEPTED",
      note: "Keen to grab the Aeron, would $1,050 work?",
    },
    // 4 DECLINED
    {
      buyer: "liam_n",
      listingIdx: 16,
      amount: 1200,
      status: "DECLINED",
      note: "Hi, would you take $1,200?",
      declineNote: "Cheers for the offer but I'm pretty firm on price",
    },
    {
      buyer: "emma_w",
      listingIdx: 48,
      amount: 550,
      status: "DECLINED",
      note: "Would you do $550?",
      declineNote: "No worries, but can't go lower than asking",
    },
    {
      buyer: "david_p",
      listingIdx: 21,
      amount: 500,
      status: "DECLINED",
      note: "Would $500 work?",
      declineNote: "Appreciate the offer mate, but firm on this one",
    },
    {
      buyer: "fatima_a",
      listingIdx: 94,
      amount: 250,
      status: "DECLINED",
      note: "Can you do $250?",
      declineNote: "Sorry, price is firm on this one",
    },
    // 2 EXPIRED
    {
      buyer: "ben_o",
      listingIdx: 106,
      amount: 150,
      status: "EXPIRED",
      note: "Would you take $150 for the stamps?",
    },
    {
      buyer: "connor_m",
      listingIdx: 114,
      amount: 320,
      status: "EXPIRED",
      note: "Would $320 be okay for the shelving?",
    },
  ];

  for (const od of offerDefs) {
    const listing = lr[od.listingIdx]!;
    const expiresAt =
      od.status === "EXPIRED"
        ? daysAgo(5)
        : new Date(Date.now() + 48 * 3_600_000);
    await prisma.offer.create({
      data: {
        listingId: listing.id,
        buyerId: uid[od.buyer]!,
        sellerId: listing.sellerId,
        amountNzd: $(od.amount),
        note: od.note ?? null,
        status: od.status as unknown as OfferStatus,
        expiresAt,
        respondedAt: ["ACCEPTED", "DECLINED"].includes(od.status)
          ? daysAgo(randomInt(1, 5))
          : null,
        declineNote: od.declineNote ?? null,
        createdAt: daysAgo(randomInt(3, 15)),
      },
    });
  }
  console.log(`✅ ${offerDefs.length} offers`);

  // ═══════════════════════════════════════════════════════════════════════════
  // PAYOUTS (20)
  // ═══════════════════════════════════════════════════════════════════════════

  const completedOrders = orderRecords.filter((o) => o.status === "COMPLETED");
  let payoutCount = 0;
  let paidCount = 0,
    pendingCount = 0,
    processingCount = 0,
    failedCount = 0;

  for (let i = 0; i < completedOrders.length && payoutCount < 20; i++) {
    const or = completedOrders[i]!;
    const stripeFee = Math.round(or.totalNzd * 0.029 + 30);
    const platformFee = 0; // beta
    const amount = or.totalNzd - stripeFee - platformFee;

    let status: string;
    let paidAt: Date | null = null;
    let initiatedAt: Date | null = null;
    let failedAt: Date | null = null;
    let failReason: string | null = null;
    let stripeTransferId: string | null = null;

    if (failedCount < 1 && payoutCount === 15) {
      status = "FAILED";
      failedAt = daysAgo(3);
      failReason = "Bank account closed";
      failedCount++;
    } else if (processingCount < 2 && payoutCount >= 13 && payoutCount < 15) {
      status = "PROCESSING";
      initiatedAt = daysAgo(1);
      stripeTransferId = `tr_test_processing_${payoutCount}`;
      processingCount++;
    } else if (pendingCount < 5 && payoutCount >= 8 && payoutCount < 13) {
      status = "PENDING";
      pendingCount++;
    } else {
      status = "PAID";
      paidAt = daysAgo((or.completedDaysAgo ?? 10) - 2);
      initiatedAt = daysAgo((or.completedDaysAgo ?? 10) - 1);
      stripeTransferId = `tr_test_paid_${payoutCount}`;
      paidCount++;
    }

    await prisma.payout.create({
      data: {
        orderId: or.id,
        userId: or.sellerId,
        amountNzd: amount,
        platformFeeNzd: platformFee,
        stripeFeeNzd: stripeFee,
        status: status as unknown as PayoutStatus,
        stripeTransferId,
        initiatedAt,
        paidAt,
        failedAt,
        failReason,
        createdAt: daysAgo(or.completedDaysAgo ?? 10),
      },
    });
    payoutCount++;
  }
  console.log(
    `✅ ${payoutCount} payouts (${paidCount} paid, ${pendingCount} pending, ${processingCount} processing, ${failedCount} failed)`,
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  const counts = await Promise.all([
    prisma.user.count(),
    prisma.listing.count(),
    prisma.listingImage.count(),
    prisma.listingAttribute.count(),
    prisma.order.count(),
    prisma.review.count(),
    prisma.messageThread.count(),
    prisma.message.count(),
    prisma.watchlistItem.count(),
    prisma.offer.count(),
    prisma.payout.count(),
  ]);

  console.log("\n════════════════════════════════════════");
  console.log("📊 FINAL RECORD COUNTS");
  console.log("════════════════════════════════════════");
  console.log(`Users:           ${counts[0]}`);
  console.log(`Listings:        ${counts[1]}`);
  console.log(`ListingImages:   ${counts[2]}`);
  console.log(`ListingAttrs:    ${counts[3]}`);
  console.log(`Orders:          ${counts[4]}`);
  console.log(`Reviews:         ${counts[5]}`);
  console.log(`MessageThreads:  ${counts[6]}`);
  console.log(`Messages:        ${counts[7]}`);
  console.log(`WatchlistItems:  ${counts[8]}`);
  console.log(`Offers:          ${counts[9]}`);
  console.log(`Payouts:         ${counts[10]}`);
  console.log("════════════════════════════════════════\n");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
