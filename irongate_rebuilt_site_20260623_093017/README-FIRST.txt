IRONGATE FIRESTORE BOOKING SITE — CALENDAR VERSION

This zip contains your website with a visible booking calendar added to booking.html.

WHAT IS INCLUDED
- index.html updated so booking buttons go to booking.html
- booking.html with a visible monthly calendar
- js/booking.js saves bookings into Firestore
- js/firebase-config.js with your Firebase frontend config
- css/styles.css with calendar styles
- success.html and cancelled.html placeholders for later Stripe setup
- firestore.rules with bookings + availability rules
- AVAILABILITY-SETUP.txt with click-by-click availability document examples

TEST ORDER
1. Upload/publish the updated firestore.rules in Firebase Console > Firestore Database > Rules.
2. Open booking.html using Live Server or your web hosting.
3. Confirm the calendar appears.
4. Fill out the booking form.
5. Choose an available date.
6. Click Save Booking Test.
7. Check Firebase Console > Firestore Database > bookings.

AVAILABILITY DEFAULTS
- Weekdays are available by default.
- Weekends are unavailable by default.
- Past dates are unavailable.
- You can override any date using the availability collection in Firestore.

STRIPE STATUS
Stripe is not connected in this version yet.
This version is still for testing Firestore booking capture and the visible calendar.
