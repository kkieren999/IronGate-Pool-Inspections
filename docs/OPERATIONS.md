# Operations

## Admin and availability

Sign in at /admin/ using the configured Firebase Authentication administrator. Manage one-hour slots and partner records. The private same-day invitation panel reserves the selected hour and its following buffer. The public calendar reads Firestore availability.

## Payment and notifications

Stripe Checkout is opened through functions-payments. Its webhook records payment; the separate availability and calendar functions react to booking changes. functions-email sends confirmations and updates using the GMAIL_APP_PASSWORD Firebase secret. Old Firestore mail-queue and SendGrid source paths are retired in this branch; verify and separately decommission any deployed remnants before relying on their absence.

## Troubleshooting

Inspect payment function/webhook logs and Firestore booking state for payment issues; functions-email and its Gmail secret for email; availability documents and functions-availability logs for scheduling; functions-calendar credentials/logs for calendar issues. For admin login verify Firebase Authentication, approved domain and admin authorization.

The exemption document attachment is **not uploaded by the current checkout flow**. See ARCHITECTURE.md. Do not claim that a checked exemption box transmits a file.


## Admin booking operations (review branch only until approved)
The tabbed admin dashboard shows the latest 150 bookings; access is restricted by Firebase Authentication and Firestore rules to the existing owner account. Move and cancellation calls use the authenticated callable functions adminMoveBooking and adminCancelBooking. Both verify the Firebase UID and its current server-side email, then update booking and availability in a single Firestore transaction, recording an immutable server-written adminActivity event and a unique action ID for retry safety.

A move reserves the destination hour and following buffer before committing, then releases the old booking's owned slots. Cancelling requires a reason and an explicit refund decision: no refund or separate refund review. Cancellation itself does NOT initiate a Stripe refund, and changing paymentStatus in Firestore must never be used to represent a refund. Reopening an old public slot is an explicit choice, disabled by default for cancellation. Private-invite slots restore their saved original state. If a legacy slot is not owned by the booking or availability is missing, the action fails safely pending manual review.

After the booking write, the existing calendar and email triggers independently update/delete the Google Calendar event and send a stable-UID ICS REQUEST/CANCEL notice to the customer. Calendar and email outcomes are asynchronous; inspect calendarSyncStatus and customerNotificationError/SentId after any operation. Test in a separate Firebase/Stripe test project before deploying. Do not merge the stacked PRs out of order.
