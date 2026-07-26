/**
 * French language pack.
 */

export const STOPWORDS: readonly string[] = [
  // articles / pronoms / déterminants
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'au', 'aux',
  'ce', 'cette', 'ces', 'je', 'tu', 'il', 'elle', 'nous', 'vous', 'ils', 'elles',
  'mon', 'ton', 'son', 'ma', 'ta', 'sa', 'mes', 'tes', 'ses', 'notre', 'votre', 'leur', 'leurs',
  // conjonctions / prépositions
  'et', 'ou', 'mais', 'donc', 'car', 'ni', 'que', 'qui', 'quoi', 'dont',
  'dans', 'sur', 'sous', 'avec', 'sans', 'pour', 'par', 'vers', 'chez', 'entre', 'parmi',
  // adverbes / sentence starters
  'très', 'bien', 'mal', 'mieux', 'plus', 'moins', 'trop', 'assez', 'aussi',
  'maintenant', 'alors', 'ensuite', 'puis', 'après', 'avant', 'enfin', 'déjà',
  'encore', 'toujours', 'jamais', 'souvent', 'parfois', 'peut-être', 'presque',
  'tout', 'toute', 'tous', 'toutes', 'chaque', 'autre', 'autres', 'même', 'mêmes',
  'ici', 'là', 'où', 'quand', 'comment', 'pourquoi', 'combien',
  'voici', 'voilà', 'enfin', 'cependant', 'pourtant', 'néanmoins', 'ainsi',
  'oui', 'non', 'ok', 'merci', 'bonjour', 'salut',
  'parfait', 'exact', 'juste', 'correct', 'faux', 'vrai',
  'excellent', 'super', 'génial', 'intéressant', 'remarquable',
  // verbes courants
  'est', 'sont', 'était', 'étaient', 'être', 'été', 'sera', 'serait',
  'a', 'ont', 'avait', 'avoir', 'eu', 'aura',
  'fait', 'font', 'faire', 'faites', 'faisant',
  'peut', 'peuvent', 'pouvoir', 'pourrait', 'devrait', 'doit', 'doivent', 'devoir',
  'veut', 'veulent', 'vouloir', 'voudrait', 'voudrais',
  'voit', 'voir', 'vu', 'regarde', 'regarder',
  'essaie', 'essayer', 'essayé', 'utilise', 'utiliser', 'utilisé',
  'commence', 'commencer', 'commencé', 'termine', 'terminé', 'fini',
  'vérifie', 'vérifier', 'contrôle', 'contrôler',
  'faut', 'falloir', 'nécessaire', 'besoin',
  'semble', 'semblent', 'paraît', 'fonctionne', 'fonctionnent',
  // nombres / divers
  'un', 'deux', 'trois', 'premier', 'première', 'deuxième', 'troisième', 'dernier', 'dernière',
  'nombre', 'partie', 'parties', 'façon', 'manière', 'chose', 'choses',
  'quelque', 'quelques', 'rien', 'personne', 'quelqu', 'chacun', 'chacune',
  'exemple', 'exemples', 'cas', 'type', 'types', 'genre', 'genres',
  'vs', 'etc', 'càd',
];

export const COMMON_WORDS: readonly string[] = [
  'temps', 'jour', 'jours', 'semaine', 'semaines', 'mois', 'année', 'années',
  'matin', 'soir', 'nuit', 'heure', 'heures', 'minute', 'moment', 'moments',
  'personne', 'personnes', 'homme', 'femme', 'gens', 'utilisateur', 'utilisateurs', 'client', 'clients',
  'monde', 'vie', 'main', 'mains', 'œil', 'yeux', 'tête', 'visage',
  'endroit', 'endroits', 'lieu', 'lieux', 'place', 'places', 'maison', 'côté', 'fin', 'début',
  'point', 'points', 'ligne', 'lignes', 'zone', 'zones', 'niveau', 'niveaux',
  'problème', 'problèmes', 'question', 'questions', 'raison', 'raisons', 'motif', 'motifs',
  'réponse', 'réponses', 'idée', 'idées',
  'nom', 'noms', 'mot', 'mots', 'texte', 'textes', 'document', 'documents',
  'donnée', 'données', 'information', 'informations', 'valeur', 'valeurs', 'résultat', 'résultats',
  'état', 'états', 'situation', 'situations', 'forme', 'formes',
  'étape', 'étapes', 'phase', 'phases', 'processus', 'procédure', 'procédures',
  'système', 'systèmes', 'modèle', 'modèles', 'mode', 'modes', 'version', 'versions',
  'travail', 'travaux', 'tâche', 'tâches', 'projet', 'projets', 'activité', 'activités',
  'changement', 'changements', 'modification', 'modifications',
  'erreur', 'erreurs', 'avertissement', 'avertissements', 'message', 'messages',
  'liste', 'listes', 'élément', 'éléments', 'entrée', 'entrées',
  'option', 'options', 'paramètre', 'paramètres', 'configuration',
  'test', 'tests', 'essai', 'essais', 'vérification', 'contrôle', 'contrôles',
  'code', 'codes', 'source', 'sources', 'contenu', 'contenus', 'contexte', 'contextes',
  'mémoire', 'mémoires', 'recherche', 'recherches', 'demande', 'demandes', 'requête', 'requêtes',
  'fait', 'faits', 'cours', 'sens', 'reste', 'dessus', 'dessous', 'dedans', 'dehors',
  'gauche', 'droite', 'centre', 'milieu', 'moitié', 'entier', 'entière', 'total', 'plein', 'vide',
  'ouvert', 'fermé', 'public', 'privé', 'local', 'distant',
  'défaut', 'actuel', 'actuelle', 'précédent', 'précédente', 'prochain', 'prochaine', 'récent', 'récente',
  'suivant', 'suivante', 'suivants', 'suivantes', 'cidessus', 'ci-dessus',
];
