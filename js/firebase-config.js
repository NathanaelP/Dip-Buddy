const firebaseConfig = {
  apiKey: "AIzaSyC4T54uze4a8i8XvKSS5dXkZilyA61Dkr8",
  authDomain: "dip-buddy.firebaseapp.com",
  projectId: "dip-buddy",
  storageBucket: "dip-buddy.firebasestorage.app",
  messagingSenderId: "353060005633",
  appId: "1:353060005633:web:968197bd90278e42e11d00",
  measurementId: "G-1HFTT8LTJM"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

db.enablePersistence().catch(err => {
  console.warn('Offline persistence unavailable:', err.code);
});
