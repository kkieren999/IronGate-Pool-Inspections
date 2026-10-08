const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { GoogleAuth } = require("google-auth-library");

admin.initializeApp();

const BARRIERCHECK_ENDPOINT =
  "https://australia-southeast1-barriercheck-32290.cloudfunctions.net/createIronGateInspection";
const CONFIRMED_PAYMENT_STATUSES = new Set(["paid", "no_payment_required", "agency_invoice"]);
const db = admin.firestore();
const googleAuth = new GoogleAuth();

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function eligible(booking) {
  return Boolean(
    booking &&
    booking.status === "confirmed" &&
    CONFIRMED_PAYMENT_STATUSES.has(clean(booking.paymentStatus))
  );
}

function retryToken(booking) {
  const value = booking && booking.barrierCheckRetryToken;
  if (value === undefined || value === null) return "";
  return String(value);
}

function shouldSync(before, after) {
  if (!eligible(after) || clean(after.barrierCheckInspectionId)) return false;
  if (!eligible(before)) return true;
  return Boolean(retryToken(after)) && retryToken(after) !== retryToken(before);
}

function payloadFromBooking(booking) {
  const allowed = [
    "status",
    "paymentStatus",
    "customerName",
    "email",
    "phone",
    "propertyAddress",
    "propertyPlaceId",
    "bookingRoleCode",
    "clientType",
    "agencyName",
    "bookingRelationship",
    "poolOwnerName",
    "poolOwnerEmail",
    "poolOwnerPhone",
    "accessSameAsBooking",
    "accessContactName",
    "accessContactPhone",
    "accessContactEmail",
    "accessContactAgency",
    "accessMethod",
    "keyCollectionLocation",
    "inspectionReason",
    "poolType",
    "existingCertificateStatus",
    "poolRegisteredStatus",
    "preferredDate",
    "preferredDateDisplay",
    "preferredTimeSlot",
    "preferredTimeLabel",
    "preferredTimeStart",
    "preferredTimeEnd",
    "preferredTime",
    "willBeHomeForInspection",
    "accessPermissionIfNotHome",
    "animalsOnProperty",
    "animalsOffLeash",
    "animalsWillBeSecured",
    "accessInstructions",
    "hasPoolExemption",
    "notes"
  ];

  return allowed.reduce((out, key) => {
    if (Object.prototype.hasOwnProperty.call(booking || {}, key)) {
      out[key] = booking[key];
    }
    return out;
  }, {});
}

async function createBarrierCheckInspection(bookingId, booking) {
  const client = await googleAuth.getIdTokenClient(BARRIERCHECK_ENDPOINT);
  const response = await client.request({
    url: BARRIERCHECK_ENDPOINT,
    method: "POST",
    data: {
      bookingId,
      booking: payloadFromBooking(booking)
    },
    timeout: 20000
  });

  const data = response && response.data ? response.data : {};
  if (!data.ok || !data.inspectionId) {
    throw new Error("BarrierCheck did not return an inspection ID.");
  }
  return data;
}

exports.syncBarrierCheckInspection = onDocumentWritten(
  {
    document: "bookings/{bookingId}",
    region: "us-central1",
    timeoutSeconds: 45,
    memory: "256MiB",
    retry: true
  },
  async (event) => {
    if (!event.data || !event.data.after || !event.data.after.exists) return;

    const bookingId = event.params.bookingId;
    const before = event.data.before && event.data.before.exists ? event.data.before.data() || {} : {};
    const after = event.data.after.data() || {};
    if (!shouldSync(before, after)) return;

    const ref = event.data.after.ref;

    const latestSnap = await ref.get();
    const latest = latestSnap.exists ? latestSnap.data() || {} : {};
    if (!eligible(latest) || clean(latest.barrierCheckInspectionId)) return;

    await ref.set({
      barrierCheckSyncStatus: "pending",
      barrierCheckSyncError: null,
      barrierCheckSyncAttemptedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    try {
      const result = await createBarrierCheckInspection(bookingId, latest);

      await ref.set({
        barrierCheckInspectionId: result.inspectionId,
        barrierCheckSyncStatus: "synced",
        barrierCheckSyncError: null,
        barrierCheckSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      logger.info("IronGate booking created BarrierCheck inspection", {
        bookingId,
        inspectionId: result.inspectionId,
        created: result.created !== false
      });
    } catch (error) {
      const message = clean(error && error.message ? error.message : error).slice(0, 240);
      logger.error("BarrierCheck booking sync failed", { bookingId, message });

      await ref.set({
        barrierCheckSyncStatus: "failed",
        barrierCheckSyncError: message || "BarrierCheck sync failed.",
        barrierCheckSyncFailedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      throw error;
    }
  }
);

exports._test = {
  eligible,
  shouldSync,
  payloadFromBooking
};
