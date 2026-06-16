const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();

function assertSignedIn(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  return request.auth.uid;
}

async function assertAdmin(request) {
  const uid = assertSignedIn(request);
  if (request.auth.token && request.auth.token.admin === true) return uid;

  const adminDoc = await db.collection("users").doc(uid).get();
  const adminData = adminDoc.exists ? adminDoc.data() : {};
  if (adminData && (adminData.role === "admin" || adminData.admin === true)) return uid;

  throw new HttpsError("permission-denied", "Admin access is required.");
}

function cleanText(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function oneMonthFromNow() {
  const now = new Date();
  const next = new Date(now.getTime());
  next.setMonth(next.getMonth() + 1);
  return next;
}

exports.approveUser = onCall(async (request) => {
  const adminUid = await assertAdmin(request);
  const uid = cleanText(request.data && request.data.uid);
  const licenceNumber = cleanText(request.data && request.data.licenceNumber);

  if (!uid) throw new HttpsError("invalid-argument", "uid is required.");
  if (!licenceNumber) throw new HttpsError("invalid-argument", "Verified licenceNumber is required.");

  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User profile not found.");

  const trialEndsAt = admin.firestore.Timestamp.fromDate(oneMonthFromNow());
  await userRef.set({
    approved: true,
    role: "inspector",
    verificationStatus: "approved",
    verificationMethod: "pool_safety_inspector_register",
    licenceNumber,
    subscriptionStatus: "trialing",
    billingAccess: "trialing",
    trialStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    trialEndsAt,
    approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    verifiedBy: adminUid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return { ok: true, trialEndsAt: trialEndsAt.toDate().toISOString() };
});

exports.rejectUser = onCall(async (request) => {
  const adminUid = await assertAdmin(request);
  const uid = cleanText(request.data && request.data.uid);
  const reason = cleanText(request.data && request.data.reason);

  if (!uid) throw new HttpsError("invalid-argument", "uid is required.");

  await db.collection("users").doc(uid).set({
    approved: false,
    role: "rejected",
    verificationStatus: "rejected",
    rejectionReason: reason || "Inspector details could not be verified.",
    rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
    rejectedBy: adminUid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return { ok: true };
});

exports.cancelSubscriptionAtPeriodEnd = onCall(async (request) => {
  const uid = assertSignedIn(request);

  // Stripe is intentionally not implemented in this build. When Stripe is connected,
  // use the Stripe secret key only inside this function and cancel the subscription at period end.
  await db.collection("users").doc(uid).set({
    subscriptionCancelRequested: true,
    subscriptionCancelRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return { ok: true, stripeConnected: false };
});

exports.deleteMyAccount = onCall(async (request) => {
  const uid = assertSignedIn(request);
  const confirm = cleanText(request.data && request.data.confirm).toUpperCase();
  if (confirm !== "DELETE") {
    throw new HttpsError("invalid-argument", "Type DELETE to confirm account deletion.");
  }

  const userRef = db.collection("users").doc(uid);

  // Mark first, so support can see intent if a later delete step fails in logs.
  await userRef.set({
    accountDeletionRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
    subscriptionCancelRequested: true,
    subscriptionCancelRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true }).catch(() => null);

  // TODO when Stripe is connected: cancel the Stripe subscription/customer here using secret keys.

  // Delete all Storage objects saved under users/{uid}/.
  const bucket = admin.storage().bucket();
  await bucket.deleteFiles({ prefix: `users/${uid}/` }).catch((error) => {
    console.warn("Storage deleteFiles warning", error.message || error);
  });

  // Delete Firestore user document and subcollections.
  if (typeof db.recursiveDelete === "function") {
    await db.recursiveDelete(userRef);
  } else {
    const inspections = await userRef.collection("inspections").get();
    const batch = db.batch();
    inspections.forEach((doc) => batch.delete(doc.ref));
    batch.delete(userRef);
    await batch.commit();
  }

  // Delete Firebase Auth account last.
  await auth.deleteUser(uid);

  return { ok: true };
});
