// Wattzhub CPO App User Guide - Split by sections for efficient retrieval
// Each section is small enough for the voice API to handle

export const APP_GUIDE_SECTIONS = {
  
  general: `L'application Wattzhub CPO est disponible sur Google Play Store (Android) et Apple App Store (iOS). Elle permet de trouver des bornes de recharge, démarrer des sessions, gérer son portefeuille et ses badges RFID. Pour l'utiliser, il faut créer un compte, avoir un badge RFID actif et un moyen de paiement ou du crédit dans le portefeuille.`,

  download: `Pour télécharger l'application Wattzhub CPO:
- Android: Allez sur Google Play Store et recherchez "Wattzhub CPO"
- iOS/iPhone: Allez sur l'Apple App Store et recherchez "Wattzhub CPO"
Installez l'application puis ouvrez-la pour créer votre compte.`,

  account: `Pour créer un compte Wattzhub CPO:
1. Ouvrez l'application et appuyez sur "Créer un compte" ou "S'inscrire"
2. Remplissez: Prénom, Nom, Email, Mot de passe
3. Acceptez les conditions d'utilisation
4. Complétez le captcha si demandé
5. Appuyez sur "S'inscrire"
6. Vérifiez votre email si nécessaire
Votre compte sera prêt à utiliser après ces étapes.`,

  login: `Pour vous connecter à l'application:
1. Ouvrez l'application
2. Entrez votre adresse email
3. Entrez votre mot de passe
4. Appuyez sur "Connexion"
L'application se souviendra de vos identifiants pour les prochaines fois.
Vous pouvez aussi utiliser la connexion par OTP (code SMS) en sélectionnant "Connexion par OTP" et en entrant votre numéro de téléphone.`,

  otp: `La connexion par OTP (One-Time Password):
1. Sur l'écran de connexion, sélectionnez "Connexion par OTP"
2. Entrez votre numéro de téléphone enregistré
3. Vous recevrez un SMS avec un code de vérification
4. Entrez le code dans l'application
5. Vous serez connecté automatiquement
C'est une méthode sécurisée si vous avez oublié votre mot de passe.`,

  password: `Si vous avez oublié votre mot de passe:
1. Sur l'écran de connexion, appuyez sur "Mot de passe oublié"
2. Entrez votre adresse email enregistrée
3. Vous recevrez un email avec un lien de réinitialisation
4. Suivez les instructions pour créer un nouveau mot de passe
5. Retournez dans l'application et connectez-vous avec le nouveau mot de passe`,

  navigation: `L'application a un menu latéral accessible en appuyant sur l'icône ☰ en haut à gauche. Ce menu contient:
- Stations de recharge: pour trouver les bornes
- Transactions en cours: vos sessions actives
- Historique: vos sessions passées
- Mes Badges: gérer vos cartes RFID
- Mes Véhicules: ajouter vos voitures
- Portefeuille: voir le solde et ajouter du crédit
- Factures: consulter vos factures
- Paramètres: langue, thème, profil
- Support: obtenir de l'aide`,

  find_stations: `Pour trouver une borne de recharge:
1. Allez dans "Stations de recharge" depuis le menu
2. La carte affiche les bornes avec des marqueurs:
   - Vert: disponible
   - Rouge/Orange: occupée ou indisponible
3. Appuyez sur un marqueur pour voir les détails
4. Vous pouvez aussi basculer en vue liste
5. Utilisez les filtres pour affiner: type de connecteur, statut, puissance`,

  start_charging: `Pour démarrer une recharge via l'application:
Prérequis: compte actif, badge RFID actif, moyen de paiement ou crédit dans le portefeuille, véhicule branché.
Étapes:
1. Trouvez la station dans "Stations de recharge"
2. Sélectionnez un connecteur "Disponible" (vert)
3. Branchez votre véhicule à la borne
4. Appuyez sur le bouton "Démarrer" (vert)
5. Sélectionnez votre badge si demandé
6. Attendez que la session démarre
Pour arrêter: appuyez sur "Arrêter" (rouge) et confirmez.`,

  qr_code: `Pour démarrer avec un QR code:
1. Appuyez sur l'icône QR code dans l'application (généralement en haut)
2. Pointez la caméra vers le QR code sur la borne
3. L'application détecte automatiquement la station et le connecteur
4. Suivez les mêmes étapes pour démarrer la recharge
Note: Si le QR code appartient à une autre organisation, vous devrez peut-être changer de compte.`,

  stop_charging: `Pour arrêter une session de recharge:
1. Allez dans "Transactions en cours" depuis le menu
2. Trouvez votre session active
3. Appuyez sur le bouton "Arrêter" (rouge)
4. Confirmez l'arrêt
5. Attendez que la session se termine
6. Débranchez votre véhicule
Si le bouton ne fonctionne pas, essayez de rafraîchir l'application ou contactez le support.`,

  wallet: `Gestion du portefeuille:
- Pour voir le solde: Menu → Portefeuille
- Pour ajouter du crédit:
  1. Ouvrez le Portefeuille
  2. Appuyez sur "+" ou "Ajouter du crédit"
  3. Entrez le montant
  4. Sélectionnez votre moyen de paiement
  5. Complétez le paiement
  6. Le solde sera mis à jour
Vous pouvez voir l'historique des transactions (crédits ajoutés et consommés) en faisant défiler l'écran du portefeuille.`,

  payment: `Gestion des moyens de paiement:
- Pour ajouter une carte: Paramètres → Moyens de paiement → "+"
- Suivez les instructions pour entrer les détails de la carte
- Pour définir une carte par défaut: appuyez dessus
- Pour supprimer: faites glisser vers la gauche
Vous pouvez avoir plusieurs moyens de paiement enregistrés.`,

  badges: `Les badges (cartes RFID) servent à s'authentifier aux bornes:
- Pour voir vos badges: Menu → Mes Badges
- Chaque badge affiche: ID, statut (Actif/Inactif), date de création
- Lors du démarrage d'une session, vous sélectionnerez quel badge utiliser
- Important: Le badge doit être "Actif" pour fonctionner
- Si votre badge est inactif, contactez le support pour l'activer`,

  vehicles: `Gestion des véhicules:
- Pour ajouter une voiture: Menu → Mes Véhicules → "+"
- Remplissez: Marque, Modèle, Année, Plaque (optionnel), Capacité batterie (optionnel)
- Sauvegardez
- Pour modifier: appuyez sur le véhicule
- Pour supprimer: faites glisser vers la gauche
Astuce: Ajouter la capacité de batterie aide l'app à estimer les temps et coûts de recharge.`,

  troubleshooting: `Problèmes courants et solutions:

Bouton Démarrer désactivé:
- Vérifiez qu'un badge actif est enregistré
- Vérifiez le moyen de paiement ou le solde
- Le connecteur doit être "Disponible"
- Le véhicule doit être bien branché

Session ne s'arrête pas:
- Rafraîchissez l'app
- Attendez et réessayez
- Contactez le support

Carte/Map ne charge pas:
- Vérifiez la connexion internet
- Activez les permissions de localisation
- Redémarrez l'app

Paiement échoué:
- Vérifiez internet
- Vérifiez que la carte est valide
- Essayez un autre moyen de paiement

App plante:
- Mettez à jour l'app
- Redémarrez le téléphone
- Réinstallez l'app si nécessaire`,

  faq: `Questions fréquentes:

L'app est-elle gratuite? Oui, seule l'électricité consommée est payante.

Puis-je utiliser l'app sans compte? Non, un compte est obligatoire.

Comment changer mon mot de passe? Utilisez "Mot de passe oublié" sur l'écran de connexion.

Puis-je avoir plusieurs badges? Oui, vous sélectionnerez lequel utiliser à chaque session.

Durée max de session? 20 heures, certains sites peuvent avoir des limites supplémentaires.

Comment supprimer mon compte? Contactez le support, vous devez d'abord régler tout solde dû.`
};

// Keep backward compatibility
export const APP_GUIDE = Object.values(APP_GUIDE_SECTIONS).join('\n\n---\n\n');

export default APP_GUIDE_SECTIONS;
