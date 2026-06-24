IRONGATE CUSTOM 1-HOUR TIME SLOT VERSION

What changed:
- Admin console now lets you add the exact 1-hour blocks you are available.
- You can select a date, enter a start time, and click "Add 1-hour block".
- The end time is automatically set 1 hour later.
- You can use quick add buttons like 8 AM, 9 AM, 10 AM.
- Bulk setup can create blocks across a date range, for selected weekdays.
- Client booking page only shows the available blocks you created in admin.
- Client can select one slot only.

Admin page:
admin-availability.html

Client booking page:
booking.html

Firestore collection used:
availability/{YYYY-MM-DD}

Example availability document:
availability/2026-07-01
  status: available
  availableCount: 3
  slots:
    08_00:
      start: 08:00
      end: 09:00
      label: 8:00 AM – 9:00 AM
      available: true
      booked: false

Important:
- Upload this folder to GitHub / your host.
- Do not open directly as file:// for testing Firebase Auth.
- Use GitHub Pages, Firebase Hosting, or VS Code Live Server.
