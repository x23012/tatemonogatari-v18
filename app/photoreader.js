/* 写真1枚から、並べたカードとスタンプ（月の数字）をまとめて読む。
 * 1) スタンプ（白い紙の上の色つきの丸＋白い数字）を探す
 * 2) 丸の中の数字（1〜12）を読む
 * 3) スタンプのまわりのカードの輪郭を探し、向きをそろえる
 * 4) スタンプで隠れた所をのぞいて、点数の色と写真の模様でカードを見分け、四すみの点の数で確かめる */
'use strict';

const PhotoReader = (() => {
  const WORK = 1600;   // 処理する画像の長い辺(px)
  // ワープ（ほぼ無地）は、写りの悪いカードとまちがえやすいので、少しだけ選ばれにくくする。
  // 0.6 だとワープ自身を読み落とした。0.4 は、試験用写真6枚のワープ6/6・ほかをワープとまちがえ0、実写真3枚でワープとまちがえ1/32（0.6 と同じ）
  const OPT = { warpPenalty: 0.4 };

  /* ---------- 画像の準備 ---------- */
  async function loadImage(file) {
    const url = typeof file === 'string' ? file : URL.createObjectURL(file);
    try {
      if (window.createImageBitmap && typeof file !== 'string') {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      }
      return await new Promise((ok, ng) => { const im = new Image(); im.onload = () => ok(im); im.onerror = ng; im.src = url; });
    } finally { if (typeof file !== 'string') setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  function toCanvas(img) {
    const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
    const k = Math.min(1, WORK / Math.max(w0, h0));
    const c = document.createElement('canvas'); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  /* ---------- 色の計算 ---------- */
  function sv(px, n) {
    // 色あい（H）は使わないので、あざやかさ（S）と明るさ（V）だけ
    const S = new Float32Array(n), V = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = px[i * 4] / 255, g = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      V[i] = mx; S[i] = mx ? (mx - mn) / mx : 0;
    }
    return { S, V };
  }
  const isWhite = (S, V, i) => V[i] > 0.62 && S[i] < 0.22;          // 数字の白（にじみ込み）
  let paperV = 0.8;                                                   // スタンプの白い紙の明るさ（read で机の明るさから決める）

  /** 連結成分（4近傍）。mask: Uint8Array → ラベル配列と各成分の情報 */
  function components(mask, w, h, minPx, maxPx) {
    const lab = new Int32Array(w * h), out = [], stack = new Int32Array(w * h);
    let id = 0;
    for (let s = 0; s < w * h; s++) {
      if (!mask[s] || lab[s]) continue;
      id++; let sp = 0; stack[sp++] = s; lab[s] = id;
      let n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, sx = 0, sy = 0;
      while (sp) {
        const p = stack[--sp], x = p % w, y = (p / w) | 0;
        n++; sx += x; sy += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && !lab[p - w]) { lab[p - w] = id; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !lab[p + w]) { lab[p + w] = id; stack[sp++] = p + w; }
      }
      if (n >= minPx && n <= maxPx) out.push({ id, n, x0, y0, x1, y1, cx: sx / n, cy: sy / n });
    }
    return { lab, comps: out };
  }

  /* ---------- 1) スタンプを探す ---------- */
  function findStamps(px, w, h, C, dbg) {
    const n = w * h, { S, V } = C;
    // 丸の候補：スタンプの白い紙「ではない」所。白い紙に囲まれた丸は、机やカードとつながらず小さな成分になる
    // （写真によって黒は灰色に、ピンクは白っぽく写るので、色の濃さでは決めない）
    // 写りかたで見つけやすさが変わるので、3つの見方で探してまとめる
    const rules = [
      i => (S[i] > 0.38 && V[i] > 0.28) || V[i] < 0.3,        // あざやかな色・黒
      i => V[i] < 0.47 && S[i] < 0.5,                          // 灰色っぽく写った黒
      i => !(V[i] >= paperV - 0.04 && S[i] < 0.25),            // 白い紙以外（白っぽく写ったピンクなど）
    ];
    const all = [];
    for (const rule of rules) {
      const mask = new Uint8Array(n);
      for (let i = 0; i < n; i++) mask[i] = rule(i) ? 1 : 0;
      for (const st of stampsFromMask(px, w, h, C, mask, dbg)) {
        const same = all.find(o => o.color === st.color && Math.hypot(o.cx - st.cx, o.cy - st.cy) < Math.max(o.r, st.r));
        if (!same) all.push(st);
        else if (st.white > same.white + 0.2) Object.assign(same, st);   // 先の見方を優先（後の見方は丸がとなりとつながりやすい）
      }
    }
    return all;
  }
  function stampsFromMask(px, w, h, C, mask, dbg) {
    const { S, V } = C;
    const side = Math.max(w, h);
    const { lab, comps } = components(mask, w, h, Math.pow(side / 160, 2), Math.pow(side / 12, 2));
    const stamps = [];
    for (const c of comps) {
      const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
      const rej = why => { if (dbg) dbg.push({ why, x: (c.x0 + c.x1) / 2 | 0, y: (c.y0 + c.y1) / 2 | 0, bw, bh, n: c.n }); };
      if (bw < 6 || bh < 6 || bw / bh > 1.35 || bh / bw > 1.35) { rej('shape'); continue; }
      const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2, r = (bw + bh) / 4;
      // 円の中：丸の色か白（数字）でうまっている／円の外（四角のすみ）：丸の色が少ない
      let inN = 0, inFill = 0, inComp = 0, outN = 0, outComp = 0;
      for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
        const i = y * w + x, d = Math.hypot(x - cx, y - cy) / r;
        const mine = lab[i] === c.id;
        if (d < 0.92) { inN++; if (mine) inComp++; if (mine || isWhite(S, V, i)) inFill++; }
        else if (d > 1.12) { outN++; if (mine) outComp++; }
      }
      if (!inN || inFill / inN < 0.86 || inComp / inN < 0.4 || inComp / inN > 0.995) { rej(`fill ${(inFill / inN).toFixed(2)} comp ${(inComp / inN).toFixed(2)}`); continue; }
      if (outN && outComp / outN > 0.2) { rej(`out ${(outComp / outN).toFixed(2)}`); continue; }
      // 白さの基準：丸の中の白い数字は、まわりの紙と同じ白で、同じ明るさの所にある。
      // 照明のむら（影）で紙が暗く写っても、数字と同じくらいの明るさなら紙とみなす
      const dv = [];
      for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
        const i = y * w + x;
        if (lab[i] !== c.id && Math.hypot(x - cx, y - cy) / r < 0.8 && S[i] < 0.3) dv.push(V[i]);
      }
      let pv = paperV;
      if (dv.length >= 4) { dv.sort((a, b) => b - a); pv = Math.max(0.55, Math.min(paperV, dv[Math.floor(dv.length * 0.25)] - 0.08)); }
      const isPaper = (S, V, i) => V[i] >= pv && S[i] < 0.3;
      // まわりの輪：白い紙
      let ringN = 0, ringW = 0;
      for (let k = 0; k < 48; k++) {
        const a = k / 48 * Math.PI * 2;
        for (const rr of [1.22, 1.38]) {
          const x = Math.round(cx + Math.cos(a) * r * rr), y = Math.round(cy + Math.sin(a) * r * rr);
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          ringN++; if (isPaper(S, V, y * w + x)) ringW++;
        }
      }
      let pr = 0, pg = 0, pb = 0;
      for (let k = 0; k < 48; k++) { const a = k / 48 * Math.PI * 2; const x = Math.round(cx + Math.cos(a) * r * 1.3), y = Math.round(cy + Math.sin(a) * r * 1.3); if (x < 0 || y < 0 || x >= w || y >= h) continue; const i = y * w + x; if (isPaper(S, V, i)) { pr += px[i * 4]; pg += px[i * 4 + 1]; pb += px[i * 4 + 2]; } }
      if (!ringN || ringW / ringN < 0.2) { rej(`ring ${(ringW / ringN).toFixed(2)}`); continue; }
      // 丸の色（平均）
      let r0 = 0, g0 = 0, b0 = 0, m = 0;
      for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
        const i = y * w + x; if (lab[i] !== c.id) continue;
        r0 += px[i * 4]; g0 += px[i * 4 + 1]; b0 += px[i * 4 + 2]; m++;
      }
      const rgb = [r0 / m, g0 / m, b0 / m];
      stamps.push({ cx, cy, r, rgb, color: colorName(rgb), white: ringW / ringN, paper: ringW ? [pr, pg, pb] : null });
    }
    return stamps;
  }
  function colorName([r, g, b]) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (mx < 115 || d / (mx || 1) < 0.1) return 'black';
    let h = 0;
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    if (h < 20 || h >= 345) return 'red';
    if (h < 70) return 'yellow';
    if (h < 170) return 'green';
    if (h < 255) return 'blue';
    if (h < 275) return 'purple';
    return 'pink';
  }

  /* ---------- 2) 数字を読む ---------- */
  const G = 28;                       // 数字を比べるマスの数
  let digitTemplates = null;
  // スタンプの数字に近い丸ゴシック。どのスマホでも同じ形になるよう Google Fonts の M PLUS Rounded 1c を使う（読めないときは端末の丸ゴシック）
  let DIGIT_FONT = { weight: 400, family: '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", sans-serif', size: 0.53, squeeze: 0.88 };
  function makeDigitTemplates() {
    const big = document.createElement('canvas'); big.width = big.height = G * 4;
    const bx = big.getContext('2d', { willReadFrequently: true });
    const out = [];
    for (let num = 1; num <= 12; num++) {
      for (let deg = 0; deg < 360; deg += 10) {
        bx.fillStyle = '#000'; bx.fillRect(0, 0, G * 4, G * 4);
        bx.save(); bx.translate(G * 2, G * 2); bx.rotate(deg * Math.PI / 180);
        bx.fillStyle = '#fff'; bx.textAlign = 'center'; bx.textBaseline = 'middle';
        const s = String(num);
        bx.font = `${DIGIT_FONT.weight} ${G * 4 * DIGIT_FONT.size}px ${DIGIT_FONT.family}`;
        if (s.length === 2) bx.scale(DIGIT_FONT.squeeze, 1);
        bx.fillText(s, 0, G * 4 * 0.03); bx.restore();
        const d = bx.getImageData(0, 0, G * 4, G * 4).data, v = new Float32Array(G * G);
        for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
          let t = 0; for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) t += d[((y * 4 + yy) * G * 4 + x * 4 + xx) * 4];
          v[y * G + x] = t / 16 / 255;
        }
        out.push({ num, deg, v: zscore(v) });
      }
    }
    return out;
  }
  function zscore(v) {
    let s = 0, s2 = 0; const n = v.length;
    for (let i = 0; i < n; i++) { s += v[i]; s2 += v[i] * v[i]; }
    const m = s / n, sd = Math.sqrt(Math.max(s2 / n - m * m, 1e-6));
    const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = (v[i] - m) / sd;
    return o;
  }
  /** 丸の中の「白さ」を G×G に取り出す（丸の外は0） */
  function stampPatch(px, w, h, st) {
    const v = new Float32Array(G * G), base = st.rgb;
    const span = st.r * 0.86;
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const u = (x + 0.5) / G * 2 - 1, q = (y + 0.5) / G * 2 - 1;
      if (u * u + q * q > 1) continue;
      let t = 0;
      for (let k = 0; k < 4; k++) {   // 4点の平均
        const fx = st.cx + (u + (k & 1 ? 0.25 : -0.25) / G * 2) * span, fy = st.cy + (q + (k & 2 ? 0.25 : -0.25) / G * 2) * span;
        const ix = Math.min(w - 1, Math.max(0, Math.round(fx))), iy = Math.min(h - 1, Math.max(0, Math.round(fy)));
        const i = (iy * w + ix) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
        // 丸の色から白へのどこにいるか（0=丸の色, 1=白）
        const num = (r - base[0]) * (255 - base[0]) + (g - base[1]) * (255 - base[1]) + (b - base[2]) * (255 - base[2]);
        const den = (255 - base[0]) ** 2 + (255 - base[1]) ** 2 + (255 - base[2]) ** 2 + 1;
        t += Math.max(0, Math.min(1, num / den));
      }
      v[y * G + x] = t / 4;
    }
    return v;
  }
  /** 数字を読む。プレイヤーの向き（写真の上・右・下・左）ごとに、各数字のいちばん良い一致を出しておく。
   * 向きは read() でスタンプ全体から決める（6と9を見分けるため、向きは ±80° の範囲で試す） */
  const VIEWS4 = [0, 90, 180, 270];
  function readNumber(px, w, h, st) {
    if (!digitTemplates) digitTemplates = makeDigitTemplates();
    const p = zscore(stampPatch(px, w, h, st));
    const byView = VIEWS4.map(() => ({}));
    for (const t of digitTemplates) {
      let c = 0; for (let i = 0; i < p.length; i++) c += p[i] * t.v[i];
      c /= p.length;
      VIEWS4.forEach((v, k) => {
        const dd = Math.abs(((t.deg - v + 540) % 360) - 180);
        if (dd <= 80 && (byView[k][t.num] === undefined || c > byView[k][t.num])) byView[k][t.num] = c;
      });
    }
    return { byView, ...pickView({ byView }, 0) };
  }
  /** 数字は元の大きさの写真から読む（遠くから撮ってスタンプが小さく写っても、数字の形が残るように）。
   * スタンプのまわりだけを切り出し、丸の半径が HR px になるように大きくしてから readNumber にかける */
  const HR = 40, HS = Math.ceil(HR * 2.6);
  const hCanvas = document.createElement('canvas'); hCanvas.width = hCanvas.height = HS;
  const hCtx = hCanvas.getContext('2d', { willReadFrequently: true });
  function readNumberHi(img, f, st) {
    if (!img || !(f > 1.05)) return null;               // 元の写真が縮めた写真より大きいときだけ
    const R = st.r * 1.3;                                // 切り出す半径（縮めた写真の座標）
    hCtx.imageSmoothingQuality = 'high';
    hCtx.clearRect(0, 0, HS, HS);
    hCtx.drawImage(img, (st.cx - R) * f, (st.cy - R) * f, 2 * R * f, 2 * R * f, 0, 0, HS, HS);
    const px = hCtx.getImageData(0, 0, HS, HS).data;
    return readNumber(px, HS, HS, { ...st, cx: HS / 2, cy: HS / 2, r: st.r * HS / (2 * R) });
  }
  function pickView(num, k) {
    const all = num.byView[k];
    const list = Object.entries(all).map(([n, sc]) => ({ num: +n, score: sc })).sort((a, b) => b.score - a.score);
    return { view: k, all, num: list[0].num, score: list[0].score, alts: list.slice(1, 4).map(e => e.num), margin: list[0].score - list[1].score };
  }
  /** スタンプ全部の一致がいちばん良くなる向き＝プレイヤーの向き */
  function chooseView(items) {
    const tot = VIEWS4.map((_, k) => items.reduce((a, it) => a + Math.max(...Object.values(it.number.byView[k])), 0));
    return tot.indexOf(Math.max(...tot));
  }

  /* ---------- 3) スタンプのまわりのカードを探す ---------- */
  function tableColor(px, w, h) {
    // いちばん多い色（机）を、粗いヒストグラムで
    const bins = new Map();
    for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
      const i = (y * w + x) * 4, k = (px[i] >> 4) << 8 | (px[i + 1] >> 4) << 4 | (px[i + 2] >> 4);
      bins.set(k, (bins.get(k) || 0) + 1);
    }
    let bk = 0, bn = 0; for (const [k, n] of bins) if (n > bn) { bn = n; bk = k; }
    // そのビンに近い色の平均
    const c0 = [((bk >> 8) & 15) * 16 + 8, ((bk >> 4) & 15) * 16 + 8, (bk & 15) * 16 + 8];
    let r = 0, g = 0, b = 0, m = 0;
    for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
      const i = (y * w + x) * 4;
      if (Math.abs(px[i] - c0[0]) + Math.abs(px[i + 1] - c0[1]) + Math.abs(px[i + 2] - c0[2]) < 60) { r += px[i]; g += px[i + 1]; b += px[i + 2]; m++; }
    }
    return [r / m, g / m, b / m];
  }

  /** 机の色とちがう所（＝カード）のうち、スタンプからつながっている部分 → 最小の外接長方形 */
  function findCard(px, w, h, st, table) {
    const R = st.r * 6.2;                         // 探す範囲（カードの半分の対角よりすこし大きく）
    const x0 = Math.max(0, Math.floor(st.cx - R)), y0 = Math.max(0, Math.floor(st.cy - R));
    const x1 = Math.min(w - 1, Math.ceil(st.cx + R)), y1 = Math.min(h - 1, Math.ceil(st.cy + R));
    const ww = x1 - x0 + 1, hh = y1 - y0 + 1;
    const m = new Uint8Array(ww * hh);
    for (let y = 0; y < hh; y++) for (let x = 0; x < ww; x++) {
      const i = ((y + y0) * w + x + x0) * 4;
      const d = Math.abs(px[i] - table[0]) + Math.abs(px[i + 1] - table[1]) + Math.abs(px[i + 2] - table[2]);
      m[y * ww + x] = d > 70 ? 1 : 0;
    }
    // 小さなすき間をうめる（3×3で閉じる）
    const m2 = dilate(m, ww, hh), m3 = erode(m2, ww, hh);
    // スタンプの中心からつながる部分
    const seed = (Math.round(st.cy - y0)) * ww + Math.round(st.cx - x0);
    const reg = new Uint8Array(ww * hh), stack = [seed]; reg[seed] = 1; m3[seed] = 1;
    const pts = [];
    while (stack.length) {
      const p = stack.pop(), x = p % ww, y = (p / ww) | 0;
      pts.push(x, y);
      const nb = [x > 0 ? p - 1 : -1, x < ww - 1 ? p + 1 : -1, y > 0 ? p - ww : -1, y < hh - 1 ? p + ww : -1];
      for (const q of nb) if (q >= 0 && m3[q] && !reg[q]) {
        const qx = q % ww, qy = (q / ww) | 0;
        if (Math.hypot(qx + x0 - st.cx, qy + y0 - st.cy) > R) continue;
        reg[q] = 1; stack.push(q);
      }
    }
    const rect = minAreaRect(pts, x0, y0);
    const expect = st.r * 6.4;                    // スタンプの大きさから見たカードの大きさ
    let side = Math.max(rect.w, rect.h), ok = true;
    if (side > expect * 1.45 || side < expect * 0.6 || Math.min(rect.w, rect.h) < side * 0.7) ok = false;
    if (!ok) return { cx: st.cx, cy: st.cy, side: expect, angle: rect.angle, guessed: true };
    return { cx: rect.cx, cy: rect.cy, side, angle: rect.angle, guessed: false };
  }
  function dilate(m, w, h) { const o = new Uint8Array(m.length); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let dy = -1; dy <= 1 && !v; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && m[yy * w + xx]) { v = 1; break; } } o[y * w + x] = v; } return o; }
  function erode(m, w, h) { const o = new Uint8Array(m.length); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 1; for (let dy = -1; dy <= 1 && v; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h || !m[yy * w + xx]) { v = 0; break; } } o[y * w + x] = v; } return o; }

  /** 点の集まりの、いちばん小さい外接長方形（凸包＋回転） */
  function minAreaRect(pts, ox, oy) {
    const P = [];
    for (let i = 0; i < pts.length; i += 2) P.push([pts[i] + ox, pts[i + 1] + oy]);
    const hull = convexHull(P);
    let best = null;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(ang), s = Math.sin(ang);
      let mnu = Infinity, mxu = -Infinity, mnv = Infinity, mxv = -Infinity;
      for (const p of hull) { const u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c; if (u < mnu) mnu = u; if (u > mxu) mxu = u; if (v < mnv) mnv = v; if (v > mxv) mxv = v; }
      const area = (mxu - mnu) * (mxv - mnv);
      if (!best || area < best.area) {
        const cu = (mnu + mxu) / 2, cv = (mnv + mxv) / 2;
        best = { area, w: mxu - mnu, h: mxv - mnv, angle: ang, cx: cu * c - cv * s, cy: cu * s + cv * c };
      }
    }
    if (!best) return { w: 0, h: 0, angle: 0, cx: 0, cy: 0 };
    // 角度は -45°〜45° にそろえる（向きは見分けるときに4通り試す）
    let a = best.angle; while (a > Math.PI / 4) a -= Math.PI / 2; while (a < -Math.PI / 4) a += Math.PI / 2;
    best.angle = a;
    return best;
  }
  function convexHull(P) {
    if (P.length < 3) return P;
    P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    up.pop(); lo.pop(); return lo.concat(up);
  }

  /* ---------- 4) カードを見分ける ---------- */
  function identify(px, w, h, card, st) {
    const results = [], ks = [0, 1, 2, 3];   // ver18 は帯がないので、4つの向きを全部試す
    for (const scale of [0.88, 0.94, 1.0]) for (const k of ks) for (const [dx, dy] of [[0, 0], [0.025, 0], [-0.025, 0], [0, 0.025], [0, -0.025]]) {
      const ang = card.angle + k * Math.PI / 2, side = card.side * scale;
      const c = Math.cos(ang), s = Math.sin(ang);
      const cx = card.cx + (dx * c - dy * s) * card.side, cy = card.cy + (dx * s + dy * c) * card.side;
      // カード座標(u,v) → 画像座標
      const map = (u, v) => [cx + ((u - 0.5) * c - (v - 0.5) * s) * side, cy + ((u - 0.5) * s + (v - 0.5) * c) * side];
      // スタンプの位置をカード座標に
      const ex = st.cx - cx, ey = st.cy - cy;
      const su = 0.5 + (ex * c + ey * s) / side, sv = 0.5 + (-ex * s + ey * c) / side, sr = st.r * 1.95 / side;
      const masked = (u, v) => Math.hypot(u - su, v - sv) < sr;
      const raw = CardMatcher.rawFeatures(px, w, h, map, masked);
      for (const r of CardMatcher.compareRaw(raw)) results.push({ ...r, k, scale, cx, cy, side, angle0: card.angle });
    }
    const best = new Map();
    for (const r of results) { if (r.id === 'warp') r.d += OPT.warpPenalty; const cur = best.get(r.id); if (!cur || r.d < cur.d) best.set(r.id, r); }
    return [...best.values()].sort((a, b) => a.d - b.d);
  }

  /** 四すみの点を読む（dots.js）。見本と重なった位置で、元の大きさの写真から切り出す。
   * 4つの向きを試し、点がはっきり見える向き（点のないすみ＝左上）を選ぶ */
  const SN = 320, sCanvas = document.createElement('canvas');
  sCanvas.width = sCanvas.height = SN;
  const sCtx = sCanvas.getContext('2d', { willReadFrequently: true });
  function readDots(img, f, top) {
    if (typeof Dots === 'undefined') return null;
    const ang = top.angle0 + top.k * Math.PI / 2;
    sCtx.setTransform(1, 0, 0, 1, 0, 0); sCtx.clearRect(0, 0, SN, SN);
    sCtx.translate(SN / 2, SN / 2); sCtx.rotate(-ang); sCtx.scale(SN / (top.side * f), SN / (top.side * f));
    sCtx.imageSmoothingQuality = 'high';
    sCtx.drawImage(img, -top.cx * f, -top.cy * f);
    sCtx.setTransform(1, 0, 0, 1, 0, 0);
    const get = Dots.getter(sCtx.getImageData(0, 0, SN, SN).data, SN);
    const r = Dots.readAnyOrientation(k => Dots.rotate(get, k), top.side * f);
    r.k = (top.k + r.k) % 4;
    return r;
  }

  /** カードの切り抜き（確認画面用） */
  function cropCard(canvas, card, k) {
    const out = document.createElement('canvas'); out.width = out.height = 160;
    const x = out.getContext('2d');
    x.translate(80, 80); x.rotate(-(card.angle + k * Math.PI / 2)); x.scale(160 / card.side, 160 / card.side);
    x.drawImage(canvas, -card.cx, -card.cy);
    return out;
  }

  /* ---------- まとめ ---------- */
  async function read(file, onStep = () => {}) {
    try { await document.fonts.load('400 40px "M PLUS Rounded 1c"', '0123456789'); } catch { /* オフラインなど */ }
    onStep('写真を準備しているよ');
    const img = await loadImage(file);
    const canvas = toCanvas(img), w = canvas.width, h = canvas.height;
    const f = (img.width || img.naturalWidth) / w;   // 元の写真は何倍か
    const px = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    await tick(); onStep('スタンプを探しているよ');
    const C = sv(px, w * h);
    const table = tableColor(px, w, h);
    setPaperFromTable(table);
    const stamps = findStamps(px, w, h, C);
    await tick(); onStep('数字とカードを読んでいるよ');
    const items = [];
    const wb = whiteBalanced(px, stamps);
    for (const st of stamps) {
      const num = readNumberHi(img, f, st) || readNumber(px, w, h, st);
      const card = findCard(px, w, h, st, table);
      let cands = identify(wb, w, h, card, st);
      // 四すみの点の数（元の大きさの写真から読む）で、候補を並べかえる
      const dots = cands[0] ? readDots(img, f, cands[0]) : null;
      // 模様の見分けが接戦のときだけ使う（点は小さく、写真ではたまに読みまちがえるので）
      if (dots && cands[1] && cands[1].d - cands[0].d < 1.0) cands = Dots.rerank(cands, dots);
      const top = cands[0];
      const k = top ? (dots && dots.conf > 0.55 ? dots.k : top.k) : 0;
      items.push({ stamp: st, number: num, card, dots, cands: cands.slice(0, 5), id: top ? top.id : null, d: top ? top.d : 99, margin: cands[1] ? cands[1].d - top.d : 1, crop: cropCard(canvas, card, k) });
      await tick();
    }
    // プレイヤーの向きは色ごとに（向かいの人のスタンプが写っていることもある）
    const byColor = new Map();
    for (const it of items) { const k = it.stamp.color; if (!byColor.has(k)) byColor.set(k, []); byColor.get(k).push(it); }
    for (const list of byColor.values()) {
      const v = chooseView(list);
      list.forEach(it => Object.assign(it.number, pickView(it.number, v)));
    }
    // 点数のマーク（例：1てんの緑の四角）がスタンプと同じ色だと、まちがえて拾うことがある。
    // スタンプの丸はみな同じ大きさなので、同じ色のほかのスタンプよりずっと小さく、
    // しかもまわりが白い紙でない・数字が読みにくいものはのぞく
    const smallFake = it => {
      const same = items.filter(o => o.stamp.color === it.stamp.color && o !== it).map(o => o.stamp.r).sort((a, b) => a - b);
      if (same.length < 2) return false;
      const med = same[same.length >> 1];
      return it.stamp.r < med * 0.72 && (it.stamp.white < 0.5 || it.number.score < 0.75);
    };
    const kept = items.filter(it => it.number.score > 0.18 && !smallFake(it));   // 数字がまったく読めない丸もスタンプではない
    assignNumbers(kept);
    return { canvas, items: kept, table };
  }
  const tick = () => new Promise(r => setTimeout(r, 0));

  /** スタンプの紙（白）が白くなるように色をそろえた画像を作る（照明の色かぶりを直す） */
  function whiteBalanced(px, stamps) {
    let r = 0, g = 0, b = 0;
    for (const st of stamps) if (st.paper) { r += st.paper[0]; g += st.paper[1]; b += st.paper[2]; }
    if (!r || !g || !b) return px;
    const m = (r + g + b) / 3, gr = m / r, gg = m / g, gb = m / b;
    const out = new Uint8ClampedArray(px.length);
    for (let i = 0; i < px.length; i += 4) { out[i] = px[i] * gr; out[i + 1] = px[i + 1] * gg; out[i + 2] = px[i + 2] * gb; out[i + 3] = 255; }
    return out;
  }

  /** 1人が持つ数字は1〜12が1枚ずつ。色ごとに、合計の確からしさが最大になるように数字を割り当てる */
  function assignNumbers(items) {
    const groups = new Map();
    for (const it of items) { const k = it.stamp.color; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
    for (const list of groups.values()) {
      if (list.length > 12) continue;
      const cost = list.map(it => Array.from({ length: 12 }, (_, j) => -(it.number.all[j + 1] ?? -1)));
      const pick = hungarian(cost);
      list.forEach((it, i) => {
        const n = pick[i] + 1;
        if (n !== it.number.num) { it.number.fixedFrom = it.number.num; it.number.num = n; }
      });
    }
  }
  /** ハンガリアン法（行 ≤ 列）。cost[i][j] を最小にする各行の列番号 */
  function hungarian(cost) {
    const n = cost.length, m = cost[0].length, INF = 1e9;
    const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      p[0] = i; let j0 = 0; const minv = new Array(m + 1).fill(INF), used = new Array(m + 1).fill(false);
      do {
        used[j0] = true; const i0 = p[j0]; let delta = INF, j1 = 0;
        for (let j = 1; j <= m; j++) if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= m; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const res = new Array(n);
    for (let j = 1; j <= m; j++) if (p[j]) res[p[j] - 1] = j - 1;
    return res;
  }

  const setPaperFromTable = t => { paperV = Math.max(0.8, Math.max(...t) / 255 + 0.06); };
  const setDigitFont = f => { DIGIT_FONT = { ...DIGIT_FONT, ...f }; digitTemplates = null; };
  return { OPT, read, readDots, setDigitFont, setPaperFromTable, findStamps, readNumber, findCard, identify, loadImage, toCanvas, sv, tableColor, cropCard };
})();
