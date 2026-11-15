# DeepL pour Gladys Assistant

Connecteur non officiel, sans lien avec DeepL. Il ajoute l'action de scène
**« Traduire (DeepL) »** : un texte part chez DeepL, et la traduction est
donnée aux actions suivantes de la scène (l'envoyer par message, la lire sur
une enceinte, l'afficher…). Il utilise votre propre clé d'API DeepL, Free ou
Pro.

Jamais testé avec une vraie clé DeepL pour l'instant : dites-nous ce qu'il en
est.

## Ce qu'il faut

- Un compte **DeepL API** (pas l'abonnement DeepL Traducteur) : créez-le sur
  [deepl.com/pro-api](https://www.deepl.com/pro-api).
  - **DeepL API Free** : 500 000 caractères par mois sans frais. Sa clé finit
    par `:fx` et est envoyée à `api-free.deepl.com`.
  - **DeepL API Pro** : un abonnement mensuel de base, puis une facturation au
    caractère traduit (voir les prix sur deepl.com ; une limite de coût se
    règle dans votre compte DeepL). Sa clé est envoyée à `api.deepl.com`.
- La **clé d'authentification**, dans votre compte DeepL, onglet « Clés API ».

## Configuration

| Champ                                       | Rôle                                                                                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Clé d'authentification DeepL API            | Gardée par Gladys dans sa base, jamais réaffichée, envoyée seulement à DeepL. Le module choisit l'adresse Free ou Pro d'après la clé.                                                |
| Nombre maximal de caractères par traduction | De 1 à 5000 (1000 par défaut). Un texte plus long est refusé, jamais coupé. Espaces et ponctuation comptent, comme sur la facture DeepL ; un emoji compte pour un.                   |
| Nombre maximal de caractères sur 24 heures  | De 100 à 1000000 (10000 par défaut), sur 24 heures glissantes. Plafond de sécurité contre une scène qui s'emballe. 10 000 par jour restent sous 310 000 par mois, dans l'offre Free. |

Le bouton **« Vérifier la clé »** demande à DeepL s'il accepte la clé et
affiche les caractères consommés sur la période de facturation, et ceux que ce
module a comptés sur 24 heures. Il ne traduit rien et ne compte aucun
caractère.

## L'action de scène

Champs :

- **Texte à traduire** (obligatoire) : peut contenir des variables de scène,
  comme la sortie d'une action précédente.
- **Vers** : la langue cible (anglais américain par défaut).
- **Depuis** : la langue source ; vide, DeepL la détecte.
- **Formalité** : par défaut, plus formel, moins formel (pour les langues qui
  distinguent vouvoiement et tutoiement, comme l'allemand, le français ou
  l'espagnol ; ignoré sinon).

Sorties, pour les actions suivantes : `translation` (le texte, coupé à 10 000
caractères, le maximum que Gladys garde), `detected_language` (par exemple
`EN`), `characters` (les caractères comptés pour cette traduction) et
`truncated` (la traduction a été coupée).

Exemple : une action « Traduire (DeepL) » sur `{{triggerEvent.data.title}}`
vers le français, suivie d'une action « Envoyer un message » avec la sortie
traduction.

## Coûts et plafonds

- Une traduction est **comptée avant de partir**, et le décompte est d'abord
  enregistré dans `/data` : un redémarrage ne remet pas le plafond sur 24
  heures à zéro. Si `/data` ne peut pas être écrit, rien n'est envoyé.
- Une traduction que DeepL a pu compter (pas de réponse en 10 secondes, une
  connexion coupée, une erreur 5xx) n'est **jamais renvoyée**, et reste dans le
  plafond : un second essai pourrait être facturé deux fois. L'action de scène
  échoue alors avec « Envoyé à DeepL sans réponse ».
- Une traduction que DeepL n'a sûrement pas prise (une erreur 4xx, une erreur
  réseau avant le départ de la requête) est rendue au plafond.
- Quand DeepL annonce plus de caractères facturés que le module n'en a
  comptés, le plus grand nombre est gardé.
- Le quota DeepL du compte (erreur 456) met le module en pause 1 heure au
  moins ; un 429 « trop de requêtes » suit le délai demandé par DeepL (60 s à
  6 h) ; une panne DeepL (5xx) met en pause 60 s, doublées en cas de répétition,
  6 h au plus.
- Une requête à la fois ; 10 traductions au plus attendent leur tour.

## Quand l'action de scène échoue

La scène continue ; l'erreur est dans le journal de la scène. Causes
principales : texte vide, texte plus long que le maximum, plafond sur 24 heures
atteint, clé refusée par DeepL (403 : plus aucune scène ne l'utilise tant que
vous n'avez pas saisi une autre clé ou que le bouton « Vérifier la clé » n'a
pas réussi), pause demandée par DeepL, `/data` illisible ou non inscriptible.

## Vie privée

Le texte, la traduction et la clé ne sont jamais écrits dans les journaux, le
statut ni `/data`. `/data` ne garde que les dates et nombres de caractères des
dernières 24 heures, une pause éventuelle, et une empreinte de 8 bits d'une clé
refusée. Les textes partent chez DeepL, selon les conditions de votre compte
DeepL.
