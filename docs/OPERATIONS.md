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


## Refund workflow — draft PR, not live until owner approval
The Payments & refunds tab allows the existing authenticated owner to request an explicit full or partial refund with a reason and confirmation. Cancelling an appointment never refunds money automatically; the admin must separately decide and request a refund. A refund does not cancel or reschedule the booking.

adminRefundBooking validates the current Firebase Auth account server-side, reserves a refund-operation ID in a Firestore transaction, reads the captured AUD PaymentIntent and all existing refunds directly from Stripe, rejects requests above the remaining balance, and calls Stripe with an idempotency key. Uncertain Stripe outcomes lock further refund requests until the operator reconciles Stripe manually, to avoid a duplicate refund. The Firestore refundOperations ledger is read-only to browser clients and server-owned. Refund records are reconciled from Stripe statuses, not by changing booking paymentStatus. The customer receives a separate refund email when a successful refund is first recorded.

**Required manual activation:** In Stripe Dashboard, open Developers > Webhooks and add refund.created, refund.updated and refund.failed to the existing Stripe webhook endpoint (keep the existing Checkout events). Verify the actual endpoint URL and signing secret before enabling, including test/live mode separation. Events from refunds issued directly in Stripe Dashboard must also reconcile. Do not paste API keys or webhook signing secrets into GitHub source.

**Before a production merge:** Use an isolated Firebase test project and Stripe test-mode API keys/webhook secret. Test (1) authenticated owner vs other/unsigned users, (2) full and partial refunds, (3) a pending refund and duplicate invocation, (4) insufficient balance and refunds issued in Dashboard, (5) failed/refund.updated events, (6) cancellation without refund versus separately chosen refund, (7) calendar event patch/delete and customer ICS email, (8) slots and buffer conflicts and admin audit history. Review failures in functions-payments, functions-email and functions-calendar logs. Verify real service permissions, Stripe webhook subscriptions and email delivery before switching to live-mode keys. Do not merge or deploy these draft PRs without approval.
