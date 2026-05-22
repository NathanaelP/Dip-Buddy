// Auth gatekeeper — controls login/app visibility and hash routing

let currentUser = null;

const loginScreen   = document.getElementById('login-screen');
const appShell      = document.getElementById('app-shell');
const loginForm     = document.getElementById('login-form');
const emailInput    = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginError    = document.getElementById('login-error');
const loginBtn      = document.getElementById('login-btn');
const logoutBtn     = document.getElementById('logout-btn');

// ─── Auth State ────────────────────────────────────────────

auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    try {
      await ensureUserDoc(user);
    } catch (err) {
      console.warn('Could not write user doc (check Firestore rules):', err);
    }
    showApp();
    if (typeof DashboardModule !== 'undefined') DashboardModule.init();
  } else {
    currentUser = null;
    showLogin();
  }
});

async function ensureUserDoc(user) {
  const ref = db.collection('users').doc(user.uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      uid: user.uid,
      email: user.email,
      name: user.displayName || user.email.split('@')[0],
      role: 'associate',
      createdAt: new Date().toISOString()
    });
  }
}

// ─── Login Form ────────────────────────────────────────────

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email    = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showError('Please enter your email and password.');
    return;
  }

  setLoading(true);
  hideError();

  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    showError(mapAuthError(err.code));
  } finally {
    setLoading(false);
  }
});

// Clear error when user starts correcting their input
emailInput.addEventListener('input', hideError);
passwordInput.addEventListener('input', hideError);

// ─── Logout ─────────────────────────────────────────────────

logoutBtn.addEventListener('click', async () => {
  await auth.signOut();
});

// ─── Show/Hide Screens ──────────────────────────────────────

function showApp() {
  loginScreen.hidden = true;
  appShell.hidden = false;
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  navigateTo(hash);
}

function showLogin() {
  loginScreen.hidden = false;
  appShell.hidden = true;
  loginForm.reset();
  hideError();
}

// ─── Hash Routing ───────────────────────────────────────────

function navigateTo(viewId) {
  const validViews = ['dashboard', 'add-item', 'products', 'settings'];
  if (!validViews.includes(viewId)) viewId = 'dashboard';

  document.querySelectorAll('.view').forEach(v => {
    v.hidden = true;
    v.classList.remove('active');
  });

  const target = document.getElementById('view-' + viewId);
  if (target) {
    target.hidden = false;
    target.classList.add('active');
  }

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewId);
  });
}

window.addEventListener('hashchange', () => {
  if (!currentUser) return;
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  navigateTo(hash);
});

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const view = item.dataset.view;
    window.location.hash = view;
    navigateTo(view);
  });
});

// ─── Helpers ────────────────────────────────────────────────

function setLoading(isLoading) {
  loginBtn.disabled = isLoading;
  loginBtn.textContent = isLoading ? 'Signing in...' : 'Sign In';
}

function showError(msg) {
  loginError.textContent = msg;
  loginError.hidden = false;
}

function hideError() {
  loginError.hidden = true;
  loginError.textContent = '';
}

function mapAuthError(code) {
  const messages = {
    'auth/invalid-email':          "That doesn't look like a valid email address.",
    'auth/user-not-found':         'No account found with that email.',
    'auth/wrong-password':         'Incorrect password.',
    'auth/invalid-credential':     'Incorrect email or password.',
    'auth/too-many-requests':      'Too many failed attempts. Try again in a few minutes.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.',
    'auth/user-disabled':          'This account has been disabled. Contact your manager.',
  };
  return messages[code] || 'Sign in failed. Please try again.';
}

// ─── Exposed Interface ──────────────────────────────────────

window.AuthModule = {
  getCurrentUser: () => currentUser,
  navigateTo,
};
