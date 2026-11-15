// -----------------------------------------------------------------------------
// Texts shown to the user (status, button, scene errors), English and French.
// None of them ever holds the API key, the text, the translation or what
// DeepL answered word for word.
// -----------------------------------------------------------------------------

const n = (value, lang) => value.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US');
const plan = (free) => (free ? 'DeepL API Free' : 'DeepL API Pro');

export const T = {
  status: {
    no_key: {
      en: 'Type the DeepL API key in the configuration.',
      fr: "Saisissez la clé d'API DeepL dans la configuration.",
    },
    bad_key: {
      en: 'The API key holds characters DeepL keys never have (spaces, accents): copy it again.',
      fr: "La clé d'API contient des caractères qu'une clé DeepL n'a jamais (espaces, accents) : copiez-la à nouveau.",
    },
    config_unread: (seconds) => ({
      en: `The configuration could not be read from Gladys: new try in ${seconds} s.`,
      fr: `La configuration n'a pas pu être lue depuis Gladys : nouvel essai dans ${seconds} s.`,
    }),
    refused: {
      en: 'DeepL refused the API key at the last translation (403): no scene uses it any more. Type another key, or check it with the "Check the key" button (also needed, rarely, for a new key typed while the integration was stopped).',
      fr: "DeepL a refusé la clé d'API à la dernière traduction (403) : plus aucune scène ne l'utilise. Saisissez une autre clé, ou vérifiez-la avec le bouton « Vérifier la clé » (nécessaire aussi, rarement, pour une nouvelle clé saisie pendant l'arrêt de l'intégration).",
    },
    paused: (minutes, why) => {
      const cause = {
        rate_limited: {
          en: 'DeepL asked to slow down (429)',
          fr: 'DeepL a demandé de ralentir (429)',
        },
        quota: {
          en: 'DeepL quota reached (456: character quota, cost limit or key limit)',
          fr: 'quota DeepL atteint (456 : quota de caractères, limite de coût ou limite de la clé)',
        },
        server: { en: 'DeepL is failing (5xx)', fr: 'DeepL est en panne (5xx)' },
      }[why] ?? { en: 'DeepL is failing (5xx)', fr: 'DeepL est en panne (5xx)' };
      return {
        en: `${cause.en}: nothing is translated for about ${minutes} min.`,
        fr: `${cause.fr} : rien n'est traduit pendant environ ${minutes} min.`,
      };
    },
    ready: (free, perCall, perDay) => ({
      en: `Ready (${plan(free)} key): a scene translates ${n(perCall, 'en')} characters per call at most, ${n(perDay, 'en')} over 24 hours.`,
      fr: `Prêt (clé ${plan(free)}) : une scène traduit ${n(perCall, 'fr')} caractères par appel au plus, ${n(perDay, 'fr')} sur 24 heures.`,
    }),
    data_unreadable: {
      en: '/data is unreadable: nothing is translated (the characters of the last 24 hours are unknown). Read again every 10 s.',
      fr: "/data est illisible : rien n'est traduit (les caractères des dernières 24 heures sont inconnus). Relu toutes les 10 s.",
    },
    data_unwritable: {
      en: ' /data could not be written at the last save: a translation is refused while its count cannot be kept.',
      fr: " /data n'a pas pu être écrit au dernier enregistrement : une traduction est refusée tant que son décompte ne peut pas être gardé.",
    },
  },

  prefix: {
    nothing: { en: 'Nothing sent to DeepL', fr: 'Rien envoyé à DeepL' },
    maybe: {
      en: 'Sent to DeepL without an answer (may be counted, not tried again)',
      fr: 'Envoyé à DeepL sans réponse (peut être compté, pas de nouvel essai)',
    },
    unchecked: { en: 'Not checked', fr: 'Non vérifié' },
  },

  // Why a translation did not leave, or got no answer.
  reason: {
    no_key: { en: 'no API key', fr: "pas de clé d'API" },
    bad_key: { en: 'the API key does not read', fr: "la clé d'API est illisible" },
    config_unread: {
      en: 'the configuration is not read yet',
      fr: "la configuration n'est pas encore lue",
    },
    data_pending: { en: '/data is not read yet', fr: "/data n'est pas encore lu" },
    data_unreadable: {
      en: '/data is unreadable (the characters of the last 24 hours are unknown)',
      fr: '/data est illisible (les caractères des dernières 24 heures sont inconnus)',
    },
    data_unwritable: {
      en: 'the count could not be saved in /data',
      fr: "le décompte n'a pas pu être enregistré dans /data",
    },
    empty_text: { en: 'the text is empty', fr: 'le texte est vide' },
    too_long: {
      en: 'the text is longer than the maximum characters per call',
      fr: 'le texte dépasse le nombre maximal de caractères par appel',
    },
    bad_target: { en: 'unknown target language', fr: 'langue cible inconnue' },
    bad_source: { en: 'unknown source language', fr: 'langue source inconnue' },
    bad_formality: { en: 'unknown formality', fr: 'formalité inconnue' },
    queue_full: {
      en: 'too many translations waiting for their turn',
      fr: 'trop de traductions attendent leur tour',
    },
    time: { en: 'no time left for the request', fr: 'plus le temps de faire la requête' },
    stopped: { en: 'the integration stopped', fr: "l'intégration s'est arrêtée" },
    paused: { en: 'DeepL asked for a pause', fr: 'DeepL a demandé une pause' },
    cap: {
      en: 'the cap of characters over 24 hours is reached',
      fr: 'le plafond de caractères sur 24 heures est atteint',
    },
    refused: { en: 'the API key was refused (403)', fr: "la clé d'API a été refusée (403)" },
    unauthorized: {
      en: 'DeepL answered 401 (not taken as a refusal of the key: DeepL refuses a key with 403)',
      fr: 'DeepL a répondu 401 (pas pris pour un refus de la clé : DeepL refuse une clé par un 403)',
    },
    request_too_large: {
      en: 'DeepL refused the size of the request (413)',
      fr: 'DeepL a refusé la taille de la requête (413)',
    },
    quota: {
      en: 'DeepL quota reached (456: the character quota of the account, its cost limit or a limit of the key)',
      fr: 'quota DeepL atteint (456 : le quota de caractères du compte, sa limite de coût ou une limite de la clé)',
    },
    invalid: { en: 'refused by DeepL (400)', fr: 'refusé par DeepL (400)' },
    rate_limited: {
      en: 'DeepL asked to slow down (429)',
      fr: 'DeepL a demandé de ralentir (429)',
    },
    server: { en: 'DeepL failed (5xx)', fr: 'DeepL en panne (5xx)' },
    timeout: { en: 'DeepL did not answer in time', fr: "DeepL n'a pas répondu à temps" },
    network: { en: 'network error', fr: 'erreur réseau' },
    redirect: { en: 'unexpected redirect', fr: 'redirection inattendue' },
    http: { en: 'unexpected answer', fr: 'réponse inattendue' },
    too_large: { en: 'answer too large', fr: 'réponse trop grande' },
    unreadable: {
      en: 'the answer holds no readable translation',
      fr: 'la réponse ne contient aucune traduction lisible',
    },
  },

  check: {
    ok: ({ free, usage, used, cap }) => {
      const en = [`DeepL accepted the key (${plan(free)}).`];
      const fr = [`DeepL a accepté la clé (${plan(free)}).`];
      if (usage) {
        const limit = usage.limit > 0 && usage.limit < 1e12;
        en.push(
          `DeepL account: ${n(usage.count, 'en')}${limit ? ` of ${n(usage.limit, 'en')}` : ''} characters this billing period.`,
        );
        fr.push(
          `Compte DeepL : ${n(usage.count, 'fr')}${limit ? ` sur ${n(usage.limit, 'fr')}` : ''} caractères sur la période de facturation.`,
        );
      }
      if (used !== undefined) {
        en.push(`This module: ${n(used, 'en')} of ${n(cap, 'en')} characters over 24 hours.`);
        fr.push(`Ce module : ${n(used, 'fr')} sur ${n(cap, 'fr')} caractères sur 24 heures.`);
      }
      return { en: en.join(' '), fr: fr.join(' ') };
    },
    refused: {
      en: 'DeepL refused the key on its usage route (403). This alone does not block the scenes: the next translation tells whether the key can translate.',
      fr: 'DeepL a refusé la clé sur sa route de consommation (403). Cela seul ne bloque pas les scènes : la prochaine traduction dira si la clé peut traduire.',
    },
    refused_blocked: {
      en: 'DeepL refused the key on its usage route (403), and had already refused it for translating: scenes still do not use it. Type another key.',
      fr: "DeepL a refusé la clé sur sa route de consommation (403), et l'avait déjà refusée pour traduire : les scènes ne l'utilisent toujours pas. Saisissez une autre clé.",
    },
  },
};

/** An Error for a scene log: English first, then French. */
export function sceneError(message) {
  return new Error(`${message.en} | ${message.fr}`);
}

/** A reason alone, as a two-language message. */
export function reasonMessage(code, prefix = T.prefix.nothing) {
  const r = T.reason[code] ?? { en: code, fr: code };
  return { en: `${prefix.en}: ${r.en}.`, fr: `${prefix.fr} : ${r.fr}.` };
}
