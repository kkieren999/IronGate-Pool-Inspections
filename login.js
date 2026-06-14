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

function goToApp() {
  window.location.replace("index.html");
}

function getUserProfileRef(user) {
  return loginDb.collection("users").doc(user.uid);
}

function createPendingProfile(user) {
  var providerIds = (user.providerData || []).map(function (provider) {
    return provider.providerId;
  });

  return getUserProfileRef(user).set({
    email: user.email || "",
    displayName: user.displayName || "",
    approved: false,
    role: "pending",
    providerIds: providerIds,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

function ensureUserProfile(user) {
  var ref = getUserProfileRef(user);
  return ref.get().then(function (doc) {
    if (doc.exists) {
      return doc.data() || {};
    }

    return createPendingProfile(user).then(function () {
      return {
        email: user.email || "",
        displayName: user.displayName || "",
        approved: false,
        role: "pending"
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
      setLoginStatus("Your account is pending approval.", true);
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
        setLoginStatus("Sign in or create an account to continue.", false);
      }
    });

    qs("#emailLoginForm").addEventListener("submit", signInWithEmail);
    qs("#createAccountBtn").addEventListener("click", createAccountWithEmail);
    qs("#googleSignInBtn").addEventListener("click", signInWithGoogle);
    qs("#pendingSignOutBtn").addEventListener("click", signOutPendingUser);
    setLoginStatus("Sign in or create an account to continue.", false);
  } catch (error) {
    console.error(error);
    setLoginStatus("Firebase setup failed: " + error.message, true);
  }
}

document.addEventListener("DOMContentLoaded", initLogin);
