/**
 * Catalogue des offres. Une seule source de vérité : prix, plafond de pages,
 * modèle de rédaction, et droit au re-audit de contrôle.
 *
 * audit_49 / audit_149 restent acceptés : des commandes existent en base et le
 * webhook Polar peut encore les recevoir. Ils ne sont plus proposés à la vente.
 */
export const OFFERS = {
  audit_29: {
    code: 'audit_29', label: 'Audit SEO', price: 29, pages: 25,
    premium: false, reaudit: false, model: 'flash', planWeeks: 4,
  },
  audit_59: {
    code: 'audit_59', label: 'Audit complet', price: 59, pages: 100,
    premium: true, reaudit: true, model: 'pro', planWeeks: 12,
  },
  // Anciennes offres, conservées pour les commandes et les rapports déjà émis.
  audit_49: {
    code: 'audit_49', label: 'Audit SEO', price: 49, pages: 25,
    premium: false, reaudit: false, model: 'flash', planWeeks: 4,
  },
  audit_149: {
    code: 'audit_149', label: 'Audit complet', price: 149, pages: 100,
    premium: true, reaudit: false, model: 'pro', planWeeks: 12,
  },
};

export const SALE_OFFERS = ['audit_29', 'audit_59'];

export function offerInfo(code) {
  return OFFERS[code] || OFFERS.audit_29;
}

export const isPremium = (code) => !!offerInfo(code).premium;
export const hasReaudit = (code) => !!offerInfo(code).reaudit;
export const maxPagesFor = (code) => offerInfo(code).pages;
export const planWeeksFor = (code) => offerInfo(code).planWeeks;
export const offerLabel = (code) => `${offerInfo(code).label} (${offerInfo(code).price} € TTC)`;
