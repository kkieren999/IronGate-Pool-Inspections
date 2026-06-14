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

function qs(selector) {
  return document.querySelector(selector);
}

function setLoginStatus(message, isError) {
  var el = qs("#loginStatus");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error", !!isError);
}

function goToApp() {
  window.location.replace("index.html");
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

  setLoginStatus("Signing in...", false);

  loginAuth
    .signInWithEmailAndPassword(email, password)
    .then(goToApp)
    .catch(function (error) {
      console.error(error);
      setLoginStatus("Sign in failed: " + error.message, true);
    });
}

function signInWithGoogle() {
  if (!loginAuth || !window.firebase) return;

  var provider = new firebase.auth.GoogleAuthProvider();
  setLoginStatus("Opening Google sign-in...", false);

  loginAuth
    .signInWithPopup(provider)
    .then(goToApp)
    .catch(function (error) {
      console.error(error);
      setLoginStatus("Google sign-in failed: " + error.message, true);
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

    loginAuth.onAuthStateChanged(function (user) {
      if (user) goToApp();
    });

    qs("#emailLoginForm").addEventListener("submit", signInWithEmail);
    qs("#googleSignInBtn").addEventListener("click", signInWithGoogle);
    setLoginStatus("Sign in to continue.", false);
  } catch (error) {
    console.error(error);
    setLoginStatus("Firebase setup failed: " + error.message, true);
  }
}

document.addEventListener("DOMContentLoaded", initLogin);
