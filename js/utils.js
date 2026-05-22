function getTodayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function calcPullDate(expDateStr) {
  const d = new Date(expDateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function getStatus(item, today, warnDaysBefore) {
  const pull = new Date(item.pullDate);
  const exp  = new Date(item.expDate);
  const now  = new Date(today);

  if (now >= exp)  return 'expired';
  if (now >= pull) return 'pull';
  if ((pull - now) / 86400000 <= warnDaysBefore) return 'warn';
  return 'good';
}

function formatDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'
  });
}

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
