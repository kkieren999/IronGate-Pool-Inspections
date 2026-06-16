var FIREBASE_CONFIG = {
  apiKey: "AIzaSyCAf5QQvK5VrGkveCj8I3pVvctB3383-Nw",
  authDomain: "irongate-pool-inspections.firebaseapp.com",
  projectId: "irongate-pool-inspections",
  storageBucket: "irongate-pool-inspections.firebasestorage.app",
  messagingSenderId: "700392380285",
  appId: "1:700392380285:web:99a855fd6bcc70fd22de14",
  measurementId: "G-X9KMFVCKP6"
};

var adminAuth = null;
var adminDb = null;
var adminFunctions = null;
var adminUser = null;
var adminProfile = null;

function qs(selector) {
  return document.querySelector(selector);
}

function setAdminStatus(message, isError) {
  var status = qs("#adminStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", !!isError);
}

function cleanText(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function isAdminProfile(profile) {
  return !!(profile && (profile.role === "admin" || profile.admin === true));
}

function toShortDate(value) {
  if (!value) return "—";
  var date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (!date || isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-AU", { year: "numeric", month: "short", day: "numeric" });
}

function callFunction(name, payload) {
  if (!adminFunctions || typeof adminFunctions.httpsCallable !== "function") {
    return Promise.reject(new Error("Firebase Functions is not available."));
  }
  return adminFunctions.httpsCallable(name)(payload || {}).then(function (result) {
    return result ? result.data : null;
  });
}

function renderPendingUsers(users) {
  var list = qs("#pendingUsersList");
  var empty = qs("#pendingEmptyState");
  if (!list) return;
  list.innerHTML = "";
  if (empty) empty.hidden = users.length > 0;

  users.forEach(function (record) {
    var profile = record.inspectorProfile || {};
    var card = document.createElement("article");
    card.className = "pending-user-card";
    card.innerHTML = "" +
      "<h3>" + escapeHtml(record.displayName || profile.inspectorName || record.email || "Pending user") + "</h3>" +
      "<div class='pending-user-grid'>" +
      "<span><strong>Email:</strong> " + escapeHtml(record.email || "—") + "</span>" +
      "<span><strong>Licence:</strong> " + escapeHtml(profile.licenceNumber || record.licenceNumber || "Not entered yet") + "</span>" +
      "<span><strong>Company:</strong> " + escapeHtml(profile.businessName || "Not entered yet") + "</span>" +
      "<span><strong>Created:</strong> " + escapeHtml(toShortDate(record.createdAt)) + "</span>" +
      "<span><strong>Terms:</strong> " + escapeHtml(record.termsVersion || "Unknown") + "</span>" +
      "<span><strong>Marketing:</strong> " + escapeHtml(record.marketingOptIn ? "Opted in" : "No / unknown") + "</span>" +
      "</div>";

    var actions = document.createElement("div");
    actions.className = "admin-actions";

    var approve = document.createElement("button");
    approve.className = "admin-primary-btn";
    approve.type = "button";
    approve.textContent = "Approve & Start Trial";
    approve.addEventListener("click", function () {
      approveUser(record.id, profile.licenceNumber || record.licenceNumber || "");
    });

    var reject = document.createElement("button");
    reject.className = "admin-danger-btn";
    reject.type = "button";
    reject.textContent = "Reject";
    reject.addEventListener("click", function () {
      rejectUser(record.id);
    });

    actions.appendChild(approve);
    actions.appendChild(reject);
    card.appendChild(actions);
    list.appendChild(card);
  });
}

function escapeHtml(value) {
  return cleanText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function loadPendingUsers() {
  if (!adminDb || !isAdminProfile(adminProfile)) return;
  setAdminStatus("Loading pending users...", false);
  return adminDb.collection("users")
    .where("verificationStatus", "==", "pending")
    .limit(50)
    .get()
    .then(function (snapshot) {
      var users = [];
      snapshot.forEach(function (doc) {
        var data = doc.data() || {};
        data.id = doc.id;
        users.push(data);
      });
      users.sort(function (a, b) {
        var ad = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
        var bd = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
        return ad - bd;
      });
      renderPendingUsers(users);
      setAdminStatus("Loaded " + users.length + " pending user" + (users.length === 1 ? "" : "s") + ".", false);
    })
    .catch(function (error) {
      console.error(error);
      setAdminStatus("Could not load pending users: " + error.message, true);
    });
}

function approveUser(uid, currentLicence) {
  var licence = window.prompt("Confirm the pool safety inspector licence number you verified:", currentLicence || "");
  if (licence === null) return;
  licence = cleanText(licence);
  if (!licence) {
    alert("Enter the verified licence number before approval.");
    return;
  }

  setAdminStatus("Approving user and starting 1-month trial...", false);
  callFunction("approveUser", { uid: uid, licenceNumber: licence })
    .catch(function (error) {
      console.warn("approveUser function failed; trying Firestore fallback", error);
      var now = new Date();
      var trialEnd = new Date(now.getTime());
      trialEnd.setMonth(trialEnd.getMonth() + 1);
      return adminDb.collection("users").doc(uid).set({
        approved: true,
        role: "inspector",
        verificationStatus: "approved",
        verificationMethod: "pool_safety_inspector_register",
        licenceNumber: licence,
        subscriptionStatus: "trialing",
        billingAccess: "trialing",
        trialStartedAt: firebase.firestore.FieldValue.serverTimestamp(),
        trialEndsAt: firebase.firestore.Timestamp.fromDate(trialEnd),
        approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
        verifiedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    })
    .then(function () {
      setAdminStatus("User approved. Trial started.", false);
      return loadPendingUsers();
    })
    .catch(function (error) {
      console.error(error);
      setAdminStatus("Could not approve user: " + error.message, true);
    });
}

function rejectUser(uid) {
  var reason = window.prompt("Optional rejection reason:", "Inspector details could not be verified.");
  if (reason === null) return;

  setAdminStatus("Rejecting user...", false);
  callFunction("rejectUser", { uid: uid, reason: reason })
    .catch(function (error) {
      console.warn("rejectUser function failed; trying Firestore fallback", error);
      return adminDb.collection("users").doc(uid).set({
        approved: false,
        role: "rejected",
        verificationStatus: "rejected",
        rejectionReason: reason || "",
        rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    })
    .then(function () {
      setAdminStatus("User rejected.", false);
      return loadPendingUsers();
    })
    .catch(function (error) {
      console.error(error);
      setAdminStatus("Could not reject user: " + error.message, true);
    });
}

function initAdmin() {
  if (!window.firebase || !window.firebase.initializeApp) {
    setAdminStatus("Firebase scripts could not load.", true);
    return;
  }

  firebase.initializeApp(FIREBASE_CONFIG);
  adminAuth = firebase.auth();
  adminDb = firebase.firestore();
  adminFunctions = firebase.functions ? firebase.functions() : null;

  var refresh = qs("#refreshPendingBtn");
  if (refresh) refresh.addEventListener("click", loadPendingUsers);
  var signOut = qs("#signOutAdminBtn");
  if (signOut) signOut.addEventListener("click", function () {
    adminAuth.signOut().then(function () { window.location.replace("login.html"); });
  });

  adminAuth.onAuthStateChanged(function (user) {
    adminUser = user || null;
    adminProfile = null;
    renderPendingUsers([]);
    if (!adminUser) {
      setAdminStatus("Sign in first, then open the admin console again.", true);
      setTimeout(function () { window.location.replace("login.html"); }, 900);
      return;
    }

    adminDb.collection("users").doc(adminUser.uid).get().then(function (doc) {
      adminProfile = doc.exists ? (doc.data() || {}) : {};
      if (!isAdminProfile(adminProfile)) {
        setAdminStatus("This account is not marked as an admin. Set role: 'admin' or admin: true on your user document.", true);
        return;
      }
      setAdminStatus("Admin access confirmed.", false);
      loadPendingUsers();
    }).catch(function (error) {
      console.error(error);
      setAdminStatus("Could not check admin access: " + error.message, true);
    });
  });
}

window.addEventListener("DOMContentLoaded", initAdmin);
