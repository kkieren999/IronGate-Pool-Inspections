BarrierCheck rebuild notes

Changed in this bundle:
- Visible IronGate branding has been replaced with BarrierCheck.
- The old image logo usage has been replaced with a generated BC two-tone brand mark so the old IronGate logo is not shown.
- The inspector profile is now a Company Profile with optional report branding fields:
  - inspection number prefix
  - ABN / ACN
  - business address
  - report email
  - report phone
  - website
  - company logo URL
  - report footer / disclaimer
- New inspection numbers now use the company prefix, defaulting to BC, e.g. BC-2026-0001.
- Completed/printed inspections now use a client-branded report header using the buyer's company name/logo/details.
- The BarrierCheck app header is hidden in download/print mode.
- Evidence photo stamps now use the buyer company name, not the platform brand.
- Default avatar text is now BC.

Important:
- The Firebase config still points at the existing Firebase project/bucket so the app can continue to run against your current backend. Before giving this to buyers publicly, update the Firebase project display name, OAuth consent screen, Auth email templates, authorised domains, and storage/project IDs to remove the old backend name from public-facing Firebase surfaces.


BarrierCheck account safety/legal build additions
-----------------------------------------------
This build adds starter legal pages, legal links in login/settings, signup terms acceptance storage, pending inspector-verification wording, subscription-cancellation placeholder UI, and a Delete Account flow in Settings.

Important production note:
The Delete Account flow includes client-side best-effort deletion of known inspection photos, Storage files under users/{uid}, inspection documents, the user profile document, and the Firebase Auth account. For production SaaS use, replace or back this with a Firebase Cloud Function using the Admin SDK so deletion can reliably remove all subcollections, Storage files, Auth accounts and future Stripe records.

Stripe is not connected in this bundle. The Cancel Subscription button is intentionally disabled and explains the future behaviour: cancel future billing while keeping access until the end of the paid period.

The legal pages are starter drafts only and should be reviewed before public launch.


PHASE 3 - ADMIN, TRIAL & BACKEND SAFETY
=======================================
This build adds the next production-safety layer:

1. admin.html/admin.js
   - Admin-only approval console.
   - Lists users with verificationStatus = pending.
   - Approve starts a 1-month free trial.
   - Reject records the rejection status and reason.

2. Trial/subscription access checks in the app
   - App now checks approved + profile complete + trial/subscription active.
   - Backward-compatible: older approved profiles without billing fields are still allowed until Stripe is fully enforced.
   - Trial/subscription status appears in Settings.

3. Firebase Cloud Functions template
   - functions/index.js includes approveUser, rejectUser, cancelSubscriptionAtPeriodEnd placeholder, and deleteMyAccount.
   - Deploy these before relying on production account deletion or approval.

4. Security rules templates
   - firestore.rules and storage.rules are included.
   - Review and test with Firebase Emulator before production deployment.

5. firebase.json
   - Starter Firebase deploy config for hosting, rules, storage rules and functions.

IMPORTANT DEPLOYMENT NOTES
==========================
- To create your first admin, manually set your Firestore user document to role: "admin" or admin: true.
- For strongest admin security, also set a Firebase Auth custom claim admin: true using the Admin SDK.
- The frontend delete-account flow still has a fallback, but production should use the deleteMyAccount Cloud Function.
- Stripe is not connected yet. Cancel Subscription remains a placeholder until the Stripe backend is added.
