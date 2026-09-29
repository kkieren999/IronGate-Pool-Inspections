# Operations

## Admin and availability

Sign in at /admin/ using the configured Firebase Authentication administrator. Manage one-hour slots and partner records. The private same-day invitation panel reserves the selected hour and its following buffer. The public calendar reads Firestore availability.

## Payment and notifications

Stripe Checkout is opened through functions-payments. Its webhook records payment; the separate availability and calendar functions react to booking changes. functions-email sends confirmations and updates using the GMAIL_APP_PASSWORD Firebase secret. Old Firestore mail-queue and SendGrid source paths are retired in this branch; verify and separately decommission any deployed remnants before relying on their absence.

## Troubleshooting

Inspect payment function/webhook logs and Firestore booking state for payment issues; functions-email and its Gmail secret for email; availability documents and functions-availability logs for scheduling; functions-calendar credentials/logs for calendar issues. For admin login verify Firebase Authentication, approved domain and admin authorization.

The exemption document attachment is **not uploaded by the current checkout flow**. See ARCHITECTURE.md. Do not claim that a checked exemption box transmits a file.
