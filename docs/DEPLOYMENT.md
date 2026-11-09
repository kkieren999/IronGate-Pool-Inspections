# Build and deployment

1. Review PR checks, the diff and all public route redirects before merging.
2. Run Node 22 verification and static build commands from README.md.
3. Manually test payment in Stripe test mode, webhook confirmation, email, slot locking, calendar events and private invitations in an appropriate environment. Static checks do not test external integrations.
4. Inventory deployed Firebase functions/extensions before decommissioning an old trigger; deleting a source export does not delete the cloud resource.
5. Check actual live Storage rules before running the separate manual Storage rules deploy.

static.yml builds website/ to public/, copies root CNAME and publishes that artifact. It no longer patches old prices or licence placeholders during deploy. The PR verification workflow builds but never deploys.

Main-branch workflows deploy payments, email, calendar, availability and Firestore rules with their separate codebases. The default functions/ codebase is not automatically deployed by the current workflows; its old cloud functions require a manual audit. Storage rules have a manual-only workflow; the previous automatic workflow deployed only Firestore.

Reverting a merge restores Git source; it does not undo Stripe payments, Firestore documents, or deployed cloud resources.

## Booking service-area activation (required before merging the service-area PR)

- Set a Firebase Secret Manager secret named `GEOAPIFY_SERVICE_AREA_KEY` in project `irongate-pool-inspection-256b4` using a server-capable Geoapify API key enabled for Geocoding and Routing. Do not put the server key in GitHub or website files. If the existing browser key is referrer-restricted, create a distinct server key with suitable quota restrictions.
- `createBookingCheckoutSession` and the new `checkBookingServiceArea` callable must both have access to that secret. The payments deployment workflow deploys both functions.
- Before merging, test the new callable against real Mansfield/southside, north-bank and over-25-minute property addresses in a test project. Verify the current Brisbane City Council river GIS endpoint responds with complete GeoJSON geometries. The server deliberately fails closed if routing or waterway checks cannot be verified. A deployment without the secret or a working data provider will prevent normal online bookings.
- Online eligibility uses a 25-minute Geoapify approximated-traffic driving route from Mansfield suburb centre (not a precise business street address). Backend river-crossing parity is an internal operational restriction; do not disclose it in public pages or error responses. If the business chooses a different origin, update the reference point and regression tests before launch.
- Check that both the static form and Firebase callable deployments have completed before trying a live test booking. A merge triggers separate deployment workflows, which may finish in either order.

## Stripe deployment and Artifact Registry

Firebase may update all three Stripe functions successfully and then return a nonzero exit code because the deployment service account cannot configure the Artifact Registry cleanup policy. The Stripe workflow treats *only* that known post-deployment error as a warning, and only when its own log confirms successful updates for `createBookingCheckoutSession`, `createAgencyInvoiceBooking`, and `stripeWebhook`. All other failures remain failures. It does not use the broad `--force` flag.

The storage cleanup policy itself remains **unconfigured** until fixed in Google Cloud. An administrator should grant the deployment service account used by the GitHub `FIREBASE_SERVICE_ACCOUNT` secret the required Artifact Registry repository-update permissions (for example `roles/artifactregistry.admin`) on the appropriate project or repository, then configure a retention policy for `us-central1` and verify it. Stale build images may accrue storage charges until that is done. Image retention changes do not delete live Cloud Functions; this is separate from the website and payment deployment.
