# GroupPulse

**Retrouver l'information dans les conversations et vérifier sa source.**

[中文](../../README.md) · [English](README.en.md) · Français

GroupPulse est une application de bureau indépendante pour les données WeChat 4.x conservées sur votre ordinateur. Recherchez dans les conversations, les Moments et les contacts, suivez vos mots-clés et examinez offres, demandes et prix publiés. Chaque résultat permet de retrouver l'expéditeur, le message original et son contexte.

![Vue générale](../screenshots/overview-en.png)

## Fonctionnalités

- Boutons de recherche, validation par Entrée, surlignage et aperçu des phrases pertinentes des longs messages.
- Activité par groupe, répartition par jour et heure, fréquence des mots et expressions personnalisées.
- Classement des offres et demandes sur 1/3/6/24 heures ; regroupement des doublons par expéditeur et texte, sans perdre les sources. Les rapprochements sont des pistes, pas des transactions confirmées.
- Distinction entre remises, prix CNY/USD, multiplicateurs explicites, noms de forfait et montants par période.
- Images et avatars locaux, audio SILK, MP4 et première image WXGF. Aucune garantie de récupération des contenus absents ou supprimés.
- Analyse IA facultative avec votre propre API : vérifier la destination et les extraits avant confirmation. Le fournisseur peut facturer les requêtes.
- Export complet des résultats filtrés en CSV/JSON, rapport annuel HTML et favoris.

## Installation et limites

Les [versions](https://github.com/cyf1124906008-ai/GroupPulse/releases/latest) ciblent macOS Apple Silicon et Windows x64. Décompressez tout puis ouvrez GroupPulse.app ou GroupPulse/GroupPulse.exe. Sélectionnez le dossier local d'un compte ou une copie complète en clair. Les données chiffrées nécessitent une clé locale valide.

Les bases d'origine sont en lecture seule. Une copie statique ne récupère pas l'historique du serveur. L'interface prend en charge le **chinois simplifié et l'anglais** ; cette page est une présentation française. Les captures utilisent des données fictives.

Le code est disponible sous [PolyForm Noncommercial 1.0.0](../../LICENSE), pour les usages, modifications et partages non commerciaux autorisés. L'utilisation commerciale exige une autorisation appropriée distincte. Cette restriction ne correspond pas à une licence open source OSI. Les composants conservent leurs licences propres, indiquées dans [NOTICE](../../NOTICE.md).
