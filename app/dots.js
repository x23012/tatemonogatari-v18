/* カードの四すみの点（ver18 のカードから）を読む。
 * 左上は点数のマーク。右上に1〜2個、左下に1〜2個、右下に1〜3個の点がある（白い丸の中に点数の色の点）。
 * 点数（色）と、3か所の点の数の組み合わせで、カードが1枚に決まる。
 * どのすみにも「1個目」の点は必ずあるので、点のない左上の向きから、カードの向きも決まる。
 * 位置は cards/<id>.jpg（印刷データの切り出し）の中の割合（0〜1）。 */
'use strict';

const Dots = (() => {
  // すみごとの点の位置（1個目, 2個目, 3個目）
  const SLOTS = {
    TR: [[0.958, 0.026], [0.921, 0.026]],
    BL: [[0.041, 0.942], [0.079, 0.942]],
    BR: [[0.958, 0.942], [0.921, 0.942], [0.958, 0.905]],
  };
  const CORNERS = ['TR', 'BL', 'BR'];
  const OUT = { TR: [1, -1], BL: [-1, 1], BR: [1, 1] };          // すみの方向（u, v）
  const R_DOT = 0.0072, R_RING0 = 0.0113, R_RING1 = 0.0133;   // 点の半径・まわりの白い丸（細い輪：半径 1.0〜1.45%）
  const DOT_R = 0.0096;                                         // 点の半径（実測）
  let SEARCH = 0.045;                                           // 位置合わせで探す広さ（カードに対して）
  const MIN_PX = 1.6;                                           // 点がこれより小さく写っていたら読まない（半径 px）

  let codes = new Map();
  /** list: [{id, dots:[右上,左下,右下]}] */
  function setCodes(list) {
    codes = new Map();
    for (const c of list) if (Array.isArray(c.dots)) codes.set(c.id, c.dots);
  }
  const codeOf = id => codes.get(id);

  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  const t = [0, 0, 0];

  /** 左上の点数マークの色（白い数字をさけて、暗い方から6割の平均） */
  function badgeColor(get) {
    const vals = [];
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      get(0.05 + (i + 0.5) / 8 * 0.12, 0.035 + (j + 0.5) / 8 * 0.12, t);
      vals.push([t[0], t[1], t[2], t[0] + t[1] + t[2]]);
    }
    vals.sort((a, b) => a[3] - b[3]);
    const keep = vals.slice(0, 38), m = [0, 0, 0];
    keep.forEach(v => { m[0] += v[0]; m[1] += v[1]; m[2] += v[2]; });
    return m.map(x => x / keep.length);
  }
  const chroma = ([r, g, b]) => { const s = r + g + b + 1; return [r / s, g / s]; };
  const isGray = c => Math.max(...c) - Math.min(...c) < 40;

  /** 1つの位置の「点らしさ」：まわりの細い白い輪の明るさ − 中の点の明るさ。
   * 中の色が点数マークの色（ref）とちがえば点ではない */
  function slotScore(get, u, v, ref) {
    let cr = 0, cg = 0, cb = 0, cn = 0, ring = 0, rn = 0;
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2;
      for (const rr of [0, R_DOT * 0.5, R_DOT]) {
        if (rr === 0 && k) continue;
        get(u + Math.cos(a) * rr, v + Math.sin(a) * rr, t); cr += t[0]; cg += t[1]; cb += t[2]; cn++;
      }
      for (const rr of [R_RING0, R_RING1]) {
        get(u + Math.cos(a) * rr, v + Math.sin(a) * rr, t); ring += lum(t[0], t[1], t[2]); rn++;
      }
    }
    const c = [cr / cn, cg / cn, cb / cn];
    let d = ring / rn - lum(c[0], c[1], c[2]);
    if (ref) {
      if (isGray(ref)) d *= isGray(c) ? Math.max(0, Math.min(1, (150 - lum(c[0], c[1], c[2])) / 60)) : 0.3;
      else { const a = chroma(c), b = chroma(ref); d *= Math.max(0, 1 - Math.hypot(a[0] - b[0], a[1] - b[1]) / 0.12); }
    }
    return { d };
  }

  /** すみ1つを読む。1個目の点を基準に、少しずれていても合わせる */
  function readCorner(get, name, ref) {
    const slots = SLOTS[name];
    // 位置合わせ：見本との重ね合わせが数%ずれていても合うように、広く粗く探してから細かく
    // 1個目の点は、いちばんすみ寄りの点。はっきりした点のうち、すみにいちばん近い位置を選ぶ（2個目の点と取りちがえない）
    let best = null;
    const tryAt = (dx, dy) => { const s0 = slotScore(get, slots[0][0] + dx, slots[0][1] + dy, ref); if (!best || s0.d > best.s[0].d) best = { dx, dy, s: [s0] }; };
    const coarse = [];
    for (let dy = -SEARCH; dy <= SEARCH + 1e-9; dy += 0.003) for (let dx = -SEARCH; dx <= SEARCH + 1e-9; dx += 0.003)
      coarse.push({ dx, dy, d: slotScore(get, slots[0][0] + dx, slots[0][1] + dy, ref).d });
    const top = Math.max(...coarse.map(c => c.d)), [su, sv] = OUT[name];
    const pick = coarse.filter(c => c.d >= top * 0.65).sort((a, b) => (su * b.dx + sv * b.dy) - (su * a.dx + sv * a.dy))[0];
    const cx = pick.dx, cy = pick.dy;
    for (let dy = -0.0045; dy <= 0.0046; dy += 0.0015) for (let dx = -0.0045; dx <= 0.0046; dx += 0.0015) tryAt(cx + dx, cy + dy);
    const { dx, dy } = best;
    // 2個目・3個目も、すこしだけ位置を合わせて、いちばん点らしい所で判断する
    for (let k = 1; k < slots.length; k++) {
      let m = null;
      for (let ey = -0.0045; ey <= 0.0046; ey += 0.0015) for (let ex = -0.0045; ex <= 0.0046; ex += 0.0015) {
        const r = slotScore(get, slots[k][0] + dx + ex, slots[k][1] + dy + ey, ref); if (!m || r.d > m.d) m = r;
      }
      best.s.push(m);
    }
    const s = best.s.map(x => x.d), first = s[0];
    if (first < 25) return { count: 0, conf: 0, first };
    // 点がある位置は、1個目と同じくらいの明暗差になる
    let count = 1;
    for (let k = 1; k < s.length; k++) { if (s[k] > first * 0.5) count = k + 1; else break; }
    let conf = Math.min(1, (first - 25) / 60 + 0.4);
    for (let k = 1; k < s.length; k++) conf = Math.min(conf, Math.abs(s[k] - first * 0.5) / (first * 0.5));
    return { count, conf: Math.max(0, Math.min(1, conf)), first, dx, dy, s };
  }

  /** get(u,v,out): カード座標の色。cardPx: カード1枚が写っている大きさ（px） */
  function read(get, cardPx) {
    if (cardPx * DOT_R < MIN_PX) return { code: null, conf: 0, quality: 0, small: true };
    const ref = badgeColor(get);
    const r = CORNERS.map(n => readCorner(get, n, ref));
    return { code: r.map(x => x.count), conf: Math.min(...r.map(x => x.conf)), quality: Math.min(...r.map(x => x.first)) };
  }

  /** 4つの向きを試す。rot(k) は k×90° 回したカード座標の読み方。いちばん点がはっきりした向きを返す */
  function readAnyOrientation(getFor, cardPx, ks = [0, 1, 2, 3]) {
    let best = null;
    for (const k of ks) {
      const r = read(getFor(k), cardPx); r.k = k;
      if (!best || r.conf * 100 + r.quality > best.conf * 100 + best.quality) best = r;
    }
    return best;
  }

  /** RGBA配列 px（N×N）をカード座標で読む関数にする */
  function getter(px, N) {
    return (u, v, out) => {
      let x = u * N - 0.5, y = v * N - 0.5;
      x = Math.max(0, Math.min(N - 1.001, x)); y = Math.max(0, Math.min(N - 1.001, y));
      const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi;
      const i00 = (yi * N + xi) * 4, i10 = i00 + 4, i01 = i00 + N * 4, i11 = i01 + 4;
      for (let c = 0; c < 3; c++) out[c] = (px[i00 + c] * (1 - fx) + px[i10 + c] * fx) * (1 - fy) + (px[i01 + c] * (1 - fx) + px[i11 + c] * fx) * fy;
    };
  }
  /** カード座標を k×90°（時計回り）回して読む */
  const rotate = (get, k) => (u, v, out) => {
    for (let i = 0; i < k; i++) { const nu = 1 - v, nv = u; u = nu; v = nv; }
    get(u, v, out);
  };

  /** 候補の並びを、点の数で並べかえる。数が合わない候補を後ろへ */
  function rerank(cands, st, weight = 1.5) {
    if (!st || !st.code || !(st.conf > 0.55) || !(st.quality >= 35)) return cands;   // 自信があるときだけ使う（テストで、まちがいはどれも自信が低かった）
    const out = cands.map(c => {
      const code = codeOf(c.id);
      if (!code) return c.id === 'warp' ? { ...c, d: c.d + weight * st.conf, dotMiss: 3 } : c;   // ワープには点がない
      const miss = code.reduce((a, n, i) => a + (n !== st.code[i]), 0);
      return { ...c, d: c.d + miss * weight * st.conf, dotMiss: miss };
    });
    return out.sort((a, b) => a.d - b.d);
  }

  return { setSearch: v => { SEARCH = v; }, read, readAnyOrientation, readCorner, getter, rotate, rerank, setCodes, codeOf, SLOTS, DOT_R, MIN_PX };
})();
