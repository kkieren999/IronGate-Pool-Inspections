IRONGATE FIRESTORE BOOKING SITE — CALENDAR VERSION

This site includes the IronGate public website, booking form, visible booking calendar and Firebase booking capture.

WHAT IS INCLUDED
- index.html with booking links to booking.html
- booking.html with a visible monthly calendar and customer-facing booking request copy
- js/booking.js saves booking requests into Firestore
- js/firebase-config.js with the Firebase frontend config
- css/styles.css with calendar styles
- success.html and cancelled.html placeholders for the upcoming Stripe setup
- firestore.rules with bookings + availability rules
- AVAILABILITY-SETUP.txt with click-by-click availability document examples
- functions-email/ with the deployed Gmail notification function

CURRENT BOOKING FLOW
1. Customer opens booking.html.
2. Customer fills out the booking form.
3. Customer chooses an available date and 1-hour time slot.
4. Customer clicks Submit Booking Request.
5. The booking is saved in Firestore > bookings with status pending_payment and paymentStatus unpaid.
6. The bookingNotificationEmail Firebase Function emails irongate.pool.bne@gmail.com.

AVAILABILITY DEFAULTS
- Weekdays are available by default.
- Weekends are unavailable by default.
- Past dates are unavailable.
- You can override any date using the availability collection in Firestore.

EMAIL NOTIFICATIONS
- Booking notification emails are handled by the separate Firebase Functions codebase in functions-email.
- The function name is bookingNotificationEmail.
- It runs in us-central1 and listens for new Firestore documents at bookings/{bookingId}.
- It sends email through Gmail SMTP using the Firebase secret GMAIL_APP_PASSWORD.

STRIPE STATUS
Stripe is not connected yet.
The next build phase is to change the booking button to Continue to Secure Payment, create a Stripe Checkout Session from Firebase Functions, redirect the customer to Stripe, and use a Stripe webhook to mark the booking as paid.
