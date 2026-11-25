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
const saveCur = () => { save(LS_CUR, S.cur); if (typeof updateNav === 'function') updateNav(); };
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
    title: '', back: false,   // ホームは大きな題字があるので、上のバーには書かない
    html: `
    <section class="hero">
      <div class="stripes"><span style="background:var(--kokuho)"></span><span style="background:var(--juubun)"></span><span style="background:var(--touroku)"></span></div>
      <h2>たてものがたり</h2>
      <p>${R('{持|も}っているカードで、{本当|ほんとう}にめぐる{旅|たび}へ。')}</p>
      <div class="hero-photos">${picks.map(c => photo(c)).join('')}</div>
    </section>
    ${S.pref.helpSeen ? '' : `<a class="resume first" href="#/help"><span style="font-size:28px">🔰</span><span style="flex:1"><b>${R('はじめての{人|ひと}へ')}</b><br><span class="muted">${R('アプリの{使|つか}い{方|かた}を{見|み}る')}</span></span><span aria-hidden="true">›</span></a>`}
    ${n ? `<a class="resume" href="#/route"><span style="font-size:28px">🗺️</span><span style="flex:1"><b>つくりかけのルート</b><br><span class="muted">${n}か所 ・ つづきを見る</span></span><span aria-hidden="true">›</span></a>` : ''}
    <div class="stack">
      <a class="btn primary" href="#/photo"><span class="ico">🗓️</span>${R('{写真|しゃしん}1まいで まとめて{読|よ}む')}</a>
      <a class="btn" href="#/scan"><span class="ico">📷</span>${R('カードをカメラで{読|よ}む')}</a>
      <a class="btn" href="#/select"><span class="ico">🃏</span>${R('{一覧|いちらん}から{選|えら}ぶ')}</a>
      <a class="btn" href="#/zukan"><span class="ico">📖</span>${R('カード{図鑑|ずかん}（{見|み}るだけ）')}</a>
      <a class="btn" href="#/saved"><span class="ico">🔖</span>${R('{保存|ほぞん}したルート')}${S.saved.length ? `（${S.saved.length}）` : ''}</a>
      <a class="btn" href="#/rules"><span class="ico">🎲</span>${R('{遊|あそ}び{方|かた}')}</a>
      <a class="btn" href="#/help"><span class="ico">❓</span>${R('アプリの{使|つか}い{方|かた}')}</a>
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
      <a class="btn ghost" href="#/zukan/${c.id}"><span class="ico">📖</span>${R('{図鑑|ずかん}で もう{少|すこ}しくわしく{見|み}る')}</a>
      ${c.heritage_url ? `<a class="btn ghost" href="${esc(c.heritage_url)}" target="_blank" rel="noopener"><span class="ico">🏛️</span>${R('{文化遺産|ぶんかいさん}オンラインで{見|み}る')}</a>` : ''}
    </div>`,
  };
};

/* ---------- カード図鑑（見るだけ） ---------- */
let MORE = {};   // data/card_more.json：文化遺産オンラインの解説をもとにした、カードより少しくわしい情報
VIEWS.zukan = id => (id !== undefined && id !== '' ? zukanDetail(id) : zukanList());

function zukanList() {
  const cats = [['', 'すべて'], ['国宝', '国宝'], ['重要文化財', '重要文化財'], ['登録有形文化財', '登録有形文化財']];
  return {
    title: R('カード{図鑑|ずかん}'), back: false,
    html: `
    <p class="muted" style="margin-top:0">${R('{気|き}になった{建物|たてもの}をおすと、カードより{少|すこ}しくわしい{話|はなし}と、{文化遺産|ぶんかいさん}オンラインへのリンクが{見|み}られるよ。')}</p>
    <label class="sr" for="zq">さがす</label>
    <input class="search" id="zq" type="search" placeholder="名前や 市・町で さがす（れい：岡崎）" value="${esc(S.zq || '')}" autocomplete="off">
    <div class="chips" role="group" aria-label="区分">${cats.map(([v, l]) => `<button class="chip" data-act="zcat" data-v="${v}" aria-pressed="${(S.zcat || '') === v}">${l}</button>`).join('')}</div>
    <p class="count" id="zcount"></p>
    <ul class="zk-grid" id="zlist"></ul>`,
    after() {
      $('#zq').addEventListener('input', e => { S.zq = e.target.value; renderZukan(); });
      renderZukan();
    },
  };
}
function renderZukan() {
  const q = (S.zq || '').trim().toLowerCase();
  const list = CARDS.filter(c => (!S.zcat || c.category === S.zcat) &&
    (!q || [c.name, c.name_kana, c.city, c.other_name, c.official_name].some(v => String(v || '').toLowerCase().includes(q))));
  $('#zlist').innerHTML = list.map(c => `<li><a class="zk" href="#/zukan/${c.id}" style="--c:${c.color}">
      ${photo(c, 'zk-ph')}
      <span class="zk-nm">${R(c.name_ruby)}</span>
      <span class="zk-sub">${esc(c.city)}</span>
    </a></li>`).join('') || `<li class="empty">見つからなかったよ。ことばを かえてみてね。</li>`;
  $('#zcount').textContent = `${list.length}まい`;
}

function zukanDetail(id) {
  const c = BYID.get(Number(id));
  if (!c) return VIEWS.notfound();
  const m = MORE[c.id] || {};
  const i = CARDS.indexOf(c), prev = CARDS[i - 1], next = CARDS[i + 1];
  const fact = (k, v) => v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '';
  return {
    title: R('カード{図鑑|ずかん}'), back: true,
    html: `
    ${photo(c, 'detail-photo')}
    <div class="detail-head">${pt(c, true)}<div><span class="tag">${esc(c.category)}</span><h2>${R(c.name_ruby)}</h2></div></div>
    ${c.other_name ? `<p class="alias">べつの名前：${esc(c.other_name)}</p>` : ''}
    <p class="catch" style="--c:${c.color}">${esc(c.catchphrase)}</p>
    <p>${esc(c.description)}</p>
    ${m.more ? `<section class="zk-more"><h3>${R('もう{少|すこ}しくわしく')}</h3><p>${esc(m.more)}</p>
      ${m.look && m.look.length ? `<h3>${R('{見|み}どころ')}</h3><ul class="zk-look">${m.look.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</section>` : ''}
    <dl class="facts">
      ${fact('建てた年', m.built)}
      ${fact('つくった人', m.by)}
      ${fact('時代', c.era)}
      ${fact('使いみち', c.use)}
      ${fact('つくり', c.structure)}
      ${fact('ばしょ', m.address || `${c.city}（${c.region}）`)}
      ${m.listed && m.listed.length ? `<dt>文化財に<br>なった日</dt><dd>${m.listed.map(esc).join('<br>')}</dd>` : ''}
    </dl>
    ${c.heritage_url ? `<section class="zk-online">
      <h3>${R('もっと{知|し}りたいときは')}</h3>
      <p>${R('{文化庁|ぶんかちょう}の「{文化遺産|ぶんかいさん}オンライン」に、{正式|せいしき}な{説明|せつめい}がのっているよ。')}</p>
      <a class="btn primary" href="${esc(c.heritage_url)}" target="_blank" rel="noopener"><span class="ico">🏛️</span>${R('{文化遺産|ぶんかいさん}オンラインで{見|み}る')}</a>
    </section>` : ''}
    <div class="stack">
      <a class="btn blue" href="${searchUrl(c)}" target="_blank" rel="noopener"><span class="ico">📍</span>${R('{地図|ちず}で{見|み}る')}</a>
    </div>
    <nav class="zk-pn" aria-label="となりのカード">
      ${prev ? `<button class="btn small" type="button" data-act="zgo" data-id="${prev.id}" data-dir="prev">‹ ${esc(prev.name)}</button>` : '<span></span>'}
      ${next ? `<button class="btn small" type="button" data-act="zgo" data-id="${next.id}" data-dir="next">${esc(next.name)} ›</button>` : '<span></span>'}
    </nav>
    <p class="zk-swipe">${i + 1} / ${CARDS.length}　・　${R('{左右|さゆう}にスライドすると、となりの{文化財|ぶんかざい}へ')}</p>
    <p class="muted" style="font-size:13px">${R('「もう{少|すこ}しくわしく」「{見|み}どころ」は、{文化遺産|ぶんかいさん}オンライン（{文化庁|ぶんかちょう}）の{解説|かいせつ}をもとに、みじかくまとめたものです。')}</p>`,
  };
}

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

/* ---------- 遊び方（説明書と同じ順番・同じ絵） ---------- */
VIEWS.rules = () => {
  const img = (name, alt, cls = '') => `<img class="rimg ${cls}" src="img/rules/${name}.jpg" alt="${alt}" loading="lazy" decoding="async">`;
  const step = (n, head, body, pic) => `<div class="rstep"><div class="rstep-t"><h3><span class="rnum">${n}</span><span>${R(head)}</span></h3><p>${R(body)}</p></div>${pic || ''}</div>`;
  const point = (t, cls = '') => `<p class="rpoint ${cls}"><b>${cls ? 'ちゅうい' : 'ポイント'}</b>${R(t)}</p>`;
  const h2 = (n, t, sub) => `<h2 class="rh"><span class="rh-n">${n}</span><span>${R(t)}</span></h2>${sub ? `<p class="muted rh-sub">${R(sub)}</p>` : ''}`;
  return {
    title: R('{遊|あそ}び{方|かた}'), back: true,
    html: `<div class="rules">
  <div class="rbadges">
    <div><small>${R('{人数|にんずう}')}</small><b>2〜4${R('{人|にん}')}</b></div>
    <div><small>${R('{年齢|ねんれい}')}</small><b>8${R('さい{以上|いじょう}')}</b></div>
    <div><small>${R('{時間|じかん}')}</small><b>${R('{約|やく}30{分|ぷん}')}</b></div>
  </div>

  ${h2(1, 'どんなゲーム？', 'まずは、ゲームの{全体|ぜんたい}を{知|し}ろう')}
  <p>${R('{愛知県|あいちけん}にある{本物|ほんもの}の{建物|たてもの}（{文化財|ぶんかざい}）のカードをめくって、スタンプを{置|お}いて{自分|じぶん}のものにしていくゲームです。4{月|がつ}から3{月|がつ}までの1{年間|ねんかん}で、だれがいちばん{点数|てんすう}の{高|たか}い{建物|たてもの}を{集|あつ}められるかをきそいます。')}</p>
  <div class="rgrid3">
    <figure>${img('game-1', 'うら向きのカードをめくる')}<figcaption><b>① めくる</b>${R('{裏向|うらむ}きのカードをめくると、どんな{建物|たてもの}かがわかります。')}</figcaption></figure>
    <figure>${img('game-2', 'カードにスタンプを置く')}<figcaption><b>${R('② スタンプを{置|お}く')}</b>${R('スタンプを{置|お}いた{建物|たてもの}は、{自分|じぶん}のものになります。')}</figcaption></figure>
    <figure>${img('game-3', 'もっと大きい数字のスタンプを重ねる')}<figcaption><b>${R('③ うばい{合|あ}う')}</b>${R('もっと{大|おお}きい{数字|すうじ}のスタンプを{置|お}かれると、うばわれます。')}</figcaption></figure>
  </div>
  <p class="rgoal">${R('1{年|ねん}がおわったとき、{持|も}っている{建物|たてもの}の{点数|てんすう}の{合計|ごうけい}がいちばん{多|おお}い{人|ひと}の{勝|か}ち！')}</p>

  ${h2(2, '{入|はい}っているもの', 'たりないものはないかな？')}
  <ul class="ritems">
    <li>${img('item-cards', '文化財カード')}<div><b>${R('{文化財|ぶんかざい}カード')}</b><span class="rcount">${R('47{枚|まい}')}</span><br>${R('{愛知県|あいちけん}にある{本物|ほんもの}の{建物|たてもの}のカード。1{点|てん}から6{点|てん}まであります。')}</div></li>
    <li>${img('item-warp', 'ワープカード')}<div><b>${R('ワープカード')}</b><span class="rcount">${R('2{枚|まい}')}</span><br>${R('1{点|てん}のカード。うばうと、{好|す}きな{場所|ばしょ}へ{行|い}けます。')}</div></li>
    <li>${img('item-stamps', 'スタンプ 1から12')}<div><b>${R('スタンプ')}</b><span class="rcount">${R('4{色|しょく}×12{枚|まい}＝48{枚|まい}')}</span><br>${R('1から12までの{数字|すうじ}。{色|いろ}は、くろ・しろ・ピンク・みずいろ。6と9は{下線|かせん}で{見分|みわ}けます。')}</div></li>
    <li>${img('item-pieces', '移動コマ4色')}<div><b>${R('{移動|いどう}コマ')}</b><span class="rcount">${R('4{個|こ}')}</span><br>${R('{自分|じぶん}がいる{場所|ばしょ}をしめすコマ。スタンプと{同|おな}じ4{色|しょく}です。')}</div></li>
    <li>${img('item-dice', 'サイコロ')}<div><b>${R('サイコロ')}</b><span class="rcount">${R('1{個|こ}')}</span><br>${R('1〜3の{数|かず}だけ{進|すす}みます。')}</div></li>
    <li>${img('item-gekoku', '下剋上カード ふつうと下剋上')}<div><b>${R('{下剋上|げこくじょう}カード')}</b><span class="rcount">${R('1{枚|まい}')}</span><br>${R('{表|おもて}が「ふつう」、{裏|うら}が「{下剋上|げこくじょう}」。{今|いま}どちらのルールかをしめします。')}</div></li>
  </ul>

  ${h2(3, 'カードの{見|み}かた', '1まいのカードには、4つのことが{書|か}いてあります')}
  <div class="rcard">${img('card-parts', 'カードの見かた ①点数 ②名前 ③写真 ④ひとこと')}
    <ol class="rparts"><li><b>${R('{点数|てんすう}')}</b>${R('この{建物|たてもの}の{点数|てんすう}（1〜6{点|てん}）。{色|いろ}でも{点数|てんすう}がわかります。')}</li>
    <li><b>${R('{名前|なまえ}')}</b>${R('{建物|たてもの}の{名前|なまえ}。ふりがながつきです。')}</li>
    <li><b>${R('{写真|しゃしん}')}</b>${R('{本物|ほんもの}の{建物|たてもの}の{写真|しゃしん}です。')}</li>
    <li><b>${R('ひとこと')}</b>${R('いつ・どこで{建|た}ったか、どんな{建物|たてもの}か。')}</li></ol></div>
  <div class="rpts"><b>${R('{点数|てんすう}の{色|いろ}')}</b>${[1, 2, 3, 4, 5, 6].map(n => `<span style="background:${POINT_COLOR[n]}">${n}</span>`).join('')}</div>
  <div class="rgrid2">
    <figure>${img('item-warp', 'ワープカード')}<figcaption><b>${R('ワープカード')}</b>${R('1{点|てん}のカードです。くわしくは「ワープカード」へ。')}</figcaption></figure>
    <figure>${img('card-back', 'カードの裏')}<figcaption><b>${R('カードの{裏|うら}')}</b>${R('{裏|うら}は、どのカードも{同|おな}じもようです。めくるまで、{何|なん}の{建物|たてもの}かわかりません。')}</figcaption></figure>
  </div>

  ${h2(4, 'じゅんび', 'この4つで、じゅんびはおしまい')}
  ${step(1, 'カードをならべる', '{文化財|ぶんかざい}カード47{枚|まい}とワープカード2{枚|まい}をよくまぜて、{裏向|うらむ}きのまま、たて7{枚|まい}・よこ7{枚|まい}にならべます。', img('prep-1', '7×7にならべたカード', 'sq'))}
  ${step(2, '{色|いろ}を{決|き}めて、{道具|どうぐ}を{受|う}け{取|と}る', '{一人|ひとり}ずつ{好|す}きな{色|いろ}を{決|き}めて、その{色|いろ}のスタンプ12{枚|まい}（1〜12）と{移動|いどう}コマを1{個|こ}{受|う}け{取|と}ります。スタンプは{自分|じぶん}の{前|まえ}にならべておきましょう。', img('prep-2', 'スタンプ12枚と移動コマ'))}
  ${step(3, '{下剋上|げこくじょう}カードを{置|お}く', '{下剋上|げこくじょう}カードを「ふつう」の{面|めん}を{上|うえ}にして、ならべたカードの{横|よこ}に{置|お}きます。', img('prep-3', '下剋上カードのふつうの面', 'sm'))}
  ${step(4, '{順番|じゅんばん}を{決|き}める', 'じゃんけんで1{番|ばん}の{人|ひと}を{決|き}めます。1{番|ばん}の{人|ひと}の{左|ひだり}どなりが2{番|ばん}、その{左|ひだり}どなりが3{番|ばん}…と、{時計回|とけいまわ}りの{順|じゅん}です。', img('prep-4', '時計回りの順番'))}

  ${h2(5, 'スタート（4{月|がつ}）', '{最初|さいしょ}の{月|つき}は、{全員|ぜんいん}いっしょに')}
  <p>${R('{最初|さいしょ}の{月|つき}（4{月|がつ}）だけは、みんなでいっしょにスタートします。4{人|にん}で{遊|あそ}ぶときの{例|れい}です。')}</p>
  ${step(1, 'さいごの{人|ひと}から{順番|じゅんばん}に、コマを{置|お}く', '{順番|じゅんばん}がさいごの{人|ひと}から{逆|ぎゃく}の{順|じゅん}に、{好|す}きな{裏向|うらむ}きのカードの{上|うえ}に{移動|いどう}コマを{置|お}きます（4{人|にん}なら4{番|ばん}→3{番|ばん}→2{番|ばん}→1{番|ばん}）。ほかの{人|ひと}と{同|おな}じカードには{置|お}けません。', img('start-1', 'コマを置いた順番'))}
  ${step(2, '「せーの」で、いっせいにめくる', '{全員|ぜんいん}が{置|お}きおわったら、コマの{下|した}のカードを{全員|ぜんいん}いっしょに{表|おもて}にします。どんな{建物|たてもの}が{出|で}るかな？', img('start-2', 'いっせいにめくったところ'))}
  ${step(3, '「1」のスタンプを{置|お}く', 'めくったカードに、{自分|じぶん}の「1」のスタンプを{置|お}きます。これで、その{建物|たてもの}は{自分|じぶん}のものです。', img('start-3', '1のスタンプを置いたところ'))}
  ${point('「1」のスタンプは、ここで{使|つか}います。のこりの11{枚|まい}（2〜12）は、5{月|がつ}から3{月|がつ}までの11か{月|げつ}で1{枚|まい}ずつ{使|つか}います。')}

  ${h2(6, '{毎月|まいつき}の{手番|てばん}（5{月|がつ}〜3{月|がつ}）', '{自分|じぶん}の{番|ばん}になったら、1〜4の{順|じゅん}にやろう')}
  <p>${R('5{月|がつ}からは、{順番|じゅんばん}に1{人|にん}ずつ、この4つをします。{全員|ぜんいん}がおわったら、{次|つぎ}の{月|つき}です。')}</p>
  ${step(1, 'サイコロをふる', '1〜3の{数|かず}が{出|で}ます。ふつうのサイコロを{使|つか}うときは、{右|みぎ}のように{読|よ}みかえます（1・6→1マス、2・5→2マス、3・4→3マス）。', img('turn-dice', 'サイコロの読みかえ'))}
  ${step(2, 'たてかよこに{進|すす}む', '{出|で}た{数|かず}だけ、たてかよこに{進|すす}みます。ななめには{進|すす}めません。ならべたカードの{外|そと}には{出|で}られません。', img('turn-move', '2が出たとき、まっすぐ2マス進んだところ（○）。ななめ（×）には行けない', 'sq'))}
  ${step(3, '{裏向|うらむ}きなら、めくる', '{止|と}まったカードが{裏向|うらむ}きなら、{表|おもて}にします。{一度|いちど}{表|おもて}にしたカードは、{最後|さいご}まで{表|おもて}のままです。', img('turn-flip', '裏向きのカードを表にする'))}
  ${step(4, 'スタンプを1{枚|まい}{置|お}く', '{止|と}まったカードに、スタンプを1{枚|まい}かならず{置|お}きます。どの{数字|すうじ}を{置|お}くかは{自由|じゆう}です。{置|お}いたスタンプは、もう{使|つか}えません。', img('turn-stamp', 'カードにスタンプを置く', 'sm'))}
  <div class="rbox"><b>${R('{毎月|まいつき}、{最初|さいしょ}にやる{人|ひと}は{左|ひだり}どなりの{人|ひと}にかわります')}</b>${img('turn-order', '4月、5月、6月と、最初の人が左どなりにかわる')}</div>
  ${point('{手|て}もとにのこっているスタンプの{数|かず}で、{今|いま}が{何月|なんがつ}かわかります。のこり11{枚|まい}なら5{月|がつ}、のこり1{枚|まい}なら3{月|がつ}です。')}

  ${h2(7, 'スタンプでうばい{合|あ}う', 'いちばん{大事|だいじ}なルール')}
  <p class="rgoal">${R('いちばん{上|うえ}にあるスタンプの{色|いろ}の{人|ひと}が、その{建物|たてもの}の{持|も}ち{主|ぬし}です。')}</p>
  <div class="rgrid2 rfight">
    <figure><figcaption class="top"><b>${R('{大|おお}きい{数字|すうじ}で、うばおう')}</b></figcaption>${img('fight-1', 'ピンクの5の上に、みずいろの9')}<figcaption><span class="ok">${R('みずいろの{人|ひと}のものになった！')}</span>${R('ほかの{人|ひと}の{建物|たてもの}に、いちばん{上|うえ}より{大|おお}きい{数字|すうじ}を{置|お}くと、うばえます。')}</figcaption></figure>
    <figure><figcaption class="top"><b>${R('{同|おな}じ{数字|すうじ}では、うばえない')}</b></figcaption>${img('fight-2', 'くろの7と、ピンクの7')}<figcaption><span>${R('くろの{人|ひと}のまま')}</span>${R('{同|おな}じ{数字|すうじ}のときは、{先|さき}に{置|お}いた{人|ひと}のままです。ピンクのスタンプは、いちばん{上|うえ}のすぐ{下|した}に{入|い}れます。')}</figcaption></figure>
    <figure><figcaption class="top"><b>${R('{負|ま}ける{数字|すうじ}を{置|お}いてもいい')}</b></figcaption>${img('fight-3', 'しろの10の下に、みずいろの2')}<figcaption><span>${R('しろの{人|ひと}のまま')}</span>${R('{小|ちい}さい{数字|すうじ}を{使|つか}いたいときは、わざと{負|ま}けてもかまいません。{負|ま}けたスタンプは、いちばん{上|うえ}のすぐ{下|した}に{入|い}れます。')}</figcaption></figure>
    <figure><figcaption class="top"><b>${R('{自分|じぶん}の{建物|たてもの}を{守|まも}る')}</b></figcaption>${img('fight-4', 'ピンクの4の上に、ピンクの11')}<figcaption><span class="ok">${R('うばわれにくくなった！')}</span>${R('{自分|じぶん}の{建物|たてもの}に{大|おお}きい{数字|すうじ}を{重|かさ}ねておくと、ほかの{人|ひと}にうばわれにくくなります。')}</figcaption></figure>
  </div>
  ${point('{置|お}いたスタンプは、{最後|さいご}まで{取|と}りのぞきません。うばわれた{建物|たてもの}も、もっと{大|おお}きい{数字|すうじ}で{取|と}り{返|かえ}せます。')}

  ${h2(8, 'ワープカード', 'うばうと、{好|す}きな{場所|ばしょ}へ{行|い}ける')}
  <p>${R('ワープカードは、まん{中|なか}に「ワープ」と{書|か}いてある1{点|てん}のカードです。{建物|たてもの}と{同|おな}じようにスタンプを{置|お}けます。')}</p>
  ${step(1, 'ほかの{人|ひと}のワープカードをうばう', 'ほかの{人|ひと}が{持|も}っているワープカードに、もっと{大|おお}きい{数字|すうじ}のスタンプを{置|お}いて、うばいます。', img('warp-1', 'ワープカードの3の上に8', 'sm'))}
  ${step(2, '{表向|おもてむ}きのカードへ、ワープ！', 'うばったら、{表向|おもてむ}きのカードならどこへでも{移動|いどう}できます。{裏向|うらむ}きのカードには{行|い}けません。', img('warp-2', '行けるのは表向きのカード（○）', 'sq'))}
  ${step(3, 'ワープした{先|さき}では、スタンプを{置|お}かない', 'ワープカードにスタンプを{置|お}いたので、その{番|ばん}はこれでおしまい。ワープした{先|さき}のカードでは、スタンプを{置|お}かず、うばうこともできません。')}
  ${point('ワープできるのは、ほかの{人|ひと}のワープカードをうばったときだけです。だれも{持|も}っていないワープカードや、{自分|じぶん}のワープカードにスタンプを{置|お}いても、ワープはできません。', 'warn')}

  ${h2(9, '{下剋上|げこくじょう}', '{強|つよ}さがひっくり{返|かえ}る！')}
  <p class="rgek">${R('{戦国時代|せんごくじだい}の{言葉|ことば}で、{家来|けらい}が{殿様|とのさま}に{勝|か}つように「{下|した}の{者|もの}が{上|うえ}の{者|もの}に{勝|か}つ」こと。このゲームでは、{小|ちい}さい{数字|すうじ}が{大|おお}きい{数字|すうじ}に{勝|か}つようになります。')}</p>
  ${step(1, 'どこかの{建物|たてもの}に、4{枚目|まいめ}のスタンプが{置|お}かれたら', 'どの{建物|たてもの}でも、スタンプが4{枚目|まいめ}になったら{下剋上|げこくじょう}がおきます。{下剋上|げこくじょう}カードをひっくり{返|かえ}しましょう。', img('gek-1', '4枚目のスタンプで下剋上カードをひっくり返す'))}
  ${img('gek-scale', 'ふつうは大きい数字が強い。下剋上は小さい数字が強い', 'wide')}
  ${step(2, '{下剋上|げこくじょう}のあいだは、{小|ちい}さい{数字|すうじ}でうばう', 'いちばん{上|うえ}のスタンプより{小|ちい}さい{数字|すうじ}を{置|お}くと、うばえます。', img('gek-2', 'くろの9の上にピンクの2で、ピンクのものに'))}
  ${step(3, 'また4{枚目|まいめ}が{置|お}かれたら、{元|もと}にもどる', '{別|べつ}の{建物|たてもの}でまた4{枚目|まいめ}のスタンプが{置|お}かれたら、カードをもう{一度|いちど}ひっくり{返|かえ}して「ふつう」にもどします。', img('gek-3', '下剋上からふつうにもどす'))}
  ${point('4{枚目|まいめ}のスタンプが{勝|か}つか{負|ま}けるかは、ひっくり{返|かえ}す{前|まえ}のルールで{決|き}めます。{下剋上|げこくじょう}がおきても、それまでの{建物|たてもの}の{持|も}ち{主|ぬし}はかわりません。')}

  ${h2(10, 'ゲームのおわりと{点数|てんすう}', '1{年|ねん}がおわったら、{点数|てんすう}を{数|かぞ}えよう')}
  ${step(1, '3{月|がつ}がおわったら、ゲームおしまい', '{全員|ぜんいん}が12{枚|まい}のスタンプをぜんぶ{使|つか}ったら、ゲームはおわりです。', img('end-1', 'スタンプを使いきった'))}
  ${step(2, '{自分|じぶん}の{建物|たてもの}の{点数|てんすう}を{足|た}す', 'いちばん{上|うえ}が{自分|じぶん}のスタンプになっている{建物|たてもの}の{点数|てんすう}を、ぜんぶ{足|た}します（ピンクの{人|ひと}の{例|れい}）。', img('end-2', 'いちばん上がピンクなら○、ちがえば×'))}
  <h3 class="rh3">${R('ボーナス')}</h3>
  <div class="rgrid2">
    <figure>${img('end-bonus1', 'スタンプがたくさん重なった建物')}<figcaption><b>${R('いちばん{取|と}り{合|あ}いになった{建物|たてもの}')} <span class="rplus">${R('+3{点|てん}')}</span></b>${R('スタンプがいちばんたくさん{重|かさ}なっている{建物|たてもの}の{持|も}ち{主|ぬし}は、3{点|てん}もらえます。{同|おな}じ{枚数|まいすう}の{建物|たてもの}がいくつかあれば、それぞれの{持|も}ち{主|ぬし}がもらえます。')}</figcaption></figure>
    <figure>${img('end-bonus2', '1点の建物が3枚')}<figcaption><b>${R('くらしの{建物|たてもの}')} <span class="rplus">${R('1{点|てん}→2{点|てん}')}</span></b>${R('1{点|てん}の{建物|たてもの}をいちばん{多|おお}く{持|も}っている{人|ひと}は、1{点|てん}の{建物|たてもの}が1{枚|まい}2{点|てん}になります。{同|おな}じ{枚数|まいすう}なら{全員|ぜんいん}です。')}</figcaption></figure>
  </div>
  <div class="rbox"><b>${R('{計算|けいさん}の{例|れい}')}</b>${img('end-calc', '6点、4点、3点、1点の建物3枚で2×3、合計19点', 'wide')}<p>${R('1{点|てん}の{建物|たてもの}を3{枚|まい}{持|も}っていて、それがいちばん{多|おお}かったので、1{枚|まい}2{点|てん}になりました。')}</p></div>
  <p class="rgoal">${R('{合計|ごうけい}がいちばん{多|おお}い{人|ひと}の{勝|か}ち！ {同点|どうてん}のときは、{全員|ぜんいん}が{勝|か}ちです。')}</p>

  ${h2(11, 'こまったときは', 'わからなくなったら、ここを{見|み}よう')}
  <dl class="rqa">
    <dt>${R('{同|おな}じ{数字|すうじ}を{置|お}いたら、どうなるの？')}</dt><dd>${R('{先|さき}に{置|お}いた{人|ひと}のままです。あとから{置|お}いたスタンプは、いちばん{上|うえ}のすぐ{下|した}に{入|い}れます。')}</dd>
    <dt>${R('うばえる{数字|すうじ}がのこっていないときは？')}</dt><dd>${R('{負|ま}ける{数字|すうじ}を{置|お}きましょう。スタンプは{毎月|まいつき}かならず1{枚|まい}{置|お}きます。')}</dd>
    <dt>${R('うばわれた{建物|たてもの}は、{取|と}り{返|かえ}せる？')}</dt><dd>${R('はい。もっと{強|つよ}い{数字|すうじ}を{置|お}けば、{何回|なんかい}でも{取|と}り{返|かえ}せます。')}</dd>
    <dt>${R('{置|お}いたスタンプは{取|と}りのぞくの？')}</dt><dd>${R('{取|と}りのぞきません。{最後|さいご}まで{重|かさ}ねたままにします。')}</dd>
    <dt>${R('{自分|じぶん}のワープカードでもワープできる？')}</dt><dd>${R('できません。ワープできるのは、ほかの{人|ひと}のワープカードをうばったときだけです。')}</dd>
    <dt>${R('{下剋上|げこくじょう}のとき、4{枚目|まいめ}のスタンプはどっちのルール？')}</dt><dd>${R('ひっくり{返|かえ}す{前|まえ}のルールで、{勝|か}ち{負|ま}けを{決|き}めます。その{後|あと}のスタンプから、{新|あたら}しいルールになります。')}</dd>
  </dl>

  <div class="rafter"><h2>${R('ゲームのあとは、{本物|ほんもの}を{見|み}に{行|い}こう！')}</h2>
    <p>${R('カードの{建物|たてもの}は、ぜんぶ{愛知県|あいちけん}にある{本物|ほんもの}の{文化財|ぶんかざい}です。{最後|さいご}に{持|も}っていたカードをこのアプリに{入|い}れると、めぐるルートができるよ。{写真|しゃしん}とはちがう、{本物|ほんもの}の{大|おお}きさや{形|かたち}にびっくりするかもしれません。')}</p>
    ${img('after', 'カードの建物の写真', 'wide')}</div>
  </div>`,
  };
};

/* ---------- アプリの使い方 ---------- */
const HELP_TOC = [
  ['h-flow', '{全体|ぜんたい}の{流|なが}れ'],
  ['h-photo', '{写真|しゃしん}1まいで まとめて{読|よ}む'],
  ['h-scan', 'カードをカメラで{読|よ}む'],
  ['h-select', '{一覧|いちらん}から{選|えら}ぶ'],
  ['h-route', 'ルートの{確認|かくにん}と{案内|あんない}'],
  ['h-card', 'カードのくわしい{情報|じょうほう}'],
  ['h-saved', '{保存|ほぞん}・{共有|きょうゆう}'],
  ['h-home', 'スマホのホーム{画面|がめん}に{置|お}く'],
  ['h-trouble', 'こまったときは'],
];
VIEWS.help = () => {
  if (!S.pref.helpSeen) { S.pref.helpSeen = true; savePref(); }
  const L = s => `<li>${R(s)}</li>`;
  const sec = (id, ico, body) => `<section class="help-sec" id="${id}"><h2 tabindex="-1"><span class="ico" aria-hidden="true">${ico}</span><span>${R(HELP_TOC.find(t => t[0] === id)[1])}</span></h2>${body}</section>`;
  return {
    title: R('アプリの{使|つか}い{方|かた}'), back: true,
    html: `<div class="rules help">
  <div class="box">${R('このアプリは、ゲームの{最後|さいご}に{持|も}っていたカードから、{本当|ほんとう}にめぐる{旅|たび}のルートを{作|つく}るよ。{画面|がめん}の{下|した}のボタン（ホーム・しゃしん・ずかん・ルート・ほぞん）で、どの{画面|がめん}からでも{移動|いどう}できるよ。{遊|あそ}び{方|かた}とこのページは、ホームから{開|ひら}けるよ。')}</div>
  <nav class="help-toc" aria-label="もくじ"><b>${R('もくじ')}</b><ol>${HELP_TOC.map(([id, t]) => `<li><button type="button" data-act="jump" data-to="${id}">${R(t)}</button></li>`).join('')}</ol></nav>

  ${sec('h-flow', '🧭', `<ol class="help-steps">
    ${L('ゲームが{終|お}わったら、{自分|じぶん}が{持|も}っているカードを{集|あつ}める。')}
    ${L('カードをアプリに{入|い}れる。{入|い}れ{方|かた}は3つ：「{写真|しゃしん}1まいで まとめて{読|よ}む」「カードをカメラで{読|よ}む」「{一覧|いちらん}から{選|えら}ぶ」。')}
    ${L('「ルートの{確認|かくにん}」で、{旅|たび}のタイトルと{文|ぶん}、めぐる{順番|じゅんばん}を{見|み}る。')}
    ${L('「Googleマップで{案内|あんない}」で{出|で}かける。{今日|きょう}{行|い}かないときは「{保存|ほぞん}」しておく。')}
  </ol>
  <p class="muted">${R('1{日|にち}でぜんぶ{回|まわ}らなくてだいじょうぶ。{季節|きせつ}ごとに{少|すこ}しずつ{行|い}こう。')}</p>`)}

  ${sec('h-photo', '🗓️', `<p>${R('いちばんかんたんな{入|い}れ{方|かた}。{月|つき}のスタンプ（{数字|すうじ}コマ）をのせたまま、カードを{並|なら}べて1まい{撮|と}るだけ。')}</p>
  <ol class="help-steps">
    ${L('カードどうしを{少|すこ}しはなして{机|つくえ}に{並|なら}べる。')}
    ${L('{明|あか}るい{所|ところ}で、{自分|じぶん}の{席|せき}から{真上|まうえ}に{近|ちか}い{角度|かくど}で、カードが{全部|ぜんぶ}{入|はい}るように「{写真|しゃしん}を{撮|と}る」。{前|まえ}に{撮|と}った{写真|しゃしん}なら「アルバム」から{選|えら}ぶ。')}
    ${L('「{自分|じぶん}のスタンプの{色|いろ}は？」で、{自分|じぶん}の{色|いろ}を{選|えら}ぶ。ほかの{人|ひと}のカードが{写|うつ}っていても、{自分|じぶん}の{色|いろ}だけが{使|つか}われるよ。')}
    ${L('{読|よ}んだ{月|つき}とカードを{見|み}て、ちがっていたら{直|なお}す。{自信|じしん}がないところには{印|しるし}がつくよ。')}
    ${L('{同|おな}じ{月|つき}や{同|おな}じカードが2つあると、「{何月|なんがつ}と{何月|なんがつ}」のように{教|おし}えてくれるので、たしかめる。')}
    ${L('「この{順|じゅん}でルートにする」をおす。スタンプの{数字|すうじ}の{小|ちい}さい{順|じゅん}（＝ゲームでめぐった{順|じゅん}）にならぶよ。')}
  </ol>`)}

  ${sec('h-scan', '📷', `<ol class="help-steps">
    ${L('カメラの{使用|しよう}を{許可|きょか}する。')}
    ${L('カードを{机|つくえ}に{置|お}いて、{画面|がめん}の{枠|わく}にぴったり{合|あ}わせる。{読|よ}めたらカードが{追加|ついか}されるよ。')}
    ${L('{続|つづ}けて{次|つぎ}のカードを{映|うつ}せば、{何|なん}まいでも{入|い}れられる。{読|よ}みにくいときは「いま{調|しら}べる」をおす。')}
    ${L('{終|お}わったら「ルートを{見|み}る」。')}
  </ol>`)}

  ${sec('h-select', '🃏', `<ul>
    ${L('47まいのカードが{並|なら}んでいるので、{持|も}っているカードの{右|みぎ}の□をおしてチェックする。')}
    ${L('{上|うえ}の{検索|けんさく}らんに{名前|なまえ}や{市|し}・{町|まち}を{入|い}れたり、{点数|てんすう}・{区分|くぶん}・{地区|ちく}のボタンでしぼりこんだりできる。')}
    ${L('カードの{写真|しゃしん}や{名前|なまえ}をおすと、くわしい{情報|じょうほう}が{見|み}られる。')}
    ${L('{選|えら}び{終|お}わったら、{下|した}の「ルートを{見|み}る」をおす。')}
  </ul>`)}

  ${sec('h-route', '🗺️', `<ul>
    ${L('いちばん{上|うえ}の「あなたの{旅|たび}」に、{選|えら}んだカードに{合|あ}った{旅|たび}のタイトルと{文|ぶん}が{出|で}るよ。')}
    ${L('{順番|じゅんばん}は ▲▼ で{入|い}れかえ、✕ でルートからはずせる。')}
    ${L('「{行|い}き{方|かた}」で、その{場所|ばしょ}までの{道|みち}をGoogleマップで{見|み}られる。')}
    ${L('のりもの（🚃{電車|でんしゃ}・バス／🚗{車|くるま}／🚶{歩|ある}き）を{選|えら}んで、「Googleマップで{案内|あんない}」の「{案内|あんない}をはじめる」をおすと、ぜんぶの{場所|ばしょ}をつないだ{案内|あんない}が{開|ひら}く。「{今|いま}いる{場所|ばしょ}から{出発|しゅっぱつ}」にすると、{今|いま}いる{所|ところ}からの{案内|あんない}になる。')}
    ${L('{一度|いちど}に{寄|よ}れるのは9か{所|しょ}まで。それより{多|おお}いときは、{区間|くかん}に{分|わ}けて{出|で}るよ。')}
    ${L('「カードを{足|た}す」で{追加|ついか}、「ルートをぜんぶ{消|け}す」で{最初|さいしょ}からやり{直|なお}せる。')}
  </ul>`)}

  ${sec('h-card', '🏯', `<ul>
    ${L('カードをおすと、{大|おお}きな{写真|しゃしん}、{名前|なまえ}、{点数|てんすう}、ひとこと、{説明|せつめい}、{場所|ばしょ}・{使|つか}いみち・つくりが{見|み}られる。')}
    ${L('「{地図|ちず}で{見|み}る」でGoogleマップ、「{文化遺産|ぶんかいさん}オンラインで{見|み}る」で、もっとくわしい{紹介|しょうかい}ページが{開|ひら}く。')}
    ${L('「ルートに{入|い}れる」「ルートからはずす」も、ここからできる。')}
    ${L('{下|した}の「ずかん」では、ルートに{入|い}れずに、ぜんぶのカードを{見|み}るだけで{楽|たの}しめる。カードより{少|すこ}しくわしい{話|はなし}・{見|み}どころ・{建|た}てた{年|とし}・{住所|じゅうしょ}と、{文化遺産|ぶんかいさん}オンラインのリンクがのっている。')}
  </ul>`)}

  ${sec('h-saved', '🔖', `<ul>
    ${L('ルートの{確認|かくにん}の「{保存|ほぞん}」で、ルートをとっておける。{下|した}の「ほぞん」から、{開|ひら}く・{案内|あんない}・{共有|きょうゆう}・{消|け}すができる。')}
    ${L('「{共有|きょうゆう}」で、ルートのリンクを{家族|かぞく}や{友|とも}だちに{送|おく}れる。もらった{人|ひと}は、リンクを{開|ひら}くと{同|おな}じルートが{見|み}られて、{保存|ほぞん}もできる。')}
    ${L('{保存|ほぞん}したルートは、このスマホの{中|なか}だけにあるよ。{機種変更|きしゅへんこう}のときは「ファイルに{書|か}き{出|だ}す」で{保存|ほぞん}して、{新|あたら}しいスマホで「{読|よ}みこむ」。')}
  </ul>`)}

  ${sec('h-home', '📱', `<p>${R('ホーム{画面|がめん}に{置|お}くと、アプリのようにすぐ{開|ひら}けるよ（インストールはいらない）。')}</p>
  <ul>
    ${L('iPhone（Safari）：{下|した}の{共有|きょうゆう}ボタン（□に↑）→「ホーム{画面|がめん}に{追加|ついか}」。')}
    ${L('Android（Chrome）：{右上|みぎうえ}の︙ →「ホーム{画面|がめん}に{追加|ついか}」または「アプリをインストール」。')}
  </ul>`)}

  ${sec('h-trouble', '🛟', `<ul>
    ${L('{写真|しゃしん}やカメラでうまく{読|よ}めない：{明|あか}るい{所|ところ}で、ぼけないように{撮|と}り{直|なお}す。それでもだめなら「{一覧|いちらん}から{選|えら}ぶ」で{入|い}れられるよ。')}
    ${L('カメラが{使|つか}えない：スマホの{設定|せってい}で、ブラウザのカメラを「{許可|きょか}」にする。')}
    ${L('{新|あたら}しくなったはずなのに{前|まえ}のまま：アプリ（ブラウザのタブ）を1{度|ど}{閉|と}じて、{開|ひら}き{直|なお}す。')}
    ${L('{今|いま}いる{場所|ばしょ}は、このアプリからはどこにも{送|おく}らないよ（{案内|あんない}のときにGoogleマップが{使|つか}うだけ）。')}
  </ul>
  <a class="btn" href="#/rules" style="margin-top:12px"><span class="ico">🎲</span>${R('ゲームの{遊|あそ}び{方|かた}を{見|み}る')}</a>`)}
  </div>`,
  };
};

VIEWS.notfound = () => ({ title: 'みつかりません', back: true, html: `<div class="empty"><p>${R('{見|み}つからなかったよ。')}</p><a class="btn" href="#/">ホームへ</a></div>` });

/* ---------- ルーター ---------- */
function router() {
  stopScan();
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
  const page = parts[0] || 'home';
  let v;
  if (page === 'route') v = VIEWS.route(parts[1] || 'cur', parts[2]);
  else if (page === 'card') v = VIEWS.card(parts[1]);
  else if (page === 'zukan') v = VIEWS.zukan(parts[1]);
  else v = (VIEWS[page] || VIEWS.notfound)();
  $('#title').innerHTML = v.title;
  $('#back').hidden = !v.back;
  $('#main').innerHTML = v.html;
  document.title = page === 'home' ? 'たてものがたり' : `${v.title.replace(/<rt>.*?<\/rt>/g, '').replace(/<[^>]+>/g, '')} | たてものがたり`;
  if (v.after) v.after();
  updateNav(page);
  window.scrollTo(0, 0);
}

/* ---------- 下のナビ（どの画面からでも移動できる） ---------- */
var navPage = 'home';   // var：保存の関数から先に呼ばれても大丈夫なように
function updateNav(page) {
  if (page !== undefined) navPage = page;
  document.querySelectorAll('#tabs [data-page]').forEach(a => {
    if (a.dataset.page === navPage) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const n = S.cur.length, b = $('#tabCount');
  if (b) { b.hidden = !n; b.textContent = n; }
  const rt = document.querySelector('#tabs [data-page=route]');
  if (rt) rt.setAttribute('aria-label', n ? `ルート（${n}か所）` : 'ルート');
}
function rerender() { const y = window.scrollY; router(); window.scrollTo(0, y); }

/* ---------- 操作 ---------- */
const ACT = {
  back() { if (navStack.length > 1) history.back(); else location.hash = '#/'; },
  jump(el) { const t = document.getElementById(el.dataset.to); if (t) { t.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); t.querySelector('h2').focus({ preventScroll: true }); } },
  detail(el) { location.hash = `#/card/${el.dataset.id}`; },
  zgo(el) { zukanGo(Number(el.dataset.id), el.dataset.dir); },
  zcat(el) { S.zcat = el.dataset.v; document.querySelectorAll('[data-act=zcat]').forEach(b => b.setAttribute('aria-pressed', b === el)); renderZukan(); },
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
let navReplace = false;   // 図鑑でとなりへ移るときは、履歴を積まない（「もどる」で一覧へもどれるように）
window.addEventListener('hashchange', () => {
  if (navReplace) { navStack[navStack.length - 1] = location.hash; navReplace = false; }
  else if (navStack.length > 1 && navStack[navStack.length - 2] === location.hash) navStack.pop(); else navStack.push(location.hash);
  router();
});

/* ---------- 図鑑：左右にスライドして、となりの文化財へ ---------- */
function zukanGo(id, dir) {
  if (!BYID.has(id)) return;
  navReplace = true;
  location.replace(`#/zukan/${id}`);
  const m = $('#main');
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    m.classList.remove('slide-next', 'slide-prev'); void m.offsetWidth; m.classList.add(dir === 'prev' ? 'slide-prev' : 'slide-next');
  }
}
(() => {
  let x0 = null, y0 = 0, t0 = 0;
  const onDetail = () => /^#\/zukan\/\d+$/.test(location.hash);
  document.addEventListener('touchstart', e => {
    if (!onDetail() || e.touches.length !== 1 || e.target.closest('input, textarea, select')) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (x0 === null || !onDetail()) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - t0 > 900) return;   // たてのスクロールや、ゆっくりした動きは無視
    const i = CARDS.findIndex(c => c.id === Number(location.hash.split('/')[2]));
    const to = CARDS[i + (dx < 0 ? 1 : -1)];   // 左へ払う＝つぎ、右へ払う＝まえ
    if (to) zukanGo(to.id, dx < 0 ? 'next' : 'prev');
  }, { passive: true });
})();

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
    try { MORE = (await (await fetch('data/card_more.json')).json()).cards || {}; } catch { MORE = {}; }   // 図鑑のくわしい情報（なくても動く）
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
