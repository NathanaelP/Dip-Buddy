const DashboardModule = (() => {
  let unsubscribe    = null;
  let warnDaysBefore = 3;
  let itemsCache     = {};   // id → item, kept in sync with snapshot
  let editingId      = null; // id of the item currently open in the edit modal

  async function init() {
    try {
      const snap = await db.collection('settings').doc('global').get();
      if (snap.exists && snap.data().warnDaysBefore != null) {
        warnDaysBefore = snap.data().warnDaysBefore;
      }
    } catch (e) { /* use default */ }

    wireItemListActions();
    wireEditModal();
    startListener();
  }

  // ─── Real-time listener ───────────────────────────────────

  function startListener() {
    if (unsubscribe) unsubscribe();

    const loading  = document.getElementById('dash-loading');
    const itemList = document.getElementById('item-list');
    const empty    = document.getElementById('empty-state');

    unsubscribe = db.collection('floorItems')
      .where('status', '==', 'active')
      .onSnapshot(snapshot => {
        loading.hidden = true;

        const today = getTodayStr();
        let items = snapshot.docs.map(doc => {
          const d = doc.data();
          return { ...d, displayStatus: getStatus(d, today, warnDaysBefore) };
        });

        // Rebuild cache for edit modal lookups
        itemsCache = {};
        items.forEach(item => { itemsCache[item.id] = item; });

        // expired floats above pull > warn > good, then by pullDate asc
        const order = { expired: 0, pull: 1, warn: 2, good: 3 };
        items.sort((a, b) => {
          const diff = (order[a.displayStatus] ?? 3) - (order[b.displayStatus] ?? 3);
          return diff !== 0 ? diff : a.pullDate.localeCompare(b.pullDate);
        });

        renderBanner(items);

        if (items.length === 0) {
          itemList.innerHTML = '';
          empty.hidden = false;
          return;
        }
        empty.hidden = true;
        itemList.innerHTML = items.map(renderCard).join('');
      }, err => {
        console.error('Dashboard listener error:', err);
        loading.hidden = true;
        if (err.code === 'permission-denied') {
          document.getElementById('item-list').innerHTML =
            `<p class="dash-error">Permission denied — update your Firestore rules in Firebase Console.</p>`;
        }
      });
  }

  // ─── Card rendering ───────────────────────────────────────

  function renderCard(item) {
    const s       = item.displayStatus;
    const label   = statusLabel(item);
    const loc     = item.location    ? `<span class="meta-item">&#128205; ${esc(item.location)}</span>`    : '';
    const who     = item.addedByName ? `<span class="meta-item">&#128100; ${esc(item.addedByName)}</span>` : '';
    const isAdmin = AuthModule.getProfile()?.role === 'admin';

    const brand = item.brand ? `<span class="card-brand">${esc(item.brand)}</span>` : '';

    return `
      <div class="item-card item-card--${s}" data-id="${esc(item.id)}">
        <div class="card-top">
          <div class="card-name-block">
            <span class="card-name">${esc(item.productName)}</span>
            ${brand}
          </div>
          <span class="badge badge-${s}">${label}</span>
        </div>
        ${(loc || who) ? `<div class="card-meta">${loc}${who}</div>` : ''}
        <div class="card-dates">
          <div class="date-row">
            <span class="date-label">Expires</span>
            <span class="date-value">${formatDate(item.expDate)}</span>
          </div>
          <div class="date-row">
            <span class="date-label">Pull by</span>
            <span class="date-value">${formatDate(item.pullDate)}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-action btn-action--pull" data-id="${esc(item.id)}" data-action="pull">Mark Pulled</button>
          ${isAdmin ? `<button class="btn-action btn-action--edit" data-id="${esc(item.id)}" data-action="edit">Edit</button>` : ''}
          ${isAdmin ? `<button class="btn-action btn-action--delete" data-id="${esc(item.id)}" data-action="delete">Delete</button>` : ''}
        </div>
      </div>`;
  }

  function statusLabel(item) {
    const s = item.displayStatus;
    if (s === 'expired') return 'Expired';
    if (s === 'pull')    return item.slowMover ? 'Pull Today &mdash; Morning' : 'Pull Today &mdash; Evening';
    if (s === 'warn') {
      const [py, pm, pd] = item.pullDate.split('-').map(Number);
      const [ty, tm, td] = getTodayStr().split('-').map(Number);
      const days = Math.round((Date.UTC(py, pm - 1, pd) - Date.UTC(ty, tm - 1, td)) / 86400000);
      return `Pulls in ${days} day${days !== 1 ? 's' : ''}`;
    }
    return 'Good';
  }

  // ─── Item list action delegation ──────────────────────────
  // Single persistent listener — avoids re-attaching on every snapshot.

  function wireItemListActions() {
    document.getElementById('item-list').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === 'pull')   markPulled(id);
      if (action === 'edit')   openEditModal(id);
      if (action === 'delete') confirmDelete(id);
    });
  }

  // ─── Actions ─────────────────────────────────────────────

  function markPulled(id) {
    db.collection('floorItems').doc(id).update({
      status:    'pulled',
      updatedAt: new Date().toISOString(),
    }).catch(err => {
      console.error('markPulled error:', err);
      alert('Could not mark item as pulled. Check your connection.');
    });
  }

  function confirmDelete(id) {
    const item = itemsCache[id];
    const name = item ? item.productName : 'this item';
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    db.collection('floorItems').doc(id).delete()
      .catch(err => {
        console.error('delete error:', err);
        alert('Could not delete item. Check your connection.');
      });
  }

  // ─── Edit modal ───────────────────────────────────────────

  function wireEditModal() {
    const overlay  = document.getElementById('edit-item-overlay');
    const closeBtn = document.getElementById('edit-item-close');
    const form     = document.getElementById('edit-item-form');
    const expInput = document.getElementById('ei-exp-date');
    const pullPrev = document.getElementById('ei-pull-preview');
    const pullDisp = document.getElementById('ei-pull-display');
    const errEl    = document.getElementById('edit-item-error');
    const saveBtn  = document.getElementById('edit-item-save');

    closeBtn.addEventListener('click', () => { overlay.hidden = true; editingId = null; });

    expInput.addEventListener('change', () => {
      if (expInput.value) {
        pullDisp.textContent = formatDate(calcPullDate(expInput.value));
        pullPrev.hidden = false;
      } else {
        pullPrev.hidden = true;
      }
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!editingId) return;

      const productName = document.getElementById('ei-product-name').value.trim();
      const expDate     = expInput.value;
      const location    = document.getElementById('ei-location').value.trim();
      const quantityRaw = document.getElementById('ei-quantity').value.trim();
      const slowMover   = document.getElementById('ei-slow-mover').checked;
      const notes       = document.getElementById('ei-notes').value.trim();

      if (!productName) { showEditError('Product name is required.'); return; }
      if (!expDate)      { showEditError('Expiration date is required.'); return; }

      const today = getTodayStr();
      if (expDate <= today) { showEditError('Expiration date must be in the future.'); return; }

      const quantity = quantityRaw !== '' ? parseInt(quantityRaw, 10) : null;

      saveBtn.disabled    = true;
      saveBtn.textContent = 'Saving…';
      errEl.hidden        = true;

      try {
        await db.collection('floorItems').doc(editingId).update({
          productName,
          expDate,
          pullDate:  calcPullDate(expDate),
          location:  location || '',
          quantity:  (quantity !== null && !isNaN(quantity)) ? quantity : null,
          slowMover,
          notes:     notes || '',
          updatedAt: new Date().toISOString(),
        });
        overlay.hidden = true;
        editingId = null;
      } catch (err) {
        console.error('Edit save error:', err);
        showEditError('Could not save changes. Check your connection.');
      } finally {
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Save Changes';
      }
    });

    function showEditError(msg) {
      errEl.textContent = msg;
      errEl.hidden = false;
    }
  }

  function openEditModal(id) {
    const item = itemsCache[id];
    if (!item) return;

    editingId = id;

    document.getElementById('ei-product-name').value = item.productName || '';
    document.getElementById('ei-exp-date').value     = item.expDate     || '';
    document.getElementById('ei-location').value     = item.location    || '';
    document.getElementById('ei-quantity').value     = item.quantity != null ? item.quantity : '';
    document.getElementById('ei-slow-mover').checked = item.slowMover   || false;
    document.getElementById('ei-notes').value        = item.notes       || '';

    const pullPrev = document.getElementById('ei-pull-preview');
    const pullDisp = document.getElementById('ei-pull-display');
    if (item.pullDate) {
      pullDisp.textContent = formatDate(item.pullDate);
      pullPrev.hidden = false;
    } else {
      pullPrev.hidden = true;
    }

    document.getElementById('edit-item-error').hidden = true;
    document.getElementById('edit-item-overlay').hidden = false;
  }

  // ─── Banner ───────────────────────────────────────────────

  function renderBanner(items) {
    const banner = document.getElementById('urgent-banner');
    const text   = document.getElementById('urgent-text');

    const expired = items.filter(i => i.displayStatus === 'expired').length;
    const pull    = items.filter(i => i.displayStatus === 'pull').length;

    if (expired + pull === 0) { banner.hidden = true; return; }

    const parts = [];
    if (expired) parts.push(`${expired} expired`);
    if (pull)    parts.push(`${pull} to pull today`);
    text.textContent = `⚠ ${parts.join(', ')} — tap to review`;
    banner.hidden = false;

    banner.onclick = () => {
      const first = document.querySelector('.item-card--expired, .item-card--pull');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
  }

  // ─── Helpers ──────────────────────────────────────────────

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { init };
})();
