import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAtmWck4oWaziOK0bk9YrgkOp2Vc-qmCto",
  authDomain: "irongate-pool-inspection-256b4.firebaseapp.com",
  projectId: "irongate-pool-inspection-256b4",
  storageBucket: "irongate-pool-inspection-256b4.firebasestorage.app",
  messagingSenderId: "212629212493",
  appId: "1:212629212493:web:1c1c509cf020bd0fd4bb04"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
