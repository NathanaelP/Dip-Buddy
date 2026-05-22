const AddItemModule = (() => {
  let initialized   = false;
  let scannedBarcode = null;
  let codeReader    = null;
  let scannerActive = false;

  // ─── Init ────────────────────────────────────────────────

  function init() {
    if (initialized) return;
    initialized = true;

    const form        = document.getElementById('add-item-form');
    const expInput    = document.getElementById('ai-exp-date');
    const pullPreview = document.getElementById('pull-date-preview');
    const pullDisplay = document.getElementById('pull-date-display');
    const errorEl     = document.getElementById('add-item-error');
    const submitBtn   = document.getElementById('add-item-btn');
    const cancelBtn   = document.getElementById('add-item-cancel');

    // Pull-date live preview
    expInput.addEventListener('change', () => {
      if (expInput.value) {
        pullDisplay.textContent = formatDate(calcPullDate(expInput.value));
        pullPreview.hidden = false;
      } else {
        pullPreview.hidden = true;
      }
    });

    // Scanner buttons
    document.getElementById('scan-barcode-btn').addEventListener('click', startScanner);
    document.getElementById('scanner-close').addEventListener('click', stopScanner);
    document.getElementById('scan-clear').addEventListener('click', clearScan);

    cancelBtn.addEventListener('click', () => {
      stopScanner();
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
      if (expDate <= today) { showError('Expiration date must be in the future.'); return; }

      const profile  = AuthModule.getProfile();
      const quantity = quantityRaw !== '' ? parseInt(quantityRaw, 10) : null;

      const item = {
        id:          generateUUID(),
        barcode:     scannedBarcode || null,
        productName,
        quantity:    (quantity !== null && !isNaN(quantity)) ? quantity : null,
        dateStocked: today,
        expDate,
        pullDate:    calcPullDate(expDate),
        location:    location || '',
        slowMover,
        status:      'active',
        notes:       notes || '',
        addedBy:     profile ? profile.uid  : '',
        addedByName: profile ? profile.name : '',
        addedAt:     new Date().toISOString(),
        updatedAt:   new Date().toISOString(),
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

  // ─── Scanner ─────────────────────────────────────────────

  async function startScanner() {
    if (typeof ZXing === 'undefined') {
      setScanStatus('Scanner unavailable — enter name manually', false);
      document.getElementById('scan-result').hidden = false;
      return;
    }

    const overlay = document.getElementById('scanner-overlay');
    const errEl   = document.getElementById('scanner-error');
    overlay.hidden = false;
    errEl.hidden   = true;

    try {
      codeReader = new ZXing.BrowserMultiFormatReader();
      const devices = await codeReader.listVideoInputDevices();

      if (!devices.length) throw new Error('No camera found on this device.');

      // Prefer the back/environment-facing camera
      const device = devices.find(d => /back|rear|environment/i.test(d.label))
                     || devices[devices.length - 1];

      scannerActive = true;
      await codeReader.decodeFromVideoDevice(
        device.deviceId,
        'scanner-video',
        (result, error) => {
          if (result && scannerActive) {
            scannerActive = false;
            const barcode = result.getText();
            stopScanner();
            handleBarcode(barcode);
          }
          // NotFoundException fires every frame when no barcode visible — ignore
        }
      );
    } catch (err) {
      console.error('Scanner error:', err);
      errEl.textContent = err.message || 'Camera unavailable. Enter name manually.';
      errEl.hidden = false;
    }
  }

  function stopScanner() {
    scannerActive = false;
    if (codeReader) {
      try { codeReader.reset(); } catch (_) {}
      codeReader = null;
    }
    document.getElementById('scanner-overlay').hidden = true;
  }

  // ─── Product Lookup ──────────────────────────────────────

  async function handleBarcode(barcode) {
    const resultBanner = document.getElementById('scan-result');
    resultBanner.hidden = false;
    resultBanner.classList.remove('scan-result--found');
    setScanStatus('Looking up product…', false);

    // 1. Firestore /products catalog
    let product = null;
    try {
      const snap = await db.collection('products').doc(barcode).get();
      if (snap.exists) product = snap.data();
    } catch (err) {
      console.warn('Firestore product lookup failed:', err);
    }

    // 2. Open Food Facts fallback
    if (!product) {
      product = await lookupOpenFoodFacts(barcode);
      if (product) saveProductToFirestore(barcode, product);
    }

    scannedBarcode = barcode;

    if (product && product.name) {
      document.getElementById('ai-product-name').value = product.name;
      document.getElementById('ai-slow-mover').checked = product.slowMover || false;
      setScanStatus('✓ ' + product.name, true);
      resultBanner.classList.add('scan-result--found');
    } else {
      setScanStatus('Product not found — enter name below', false);
      document.getElementById('ai-product-name').focus();
    }
  }

  async function lookupOpenFoodFacts(barcode) {
    try {
      const opts = typeof AbortSignal?.timeout === 'function'
        ? { signal: AbortSignal.timeout(4000) } : {};
      const res = await fetch(
        `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`, opts
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (data.status === 1 && data.product) {
        const name = data.product.product_name_en || data.product.product_name || '';
        if (!name) return null;
        return {
          name,
          brand:    data.product.brands   || '',
          imageUrl: data.product.image_url || null,
          slowMover: false,
        };
      }
    } catch (err) {
      console.warn('Open Food Facts lookup failed:', err);
    }
    return null;
  }

  function saveProductToFirestore(barcode, product) {
    const profile = AuthModule.getProfile();
    db.collection('products').doc(barcode).set({
      barcode,
      name:      product.name,
      brand:     product.brand    || '',
      category:  '',
      slowMover: false,
      imageUrl:  product.imageUrl || null,
      addedAt:   getTodayStr(),
      addedBy:   profile ? profile.uid : '',
    }).catch(err => console.warn('Could not cache product:', err));
  }

  // ─── Scan UI Helpers ─────────────────────────────────────

  function setScanStatus(text, found) {
    const el = document.getElementById('scan-status');
    if (el) el.textContent = text;
  }

  function clearScan() {
    scannedBarcode = null;
    document.getElementById('ai-product-name').value = '';
    document.getElementById('ai-slow-mover').checked = false;
    const banner = document.getElementById('scan-result');
    banner.hidden = true;
    banner.classList.remove('scan-result--found');
  }

  // ─── Public ──────────────────────────────────────────────

  function resetForm() {
    const form = document.getElementById('add-item-form');
    if (form) form.reset();
    clearScan();
    const pp = document.getElementById('pull-date-preview');
    if (pp) pp.hidden = true;
    const err = document.getElementById('add-item-error');
    if (err) err.hidden = true;
  }

  return { init, resetForm };
})();
