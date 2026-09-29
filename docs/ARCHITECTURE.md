# Architecture

Pages publishes website/ as its root. Clean-route directories and historical .html redirect entry points remain. The future hero-video MP4 is intentionally absent; its placeholder is retained.

## Browser

- js/booking.js: calendar, address suggestions and pool-register UI; no booking-submit handler.
- js/booking-stripe.js: sole submit handler and Stripe/private-invitation checkout.
- js/admin-console.js: current availability and partner manager, extracted from inline HTML.
- js/admin-private-booking.js: live private same-day invitations, explicitly imported by admin-console.js.
- js/firebase-config.js: shared Firebase app/Firestore without admin-specific autoload.
- js/booking-customer-type.js: active presentation helper. Licence number is now in page source, not patched at deploy or runtime.
- js/script.js and js/homeowner-checklist.js: shared site UI/checklist.

## Backend and dependency boundaries

| Package | Purpose |
| --- | --- |
| functions/ | poolRegisterLookup in the default codebase |
| functions-payments/ | createBookingCheckoutSession, createAgencyInvoiceBooking and stripeWebhook |
| functions-email/ | bookingNotificationEmail on booking changes |
| functions-availability/ | lockAvailabilityAfterPayment |
| functions-calendar/ | createCalendarEventAfterPayment |

createBookingCheckoutSession handles both a new booking payload and the existing bookingId used by private invites; preserve both. createAgencyInvoiceBooking currently rejects website requests, so the public agency invoice process is not assumed active.

Authoritative Firestore and Storage rule files live at repository root. Removing a source function does NOT delete an existing Firebase deployment.

The exemption field captures hasPoolExemption, but the current backend checkout does not upload the attached file. The previous upload lived in a direct-submit handler that Stripe intercepted. A secure, verified upload implementation must be separate work before describing attachments as delivered.
