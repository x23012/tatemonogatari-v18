/* カードの「点数の色（左上のマーク）」と「写真の模様・色」で、どのカードかを見分ける。
 * 見本は cards/<id>.jpg（印刷データから切り出したカード画像）。
 * カメラでもテストでも同じ関数で特徴を取り出すので、見本と読み取りの条件がそろう。 */
'use strict';

const CardMatcher = (() => {
  // カード上の位置（0〜1）。印刷データの実測から
  // ver18：写真がカード全体に広がり、帯はない。点数の色は左上のマーク（バッジ）でとる
  const BADGE = { x0: 0.05, x1: 0.17, y0: 0.035, y1: 0.155 };
  const LEFT_BAND = BADGE, RIGHT_BAND = BADGE;
  const PHOTO = { x0: 0.03, x1: 0.97, y0: 0.03, y1: 0.97 };
  const GX = 6, GY = 9;     // 色のマス
  const LX = 10, LY = 15;   // 明るさのマス
  const SRC = 144;          // 読み取りに使う画像の大きさ（px）
  const W = { color: 1.0, lum: 1.0, band: 2.2 };

  /** 画像（RGBA配列）から、カード座標(u,v)の色をとる（双一次補間） */
  function sampler(px, w, h, x0, y0, size, rot) {
    return (u, v, out) => {
      if (rot) { u = 1 - u; v = 1 - v; }
      let x = x0 + u * size - 0.5, y = y0 + v * size - 0.5;
      x = Math.max(0, Math.min(w - 1.001, x)); y = Math.max(0, Math.min(h - 1.001, y));
      const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi;
      const i00 = (yi * w + xi) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
      for (let c = 0; c < 3; c++) {
        out[c] = (px[i00 + c] * (1 - fx) + px[i10 + c] * fx) * (1 - fy) + (px[i01 + c] * (1 - fx) + px[i11 + c] * fx) * fy;
      }
    };
  }

  function cellMeans(get, box, nx, ny, sub) {
    const out = new Float32Array(nx * ny * 3), t = [0, 0, 0];
    const cw = (box.x1 - box.x0) / nx, ch = (box.y1 - box.y0) / ny;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < sub; sy++) for (let sx = 0; sx < sub; sx++) {
        get(box.x0 + (i + (sx + 0.5) / sub) * cw, box.y0 + (j + (sy + 0.5) / sub) * ch, t);
        r += t[0]; g += t[1]; b += t[2];
      }
      const k = (j * nx + i) * 3, n = sub * sub;
      out[k] = r / n; out[k + 1] = g / n; out[k + 2] = b / n;
    }
    return out;
  }

  /** 帯の色：白い文字をさけるため、明るさの低い方から6割の平均 */
  function bandColor(get, box) {
    const vals = [], t = [0, 0, 0];
    for (let j = 0; j < 14; j++) for (let i = 0; i < 4; i++) {
      get(box.x0 + (i + 0.5) / 4 * (box.x1 - box.x0), box.y0 + (j + 0.5) / 14 * (box.y1 - box.y0), t);
      vals.push([t[0], t[1], t[2], t[0] + t[1] + t[2]]);
    }
    vals.sort((a, b) => a[3] - b[3]);
    const keep = vals.slice(0, Math.round(vals.length * 0.6));
    const m = [0, 0, 0];
    keep.forEach(v => { m[0] += v[0]; m[1] += v[1]; m[2] += v[2]; });
    return m.map(x => x / keep.length);
  }

  /** 照明の明るさ・色かぶりに強くするため、チャンネルごとに平均0・分散1にそろえる */
  function normalizePerChannel(a) {
    const n = a.length / 3;
    for (let c = 0; c < 3; c++) {
      let s = 0, s2 = 0;
      for (let i = c; i < a.length; i += 3) { s += a[i]; s2 += a[i] * a[i]; }
      const m = s / n, sd = Math.max(Math.sqrt(Math.max(s2 / n - m * m, 0)), 14); // 無地（ワープなど）でノイズを広げすぎない
      for (let i = c; i < a.length; i += 3) a[i] = (a[i] - m) / sd;
    }
    return a;
  }
  function lumGrid(get) {
    const rgb = cellMeans(get, PHOTO, LX, LY, 2), out = new Float32Array(LX * LY);
    let s = 0, s2 = 0;
    for (let i = 0; i < out.length; i++) { const l = 0.3 * rgb[i * 3] + 0.59 * rgb[i * 3 + 1] + 0.11 * rgb[i * 3 + 2]; out[i] = l; s += l; s2 += l * l; }
    const m = s / out.length, sd = Math.max(Math.sqrt(Math.max(s2 / out.length - m * m, 0)), 14);
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - m) / sd;
    return out;
  }
  /** 帯の色を、明るさに左右されにくい形（色み2つ＋あざやかさ）にする */
  function chroma(rgb) {
    const [r, g, b] = rgb, s = r + g + b + 1;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return [r / s, g / s, (mx - mn) / (mx + 1)];
  }

  function features(px, w, h, x0, y0, size, rot) {
    const get = sampler(px, w, h, x0, y0, size, rot);
    const color = normalizePerChannel(cellMeans(get, PHOTO, GX, GY, 3));
    const lum = lumGrid(get);
    const bl = chroma(bandColor(get, LEFT_BAND)), br = chroma(bandColor(get, RIGHT_BAND));
    return { color, lum, band: [(bl[0] + br[0]) / 2, (bl[1] + br[1]) / 2, (bl[2] + br[2]) / 2] };
  }

  function dist(a, b) {
    let dc = 0, dl = 0;
    for (let i = 0; i < a.color.length; i++) { const d = a.color[i] - b.color[i]; dc += d * d; }
    for (let i = 0; i < a.lum.length; i++) { const d = a.lum[i] - b.lum[i]; dl += d * d; }
    dc /= a.color.length; dl /= a.lum.length;
    const db = Math.hypot((a.band[0] - b.band[0]) * 6, (a.band[1] - b.band[1]) * 6, (a.band[2] - b.band[2]) * 1.2);
    return W.color * dc + W.lum * dl + W.band * db;
  }

  let templates = [];   // [{id, f}]

  function pixelsOf(img, size) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, size, size);
    return x.getImageData(0, 0, size, size).data;
  }

  /** 見本を読みこむ。ids: カードIDの配列（'warp' も可） */
  async function load(ids, base = 'cards/') {
    const imgs = await Promise.all(ids.map(id => new Promise(ok => {
      const im = new Image(); im.onload = () => ok({ id, im }); im.onerror = () => ok(null); im.src = `${base}${id}.jpg`;
    })));
    templates = imgs.filter(Boolean).map(({ id, im }) => {
      const px = pixelsOf(im, SRC);
      const ident = (u, v) => [u * SRC - 0.5, v * SRC - 0.5];
      return { id, f: features(px, SRC, SRC, 0, 0, SRC, false), raw: rawFeatures(px, SRC, SRC, ident, null) };
    });
    return templates.length;
  }

  /** 読み取り画像 px（w×h）。カードは真ん中の size 四方にあるはず。
   * 位置・大きさのずれ、さかさまも試して、いちばん近いものを選ぶ */
  function rank(px, w, h, size, opt = {}) {
    const cx = w / 2, cy = h / 2;
    const scales = opt.scales || [0.9, 1, 1.1];
    const shifts = opt.shifts || [-0.05, 0, 0.05];
    const best = new Map();
    for (const s of scales) for (const dy of shifts) for (const dx of shifts) for (const rot of [false, true]) {
      const sz = size * s, x0 = cx - sz / 2 + dx * size, y0 = cy - sz / 2 + dy * size;
      const f = features(px, w, h, x0, y0, sz, rot);
      for (const t of templates) {
        const d = dist(f, t.f);
        const cur = best.get(t.id);
        if (cur === undefined || d < cur.d) best.set(t.id, { id: t.id, d, x0: x0 / w, y0: y0 / h, size: sz / w, rot });
      }
    }
    return [...best.values()].sort((a, b) => a.d - b.d);   // x0,y0,size は画像に対する割合（線の本数を読むときに使う）
  }

  /* ---- 写真まとめ読み用：任意の向き・隠れた所（スタンプ）をのぞいて比べる ---- */
  function bilinear(px, w, h, x, y, out) {
    x = Math.max(0, Math.min(w - 1.001, x)); y = Math.max(0, Math.min(h - 1.001, y));
    const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi;
    const i00 = (yi * w + xi) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
    for (let c = 0; c < 3; c++) out[c] = (px[i00 + c] * (1 - fx) + px[i10 + c] * fx) * (1 - fy) + (px[i01 + c] * (1 - fx) + px[i11 + c] * fx) * fy;
  }
  /** map(u,v)→[x,y]（カード座標→画像座標）、masked(u,v)→true なら使わない */
  function rawFeatures(px, w, h, map, masked) {
    const t = [0, 0, 0];
    const cells = (box, nx, ny, sub) => {
      const val = new Float32Array(nx * ny * 3), use = new Uint8Array(nx * ny);
      const cw = (box.x1 - box.x0) / nx, ch = (box.y1 - box.y0) / ny;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const uc = box.x0 + (i + 0.5) * cw, vc = box.y0 + (j + 0.5) * ch;
        if (masked && masked(uc, vc)) continue;
        let r = 0, g = 0, b = 0;
        for (let sy = 0; sy < sub; sy++) for (let sx = 0; sx < sub; sx++) {
          const [x, y] = map(box.x0 + (i + (sx + 0.5) / sub) * cw, box.y0 + (j + (sy + 0.5) / sub) * ch);
          bilinear(px, w, h, x, y, t); r += t[0]; g += t[1]; b += t[2];
        }
        const k = j * nx + i, n = sub * sub; use[k] = 1;
        val[k * 3] = r / n; val[k * 3 + 1] = g / n; val[k * 3 + 2] = b / n;
      }
      return { val, use };
    };
    const band = box => {
      const vals = [];
      for (let j = 0; j < 14; j++) for (let i = 0; i < 4; i++) {
        const u = box.x0 + (i + 0.5) / 4 * (box.x1 - box.x0), v = box.y0 + (j + 0.5) / 14 * (box.y1 - box.y0);
        if (masked && masked(u, v)) continue;
        const [x, y] = map(u, v); bilinear(px, w, h, x, y, t); vals.push([t[0], t[1], t[2], t[0] + t[1] + t[2]]);
      }
      if (!vals.length) return null;
      vals.sort((a, b) => a[3] - b[3]);
      const keep = vals.slice(0, Math.max(1, Math.round(vals.length * 0.6))), m = [0, 0, 0];
      keep.forEach(v => { m[0] += v[0]; m[1] += v[1]; m[2] += v[2]; });
      return chroma(m.map(x => x / keep.length));
    };
    const color = cells(PHOTO, GX, GY, 3), lum = cells(PHOTO, LX, LY, 2);
    const bl = band(LEFT_BAND), br = band(RIGHT_BAND);
    const bands = [bl, br].filter(Boolean);
    const bandAvg = bands.length ? [0, 1, 2].map(c => bands.reduce((a, b) => a + b[c], 0) / bands.length) : null;
    return { color, lum, band: bandAvg };
  }
  function normMasked(val, use, ch) {   // ch: 3=色ごと, 1=明るさ
    const n = use.length, out = new Float32Array(n * ch);
    for (let c = 0; c < ch; c++) {
      let s = 0, s2 = 0, m = 0;
      for (let i = 0; i < n; i++) if (use[i]) {
        const v = ch === 3 ? val[i * 3 + c] : 0.3 * val[i * 3] + 0.59 * val[i * 3 + 1] + 0.11 * val[i * 3 + 2];
        s += v; s2 += v * v; m++;
      }
      const mean = s / Math.max(m, 1), sd = Math.max(Math.sqrt(Math.max(s2 / Math.max(m, 1) - mean * mean, 0)), 14);
      for (let i = 0; i < n; i++) if (use[i]) {
        const v = ch === 3 ? val[i * 3 + c] : 0.3 * val[i * 3] + 0.59 * val[i * 3 + 1] + 0.11 * val[i * 3 + 2];
        out[i * ch + c] = (v - mean) / sd;
      }
    }
    return out;
  }
  /** 隠れたマスをのぞいて全部の見本と比べる */
  function compareRaw(q) {
    const qc = normMasked(q.color.val, q.color.use, 3), ql = normMasked(q.lum.val, q.lum.use, 1);
    const out = [];
    for (const t of templates) {
      const tc = normMasked(t.raw.color.val, q.color.use, 3), tl = normMasked(t.raw.lum.val, q.lum.use, 1);
      let dc = 0, nc = 0, dl = 0, nl = 0;
      for (let i = 0; i < q.color.use.length; i++) if (q.color.use[i]) { for (let c = 0; c < 3; c++) { const d = qc[i * 3 + c] - tc[i * 3 + c]; dc += d * d; } nc += 3; }
      for (let i = 0; i < q.lum.use.length; i++) if (q.lum.use[i]) { const d = ql[i] - tl[i]; dl += d * d; nl++; }
      dc /= Math.max(nc, 1); dl /= Math.max(nl, 1);
      let db = 0;
      if (q.band && t.raw.band) db = Math.hypot((q.band[0] - t.raw.band[0]) * 6, (q.band[1] - t.raw.band[1]) * 6, (q.band[2] - t.raw.band[2]) * 1.2);
      out.push({ id: t.id, d: CardMatcher.PW.color * dc + CardMatcher.PW.lum * dl + CardMatcher.PW.band * db, db });   // 写真まとめ読み用の重み
    }
    return out;
  }

  /** 結果の確からしさ：いちばん近いものが十分近く、2番目と差があるか */
  function judge(list) {
    if (!list.length) return { ok: false };
    const [a, b] = list;
    const margin = b ? b.d - a.d : 1;
    return { ok: a.d < CardMatcher.MAX_DIST && margin > CardMatcher.MIN_MARGIN, sure: a.d < CardMatcher.MAX_DIST * 0.7 && margin > CardMatcher.MIN_MARGIN * 3, d: a.d, margin };
  }

  return { load, rank, judge, features, rawFeatures, compareRaw, SRC, MAX_DIST: 1.5, MIN_MARGIN: 0.25, PW: { color: 1.0, lum: 1.0, band: 1.2 }, get templates() { return templates; } };
})();
