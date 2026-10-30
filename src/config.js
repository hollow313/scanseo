import 'dotenv/config';

export const REQUIRED_VARS = [
  'PUBLIC_BASE_URL',
  'DEEPSEEK_API_KEY',
  'PAGESPEED_API_KEY',
  'POLAR_WEBHOOK_SECRET',
  'POLAR_PRODUCT_49',
  'POLAR_PRODUCT_149',
  'SMTP_URL',
  'SMTP_FROM',
  'CONTACT_EMAIL',
  'ADMIN_USER',
  'ADMIN_PASSWORD_HASH',
  'SIGNING_SECRET'
];

export function validateConfig() {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key] || process.env[key].trim() === '');
  if (missing.length > 0) {
    console.error(`FATAL: variables d'environnement requises manquantes : ${missing.join(', ')}`);
    process.exit(1);
  }
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://scanseo.fr',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekModelPaid: process.env.DEEPSEEK_MODEL_PAID || 'deepseek-v4-pro',
  deepseekModelFree: process.env.DEEPSEEK_MODEL_FREE || 'deepseek-flash',
  pagespeedApiKey: process.env.PAGESPEED_API_KEY || '',
  polarWebhookSecret: process.env.POLAR_WEBHOOK_SECRET || '',
  polarProduct49: process.env.POLAR_PRODUCT_49 || '',
  // liens de checkout Polar (publics). Surchargeables par env.
  polarCheckout49: process.env.POLAR_CHECKOUT_49 || 'https://buy.polar.sh/polar_cl_k4QjhXH3YH57cuhcG06VhC0mWL5lH1Rp4qqOI2hzLsw',
  polarCheckout149: process.env.POLAR_CHECKOUT_149 || 'https://buy.polar.sh/polar_cl_Xb8MfXTawFL0doZNQuWhzeT8b7JnHouzDXBzu4WDbkQ',
  polarProduct149: process.env.POLAR_PRODUCT_149 || '',
  smtpUrl: process.env.SMTP_URL || '',
  smtpFrom: process.env.SMTP_FROM || '',
  contactEmail: process.env.CONTACT_EMAIL || '',
  adminUser: process.env.ADMIN_USER || 'loic',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || '',
  signingSecret: process.env.SIGNING_SECRET || '',
  // clé d'API pour les scans de prospection (usage interne / réseau local).
  // Absente = route de prospection désactivée (503), jamais ouverte sans clé.
  scanApiKey: process.env.SCAN_API_KEY || '',
  maxPages49: parseInt(process.env.MAX_PAGES_49 || '25', 10),
  maxPages149: parseInt(process.env.MAX_PAGES_149 || '100', 10),
  tz: process.env.TZ || 'Europe/Paris',
  dataDir: process.env.DATA_DIR || '/data',
  reportsDir: process.env.REPORTS_DIR || '/reports',
  contentDir: process.env.CONTENT_DIR || '/content',
  chromiumPath: process.env.CHROMIUM_PATH || ''
};
