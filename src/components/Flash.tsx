import { FLASH_LABELS, FLASH_MESSAGES, FLASH_PLATFORM } from '@/i18n/flash';

const MESSAGES: Record<string, string> = {
  reset_link_sent: 'Si un compte existe avec cet e-mail, un lien vient de lui être envoyé. Pensez à vérifier les indésirables.',
  reset_link_invalid: 'Ce lien n’est plus valable : il a déjà servi ou il a expiré. Demandez-en un nouveau.',
  password_reset_done: 'Mot de passe modifié. Connectez-vous avec le nouveau mot de passe.',
  mail_not_configured: 'L’envoi d’e-mails n’est pas encore configuré sur ce serveur. Contactez le support.',
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
  wallet_accounts_locked_by_validated_entries: 'Des écritures sont déjà validées : un wallet ne peut plus recevoir ou perdre son propre compte. Seul le numéro de compte peut encore changer.',
  policy_locked_by_validated_entries: 'La méthode ne peut plus être modifiée : des écritures sont déjà validées.',
  policy_locked_by_closed_year: 'La méthode ne peut plus être modifiée : un exercice est clôturé avec la méthode actuelle.',
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
  private_key_refused: 'Clé privée refusée : donnez uniquement la clé publique (xpub, ypub, zpub) ou des adresses. Ne partagez jamais une clé privée ni une phrase de récupération.',
  etherscan_not_configured: 'Lecture Ethereum non configurée sur le serveur (variable ETHERSCAN_API_KEY).',
  rate_limited: 'La plateforme limite le nombre de requêtes : réessayez dans une minute.',
  provider_unreachable: 'Plateforme injoignable pour le moment : réessayez plus tard.',
  provider_error: 'La plateforme a renvoyé une erreur : réessayez plus tard.',
  no_api_for_provider: 'Pas de connexion automatique pour cette plateforme : utilisez l’import CSV.',
  source_not_connected: 'Connectez d’abord la source.',
  source_created: 'Source ajoutée.',
  client_created: 'Dossier client créé.',
  classification_not_for_legal_form: 'Cette classification n’existe que pour les fondations (dotation à la fortune de la fondation).',
  endowments_require_foundation: 'Ce dossier contient des dotations : reclassez d’abord les transactions classées manuellement en « Dotation » avant de quitter la forme « Fondation ».',
  disconnected: 'bexio déconnecté.',
  run_complete: 'Calcul terminé.',
  run_blocked: 'Calcul bloqué : voir les points à résoudre.',
  period_closed: 'Exercice clôturé : cette opération n’est plus possible. Rouvrez l’exercice si la correction est voulue.',
  closing_entry_managed_by_closing: 'Les écritures de clôture se retirent en rouvrant l’exercice (page « Clôture »).',
  opening_balance_managed_on_closing_page: 'Les soldes d’ouverture se gèrent sur la page « Clôture ».',
  only_last_closed_year_can_be_reopened: 'Seul le dernier exercice clôturé peut être rouvert.',
  closing_entries_already_in_bexio: 'Les écritures de clôture sont déjà dans bexio : supprimez-les d’abord dans bexio, puis contactez le support pour rouvrir.',
  opening_balances_other_year: 'Des soldes d’ouverture existent déjà pour une autre date : supprimez-les d’abord.',
  invalid_year: 'Exercice invalide.',
  closing_blocked: 'Clôture impossible : voir les points à résoudre dans l’aperçu.',
  year_closed: 'Exercice clôturé.',
  year_reopened: 'Exercice rouvert : les écritures de clôture ont été retirées.',
  opening_deleted: 'Solde d’ouverture supprimé.',
  map_account_before_vat: 'Choisissez d’abord le compte bexio, puis son code TVA.',
  bexio_tax_not_found: 'Code TVA introuvable : rechargez les données bexio.',
  platform_requested: 'Demande enregistrée. Nous vous prévenons dès que la plateforme est disponible.',
  invalid_date: 'Date invalide (AAAA-MM-JJ).',
  invalid_asset: 'Actif invalide.',
  invalid_quantity: 'Solde invalide (0 ou plus).',
};

const LABELS: Record<string, string> = {
  imported: 'importées', duplicates: 'doublons', issues: 'lignes rejetées / problèmes', created: 'écritures créées', unchanged: 'inchangées',
  validated: 'validées', unvalidated: 'repassées en brouillon', synced: 'envoyées à bexio', failed: 'échecs', recovered: 'retrouvées dans bexio',
  accounts: 'comptes chargés', years: 'exercices', rates_inserted: 'cours ajoutés', tax_values_inserted: 'valeurs fiscales ajoutées', replaced: 'remplacés', skipped: 'ignorés (déjà présents)',
  errors: 'erreurs', confirmed: 'confirmées', closing_entries: 'écritures de clôture créées (validées)', opening_added: 'soldes d’ouverture ajoutés', balances_saved: 'soldes enregistrés',
};

/** Turns a stored message code (or `code|label:n` list) into text in the interface language (French by default). */
export function flashText(text: string, locale = 'fr'): string {
  const messages = FLASH_MESSAGES[locale] ?? {};
  const labels = FLASH_LABELS[locale] ?? {};
  return text.split('|').map((part) => {
    if (part.startsWith('platform=')) {
      const p = FLASH_PLATFORM[locale];
      return p ? p.replace('{x}', part.slice(9)) : `Réponse de la plateforme : « ${part.slice(9)} »`;
    }
    const [k, v] = part.split(':');
    if (v !== undefined && k && LABELS[k]) return `${v} ${labels[k] ?? LABELS[k]}`;
    return messages[part] ?? MESSAGES[part] ?? part;
  }).join(' · ');
}

export function Flash({ ok, error, locale }: { ok?: string; error?: string; locale?: string }) {
  if (!ok && !error) return null;
  return <div className={`alert ${error ? 'alert-bad' : 'alert-ok'}`} role="status" style={{ marginBottom: 16 }}>{flashText(error ?? ok ?? '', locale)}</div>;
}
