/* たてものがたり めぐりアプリ（ビルド不要・素のJavaScript） */
'use strict';

const LS_CUR = 'tatemono.current.v1';
const LS_SAVED = 'tatemono.saved.v1';
const LS_PREF = 'tatemono.pref.v1';
const LS_MONTHS = 'tatemono.months.v1';
const MAX_WAYPOINTS = 9;
/** 印刷カードの点数の色（左上のマークと四すみの点の色）。カードPDFから測った値 */
const POINT_COLOR = { 6: '#1c1c1c', 5: '#f07d1a', 4: '#0f9a94', 3: '#d6337f', 2: '#1f5fb4', 1: '#3e8e45' };   // ver18 のカードの点数の色
const WARP_COLOR = '#8a8a8a';   // ワープカードのマークの色

let CARDS = [];
const BYID = new Map();
const S = {
  cur: load(LS_CUR, []),           // いま選んでいるカードID（並び＝ルート順）
  saved: load(LS_SAVED, []),       // [{id, name, date, cards:[...]}]
  pref: Object.assign({ mode: 'transit', fromHere: false }, load(LS_PREF, {})),
  months: load(LS_MONTHS, {}),     // カードID → スタンプの月（写真まとめ読みで入れたとき）
  q: '', cat: '', region: '', pts: 0,
};

/* ---------- 小さな道具 ---------- */
function load(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できない環境 */ } }
const saveCur = () => save(LS_CUR, S.cur);
const saveSaved = () => save(LS_SAVED, S.saved);
const savePref = () => save(LS_PREF, S.pref);
const saveMonths = () => save(LS_MONTHS, S.months);
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** `{漢字|よみ}` → <ruby>。UIの文言にも同じ書き方を使う */
const R = s => esc(s).replace(/\{([^|}]+)\|([^}]+)\}/g, '<ruby>$1<rt>$2</rt></ruby>');
const stripRuby = s => String(s ?? '').replace(/\{([^|}]+)\|[^}]+\}/g, '$1');
const BASE = () => location.origin + location.pathname.replace(/index\.html$/, '');
const fmtDate = t => { const d = new Date(t); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; };

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.innerHTML = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

function photo(c, cls = '') {
  const src = esc(c.photo);
  return `<div class="ph ${cls}" style="--img:url('${src}')"><img src="${src}" alt="${esc(c.name)}の写真" loading="lazy" decoding="async"></div>`;
}
const pt = (c, big = false) => `<span class="pt${big ? ' big' : ''}" style="--c:${c.color}" aria-label="${c.points}点"><b>${c.points}</b><small>てん</small></span>`;

/* ---------- ルート計算 ---------- */
const hasGeo = c => c && c.lat != null && c.lng != null;
const place = c => hasGeo(c) ? `${c.lat},${c.lng}` : c.map_query;
function km(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
/** 最寄りを順にたどる。start が無ければ1枚目から */
function nearestOrder(ids, start) {
  const rest = ids.map(id => BYID.get(id));
  const out = [];
  let here = start || rest.shift();
  if (!start) out.push(here);
  while (rest.length) {
    let bi = 0;
    rest.forEach((c, i) => { if (km(here, c) < km(here, rest[bi])) bi = i; });
    here = rest.splice(bi, 1)[0];
    out.push(here);
  }
  return out.map(c => c.id);
}

function dirUrl(origin, dests, mode) {
  const p = new URLSearchParams({ api: '1' });
  if (origin) p.set('origin', origin);
  p.set('destination', dests[dests.length - 1]);
  if (dests.length > 1) p.set('waypoints', dests.slice(0, -1).join('|'));
  p.set('travelmode', mode);
  return 'https://www.google.com/maps/dir/?' + p.toString();
}
const searchUrl = c => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(place(c));

/** 経由地9か所までに区切る。fromHere なら最初の区間は出発地を空けて Googleマップに現在地を使わせる（位置は送らない） */
function segments(ids, fromHere, mode) {
  const pts = ids.map(id => place(BYID.get(id)));
  const out = [];
  if (!pts.length) return out;
  if (pts.length === 1 && !fromHere) return [{ from: 1, to: 1, url: searchUrl(BYID.get(ids[0])) }];
  let i = 0, first = true;
  while (true) {
    if (first && fromHere) {
      const chunk = pts.slice(0, MAX_WAYPOINTS + 1);
      out.push({ from: 0, to: chunk.length, url: dirUrl(null, chunk, mode) });
      i = chunk.length - 1;
    } else {
      const chunk = pts.slice(i, i + MAX_WAYPOINTS + 2);
      if (chunk.length < 2) break;
      out.push({ from: i + 1, to: i + chunk.length, url: dirUrl(chunk[0], chunk.slice(1), mode) });
      i += chunk.length - 1;
    }
    first = false;
    if (i >= pts.length - 1) break;
  }
  return out;
}
function legUrl(ids, idx, mode) {
  const to = place(BYID.get(ids[idx]));
  return dirUrl(idx === 0 ? null : place(BYID.get(ids[idx - 1])), [to], mode);
}
const shareUrl = ids => `${BASE()}?route=${ids.join(',')}`;
const parseIds = s => [...new Set(String(s || '').split(/[,\s]+/).filter(Boolean).map(Number).filter(n => Number.isInteger(n) && BYID.has(n)))];

async function shareRoute(ids) {
  const url = shareUrl(ids);
  const text = `たてものがたりのルート（${ids.length}か所）: ` + ids.map(id => BYID.get(id).name).join(' → ');
  if (navigator.share) {
    try { await navigator.share({ title: 'たてものがたり', text, url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('リンクをコピーしたよ'); }
  catch { window.prompt('このリンクをコピーしてね', url); }
}

function addCard(id, quiet) {
  if (!BYID.has(id)) return false;
  if (S.cur.includes(id)) { if (!quiet) toast(`${esc(BYID.get(id).name)}は もう入っているよ`); return false; }
  S.cur.push(id); saveCur();
  if (!quiet) toast(`${esc(BYID.get(id).name)}を入れたよ`);
  return true;
}
function saveRoute(ids) {
  const first = BYID.get(ids[0]);
  const name = ids.length > 1 ? `${first.name} ほか${ids.length - 1}か所` : first.name;
  const r = { id: Date.now().toString(36), name, date: Date.now(), cards: ids.slice() };
  S.saved.unshift(r); saveSaved();
  toast('保存したよ');
  return r;
}

/* ---------- 画面 ---------- */
const VIEWS = {};

VIEWS.home = () => {
  const picks = [...CARDS].sort((a, b) => b.points - a.points).slice(0, 3);
  const n = S.cur.length;
  return {
    title: 'たてものがたり', back: false,
    html: `
    <section class="hero">
      <div class="stripes"><span style="background:var(--kokuho)"></span><span style="background:var(--juubun)"></span><span style="background:var(--touroku)"></span></div>
      <h2>たてものがたり</h2>
      <p>${R('{持|も}っているカードで、{本当|ほんとう}にめぐる{旅|たび}へ。')}</p>
      <div class="hero-photos">${picks.map(c => photo(c)).join('')}</div>
    </section>
    ${n ? `<a class="resume" href="#/route"><span style="font-size:28px">🗺️</span><span style="flex:1"><b>つくりかけのルート</b><br><span class="muted">${n}か所 ・ つづきを見る</span></span><span aria-hidden="true">›</span></a>` : ''}
    <div class="stack">
      <a class="btn primary" href="#/photo"><span class="ico">🗓️</span>${R('{写真|しゃしん}1まいで まとめて{読|よ}む')}</a>
      <a class="btn" href="#/scan"><span class="ico">📷</span>${R('カードをカメラで{読|よ}む')}</a>
      <a class="btn" href="#/select"><span class="ico">🃏</span>${R('{一覧|いちらん}から{選|えら}ぶ')}</a>
      <a class="btn" href="#/saved"><span class="ico">🔖</span>${R('{保存|ほぞん}したルート')}${S.saved.length ? `（${S.saved.length}）` : ''}</a>
      <a class="btn" href="#/rules"><span class="ico">🎲</span>${R('{遊|あそ}び{方|かた}')}</a>
    </div>
    <p class="muted" style="margin-top:20px">${R('ゲームの{最後|さいご}に{持|も}っていたカードを{入|い}れると、めぐるルートができるよ。1{日|にち}でぜんぶ{回|まわ}らなくてOK。{季節|きせつ}ごとに{少|すこ}しずつ{会|あ}いに{行|い}こう。')}</p>`,
  };
};

VIEWS.select = () => {
  const cats = [['', 'すべての区分'], ['国宝', '国宝'], ['重要文化財', '重要文化財'], ['登録有形文化財', '登録有形文化財']];
  const pts = [0, 6, 5, 4, 3, 2, 1];
  const regions = ['', ...new Set(CARDS.map(c => c.region))];
  return {
    title: R('カードを{選|えら}ぶ'), back: true,
    html: `
    <label class="sr" for="q">さがす</label>
    <input class="search" id="q" type="search" placeholder="名前や 市・町で さがす（れい：犬山）" value="${esc(S.q)}" autocomplete="off">
    <div class="chips" role="group" aria-label="点数（マークの色）">${pts.map(v => `<button class="chip" data-act="pts" data-v="${v}" aria-pressed="${S.pts === v}" ${v ? `style="--c:${POINT_COLOR[v]};border-color:${POINT_COLOR[v]}"` : ''}>${v ? `${v}てん` : 'すべての点数'}</button>`).join('')}</div>
    <div class="chips" role="group" aria-label="区分">${cats.map(([v, l]) => `<button class="chip" data-act="cat" data-v="${v}" aria-pressed="${S.cat === v}">${l}</button>`).join('')}</div>
    <div class="chips" role="group" aria-label="地区">${regions.map(v => `<button class="chip" data-act="region" data-v="${esc(v)}" aria-pressed="${S.region === v}">${v ? esc(v) : 'どこでも'}</button>`).join('')}</div>
    <p class="count" id="count"></p>
    <ul class="list" id="list"></ul>
    <div class="dock"><div class="dock-in">
      <span class="num" id="selnum"></span>
      <a class="btn primary" href="#/route" id="toRoute">ルートを{見|み}る ›</a>
    </div></div>`,
    after() {
      $('#toRoute').innerHTML = R('ルートを{見|み}る ›');
      $('#q').addEventListener('input', e => { S.q = e.target.value; renderList(); });
      renderList(); updateDock();
    },
  };
};

function filtered() {
  const q = S.q.trim().toLowerCase();
  return CARDS.filter(c =>
    (!S.cat || c.category === S.cat) &&
    (!S.pts || c.points === S.pts) &&
    (!S.region || c.region === S.region) &&
    (!q || [c.name, c.name_kana, c.city, c.other_name, c.official_name].some(v => String(v || '').toLowerCase().includes(q))));
}
function itemHtml(c) {
  const on = S.cur.includes(c.id);
  return `<li class="item${on ? ' on' : ''}" style="--c:${c.color}" data-id="${c.id}">
    <span class="band"></span>
    <button class="open" data-act="detail" data-id="${c.id}">
      ${photo(c, 'thumb')}
      <span class="txt"><span class="nm">${R(c.name_ruby)}</span><br><span class="sub">${esc(c.city)}</span></span>
      ${pt(c)}
    </button>
    <button class="check" data-act="toggle" data-id="${c.id}" aria-pressed="${on}" aria-label="${esc(c.name)}を${on ? 'はずす' : '選ぶ'}"><span>${on ? '✓' : ''}</span></button>
  </li>`;
}
function renderList() {
  const list = filtered();
  $('#list').innerHTML = list.map(itemHtml).join('') || `<li class="empty">見つからなかったよ。ことばを かえてみてね。</li>`;
  $('#count').textContent = `${list.length}まい`;
}
function updateDock() {
  const n = S.cur.length, el = $('#selnum'); if (!el) return;
  el.innerHTML = `<b>${n}</b>まい<br><span class="muted" style="font-size:12px">めやす 6〜8</span>`;
  $('#toRoute').toggleAttribute('disabled', n === 0);
}

VIEWS.card = id => {
  const c = BYID.get(Number(id));
  if (!c) return VIEWS.notfound();
  const on = S.cur.includes(c.id);
  return {
    title: R('くわしく'), back: true,
    html: `
    ${photo(c, 'detail-photo')}
    <div class="detail-head">${pt(c, true)}<div><span class="tag">${esc(c.category)}</span><h2>${R(c.name_ruby)}</h2></div></div>
    ${c.other_name ? `<p class="alias">べつの名前：${esc(c.other_name)}</p>` : ''}
    <p class="catch" style="--c:${c.color}">${esc(c.catchphrase)}</p>
    <p>${esc(c.description)}</p>
    <dl class="facts">
      <dt>ばしょ</dt><dd>${esc(c.city)}（${esc(c.region)}）</dd>
      <dt>時代</dt><dd>${esc(c.era)}</dd>
      <dt>使いみち</dt><dd>${esc(c.use)}</dd>
      <dt>つくり</dt><dd>${esc(c.structure)}</dd>
    </dl>
    <div class="stack">
      <button class="btn ${on ? '' : 'primary'}" data-act="toggleDetail" data-id="${c.id}">${on ? R('ルートからはずす') : R('ルートに{入|い}れる')}</button>
      <a class="btn blue" href="${searchUrl(c)}" target="_blank" rel="noopener"><span class="ico">📍</span>${R('{地図|ちず}で{見|み}る')}</a>
      ${c.heritage_url ? `<a class="btn ghost" href="${esc(c.heritage_url)}" target="_blank" rel="noopener"><span class="ico">🏛️</span>${R('{文化遺産|ぶんかいさん}オンラインで{見|み}る')}</a>` : ''}
    </div>`,
  };
};

/** 「どんな旅か」の箱。tripText.js（trip_text.json のテーマと文の部品）で、カードの組み合わせからタイトルと本文を作る。
 * short: タイトルだけ（写真の確認画面用） */
let TRIP = null;
function tabiBox(items, short) {
  if (typeof TripText === 'undefined' || !TRIP) return '';
  const ids = items.map(x => x.card && x.card.id).filter(id => typeof id === 'number');
  const t = TripText.describeTrip(ids, TRIP, { cards: CARDS });
  if (!t) return '';
  return `<section class="tabi">
    <p class="tabi-label">${R('あなたの{旅|たび}')}</p>
    <h3 class="tabi-title">${esc(t.title)}</h3>
    ${short ? '' : `<p class="tabi-text">${esc(t.text)}</p>`}
  </section>`;
}

/** kind: 'cur' いまのルート / 's' 保存 / 'x' 共有されたもの */
VIEWS.route = (kind, arg) => {
  let ids, savedItem;
  if (kind === 's') { savedItem = S.saved.find(r => r.id === arg); if (!savedItem) return VIEWS.notfound(); ids = savedItem.cards.filter(id => BYID.has(id)); }
  else if (kind === 'x') ids = parseIds(decodeURIComponent(arg || ''));
  else ids = S.cur;
  const editable = !kind || kind === 'cur';
  const allGeo = ids.length > 1 && ids.every(id => hasGeo(BYID.get(id)));
  const total = ids.reduce((a, id) => a + BYID.get(id).points, 0);
  const segs = segments(ids, S.pref.fromHere, S.pref.mode);
  const modes = [['transit', '🚃 電車・バス'], ['driving', '🚗 車'], ['walking', '🚶 歩き']];

  if (!ids.length) return {
    title: R('ルートの{確認|かくにん}'), back: true,
    html: `<div class="empty"><p style="font-size:44px;margin:0">🃏</p><p>${R('まだカードが{入|はい}っていないよ。')}</p></div>
      <div class="stack"><a class="btn primary" href="#/scan"><span class="ico">📷</span>${R('カードをカメラで{読|よ}む')}</a><a class="btn" href="#/select"><span class="ico">🃏</span>${R('{一覧|いちらん}から{選|えら}ぶ')}</a></div>`,
  };

  const stop = (id, i) => {
    const c = BYID.get(id);
    return `<li class="stop" style="--c:${c.color}">
      <span class="no">${i + 1}</span>
      <div class="card">
        <div class="top">${photo(c, 'thumb')}<div style="flex:1;min-width:0"><button class="nm" data-act="detail" data-id="${c.id}">${R(c.name_ruby)}</button><div class="muted" style="font-size:13px">${editable && S.months[c.id] ? `<span class="month">${S.months[c.id]}{月|がつ}</span> `.replace(/\{月\|がつ\}/, '<ruby>月<rt>がつ</rt></ruby>') : ''}${esc(c.city)}</div></div>${pt(c)}</div>
        <div class="tools">
          ${editable ? `<button class="ibtn" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="上へ">▲</button>
          <button class="ibtn" data-act="down" data-i="${i}" ${i === ids.length - 1 ? 'disabled' : ''} aria-label="下へ">▼</button>
          <button class="ibtn" data-act="remove" data-i="${i}" aria-label="けす">✕</button>` : ''}
          <a class="ibtn go" href="${legUrl(ids, i, S.pref.mode)}" target="_blank" rel="noopener" aria-label="${i === 0 ? '' : `${i}ばんから`}${esc(c.name)}への行き方">${R('{行|い}き{方|かた} ›')}</a>
        </div>
      </div>
    </li>`;
  };

  return {
    title: kind === 's' ? esc(savedItem.name) : kind === 'x' ? R('{届|とど}いたルート') : R('ルートの{確認|かくにん}'),
    back: true,
    html: `
    ${kind === 'x' ? `<div class="banner">${R('ルートが{届|とど}いたよ！{保存|ほぞん}すると、あとで{開|ひら}けるよ。')}</div>` : ''}
    ${kind === 's' ? `<p class="muted">${fmtDate(savedItem.date)}に${R('{保存|ほぞん}')}</p>` : ''}
    <p><b>${ids.length}か所</b> ・ ${R('カードの{点数|てんすう}')} ${total}てん</p>
    ${tabiBox(ids.map(id => ({ card: BYID.get(id), month: editable ? S.months[id] : undefined })))}
    ${editable && ids.length > 1 ? (allGeo
      ? `<button class="btn small" data-act="sort" style="width:100%;margin-bottom:8px">📍 ${R('{近|ちか}い{順|じゅん}に{並|なら}べる')}</button>`
      : `<p class="note">${R('{近|ちか}い{順|じゅん}に{並|なら}べる{機能|きのう}は、{場所|ばしょ}のデータが{入|はい}ったら{使|つか}えるよ。いまは{選|えら}んだ{順|じゅん}。▲▼で{入|い}れかえてね。')}</p>`) : ''}
    <ol class="stops">${ids.map(stop).join('')}</ol>

    <section class="panel">
      <h3>${R('Googleマップで{案内|あんない}')}</h3>
      <div class="seg" role="group" aria-label="のりもの">${modes.map(([v, l]) => `<button data-act="mode" data-v="${v}" aria-pressed="${S.pref.mode === v}">${l}</button>`).join('')}</div>
      <label class="toggle"><input type="checkbox" data-act="fromHere" ${S.pref.fromHere ? 'checked' : ''}><span>${R('{今|いま}いる{場所|ばしょ}から{出発|しゅっぱつ}')}</span></label>
      <div class="stack" style="margin-top:8px">
        ${segs.map((s, k) => `<a class="btn primary" href="${s.url}" target="_blank" rel="noopener"><span class="ico">🧭</span>${segs.length > 1 ? `${k + 1}つめの区間（${s.from ? s.from : '今いる場所'}→${s.to}）` : R('{案内|あんない}をはじめる')}</a>`).join('')}
      </div>
      ${segs.length > 1 ? `<p class="note">${R('{一度|いちど}に{寄|よ}れるのは9か{所|しょ}までなので、{区間|くかん}に{分|わ}けたよ。')}</p>` : ''}
      ${S.pref.mode === 'transit' && ids.length > 2 ? `<p class="note">${R('{電車|でんしゃ}・バスでは、{寄|よ}り{道|みち}つきの{案内|あんない}が{出|で}ないことがあるよ。そのときは、それぞれの「{行|い}き{方|かた}」を{使|つか}ってね。')}</p>` : ''}
      <p class="muted" style="font-size:13px">${R('{今|いま}いる{場所|ばしょ}は、このアプリからは{送|おく}りません（Googleマップが{調|しら}べます）。')}</p>
    </section>

    <div class="row">
      ${kind !== 's' ? `<button class="btn" data-act="saveRoute" data-ids="${ids.join(',')}"><span class="ico">🔖</span>${R('{保存|ほぞん}')}</button>` : ''}
      <button class="btn" data-act="share" data-ids="${ids.join(',')}"><span class="ico">📤</span>${R('{共有|きょうゆう}')}</button>
    </div>
    <div class="stack" style="margin-top:14px">
      ${editable
        ? `<a class="btn ghost" href="#/select">＋ ${R('カードを{足|た}す')}</a><button class="btn ghost" data-act="clear">${R('ルートをぜんぶ{消|け}す')}</button>`
        : `<button class="btn ghost" data-act="edit" data-ids="${ids.join(',')}">✏️ ${R('このルートを{直|なお}す')}</button>`}
      ${kind === 's' ? `<button class="btn ghost" data-act="delSaved" data-id="${savedItem.id}">🗑 ${R('{保存|ほぞん}から{消|け}す')}</button>` : ''}
    </div>`,
  };
};

VIEWS.saved = () => ({
  title: R('{保存|ほぞん}したルート'), back: true,
  html: `
  ${S.saved.length ? `<div class="stack">${S.saved.map(r => {
    const cs = r.cards.map(id => BYID.get(id)).filter(Boolean);
    const segs = segments(cs.map(c => c.id), S.pref.fromHere, S.pref.mode);
    return `<article class="saved">
      <div class="date">${fmtDate(r.date)} ・ ${cs.length}か所</div>
      <div class="nm">${esc(r.name)}</div>
      <div class="strip">${cs.slice(0, 8).map(c => photo(c).replace('class="ph ', `style="--c:${c.color}" class="ph `)).join('')}</div>
      <div class="row">
        <a class="btn small" href="#/route/s/${r.id}">${R('{開|ひら}く')}</a>
        ${segs[0] ? `<a class="btn small blue" href="${segs[0].url}" target="_blank" rel="noopener">${R('{案内|あんない}')}</a>` : ''}
        <button class="btn small" data-act="share" data-ids="${cs.map(c => c.id).join(',')}">${R('{共有|きょうゆう}')}</button>
        <button class="btn small ghost" data-act="delSaved" data-id="${r.id}" aria-label="消す">🗑</button>
      </div>
    </article>`;
  }).join('')}</div>`
    : `<div class="empty"><p style="font-size:44px;margin:0">🔖</p><p>${R('まだ{保存|ほぞん}したルートはないよ。')}</p></div>`}
  <section class="panel" style="margin-top:24px">
    <h3>${R('ファイルに{書|か}き{出|だ}す・{読|よ}みこむ')}</h3>
    <p class="muted">${R('{機種変更|きしゅへんこう}のときや、{家族|かぞく}の{スマホ|すまほ}に{移|うつ}すときに{使|つか}えるよ。')}</p>
    <div class="row">
      <button class="btn small" data-act="export" ${S.saved.length ? '' : 'disabled'}>${R('{書|か}き{出|だ}す')}</button>
      <label class="btn small" style="cursor:pointer">${R('{読|よ}みこむ')}<input type="file" accept="application/json,.json" id="importFile" hidden></label>
    </div>
  </section>`,
  after() { $('#importFile').addEventListener('change', importFile); },
});

VIEWS.scan = () => ({
  title: R('カードを{読|よ}む'), back: true,
  html: `
  <div class="cam" id="cam"><video id="video" playsinline muted></video>
    <div class="frame" hidden id="frame"><i></i><i></i><i></i><i></i></div>
    <div class="msg" id="camMsg">${R('カメラを{準備|じゅんび}しているよ…')}</div>
  </div>
  <p class="scan-status" id="scanStatus">${R('カードを{枠|わく}にぴったり{合|あ}わせてね')}</p>
  <div id="cand" class="cand" hidden></div>
  <button class="btn small" data-act="checkNow" id="checkNow" style="width:100%" hidden>🔍 ${R('いま{調|しら}べる')}</button>
  <p class="muted" style="font-size:14px">${R('{明|あか}るい{所|ところ}で、カードを{机|つくえ}に{置|お}いて{真上|まうえ}から{映|うつ}すと{読|よ}みやすいよ。{読|よ}めないときは「{一覧|いちらん}から{選|えら}ぶ」も{使|つか}えるよ。')}</p>
  <a class="btn small" href="#/photo" style="width:100%">🗓️ ${R('{並|なら}べた{写真|しゃしん}1まいで まとめて{読|よ}む')}</a>
  <div class="scanned" id="scanned"></div>
  <div class="dock"><div class="dock-in">
    <span class="num" id="selnum"></span>
    <a class="btn primary" href="#/route" id="toRoute"></a>
  </div></div>`,
  after() { $('#toRoute').innerHTML = R('ルートを{見|み}る ›'); updateDock(); renderScanned(); startScan(); },
});

VIEWS.photo = () => ({
  title: R('{写真|しゃしん}でまとめて{読|よ}む'), back: true,
  html: `
  <div class="photo-guide">
    <p><b>${R('ゲームの{最後|さいご}に{持|も}っていたカードを、スタンプをのせたまま{並|なら}べて{撮|と}ってね。')}</b></p>
    <ul>
      <li>${R('カードどうしを{少|すこ}しはなす')}</li>
      <li>${R('{自分|じぶん}の{席|せき}から、{真上|まうえ}に{近|ちか}い{角度|かくど}で')}</li>
      <li>${R('{明|あか}るい{所|ところ}で、カードが{全部|ぜんぶ}{入|はい}るように')}</li>
      <li>${R('カードの{四|よ}すみの{点|てん}が、ぼけずに{写|うつ}るように')}</li>
    </ul>
    <p class="muted">${R('スタンプの{数字|すうじ}（＝{月|つき}）の{小|ちい}さい{順|じゅん}に{並|なら}べて、ルートにするよ。')}</p>
  </div>
  <div class="row">
    <label class="btn primary" style="cursor:pointer"><span class="ico">📷</span>${R('{写真|しゃしん}を{撮|と}る')}<input type="file" accept="image/*" capture="environment" class="photo-in" hidden></label>
    <label class="btn" style="cursor:pointer"><span class="ico">🖼️</span>${R('アルバム')}<input type="file" accept="image/*" class="photo-in" hidden></label>
  </div>
  <div id="photoOut">${photoState.res ? '' : ''}</div>`,
  after() {
    document.querySelectorAll('.photo-in').forEach(i => i.addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) readPhoto(f); }));
    if (photoState.res) renderPhotoResult();
  },
});

VIEWS.rules = () => ({
  title: R('{遊|あそ}び{方|かた}'), back: true,
  html: `<div class="rules">
  <div class="box">${R('{人数|にんずう}：2〜4{人|にん}　{年齢|ねんれい}：8さい{以上|いじょう}　{時間|じかん}：{約|やく}30{分|ぷん}')}</div>
  <p class="muted">${R('{内容物|ないようぶつ}：{文化財|ぶんかざい}カード47まい、ワープカード2まい、{数字|すうじ}コマ（1〜12×4{色|しょく}）、{移動|いどう}コマ4こ、サイコロ1こ、{革命|かくめい}カード1まい')}</p>
  <h2>${R('{準備|じゅんび}')}</h2>
  <ol>
    <li>${R('{文化財|ぶんかざい}カード47まいとワープカード2まいを{混|ま}ぜ、{裏向|うらむ}きで7×7に{並|なら}べる。')}</li>
    <li>${R('{色|いろ}を{決|き}め、{数字|すうじ}コマ12まいと{移動|いどう}コマを{受|う}け{取|と}る。{革命|かくめい}カードは「ふつう」を{上|うえ}にして{盤|ばん}の{横|よこ}に{置|お}く。')}</li>
    <li>${R('{最初|さいしょ}の{人|ひと}を{決|き}める。')}</li>
  </ol>
  <h2>${R('{遊|あそ}び{方|かた}（3{月|がつ}〜2{月|がつ}の12か{月|げつ}）')}</h2>
  <ul>
    <li>${R('スタート（3{月|がつ}）：{好|す}きな{裏向|うらむ}きカードを{表|おもて}にして、{移動|いどう}コマと「1」のコマを{置|お}く。')}</li>
    <li>${R('{毎月|まいつき}：サイコロ（1〜3）の{数|かず}だけ{縦横|たてよこ}に{進|すす}む。{裏向|うらむ}きなら{表|おもて}にする。{止|と}まったカードにコマを1まいかならず{置|お}く。')}</li>
    <li>${R('いちばん{上|うえ}のコマの{人|ひと}が{持|も}ち{主|ぬし}。{大|おお}きい{数字|すうじ}を{置|お}けば{奪|うば}える（{同|おな}じ{数字|すうじ}では{奪|うば}えない）。{負|ま}ける{数字|すうじ}を{置|お}いてもよい。')}</li>
    <li>${R('ワープカード：{持|も}ち{主|ぬし}は1{点|てん}。ほかの{人|ひと}のワープカードを{奪|うば}ったら、{表|おもて}のカードならどこへでも{移動|いどう}できる（その{手番|てばん}は{移動先|いどうさき}で{奪|うば}えない）。')}</li>
    <li>${R('{革命|かくめい}：どこかのカードにコマが4まい{重|かさ}なったら{革命|かくめい}。{小|ちい}さい{数字|すうじ}が{強|つよ}くなる。また4まい{重|かさ}なったら{元|もと}に{戻|もど}る。')}</li>
    <li>${R('{毎月|まいつき}、{最初|さいしょ}に{動|うご}く{人|ひと}を{左|ひだり}どなりへずらす。')}</li>
  </ul>
  <h2>${R('{終|お}わりと{点数|てんすう}')}</h2>
  <ul>
    <li>${R('{持|も}ち{主|ぬし}のカードの{点数|てんすう}を{合計|ごうけい}する。')}</li>
    <li>${R('ボーナス：コマがいちばん{多|おお}く{重|かさ}なったカードの{持|も}ち{主|ぬし}は+3{点|てん}。1{点|てん}のカードをいちばん{多|おお}く{持|も}つ{人|ひと}は、1{点|てん}のカードが2{点|てん}になる。')}</li>
    <li>${R('いちばん{多|おお}い{人|ひと}の{勝|か}ち。{同点|どうてん}は{全員|ぜんいん}{勝|か}ち。')}</li>
  </ul>
  <h2>${R('{遊|あそ}んだあと')}</h2>
  <div class="box">${R('{最後|さいご}に{持|も}っていたカードが、あなたの1{年|ねん}の{物語|ものがたり}の{舞台|ぶたい}。アプリでルートにして、{本当|ほんとう}に{会|あ}いに{行|い}こう。')}</div>
  <a class="btn primary" href="#/scan" style="margin-top:12px"><span class="ico">📷</span>${R('カードを{入|い}れる')}</a>
  </div>`,
});

VIEWS.notfound = () => ({ title: 'みつかりません', back: true, html: `<div class="empty"><p>${R('{見|み}つからなかったよ。')}</p><a class="btn" href="#/">ホームへ</a></div>` });

/* ---------- ルーター ---------- */
function router() {
  stopScan();
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
  const page = parts[0] || 'home';
  let v;
  if (page === 'route') v = VIEWS.route(parts[1] || 'cur', parts[2]);
  else if (page === 'card') v = VIEWS.card(parts[1]);
  else v = (VIEWS[page] || VIEWS.notfound)();
  $('#title').innerHTML = v.title;
  $('#back').hidden = !v.back;
  $('#main').innerHTML = v.html;
  document.title = page === 'home' ? 'たてものがたり' : `${v.title.replace(/<rt>.*?<\/rt>/g, '').replace(/<[^>]+>/g, '')} | たてものがたり`;
  if (v.after) v.after();
  window.scrollTo(0, 0);
}
function rerender() { const y = window.scrollY; router(); window.scrollTo(0, y); }

/* ---------- 操作 ---------- */
const ACT = {
  back() { if (navStack.length > 1) history.back(); else location.hash = '#/'; },
  detail(el) { location.hash = `#/card/${el.dataset.id}`; },
  cat(el) { S.cat = el.dataset.v; document.querySelectorAll('[data-act=cat]').forEach(b => b.setAttribute('aria-pressed', b === el)); renderList(); },
  pts(el) { S.pts = Number(el.dataset.v); document.querySelectorAll('[data-act=pts]').forEach(b => b.setAttribute('aria-pressed', b === el)); renderList(); },
  region(el) { S.region = el.dataset.v; document.querySelectorAll('[data-act=region]').forEach(b => b.setAttribute('aria-pressed', b === el)); renderList(); },
  toggle(el) {
    const id = Number(el.dataset.id), i = S.cur.indexOf(id);
    if (i >= 0) S.cur.splice(i, 1); else S.cur.push(id);
    saveCur();
    const li = el.closest('.item'); li.outerHTML = itemHtml(BYID.get(id));
    updateDock();
  },
  toggleDetail(el) {
    const id = Number(el.dataset.id), i = S.cur.indexOf(id);
    if (i >= 0) { S.cur.splice(i, 1); saveCur(); toast('ルートからはずしたよ'); } else addCard(id);
    rerender();
  },
  up(el) { const i = +el.dataset.i; [S.cur[i - 1], S.cur[i]] = [S.cur[i], S.cur[i - 1]]; saveCur(); rerender(); },
  down(el) { const i = +el.dataset.i; [S.cur[i + 1], S.cur[i]] = [S.cur[i], S.cur[i + 1]]; saveCur(); rerender(); },
  remove(el) { const c = BYID.get(S.cur[+el.dataset.i]); S.cur.splice(+el.dataset.i, 1); saveCur(); toast(`${esc(c.name)}をはずしたよ`); rerender(); },
  clear() { if (confirm('ルートのカードをぜんぶ消しますか？')) { S.cur = []; saveCur(); S.months = {}; saveMonths(); rerender(); } },
  mode(el) { S.pref.mode = el.dataset.v; savePref(); rerender(); },
  fromHere(el) { S.pref.fromHere = el.checked; savePref(); rerender(); },
  sort() {
    const done = start => { S.cur = nearestOrder(S.cur, start); saveCur(); toast(start ? '今いる場所から近い順にしたよ' : '1まい目から近い順にしたよ'); rerender(); };
    if (!navigator.geolocation) return done(null);
    navigator.geolocation.getCurrentPosition(p => done({ lat: p.coords.latitude, lng: p.coords.longitude }), () => done(null), { timeout: 8000, maximumAge: 300000 });
  },
  saveRoute(el) { const r = saveRoute(parseIds(el.dataset.ids)); location.hash = `#/route/s/${r.id}`; },
  share(el) { shareRoute(parseIds(el.dataset.ids)); },
  edit(el) {
    if (S.cur.length && !confirm('いまのルートを、このルートで置きかえますか？')) return;
    S.cur = parseIds(el.dataset.ids); saveCur(); location.hash = '#/route';
  },
  delSaved(el) {
    if (!confirm('この保存したルートを消しますか？')) return;
    S.saved = S.saved.filter(r => r.id !== el.dataset.id); saveSaved();
    if (location.hash.startsWith('#/route/s/')) location.hash = '#/saved'; else rerender();
  },
  export() {
    const blob = new Blob([JSON.stringify({ app: 'tatemonogatari', version: 1, exported: new Date().toISOString(), routes: S.saved }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `tatemonogatari-routes-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
};
function importFile(e) {
  const f = e.target.files[0]; if (!f) return;
  f.text().then(t => {
    const d = JSON.parse(t), list = Array.isArray(d) ? d : d.routes;
    if (!Array.isArray(list)) throw new Error('bad');
    let n = 0;
    for (const r of list) {
      const cards = parseIds((r.cards || []).join(','));
      if (!cards.length || S.saved.some(x => x.id === r.id)) continue;
      S.saved.push({ id: String(r.id || Date.now().toString(36) + n), name: String(r.name || 'ルート'), date: Number(r.date) || Date.now(), cards });
      n++;
    }
    S.saved.sort((a, b) => b.date - a.date); saveSaved();
    toast(`${n}このルートを読みこんだよ`); rerender();
  }).catch(() => toast('読みこめないファイルでした'));
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT') return;
  const fn = ACT[el.dataset.act]; if (fn) { e.preventDefault(); fn(el); }
});
document.addEventListener('change', e => {
  const el = e.target.closest('input[data-act]'); if (el && ACT[el.dataset.act]) ACT[el.dataset.act](el);
});
const navStack = [location.hash];
window.addEventListener('hashchange', () => {
  if (navStack.length > 1 && navStack[navStack.length - 2] === location.hash) navStack.pop(); else navStack.push(location.hash);
  router();
});

/* ---------- カメラでカードを読む ---------- */
// 点数の色と写真の模様で見分け、四すみの点で確かめる（matcher.js, dots.js）。QRが印刷されたカードは、使える端末ではQRでも読む
const CAP = CardMatcher.SRC;                 // 読み取り画像 144px
const CARD_IN_CAP = 120;                     // そのうちカードが入るはずの大きさ
const GUIDE = 0.76;                          // 枠の大きさ（カメラ画面に対して）
let stream = null, scanTimer = 0, qrDetector = null, matcherReady = null;
let paused = false, lastTop = null, streak = 0, scannedNow = [];
const cooldown = new Map();                  // id → この時刻まで同じカードを出さない

function ensureMatcher() {
  if (!matcherReady) { Dots.setCodes(CARDS); matcherReady = CardMatcher.load([...CARDS.map(c => c.id), 'warp']); }
  return matcherReady;
}
const capCanvas = document.createElement('canvas');
capCanvas.width = capCanvas.height = CAP;
const capCtx = capCanvas.getContext('2d', { willReadFrequently: true });

async function startScan() {
  const msg = $('#camMsg'), video = $('#video');
  paused = false; lastTop = null; streak = 0;
  if (!navigator.mediaDevices?.getUserMedia) { msg.innerHTML = R('このブラウザではカメラが{使|つか}えないよ。「{一覧|いちらん}から{選|えら}ぶ」を{使|つか}ってね。'); return; }
  const ready = ensureMatcher();
  try {
    if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) qrDetector = new BarcodeDetector({ formats: ['qr_code'] });
  } catch { qrDetector = null; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
  } catch {
    msg.innerHTML = R('カメラを{使|つか}えなかったよ。{設定|せってい}でカメラを{許可|きょか}するか、「{一覧|いちらん}から{選|えら}ぶ」を{使|つか}ってね。'); return;
  }
  if (!$('#video')) { stopScan(); return; } // すでに別の画面
  video.srcObject = stream; await video.play().catch(() => {});
  await ready;
  if (!$('#video')) { stopScan(); return; }
  msg.hidden = true; $('#frame').hidden = false; $('#checkNow').hidden = false;
  const loop = async () => {
    if (!stream) return;
    if (!paused) await tick(false);
    scanTimer = setTimeout(loop, 220);
  };
  loop();
}
function stopScan() {
  clearTimeout(scanTimer);
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
}
/** 枠の部分（＋まわりに少し余白）を 144px に切り出す */
function capture() {
  const v = $('#video'); if (!v || v.readyState < 2 || !v.videoWidth) return null;
  const side = Math.min(v.videoWidth, v.videoHeight);           // object-fit: cover の正方形で見えている範囲
  const cap = side * GUIDE * CAP / CARD_IN_CAP;
  const sx = (v.videoWidth - cap) / 2, sy = (v.videoHeight - cap) / 2;
  capCtx.drawImage(v, sx, sy, cap, cap, 0, 0, CAP, CAP);
  lastCap = { sx, sy, cap };
  return capCtx.getImageData(0, 0, CAP, CAP).data;
}
/** 四すみの点を、同じ範囲を大きく（HI px）切り出して読む。top: rank() の1位（見本と重なった位置） */
const HI = 480;
const hiCanvas = document.createElement('canvas');
hiCanvas.width = hiCanvas.height = HI;
const hiCtx = hiCanvas.getContext('2d', { willReadFrequently: true });
let lastCap = null;
function readDotsNow(top) {
  const v = $('#video'); if (!v || !lastCap || !top || top.x0 == null) return null;
  const { sx, sy, cap } = lastCap;
  hiCtx.drawImage(v, sx, sy, cap, cap, 0, 0, HI, HI);
  const raw = Dots.getter(hiCtx.getImageData(0, 0, HI, HI).data, HI);
  const get = (u, vv, out) => { if (top.rot) { u = 1 - u; vv = 1 - vv; } raw(top.x0 + u * top.size, top.y0 + vv * top.size, out); };
  return Dots.readAnyOrientation(k => Dots.rotate(get, k), top.size * cap);
}
async function tick(force) {
  const v = $('#video'); if (!v) return;
  if (qrDetector && !force) {
    try {
      const r = await qrDetector.detect(v);
      if (r[0]?.rawValue) { const id = cardFromText(r[0].rawValue); if (id != null && BYID.has(id)) { propose([{ id, d: 0 }], true); return; } }
    } catch { /* QRは読めなくてもよい */ }
  }
  const px = capture(); if (!px) return;
  let list = CardMatcher.rank(px, CAP, CAP, CARD_IN_CAP);
  if (list[1] && list[1].d - list[0].d < 1.0) list = Dots.rerank(list, readDotsNow(list[0]));   // 模様が接戦のときだけ点で確かめる
  const j = CardMatcher.judge(list), top = list[0];
  const st = $('#scanStatus');
  if (force) {
    if (top.d > CardMatcher.MAX_DIST * 1.6) { toast('カードが見つからないよ。枠に合わせてね'); return; }
    propose(list, false); return;
  }
  if (!j.ok) { streak = 0; lastTop = null; if (st) st.innerHTML = R('カードを{枠|わく}にぴったり{合|あ}わせてね'); return; }
  if ((cooldown.get(top.id) || 0) > Date.now()) return;
  streak = top.id === lastTop ? streak + 1 : 1; lastTop = top.id;
  if (st) st.innerHTML = R('{読|よ}みとり{中|ちゅう}…そのまま{動|うご}かさないでね');
  if (streak >= (j.sure ? 2 : 3)) propose(list, j.sure);
}
/** 「これかな？」を出す。1位を大きく、ほかの候補を小さく */
function propose(list, sure) {
  const box = $('#cand'); if (!box) return;
  const top = list[0];
  if (top.id === 'warp') {
    cooldown.set('warp', Date.now() + 4000); toast('ワープカードは、ルートには入らないよ'); streak = 0; return;
  }
  paused = true; streak = 0;
  const st = $('#scanStatus'); if (st) st.innerHTML = R('{見|み}つけたよ！');
  if (navigator.vibrate) navigator.vibrate(40);
  const c = BYID.get(top.id);
  const alts = list.slice(1).filter(e => e.id !== 'warp').slice(0, 2).map(e => BYID.get(e.id));
  const inRoute = S.cur.includes(c.id);
  box.innerHTML = `
    <div class="cand-main" style="--c:${c.color}">
      <img src="cards/${c.id}.jpg" alt="${esc(c.name)}のカード">
      <div><p class="cand-q">${sure ? 'このカードだね！' : 'このカードかな？'}</p>
      <p class="cand-nm">${R(c.name_ruby)}</p>${pt(c)}</div>
    </div>
    ${inRoute ? `<p class="note">${R('このカードは、もうルートに{入|はい}っているよ。')}</p>` : `<button class="btn primary" data-act="accept" data-id="${c.id}">${R('ルートに{入|い}れる')}</button>`}
    ${alts.length ? `<p class="muted" style="margin:12px 0 4px">${R('ちがうときは、こっちかな？')}</p>
    <div class="cand-alts">${alts.map(a => `<button data-act="accept" data-id="${a.id}" style="--c:${a.color}"><img src="cards/${a.id}.jpg" alt=""><span>${R(a.name_ruby)}</span></button>`).join('')}</div>` : ''}
    <button class="btn ghost" data-act="retry" style="margin-top:10px">${inRoute ? R('つぎのカードを{読|よ}む') : R('もう{一度|いちど}{読|よ}む')}</button>`;
  box.hidden = false; $('#checkNow').hidden = true;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function closeCand(id) {
  const box = $('#cand'); if (box) { box.hidden = true; box.innerHTML = ''; }
  const b = $('#checkNow'); if (b) b.hidden = false;
  if (id != null) cooldown.set(id, Date.now() + 5000);
  lastTop = null; streak = 0;
  const st = $('#scanStatus'); if (st) st.innerHTML = R('つぎのカードを{枠|わく}に{合|あ}わせてね');
  setTimeout(() => { paused = false; }, 600);
}
ACT.accept = el => {
  const id = Number(el.dataset.id);
  if (addCard(id)) { scannedNow.unshift(id); renderScanned(); updateDock(); }
  closeCand(id);
};
ACT.retry = () => closeCand(lastTop);
ACT.checkNow = () => { if (!paused) tick(true); };

function cardFromText(text) {
  try { const u = new URL(text, BASE()); const c = u.searchParams.get('card'); if (c != null) return Number(c); } catch { /* URLでない */ }
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
}
function renderScanned() {
  const box = $('#scanned'); if (!box) return;
  box.innerHTML = scannedNow.length ? `<h3>${R('いま{読|よ}んだカード')}</h3><ul class="list">${scannedNow.map(id => itemHtml(BYID.get(id))).join('')}</ul>` : '';
}

/* ---------- 写真1枚でまとめて読む ---------- */
const COLOR_LABEL = { blue: '青', black: '黒', red: '赤', yellow: '黄', green: '緑', purple: '紫', pink: 'ピンク' };
const COLOR_CSS = { blue: '#2f7fd1', black: '#222', red: '#c8323a', yellow: '#e0b100', green: '#2f9a4f', purple: '#7a4bb3', pink: '#d0559b' };
const photoState = { res: null, color: null, rows: [] };

async function readPhoto(file) {
  const out = $('#photoOut'); if (!out) return;
  out.innerHTML = `<p class="scan-status" id="photoStep">${R('{準備|じゅんび}しているよ…')}</p>`;
  try {
    await ensureMatcher();
    const res = await PhotoReader.read(file, step => { const el = $('#photoStep'); if (el) el.textContent = step + '…'; });
    photoState.res = res;
    // いちばん多い色を「自分」に
    const count = {};
    res.items.forEach(it => { count[it.stamp.color] = (count[it.stamp.color] || 0) + 1; });
    photoState.color = Object.keys(count).sort((a, b) => count[b] - count[a])[0] || null;
    photoState.rows = res.items.map(it => ({
      month: it.number.num, id: it.id === 'warp' ? 'warp' : it.id, use: true, color: it.stamp.color,
      cands: it.cands.map(c => c.id), sureCard: it.margin > 0.3 && it.d < 1.6, sureNum: it.number.margin > 0.05 && !it.number.fixedFrom,
      crop: it.crop.toDataURL('image/jpeg', 0.8),
    }));
    if (!$('#photoOut')) return;
    renderPhotoResult();
  } catch (e) {
    console.error(e);
    out.innerHTML = `<p class="note">${R('{読|よ}みこめなかったよ。もう{一度|いちど}{撮|と}ってみてね。')}</p>`;
  }
}

function photoOverview() {
  const { canvas, items } = photoState.res;
  const c = document.createElement('canvas'), k = Math.min(1, 900 / canvas.width);
  c.width = canvas.width * k; c.height = canvas.height * k;
  const x = c.getContext('2d'); x.drawImage(canvas, 0, 0, c.width, c.height);
  x.font = `bold ${Math.max(14, 22 * k)}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
  items.forEach((it, i) => {
    const row = photoState.rows[i], mine = row.color === photoState.color && row.use;
    const cd = it.card;
    x.save(); x.translate(cd.cx * k, cd.cy * k); x.rotate(cd.angle);
    x.lineWidth = 3; x.strokeStyle = mine ? '#ffd400' : 'rgba(255,255,255,.5)';
    x.strokeRect(-cd.side * k / 2, -cd.side * k / 2, cd.side * k, cd.side * k); x.restore();
    if (mine) {
      const r = Math.max(12, it.stamp.r * k * 1.4);
      x.fillStyle = '#ffd400'; x.beginPath(); x.arc(it.stamp.cx * k + it.stamp.r * k * 2.2, it.stamp.cy * k - it.stamp.r * k * 2.2, r, 0, 7); x.fill();
      x.fillStyle = '#222'; x.fillText(String(row.month), it.stamp.cx * k + it.stamp.r * k * 2.2, it.stamp.cy * k - it.stamp.r * k * 2.2 + 1);
    }
  });
  return c.toDataURL('image/jpeg', 0.85);
}

function renderPhotoResult() {
  const out = $('#photoOut'); if (!out || !photoState.res) return;
  const rows = photoState.rows;
  if (!rows.length) {
    out.innerHTML = `<p class="note">${R('スタンプが{見|み}つからなかったよ。カードを{少|すこ}しはなして、{明|あか}るい{所|ところ}で{撮|と}ってみてね。')}</p>`;
    return;
  }
  const colors = [...new Set(rows.map(r => r.color))];
  const mine = rows.map((r, i) => ({ ...r, i })).filter(r => r.color === photoState.color).sort((a, b) => a.month - b.month);
  const dupMonth = new Set(mine.filter(r => r.use).map(r => r.month).filter((m, j, a) => a.indexOf(m) !== j));
  const dupCard = new Set(mine.filter(r => r.use && r.id !== 'warp').map(r => r.id).filter((m, j, a) => a.indexOf(m) !== j));   // ワープは2枚あってよい
  // どこが重なっているかを書く（例：「犬山城が 3月と7月の 2つにあるよ」「5月が 犬山城と徳川美術館の 2つにあるよ」）
  const gatsu = m => `${m}<ruby>月<rt>がつ</rt></ruby>`;
  const cardName = id => id === 'warp' ? 'ワープ' : esc(BYID.get(id).name);
  const dupCardMsg = [...dupCard].map(id => { const ms = mine.filter(r => r.use && r.id === id).map(r => r.month);
    return `<b>${cardName(id)}</b>${R('が')} ${ms.map(gatsu).join('と')}${R('の')} ${ms.length}${R('つにあるよ。')}`; });
  const dupMonthMsg = [...dupMonth].sort((a, b) => a - b).map(m => { const ids = mine.filter(r => r.use && r.month === m).map(r => r.id);
    return `<b>${gatsu(m)}</b>${R('が')} ${ids.map(cardName).join('と')}${R('の')} ${ids.length}${R('つにあるよ。')}`; });
  const cardOptions = (r) => {
    const first = r.cands.filter(id => id !== 'warp').slice(0, 3);
    const rest = CARDS.filter(c => !first.includes(c.id)).sort((a, b) => a.name_kana.localeCompare(b.name_kana, 'ja'));
    return `<option value="warp" ${r.id === 'warp' ? 'selected' : ''}>ワープ（ルートに入らない）</option>
      <optgroup label="候補">${first.map(id => `<option value="${id}" ${r.id === id ? 'selected' : ''}>${esc(BYID.get(id).name)}</option>`).join('')}</optgroup>
      <optgroup label="ほかのカード">${rest.map(c => `<option value="${c.id}" ${r.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`;
  };
  const okCount = mine.filter(r => r.use && r.id !== 'warp').length;
  out.innerHTML = `
    <img class="photo-overview" src="${photoOverview()}" alt="読みとった写真">
    ${colors.length > 1 ? `<p style="margin:12px 0 4px"><b>${R('{自分|じぶん}のスタンプの{色|いろ}は？')}</b></p>
      <div class="chips">${colors.map(c => `<button class="chip" data-act="photoColor" data-v="${c}" aria-pressed="${c === photoState.color}" style="--c:${COLOR_CSS[c] || '#444'}">${COLOR_LABEL[c] || c}（${rows.filter(r => r.color === c).length}）</button>`).join('')}</div>` : ''}
    <p class="muted" style="margin-top:12px">${R('ちがっていたら、{月|つき}やカードを{直|なお}してね。')}<span class="warn-dot"></span>${R('は{自信|じしん}がないところ。')}</p>
    <ol class="photo-list">${mine.map(r => {
      const c = r.id === 'warp' ? null : BYID.get(r.id);
      return `<li class="photo-row${r.use ? '' : ' off'}" style="--c:${c ? c.color : WARP_COLOR}">
        <select class="month-sel${!r.sureNum || dupMonth.has(r.month) ? ' warn' : ''}" data-i="${r.i}" aria-label="月">${Array.from({ length: 12 }, (_, k) => `<option value="${k + 1}" ${r.month === k + 1 ? 'selected' : ''}>${k + 1}月</option>`).join('')}</select>
        <img class="photo-crop" src="${r.crop}" alt="写真のカード">
        <span class="photo-arrow" aria-hidden="true">→</span>
        ${c ? `<img class="photo-tpl" src="cards/${c.id}.jpg" alt="${esc(c.name)}のカード">` : '<span class="photo-tpl"></span>'}
        <label class="photo-use"><input type="checkbox" data-i="${r.i}" ${r.use ? 'checked' : ''}><span>入れる</span></label>
        <select class="card-sel${!r.sureCard || dupCard.has(r.id) ? ' warn' : ''}" data-i="${r.i}" aria-label="カード">${cardOptions(r)}</select>
      </li>`;
    }).join('')}</ol>
    ${dupMonth.size ? `<p class="note">${R('{同|おな}じ{月|つき}がかさなっているよ。たしかめてね。')}<br>${dupMonthMsg.join('<br>')}</p>` : ''}
    ${dupCard.size ? `<p class="note">${R('{同|おな}じカードがかさなっているよ。たしかめてね。')}<br>${dupCardMsg.join('<br>')}</p>` : ''}
    ${okCount ? tabiBox(mine.filter(r => r.use && r.id !== 'warp').map(r => ({ card: BYID.get(r.id), month: r.month })), true) : ''}
    <button class="btn primary" data-act="photoToRoute" ${okCount ? '' : 'disabled'} style="margin-top:12px"><span class="ico">🗺️</span>${R('この{順|じゅん}でルートにする')}（${okCount}か所）</button>`;
  out.querySelectorAll('.month-sel').forEach(el => el.addEventListener('change', () => { photoState.rows[+el.dataset.i].month = +el.value; photoState.rows[+el.dataset.i].sureNum = true; renderPhotoResult(); }));
  out.querySelectorAll('.card-sel').forEach(el => el.addEventListener('change', () => { const v = el.value; photoState.rows[+el.dataset.i].id = v === 'warp' ? 'warp' : Number(v); photoState.rows[+el.dataset.i].sureCard = true; renderPhotoResult(); }));
  out.querySelectorAll('.photo-use input').forEach(el => el.addEventListener('change', () => { photoState.rows[+el.dataset.i].use = el.checked; renderPhotoResult(); }));
}
ACT.photoColor = el => { photoState.color = el.dataset.v; renderPhotoResult(); };
ACT.photoToRoute = () => {
  const mine = photoState.rows.filter(r => r.color === photoState.color && r.use && r.id !== 'warp').sort((a, b) => a.month - b.month);
  const ids = [], months = {};
  for (const r of mine) if (!ids.includes(r.id)) { ids.push(r.id); months[r.id] = r.month; }
  if (!ids.length) return;
  if (S.cur.length && !confirm('いまのルートを、この写真のルートで置きかえますか？')) return;
  S.cur = ids; saveCur(); S.months = months; saveMonths();
  photoState.res = null; photoState.rows = [];
  toast(`${ids.length}か所のルートができたよ`);
  location.hash = '#/route';
};

/* ---------- はじまり ---------- */
async function init() {
  try {
    const res = await fetch('data/cards.json');
    CARDS = (await res.json()).cards;
    try { TRIP = await (await fetch('data/trip_text.json')).json(); } catch { TRIP = null; }   // 旅の文（なくてもアプリは動く）
  } catch {
    $('#main').innerHTML = `<div class="empty"><p>データを読みこめませんでした。電波を確かめて、もう一度開いてください。</p></div>`; return;
  }
  CARDS.sort((a, b) => a.id - b.id).forEach(c => BYID.set(c.id, c));
  CARDS.forEach(c => { c.color = POINT_COLOR[c.points] || WARP_COLOR; });
  S.cur = parseIds(S.cur.join(','));

  // QR（?card=）や共有リンク（?route=）から開いたとき
  const p = new URLSearchParams(location.search);
  if (p.has('card') || p.has('route')) {
    history.replaceState(null, '', location.pathname + location.hash);
    if (p.has('card')) {
      const id = Number(p.get('card'));
      if (BYID.has(id)) { addCard(id); location.hash = '#/route'; }
    } else {
      const ids = parseIds(p.get('route'));
      if (ids.length) location.hash = `#/route/x/${ids.join(',')}`;
    }
  }
  router();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
