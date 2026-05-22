const DashboardModule = (() => {
  let unsubscribe = null;
  let warnDaysBefore = 3;

  async function init() {
    try {
      const snap = await db.collection('settings').doc('global').get();
      if (snap.exists && snap.data().warnDaysBefore != null) {
        warnDaysBefore = snap.data().warnDaysBefore;
      }
    } catch (e) { /* use default */ }

    startListener();
  }

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
      });
  }

  function renderCard(item) {
    const s     = item.displayStatus;
    const label = statusLabel(item);
    const loc   = item.location  ? `<span class="meta-item">&#128205; ${esc(item.location)}</span>`    : '';
    const who   = item.addedByName ? `<span class="meta-item">&#128100; ${esc(item.addedByName)}</span>` : '';

    return `
      <div class="item-card item-card--${s}" data-id="${esc(item.id)}">
        <div class="card-top">
          <span class="card-name">${esc(item.productName)}</span>
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

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { init };
})();
