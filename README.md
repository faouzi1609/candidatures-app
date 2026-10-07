# Candidatures — l'appli

Interface mobile pour suivre et valider les candidatures préparées par l'agent
(dépôt privé de l'agent). Installable sur l'écran d'accueil du téléphone.

Ce dépôt ne contient **que le code de l'appli** : aucune offre, aucun CV, aucune donnée personnelle.
Les données sont lues à l'ouverture depuis le dépôt privé, avec un jeton GitHub personnel
stocké uniquement sur votre appareil.

- **Aujourd'hui** : chiffres du jour, offres à valider, bouton « Chercher maintenant ».
- **Fiche** : score, points forts / faibles, lettre modifiable, Envoyer / Écarter.
- **Suivi** : toutes les candidatures par étape (à postuler, envoyée, entretien…).

Fonctionnement : chaque bouton poste une commande (`/valider`, `/ecarter`, `/entretien`…)
en commentaire de la fiche de l'offre ; l'agent l'exécute via GitHub Actions.
