const AddItemModule = (() => {
  let initialized = false;

  function init() {
    if (initialized) return;
    initialized = true;

    const form       = document.getElementById('add-item-form');
    const expInput   = document.getElementById('ai-exp-date');
    const pullPreview = document.getElementById('pull-date-preview');
    const pullDisplay = document.getElementById('pull-date-display');
    const errorEl    = document.getElementById('add-item-error');
    const submitBtn  = document.getElementById('add-item-btn');
    const cancelBtn  = document.getElementById('add-item-cancel');

    // Live pull-date preview when exp date changes
    expInput.addEventListener('change', () => {
      if (expInput.value) {
        pullDisplay.textContent = formatDate(calcPullDate(expInput.value));
        pullPreview.hidden = false;
      } else {
        pullPreview.hidden = true;
      }
    });

    cancelBtn.addEventListener('click', () => {
      resetForm();
      AuthModule.navigateTo('dashboard');
      window.location.hash = 'dashboard';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError();

      const productName = document.getElementById('ai-product-name').value.trim();
      const expDate     = expInput.value;
      const location    = document.getElementById('ai-location').value.trim();
      const quantityRaw = document.getElementById('ai-quantity').value.trim();
      const slowMover   = document.getElementById('ai-slow-mover').checked;
      const notes       = document.getElementById('ai-notes').value.trim();

      if (!productName) { showError('Product name is required.'); return; }
      if (!expDate)      { showError('Expiration date is required.'); return; }

      const today = getTodayStr();
      if (expDate <= today) {
        showError('Expiration date must be in the future.');
        return;
      }

      const profile = AuthModule.getProfile();
      const quantity = quantityRaw !== '' ? parseInt(quantityRaw, 10) : null;

      const item = {
        id:           generateUUID(),
        barcode:      null,
        productName,
        quantity:     (quantity !== null && !isNaN(quantity)) ? quantity : null,
        dateStocked:  today,
        expDate,
        pullDate:     calcPullDate(expDate),
        location:     location || '',
        slowMover,
        status:       'active',
        notes:        notes || '',
        addedBy:      profile ? profile.uid   : '',
        addedByName:  profile ? profile.name  : '',
        addedAt:      new Date().toISOString(),
        updatedAt:    new Date().toISOString(),
      };

      setLoading(true);
      try {
        await db.collection('floorItems').doc(item.id).set(item);
        resetForm();
        AuthModule.navigateTo('dashboard');
        window.location.hash = 'dashboard';
      } catch (err) {
        console.error('Save error:', err);
        showError('Could not save item. Check your connection and try again.');
      } finally {
        setLoading(false);
      }
    });

    function setLoading(on) {
      submitBtn.disabled = on;
      submitBtn.textContent = on ? 'Saving…' : 'Save Item';
    }

    function showError(msg) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
      errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function hideError() {
      errorEl.hidden = true;
      errorEl.textContent = '';
    }
  }

  function resetForm() {
    const form = document.getElementById('add-item-form');
    if (form) {
      form.reset();
      document.getElementById('pull-date-preview').hidden = true;
      document.getElementById('add-item-error').hidden = true;
    }
  }

  return { init, resetForm };
})();
