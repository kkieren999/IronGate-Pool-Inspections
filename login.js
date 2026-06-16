var FIREBASE_CONFIG = {
  apiKey: "AIzaSyCAf5QQvK5VrGkveCj8I3pVvctB3383-Nw",
  authDomain: "irongate-pool-inspections.firebaseapp.com",
  projectId: "irongate-pool-inspections",
  storageBucket: "irongate-pool-inspections.firebasestorage.app",
  messagingSenderId: "700392380285",
  appId: "1:700392380285:web:99a855fd6bcc70fd22de14",
  measurementId: "G-X9KMFVCKP6"
};

var loginAuth = null;
var loginDb = null;
var authStateBusy = false;
var LEGAL_TERMS_VERSION = "2026-06-16-v1";
var LEGAL_PRIVACY_VERSION = "2026-06-16-v1";
var LEGAL_REFUND_VERSION = "2026-06-16-v1";


function qs(selector) {
  return document.querySelector(selector);
}

function setLoginStatus(message, isError) {
  var el = qs("#loginStatus");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error", !!isError);
}

function setPendingVisible(visible) {
  var box = qs("#pendingBox");
  if (box) box.hidden = !visible;
}

function hasAcceptedLegalTerms() {
  var checkbox = qs("#legalAcceptCheck");
  return !!(checkbox && checkbox.checked);
}

function wantsMarketingEmails() {
  var checkbox = qs("#marketingOptInCheck");
  return !!(checkbox && checkbox.checked);
}

function buildLegalAcceptanceData() {
  return {
    termsAcceptedAt: firebase.firestore.FieldValue.serverTimestamp(),
    termsVersion: LEGAL_TERMS_VERSION,
    privacyVersion: LEGAL_PRIVACY_VERSION,
    refundPolicyVersion: LEGAL_REFUND_VERSION,
    marketingOptIn: wantsMarketingEmails(),
    marketingOptInUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
}

function requireLegalTermsForNewAccount() {
  if (hasAcceptedLegalTerms()) return true;
  setLoginStatus("Tick the Privacy, Terms and Refund Policy agreement before creating an account.", true);
  return false;
}

function goToApp() {
  window.location.replace("index.html");
}

function getUserProfileRef(user) {
  return loginDb.collection("users").doc(user.uid);
}

function getGooglePhotoUrl(user) {
  if (user && user.photoURL) return user.photoURL;
  var providers = user && user.providerData ? user.providerData : [];
  for (var i = 0; i < providers.length; i += 1) {
    if (providers[i].providerId === "google.com" && providers[i].photoURL) return providers[i].photoURL;
  }
  return "";
}

function buildInitialInspectorProfile(user) {
  var googleUrl = getGooglePhotoUrl(user);
  return {
    inspectorName: user && user.displayName ? user.displayName : "",
    licenceNumber: "",
    inspectorEmail: user && user.email ? user.email : "",
    inspectorPhone: "",
    businessName: "",
    businessAddress: "",
    businessAbn: "",
    businessWebsite: "",
    reportEmail: user && user.email ? user.email : "",
    reportPhone: "",
    reportLogoUrl: "",
    reportFooterText: "",
    inspectionNumberPrefix: "BC",
    profileIcon: googleUrl
      ? { type: "google", photoURL: googleUrl, avatarId: "" }
      : { type: "default", photoURL: "", avatarId: "default" }
  };
}

function createPendingProfile(user) {
  var providerIds = (user.providerData || []).map(function (provider) {
    return provider.providerId;
  });

  var profileData = {
    email: user.email || "",
    displayName: user.displayName || "",
    approved: false,
    role: "pending",
    verificationStatus: "pending",
    verificationMethod: "pool_safety_inspector_register",
    trialStatus: "not_started",
    providerIds: providerIds,
    inspectorProfile: buildInitialInspectorProfile(user),
    profileCompleted: false,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  if (hasAcceptedLegalTerms()) {
    Object.assign(profileData, buildLegalAcceptanceData());
  }

  return getUserProfileRef(user).set(profileData, { merge: true });
}

function ensureUserProfile(user) {
  var ref = getUserProfileRef(user);
  return ref.get().then(function (doc) {
    if (doc.exists) {
      var data = doc.data() || {};
      if (!data.termsAcceptedAt && hasAcceptedLegalTerms()) {
        return ref.set(buildLegalAcceptanceData(), { merge: true }).then(function () {
          data.termsAcceptedAt = true;
          data.termsVersion = LEGAL_TERMS_VERSION;
          data.privacyVersion = LEGAL_PRIVACY_VERSION;
          data.refundPolicyVersion = LEGAL_REFUND_VERSION;
          data.marketingOptIn = wantsMarketingEmails();
          return data;
        });
      }
      return data;
    }

    return createPendingProfile(user).then(function () {
      return {
        email: user.email || "",
        displayName: user.displayName || "",
        approved: false,
        role: "pending",
        inspectorProfile: buildInitialInspectorProfile(user),
        profileCompleted: false
      };
    });
  });
}

function checkApprovalAndContinue(user) {
  if (!user || !loginDb) return;

  authStateBusy = true;
  setPendingVisible(false);
  setLoginStatus("Checking account approval...", false);

  ensureUserProfile(user)
    .then(function (profile) {
      authStateBusy = false;
      if (profile && profile.approved === true) {
        setLoginStatus("Approved. Opening app...", false);
        goToApp();
        return;
      }

      setPendingVisible(true);
      setLoginStatus("Your account is pending inspector verification. We aim to review new accounts within 24 hours.", true);
    })
    .catch(function (error) {
      authStateBusy = false;
      console.error(error);
      setLoginStatus("Could not check approval: " + error.message, true);
    });
}

function signInWithEmail(event) {
  event.preventDefault();
  if (!loginAuth) return;

  var email = qs("#loginEmail").value.trim();
  var password = qs("#loginPassword").value;

  if (!email || !password) {
    setLoginStatus("Enter your email and password.", true);
    return;
  }

  setPendingVisible(false);
  setLoginStatus("Signing in...", false);

  loginAuth
    .signInWithEmailAndPassword(email, password)
    .catch(function (error) {
      console.error(error);
      setLoginStatus("Sign in failed: " + error.message, true);
    });
}

function createAccountWithEmail() {
  if (!loginAuth) return;
  if (!requireLegalTermsForNewAccount()) return;

  var email = qs("#loginEmail").value.trim();
  var password = qs("#loginPassword").value;

  if (!email || !password) {
    setLoginStatus("Enter an email and password to create an account.", true);
    return;
  }

  if (password.length < 6) {
    setLoginStatus("Password must be at least 6 characters.", true);
    return;
  }

  setPendingVisible(false);
  setLoginStatus("Creating account...", false);

  loginAuth
    .createUserWithEmailAndPassword(email, password)
    .then(function () {
      // onAuthStateChanged will create the pending profile and show the pending message.
      setLoginStatus("Account created. Checking approval...", false);
    })
    .catch(function (error) {
      console.error(error);
      setLoginStatus("Could not create account: " + error.message, true);
    });
}

function signInWithGoogle() {
  if (!loginAuth || !window.firebase) return;
  if (!requireLegalTermsForNewAccount()) return;

  var provider = new firebase.auth.GoogleAuthProvider();
  setPendingVisible(false);
  setLoginStatus("Opening Google sign-in...", false);

  loginAuth
    .signInWithPopup(provider)
    .catch(function (error) {
      console.error(error);
      setLoginStatus("Google sign-in failed: " + error.message, true);
    });
}

function signOutPendingUser() {
  if (!loginAuth) return;
  loginAuth.signOut().then(function () {
    setPendingVisible(false);
    setLoginStatus("Signed out. Sign in to continue.", false);
  });
}

function getLoginQueryFlag(name) {
  try {
    return new URLSearchParams(window.location.search || "").has(name);
  } catch (error) {
    return false;
  }
}

function initLogin() {
  if (!window.firebase || !window.firebase.initializeApp) {
    setLoginStatus("Firebase scripts could not load. Try opening the app from a hosted site or local server.", true);
    return;
  }

  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    loginAuth = firebase.auth();
    loginDb = firebase.firestore();

    loginAuth.onAuthStateChanged(function (user) {
      if (user) {
        checkApprovalAndContinue(user);
      } else if (!authStateBusy) {
        setPendingVisible(false);
        if (getLoginQueryFlag("accountDeleted")) {
          setLoginStatus("Your BarrierCheck account has been deleted.", false);
        } else {
          setLoginStatus("Sign in or create an account to continue.", false);
        }
      }
    });

    qs("#emailLoginForm").addEventListener("submit", signInWithEmail);
    qs("#createAccountBtn").addEventListener("click", createAccountWithEmail);
    qs("#googleSignInBtn").addEventListener("click", signInWithGoogle);
    qs("#pendingSignOutBtn").addEventListener("click", signOutPendingUser);
    setLoginStatus(getLoginQueryFlag("accountDeleted") ? "Your BarrierCheck account has been deleted." : "Sign in or create an account to continue.", false);
  } catch (error) {
    console.error(error);
    setLoginStatus("Firebase setup failed: " + error.message, true);
  }
}

document.addEventListener("DOMContentLoaded", initLogin);
