import { db } from "./firebase-config.js";
import { doc, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export async function saveBarrierCheckInspectionLink(bookingId, result = {}) {
  const inspectionId = String(result.inspectionId || "").trim();
  if (!bookingId || !inspectionId) return null;

  const status = result.reused ? "manual_reused" : "manual_synced";
  await updateDoc(doc(db, "bookings", bookingId), {
    barrierCheckInspectionId: inspectionId,
    barrierCheckSyncStatus: status,
    barrierCheckSyncError: null,
    barrierCheckSyncedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return { inspectionId, barrierCheckSyncStatus: status };
}
