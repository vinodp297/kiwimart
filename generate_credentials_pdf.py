#!/usr/bin/env python3
"""Generate KiwiMart Test Credentials PDF using reportlab."""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import Flowable

# ── Brand colours ──────────────────────────────────────────────────────────────
GREEN  = colors.HexColor("#16a34a")
GOLD   = colors.HexColor("#D4A843")
LIGHT_GREEN = colors.HexColor("#dcfce7")
LIGHT_GOLD  = colors.HexColor("#fef9c3")
WARNING_BG  = colors.HexColor("#fff7ed")
WARNING_BORDER = colors.HexColor("#fb923c")
DARK_TEXT   = colors.HexColor("#111827")
MUTED       = colors.HexColor("#6b7280")
TABLE_HDR   = colors.HexColor("#166534")
TABLE_ROW1  = colors.HexColor("#f0fdf4")
TABLE_ROW2  = colors.white

OUTPUT_PATH = r"C:\Users\vinod\OneDrive\Desktop\Kiwi cart\Kiwi Project\KiwiMart_Test_Credentials.pdf"


class ColoredLine(Flowable):
    """A coloured horizontal rule."""
    def __init__(self, color, thickness=2, width=None):
        Flowable.__init__(self)
        self.color = color
        self.thickness = thickness
        self._width = width

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.thickness)
        w = self._width or self.canv._pagesize[0] - 40*mm
        self.canv.line(0, 0, w, 0)

    def wrap(self, availWidth, availHeight):
        self._width = self._width or availWidth
        return self._width, self.thickness + 2


def build_styles():
    base = getSampleStyleSheet()
    styles = {}

    styles["title"] = ParagraphStyle(
        "title",
        parent=base["Normal"],
        fontSize=26,
        textColor=GREEN,
        alignment=TA_CENTER,
        fontName="Helvetica-Bold",
        spaceAfter=4,
    )
    styles["subtitle"] = ParagraphStyle(
        "subtitle",
        parent=base["Normal"],
        fontSize=13,
        textColor=GOLD,
        alignment=TA_CENTER,
        fontName="Helvetica-BoldOblique",
        spaceAfter=2,
    )
    styles["section_heading"] = ParagraphStyle(
        "section_heading",
        parent=base["Normal"],
        fontSize=13,
        textColor=colors.white,
        fontName="Helvetica-Bold",
        spaceAfter=4,
        spaceBefore=10,
        leftIndent=6,
    )
    styles["body"] = ParagraphStyle(
        "body",
        parent=base["Normal"],
        fontSize=9.5,
        textColor=DARK_TEXT,
        fontName="Helvetica",
        spaceAfter=3,
        leading=14,
    )
    styles["mono"] = ParagraphStyle(
        "mono",
        parent=base["Normal"],
        fontSize=8.5,
        textColor=DARK_TEXT,
        fontName="Courier",
        spaceAfter=2,
        leading=13,
    )
    styles["warning"] = ParagraphStyle(
        "warning",
        parent=base["Normal"],
        fontSize=10,
        textColor=colors.HexColor("#9a3412"),
        fontName="Helvetica-Bold",
        alignment=TA_CENTER,
        spaceAfter=0,
        leading=16,
    )
    styles["footer"] = ParagraphStyle(
        "footer",
        parent=base["Normal"],
        fontSize=8,
        textColor=MUTED,
        alignment=TA_CENTER,
        fontName="Helvetica",
    )
    styles["db_item"] = ParagraphStyle(
        "db_item",
        parent=base["Normal"],
        fontSize=9.5,
        textColor=DARK_TEXT,
        fontName="Helvetica",
        spaceAfter=4,
        leading=14,
        leftIndent=12,
        bulletIndent=0,
        bulletText="•",
    )
    return styles


def section_header_table(text, styles):
    """Returns a full-width green banner Table acting as a section heading."""
    p = Paragraph(text, styles["section_heading"])
    t = Table([[p]], colWidths=["100%"])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), GREEN),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
    ]))
    return t


def credentials_table(rows, styles):
    """Build a styled credentials table.
    rows: list of (email, password, name, role, notes)
    """
    header = [
        Paragraph("<b>Email</b>", ParagraphStyle("th", parent=styles["body"], textColor=colors.white, fontName="Helvetica-Bold", fontSize=9)),
        Paragraph("<b>Password</b>", ParagraphStyle("th", parent=styles["body"], textColor=colors.white, fontName="Helvetica-Bold", fontSize=9)),
        Paragraph("<b>Name</b>", ParagraphStyle("th", parent=styles["body"], textColor=colors.white, fontName="Helvetica-Bold", fontSize=9)),
        Paragraph("<b>Role</b>", ParagraphStyle("th", parent=styles["body"], textColor=colors.white, fontName="Helvetica-Bold", fontSize=9)),
        Paragraph("<b>Notes</b>", ParagraphStyle("th", parent=styles["body"], textColor=colors.white, fontName="Helvetica-Bold", fontSize=9)),
    ]

    mono_style = ParagraphStyle("mono_cell", parent=styles["mono"], fontSize=8, leading=11)
    body_small = ParagraphStyle("body_small", parent=styles["body"], fontSize=8.5, leading=12)

    data = [header]
    for i, (email, pw, name, role, notes) in enumerate(rows):
        data.append([
            Paragraph(email, mono_style),
            Paragraph(pw, mono_style),
            Paragraph(name, body_small),
            Paragraph(role, body_small),
            Paragraph(notes, body_small),
        ])

    col_widths = [54*mm, 38*mm, 35*mm, 22*mm, 38*mm]

    t = Table(data, colWidths=col_widths, repeatRows=1)
    style_cmds = [
        ("BACKGROUND",    (0, 0), (-1, 0), TABLE_HDR),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0), 9),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 5),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [TABLE_ROW1, TABLE_ROW2]),
        ("GRID",          (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]
    t.setStyle(TableStyle(style_cmds))
    return t


def warning_box(styles):
    """Orange-bordered warning box."""
    msg = Paragraph("⚠  Development use only — do not use in production", styles["warning"])
    t = Table([[msg]], colWidths=["100%"])
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), WARNING_BG),
        ("BOX",           (0, 0), (-1, -1), 2, WARNING_BORDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
    ]))
    return t


def db_bullet_table(items, styles):
    """Two-column bullet list for the database section."""
    body_small = ParagraphStyle("body_small2", parent=styles["body"], fontSize=9, leading=13)
    rows = []
    for item in items:
        rows.append([
            Paragraph("•", ParagraphStyle("bull", parent=styles["body"], fontSize=10, textColor=GOLD, fontName="Helvetica-Bold")),
            Paragraph(item, body_small),
        ])
    t = Table(rows, colWidths=[7*mm, "100%"])
    t.setStyle(TableStyle([
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING",    (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
    ]))
    return t


def build_pdf():
    styles = build_styles()
    story = []

    # ── Header ─────────────────────────────────────────────────────────────────
    story.append(Spacer(1, 6*mm))
    story.append(Paragraph("KiwiMart — Test Credentials", styles["title"]))
    story.append(Paragraph("Development &amp; QA Environment", styles["subtitle"]))
    story.append(Spacer(1, 3*mm))
    story.append(ColoredLine(GOLD, thickness=3))
    story.append(Spacer(1, 3*mm))

    # ── Warning box ────────────────────────────────────────────────────────────
    story.append(warning_box(styles))
    story.append(Spacer(1, 6*mm))

    # ── Section 1: BUYERS ──────────────────────────────────────────────────────
    story.append(section_header_table("Section 1 — BUYERS", styles))
    story.append(Spacer(1, 3*mm))

    buyer_rows = [
        ("buyer@kiwimart.test",  "BuyerPassword123!", "Alice M",  "Buyer", "Auckland"),
        ("buyer2@kiwimart.test", "BuyerPassword123!", "Bob T",    "Buyer", "Wellington"),
    ]
    story.append(credentials_table(buyer_rows, styles))
    story.append(Spacer(1, 6*mm))

    # ── Section 2: SELLERS ─────────────────────────────────────────────────────
    story.append(section_header_table("Section 2 — SELLERS", styles))
    story.append(Spacer(1, 3*mm))

    seller_rows = [
        ("techdeals@kiwimart.test",  "SellerPassword123!", "TechDeals NZ",   "Seller", "Auckland · Verified ✓ · Stripe onboarded"),
        ("homestyle@kiwimart.test",  "SellerPassword123!", "HomeStyle NZ",   "Seller", "Wellington · Unverified · Stripe onboarded"),
        ("outdoorgear@kiwimart.test","SellerPassword123!", "OutdoorGear NZ", "Seller", "Canterbury · Verified ✓ · Stripe onboarded"),
    ]
    story.append(credentials_table(seller_rows, styles))
    story.append(Spacer(1, 6*mm))

    # ── Section 3: ADMIN ───────────────────────────────────────────────────────
    story.append(section_header_table("Section 3 — ADMIN", styles))
    story.append(Spacer(1, 3*mm))

    admin_rows = [
        ("admin@kiwimart.test", "AdminPassword123!", "KiwiMart Admin", "Admin", "Full admin access"),
    ]
    story.append(credentials_table(admin_rows, styles))
    story.append(Spacer(1, 8*mm))

    # ── What's in the database ─────────────────────────────────────────────────
    story.append(ColoredLine(GREEN, thickness=1.5))
    story.append(Spacer(1, 4*mm))

    db_heading_style = ParagraphStyle(
        "db_heading",
        parent=styles["body"],
        fontSize=13,
        textColor=GREEN,
        fontName="Helvetica-Bold",
        spaceAfter=6,
    )
    story.append(Paragraph("What's in the Database", db_heading_style))

    db_items = [
        "<b>9 Categories:</b> Electronics, Fashion, Home &amp; Garden, Sports &amp; Outdoors, "
        "Vehicles, Property, Baby &amp; Kids, Collectibles, Tools &amp; Equipment",
        "<b>19 Listings</b> covering tags: <i>Just Listed, Price Dropped, Urgent sale, "
        "Negotiable, Ships NZ Wide, SOLD</i>",
        "<b>1 Completed order:</b> Alice bought AirPods Pro from TechDeals ($289)",
        "<b>1 Five-star review</b> from Alice on that order",
        "<b>Message thread:</b> Alice ↔ TechDeals about MacBook Pro",
        "<b>Alice's watchlist:</b> MacBook Pro, Gaming PC, Mountain Bike",
    ]
    story.append(db_bullet_table(db_items, styles))
    story.append(Spacer(1, 8*mm))

    # ── Footer ─────────────────────────────────────────────────────────────────
    story.append(ColoredLine(GOLD, thickness=1))
    story.append(Spacer(1, 3*mm))
    story.append(Paragraph("2026-03-25  ·  KiwiMart Internal", styles["footer"]))

    # ── Build document ─────────────────────────────────────────────────────────
    doc = SimpleDocTemplate(
        OUTPUT_PATH,
        pagesize=A4,
        leftMargin=20*mm,
        rightMargin=20*mm,
        topMargin=18*mm,
        bottomMargin=18*mm,
        title="KiwiMart Test Credentials",
        author="KiwiMart Internal",
        subject="Development & QA Environment",
    )
    doc.build(story)
    print(f"PDF created: {OUTPUT_PATH}")


if __name__ == "__main__":
    build_pdf()
