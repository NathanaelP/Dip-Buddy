const SettingsModule = (() => {
  let initialized = false;

  // ─── Init ────────────────────────────────────────────────

  function init() {
    if (initialized) return;
    initialized = true;

    const profile = AuthModule.getProfile();

    // Change Password is available to every authenticated user
    bindChangePassword();

    // Admin-only sections
    if (!profile || profile.role !== 'admin') {
      document.getElementById('settings-admin-sections').hidden = true;
      return;
    }

    bindWarnDays();
    bindUserList();
    bindAddUser();
  }

  // ─── Change Password ─────────────────────────────────────

  function bindChangePassword() {
    const form    = document.getElementById('change-password-form');
    const currIn  = document.getElementById('cp-current');
    const newIn   = document.getElementById('cp-new');
    const confIn  = document.getElementById('cp-confirm');
    const errEl   = document.getElementById('cp-error');
    const sucEl   = document.getElementById('cp-success');
    const btn     = document.getElementById('cp-btn');

    form.addEventListener('submit', async e => {
      e.preventDefault();
      errEl.hidden = true;
      sucEl.hidden = true;

      const current = currIn.value;
      const newPass = newIn.value;
      const confirm = confIn.value;

      if (!current)          { showErr('Enter your current password.');      return; }
      if (newPass.length < 6){ showErr('New password must be at least 6 characters.'); return; }
      if (newPass !== confirm){ showErr('New passwords do not match.');       return; }
      if (newPass === current){ showErr('New password must differ from current.'); return; }

      btn.disabled    = true;
      btn.textContent = 'Updating…';

      try {
        const user       = auth.currentUser;
        const credential = firebase.auth.EmailAuthProvider.credential(user.email, current);
        await user.reauthenticateWithCredential(credential);
        await user.updatePassword(newPass);
        form.reset();
        sucEl.hidden = false;
        setTimeout(() => { sucEl.hidden = true; }, 4000);
      } catch (err) {
        console.error('Password change error:', err);
        const msg =
          err.code === 'auth/wrong-password'     ? 'Current password is incorrect.' :
          err.code === 'auth/weak-password'      ? 'New password must be at least 6 characters.' :
          err.code === 'auth/requires-recent-login'
            ? 'Session expired — sign out and back in, then try again.' :
          'Could not update password. Check your connection.';
        showErr(msg);
      } finally {
        btn.disabled    = false;
        btn.textContent = 'Update Password';
      }
    });

    function showErr(msg) {
      errEl.textContent = msg;
      errEl.hidden = false;
    }
  }

  // ─── Warn Days Before ────────────────────────────────────

  function bindWarnDays() {
    const input   = document.getElementById('settings-warn-days');
    const saveBtn = document.getElementById('settings-warn-save');
    const status  = document.getElementById('settings-warn-status');

    // Load current value
    db.collection('settings').doc('global').get().then(snap => {
      const val = snap.exists ? (snap.data().warnDaysBefore ?? 3) : 3;
      input.value = val;
    }).catch(() => {
      input.value = 3;
    });

    saveBtn.addEventListener('click', async () => {
      const days = parseInt(input.value, 10);
      if (isNaN(days) || days < 1 || days > 14) {
        showWarnStatus('Enter a number between 1 and 14.', false);
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        await db.collection('settings').doc('global').set(
          { warnDaysBefore: days }, { merge: true }
        );
        showWarnStatus('Saved.', true);
      } catch (err) {
        console.error('Settings save error:', err);
        showWarnStatus('Could not save. Check your connection.', false);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    });

    function showWarnStatus(msg, ok) {
      status.textContent = msg;
      status.className   = 'settings-status ' + (ok ? 'settings-status--ok' : 'settings-status--err');
      status.hidden = false;
      setTimeout(() => { status.hidden = true; }, 3000);
    }
  }

  // ─── User List ───────────────────────────────────────────

  function bindUserList() {
    const list    = document.getElementById('settings-user-list');
    const loading = document.getElementById('settings-users-loading');
    const errEl   = document.getElementById('settings-users-error');
    const myUid   = AuthModule.getCurrentUser()?.uid;

    db.collection('users').orderBy('name').get()
      .then(snap => {
        loading.hidden = true;

        if (snap.empty) {
          list.innerHTML = '<p class="settings-empty">No users found.</p>';
          return;
        }

        snap.docs.forEach(docSnap => {
          const user = docSnap.data();
          const row  = buildUserRow(user, myUid);
          list.appendChild(row);
        });
      })
      .catch(err => {
        console.error('User list error:', err);
        loading.hidden = true;
        errEl.textContent = 'Could not load users. Check your connection.';
        errEl.hidden = false;
      });
  }

  function buildUserRow(user, myUid) {
    const isSelf  = user.uid === myUid;
    const isAdmin = user.role === 'admin';

    const row = document.createElement('div');
    row.className = 'user-row';
    row.dataset.uid = user.uid;

    row.innerHTML = `
      <div class="user-row-info">
        <span class="user-row-name">${esc(user.name || user.email)}</span>
        <span class="user-row-email">${esc(user.email)}</span>
      </div>
      <div class="user-row-controls">
        <span class="user-role-badge ${isAdmin ? 'badge-admin' : 'badge-associate'}">${isAdmin ? 'Admin' : 'Associate'}</span>
        ${isSelf
          ? '<span class="user-row-self">You</span>'
          : `<button type="button" class="btn-role-toggle" data-uid="${esc(user.uid)}" data-current="${esc(user.role)}">
               ${isAdmin ? 'Make Associate' : 'Make Admin'}
             </button>`
        }
      </div>`;

    if (!isSelf) {
      const btn = row.querySelector('.btn-role-toggle');
      btn.addEventListener('click', () => handleRoleToggle(btn, user));
    }

    return row;
  }

  async function handleRoleToggle(btn, user) {
    const newRole = user.role === 'admin' ? 'associate' : 'admin';
    const label   = newRole === 'admin' ? 'Make Admin' : 'Make Associate';

    if (!confirm(`Change ${user.name || user.email} to ${newRole}?`)) return;

    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      await db.collection('users').doc(user.uid).update({ role: newRole });
      user.role = newRole;

      const badge = btn.closest('.user-row').querySelector('.user-role-badge');
      badge.textContent = newRole === 'admin' ? 'Admin' : 'Associate';
      badge.className   = 'user-role-badge ' + (newRole === 'admin' ? 'badge-admin' : 'badge-associate');
      btn.textContent   = label;
      btn.dataset.current = newRole;
    } catch (err) {
      console.error('Role update error:', err);
      btn.textContent = 'Error — retry';
    } finally {
      btn.disabled = false;
    }
  }

  // ─── Add Team Member ─────────────────────────────────────
  // Uses a secondary Firebase app instance so createUserWithEmailAndPassword
  // does not sign out the currently logged-in admin.

  function bindAddUser() {
    const form    = document.getElementById('add-user-form');
    const nameIn  = document.getElementById('new-user-name');
    const emailIn = document.getElementById('new-user-email');
    const passIn  = document.getElementById('new-user-password');
    const roleIn  = document.getElementById('new-user-role');
    const errEl   = document.getElementById('add-user-error');
    const sucEl   = document.getElementById('add-user-success');
    const btn     = document.getElementById('add-user-btn');

    form.addEventListener('submit', async e => {
      e.preventDefault();
      errEl.hidden = true;
      sucEl.hidden = true;

      const name     = nameIn.value.trim();
      const email    = emailIn.value.trim();
      const password = passIn.value;
      const role     = roleIn.value;

      if (!name)            { showErr('Name is required.');                  return; }
      if (!email)           { showErr('Email is required.');                 return; }
      if (password.length < 6) { showErr('Password must be at least 6 characters.'); return; }

      btn.disabled    = true;
      btn.textContent = 'Creating…';

      // Secondary app keeps the admin's own auth session untouched.
      const tmpName      = 'dip-buddy-create-' + Date.now();
      const secondaryApp = firebase.initializeApp(firebase.app().options, tmpName);
      const secondaryAuth = secondaryApp.auth();

      try {
        const cred = await secondaryAuth.createUserWithEmailAndPassword(email, password);
        const uid  = cred.user.uid;

        await db.collection('users').doc(uid).set({
          uid,
          name,
          email,
          role,
          createdAt: new Date().toISOString(),
        });

        // Append to the visible user list without a full reload
        const list = document.getElementById('settings-user-list');
        const myUid = AuthModule.getCurrentUser()?.uid;
        list.appendChild(buildUserRow({ uid, name, email, role }, myUid));

        // Show shareable credentials
        sucEl.innerHTML =
          `<strong>Account created!</strong><br>` +
          `Name: ${esc(name)}<br>` +
          `Email: ${esc(email)}<br>` +
          `Password: ${esc(password)}<br>` +
          `<span class="add-user-success-hint">Share these with ${esc(name)} in person.</span>`;
        sucEl.hidden = false;
        form.reset();
      } catch (err) {
        console.error('Create user error:', err);
        const msg = err.code === 'auth/email-already-in-use'
          ? 'An account with that email already exists.'
          : err.code === 'auth/invalid-email'
          ? 'Enter a valid email address.'
          : 'Could not create account. Check your connection.';
        showErr(msg);
      } finally {
        btn.disabled    = false;
        btn.textContent = 'Create Account';
        await secondaryAuth.signOut().catch(() => {});
        await secondaryApp.delete().catch(() => {});
      }
    });

    function showErr(msg) {
      errEl.textContent = msg;
      errEl.hidden = false;
    }
  }

  // ─── Helpers ─────────────────────────────────────────────

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { init };
})();
