# IronGate Pool Inspections

Static website on GitHub Pages; Firebase for bookings, availability, admin, notifications and calendar events; Stripe Checkout for payments.

| Location | Purpose |
| --- | --- |
| website/ | Production site, published as the root of Pages with existing URLs. |
| functions/ | Default backend: Queensland pool-register lookup. |
| functions-payments/ | Booking creation, Stripe Checkout and webhook. |
| functions-email/ | Booking and update email. |
| functions-availability/ | Confirmed-booking locking. |
| functions-calendar/ | Calendar event lifecycle. |
| firestore.rules, storage.rules | Authoritative security rules. |
| firebase*.json | Separate deployment configurations. |
| .github/workflows/ | PR checks and site/Firebase deployment. |
| scripts/, tests/ | Dependency-free build and regression checks. |
| docs/ | Current architecture, operations, deployment and cleanup notes. |

Node 22 commands:

    node --test tests/site.test.mjs
    node scripts/build-site.mjs
    SITE_ROOT=public node --test tests/site.test.mjs

public/ is generated and ignored by Git. Build copies website/ and root CNAME without rewriting business data, pricing or URLs. A PR check does not deploy production. Merging to main triggers the existing main-branch deployment workflows, so review the diff and impact before merging.

Read [architecture](docs/ARCHITECTURE.md), [operations](docs/OPERATIONS.md), [deployment](docs/DEPLOYMENT.md) and [cleanup review](docs/CLEANUP-REVIEW.md).
