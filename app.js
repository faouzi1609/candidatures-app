// Candidatures — suivi et validation des candidatures préparées par l'agent.
// Les données vivent dans les issues du dépôt privé de l'agent ; l'appli les lit
// et poste vos commandes (/valider, /ecarter…) via l'API GitHub, avec votre jeton.

const API = "https://api.github.com";
const CLE_REGLAGES = "candidatures.reglages";
const CLE_BROUILLONS = "candidatures.brouillons";

const STATUTS = [
  { cle: "a-valider", nom: "À valider", motif: "à valider" },
  { cle: "a-postuler", nom: "À postuler", motif: "à postuler" },
  { cle: "envoyee", nom: "Envoyées", motif: "envoyée" },
  { cle: "entretien", nom: "Entretiens", motif: "entretien" },
  { cle: "offre-recue", nom: "Offres reçues", motif: "offre reçue" },
  { cle: "refusee", nom: "Refusées", motif: "refusée" },
  { cle: "ecartee", nom: "Écartées", motif: "écartée" },
];
const NOM_STATUT = Object.fromEntries(STATUTS.map((s) => [s.cle, s.nom.replace(/s$/, "")]));
NOM_STATUT["a-valider"] = "À valider";
NOM_STATUT["a-postuler"] = "À postuler";
NOM_STATUT["offre-recue"] = "Offre reçue";

const SOURCES = {
  france_travail: "France Travail",
  adzuna: "Adzuna",
  linkedin_alerte: "LinkedIn",
  indeed_alerte: "Indeed",
};

const etat = {
  reglages: lireStockage(CLE_REGLAGES, { jeton: "", depot: "" }),
  offres: [],
  derniereCollecte: null,
  vue: "jour",
  chargement: false,
  erreur: "",
};

// ── Stockage local (protégé : peut être indisponible) ─────────────────
function lireStockage(cle, defaut) {
  try { return { ...defaut, ...JSON.parse(localStorage.getItem(cle) || "{}") }; }
  catch { return { ...defaut }; }
}
function ecrireStockage(cle, valeur) {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* navigation privée */ }
}
function brouillons() { return lireStockage(CLE_BROUILLONS, {}); }
function enregistrerBrouillon(numero, texte) {
  const b = brouillons();
  if (texte === null) delete b[numero]; else b[numero] = texte;
  ecrireStockage(CLE_BROUILLONS, b);
}

// ── Construction de DOM sûre (le texte des offres vient de l'extérieur) ──
function h(balise, attrs = {}, ...enfants) {
  const el = document.createElement(balise);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "html") throw new Error("interdit");
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const enfant of enfants.flat()) {
    if (enfant === null || enfant === undefined || enfant === false) continue;
    el.append(enfant instanceof Node ? enfant : document.createTextNode(String(enfant)));
  }
  return el;
}
function lienSur(url) {
  try { const u = new URL(url); return ["http:", "https:"].includes(u.protocol) ? u.href : null; }
  catch { return null; }
}

// ── API GitHub ──────────────────────────────────────────────────────
class ErreurGitHub extends Error {
  constructor(statut, message) { super(message); this.statut = statut; }
}
async function gh(chemin, options = {}) {
  const r = await fetch(`${API}${chemin}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${etat.reglages.jeton}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  if (!r.ok) {
    let message = r.statusText;
    try { message = (await r.json()).message || message; } catch { /* corps vide */ }
    throw new ErreurGitHub(r.status, message);
  }
  return r.status === 204 ? null : r.json();
}
const depot = () => `/repos/${etat.reglages.depot}`;

function messageErreur(e) {
  if (!(e instanceof ErreurGitHub)) return "Connexion impossible. Vérifiez votre réseau.";
  if (e.statut === 401) return "Jeton refusé : il a expiré ou il est mal copié. Allez dans Réglages.";
  if (e.statut === 403) return "Droits insuffisants pour ce jeton (voir Réglages).";
  if (e.statut === 404) return "Dépôt introuvable, ou le jeton n'y a pas accès.";
  return `GitHub : ${e.message}`;
}

// ── Lecture des fiches ──────────────────────────────────────────────
const RE_DONNEES = /<!-- agent-donnees (.*?) -->/s;
const RE_LETTRE = /<summary><b>✉️ Lettre de motivation proposée<\/b>.*?<\/summary>\s*([\s\S]*?)\s*<\/details>/;

function statutDe(issue) {
  const noms = issue.labels.map((l) => (typeof l === "string" ? l : l.name).toLowerCase());
  for (const s of STATUTS) if (noms.some((n) => n.includes(s.motif))) return s.cle;
  return "a-valider";
}

function versOffre(issue) {
  const corps = issue.body || "";
  let d = {};
  try { d = JSON.parse((corps.match(RE_DONNEES) || [])[1] || "{}"); } catch { d = {}; }
  const scoreTitre = Number((issue.title.match(/^\[(\d+)\/100\]/) || [])[1]);
  const titreBrut = issue.title.replace(/^\[\d+\/100\]\s*/, "");
  return {
    numero: issue.number,
    url: issue.html_url,
    cree: new Date(issue.created_at),
    maj: new Date(issue.updated_at),
    statut: statutDe(issue),
    score: Number.isFinite(d.score) ? d.score : scoreTitre || 0,
    titre: d.titre || titreBrut.split(" — ")[0],
    entreprise: d.entreprise || titreBrut.split(" — ")[1] || "",
    lieu: d.lieu || "",
    contrat: d.contrat || "",
    salaire: d.salaire || "",
    source: d.source || "",
    lienOffre: lienSur(d.url || ""),
    email: d.email_contact || "",
    complete: d.description_complete !== false,
    resume: d.resume || "",
    forts: d.points_forts || [],
    faibles: d.points_faibles || [],
    eliminatoires: d.eliminatoires || [],
    reponses: d.reponses_types || [],
    lettre: (corps.match(RE_LETTRE) || [])[1] || "",
  };
}

async function chargerOffres() {
  const toutes = [];
  for (let page = 1; page < 20; page++) {
    const lot = await gh(`${depot()}/issues?labels=offre&state=all&per_page=100&page=${page}`);
    toutes.push(...lot.filter((i) => !i.pull_request).map(versOffre));
    if (lot.length < 100) break;
  }
  return toutes;
}

async function chargerDerniereCollecte() {
  try {
    const r = await gh(`${depot()}/actions/workflows/collecte.yml/runs?per_page=1`);
    return r.workflow_runs[0] || null;
  } catch {
    return null; // jeton sans droit « Actions » : on s'en passe
  }
}

async function rafraichir({ silencieux = false } = {}) {
  if (!etat.reglages.jeton || !etat.reglages.depot) { rendre(); return; }
  etat.chargement = true;
  document.getElementById("btn-rafraichir").classList.add("tourne");
  if (!silencieux && !etat.offres.length) rendre();
  try {
    const [offres, collecte] = await Promise.all([chargerOffres(), chargerDerniereCollecte()]);
    etat.offres = offres;
    etat.derniereCollecte = collecte;
    etat.erreur = "";
  } catch (e) {
    etat.erreur = messageErreur(e);
  } finally {
    etat.chargement = false;
    document.getElementById("btn-rafraichir").classList.remove("tourne");
    rendre();
  }
}

// ── Commandes ───────────────────────────────────────────────────────
async function commander(offre, texte) {
  await gh(`${depot()}/issues/${offre.numero}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: texte }),
  });
}

// Après une commande, l'agent (GitHub Actions) met ~20 à 60 s à mettre la fiche à jour.
async function suivreJusquA(offre, statutsAttendus, delaiMax = 150000) {
  const debut = Date.now();
  while (Date.now() - debut < delaiMax) {
    await new Promise((r) => setTimeout(r, 8000));
    try {
      const maj = versOffre(await gh(`${depot()}/issues/${offre.numero}`));
      const i = etat.offres.findIndex((o) => o.numero === maj.numero);
      if (i >= 0) etat.offres[i] = maj;
      if (statutsAttendus.includes(maj.statut)) { rendre(); return maj; }
    } catch { /* on réessaie */ }
  }
  return null;
}

async function lancerCollecte(bouton) {
  bouton.disabled = true;
  try {
    await gh(`${depot()}/actions/workflows/collecte.yml/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: "main" }),
    });
    toast("Collecte lancée. Les nouvelles offres arrivent d'ici quelques minutes.");
    setTimeout(() => rafraichir({ silencieux: true }), 6000);
  } catch (e) {
    toast(e.statut === 403 || e.statut === 404
      ? "Ce jeton n'a pas le droit « Actions : lecture et écriture » (voir Réglages)."
      : messageErreur(e), true);
  } finally {
    bouton.disabled = false;
  }
}

// ── Utilitaires d'affichage ─────────────────────────────────────────
function toast(message, erreur = false) {
  const t = document.getElementById("toast");
  t.textContent = message;
  t.className = `toast${erreur ? " erreur" : ""}`;
  t.hidden = false;
  clearTimeout(toast.minuteur);
  toast.minuteur = setTimeout(() => { t.hidden = true; }, erreur ? 6000 : 3500);
}
const fmtJour = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const fmtDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function ilYA(date) {
  const min = Math.round((Date.now() - date) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const hres = Math.round(min / 60);
  if (hres < 24) return `il y a ${hres} h`;
  const j = Math.round(hres / 24);
  return j === 1 ? "hier" : `il y a ${j} jours`;
}
const memeJour = (a, b) => a.toDateString() === b.toDateString();
const classeScore = (s) => (s >= 85 ? "haut" : s >= 70 ? "moyen" : "");

function blocScore(offre) {
  return h("div", { class: `score ${classeScore(offre.score)}`, "aria-label": `Score ${offre.score} sur 100` },
    h("b", {}, offre.score), h("small", {}, "/100"));
}

function carte(offre, { avecStatut = false } = {}) {
  return h("button", { class: `carte statut-${offre.statut}`, onclick: () => ouvrirFiche(offre.numero) },
    blocScore(offre),
    h("h3", {}, offre.titre),
    h("div", { class: "entreprise" }, [offre.entreprise, offre.lieu].filter(Boolean).join(" · ")),
    h("div", { class: "meta" },
      avecStatut ? h("span", { class: "etiquette statut" }, NOM_STATUT[offre.statut]) : null,
      avecStatut ? h("span", { class: "mini-score" }, `${offre.score}/100`) : null,
      offre.salaire ? h("span", { class: "etiquette" }, offre.salaire) : null,
      offre.statut === "a-valider" && offre.email ? h("span", { class: "etiquette email" }, "Envoi direct") : null,
      !offre.complete ? h("span", { class: "etiquette alerte" }, "Annonce partielle") : null,
      offre.source ? h("span", { class: "etiquette" }, SOURCES[offre.source] || offre.source) : null,
    ),
  );
}

function squelettes(n = 3) {
  return h("div", { class: "liste" }, Array.from({ length: n }, () => h("div", { class: "squelette" })));
}

// ── Vues ────────────────────────────────────────────────────────────
function vueBienvenue() {
  return h("section", { class: "bienvenue" },
    h("h2", {}, "Bienvenue."),
    h("p", {}, "Cette appli affiche les offres trouvées par votre agent et vous permet de valider chaque candidature avant son envoi. Pour commencer, connectez-la à votre dépôt."),
    h("button", { class: "bouton principal", onclick: () => allerA("reglages") }, "Connecter mon dépôt"),
  );
}

function vueJour() {
  if (!etat.reglages.jeton) return vueBienvenue();
  const o = etat.offres;
  const aujourdHui = new Date();
  const aValider = o.filter((x) => x.statut === "a-valider").sort((a, b) => b.score - a.score);
  const aPostuler = o.filter((x) => x.statut === "a-postuler");
  const envoyees = o.filter((x) => ["envoyee", "entretien", "offre-recue", "refusee"].includes(x.statut));
  const entretiens = o.filter((x) => ["entretien", "offre-recue"].includes(x.statut));
  const nouvelles = o.filter((x) => memeJour(x.cree, aujourdHui));

  const col = etat.derniereCollecte;
  let puce = "", texteCollecte = "Aucune collecte encore lancée";
  if (col) {
    const date = new Date(col.created_at);
    if (col.status !== "completed") { puce = "encours"; texteCollecte = "Collecte en cours…"; }
    else if (col.conclusion === "success") { puce = "ok"; texteCollecte = `Dernière collecte ${ilYA(date)}`; }
    else { puce = "ko"; texteCollecte = `Dernière collecte en échec (${ilYA(date)})`; }
  }

  return h("div", {},
    etat.erreur ? h("div", { class: "avertissement" }, etat.erreur) : null,
    h("div", { class: "chiffres" },
      h("div", { class: "chiffre accent" }, h("b", {}, aValider.length), h("span", {}, "à valider")),
      h("div", { class: "chiffre" }, h("b", {}, nouvelles.length), h("span", {}, "nouvelles aujourd'hui")),
      h("div", { class: "chiffre" }, h("b", {}, envoyees.length), h("span", {}, "candidatures envoyées")),
      h("div", { class: "chiffre" }, h("b", {}, entretiens.length), h("span", {}, "entretiens obtenus")),
    ),
    h("div", { class: "collecte" },
      h("span", { class: `puce-etat ${puce}` }),
      col ? h("a", { href: col.html_url, target: "_blank", rel: "noopener" }, texteCollecte) : texteCollecte,
      h("button", { class: "bouton bouton-petit", onclick: (e) => lancerCollecte(e.currentTarget) }, "Chercher maintenant"),
    ),

    h("div", { class: "section-titre" }, h("h2", {}, "À valider"), h("small", {}, "par score décroissant")),
    etat.chargement && !o.length ? squelettes()
      : aValider.length ? h("div", { class: "liste" }, aValider.map((x) => carte(x)))
      : h("div", { class: "vide" }, h("b", {}, "Rien à valider."), "Les nouvelles offres apparaîtront ici après la prochaine collecte."),

    aPostuler.length ? [
      h("div", { class: "section-titre" }, h("h2", {}, "À déposer vous-même"), h("small", {}, "validées, sans adresse e-mail")),
      h("div", { class: "liste" }, aPostuler.map((x) => carte(x))),
    ] : null,
  );
}

function vueSuivi() {
  if (!etat.reglages.jeton) return vueBienvenue();
  const ouvertes = new Set(["a-valider", "a-postuler", "envoyee", "entretien", "offre-recue"]);
  return h("div", {},
    etat.erreur ? h("div", { class: "avertissement" }, etat.erreur) : null,
    h("div", { class: "colonnes" },
      STATUTS.map((s) => {
        const liste = etat.offres.filter((x) => x.statut === s.cle).sort((a, b) => b.maj - a.maj);
        return h("details", { class: `colonne statut-${s.cle}`, open: ouvertes.has(s.cle) && liste.length > 0 },
          h("summary", {}, h("span", { class: "barre" }), h("h2", {}, s.nom), h("span", { class: "compte" }, liste.length)),
          liste.length ? h("div", { class: "liste" }, liste.map((x) => carte(x, { avecStatut: true })))
            : h("p", { class: "mini-score" }, "Aucune pour l'instant."),
        );
      }),
    ),
  );
}

function vueReglages() {
  const r = etat.reglages;
  const champJeton = h("input", { id: "jeton", type: "password", autocomplete: "off", value: r.jeton, placeholder: "github_pat_…" });
  const champDepot = h("input", { id: "depot", type: "text", autocomplete: "off", value: r.depot, placeholder: "utilisateur/nom-du-depot" });
  const resultat = h("p", { class: "mini-score", role: "status" });

  async function enregistrer(e) {
    e.preventDefault();
    const depotSaisi = champDepot.value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
    etat.reglages = { jeton: champJeton.value.trim(), depot: depotSaisi };
    resultat.textContent = "Vérification…";
    try {
      const d = await gh(`/repos/${depotSaisi}`);
      ecrireStockage(CLE_REGLAGES, etat.reglages);
      resultat.textContent = `Connecté à ${d.full_name}${d.private ? " (privé)" : ""}.`;
      toast("Connexion réussie.");
      allerA("jour");
      rafraichir();
    } catch (err) {
      resultat.textContent = messageErreur(err);
    }
  }
  function deconnecter() {
    etat.reglages = { jeton: "", depot: "" };
    etat.offres = [];
    ecrireStockage(CLE_REGLAGES, etat.reglages);
    try { localStorage.removeItem(CLE_BROUILLONS); } catch { /* rien */ }
    toast("Jeton effacé de cet appareil.");
    rendre();
  }

  return h("div", {},
    h("div", { class: "section-titre" }, h("h2", {}, "Connexion à votre dépôt")),
    h("form", { class: "formulaire", onsubmit: enregistrer },
      h("div", { class: "champ" },
        h("label", { for: "depot" }, "Dépôt de l'agent"),
        champDepot,
        h("small", {}, "Le dépôt privé qui contient l'agent, par ex. nom-utilisateur/Agent-candidature-"),
      ),
      h("div", { class: "champ" },
        h("label", { for: "jeton" }, "Jeton GitHub personnel"),
        champJeton,
        h("small", {}, "Stocké uniquement sur cet appareil. Jamais envoyé ailleurs qu'à GitHub."),
      ),
      h("button", { class: "bouton principal", type: "submit" }, "Enregistrer et tester"),
      resultat,
    ),
    h("div", { class: "section-titre" }, h("h2", {}, "Créer le jeton (2 minutes)")),
    h("div", { class: "aide" },
      h("ol", {},
        h("li", {}, "Ouvrez ", h("a", { href: "https://github.com/settings/personal-access-tokens/new", target: "_blank", rel: "noopener" }, "github.com → Fine-grained token"), "."),
        h("li", {}, "Nom : « Appli candidatures ». Expiration : 1 an."),
        h("li", {}, "Repository access : ", h("b", {}, "Only select repositories"), " → votre dépôt de l'agent uniquement."),
        h("li", {}, "Permissions du dépôt : ", h("code", {}, "Issues : Read and write"), " et ", h("code", {}, "Actions : Read and write"), " (pour le bouton « Chercher maintenant »)."),
        h("li", {}, "Générez, copiez le jeton et collez-le ci-dessus."),
      ),
      h("p", {}, "Le jeton ne donne accès qu'à ce dépôt. Vous pouvez le révoquer à tout moment depuis GitHub."),
    ),
    r.jeton ? [
      h("div", { class: "section-titre" }, h("h2", {}, "Cet appareil")),
      h("button", { class: "bouton", onclick: deconnecter }, "Effacer le jeton de cet appareil"),
    ] : null,
  );
}

// ── Fiche détaillée ─────────────────────────────────────────────────
async function ouvrirFiche(numero) {
  const offre = etat.offres.find((o) => o.numero === numero);
  if (!offre) return;
  const dialogue = document.getElementById("fiche");
  const brouillon = brouillons()[numero];
  const zoneLettre = h("textarea", { class: "lettre", "aria-label": "Lettre de motivation", spellcheck: "true" });
  zoneLettre.value = brouillon ?? offre.lettre;
  const marqueModif = h("span", { class: "modifiee", hidden: brouillon === undefined || brouillon === offre.lettre }, "· modifiée");
  zoneLettre.addEventListener("input", () => {
    const modifiee = zoneLettre.value !== offre.lettre;
    marqueModif.hidden = !modifiee;
    enregistrerBrouillon(numero, modifiee ? zoneLettre.value : null);
  });
  const historique = h("ul", { class: "historique" }, h("li", {}, "Chargement…"));
  const lettreEditable = offre.statut === "a-valider";
  if (!lettreEditable) zoneLettre.readOnly = true;

  const copier = async (texte, quoi) => {
    try { await navigator.clipboard.writeText(texte); toast(`${quoi} copiée.`); }
    catch { toast("Copie impossible sur cet appareil.", true); }
  };

  const actions = h("div", { class: "actions" }, boutonsActions(offre, zoneLettre, copier));

  dialogue.replaceChildren(
    h("div", { class: "fiche-panneau" },
      h("div", { class: "fiche-haut" },
        h("span", { class: `etiquette statut statut-${offre.statut}` }, NOM_STATUT[offre.statut]),
        h("button", { class: "bouton discret bouton-petit", onclick: () => dialogue.close(), "aria-label": "Fermer" }, "Fermer ✕"),
      ),
      h("div", { class: "fiche-corps" },
        h("div", { class: "fiche-tete" },
          h("div", {},
            h("h2", { id: "fiche-titre" }, offre.titre),
            h("div", { class: "entreprise" }, offre.entreprise),
          ),
          blocScore(offre),
        ),
        h("div", { class: "meta" },
          [offre.lieu, offre.contrat, offre.salaire].filter(Boolean).map((t) => h("span", { class: "etiquette" }, t)),
          offre.source ? h("span", { class: "etiquette" }, SOURCES[offre.source] || offre.source) : null,
          offre.email ? h("span", { class: "etiquette email" }, `Envoi direct : ${offre.email}`) : h("span", { class: "etiquette" }, "À déposer sur le site"),
        ),
        !offre.complete ? h("div", { class: "avertissement" }, "Annonce partielle : l'agent n'a vu qu'un extrait. Lisez l'offre complète avant de valider.") : null,
        offre.resume ? h("p", { class: "resume" }, offre.resume) : null,
        offre.lienOffre ? h("p", {}, h("a", { href: offre.lienOffre, target: "_blank", rel: "noopener noreferrer" }, "Voir l'annonce ↗")) : null,

        offre.forts.length ? h("div", { class: "bloc" }, h("h3", {}, "Points forts"), h("ul", { class: "points forts" }, offre.forts.map((p) => h("li", {}, p)))) : null,
        offre.faibles.length ? h("div", { class: "bloc" }, h("h3", {}, "Points faibles"), h("ul", { class: "points faibles" }, offre.faibles.map((p) => h("li", {}, p)))) : null,
        offre.eliminatoires.length ? h("div", { class: "bloc" }, h("h3", {}, "Critères éliminatoires"), h("ul", { class: "points elim" }, offre.eliminatoires.map((p) => h("li", {}, p)))) : null,

        h("div", { class: "bloc" },
          h("h3", {}, "Lettre de motivation", marqueModif),
          zoneLettre,
          h("div", { class: "meta" },
            lettreEditable ? h("span", { class: "mini-score" }, "Modifiable : c'est votre version qui sera envoyée.") : null,
            h("button", { class: "bouton bouton-petit", onclick: () => copier(zoneLettre.value, "Lettre") }, "Copier la lettre"),
          ),
        ),
        offre.reponses.length ? h("div", { class: "bloc" },
          h("h3", {}, "Réponses types"),
          offre.reponses.map((rep) => h("div", { class: "reponse" },
            h("p", {}, rep),
            h("button", { class: "bouton bouton-petit", onclick: () => copier(rep, "Réponse") }, "Copier"),
          )),
        ) : null,
        h("div", { class: "bloc" }, h("h3", {}, "Historique"), historique),
        h("p", {}, h("a", { href: offre.url, target: "_blank", rel: "noopener", class: "mini-score" }, `Fiche #${offre.numero} sur GitHub ↗`)),
      ),
      actions.childElementCount ? actions : null,
    ),
  );
  dialogue.showModal();
  dialogue.querySelector(".fiche-panneau").scrollTop = 0;

  try {
    const commentaires = await gh(`${depot()}/issues/${numero}/comments?per_page=50`);
    historique.replaceChildren(
      h("li", {}, h("time", {}, fmtDate.format(offre.cree)), "Offre détectée et analysée par l'agent"),
      ...commentaires.map((c) => h("li", {},
        h("time", {}, fmtDate.format(new Date(c.created_at))),
        (c.body.split("\n")[0] || "").slice(0, 160),
      )),
    );
  } catch {
    historique.replaceChildren(h("li", {}, "Historique indisponible."));
  }
}

function boutonsActions(offre, zoneLettre, copier) {
  const fermer = () => document.getElementById("fiche").close();
  const agir = (libelle, classe, fn) => h("button", {
    class: `bouton ${classe}`,
    onclick: async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try { await fn(); } catch (err) { toast(messageErreur(err), true); } finally { b.disabled = false; }
    },
  }, libelle);

  const changer = (commande, nouveau, message) => async () => {
    await commander(offre, commande);
    offre.statut = nouveau;
    enregistrerBrouillon(offre.numero, null);
    fermer(); rendre(); toast(message);
    suivreJusquA(offre, [nouveau]);
  };

  switch (offre.statut) {
    case "a-valider": {
      const libelle = offre.email ? "Envoyer" : "Valider";
      return [
        agir("Écarter", "", changer("/ecarter", "ecartee", "Offre écartée.")),
        agir(libelle, "accent", async () => {
          const modifiee = zoneLettre.value.trim() !== offre.lettre.trim();
          const ok = await confirmer(
            offre.email ? "Envoyer cette candidature ?" : "Valider cette offre ?",
            offre.email
              ? `La lettre${modifiee ? " (votre version modifiée)" : ""} et votre CV seront envoyés par e-mail à ${offre.email}. Une copie arrivera dans votre boîte Gmail.`
              : "Pas d'adresse e-mail pour cette offre : elle passera « à postuler ». Vous déposerez la candidature sur le site avec la lettre prête à copier.",
            offre.email ? "Envoyer" : "Valider",
          );
          if (!ok) return;
          await commander(offre, modifiee ? `/valider\n${zoneLettre.value.trim()}` : "/valider");
          enregistrerBrouillon(offre.numero, null);
          fermer();
          toast(offre.email ? "Envoi en cours… confirmation d'ici une minute." : "Validée : à déposer sur le site.");
          const maj = await suivreJusquA(offre, ["envoyee", "a-postuler"]);
          if (maj?.statut === "envoyee") toast(`📨 Candidature envoyée à ${offre.email}.`);
          else if (!maj) toast("Pas encore de confirmation : vérifiez l'historique de la fiche.", true);
        }),
      ];
    }
    case "a-postuler":
      return [
        offre.lienOffre ? h("a", { class: "bouton", href: offre.lienOffre, target: "_blank", rel: "noopener noreferrer", onclick: () => copier(zoneLettre.value, "Lettre") }, "Postuler ↗") : null,
        agir("J'ai postulé", "principal", changer("/envoyee", "envoyee", "Noté : candidature envoyée.")),
      ];
    case "envoyee":
      return [
        agir("Refus", "", changer("/refus", "refusee", "Noté. La suivante sera la bonne.")),
        agir("Entretien obtenu", "principal", changer("/entretien", "entretien", "Bravo ! Entretien noté.")),
      ];
    case "entretien":
      return [
        agir("Refus", "", changer("/refus", "refusee", "Noté. La suivante sera la bonne.")),
        agir("Offre reçue 🎉", "accent", changer("/offre", "offre-recue", "Félicitations !")),
      ];
    default:
      return [];
  }
}

function confirmer(titre, texte, libelleOk) {
  const d = document.getElementById("confirmation");
  return new Promise((resolve) => {
    const finir = (v) => { d.close(); resolve(v); };
    d.replaceChildren(h("div", { class: "confirmation-boite" },
      h("h2", {}, titre),
      h("p", {}, texte),
      h("div", { class: "actions-conf" },
        h("button", { class: "bouton", onclick: () => finir(false) }, "Annuler"),
        h("button", { class: "bouton accent", onclick: () => finir(true) }, libelleOk),
      ),
    ));
    d.addEventListener("cancel", () => resolve(false), { once: true });
    d.showModal();
  });
}

// ── Rendu et navigation ─────────────────────────────────────────────
function rendre() {
  const vues = { jour: vueJour, suivi: vueSuivi, reglages: vueReglages };
  document.getElementById("vue").replaceChildren(vues[etat.vue]());
  document.querySelectorAll(".onglets button").forEach((b) => b.classList.toggle("actif", b.dataset.vue === etat.vue));

  const aValider = etat.offres.filter((o) => o.statut === "a-valider").length;
  const pastille = document.getElementById("pastille-valider");
  pastille.hidden = !aValider;
  pastille.textContent = aValider;
  if ("setAppBadge" in navigator) (aValider ? navigator.setAppBadge(aValider) : navigator.clearAppBadge?.())?.catch?.(() => {});

  const jour = fmtJour.format(new Date());
  document.getElementById("sous-titre").textContent =
    etat.reglages.jeton ? `${jour[0].toUpperCase()}${jour.slice(1)}` : "Non connecté";
}

function allerA(vue) {
  etat.vue = vue;
  rendre();
  window.scrollTo({ top: 0 });
}

document.querySelectorAll(".onglets button").forEach((b) => b.addEventListener("click", () => allerA(b.dataset.vue)));
document.getElementById("btn-rafraichir").addEventListener("click", () => rafraichir());
document.getElementById("fiche").addEventListener("click", (e) => { if (e.target.id === "fiche") e.target.close(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) rafraichir({ silencieux: true }); });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

rendre();
rafraichir();
