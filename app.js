/* Clutch - renders data/today.json (the day's games) and data/track.json (Bilan), both written
   by `clutch site build`. The only odds are the ones you type in the props calculator, which
   stay in the page, and the lines you enter yourself in lines/props.csv. */
(() => {
  "use strict";

  const pct = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });
  const pct1 = new Intl.NumberFormat("fr-FR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const num = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const int = new Intl.NumberFormat("fr-FR");
  const ll = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const odds2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const longDay = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
  const fullDay = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const shortDay = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const hour = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const stamp = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  let DATA = null;
  let TRACK = null;
  let PROPS = null;
  let dataState = "loading";
  let trackState = "loading";
  let filter = "all";
  let view = location.hash === "#bilan" ? "bilan" : "day";

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const isoDay = (s) => new Date(s + "T00:00:00Z");
  const signed = (x) => (x > 0 ? "+" : x < 0 ? "−" : "") + num.format(Math.abs(x));

  function line(label, value, p) {
    const box = el("div", "line");
    box.append(el("span", "k", label), el("span", "v", `${value} : ${pct.format(p)}`));
    const bar = el("span", "bar");
    const fill = el("i");
    fill.style.width = (p * 100).toFixed(1) + "%";
    bar.append(fill);
    box.append(bar);
    return box;
  }

  function resultLine(g) {
    const r = g.result;
    const homeWon = r.home_score > r.away_score;
    const p = el("p", "result");
    p.append(el("strong", null, `${g.away} ${r.away_score} – ${r.home_score} ${g.home}`));
    const hit = homeWon === (g.p_home >= 0.5);
    p.append(el("span", "verdict " + (hit ? "hit" : "miss"), hit ? "favori vainqueur" : "favori battu"));
    return p;
  }

  function card(g) {
    const done = Boolean(g.result);
    const c = el("article", "card" + (done ? " done" : ""));
    const meta = el("div", "meta");
    if (done) meta.append(el("span", "status done", "Terminé"));
    else meta.append(el("span", "status " + (g.ok ? "ok" : "warn"), g.ok ? "Prédiction fiable" : "Prudence : " + g.why.join(", ")));
    const when = [hour.format(new Date(g.tipoff))];
    if (g.stage && g.stage !== "saison régulière") when.push(g.stage);
    if (g.injury_source === "espn") when.push("blessures : liste ESPN");
    else if (g.injury_source === "mixed") when.push("blessures : rapport officiel et liste ESPN");
    meta.append(el("span", "when", when.join(" · ")));

    const teams = el("div", "players");
    const a = el("div", "p a");
    a.append(el("div", "pct", pct.format(1 - g.p_home)), el("div", "name", g.away));
    const h = el("div", "p b");
    h.append(el("div", "pct", pct.format(g.p_home)), el("div", "name", g.home));
    teams.append(a, el("div", "vs", "à"), h);
    if (done) (g.result.home_score > g.result.away_score ? h : a).classList.add("won");

    const split = el("div", "split");
    split.setAttribute("role", "img");
    split.setAttribute("aria-label", `${g.away} ${pct.format(1 - g.p_home)}, ${g.home} ${pct.format(g.p_home)}`);
    const sa = el("div", "sa");
    sa.style.width = ((1 - g.p_home) * 100).toFixed(1) + "%";
    const sb = el("div", "sb");
    sb.style.width = (g.p_home * 100).toFixed(1) + "%";
    split.append(sa, sb);

    const score = el("div", "score");
    const exp = el("span");
    exp.append("Score attendu ", el("strong", null, `${Math.round(g.exp_away)} – ${Math.round(g.exp_home)}`));
    score.append(exp, el("span", null, `Elo : ${pct.format(g.p_elo)} pour ${g.home_abbr}`));

    const lines = el("section", "lines");
    lines.setAttribute("aria-label", "Lignes du modèle");
    const sl = g.spread_line;
    lines.append(
      line("Handicap", `${g.home_abbr} ${signed(sl)}`, g.p_cover),
      line("Total", `plus de ${num.format(g.total_line)}`, g.p_over),
      line("1re mi-temps", `plus de ${num.format(g.h1.total_line)}`, g.h1.p_over),
      line("Mi-temps gagnée", g.home_abbr, g.h1.p_home)
    );

    c.append(meta);
    if (done) c.append(resultLine(g));
    c.append(teams, split, score, lines, ...ladders(g));
    const pp = propsPanel(g);
    if (pp) c.append(pp);
    return c;
  }


  // ------------------------------------------------------------------ several lines per market
  // rows: [{line, p}] with p = P(x > line), lines increasing; outcome: the real x once played
  function ladderPanel(title, sub, rows, label, outcome) {
    const det = el("details", "ladders");
    det.append(el("summary", null, title));
    det.append(el("p", "note", sub));
    const box = el("div", "ladder");
    let mid = 0;
    rows.forEach((r, i) => { if (Math.abs(r.p - 0.5) < Math.abs(rows[mid].p - 0.5)) mid = i; });
    rows.forEach((r, i) => {
      const row = el("div", "rung" + (i === mid ? " mid" : ""));
      const bar = el("span", "bar");
      const fill = el("i");
      fill.style.width = (r.p * 100).toFixed(1) + "%";
      bar.append(fill);
      const lab = el("span", "lab", label(r.line));
      row.append(lab, bar, el("span", "v", pct.format(r.p)), el("span", "odds", odds2.format(1 / Math.max(r.p, 0.001))));
      row.title = `${label(r.line)} : ${pct.format(r.p)} · cote juste ${odds2.format(1 / Math.max(r.p, 0.001))}`;
      if (outcome != null) {
        const hit = outcome > r.line;
        row.classList.add(hit ? "hit" : "miss");
        if (hit) lab.append(" ✓");
      }
      box.append(row);
    });
    det.append(box);
    return det;
  }

  function ladders(g) {
    const L = g.ladders;
    if (!L) return [];
    const out = [];
    const res = g.result;
    if (L.total && L.total.length) {
      const exp = Math.round(g.exp_home + g.exp_away);
      out.push(ladderPanel(
        "Total de points : toutes les lignes",
        `Probabilité que le match dépasse chaque total. Attendu : ${exp} points` + (res ? ` · réel : ${res.home_score + res.away_score}` : "") + ". Colonne de droite : la cote juste.",
        L.total, (x) => `plus de ${num.format(x)}`, res ? res.home_score + res.away_score : null));
    }
    if (L.margin && L.margin.length) {
      const exp = g.exp_home - g.exp_away;
      out.push(ladderPanel(
        "Handicap : toutes les lignes",
        `Probabilité que ${g.home} couvre chaque handicap (${g.home_abbr} −4,5 : gagner de 5 points ou plus). Écart attendu : ${signed(exp)}` +
          (res ? ` · réel : ${signed(res.home_score - res.away_score)}` : "") + ".",
        L.margin, (x) => `${g.home_abbr} ${signed(-x)}`, res ? res.home_score - res.away_score : null));
    }
    return out;
  }

  function ladderBilan(sub) {
    const L = (TRACK.ladders || {})[sub];
    const sec = el("section", "panel ladder-bilan");
    const h = el("h3");
    h.append("Total et handicap : toutes les lignes", el("span", null, "ce que le modèle annonçait, ce qui est arrivé"));
    sec.append(h);
    const names = [["total", "Total de points"], ["margin", "Handicap"]];
    if (!L || names.every(([k]) => !(L[k] && L[k].all && L[k].all.n))) {
      sec.append(el("p", "note", "Aucune ligne réglée pour l'instant : les échelles sont enregistrées depuis le 22 octobre 2026, le bilan se remplit à mesure que les matchs sont joués."));
      return sec;
    }
    for (const [k, name] of names) {
      const M = L[k];
      if (!M || !M.all || !M.all.n) continue;
      sec.append(el("h4", null, name));
      const table = el("table", "detail");
      table.append(el("thead"), el("tbody"));
      const head = el("tr");
      ["Annoncé entre", "Lignes (matchs)", "Annoncé", "Réussi", "± 95 %"].forEach((x) => head.append(el("th", null, x)));
      table.tHead.append(head);
      const rows = [...M.buckets.map((b) => [`${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)} %`, b]), ["Toutes", M.all]];
      for (const [label, b] of rows) {
        const tr = el("tr");
        tr.append(el("th", null, label));
        if (!b.n) tr.append(el("td", null, "0"), el("td", null, "–"), el("td", null, "–"), el("td", null, "–"));
        else tr.append(el("td", null, `${int.format(b.n)} (${int.format(b.games)})`), el("td", null, pct.format(b.announced)),
          el("td", null, pct.format(b.realised)), el("td", null, `± ${Math.round(b.ci95 * 100)} pts`));
        table.tBodies[0].append(tr);
      }
      sec.append(table);
    }
    sec.append(el("p", "note",
      "Chaque ligne de chaque match est comptée du côté que le modèle jugeait le plus probable (plus ou moins ; couvre ou non). " +
      "Un modèle juste réussit à peu près ce qu'il annonce dans chaque tranche. L'intervalle tient compte de ce que les lignes d'un même match bougent ensemble : " +
      "il faut quelques centaines de matchs pour qu'il devienne étroit."));
    return sec;
  }

  // ------------------------------------------------------------------ player props
  const LINES_EDIT = "https://github.com/ldjelouah/clutch/edit/main/lines/props.csv";
  const STAT_FR = { pts: "points", reb: "rebonds" };

  // negative binomial with mean mu and variance mu + alpha mu^2: P(X <= k)
  function nbCdf(k, mu, alpha) {
    if (k < 0) return 0;
    const r = 1 / alpha;
    const q = mu / (r + mu);
    let p = Math.pow(r / (r + mu), r);
    let c = p;
    for (let i = 0; i < k; i++) {
      p *= ((i + r) / (i + 1)) * q;
      c += p;
    }
    return Math.min(c, 1);
  }
  function priceLine(mu, alpha, lineV, over, under, S) {
    const pu = nbCdf(Math.ceil(lineV) - 1, mu, alpha);
    const po = 1 - nbCdf(Math.floor(lineV), mu, alpha);
    const push = Math.max(0, 1 - po - pu);
    const out = { po, pu, push, sides: [] };
    for (const [side, p, q, o] of [["plus", po, pu, over], ["moins", pu, po, under]]) {
      if (!(o > 1)) continue;
      const b = o - 1;
      const edge = p * b - q;
      const full = (b * p - q) / (b * (p + q));
      let stake = 0;
      if (full > 0 && edge >= S.min_edge) stake = Math.min(S.fraction * full, S.cap);
      out.sides.push({ side, p, fair: (p + q) / p, edge, stake });
    }
    return out;
  }

  function lineVerdict(l) {
    const p = el("p", "pline");
    if (l.error) {
      p.append(el("strong", null, `${l.player} · ${STAT_FR[l.stat] || l.stat} ${l.line}`), ` : non lu (${l.error})`);
      return p;
    }
    p.append(el("strong", null, `${l.name} · ${STAT_FR[l.stat]} ${num.format(l.line)}`));
    p.append(` (${l.book || "bookmaker"} ${odds2.format(l.over)} / ${odds2.format(l.under)}) : plus ${pct.format(l.p_over)}`);
    if (l.p_over_book != null) p.append(`, bookmaker ${pct.format(l.p_over_book)}`);
    const pick = l.pick ? `${l.pick === "over" ? "plus" : "moins"}, mise ${pct1.format(l.stake)} de la bankroll` : "pas de pari";
    p.append(" → ", el("strong", l.pick ? "pick" : null, pick));
    return p;
  }

  function propsPanel(g) {
    const P = DATA.props;
    const players = P && P.games ? P.games[String(g.game_id)] : null;
    if (!players || !players.length) return null;
    const det = el("details", "props");
    det.append(el("summary", null, `Joueurs : points et rebonds (${players.length})`));
    const table = el("table", "detail ptable");
    table.append(el("thead"), el("tbody"));
    const head = el("tr");
    ["Joueur", "Min.", "Points", "Rebonds", "Joue"].forEach((x) => head.append(el("th", null, x)));
    table.tHead.append(head);
    for (const p of players) {
      const tr = el("tr");
      tr.append(el("th", null, `${p.name} (${p.team})`), el("td", null, num.format(p.min)), el("td", null, num.format(p.pts)),
        el("td", null, num.format(p.reb)), el("td", null, pct.format(p.p_play)));
      table.tBodies[0].append(tr);
    }
    det.append(table);
    const mine = (P.lines || []).filter((l) => l.game_id === g.game_id || (l.error && l.date === DATA.date));
    if (mine.length) {
      const box = el("div", "plines");
      box.append(el("h4", null, "Vos lignes"));
      mine.forEach((l) => box.append(lineVerdict(l)));
      det.append(box);
    }
    det.append(calculator(players));
    return det;
  }

  function calculator(players) {
    const S = DATA.props.sizing;
    const form = el("form", "calc");
    form.append(el("h4", null, "Tester une ligne"));
    const who = el("select");
    players.forEach((p, i) => { const o = el("option", null, `${p.name} (${p.team})`); o.value = i; who.append(o); });
    const stat = el("select");
    for (const [k, v] of Object.entries(STAT_FR)) { const o = el("option", null, v); o.value = k; stat.append(o); }
    const mk = (ph, step) => { const i = el("input"); i.type = "number"; i.step = step; i.placeholder = ph; i.inputMode = "decimal"; return i; };
    const lineI = mk("ligne, ex. 24,5", "0.5");
    const overI = mk("cote plus", "0.01");
    const underI = mk("cote moins", "0.01");
    const bookI = el("input");
    bookI.placeholder = "bookmaker";
    const out = el("div", "calc-out");
    const lab = (t, c) => { const l = el("label", null); l.append(el("span", null, t), c); return l; };
    form.append(lab("Joueur", who), lab("Stat", stat), lab("Ligne", lineI), lab("Cote plus", overI), lab("Cote moins", underI), lab("Bookmaker", bookI), out);
    const update = () => {
      out.textContent = "";
      const p = players[Number(who.value)];
      const lv = parseFloat(lineI.value);
      if (!p || !(lv >= 0)) return;
      const mu = p[stat.value];
      const alpha = DATA.props.alpha[stat.value];
      const r = priceLine(mu, alpha, lv, parseFloat(overI.value), parseFloat(underI.value), S);
      out.append(el("p", null, `Modèle : moyenne ${num.format(mu)} ${STAT_FR[stat.value]} · plus ${pct1.format(r.po)} · moins ${pct1.format(r.pu)}` + (r.push > 0.001 ? ` · égalité ${pct1.format(r.push)}` : "")));
      for (const s of r.sides) {
        out.append(el("p", s.stake > 0 ? "pick" : null,
          `${s.side} : cote juste ${odds2.format(s.fair)}, avantage ${s.edge >= 0 ? "+" : "−"}${pct1.format(Math.abs(s.edge))}` +
          (s.stake > 0 ? `, mise ${pct1.format(s.stake)} de la bankroll` : ", pas de pari")));
      }
      if (overI.value && underI.value) {
        const row = [DATA.date, p.name, stat.value, lv, overI.value, underI.value, bookI.value || ""].join(",");
        const copy = el("div", "csv");
        const inp = el("input");
        inp.readOnly = true;
        inp.value = row;
        const btn = el("button", null, "Copier");
        btn.type = "button";
        btn.addEventListener("click", () => { inp.select(); navigator.clipboard?.writeText(row).catch(() => {}); btn.textContent = "Copié"; });
        const a = el("a", null, "Ajouter au suivi (lines/props.csv)");
        a.href = LINES_EDIT;
        a.target = "_blank";
        a.rel = "noopener";
        copy.append(inp, btn, a);
        out.append(copy, el("p", "note", "Collez la ligne à la fin du fichier et validez avant le coup d'envoi : le modèle la suit à chaque mise à jour jusqu'au match."));
      }
    };
    [who, stat, lineI, overI, underI, bookI].forEach((x) => x.addEventListener("input", update));
    form.addEventListener("submit", (e) => e.preventDefault());
    return form;
  }

  function propsBilan() {
    const T = PROPS;
    const sec = el("section", "panel props-bilan");
    const h = el("h3");
    h.append("Lignes joueurs suivies", el("span", null, "points et rebonds, lignes saisies à la main"));
    sec.append(h);
    if (!T || !T.counts || !(T.counts.settled + T.counts.open)) {
      sec.append(el("p", "note", "Aucune ligne suivie pour l'instant. Utilisez « Tester une ligne » sous un match pour en ajouter."));
      return sec;
    }
    const table = el("table", "detail");
    table.append(el("thead"), el("tbody"));
    const head = el("tr");
    ["Période", "Lignes jouées", "Log-loss : modèle / bookmaker", "Paris (G-P-N)", "ROI (Kelly)", "Mise fixe"].forEach((x) => head.append(el("th", null, x)));
    table.tHead.append(head);
    for (const [pid, label] of [["7", "7 derniers jours"], ["30", "30 derniers jours"], ["all", "Depuis le début"]]) {
      const s = T.stats[pid] || {};
      const tr = el("tr");
      tr.append(el("th", null, label), el("td", null, int.format(s.decided || 0)),
        el("td", null, s.logloss != null ? `${ll.format(s.logloss)} / ${s.logloss_book != null ? ll.format(s.logloss_book) : "–"}` : "–"),
        el("td", null, s.bets ? `${s.won}-${s.lost}-${s.push}` : "0"),
        el("td", null, s.roi != null ? (s.roi >= 0 ? "+" : "−") + pct1.format(Math.abs(s.roi)) : "–"),
        el("td", null, s.bets ? `${s.flat_units >= 0 ? "+" : "−"}${num.format(Math.abs(s.flat_units))} u` : "–"));
      table.tBodies[0].append(tr);
    }
    sec.append(table);
    const recent = (T.recent || []).slice(0, 15);
    if (recent.length) {
      const box = el("div", "plines");
      for (const e of recent) {
        const p = el("p", "pline");
        const res = e.status === "settled" ? `${e.actual} (${e.result === "over" ? "plus" : e.result === "under" ? "moins" : "égalité"})` : e.status === "open" ? "en attente" : "annulée";
        const pick = e.pick ? (e.pick === "over" ? "plus" : "moins") + (e.status === "settled" ? (e.result === e.pick ? " ✓" : e.result === "push" ? " =" : " ✗") : "") : "pas de pari";
        p.append(el("strong", null, `${shortDay.format(isoDay(e.date))} · ${e.name} ${STAT_FR[e.stat]} ${num.format(e.line)}`),
          ` : modèle ${pct.format(e.p_over)} plus` + (e.p_over_book != null ? `, bookmaker ${pct.format(e.p_over_book)}` : "") + ` · ${pick} · ${res}`);
        box.append(p);
      }
      sec.append(box);
    }
    sec.append(el("p", "note", "La log-loss compare la probabilité « plus » du modèle à celle du bookmaker (marge retirée) sur les mêmes lignes : plus basse, mieux c'est. Un joueur qui ne joue pas annule la ligne."));
    return sec;
  }


  function render() {
    const list = document.getElementById("list");
    list.textContent = "";
    const gs = DATA.games.filter((g) => filter === "all" || (g.ok && !g.result));
    const g = el("section", "group");
    gs.forEach((x) => g.append(card(x)));
    if (gs.length) list.append(g);
    else list.append(el("p", "empty", DATA.games.length ? "Aucun match pour ce filtre." : (DATA.note || "Aucun match NBA au programme.")));
  }

  function header() {
    document.getElementById("title").textContent = "Pronostics du " + longDay.format(isoDay(DATA.date));
    const upcoming = DATA.games.filter((g) => !g.result);
    const okN = upcoming.filter((g) => g.ok).length;
    const doneN = DATA.games.length - upcoming.length;
    const parts = [`${DATA.games.length} match${DATA.games.length > 1 ? "s" : ""} NBA`];
    if (upcoming.length) parts.push(`${okN} prédiction${okN > 1 ? "s" : ""} fiable${okN > 1 ? "s" : ""} à venir`);
    if (doneN) parts.push(`${doneN} terminé${doneN > 1 ? "s" : ""}`);
    document.getElementById("sub").textContent = DATA.games.length ? parts.join(" · ") : "Aucun match au programme";
    const notice = document.getElementById("notice");
    notice.hidden = !DATA.note;
    if (DATA.note) notice.textContent = DATA.note;
    const foot = document.getElementById("foot");
    foot.textContent = "";
    foot.append(
      el("p", null,
        "Probabilités du modèle clutch : force des équipes recomposée à partir des joueurs disponibles selon le dernier rapport " +
        "officiel de blessures publié avant le match, puis simulation possession par possession. Les lignes de handicap et de total " +
        "sont celles du modèle (sa médiane), pas celles d'un bookmaker." +
        (DATA.data_through ? ` Résultats pris en compte jusqu'au ${fullDay.format(isoDay(DATA.data_through))}.` : "")),
      el("p", null, "« Prudence » signale une prédiction moins sûre : absences importantes, rapport indisponible, début ou fin de saison, désaccord avec l'Elo, play-in ou playoffs."),
      el("p", null, "Mis à jour le " + stamp.format(new Date(DATA.generated_at)) + ".")
    );
  }

  // ------------------------------------------------------------------ Bilan (data/track.json)
  const plural = (n, w) => `${int.format(n)} ${w}${n > 1 ? "s" : ""}`;
  const pctRange = (lo, hi) => `${Math.round(lo * 100)}–${Math.round(hi * 100)} %`;
  const points = (d) => (d > 0 ? "+" : d < 0 ? "−" : "±") + Math.abs(d) + (Math.abs(d) > 1 ? " pts" : " pt");
  const subset = () => (filter === "ok" ? "ok" : "all");

  function periods() {
    const since = TRACK.since ? "Depuis le " + longDay.format(isoDay(TRACK.since)) : "Depuis le début";
    return [["7", "7 derniers jours"], ["30", "30 derniers jours"], ["all", since]];
  }

  function tile(label, s) {
    const t = el("article", "kpi");
    t.append(el("h3", null, label));
    if (!s || !s.n) {
      t.append(el("div", "big muted", "–"), el("div", "kpi-lines", "aucun match joué"));
      return t;
    }
    t.append(el("div", "big", pct.format(s.accuracy)));
    const lines = el("div", "kpi-lines");
    lines.append(el("p", null, `${plural(s.hits, "favori")} vainqueur${s.hits > 1 ? "s" : ""} sur ${int.format(s.n)}`));
    lines.append(el("p", null, `attendu ${pct.format(s.expected)}`));
    lines.append(el("p", "zone", `zone normale ${pctRange(Math.max(0, s.expected - 2 * s.sd), Math.min(1, s.expected + 2 * s.sd))}`));
    const d = Math.round((s.accuracy - s.elo_accuracy) * 100);
    const delta = el("p", "delta " + (d > 0 ? "up" : d < 0 ? "down" : "flat"));
    delta.append(el("strong", null, points(d)), ` vs favori Elo (${pct.format(s.elo_accuracy)})`);
    lines.append(delta);
    t.append(lines);
    return t;
  }

  function dayRows(list) {
    const sec = el("section", "panel days");
    const h = el("h3");
    h.append("Jour par jour", el("span", null, "barre : favoris vainqueurs · trait : attendu"));
    sec.append(h);
    const box = el("div", "rows");
    for (const d of list) {
      const share = d.hits / d.n;
      const r = el("div", "row");
      r.append(el("span", "lab", shortDay.format(isoDay(d.date))));
      const bar = el("span", "bar");
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label", `${d.hits} sur ${d.n} (${pct.format(share)}), attendu ${pct.format(d.expected)}`);
      const fill = el("i");
      fill.style.width = (share * 100).toFixed(1) + "%";
      const tick = el("b", "tick");
      tick.style.left = (d.expected * 100).toFixed(1) + "%";
      bar.append(fill, tick);
      r.append(bar, el("span", "v", `${d.hits}/${d.n}`));
      box.append(r);
    }
    sec.append(box);
    return sec;
  }

  function reference() {
    const R = TRACK.reference || {};
    if (!R.n) return document.createDocumentFragment();
    const sec = el("section", "panel ref");
    sec.append(el("h3", null, "Repère : le test historique"));
    sec.append(el("p", null,
      `Saisons ${R.seasons[0] - 1}-${String(R.seasons[0]).slice(2)} à ${R.seasons[1] - 1}-${String(R.seasons[1]).slice(2)} : ` +
      `${pct1.format(R.accuracy)} de favoris vainqueurs sur ${int.format(R.n)} matchs jamais vus au réglage, contre ` +
      `${pct1.format(R.elo_accuracy)} pour le favori Elo ; log-loss ${ll.format(R.logloss)} contre ${ll.format(R.elo_logloss)}.`));
    return sec;
  }

  function highPanel(S, sub) {
    const key = sub === "ok" ? "ok_high" : "high";
    const sec = el("section", "panel high");
    const h = el("h3");
    h.append("Haute confiance", el("span", null, `le modèle donne au moins ${pct.format(TRACK.high_confidence || 0.75)} au favori`));
    sec.append(h);
    const table = el("table", "detail");
    table.append(el("thead"), el("tbody"));
    const head = el("tr");
    ["Période", "Matchs", "Favoris vainqueurs : modèle", "Favori Elo"].forEach((x) => head.append(el("th", null, x)));
    table.tHead.append(head);
    for (const [pid, label] of periods()) {
      const s = S[pid][key];
      const tr = el("tr");
      tr.append(el("th", null, label));
      if (!s || !s.n) tr.append(el("td", null, "0"), el("td", null, "–"), el("td", null, "–"));
      else tr.append(el("td", null, int.format(s.n)), el("td", null, pct.format(s.accuracy)), el("td", null, pct.format(s.elo_accuracy)));
      table.tBodies[0].append(tr);
    }
    sec.append(table);
    const hc = (TRACK.reference || {}).high;
    if (hc && hc.n) {
      sec.append(el("p", "note", `Test historique : ${pct1.format(hc.accuracy)} sur ${pct.format(hc.share)} des matchs (favori Elo ${pct1.format(hc.elo_accuracy)}).`));
    }
    sec.append(el("p", "note",
      "Sur ces matchs déséquilibrés, le favori Elo fait presque aussi bien : une précision élevée sur une sélection tient surtout " +
      "au choix des matchs. Le modèle se juge sur l'ensemble des pronostics, plus haut."));
    return sec;
  }

  function detailTable(S, sub) {
    const det = el("details", "panel");
    det.append(el("summary", null, "Indicateurs détaillés"));
    const table = el("table", "detail");
    const head = el("tr");
    ["Période", "Matchs", "Favoris : modèle / Elo", "Log-loss : modèle / Elo", "Écart : erreur moy.", "Total du bon côté"].forEach((x) => head.append(el("th", null, x)));
    table.append(el("thead"), el("tbody"));
    table.tHead.append(head);
    for (const [pid, label] of periods()) {
      const s = S[pid][sub];
      const tr = el("tr");
      tr.append(el("th", null, label));
      if (!s || !s.n) {
        tr.append(el("td", null, "0"), el("td", null, "–"), el("td", null, "–"), el("td", null, "–"), el("td", null, "–"));
      } else {
        tr.append(
          el("td", null, int.format(s.n)),
          el("td", null, `${pct.format(s.accuracy)} / ${pct.format(s.elo_accuracy)}`),
          el("td", null, `${ll.format(s.logloss)} / ${ll.format(s.elo_logloss)}`),
          el("td", null, `${num.format(s.mae_margin)} pts`),
          el("td", null, pct.format(s.total_side))
        );
      }
      table.tBodies[0].append(tr);
    }
    det.append(table, el("p", "note",
      "La log-loss mesure la justesse des probabilités elles-mêmes : plus elle est basse, mieux c'est. « Total du bon côté » : " +
      "part des matchs où le total réel est tombé du côté de la ligne du modèle qu'il jugeait le plus probable."));
    return det;
  }

  function renderBilan() {
    const box = document.getElementById("bilan");
    box.textContent = "";
    if (trackState !== "ok") {
      box.append(el("p", "empty", trackState === "loading" ? "Chargement du bilan…" : "Le bilan n'a pas pu être chargé. Réessayez plus tard."));
      return;
    }
    const sub = subset();
    const S = TRACK.stats;
    const total = S.all[sub];
    if (!total || !total.n) {
      box.append(el("p", "empty", `Aucun pronostic${sub === "ok" ? " fiable" : ""} publié n'a encore son résultat. Le bilan se remplit à mesure que les matchs pronostiqués sont joués.`));
      box.append(reference(), ladderBilan(sub), propsBilan());
      return;
    }
    const kpis = el("section", "kpis");
    for (const [pid, label] of periods()) kpis.append(tile(label, S[pid][sub]));
    box.append(kpis, highPanel(S, sub));
    const days = TRACK.days[sub] || [];
    if (days.length) box.append(dayRows(days));
    box.append(reference(), detailTable(S, sub), ladderBilan(sub), propsBilan());
  }

  function bilanHeader() {
    document.getElementById("title").textContent = "Bilan des pronostics";
    document.getElementById("notice").hidden = true;
    const sub = document.getElementById("sub");
    if (trackState !== "ok") sub.textContent = trackState === "loading" ? "Chargement…" : "Bilan indisponible";
    else {
      const c = TRACK.counts || {};
      const scored = (TRACK.stats.all.all || {}).n || 0;
      const parts = [scored ? `${plural(scored, "match")} joué${scored > 1 ? "s" : ""}` : "Aucun match joué pour l'instant"];
      if (c.open) parts.push(`${int.format(c.open)} en attente du résultat`);
      sub.textContent = parts.join(" · ");
    }
    const foot = document.getElementById("foot");
    foot.textContent = "";
    foot.append(
      el("p", null, "Un pronostic compte s'il a été publié avant le coup d'envoi : c'est le dernier affiché avant le match. Les matchs reportés ne sont pas comptés."),
      el("p", null, "« Attendu » est la part de favoris vainqueurs que le modèle prévoyait lui-même ; la zone normale tient compte du hasard. Le favori Elo sert de comparaison.")
    );
    if (trackState === "ok") foot.append(el("p", null, "Mis à jour le " + stamp.format(new Date(TRACK.generated_at)) + "."));
  }

  // ------------------------------------------------------------------ views and filters
  function draw() {
    if (view === "bilan") {
      bilanHeader();
      renderBilan();
    } else if (DATA) {
      header();
      render();
    } else {
      document.getElementById("title").textContent = "Pronostics du jour";
      document.getElementById("sub").textContent = dataState === "error" ? "Impossible de charger les pronostics. Réessayez plus tard." : "Chargement…";
      document.getElementById("foot").textContent = "";
    }
  }

  function setView(v) {
    view = v;
    document.querySelectorAll(".views a").forEach((a) => {
      if (a.dataset.v === v) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    document.getElementById("list").hidden = v !== "day";
    document.getElementById("bilan").hidden = v !== "bilan";
    draw();
  }
  window.addEventListener("hashchange", () => setView(location.hash === "#bilan" ? "bilan" : "day"));
  document.querySelectorAll(".filters button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filters button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      filter = btn.dataset.f;
      draw();
    })
  );

  const getJson = (url) => fetch(url, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  });
  setView(view);
  getJson("data/today.json").then((d) => { DATA = d; dataState = "ok"; }).catch(() => { dataState = "error"; }).finally(() => { if (view === "day") draw(); });
  getJson("data/track.json").then((t) => { TRACK = t; trackState = "ok"; }).catch(() => { trackState = "error"; }).finally(() => { if (view === "bilan") draw(); });
  getJson("data/props_track.json").then((t) => { PROPS = t; }).catch(() => {}).finally(() => { if (view === "bilan" && trackState !== "loading") draw(); });

  // Install: Chrome's prompt when offered, otherwise a hint (Android menu, iOS Share).
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /android/i.test(ua);
  const installBtn = document.getElementById("install");
  const hint = document.getElementById("install-hint");
  const hintText = document.getElementById("install-hint-text");
  let deferredPrompt = null;
  const showHint = (parts) => {
    hintText.textContent = "";
    for (const [text, strong] of parts) hintText.append(strong ? el("strong", null, text) : text);
    hint.hidden = false;
  };
  const ANDROID_HINT = [["Pour installer l'app : menu ", false], ["⋮", true], [" en haut à droite, puis ", false], ["Installer l'application", true], [".", false]];
  const IOS_HINT = [["Pour installer l'app : bouton ", false], ["Partager", true], [" puis ", false], ["Sur l'écran d'accueil", true], [".", false]];
  if (!standalone && store.get("clutch-installed") !== "1") {
    if (android) installBtn.hidden = false;
    if (ios && store.get("clutch-ios-hint") !== "hidden") showHint(IOS_HINT);
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!standalone) installBtn.hidden = false;
  });
  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) { showHint(ANDROID_HINT); return; }
    deferredPrompt.prompt();
    let outcome = "dismissed";
    try { outcome = (await deferredPrompt.userChoice).outcome; } catch { /* ignored */ }
    deferredPrompt = null;
    if (outcome === "accepted") installBtn.hidden = true;
  });
  window.addEventListener("appinstalled", () => { installBtn.hidden = true; hint.hidden = true; store.set("clutch-installed", "1"); });
  document.getElementById("install-hint-close").addEventListener("click", () => { hint.hidden = true; if (ios) store.set("clutch-ios-hint", "hidden"); });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
