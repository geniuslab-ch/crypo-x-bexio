const MESSAGES: Record<string, string> = {
  invalid_credentials: 'E-mail ou mot de passe incorrect.',
  too_many_attempts: 'Trop de tentatives. Réessayez dans 15 minutes.',
  password_mismatch: 'Les deux mots de passe ne correspondent pas.',
  email_taken: 'Un compte existe déjà avec cet e-mail.',
  invalid_input: 'Certaines informations sont invalides (mot de passe : 10 caractères minimum).',
  database_unavailable: 'La base de données est inaccessible (configuration DATABASE_URL à vérifier).',
  server_not_configured: 'Le serveur n’est pas encore configuré (variables d’environnement manquantes).',
  unexpected_error: 'Erreur inattendue côté serveur. Réessayez ; si cela persiste, contactez le support.',
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
  connection_saved_verified: 'Connexion enregistrée. Droits vérifiés : lecture seule.',
  addresses_saved: 'Adresses enregistrées. Cliquez sur « Synchroniser » pour lire l’historique.',
  connection_saved: 'Connexion enregistrée. Cliquez sur « Synchroniser » pour lire l’historique.',
  connection_removed: 'Connexion supprimée. Les transactions déjà importées sont conservées.',
  sync_partial: 'Synchronisation en cours : historique long, cliquez à nouveau sur « Synchroniser » pour continuer.',
  credentials_missing: 'Renseignez tous les champs obligatoires.',
  credentials_rejected: 'La plateforme a refusé la clé (clé, secret ou droits incorrects).',
  credentials_invalid_format: 'Format de clé invalide (Coinbase : clé privée EC « -----BEGIN EC PRIVATE KEY----- », pas Ed25519).',
  api_key_not_read_only: 'Clé refusée : elle permet le trading, les transferts ou les retraits. Créez une clé en lecture seule.',
  api_key_cannot_read: 'Clé refusée : elle n’a pas le droit de lecture.',
  invalid_address: 'Adresse invalide. Vérifiez qu’il s’agit bien d’une adresse publique du bon réseau.',
  too_many_addresses: 'Trop d’adresses pour une seule source : créez plusieurs sources.',
  etherscan_not_configured: 'Lecture Ethereum non configurée sur le serveur (variable ETHERSCAN_API_KEY).',
  rate_limited: 'La plateforme limite le nombre de requêtes : réessayez dans une minute.',
  provider_unreachable: 'Plateforme injoignable pour le moment : réessayez plus tard.',
  provider_error: 'La plateforme a renvoyé une erreur : réessayez plus tard.',
  no_api_for_provider: 'Pas de connexion automatique pour cette plateforme : utilisez l’import CSV.',
  source_not_connected: 'Connectez d’abord la source.',
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

/** Turns a stored message code (or `code|label:n` list) into French text. */
export function flashText(text: string): string {
  return text.split('|').map((part) => {
    const [k, v] = part.split(':');
    if (v !== undefined && k && LABELS[k]) return `${v} ${LABELS[k]}`;
    return MESSAGES[part] ?? part;
  }).join(' · ');
}

export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return <div className={`alert ${error ? 'alert-bad' : 'alert-ok'}`} role="status" style={{ marginBottom: 16 }}>{flashText(error ?? ok ?? '')}</div>;
}
