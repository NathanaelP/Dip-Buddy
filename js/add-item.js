const AddItemModule = (() => {
  let initialized    = false;
  let scannedBarcode = null;
  let codeReader     = null;
  let scannerActive  = false;

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

    expInput.addEventListener('change', () => {
      if (expInput.value) {
        pullDisplay.textContent = formatDate(calcPullDate(expInput.value));
        pullPreview.hidden = false;
      } else {
        pullPreview.hidden = true;
      }
    });

    // Barcode scanner
    document.getElementById('scan-barcode-btn').addEventListener('click', startScanner);
    document.getElementById('scanner-close').addEventListener('click', stopScanner);
    document.getElementById('scan-clear').addEventListener('click', clearScan);

    // OCR — use file input so iOS opens native camera without streaming issues
    const ocrInput = document.getElementById('ocr-photo-input');
    document.getElementById('ocr-scan-btn').addEventListener('click', () => ocrInput.click());
    ocrInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) await runOCR(file);
      ocrInput.value = ''; // allow re-selecting the same file
    });

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

  // ─── Barcode Scanner ─────────────────────────────────────
  // Uses decodeFromConstraints + facingMode instead of device-ID
  // enumeration — required for iOS Safari compatibility.

  async function startScanner() {
    if (typeof ZXing === 'undefined') {
      setScanStatus('Scanner unavailable — enter name manually');
      document.getElementById('scan-result').hidden = false;
      return;
    }

    const overlay = document.getElementById('scanner-overlay');
    const errEl   = document.getElementById('scanner-error');
    overlay.hidden = false;
    errEl.hidden   = true;

    try {
      codeReader    = new ZXing.BrowserMultiFormatReader();
      scannerActive = true;

      await codeReader.decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: 'environment' },
            width:      { ideal: 1280 },
            height:     { ideal: 720 },
          },
        },
        'scanner-video',
        (result, error) => {
          if (result && scannerActive) {
            scannerActive = false;
            stopScanner();
            handleBarcode(result.getText());
          }
          // ZXing fires NotFoundException every frame when no barcode visible — ignore
        }
      );
    } catch (err) {
      console.error('Scanner error:', err);
      const msg = /[Pp]ermission/.test(err.message)
        ? 'Camera permission denied. Allow camera in your browser settings and try again.'
        : (err.message || 'Camera unavailable. Enter the product name manually.');
      errEl.textContent = msg;
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
    const banner = document.getElementById('scan-result');
    banner.hidden = false;
    banner.classList.remove('scan-result--found');
    setScanStatus('Looking up product…');

    let product = null;
    try {
      const snap = await db.collection('products').doc(barcode).get();
      if (snap.exists) product = snap.data();
    } catch (err) {
      console.warn('Firestore product lookup failed:', err);
    }

    if (!product) {
      product = await lookupOpenFoodFacts(barcode);
      if (product) saveProductToFirestore(barcode, product);
    }

    scannedBarcode = barcode;

    if (product && product.name) {
      document.getElementById('ai-product-name').value = product.name;
      document.getElementById('ai-slow-mover').checked = product.slowMover || false;
      setScanStatus('✓ ' + product.name);
      banner.classList.add('scan-result--found');
    } else {
      setScanStatus('Product not found — enter name below');
      document.getElementById('ai-product-name').focus();
    }
  }

  async function lookupOpenFoodFacts(barcode) {
    try {
      const opts = typeof AbortSignal?.timeout === 'function'
        ? { signal: AbortSignal.timeout(4000) } : {};
      const res  = await fetch(
        `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`, opts
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (data.status === 1 && data.product) {
        const name = data.product.product_name_en || data.product.product_name || '';
        if (!name) return null;
        return {
          name,
          brand:    data.product.brands    || '',
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

  function setScanStatus(text) {
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

  // ─── OCR ─────────────────────────────────────────────────
  // Photo capture uses <input type="file" capture="environment">
  // instead of getUserMedia streaming — this is the only reliable
  // approach on iOS Safari for still-image capture.

  async function runOCR(file) {
    const resultEl = document.getElementById('ocr-result');
    resultEl.hidden = false;
    resultEl.classList.remove('ocr-result--found');
    setOCRStatus('Processing image…');

    if (typeof Tesseract === 'undefined') {
      setOCRStatus('OCR not available — enter date manually.');
      return;
    }

    try {
      const canvas = await preprocessImage(file);

      const { data } = await Tesseract.recognize(canvas, 'eng', {
        logger: m => {
          if (m.status === 'recognizing text') {
            setOCRStatus(`Scanning… ${Math.round(m.progress * 100)}%`);
          }
        },
      });

      const date = parseDateFromOCR(data.text);

      if (date) {
        const expInput = document.getElementById('ai-exp-date');
        expInput.value = date;
        expInput.dispatchEvent(new Event('change'));
        setOCRStatus('Date found: ' + formatDate(date));
        resultEl.classList.add('ocr-result--found');
      } else {
        setOCRStatus('No date found — enter manually.');
      }
    } catch (err) {
      console.error('OCR error:', err);
      setOCRStatus('OCR failed — enter date manually.');
    }
  }

  function preprocessImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);

        // Cap dimensions to avoid memory crashes on iOS
        const MAX = 1200;
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > MAX || h > MAX) {
          const s = Math.min(MAX / w, MAX / h);
          w = Math.round(w * s);
          h = Math.round(h * s);
        }

        const canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;

        for (let i = 0; i < d.length; i += 4) {
          // Luminance grayscale
          const gray     = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          // Contrast stretch then hard threshold
          const boosted  = Math.min(255, Math.max(0, (gray - 128) * 1.6 + 128));
          const binary   = boosted > 135 ? 255 : 0;
          d[i] = d[i + 1] = d[i + 2] = binary;
        }

        ctx.putImageData(imgData, 0, 0);
        resolve(canvas);
      };

      img.onerror = reject;
      img.src = url;
    });
  }

  function parseDateFromOCR(text) {
    const MONTHS = {
      jan:1, feb:2, mar:3, apr:4, may:5,  jun:6,
      jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
    };

    // YYYY-MM-DD
    let m = text.match(/\b(\d{4})[\/\-](\d{2})[\/\-](\d{2})\b/);
    if (m) {
      const d = `${m[1]}-${m[2]}-${m[3]}`;
      if (isPlausible(d)) return d;
    }

    // MM/DD/YY, MM-DD-YY, MM.DD.YY etc.
    m = text.match(/\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})\b/);
    if (m) {
      const yr = m[3].length === 2
        ? (parseInt(m[3], 10) < 50 ? '20' + m[3] : '19' + m[3])
        : m[3];
      const d = `${yr}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
      if (isPlausible(d)) return d;
    }

    // MAY 28 2026 or MAY28, 2026
    m = text.match(/\b([A-Za-z]{3})\s*(\d{1,2})[,\s]+(\d{4})\b/);
    if (m) {
      const mon = MONTHS[m[1].toLowerCase()];
      if (mon) {
        const d = `${m[3]}-${String(mon).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
        if (isPlausible(d)) return d;
      }
    }

    return null;
  }

  function isPlausible(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    if (isNaN(d.getTime())) return false;
    const yr = d.getUTCFullYear();
    return yr >= 2020 && yr <= 2035;
  }

  function setOCRStatus(text) {
    const el = document.getElementById('ocr-status');
    if (el) el.textContent = text;
  }

  // ─── Public ──────────────────────────────────────────────

  function resetForm() {
    const form = document.getElementById('add-item-form');
    if (form) form.reset();
    clearScan();
    ['pull-date-preview', 'add-item-error'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    });
    const ocr = document.getElementById('ocr-result');
    if (ocr) { ocr.hidden = true; ocr.classList.remove('ocr-result--found'); }
  }

  return { init, resetForm };
})();
