IronGate Time-Slot Admin Console
================================

What changed:
- admin-availability.html now manages 1-hour time slots for each date.
- booking.html now shows available time slots after the client selects a date.
- Clients can select only one slot per booking.
- Bookings save preferredTimeSlot and preferredTimeLabel into Firestore.

How to use:
1. Upload all files to GitHub / hosting.
2. Publish the Firestore rules from firestore.rules.
3. Open admin-availability.html.
4. Sign in with irongate.pool.bne@gmail.com.
5. Click a date.
6. Use Standard day, Morning only, Afternoon only, or Closed.
7. Toggle individual slots on/off.
8. Click Save slots.

Bulk setup:
- Use the bottom panel to apply a slot preset to many days.
- Choose Copy selected day if you want to repeat one exact custom day pattern.

Firestore data:
availability/{YYYY-MM-DD}
  status: available/unavailable
  availableSlotCount: number
  slots: object of 1-hour slots

bookings/{bookingId}
  preferredDate
  preferredTimeSlot
  preferredTimeLabel
