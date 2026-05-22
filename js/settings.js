const SettingsModule = (() => {
  let initialized = false;

  // ─── Init ────────────────────────────────────────────────

  function init() {
    if (initialized) return;
    initialized = true;

    // Gate: redirect associates to dashboard
    const profile = AuthModule.getProfile();
    if (!profile || profile.role !== 'admin') {
      document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.view === 'dashboard');
      });
      AuthModule.navigateTo('dashboard');
      window.location.hash = 'dashboard';
      return;
    }

    bindWarnDays();
    bindUserList();
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

  // ─── Helpers ─────────────────────────────────────────────

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { init };
})();
