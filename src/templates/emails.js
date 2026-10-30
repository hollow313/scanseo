export function renderBriefEmail({ token, auditUrl, siteUrl }) {
  const subject = 'Votre audit SEO démarre — 3 questions pour le personnaliser';
  
  const text = `Bonjour,

Votre commande pour l'audit SEO de votre site ${siteUrl} a bien été validée.

Pour nous permettre de générer des recommandations et des balises parfaitement adaptées à votre activité et à votre zone géographique, merci de répondre aux 3 questions du brief sur votre espace dédié :

${auditUrl}

Dès validation de vos réponses, votre analyse démarre immédiatement et votre rapport complet vous est livré sous 15 minutes.

À très bientôt,
L'équipe ScanSEO
${siteUrl}`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; line-height: 1.6;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 32px;">
    <h1 style="color: #0284c7; font-size: 22px; margin-top: 0;">Votre audit SEO démarre</h1>
    <p>Bonjour,</p>
    <p>Votre commande pour l'audit SEO du site <strong>${escapeHtml(siteUrl)}</strong> a bien été enregistrée.</p>
    <p>Afin de vous fournir un diagnostic précis avec des textes prêts à coller qui tiennent compte de votre secteur et de votre ville, merci de répondre aux 3 questions de personnalisation :</p>
    
    <div style="margin: 28px 0; text-align: center;">
      <a href="${escapeHtml(auditUrl)}" style="background-color: #0284c7; color: #ffffff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">Accéder à mon brief (3 questions)</a>
    </div>

    <p style="font-size: 14px; color: #64748b;">Dès vos réponses renseignées, le crawl démarre et votre rapport PDF vous sera expédié sous 15 minutes.</p>
    <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;">
    <p style="font-size: 12px; color: #94a3b8; margin-bottom: 0;">ScanSEO — Loïc Huon EI, Toulouse. TVA non applicable art. 293 B du CGI. Répondez directement à cet email pour toute question.</p>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

export function renderNeedsSiteEmail({ contactEmail, orderId }) {
  const subject = 'ScanSEO — Précisez l\'adresse de votre site pour démarrer votre audit';
  
  const text = `Bonjour,

Votre paiement a bien été reçu (référence commande : ${orderId}).

Cependant, l'adresse de votre site web n'a pas été renseignée lors du paiement.
Merci de répondre simplement à cet email en indiquant l'URL exacte du site à analyser (ex: https://mon-site.fr).

Notre équipe lancera immédiatement votre audit dès réception de votre réponse.

Cordialement,
L'équipe ScanSEO`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; line-height: 1.6;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 32px;">
    <h1 style="color: #0284c7; font-size: 22px; margin-top: 0;">Précision nécessaire pour votre audit</h1>
    <p>Bonjour,</p>
    <p>Votre paiement a bien été validé (réf : <code>${escapeHtml(orderId)}</code>).</p>
    <p>L'adresse de votre site web n'a toutefois pas été transmise lors du checkout Polar.</p>
    <p><strong>Merci de répondre directement à cet email</strong> en nous indiquant l'adresse web de votre site (ex: <code>https://votre-site.fr</code>).</p>
    <p>Votre audit démarrera dès réception de votre retour.</p>
    <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;">
    <p style="font-size: 12px; color: #94a3b8; margin-bottom: 0;">ScanSEO — Support client : ${escapeHtml(contactEmail)}</p>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

export function renderAdminAlertEmail({ title, details }) {
  const subject = `[ScanSEO ALERTE ADMIN] ${title}`;
  const text = `ALERTE SCANSEO ADMIN\n\nMotif : ${title}\nDate : ${new Date().toISOString()}\n\nDétails techniques :\n${typeof details === 'object' ? JSON.stringify(details, null, 2) : details}`;

  const html = `<!DOCTYPE html>
<html>
<body style="font-family: monospace; padding: 20px; background: #1e1e1e; color: #f1f1f1;">
  <h2 style="color: #ef4444;">ALERTE SCANSEO ADMIN</h2>
  <p><strong>Motif :</strong> ${escapeHtml(title)}</p>
  <p><strong>Horodatage :</strong> ${new Date().toISOString()}</p>
  <pre style="background: #2d2d2d; padding: 15px; border-radius: 4px; overflow-x: auto;">${escapeHtml(typeof details === 'object' ? JSON.stringify(details, null, 2) : details)}</pre>
</body>
</html>`;

  return { subject, text, html };
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Rappel envoyé 10 jours avant la fin du délai de re-audit inclus (90 jours).
 * Le lien mène à l'espace client, où le bouton lance le re-audit sans paiement.
 */
export function renderReauditReminderEmail({ token, auditUrl, siteUrl, daysLeft, score }) {
  const subject = `Votre re-audit gratuit expire dans ${daysLeft} jours`;
  const text = `Bonjour,

Votre audit SEO de ${siteUrl} a été livré il y a ${90 - daysLeft} jours${score != null ? ` (score ${score}/100)` : ''}.

Votre offre comprend un re-audit de contrôle gratuit, valable 90 jours. Il vous reste ${daysLeft} jours pour en profiter.

Pour le lancer, ouvrez votre espace et cliquez sur « Lancer mon re-audit gratuit » :
${auditUrl}

Le re-audit relance la même analyse sur le site tel qu'il est aujourd'hui : vous voyez immédiatement les points corrigés et ceux qui restent.

Aucun paiement, aucune démarche : c'est inclus dans votre commande.

À bientôt,
L'équipe ScanSEO`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;color:#0e1116;margin:0;padding:24px;line-height:1.6">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e6e8ee;border-radius:12px;padding:32px">
    <h1 style="color:#3b5bfd;font-size:22px;margin-top:0">Votre re-audit gratuit expire dans ${escapeHtml(String(daysLeft))} jours</h1>
    <p>Bonjour,</p>
    <p>Votre audit de <strong>${escapeHtml(siteUrl)}</strong> a été livré il y a ${escapeHtml(String(90 - daysLeft))} jours${score != null ? `, avec un score de <strong>${escapeHtml(String(score))}/100</strong>` : ''}.</p>
    <p>Votre offre <strong>Audit complet</strong> inclut un <strong>re-audit de contrôle gratuit</strong>, valable 90 jours.
    Il vous reste <strong>${escapeHtml(String(daysLeft))} jours</strong> pour l'utiliser.</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(auditUrl)}" style="background:#3b5bfd;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">Lancer mon re-audit gratuit</a>
    </p>
    <p>Le re-audit relance exactement la même analyse sur le site tel qu'il est aujourd'hui : vous voyez ce qui a été corrigé, et ce qui reste.</p>
    <p style="color:#6b7280;font-size:13px">Aucun paiement, aucune démarche : c'est inclus dans votre commande.</p>
    <p>À bientôt,<br>L'équipe ScanSEO</p>
  </div>
</body>
</html>`;

  return { subject, text, html };
}
