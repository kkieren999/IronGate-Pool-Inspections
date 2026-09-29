# Cleanup review — 2026-09-29

Source cleanup is not a live Firebase runtime inventory.

## Removed from published website

The licence replacement shim site-licence.js (the actual number is now written in booking HTML), unused standalone admin-availability.js and admin-bookings.js (current admin console is now js/admin-console.js), the alternate booking-direct-checkout.js, unused retry-payment.js, stale nested firestore.rules, old hero_image.png, duplicate docs/CNAME, and setup notes describing pre-Stripe builds. Git history retains source if an intentionally dormant feature must be restored. All existing clean routes and .html redirect stubs are retained.

## Retired source

Unused SendGrid functions/booking-email.js; old default-codebase queueBookingNotificationEmail and its mail-template helpers; alternate createBookingAndCheckoutSession export. Current Gmail email, pool lookup, createBookingCheckoutSession new/existing-booking modes, Stripe webhook, availability and calendar code remain.

**Before decommissioning deployed functions:** inspect Firebase for the old queue trigger, SendGrid notification function, alternate checkout callable and Firestore Trigger Email extension. Remove deployed remnants only after verifying replacements. This PR does not delete live cloud functions.

## Existing limitations, not silently modified

- Backend checkout records hasPoolExemption but does not upload an attachment. The former upload was inside an intercepted old submit handler. Implement a secure upload separately if required.
- The current createAgencyInvoiceBooking callable rejects website requests; confirm business needs before changing.
- Live Storage rules are unknown from repository read-only access. A new workflow is manual-only, not an implicit production change.
- The unuploaded hero video remains a placeholder.
- External Stripe, Gmail, Firebase and calendar end-to-end tests require access to appropriate runtime/test environments.
