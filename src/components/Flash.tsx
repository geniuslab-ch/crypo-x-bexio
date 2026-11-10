const MESSAGES: Record<string, string> = {
  invalid_credentials: 'E-mail ou mot de passe incorrect.',
  too_many_attempts: 'Trop de tentatives. Réessayez dans 15 minutes.',
  email_taken: 'Un compte existe déjà avec cet e-mail.',
  invalid_input: 'Certaines informations sont invalides (mot de passe : 10 caractères minimum).',
  file_already_imported: 'Ce fichier a déjà été importé pour cette source.',
  format_not_recognised: 'Format non reconnu. Utilisez le modèle CSV Crypto2Books ou choisissez le bon format.',
  parser_does_not_match_source: 'Ce format ne correspond pas à la plateforme de la source choisie.',
  no_file: 'Choisissez un fichier.',
  file_too_large: 'Fichier trop volumineux (10 Mo maximum).',
  transaction_locked_by_validated_entry: 'Transaction verrouillée : elle appartient à une écriture validée.',
  policy_locked_by_validated_entries: 'La méthode ne peut plus être modifiée : des écritures sont déjà validées.',
  bexio_not_configured: 'Connexion bexio non configurée sur ce serveur (BEXIO_CLIENT_ID, BEXIO_CLIENT_SECRET, APP_URL).',
  bexio_not_connected: 'Connectez d’abord votre compte bexio.',
  bexio_data_not_loaded: 'Chargez d’abord le plan comptable bexio.',
  bexio_has_no_chf_currency: 'Aucune devise CHF trouvée dans bexio.',
  bexio_session_expired_reconnect: 'La session bexio a expiré : reconnectez bexio.',
  accounting_scope_not_granted: 'L’autorisation « accounting » n’a pas été accordée dans bexio.',
  invalid_oauth_state: 'La connexion bexio a expiré ou n’est pas valide. Recommencez.',
  only_fiduciary_or_accountant: 'Seul un·e fiduciaire ou comptable peut valider la politique.',
  saved: 'Enregistré.',
  source_created: 'Source ajoutée.',
  client_created: 'Dossier client créé.',
  disconnected: 'bexio déconnecté.',
  run_complete: 'Calcul terminé.',
  run_blocked: 'Calcul bloqué : voir les points à résoudre.',
};

const LABELS: Record<string, string> = {
  imported: 'importées', duplicates: 'doublons', issues: 'lignes rejetées / problèmes', created: 'écritures créées', unchanged: 'inchangées',
  validated: 'validées', unvalidated: 'repassées en brouillon', synced: 'envoyées à bexio', failed: 'échecs', recovered: 'retrouvées dans bexio',
  accounts: 'comptes chargés', years: 'exercices', rates_inserted: 'cours ajoutés', replaced: 'remplacés', skipped: 'ignorés (déjà présents)',
  errors: 'erreurs', confirmed: 'confirmées',
};

function render(text: string): string {
  return text.split('|').map((part) => {
    const [k, v] = part.split(':');
    if (v !== undefined && k && LABELS[k]) return `${v} ${LABELS[k]}`;
    return MESSAGES[part] ?? part;
  }).join(' · ');
}

export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return <div className={`alert ${error ? 'alert-bad' : 'alert-ok'}`} role="status" style={{ marginBottom: 16 }}>{render(error ?? ok ?? '')}</div>;
}
