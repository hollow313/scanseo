/**
 * Formatage des dates en heure française. Les dates sont stockées en UTC (ISO) ;
 * les afficher telles quelles décalait tout d'une heure en hiver et de deux en été,
 * et un audit lancé à 18 h 30 apparaissait la veille.
 */
const TZ = 'Europe/Paris';

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value).endsWith('Z') || String(value).includes('+') ? value : `${value}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** « 30/10/2026 17:12 » — heure de Paris. */
export function frDateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleString('fr-FR', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** « 30/10 17:12 » — version compacte pour les tableaux. */
export function frShort(value) {
  const d = toDate(value);
  if (!d) return '—';
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.day}/${parts.month} ${parts.hour}:${parts.minute}`;
}

/** « 30 octobre 2026 » — date seule, pour le blog. */
export function frDate(value) {
  const d = toDate(value);
  if (!d) return '';
  return d.toLocaleDateString('fr-FR', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' });
}
