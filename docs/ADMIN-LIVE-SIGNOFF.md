# IronGate admin live sign-off

**Source/build tests and successful deployment do not prove real Stripe, Firebase, Gmail and Google Calendar service behaviour. Do not test using a customer's actual booking or payment.**

## Stripe (owner action)

1. In Stripe Dashboard select the correct account and mode: Live for production; Test/Sandbox for staging.
2. Open Workbench > Webhooks > Event destinations (older UI: Developers > Webhooks). Open the EXISTING IronGate endpoint. Compare its destination URL to the real deployed Firebase stripeWebhook URL in project irongate-pool-inspection-256b4, us-central1.
3. Keep checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.expired and checkout.session.async_payment_failed. Add refund.created, refund.updated and refund.failed. Use snapshot/v1 events, not a different thin event schema.
4. Confirm the endpoint is enabled. Ensure its signing secret matches the configured Firebase STRIPE_WEBHOOK_SECRET without exposing secret values. Inspect Event deliveries for HTTP 2xx, not signature 400 or handler 500.
5. The new Payments-tab Refresh refund status from Stripe action reads the current Stripe refund balance; it never issues a refund. It does not replace automatic webhook delivery.

## Google Calendar and email (owner action)

1. Find the runtime service-account email for createCalendarEventAfterPayment in Google Cloud / Cloud Run function settings. It may differ from the GitHub deployment service account.
2. In the correct Google Calendar's sharing settings grant that exact runtime identity permission to make changes to events. Compare the calendar's ID against the existing GOOGLE_CALENDAR_ID secret privately.
3. Verify the bookingNotificationEmail function has the GMAIL_APP_PASSWORD secret available and can send through the configured mailbox. Never share app passwords.
4. Review the event and actual revised/cancelled ICS invite in a test inbox. Importing or accepting invitations in a personal calendar may require customer action.

## Staging: real-service test before production sign-off

Use a SEPARATE Firebase/Firestore project and nonproduction site configuration, Stripe test-mode keys and webhook signing secret, and a test calendar and test inbox. Never replace live production secrets with test secrets, and never switch the live public booking form to test mode. Use synthetic names and details and the Stripe test card 4242 4242 4242 4242 with a future expiry and any three-digit CVC.

Run these tests and record IDs, outcomes and errors:

1. Checkout creates a paid/confirmed booking and holds its inspection time and following one-hour buffer. Exactly one calendar event and initial email/ICS appear.
2. Move booking to another future date and available time: new slot/buffer owned, old slot/buffer released only as selected, SAME Google event ID patched, new customer ICS has stable UID and greater SEQUENCE. Reject a conflicting slot without changing the original.
3. Cancel another test booking with no refund: booking cancelled, calendar event deleted, ICS CANCEL delivered, and Stripe payment NOT refunded. No repeating calendar-trigger writes.
4. For a different paid test booking, issue a partial test refund, then refund the remainder; verify Stripe amounts, Firestore totals, audit and notification. Reconcile with Refresh from Stripe and confirm a repeated webhook does not duplicate the customer notice. No automatic cancellation.
5. Issue a test refund directly in Stripe Dashboard; ensure refund event delivery returns 2xx and booking refund accounting updates.
6. Try expired checkout and a paid checkout with a missing/foreign-owned slot: no other booking's slot can be stolen. A payment_exception requires human allocation.
7. Test a refund needing manual review: check Stripe PaymentIntent/refund first; do not issue a second refund blindly.
8. Test owner versus other user/unauthenticated access to callable functions and private Firestore collections.

Check Firebase/Google Cloud logs for stripeWebhook, adminRefundBooking, adminReconcileBookingRefunds, adminMoveBooking, adminCancelBooking, createCalendarEventAfterPayment, bookingNotificationEmail and lockAvailabilityAfterPayment. If a notification or calendar step fails, communicate with the customer manually rather than claiming completion.

## Live troubleshooting

- refundStatus needs_review: inspect the exact Stripe PaymentIntent/refund in the same mode, use Refresh from Stripe, and investigate the refundOperations audit. Do not manually mark Firestore refunded.
- payment_exception or availabilityLockStatus conflict: payment captured but time not held; contact customer, manually allocate a valid slot and investigate reservation/payment logs.
- calendarSyncStatus failed/not_linked: check calendar ID, runtime service-account sharing and cloud logs.
- Email Pending/Failed: inspect SMTP secret and function logs. An SMTP send result does not mean the customer opened or accepted an ICS.

Never send payment keys, webhook signing secrets, app passwords or full service-account JSON in screenshots.