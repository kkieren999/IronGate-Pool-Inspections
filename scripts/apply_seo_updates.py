#!/usr/bin/env python3
"""Apply IronGate's approved local SEO, pricing, routing and trust updates.

This script is intentionally idempotent. It updates the checked-in source so the
GitHub Pages and Firebase deployment workflows publish the same information.
The unfinished homepage inspection video is deliberately preserved.
"""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "irongate_rebuilt_site_20260623_093017"
DOMAIN = "https://irongatepool.com.au"
QBCC_URL = "https://my.qbcc.qld.gov.au/myQBCC/s/pool-safety-inspector-search"
BUSINESS_NAME = "IronGate Pool Inspections"
PHONE = "0481 442 260"
PHONE_LINK = "tel:0481442260"
EMAIL = "irongate.pool.bne@gmail.com"
PRICE_DISPLAY = "$149"
PRICE_CENTS = "14900"

changed: list[str] = []


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    previous = path.read_text(encoding="utf-8") if path.exists() else None
    if previous != content:
        path.write_text(content, encoding="utf-8")
        changed.append(str(path.relative_to(ROOT)))


def required_replace(text: str, old: str, new: str, label: str) -> str:
    if old in text:
        return text.replace(old, new, 1)
    if new in text:
        return text
    raise RuntimeError(f"Could not find expected {label}")


def replace_price_and_links() -> None:
    explicit_files = {
        ROOT / "functions-payments/index.js",
        ROOT / "functions-email/index.js",
        ROOT / "functions/booking-email.js",
        ROOT / "functions/index.js",
        ROOT / "firestore.rules",
    }
    candidates = set(explicit_files)
    for path in SITE.rglob("*"):
        if path.is_file() and path.suffix.lower() in {".html", ".js", ".txt", ".md", ".json"}:
            candidates.add(path)

    route_replacements = {
        "agency-booking-received.html": "/agency-booking-received/",
        "admin-timeblocks.html": "/admin/",
        "admin-availability.html": "/admin/",
        "booking.html": "/booking/",
        "success.html": "/success/",
        "cancelled.html": "/cancelled/",
        "privacy.html": "/privacy/",
        "terms.html": "/terms/",
        "refunds.html": "/refunds/",
        "index.html#": "/#",
    }

    for path in sorted(candidates):
        if not path.exists() or path == Path(__file__):
            continue
        text = read(path)
        updated = text
        updated = updated.replace("$249", PRICE_DISPLAY)
        updated = re.sub(r"(?<!\d)24900(?!\d)", PRICE_CENTS, updated)
        updated = updated.replace("$249.00", "$149.00")
        updated = updated.replace("AUD 249", "AUD 149")
        updated = updated.replace(
            "https://example.com/qbcc-pool-safety-inspector-search", QBCC_URL
        )
        if path.is_relative_to(SITE):
            for old, new in route_replacements.items():
                updated = updated.replace(old, new)
        write(path, updated)


def seo_block(
    *,
    canonical: str,
    title: str,
    description: str,
    image: str = f"{DOMAIN}/assets/hero_image_v2.png",
    robots: str = "index, follow, max-image-preview:large",
    schema: dict | list | None = None,
) -> str:
    schema_markup = ""
    if schema is not None:
        schema_markup = (
            '\n  <script type="application/ld+json" id="irongate-structured-data">'
            + json.dumps(schema, ensure_ascii=False, separators=(",", ":"))
            + "</script>"
        )
    return f"""  <!-- IRONGATE SEO START -->
  <link rel="canonical" href="{canonical}" />
  <link rel="icon" href="/assets/logo-no-text.png" type="image/png" />
  <meta name="robots" content="{robots}" />
  <meta property="og:locale" content="en_AU" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="{BUSINESS_NAME}" />
  <meta property="og:title" content="{title}" />
  <meta property="og:description" content="{description}" />
  <meta property="og:url" content="{canonical}" />
  <meta property="og:image" content="{image}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{title}" />
  <meta name="twitter:description" content="{description}" />
  <meta name="twitter:image" content="{image}" />{schema_markup}
  <!-- IRONGATE SEO END -->
"""


def inject_seo(
    html: str,
    *,
    canonical: str,
    title: str,
    description: str,
    robots: str = "index, follow, max-image-preview:large",
    schema: dict | list | None = None,
) -> str:
    html = re.sub(
        r"\s*<!-- IRONGATE SEO START -->.*?<!-- IRONGATE SEO END -->\s*",
        "\n",
        html,
        flags=re.DOTALL,
    )
    html = re.sub(r"\s*<link[^>]+rel=[\"']canonical[\"'][^>]*>\s*", "\n", html, flags=re.I)
    html = re.sub(r"\s*<meta[^>]+name=[\"']robots[\"'][^>]*>\s*", "\n", html, flags=re.I)
    block = seo_block(
        canonical=canonical,
        title=title,
        description=description,
        robots=robots,
        schema=schema,
    )
    return html.replace("</head>", block + "</head>", 1)


def ensure_base(html: str) -> str:
    if re.search(r"<base\s", html, flags=re.I):
        return html
    return html.replace("<head>", '<head>\n  <base href="/" />', 1)


def homepage_schema() -> list[dict]:
    return [
        {
            "@context": "https://schema.org",
            "@type": "LocalBusiness",
            "@id": f"{DOMAIN}/#business",
            "name": BUSINESS_NAME,
            "url": f"{DOMAIN}/",
            "logo": f"{DOMAIN}/assets/logo-no-text.png",
            "image": f"{DOMAIN}/assets/hero_image_v2.png",
            "telephone": "+61481442260",
            "email": EMAIL,
            "priceRange": PRICE_DISPLAY,
            "description": "QBCC-licensed pool safety inspections, pool barrier compliance reports and pool safety certificates across Brisbane Southside.",
            "areaServed": [
                {"@type": "City", "name": "Brisbane"},
                {"@type": "AdministrativeArea", "name": "Brisbane Southside"},
            ],
            "founder": {"@type": "Person", "name": "Kieren Albuquerque"},
            "sameAs": [
                "https://www.facebook.com/irongate.pool.bne",
                "https://www.instagram.com/irongate.pool.bne/",
            ],
            "hasCredential": {
                "@type": "EducationalOccupationalCredential",
                "credentialCategory": "QBCC Pool Safety Inspector Licence",
                "identifier": "PS15616387",
            },
            "makesOffer": {
                "@type": "Offer",
                "price": "149",
                "priceCurrency": "AUD",
                "url": f"{DOMAIN}/booking/",
                "itemOffered": {
                    "@type": "Service",
                    "name": "Pool Safety Inspection and Certificate",
                    "areaServed": "Brisbane",
                },
            },
        },
        {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "@id": f"{DOMAIN}/#website",
            "url": f"{DOMAIN}/",
            "name": BUSINESS_NAME,
            "inLanguage": "en-AU",
        },
    ]


def update_homepage() -> None:
    path = SITE / "index.html"
    html = read(path)
    title = "Pool Safety Inspector Brisbane | IronGate Pool Inspections"
    description = (
        "Licensed pool safety inspector in Brisbane offering $149 pool barrier inspections, "
        "clear photo reports, practical repair guidance and certificates when compliant."
    )
    html = required_replace(
        html,
        "<title>Irongate Pool Inspections | Pool Safety Inspection & Certificate</title>",
        f"<title>{title}</title>",
        "homepage title",
    )
    html = re.sub(
        r'<meta name="description" content="[^"]*"\s*/>',
        f'<meta name="description" content="{description}" />',
        html,
        count=1,
    )
    html = required_replace(
        html,
        '<h1 id="hero-title">Pool Safety<br><span>Inspections.</span></h1>',
        '<h1 id="hero-title">Licensed Pool Safety<br><span>Inspector in Brisbane.</span></h1>',
        "homepage H1",
    )
    html = required_replace(
        html,
        '<p class="hero-lead">$149 pool barrier inspections for homeowners, sellers, landlords, real estate agents and property managers across Brisbane Southside.</p>',
        '<p class="hero-lead">Need a licensed pool safety inspector in Brisbane? IronGate provides $149 pool barrier inspections across Brisbane Southside, with clear photo reports, practical repair guidance, unlimited reinspections and a Pool Safety Certificate when the barrier is compliant.</p>',
        "homepage opening paragraph",
    )
    old_actions = """            <div class="hero-actions">
              <a class="btn btn-primary" href="/homeowner-checklist/">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l1 2h3v15H5V6h3l1-2Zm0 7h6M9 15h4M8 19h8"/></svg>
                Homeowner Checklist
              </a>
            </div>"""
    new_actions = """            <div class="hero-actions">
              <a class="btn btn-primary" href="/booking/">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3m10-3v3M5 9h14M6 5h12a1 1 0 0 1 1 1v14H5V6a1 1 0 0 1 1-1Zm3 8h6m-6 4h4"/></svg>
                Book a $149 Inspection
              </a>
              <a class="btn btn-secondary-light" href="/homeowner-checklist/">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l1 2h3v15H5V6h3l1-2Zm0 7h6M9 15h4M8 19h8"/></svg>
                Homeowner Checklist
              </a>
            </div>"""
    html = required_replace(html, old_actions, new_actions, "homepage calls to action")

    nav_marker = '      <a href="#services">Service</a>\n'
    nav_addition = nav_marker + '      <a href="/pool-safety-inspector-brisbane/">Brisbane Inspector</a>\n'
    if '/pool-safety-inspector-brisbane/' not in html.split("</nav>", 1)[0]:
        html = required_replace(html, nav_marker, nav_addition, "Brisbane navigation link")

    service_intro = '<p class="section-intro">If your pool is compliant, we issue the Pool Safety Certificate. If it needs work, you get a clear photo report and unlimited reinspections.</p>'
    service_link = service_intro + '\n        <p><a href="/pool-safety-inspector-brisbane/"><strong>Read about our licensed Brisbane pool safety inspection service.</strong></a></p>'
    if "Read about our licensed Brisbane" not in html:
        html = required_replace(html, service_intro, service_link, "service-page internal link")

    footer_links = """      <nav class="footer-links" aria-label="Footer links">
        <a href="/privacy/">Privacy Policy</a>
        <a href="/terms/">Terms &amp; Conditions</a>
        <a href="/refunds/">Refunds &amp; Cancellations</a>
      </nav>"""
    footer_links_new = """      <nav class="footer-links" aria-label="Footer links">
        <a href="/pool-safety-inspector-brisbane/">Brisbane Pool Safety Inspector</a>
        <a href="/privacy/">Privacy Policy</a>
        <a href="/terms/">Terms &amp; Conditions</a>
        <a href="/refunds/">Refunds &amp; Cancellations</a>
      </nav>"""
    html = required_replace(html, footer_links, footer_links_new, "homepage footer links")
    html = inject_seo(
        html,
        canonical=f"{DOMAIN}/",
        title=title,
        description=description,
        schema=homepage_schema(),
    )
    write(path, html)


def expand_checklist() -> None:
    path = SITE / "homeowner-checklist/index.html"
    html = read(path)
    guide = """
      <div class="container" id="common-pool-barrier-issues" style="max-width:980px;margin-bottom:34px;">
        <article class="legal-card" style="display:grid;gap:14px;">
          <p class="section-kicker">Prepare before inspection day</p>
          <h2>Common Brisbane pool barrier issues homeowners can check first</h2>
          <p>Many pool barriers need attention because a gate does not self-close from every open position, the latch is not operating reliably, climbable furniture or garden items are too close to the barrier, or vegetation has reduced the effective height of a fence. Windows and doors that provide access to the pool area can also affect compliance. Walk the entire barrier rather than checking only the gate you use most often.</p>
          <p>Move portable objects away from the barrier, trim vegetation that creates a foothold, make sure the CPR sign is readable and correctly positioned, and test each gate several times without helping it close. Do not make structural alterations unless you understand the applicable Queensland pool safety standard. This checklist is a practical preparation tool, not a substitute for an assessment by a licensed pool safety inspector.</p>
          <p>During an IronGate inspection, the pool barrier, gates, latches, hinges and non-climbable zones are assessed and documented with notes and photographs. A Pool Safety Certificate is issued when the pool is compliant. When work is required, you receive a clear repair list and practical guidance before the included reinspection process.</p>
          <p><a class="btn btn-card" href="/pool-safety-inspector-brisbane/">Learn about Brisbane pool safety inspections</a></p>
        </article>
      </div>
"""
    marker = '      <div class="container checker-layout">'
    if 'id="common-pool-barrier-issues"' not in html:
        html = required_replace(html, marker, guide + "\n" + marker, "checklist guide")
    title = "Homeowner Pool Safety Checklist Brisbane | IronGate"
    description = "Use IronGate's Brisbane homeowner pool barrier checklist to review common gate, fence, non-climbable-zone and CPR-sign issues before inspection day."
    html = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", html, count=1, flags=re.DOTALL)
    if re.search(r'<meta name="description"', html, flags=re.I):
        html = re.sub(
            r'<meta name="description" content="[^"]*"\s*/>',
            f'<meta name="description" content="{description}" />',
            html,
            count=1,
        )
    html = inject_seo(
        html,
        canonical=f"{DOMAIN}/homeowner-checklist/",
        title=title,
        description=description,
    )
    write(path, html)


def clean_internal_links(html: str) -> str:
    replacements = {
        'href="index.html#': 'href="/#',
        'href="index.html"': 'href="/"',
        'href="booking.html"': 'href="/booking/"',
        'href="success.html"': 'href="/success/"',
        'href="cancelled.html"': 'href="/cancelled/"',
        'href="privacy.html"': 'href="/privacy/"',
        'href="terms.html"': 'href="/terms/"',
        'href="refunds.html"': 'href="/refunds/"',
    }
    for old, new in replacements.items():
        html = html.replace(old, new)
    return html


def make_redirect(target: str, label: str) -> str:
    safe_target = target.replace("'", "%27")
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Redirecting | {BUSINESS_NAME}</title>
  <meta name="robots" content="noindex, follow" />
  <link rel="canonical" href="{DOMAIN}{target}" />
  <meta http-equiv="refresh" content="0; url={target}" />
  <script>window.location.replace('{safe_target}' + window.location.search + window.location.hash);</script>
</head>
<body>
  <main style="font-family:Arial,sans-serif;padding:40px;text-align:center">
    <h1>Redirecting</h1>
    <p><a href="{target}">Open {label}</a></p>
  </main>
</body>
</html>
"""


def make_clean_routes() -> None:
    routes = [
        ("booking.html", "booking/index.html", "/booking/", "Book a Pool Safety Inspection", True),
        ("success.html", "success/index.html", "/success/", "Booking Confirmed", True),
        ("cancelled.html", "cancelled/index.html", "/cancelled/", "Booking Cancelled", True),
        ("agency-booking-received.html", "agency-booking-received/index.html", "/agency-booking-received/", "Agency Booking Received", True),
        ("admin-timeblocks.html", "admin/index.html", "/admin/", "Admin Console", True),
        ("privacy.html", "privacy/index.html", "/privacy/", "Privacy Policy", False),
        ("terms.html", "terms/index.html", "/terms/", "Terms and Conditions", False),
        ("refunds.html", "refunds/index.html", "/refunds/", "Refunds and Cancellations", False),
    ]

    for legacy_name, clean_name, route, label, noindex in routes:
        legacy_path = SITE / legacy_name
        clean_path = SITE / clean_name
        existing_clean = read(clean_path) if clean_path.exists() else ""
        if "data-irongate-clean-route" in existing_clean and "fetch('/" not in existing_clean:
            html = existing_clean
        else:
            html = read(legacy_path)
        html = clean_internal_links(html)
        html = ensure_base(html)
        html = html.replace("<html lang=\"en\">", f'<html lang="en" data-irongate-clean-route="{route}">', 1)
        page_title_match = re.search(r"<title>(.*?)</title>", html, flags=re.DOTALL | re.I)
        page_title = page_title_match.group(1).strip() if page_title_match else f"{label} | {BUSINESS_NAME}"
        desc_match = re.search(r'<meta name="description" content="([^"]*)"', html, flags=re.I)
        description = desc_match.group(1) if desc_match else f"{label} for {BUSINESS_NAME}."
        html = inject_seo(
            html,
            canonical=f"{DOMAIN}{route}",
            title=page_title,
            description=description,
            robots="noindex, follow" if noindex else "index, follow, max-image-preview:large",
        )
        write(clean_path, html)
        write(legacy_path, make_redirect(route, label))

    # Preserve the historical availability URL as a redirect to the single admin route.
    availability = SITE / "admin-availability.html"
    if availability.exists():
        write(availability, make_redirect("/admin/", "Admin Console"))


def service_page() -> str:
    local_business = homepage_schema()[0]
    service_schema = {
        "@context": "https://schema.org",
        "@type": "Service",
        "@id": f"{DOMAIN}/pool-safety-inspector-brisbane/#service",
        "name": "Pool Safety Inspector Brisbane",
        "serviceType": "Pool safety inspection and pool barrier compliance assessment",
        "provider": {"@id": f"{DOMAIN}/#business"},
        "areaServed": {"@type": "City", "name": "Brisbane"},
        "offers": {
            "@type": "Offer",
            "price": "149",
            "priceCurrency": "AUD",
            "availability": "https://schema.org/InStock",
            "url": f"{DOMAIN}/booking/",
        },
    }
    faq_schema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": "How much is a pool safety inspection in Brisbane?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "IronGate's advertised residential pool safety inspection price is $149. The service includes the barrier inspection, written notes and photographs, practical repair guidance, certificate issue when compliant and included reinspections under the stated service terms.",
                },
            },
            {
                "@type": "Question",
                "name": "What happens if my pool barrier is not compliant?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "You receive a clear list of the items requiring attention, supported by notes and photographs. IronGate explains the next steps and returns for the included reinspection process after the work is completed.",
                },
            },
            {
                "@type": "Question",
                "name": "When is a Pool Safety Certificate issued?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "A Pool Safety Certificate is issued and lodged when the pool barrier is assessed as compliant with the applicable Queensland pool safety requirements.",
                },
            },
            {
                "@type": "Question",
                "name": "Which parts of Brisbane does IronGate service?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "IronGate is based on Brisbane Southside and provides inspections across Brisbane Southside and nearby Brisbane suburbs by appointment. Customers can contact IronGate to confirm availability for their property.",
                },
            },
        ],
    }
    structured = json.dumps([local_business, service_schema, faq_schema], ensure_ascii=False, separators=(",", ":"))
    return f"""<!doctype html>
<html lang="en">
<head>
  <base href="/" />
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pool Safety Inspector Brisbane | IronGate Pool Inspections</title>
  <meta name="description" content="Book a QBCC-licensed pool safety inspector in Brisbane. $149 pool barrier inspections with clear photo reports, practical repair guidance, included reinspections and certificates when compliant." />
  <link rel="canonical" href="{DOMAIN}/pool-safety-inspector-brisbane/" />
  <link rel="icon" href="/assets/logo-no-text.png" type="image/png" />
  <meta name="robots" content="index, follow, max-image-preview:large" />
  <meta property="og:locale" content="en_AU" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="{BUSINESS_NAME}" />
  <meta property="og:title" content="Pool Safety Inspector Brisbane | IronGate Pool Inspections" />
  <meta property="og:description" content="QBCC-licensed $149 pool safety inspections across Brisbane Southside, with clear reports and certificates when compliant." />
  <meta property="og:url" content="{DOMAIN}/pool-safety-inspector-brisbane/" />
  <meta property="og:image" content="{DOMAIN}/assets/hero_image_v2.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <script type="application/ld+json" id="irongate-structured-data">{structured}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/css/styles.css" />
  <style>
    .service-hero {{ padding:72px 0 54px; background:linear-gradient(135deg,#071834,#0b4770); color:#fff; }}
    .service-hero .container {{ max-width:1050px; }}
    .service-hero h1 {{ max-width:850px; margin:10px 0 18px; color:#fff; font-size:clamp(2.45rem,6vw,4.8rem); line-height:1.02; }}
    .service-hero p {{ max-width:820px; font-size:1.12rem; line-height:1.7; }}
    .service-actions {{ display:flex; flex-wrap:wrap; gap:12px; margin-top:26px; }}
    .service-actions a {{ text-decoration:none; }}
    .licence-line {{ margin-top:18px; font-weight:800; }}
    .licence-line a {{ color:#fff; }}
    .content-grid {{ display:grid; grid-template-columns:minmax(0,1.5fr) minmax(280px,.7fr); gap:34px; align-items:start; }}
    .content-stack {{ display:grid; gap:24px; }}
    .service-panel {{ padding:28px; border-radius:24px; background:#fff; border:1px solid rgba(7,24,52,.1); box-shadow:0 14px 34px rgba(4,26,55,.07); }}
    .service-panel h2,.service-panel h3 {{ margin-top:0; color:#071834; }}
    .service-panel p,.service-panel li {{ line-height:1.72; }}
    .service-panel ul,.service-panel ol {{ padding-left:22px; }}
    .price-card {{ position:sticky; top:22px; background:#071834; color:#fff; }}
    .price-card h2,.price-card h3 {{ color:#fff; }}
    .price-large {{ display:block; font-size:3.2rem; font-weight:900; margin:4px 0 12px; }}
    .faq-list details {{ border-top:1px solid rgba(7,24,52,.12); padding:16px 0; }}
    .faq-list details:first-of-type {{ border-top:0; }}
    .faq-list summary {{ cursor:pointer; color:#071834; font-weight:850; }}
    .service-footer-cta {{ text-align:center; background:#eef9ff; }}
    @media (max-width:820px) {{ .content-grid {{ grid-template-columns:1fr; }} .price-card {{ position:static; }} }}
  </style>
</head>
<body>
  <header class="site-header" id="top">
    <a class="brand" href="/" aria-label="IronGate Pool Inspections home">
      <span class="brand-mark" aria-hidden="true"><img src="/assets/logo-no-text.png" alt="" /></span>
      <span class="brand-copy"><span class="brand-name"><span class="brand-iron">IRON</span><span class="brand-gate">GATE</span></span><span class="brand-subtitle">POOL INSPECTIONS</span></span>
    </a>
    <button class="nav-toggle" type="button" aria-label="Open navigation" aria-expanded="false"><span></span><span></span><span></span></button>
    <nav class="main-nav" aria-label="Primary navigation">
      <a href="/">Home</a>
      <a class="active" href="/pool-safety-inspector-brisbane/">Brisbane Inspector</a>
      <a href="/homeowner-checklist/">Checklist</a>
      <a href="/booking/">Book</a>
    </nav>
  </header>

  <main>
    <section class="service-hero">
      <div class="container">
        <p class="section-kicker">QBCC-licensed local inspector</p>
        <h1>Pool Safety Inspector in Brisbane</h1>
        <p>Need a clear answer about your pool barrier? IronGate provides residential pool safety inspections across Brisbane Southside and nearby Brisbane suburbs by appointment. Every inspection includes a careful assessment of the barrier, gates, latches, hinges and non-climbable zones, supported by written notes and photographs.</p>
        <p>When the pool is compliant, the Pool Safety Certificate is issued and lodged. When work is needed, you receive practical repair guidance and a clear path to reinspection rather than a vague list of problems.</p>
        <div class="service-actions">
          <a class="btn btn-primary" href="/booking/">Book a $149 Inspection</a>
          <a class="btn btn-secondary-light" href="{PHONE_LINK}">Call {PHONE}</a>
        </div>
        <p class="licence-line">QBCC Pool Safety Inspector Licence: <a href="{QBCC_URL}" target="_blank" rel="noopener">PS15616387 — verify the licence</a></p>
      </div>
    </section>

    <section class="section">
      <div class="container content-grid">
        <div class="content-stack">
          <article class="service-panel">
            <p class="section-kicker">What the inspection covers</p>
            <h2>A documented pool barrier compliance assessment</h2>
            <p>A pool safety inspection is more than a quick look at the fence. IronGate follows the barrier around the pool area and checks the parts that control access. That includes gate operation, latch and hinge performance, barrier height and gaps, potential footholds and handholds, nearby climbable objects, vegetation, and relevant doors or windows that may provide access to the pool area.</p>
            <p>The findings are documented with notes and photographs using BarrierCheck. This gives homeowners, sellers, landlords, agents and property managers a clear record of what was observed and what happens next. The assessment is carried out by Kieren Albuquerque, a QBCC-licensed pool safety inspector based on Brisbane Southside.</p>
            <ul>
              <li>Full pool barrier inspection</li>
              <li>Gate, latch and hinge testing</li>
              <li>Non-climbable-zone and nearby-object checks</li>
              <li>Written notes and photographs</li>
              <li>Pool Safety Certificate issued when compliant</li>
              <li>Practical repair list when work is required</li>
              <li>Unlimited reinspections included under the service terms</li>
            </ul>
          </article>

          <article class="service-panel">
            <p class="section-kicker">Straightforward process</p>
            <h2>What happens before, during and after the inspection</h2>
            <ol>
              <li><strong>Book a time:</strong> Select an available inspection date and provide the property and access details through the online booking form.</li>
              <li><strong>Prepare the barrier:</strong> Remove portable climbable objects, trim vegetation where appropriate, test gates and make sure the CPR sign is visible. The free homeowner checklist can help you review common issues.</li>
              <li><strong>On-site assessment:</strong> The pool barrier and access points are inspected and documented. The property owner does not always need to be present when safe access has been arranged.</li>
              <li><strong>Clear outcome:</strong> A compliant pool progresses to certificate issue and lodgement. A non-compliant pool receives an understandable list of the items requiring attention, with supporting notes and photographs.</li>
              <li><strong>Reinspection:</strong> After repairs are completed, IronGate returns through the included reinspection process to check the corrected items and progress the pool toward a compliant outcome.</li>
            </ol>
            <p>Because each property and barrier is different, repair guidance is specific to the observed issue. Structural work should be completed by an appropriately qualified person where required.</p>
          </article>

          <article class="service-panel">
            <p class="section-kicker">Common problems</p>
            <h2>Why Brisbane pool barriers often need attention</h2>
            <p>Pool barriers can become non-compliant even when they were suitable when first installed. Gates drop over time, latches wear, hinges stop pulling the gate closed, landscaping changes and furniture is moved closer to the fence. A gate that closes only when pushed is not the same as a gate that reliably self-closes from the positions that must be tested.</p>
            <p>Other common concerns include climbable items inside a non-climbable zone, branches or screens that create footholds, excessive gaps below or through the barrier, damaged panels, and doors or windows that affect access to the pool area. The purpose of the inspection is to identify the actual condition at the property and explain the result in practical language.</p>
            <p>Start with the <a href="/homeowner-checklist/">IronGate homeowner pool barrier checklist</a>. It is designed to help you notice common issues before inspection day, while making clear that only a licensed inspection can determine the formal outcome.</p>
          </article>

          <article class="service-panel">
            <p class="section-kicker">Who we assist</p>
            <h2>Homeowners, property transactions and managed properties</h2>
            <p>IronGate works with homeowners who want certainty about an existing barrier, sellers preparing a property, landlords and property managers arranging compliance work, and agents coordinating access and documentation. The booking form collects the inspection reason, pool type, certificate status and access information so the appointment can be prepared efficiently.</p>
            <p>For selling or leasing situations, timing matters. Book as early as practical so there is time to address any barrier issues before a contractual or tenancy deadline. IronGate provides a documented result and clear communication, but customers should obtain legal or conveyancing advice about their own transaction obligations.</p>
          </article>

          <article class="service-panel">
            <p class="section-kicker">Service area</p>
            <h2>Brisbane Southside pool safety inspections</h2>
            <p>IronGate is based on Brisbane Southside and services Brisbane Southside and nearby Brisbane suburbs by appointment. Availability varies with travel time and the existing booking calendar, so enter the inspection property address when booking or call to confirm coverage.</p>
            <p>The website uses the property address to support booking and pool-register checks. Accurate address and access details help prevent delays, particularly for tenanted properties, gated complexes and appointments where the owner will not be present.</p>
          </article>

          <article class="service-panel faq-list">
            <p class="section-kicker">Frequently asked questions</p>
            <h2>Pool safety inspection questions</h2>
            <details open><summary>How much is a pool safety inspection?</summary><p>IronGate's advertised residential inspection price is $149. It includes the inspection, notes and photographs, practical repair guidance, certificate issue when compliant and unlimited reinspections under the stated service terms. Review the booking and service terms before payment.</p></details>
            <details><summary>Will I receive a certificate on the first visit?</summary><p>A Pool Safety Certificate can be issued when the barrier is compliant. When defects are found, you receive the inspection outcome and repair guidance first; the certificate follows after the barrier is brought into compliance and successfully reinspected.</p></details>
            <details><summary>Do I need to be home?</summary><p>Not always. Safe and lawful access must be arranged, and animals or other site risks must be managed. Provide accurate access instructions in the booking form and IronGate will contact you when details need clarification.</p></details>
            <details><summary>How should I prepare?</summary><p>Test every gate, remove portable climbable objects from around the barrier, trim vegetation that may create access, check visible damage and make sure the CPR sign is readable. Avoid unqualified structural changes and use the homeowner checklist as a preparation guide.</p></details>
          </article>
        </div>

        <aside class="service-panel price-card" aria-label="Inspection price and booking">
          <p class="section-kicker">Transparent price</p>
          <h2>Pool Safety Inspection &amp; Certificate</h2>
          <span class="price-large">$149</span>
          <p>One advertised residential inspection price with the documented assessment, practical guidance and included reinspection support described on this website.</p>
          <p><a class="btn btn-primary" href="/booking/">Choose an Available Time</a></p>
          <p><a href="{PHONE_LINK}" style="color:#fff;font-weight:850;">{PHONE}</a><br /><a href="mailto:{EMAIL}" style="color:#fff;">{EMAIL}</a></p>
          <p><strong>Licence PS15616387</strong><br /><a href="{QBCC_URL}" target="_blank" rel="noopener" style="color:#fff;">Verify with QBCC</a></p>
        </aside>
      </div>
    </section>

    <section class="section service-footer-cta">
      <div class="container">
        <p class="section-kicker">Ready for a clear outcome?</p>
        <h2>Book your Brisbane pool safety inspection</h2>
        <p>Select an available appointment online or call IronGate to confirm service-area availability.</p>
        <div class="service-actions" style="justify-content:center;">
          <a class="btn btn-primary" href="/booking/">Book a $149 Inspection</a>
          <a class="btn btn-card" href="{PHONE_LINK}">Call {PHONE}</a>
        </div>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="footer-inner">
      <div class="footer-brand"><strong>{BUSINESS_NAME}</strong><span>Pool safety inspections across Brisbane</span></div>
      <div class="footer-details">
        <span>ABN: 25 342 746 679</span>
        <span>QBCC Pool Safety Inspector Licence: <a href="{QBCC_URL}" target="_blank" rel="noopener">PS15616387</a></span>
        <a href="{PHONE_LINK}">{PHONE}</a>
        <a href="mailto:{EMAIL}">{EMAIL}</a>
      </div>
      <nav class="footer-links" aria-label="Footer links">
        <a href="/">Home</a><a href="/homeowner-checklist/">Checklist</a><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a><a href="/refunds/">Refunds</a>
      </nav>
      <p class="footer-copy">&copy; <span id="year"></span> {BUSINESS_NAME}. All rights reserved.</p>
    </div>
  </footer>
  <script src="/js/script.js"></script>
</body>
</html>
"""


def write_service_page() -> None:
    write(SITE / "pool-safety-inspector-brisbane/index.html", service_page())


def update_remaining_indexable_pages() -> None:
    pages = {
        SITE / "privacy/index.html": (
            f"{DOMAIN}/privacy/",
            "Privacy Policy | IronGate Pool Inspections",
            "Read how IronGate Pool Inspections collects, uses and protects personal information provided through the website and booking process.",
        ),
        SITE / "terms/index.html": (
            f"{DOMAIN}/terms/",
            "Terms and Conditions | IronGate Pool Inspections",
            "Read the service and website terms for IronGate Pool Inspections, including booking, inspection and customer responsibilities.",
        ),
        SITE / "refunds/index.html": (
            f"{DOMAIN}/refunds/",
            "Refunds and Cancellations | IronGate Pool Inspections",
            "Read IronGate Pool Inspections' refund, cancellation and rescheduling information for pool safety inspection bookings.",
        ),
    }
    for path, (canonical, title, description) in pages.items():
        html = read(path)
        html = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", html, count=1, flags=re.DOTALL)
        if re.search(r'<meta name="description"', html, flags=re.I):
            html = re.sub(
                r'<meta name="description" content="[^"]*"\s*/>',
                f'<meta name="description" content="{description}" />',
                html,
                count=1,
            )
        else:
            html = html.replace("</title>", f'</title>\n  <meta name="description" content="{description}" />', 1)
        html = inject_seo(html, canonical=canonical, title=title, description=description)
        write(path, html)


def write_technical_files() -> None:
    lastmod = date.today().isoformat()
    sitemap = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>{DOMAIN}/</loc><lastmod>{lastmod}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>{DOMAIN}/pool-safety-inspector-brisbane/</loc><lastmod>{lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>
  <url><loc>{DOMAIN}/homeowner-checklist/</loc><lastmod>{lastmod}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>{DOMAIN}/privacy/</loc><lastmod>{lastmod}</lastmod><changefreq>yearly</changefreq><priority>0.2</priority></url>
  <url><loc>{DOMAIN}/terms/</loc><lastmod>{lastmod}</lastmod><changefreq>yearly</changefreq><priority>0.2</priority></url>
  <url><loc>{DOMAIN}/refunds/</loc><lastmod>{lastmod}</lastmod><changefreq>yearly</changefreq><priority>0.2</priority></url>
</urlset>
"""
    robots = f"""User-agent: *
Allow: /
Disallow: /admin/
Disallow: /success/
Disallow: /cancelled/
Disallow: /agency-booking-received/

Sitemap: {DOMAIN}/sitemap.xml
"""
    write(SITE / "sitemap.xml", sitemap)
    write(SITE / "robots.txt", robots)

    not_found = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Page Not Found | {BUSINESS_NAME}</title>
  <meta name="robots" content="noindex, follow" />
  <link rel="icon" href="/assets/logo-no-text.png" type="image/png" />
  <style>body{{margin:0;font-family:Arial,sans-serif;background:#f6fbff;color:#071834}}main{{min-height:100vh;display:grid;place-items:center;padding:32px;text-align:center}}a{{color:#0878bd;font-weight:700}}</style>
</head>
<body><main><div><h1>Page not found</h1><p>The page you requested could not be found.</p><p><a href="/">Return home</a> · <a href="/pool-safety-inspector-brisbane/">Brisbane pool safety inspections</a> · <a href="/booking/">Book an inspection</a></p></div></main></body>
</html>
"""
    write(SITE / "404.html", not_found)


def update_all_html_links() -> None:
    for path in SITE.rglob("*.html"):
        html = read(path)
        updated = clean_internal_links(html)
        updated = updated.replace('href="privacy.html"', 'href="/privacy/"')
        updated = updated.replace('href="terms.html"', 'href="/terms/"')
        updated = updated.replace('href="refunds.html"', 'href="/refunds/"')
        write(path, updated)


def validate() -> None:
    failures: list[str] = []
    price_paths = [
        ROOT / "functions-payments/index.js",
        ROOT / "functions-email/index.js",
        ROOT / "functions/booking-email.js",
        ROOT / "functions/index.js",
        ROOT / "firestore.rules",
        SITE / "js/booking.js",
        SITE / "booking/index.html",
        SITE / "success/index.html",
        SITE / "cancelled/index.html",
    ]
    for path in price_paths:
        if not path.exists():
            continue
        text = read(path)
        if "$249" in text or re.search(r"(?<!\d)24900(?!\d)", text):
            failures.append(f"stale price in {path.relative_to(ROOT)}")

    homepage = read(SITE / "index.html")
    required_home = [
        "Pool Safety Inspector Brisbane | IronGate Pool Inspections",
        "Licensed Pool Safety<br><span>Inspector in Brisbane.</span>",
        f'<link rel="canonical" href="{DOMAIN}/"',
        "/pool-safety-inspector-brisbane/",
        "Book a $149 Inspection",
        "Inspection video coming soon",
    ]
    for item in required_home:
        if item not in homepage:
            failures.append(f"homepage missing {item}")

    all_site_text = "\n".join(
        read(path) for path in SITE.rglob("*") if path.is_file() and path.suffix in {".html", ".js", ".txt"}
    )
    if "https://example.com/qbcc-pool-safety-inspector-search" in all_site_text:
        failures.append("placeholder QBCC URL remains")

    indexable = [
        SITE / "index.html",
        SITE / "pool-safety-inspector-brisbane/index.html",
        SITE / "homeowner-checklist/index.html",
        SITE / "privacy/index.html",
        SITE / "terms/index.html",
        SITE / "refunds/index.html",
    ]
    for path in indexable:
        if not path.exists():
            failures.append(f"missing {path.relative_to(ROOT)}")
        elif 'rel="canonical"' not in read(path):
            failures.append(f"canonical missing from {path.relative_to(ROOT)}")

    service = read(SITE / "pool-safety-inspector-brisbane/index.html")
    for item in ["PS15616387", "FAQPage", "Book a $149 Inspection", "Brisbane Southside"]:
        if item not in service:
            failures.append(f"service page missing {item}")

    if not (SITE / "sitemap.xml").exists() or not (SITE / "robots.txt").exists():
        failures.append("robots.txt or sitemap.xml missing")

    wrappers = [SITE / "booking/index.html", SITE / "success/index.html", SITE / "admin/index.html"]
    for path in wrappers:
        text = read(path)
        if "document.write(html)" in text or "fetch('/booking.html'" in text:
            failures.append(f"JavaScript wrapper remains in {path.relative_to(ROOT)}")

    if failures:
        raise RuntimeError("Validation failed:\n- " + "\n- ".join(failures))


def main() -> None:
    replace_price_and_links()
    update_homepage()
    expand_checklist()
    make_clean_routes()
    write_service_page()
    update_remaining_indexable_pages()
    update_all_html_links()
    write_technical_files()
    validate()
    print("Updated files:")
    for path in changed:
        print(f"- {path}")
    print(f"Total: {len(changed)} file(s)")


if __name__ == "__main__":
    main()
