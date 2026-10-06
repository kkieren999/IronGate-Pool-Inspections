"use strict";

const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { HttpsError } = require("firebase-functions/v2/https");
const { requireAdmin } = require("./admin-booking-service");

const TARGET_PROJECT_ID = "barriercheck-32290";
const TARGET_ACCOUNT_EMAIL = "kieren.albuquerque@gmail.com";

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function cleanPhone(value) {
  return clean(value).replace(/\s+/g, " ");
}

function mapPurpose(value) {
  const input = clean(value).toLowerCase();
  if (/sale|sell|vendor/.test(input)) return "Sale";
  if (/lease|rent|tenant/.test(input)) return "Lease";
  if (/body corporate|shared|strata/.test(input)) return "Body corporate / shared pool";
  if (/owner|certificate|compliance|initial/.test(input)) return "Owner request";
  return input ? "Other" : "Owner request";
}

function mapPoolType(value) {
  const input = clean(value).toLowerCase();
  if (/swim\s*spa/.test(input)) return "Swim spa";
  if (/spa/.test(input)) return "Spa";
  if (/above/.test(input)) return "Above-ground pool";
  if (/in[- ]?ground|inground/.test(input)) return "In-ground pool";
  if (/indoor/.test(input)) return "Indoor pool";
  if (/outdoor/.test(input)) return "Outdoor pool";
  return "Other";
}

function bookingEligible(booking = {}) {
  const status = clean(booking.status).toLowerCase();
  const inspectionStatus = clean(booking.inspectionStatus).toLowerCase();
  const paymentStatus = clean(booking.paymentStatus).toLowerCase();
  const billingStatus = clean(booking.billingStatus).toLowerCase();
  const stripePaymentStatus = clean(booking.stripePaymentStatus).toLowerCase();

  const blocked = ["cancelled", "completed", "certificate_issued"].includes(status) ||
    ["cancelled", "completed", "certificate_issued"].includes(inspectionStatus);
  if (blocked) return false;

  const paid = ["paid", "no_payment_required", "agency_invoice"].includes(paymentStatus) ||
    clean(booking.invoiceStatus).toLowerCase() === "paid" ||
    stripePaymentStatus === "paid" ||
    billingStatus.includes("paid");

  const confirmed = status === "confirmed" ||
    inspectionStatus === "confirmed" ||
    (paid && Boolean(clean(booking.preferredDate)) && Boolean(clean(booking.propertyAddress)));

  return paid && confirmed;
}

function inspectionNumber(bookingId, booking = {}) {
  const date = clean(booking.preferredDate);
  const year = /^\d{4}-/.test(date) ? date.slice(0, 4) : String(new Date().getUTCFullYear());
  const suffix = clean(bookingId).replace(/[^a-z0-9]/gi, "").slice(-7).toUpperCase() || "BOOKING";
  return "BC-" + year + "-IG" + suffix;
}

function bookingNotes(bookingId, booking = {}) {
  return [
    "Imported automatically from IronGate booking " + bookingId + ".",
    booking.preferredTimeLabel || booking.preferredTime
      ? "Appointment: " + clean(booking.preferredTimeLabel || booking.preferredTime)
      : "",
    booking.customerName ? "Booking contact: " + clean(booking.customerName) : "",
    booking.phone ? "Booking phone: " + cleanPhone(booking.phone) : "",
    booking.email ? "Booking email: " + clean(booking.email) : "",
    booking.agencyName ? "Agency: " + clean(booking.agencyName) : "",
    booking.accessContactName ? "Access contact: " + clean(booking.accessContactName) : "",
    booking.accessContactPhone ? "Access phone: " + cleanPhone(booking.accessContactPhone) : "",
    booking.accessMethod ? "Access method: " + clean(booking.accessMethod) : "",
    booking.keyCollectionLocation ? "Key collection / lockbox: " + clean(booking.keyCollectionLocation) : "",
    booking.accessInstructions ? "Access instructions: " + clean(booking.accessInstructions) : "",
    booking.animalsOnProperty === true
      ? "Animals on property: yes" + (booking.animalsWillBeSecured === true ? " — confirmed secured." : ".")
      : "",
    booking.hasPoolExemption === true ? "Booking indicates a pool exemption may apply." : "",
    booking.notes ? "Booking notes: " + clean(booking.notes) : "",
    booking.inspectionReason ? "IronGate inspection reason: " + clean(booking.inspectionReason) : ""
  ].filter(Boolean).join("\n");
}

function targetDb() {
  let app;
  try {
    app = admin.app("barriercheck-direct");
  } catch (_) {
    app = admin.initializeApp({ projectId: TARGET_PROJECT_ID }, "barriercheck-direct");
  }
  return admin.firestore(app);
}

async function findTargetUser(db) {
  const direct = await db.collection("users").where("email", "==", TARGET_ACCOUNT_EMAIL).limit(2).get();
  if (!direct.empty) return direct.docs[0];

  const profile = await db.collection("users")
    .where("inspectorProfile.inspectorEmail", "==", TARGET_ACCOUNT_EMAIL)
    .limit(2)
    .get();
  if (!profile.empty) return profile.docs[0];

  throw new HttpsError("failed-precondition", "BarrierCheck account could not be located.");
}

function buildInspection(bookingId, booking, profile) {
  const number = inspectionNumber(bookingId, booking);
  const now = new Date().toISOString();
  const ownerName = clean(booking.poolOwnerName || booking.customerName);
  const ownerEmail = clean(booking.poolOwnerEmail || booking.email).toLowerCase();
  const ownerPhone = cleanPhone(booking.poolOwnerPhone || booking.phone);
  const notes = bookingNotes(bookingId, booking);
  const snapshot = {
    inspectorName: clean(profile.inspectorName),
    licenceNumber: clean(profile.licenceNumber),
    inspectorEmail: clean(profile.inspectorEmail),
    inspectorPhone: cleanPhone(profile.inspectorPhone),
    businessName: clean(profile.businessName),
    businessAddress: clean(profile.businessAddress),
    businessAbn: clean(profile.businessAbn),
    businessWebsite: clean(profile.businessWebsite),
    reportEmail: clean(profile.reportEmail || profile.inspectorEmail),
    reportPhone: cleanPhone(profile.reportPhone || profile.inspectorPhone),
    reportLogoUrl: clean(profile.reportLogoUrl),
    reportFooterText: clean(profile.reportFooterText),
    inspectionNumberPrefix: clean(profile.inspectionNumberPrefix || "BC"),
    profileIcon: profile.profileIcon || { type: "default", photoURL: "", avatarId: "default" }
  };

  return {
    id: "irongate-" + bookingId,
    inspectionNumber: number,
    fields: {
      sourceBookingId: bookingId,
      inspectionNumber: number,
      inspectionDate: clean(booking.preferredDate),
      inspectorName: snapshot.inspectorName,
      licenceNumber: snapshot.licenceNumber,
      inspectorEmail: snapshot.inspectorEmail,
      inspectorPhone: snapshot.inspectorPhone,
      businessName: snapshot.businessName,
      ownerName,
      ownerPhone,
      ownerEmail,
      propertyAddress: clean(booking.propertyAddress),
      inspectionType: "Initial inspection",
      inspectionPurpose: mapPurpose(booking.inspectionReason),
      poolType: mapPoolType(booking.poolType),
      sharedPool: "Unknown",
      inspectionNotes: notes,
      preInspectionNotes: notes
    },
    photos: {},
    fenceSections: [],
    climbabilitySections: [],
    balconySections: [],
    retainingWallSections: [],
    boundarySections: [],
    specialPoolFeatureSections: [],
    waterBarrierSections: [],
    barrierWindowSections: [],
    barrierDoorSections: [],
    gateSections: [],
    temporaryFenceSections: [],
    decommissionedPoolSections: [],
    referralSections: [],
    inspectorSnapshot: snapshot,
    findings: [],
    inspectionStarted: true,
    status: "Not started",
    completedSections: 0,
    totalSections: 5,
    progressText: "0/5 sections complete",
    source: "irongate",
    sourceBookingId: bookingId,
    sourceBookingStatus: clean(booking.status),
    sourcePaymentStatus: clean(booking.paymentStatus),
    createdAt: now,
    updatedAt: now
  };
}

async function createBarrierCheckInspection(request, sourceDb) {
  const actor = await requireAdmin(request);
  const bookingId = clean(request.data && request.data.bookingId);
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(bookingId)) {
    throw new HttpsError("invalid-argument", "Invalid booking ID.");
  }

  const bookingRef = sourceDb.collection("bookings").doc(bookingId);
  const bookingSnap = await bookingRef.get();
  if (!bookingSnap.exists) throw new HttpsError("not-found", "Booking was not found.");

  const booking = bookingSnap.data() || {};
  if (!bookingEligible(booking)) {
    throw new HttpsError("failed-precondition", "This booking is not ready for BarrierCheck.");
  }

  try {
    const barrierDb = targetDb();
    const userDoc = await findTargetUser(barrierDb);
    const user = userDoc.data() || {};
    const profile = user.inspectorProfile || {};
    if (!clean(profile.inspectorName) || !clean(profile.licenceNumber)) {
      throw new HttpsError("failed-precondition", "BarrierCheck inspector profile is incomplete.");
    }

    const existingLinkedId = clean(booking.barrierCheckInspectionId);
    if (existingLinkedId) {
      const linked = await userDoc.ref.collection("inspections").doc(existingLinkedId).get();
      if (linked.exists) {
        return { ok: true, inspectionId: existingLinkedId, created: false, alreadyLinked: true };
      }
    }

    const inspectionId = "irongate-" + bookingId;
    const inspectionRef = userDoc.ref.collection("inspections").doc(inspectionId);
    const inspection = buildInspection(bookingId, booking, profile);

    const created = await barrierDb.runTransaction(async (tx) => {
      const existing = await tx.get(inspectionRef);
      if (existing.exists) return false;
      tx.create(inspectionRef, inspection);
      return true;
    });

    await bookingRef.set({
      barrierCheckInspectionId: inspectionId,
      barrierCheckSyncStatus: created ? "background_synced" : "background_reused",
      barrierCheckSyncError: null,
      barrierCheckSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
      barrierCheckSyncedBy: actor.email,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    logger.info("BarrierCheck inspection prepared in background", {
      bookingId,
      inspectionId,
      created,
      actorUid: actor.uid,
      targetProject: TARGET_PROJECT_ID
    });

    return { ok: true, inspectionId, created, alreadyLinked: false };
  } catch (error) {
    const code = error && error.code ? String(error.code) : "";
    logger.error("Could not prepare BarrierCheck inspection", {
      bookingId,
      code,
      message: error && error.message ? error.message : String(error)
    });

    await bookingRef.set({
      barrierCheckSyncStatus: "failed",
      barrierCheckSyncError: (error && error.message ? error.message : "BarrierCheck background creation failed.").slice(0, 240),
      barrierCheckSyncFailedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    if (error instanceof HttpsError) throw error;
    if (code.includes("permission-denied") || code === "7") {
      throw new HttpsError(
        "failed-precondition",
        "BarrierCheck background access has not been authorised yet."
      );
    }
    throw new HttpsError("internal", "Could not prepare the BarrierCheck inspection.");
  }
}

module.exports = {
  createBarrierCheckInspection,
  _test: { bookingEligible, mapPurpose, mapPoolType, inspectionNumber, bookingNotes, buildInspection }
};
