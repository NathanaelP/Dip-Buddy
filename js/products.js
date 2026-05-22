const ProductsModule = (() => {
  let initialized = false;
  let allProducts  = [];
  let editingBarcode = null;

  // ─── Init ────────────────────────────────────────────────

  function init() {
    if (initialized) return;
    initialized = true;

    document.getElementById('products-search').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      const filtered = q
        ? allProducts.filter(p =>
            (p.name    || '').toLowerCase().includes(q) ||
            (p.brand   || '').toLowerCase().includes(q) ||
            (p.barcode || '').includes(q)
          )
        : allProducts;
      renderList(filtered);
    });

    document.getElementById('edit-product-close').addEventListener('click', closeEdit);
    document.getElementById('edit-product-delete').addEventListener('click', handleDelete);
    document.getElementById('edit-product-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveEdit();
    });

    startListener();
  }

  // ─── Firestore Listener ──────────────────────────────────

  function startListener() {
    db.collection('products').onSnapshot(snapshot => {
      allProducts = snapshot.docs
        .map(d => d.data())
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      // Re-apply any active search filter
      const q = (document.getElementById('products-search').value || '').trim().toLowerCase();
      renderList(q ? allProducts.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.brand || '').toLowerCase().includes(q) ||
        (p.barcode || '').includes(q)
      ) : allProducts);
    }, err => {
      console.error('Products listener error:', err);
      document.getElementById('products-loading').hidden = true;
    });
  }

  // ─── Rendering ───────────────────────────────────────────

  function renderList(products) {
    const list    = document.getElementById('products-list');
    const empty   = document.getElementById('products-empty');
    const loading = document.getElementById('products-loading');
    const count   = document.getElementById('products-count');

    loading.hidden = true;
    const isAdmin = AuthModule.getProfile()?.role === 'admin';

    if (products.length === 0) {
      list.innerHTML = '';
      empty.hidden = false;
      count.hidden  = true;
      return;
    }

    empty.hidden  = false;
    empty.hidden  = true;
    count.hidden  = false;
    count.textContent = `${products.length} product${products.length !== 1 ? 's' : ''} in catalog`;

    list.innerHTML = products.map(p => renderCard(p, isAdmin)).join('');

    if (isAdmin) {
      list.querySelectorAll('.product-card--editable').forEach(card => {
        card.addEventListener('click', () => openEdit(card.dataset.barcode));
      });
    }
  }

  function renderCard(p, isAdmin) {
    const slowLabel = p.slowMover ? 'Morning pull' : 'Evening pull';
    const slowClass = p.slowMover ? 'badge-warn'   : 'badge-good';
    const editable  = isAdmin ? ' product-card--editable' : '';
    return `
      <div class="product-card${editable}" data-barcode="${esc(p.barcode)}">
        <div class="product-card-main">
          <span class="product-name">${esc(p.name || '—')}</span>
          ${p.brand ? `<span class="product-brand">${esc(p.brand)}</span>` : ''}
        </div>
        <div class="product-card-meta">
          <span class="product-barcode">${esc(p.barcode)}</span>
          <span class="badge ${slowClass}">${slowLabel}</span>
          ${isAdmin ? '<span class="product-edit-hint">Edit</span>' : ''}
        </div>
      </div>`;
  }

  // ─── Edit Sheet (admin only) ─────────────────────────────

  function openEdit(barcode) {
    const p = allProducts.find(x => x.barcode === barcode);
    if (!p) return;
    editingBarcode = barcode;
    document.getElementById('edit-product-name').value      = p.name     || '';
    document.getElementById('edit-product-brand').value     = p.brand    || '';
    document.getElementById('edit-product-category').value  = p.category || '';
    document.getElementById('edit-product-slow-mover').checked = p.slowMover || false;
    document.getElementById('edit-product-error').hidden    = true;
    document.getElementById('edit-product-overlay').hidden  = false;
  }

  function closeEdit() {
    editingBarcode = null;
    document.getElementById('edit-product-overlay').hidden = true;
  }

  async function saveEdit() {
    if (!editingBarcode) return;
    const name      = document.getElementById('edit-product-name').value.trim();
    const brand     = document.getElementById('edit-product-brand').value.trim();
    const category  = document.getElementById('edit-product-category').value.trim();
    const slowMover = document.getElementById('edit-product-slow-mover').checked;
    const errEl     = document.getElementById('edit-product-error');
    const saveBtn   = document.getElementById('edit-product-save');

    if (!name) {
      errEl.textContent = 'Name is required.';
      errEl.hidden = false;
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    errEl.hidden = true;

    try {
      await db.collection('products').doc(editingBarcode).update({
        name, brand, category, slowMover
      });
      closeEdit();
    } catch (err) {
      console.error('Product save error:', err);
      errEl.textContent = 'Could not save. Check your connection.';
      errEl.hidden = false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  }

  async function handleDelete() {
    if (!editingBarcode) return;
    if (!confirm('Remove this product from the catalog? Existing floor items are not affected.')) return;

    try {
      await db.collection('products').doc(editingBarcode).delete();
      closeEdit();
    } catch (err) {
      console.error('Product delete error:', err);
      const errEl = document.getElementById('edit-product-error');
      errEl.textContent = 'Could not delete. Check your connection.';
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
