#!/usr/bin/env python3
"""Remove accidental double slashes introduced while converting legacy routes."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "irongate_rebuilt_site_20260623_093017"
ROUTES = (
    "booking",
    "success",
    "cancelled",
    "agency-booking-received",
    "admin",
    "privacy",
    "terms",
    "refunds",
    "pool-safety-inspector-brisbane",
    "homeowner-checklist",
)

changed = []

for path in SITE.rglob("*"):
    if not path.is_file() or path.suffix.lower() not in {".html", ".js", ".txt", ".md"}:
        continue
    text = path.read_text(encoding="utf-8")
    updated = text
    for route in ROUTES:
        updated = updated.replace(f"//{route}/", f"/{route}/")
    updated = updated.replace("//#", "/#")
    if updated != text:
        path.write_text(updated, encoding="utf-8")
        changed.append(str(path.relative_to(ROOT)))

failures = []
for path in SITE.rglob("*"):
    if not path.is_file() or path.suffix.lower() not in {".html", ".js", ".txt", ".md"}:
        continue
    text = path.read_text(encoding="utf-8")
    for route in ROUTES:
        if f"//{route}/" in text:
            failures.append(f"{path.relative_to(ROOT)} still contains //{route}/")
    if "//#" in text:
        failures.append(f"{path.relative_to(ROOT)} still contains //#")

if failures:
    raise RuntimeError("Clean-route validation failed:\n- " + "\n- ".join(failures))

print("Clean-route slash fixes:")
for item in changed:
    print(f"- {item}")
print(f"Total: {len(changed)} file(s)")
