/*
 * たてものがたり 「どんな旅か」を表す文の生成
 *
 *   const { describeTrip } = require('./tripText.js');   // ブラウザでは <script> で読み込むと window.TripText
 *   const res = describeTrip([29, 22, 34], tripData, cardsData);
 *   res.title  → "天守と櫓、二つのお城をめぐる旅"
 *   res.text   → 本文（2〜4文）
 *
 * tripData  = data/trip_text.json の中身
 * cardsData = data/cards.json の中身
 * 仕組みと調整のしかたは TRIP_TEXT.md を参照。外部ライブラリは使っていない。
 */
(function (root) {
  'use strict';

  // ---------- 小さな道具
  function lnFact(n) { var s = 0; for (var i = 2; i <= n; i++) s += Math.log(i); return s; }
  var LF = []; for (var i = 0; i <= 60; i++) LF.push(lnFact(i));
  function lnC(n, k) { return (k < 0 || k > n) ? -Infinity : LF[n] - LF[k] - LF[n - k]; }
  // 47枚から n 枚引いたとき、K 枚あるテーマのカードが m 枚以上ふくまれる確率
  function tailP(N, K, n, m) {
    var p = 0, top = Math.min(K, n);
    for (var x = m; x <= top; x++) p += Math.exp(lnC(K, x) + lnC(N - K, n - x) - lnC(N, n));
    return Math.min(1, Math.max(p, 1e-12));
  }
  function rng(seed) { // mulberry32
    var a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function hashIds(ids, extra) { var h = 2166136261; ids.concat([extra || 0]).forEach(function (v) { h ^= v + 1; h = Math.imul(h, 16777619); }); return h >>> 0; }
  function pick(arr, r) { return arr[Math.floor(r() * arr.length) % arr.length]; }
  function fill(s, v) { return s.replace(/\{(\w+)\}/g, function (_, k) { return v[k] != null ? v[k] : ''; }); }

  // ---------- テーマの採点
  function scoreThemes(hand, data, N) {
    var set = {}; hand.forEach(function (i) { set[i] = 1; });
    var n = hand.length, out = [];
    data.themes.forEach(function (t) {
      var matched = t.cards.filter(function (i) { return set[i]; });
      var m = matched.length;
      if (!m) return;
      var ok = m >= t.min_count && (t.requires || []).every(function (rq) {
        return rq.cards.filter(function (i) { return set[i]; }).length >= rq.min;
      });
      var P = tailP(N, t.cards.length, n, m);
      out.push({ theme: t, matched: matched, m: m, ok: ok, P: P, score: t.weight * -Math.log10(P) });
    });
    out.sort(function (a, b) { return b.score - a.score || b.m - a.m; });
    return out;
  }

  // ---------- 部品から本文を組み立てる
  function namesOf(matched, cardById) {
    var top = matched.slice().sort(function (a, b) { return cardById[b].points - cardById[a].points; }).slice(0, 2);
    return { names: top.map(function (i) { return cardById[i].name; }).join('や'), nado: matched.length > 2 ? 'など' : '' };
  }
  function eraSpan(hand, data, cardById) {
    var idx = hand.map(function (i) { return data.era_order.indexOf(cardById[i].era); });
    var lo = Math.min.apply(null, idx), hi = Math.max.apply(null, idx);
    var k = {}; idx.forEach(function (x) { k[x] = 1; });
    if (lo === hi) return null;
    return { old: data.era_name[data.era_order[lo]], new: data.era_name[data.era_order[hi]], k: Object.keys(k).length };
  }

  function buildCandidate(main, subs, hand, data, cardById, r, mix) {
    var tp = data.templates, title, parts = [];
    if (mix && hand.length <= 4) {  // 少ない枚数でばらばら：「見くらべる旅」
      title = pick(tp.few_title, r);
      parts.push(fill(pick(tp.few_lead, r), { labels: mix.map(function (s) { return s.theme.label; }).join('と、') }));
    } else if (mix) {
      title = pick(tp.mix_title, r);
      parts.push(fill(pick(tp.mix_lead, r), { labels: mix.map(function (s) { return s.theme.label + 'も'; }).join('、') }));
    } else {
      title = pick(main.theme.title, r);
      parts.push(pick(main.theme.lead, r));
      parts.push(fill(pick(tp.names, r), namesOf(main.matched, cardById)));
    }
    if (subs.length) parts.push(fill(pick(tp.subs, r), { subs: subs.map(function (s) { return pick(s.theme.sub, r); }).join('、') }));
    var sp = eraSpan(hand, data, cardById);
    if (sp && hand.length >= 3) parts.push(fill(pick(sp.k >= 3 && tp.span_many ? tp.span_many : tp.span, r), sp));  // 2つの時代だけなら「長い時間」とは言わない
    return { title: title, text: parts.join('') };
  }

  function chooseSubs(main, scored, data, usedGroups) {
    var P = data.params, used = {}, subs = [];
    (usedGroups || []).forEach(function (g) { used[g] = 1; });
    if (main) used[main.theme.group] = 1;
    for (var i = 0; i < scored.length && subs.length < P.max_subs; i++) {
      var s = scored[i];
      if (!s.ok || s === main || used[s.theme.group] || s.score < P.sub_min_score) continue;
      used[s.theme.group] = 1; subs.push(s);
    }
    return subs;
  }

  function coverage(hand, list) {
    var c = {}; list.forEach(function (s) { s.matched.forEach(function (i) { c[i] = 1; }); });
    return Object.keys(c).length / hand.length;
  }

  /**
   * @param {number[]} ids     スキャンしたカードの id（ワープは入れない／入っても無視）
   * @param {object} data      trip_text.json
   * @param {object} cardsData cards.json
   * @param {object} [opt]     { mode: 'best'（同じカードなら毎回同じ文） | 'random'（読みこむたびに少し変わる）, seed: 数 }
   */
  function describeTrip(ids, data, cardsData, opt) {
    opt = opt || {};
    var cardById = {}; cardsData.cards.forEach(function (c) { cardById[c.id] = c; });
    var N = cardsData.cards.length, P = data.params, tp = data.templates;
    var hand = ids.filter(function (i, k) { return cardById[i] && ids.indexOf(i) === k; }).sort(function (a, b) { return a - b; });
    if (!hand.length) return null;
    var seed = opt.mode === 'random' ? (opt.seed != null ? opt.seed : Math.floor(Math.random() * 1e9)) : (opt.seed || 0);
    var r = rng(hashIds(hand, seed));
    var scored = scoreThemes(hand, data, N);

    // 1枚だけ：その建物のいちばん特徴的なテーマ＋カードのひとこと
    if (hand.length === 1) {
      var c = cardById[hand[0]], best = scored.filter(function (s) { return s.ok; })[0];  // そろって初めて成り立つテーマは使わない
      return { title: fill(tp.one_title, { name: c.name }),
               text: fill(tp.one_lead, { name: c.name, catch: c.catchphrase }),
               main: best && summary(best), subs: [], alternatives: [] };
    }
    // ぜんぶ
    if (hand.length === N) return { title: tp.all_title, text: tp.all_lead, main: null, subs: [], alternatives: [] };

    // 候補を作る（メインのテーマ × 文の言い回し）
    // メインのテーマは、2枚以上かつ全体の1/4以上にあてはまるものだけ（1枚だけの特徴で旅全体を言い切らない）
    var need = Math.max(P.main_min_count, Math.ceil(hand.length * P.main_min_share));
    var mains = scored.filter(function (s) { return s.ok && s.m >= need && s.score >= P.min_score; }).slice(0, 3);
    var cands = [];
    mains.forEach(function (main, rank) {
      var subs = chooseSubs(main, scored, data);
      for (var v = 0; v < 4; v++) {
        var cr = rng(hashIds(hand, seed * 31 + rank * 7 + v));
        var built = buildCandidate(main, subs, hand, data, cardById, cr, null);
        var used = [main].concat(subs);
        var sc = main.score + 0.5 * subs.reduce(function (a, s) { return a + s.score; }, 0) + 1.5 * coverage(hand, used);
        cands.push({ score: sc, title: built.title, text: built.text, main: main, subs: subs });
      }
    });
    // 枚数が多い・目立つ特徴がないとき：「よくばり」の文も候補に入れる
    if (!mains.length || hand.length >= P.mix_from_cards) {
      var labels = scored.filter(function (s) { return s.ok && s.theme.kind === 'story'; })
        .sort(function (a, b) { return b.m - a.m || b.score - a.score; });
      var lab = [], g = {};
      var covered = {};  // それぞれのことばが、まだ出ていない建物を少なくとも1つ表すように選ぶ
      labels.forEach(function (s) {
        if (lab.length >= 3 || g[s.theme.group] || !s.matched.some(function (i) { return !covered[i]; })) return;
        g[s.theme.group] = 1; lab.push(s); s.matched.forEach(function (i) { covered[i] = 1; });
      });
      var mixSubs = chooseSubs(null, scored.filter(function (s) { return s.theme.kind === 'attr'; }), data);
      var mb = buildCandidate(null, mixSubs, hand, data, cardById, rng(hashIds(hand, seed + 99)), lab);
      cands.push({ score: (mains.length ? mains[0].score : 0) * 0.9 + 1.5 * coverage(hand, lab) + (hand.length >= P.mix_from_cards ? 0.8 : 0),
                   title: mb.title, text: mb.text, main: null, subs: mixSubs, mix: lab });
    }
    cands.sort(function (a, b) { return b.score - a.score; });
    var chosen = cands[0];
    if (opt.mode === 'random') { // 上位の中から、点の高いものほど選ばれやすく
      var top = cands.slice(0, Math.min(P.candidates, cands.length)).filter(function (c) { return c.score >= cands[0].score * 0.7; });
      var w = top.map(function (c) { return c.score * c.score; }), sum = w.reduce(function (a, b) { return a + b; }, 0), x = r() * sum;
      for (var k = 0; k < top.length; k++) { x -= w[k]; if (x <= 0) { chosen = top[k]; break; } }
    }
    var seen = {}, alts = [];
    cands.forEach(function (c) { if (c !== chosen && !seen[c.title] && c.title !== chosen.title && alts.length < 3) { seen[c.title] = 1; alts.push({ title: c.title, text: c.text }); } });
    return { title: chosen.title, text: chosen.text, main: chosen.main && summary(chosen.main),
             subs: chosen.subs.map(summary), mix: chosen.mix && chosen.mix.map(summary), alternatives: alts };
  }
  function summary(s) { return { id: s.theme.id, label: s.theme.label, score: Math.round(s.score * 100) / 100, cards: s.matched }; }

  var api = { describeTrip: describeTrip, scoreThemes: scoreThemes, tailP: tailP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TripText = api;
})(this);
