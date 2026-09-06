/* RAID PANEL 共通ロジック。index.html と dock.html の両方が読む */
(function(){
'use strict';

/* ---------- 表示モード ---------- */
// wide = 通常のブラウザ窓 / dock = OBSのカスタムブラウザドック（狭い縦長）
var MODE = document.body.getAttribute('data-mode') === 'dock' ? 'dock' : 'wide';
var IN_OBS = !!window.obsstudio;

// 音・通知・配色は画面ごとに分けて覚える。ブラウザ版では音を鳴らしたいが
// ドック版では鳴らしたくない、という使い分けが普通に起きるため。
// ログイン・チャンネル・履歴・送信制限は共有したいので分けない
function mkey(k){ return MODE === 'dock' ? k + '.dock' : k; }

/* ---------- 設定 ---------- */
var DEFAULTS = {
  CLIENT_ID: '', REDIRECT_URI: '', CHANNEL: '',
  AUTO_SHOUTOUT: true, SOUND: true, THEME: 'light',
  THANKS_TEMPLATE: '{name}さん、{count}人でのレイドありがとうございました！\nhttps://twitch.tv/{login}'
};
var CFG = Object.assign({}, DEFAULTS, window.RAIDPANEL_CONFIG || {});
var SCOPES = ['moderator:manage:shoutouts'];
var SO_GLOBAL_MS = 125000;    /* 2分 + 余裕 */
var SO_TARGET_MS = 3605000;   /* 60分 + 余裕 */

/* ---------- 保存 ---------- */
var LS = {
  get: function(k, d){ try{ var v = localStorage.getItem('raidpanel.'+k); return v===null?d:JSON.parse(v); }catch(e){ return d; } },
  set: function(k, v){ try{ localStorage.setItem('raidpanel.'+k, JSON.stringify(v)); }catch(e){} },
  del: function(k){ try{ localStorage.removeItem('raidpanel.'+k); }catch(e){} }
};

var S = {
  token: LS.get('token', null),
  me: null,
  scopes: [],
  channel: LS.get('channel', CFG.CHANNEL || ''),
  auto: LS.get('auto', CFG.AUTO_SHOUTOUT),
  sound: LS.get(mkey('sound'), MODE === 'dock' ? false : CFG.SOUND),
  notify: LS.get(mkey('notify'), false),
  theme: LS.get(mkey('theme'), CFG.THEME),
  history: LS.get('history', []),
  lastSoAt: LS.get('lastSoAt', 0),
  targetSo: LS.get('targetSo', {}),
  current: null,
  queue: [],
  recent: [],
  sending: false
};

/* ---------- DOM ---------- */
var $ = function(id){ return document.getElementById(id); };

// 中身は透明にして、CSSの背景（--fill）を透かせる。
// 色を焼き込むと、ダークにしたときだけ丸が白く浮いてしまう
var AVATAR_BLANK = 'data:image/svg+xml;utf8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"/>');
var el = {};
['dChat','dEs','dAuth','authName','authNote','btnTheme','btnTest','empty','card','cAv','cName','cCnt',
 'cLogin','cTitle','cGame','cDesc','cLink','cUrl','soStatus','btnSo','btnCopyUrl','btnCopyThanks','thanks',
 'inCh','btnConnect','btnLogin','btnLogout','inToken','btnToken','cbAuto','cbSound','cbNotify',
 'hist','btnCsv','btnClearHist','histNote','log','toast',
 'btnHandoff','inHandoff','btnHandoffUse','obsBadge',
 'meCard','meAv','meAvSm','meName','meLogin','credit'].forEach(function(k){ el[k] = $(k); });

// index.html と dock.html で部品がずれると、原因の分かりにくい壊れ方をする。
// 起動時に足りない部品を画面に出して止める
var missing = Object.keys(el).filter(function(k){ return !el[k]; });
if(missing.length){
  document.body.insertAdjacentHTML('afterbegin',
    '<div style="padding:16px;background:#CC0052;color:#fff;font-weight:600;' +
    'font-family:-apple-system,system-ui,sans-serif">' +
    '画面の部品が足りません：' + missing.join(', ') + '</div>');
  throw new Error('missing elements: ' + missing.join(','));
}

/* ---------- 小物 ---------- */
function log(msg, lv){
  var li = document.createElement('li');
  var d = new Date();
  li.className = lv || '';
  li.textContent = String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+'  '+msg;
  el.log.insertBefore(li, el.log.firstChild);
  while(el.log.children.length > 120) el.log.removeChild(el.log.lastChild);
}
function toast(msg){
  el.toast.textContent = msg; el.toast.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(function(){ el.toast.classList.remove('show'); }, 1600);
}
function setDot(node, on){ node.classList.toggle('on', !!on); }
function fmtWait(ms){
  var s = Math.ceil(ms/1000);
  return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
}
function copy(text){
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){ toast('コピーしました'); },
      function(){ fallbackCopy(text); });
  } else { fallbackCopy(text); }
}
function fallbackCopy(text){
  var ta = document.createElement('textarea');
  ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
  document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); toast('コピーしました'); }catch(e){ toast('コピーに失敗しました'); }
  document.body.removeChild(ta);
}
function beep(){
  if(!S.sound) return;
  try{
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if(!Ctx) return;
    var ctx = beep._ctx || (beep._ctx = new Ctx());
    [880, 1320].forEach(function(f, i){
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type='sine'; o.frequency.value=f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i*0.14);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i*0.14 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i*0.14 + 0.22);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + i*0.14); o.stop(ctx.currentTime + i*0.14 + 0.24);
    });
  }catch(e){}
}
function desktopNotify(raid){
  if(!S.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  try{ new Notification('レイドが来ました', { body: raid.displayName + ' さん / ' + raid.viewers + '人' }); }catch(e){}
}

/* ---------- 接続の後始末 ---------- */

// 古い接続を閉じるときは、後始末の処理を先に外してから閉じる。
// 付けたまま閉じると onclose の「切れたからつなぎ直す」が走り、
// たった今作った新しい接続まで巻き込んで永久に繰り返してしまう
function closeSocket(sock){
  if(!sock) return;
  try{
    sock.onopen = null;
    sock.onmessage = null;
    sock.onclose = null;
    sock.onerror = null;
    sock.close();
  }catch(e){}
}

/* ---------- Twitch IRC（認証なしでレイドを受け取る） ---------- */
var irc = null, ircBackoff = 1000, ircWanted = false;

function parseTags(raw){
  var out = {};
  raw.split(';').forEach(function(kv){
    var i = kv.indexOf('=');
    var k = i < 0 ? kv : kv.slice(0, i);
    var v = i < 0 ? '' : kv.slice(i+1);
    out[k] = v.replace(/\\s/g,' ').replace(/\\:/g,';').replace(/\\r/g,'').replace(/\\n/g,'').replace(/\\\\/g,'\\');
  });
  return out;
}

function ircConnect(){
  if(!S.channel){ log('チャンネル名が未入力です', 'warn'); return; }
  ircWanted = true;
  closeSocket(irc);
  irc = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  irc.onopen = function(){
    irc.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    irc.send('NICK justinfan' + (10000 + Math.floor(Math.random()*80000)));
    irc.send('JOIN #' + S.channel.toLowerCase());
    ircBackoff = 1000;
    setDot(el.dChat, true);
    log('RAIDチェッカーを起動しました（#' + S.channel + '）', 'ok');
  };
  irc.onmessage = function(ev){
    String(ev.data).split('\r\n').forEach(function(line){ if(line) handleIrcLine(line); });
  };
  irc.onclose = function(){
    setDot(el.dChat, false);
    if(ircWanted){
      log('接続が切れました。' + Math.round(ircBackoff/1000) + '秒後につなぎ直します', 'warn');
      setTimeout(ircConnect, ircBackoff);
      ircBackoff = Math.min(ircBackoff * 2, 30000);
    }
  };
  irc.onerror = function(){};
}

function handleIrcLine(line){
  if(line.indexOf('PING') === 0){ try{ irc.send('PONG :tmi.twitch.tv'); }catch(e){} return; }
  if(line.charAt(0) !== '@') return;
  if(line.indexOf(' USERNOTICE ') < 0) return;
  var sp = line.indexOf(' ');
  var tags = parseTags(line.slice(1, sp));
  if(tags['msg-id'] !== 'raid') return;
  onRaid({
    login: (tags['msg-param-login'] || tags['login'] || '').toLowerCase(),
    displayName: tags['msg-param-displayName'] || tags['display-name'] || tags['login'] || '',
    viewers: parseInt(tags['msg-param-viewerCount'] || '0', 10) || 0,
    userId: tags['user-id'] || '',
    avatar: tags['msg-param-profileImageURL'] || '',
    src: 'チャット'
  });
}

/* ---------- Helix ---------- */
function helix(path, opts){
  opts = opts || {};
  if(!S.token) return Promise.reject(new Error('NOAUTH'));
  var url = 'https://api.twitch.tv/helix/' + path;
  if(opts.params){
    var qs = Object.keys(opts.params).map(function(k){
      return encodeURIComponent(k) + '=' + encodeURIComponent(opts.params[k]);
    }).join('&');
    if(qs) url += '?' + qs;
  }
  var headers = { 'Client-Id': CFG.CLIENT_ID, 'Authorization': 'Bearer ' + S.token };
  if(opts.body) headers['Content-Type'] = 'application/json';
  return fetch(url, {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  }).then(function(res){
    if(res.status === 401) onTokenInvalid();
    return res;
  });
}
function helixJson(path, params){
  return helix(path, { params: params }).then(function(r){
    return r.ok ? r.json() : null;
  }).catch(function(){ return null; });
}

/* ---------- EventSub WebSocket ---------- */
var es = null, esWanted = false, esBackoff = 1000, esSession = null;

function esConnect(url){
  if(!S.token || !S.me) return;
  esWanted = true;
  closeSocket(es);
  es = new WebSocket(url || 'wss://eventsub.wss.twitch.tv/ws');
  es.onmessage = function(ev){
    var m;
    try{ m = JSON.parse(ev.data); }catch(e){ return; }
    var type = m.metadata && m.metadata.message_type;
    if(type === 'session_welcome'){
      esSession = m.payload.session.id;
      esBackoff = 1000;
      esSubscribe();
    } else if(type === 'notification'){
      if(m.metadata.subscription_type !== 'channel.raid') return;
      var e = m.payload.event;
      onRaid({
        login: (e.from_broadcaster_user_login || '').toLowerCase(),
        displayName: e.from_broadcaster_user_name || e.from_broadcaster_user_login || '',
        viewers: e.viewers || 0,
        userId: e.from_broadcaster_user_id || '',
        avatar: '',
        src: 'EventSub'
      });
    } else if(type === 'session_reconnect'){
      esConnect(m.payload.session.reconnect_url);
    } else if(type === 'revocation'){
      log('EventSubの購読が取り消されました（ログインし直してください）', 'warn');
      setDot(el.dEs, false);
    }
  };
  es.onclose = function(){
    setDot(el.dEs, false);
    if(esWanted){
      setTimeout(function(){ esConnect(); }, esBackoff);
      esBackoff = Math.min(esBackoff * 2, 30000);
    }
  };
  es.onerror = function(){};
}

function esSubscribe(){
  helix('eventsub/subscriptions', {
    method: 'POST',
    body: {
      type: 'channel.raid', version: '1',
      condition: { to_broadcaster_user_id: S.me.id },
      transport: { method: 'websocket', session_id: esSession }
    }
  }).then(function(res){
    if(res.ok){ setDot(el.dEs, true); log('EventSubの受信を開始しました', 'ok'); }
    else { res.text().then(function(t){ log('EventSubの購読に失敗：' + res.status + ' ' + t, 'warn'); }); }
  }).catch(function(){});
}

/* ---------- 認証 ---------- */
function redirectUri(){
  if(CFG.REDIRECT_URI) return CFG.REDIRECT_URI;
  return location.origin + location.pathname;
}
function login(){
  if(!CFG.CLIENT_ID){ log('config.js に CLIENT_ID が設定されていません', 'err'); return; }
  if(location.protocol === 'file:'){
    log('ファイルを直接開いた状態ではログインできません。GitHub Pages などのURLから開いてください', 'err');
    return;
  }
  var u = 'https://id.twitch.tv/oauth2/authorize'
    + '?response_type=token'
    + '&client_id=' + encodeURIComponent(CFG.CLIENT_ID)
    + '&redirect_uri=' + encodeURIComponent(redirectUri())
    + '&scope=' + encodeURIComponent(SCOPES.join(' '))
    + '&force_verify=true';
  location.href = u;
}
function onTokenInvalid(){
  S.token = null; S.me = null; S.scopes = [];
  LS.del('token');
  esWanted = false; closeSocket(es); es = null;
  setDot(el.dEs, false);
  el.authNote.textContent = 'ログインが切れました。もう一度ログインしてください。';
  renderAuth();
  log('ログインの期限が切れました。もう一度ログインしてください', 'err');
  renderSoStatus();
}
function logout(){
  esWanted = false; closeSocket(es); es = null;
  S.token = null; S.me = null; S.scopes = [];
  LS.del('token');
  setDot(el.dEs, false);
  el.authNote.textContent = '';
  renderAuth();
  log('ログアウトしました');
  renderSoStatus();
}
function validateToken(){
  if(!S.token) return Promise.resolve(false);
  return fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: 'OAuth ' + S.token }
  }).then(function(r){
    if(!r.ok){ onTokenInvalid(); return false; }
    return r.json().then(function(d){
      S.me = { id: d.user_id, login: d.login, display_name: d.login, avatar: '' };
      S.scopes = d.scopes || [];

      // ログインした本人のチャンネルに必ず合わせる。
      // 別チャンネルのまま使うと、レイドは見えてもシャウトアウトが送れない
      if(S.channel !== d.login){
        var before = S.channel;
        S.channel = d.login;
        LS.set('channel', S.channel);
        if(before) log('チャンネルを ' + d.login + ' に合わせました', 'warn');
        ircConnect();
      }

      if(S.scopes.indexOf('moderator:manage:shoutouts') < 0){
        el.authNote.textContent = '⚠ シャウトアウトの権限がありません。ログインし直してください。';
        log('権限 moderator:manage:shoutouts がありません', 'warn');
      } else {
        el.authNote.textContent = '公式シャウトアウトを送れる状態です。';
      }
      log('ログインを確認しました：' + d.login, 'ok');

      renderAuth();
      esConnect();
      renderSoStatus();

      // 表示名とアイコンは Helix でしか取れない。取れなくてもログインは有効なので待たない
      helixJson('users', { id: d.user_id }).then(function(u){
        var me = u && u.data && u.data[0];
        if(!me) return;
        S.me.display_name = me.display_name || d.login;
        S.me.avatar = me.profile_image_url || '';
        renderAuth();
      });

      return true;
    });
  }).catch(function(){ return false; });
}

/* ---------- レイド処理 ---------- */
function onRaid(raid){
  var now = Date.now();
  var key = raid.login + '|' + raid.viewers;
  S.recent = S.recent.filter(function(r){ return now - r.t < 20000; });
  if(S.recent.some(function(r){ return r.key === key; })) return;  /* IRCとEventSubの二重受信を除去 */
  S.recent.push({ key: key, t: now });

  raid.at = now;
  S.current = raid;

  // カードと履歴で同じオブジェクトを共有する。あとから届く配信タイトルや
  // シャウトアウトの結果を、履歴側にも反映させるため
  raid.entry = { login: raid.login, name: raid.displayName, viewers: raid.viewers,
                 at: now, so: 0, title: '', game: '' };
  S.history.unshift(raid.entry);
  S.history = S.history.slice(0, 500);
  saveHistory();

  render(); renderHistory();
  log(raid.displayName + ' さんから ' + raid.viewers + ' 人のレイド（' + raid.src + '）', 'ok');
  beep(); desktopNotify(raid);

  enrich(raid).then(function(){ if(S.current === raid) render(); });
  if(S.auto) enqueue(raid);
}

function enrich(raid){
  if(!S.token) return Promise.resolve();
  var q = raid.userId ? { id: raid.userId } : { login: raid.login };
  return helixJson('users', q).then(function(d){
    var u = d && d.data && d.data[0];
    if(!u) return null;
    raid.userId = u.id;
    raid.login = u.login || raid.login;
    raid.displayName = u.display_name || raid.displayName;
    raid.avatar = u.profile_image_url || raid.avatar;
    raid.desc = u.description || '';
    return Promise.all([
      helixJson('channels', { broadcaster_id: u.id }),
      helixJson('streams', { user_id: u.id })
    ]);
  }).then(function(rs){
    if(!rs) return;
    var ch = rs[0] && rs[0].data && rs[0].data[0];
    var st = rs[1] && rs[1].data && rs[1].data[0];
    if(ch){ raid.title = ch.title; raid.game = ch.game_name; }
    if(st){ raid.live = true; raid.game = st.game_name || raid.game; raid.title = st.title || raid.title; }
    if(raid.entry){
      raid.entry.name = raid.displayName;
      raid.entry.login = raid.login;
      raid.entry.title = raid.title || '';
      raid.entry.game = raid.game || '';
      saveHistory(); renderHistory();
    }
  }).catch(function(){});
}

/* ---------- シャウトアウトのキュー ---------- */
function targetWait(login){
  var last = S.targetSo[login] || 0;
  return Math.max(0, last + SO_TARGET_MS - Date.now());
}
function globalWait(){
  return Math.max(0, S.lastSoAt + SO_GLOBAL_MS - Date.now());
}
function enqueue(raid){
  if(!S.token){ return; }
  if(targetWait(raid.login) > 0){
    log(raid.displayName + ' さんには60分以内に送信済みのため公式SOは送れません', 'warn');
    return;
  }
  if(S.queue.some(function(r){ return r.login === raid.login; })) return;
  S.queue.push(raid);
  renderSoStatus();
}

function pump(){
  renderSoStatus();
  if(S.sending || !S.queue.length || !S.token || !S.me) return;
  var raid = S.queue[0];
  if(targetWait(raid.login) > 0){ S.queue.shift(); return; }
  if(globalWait() > 0) return;
  S.sending = true;
  sendShoutout(raid).then(function(ok){
    S.sending = false;
    if(ok !== 'retry') S.queue.shift();
    renderSoStatus();
  });
}

function sendShoutout(raid){
  var doSend = function(){
    return helix('chat/shoutouts', {
      method: 'POST',
      params: {
        from_broadcaster_id: S.me.id,
        to_broadcaster_id: raid.userId,
        moderator_id: S.me.id
      }
    }).then(function(res){
      if(res.status === 204){
        S.lastSoAt = Date.now(); LS.set('lastSoAt', S.lastSoAt);
        S.targetSo[raid.login] = Date.now(); LS.set('targetSo', S.targetSo);
        raid.soDone = true;
        if(raid.entry){ raid.entry.so = 1; saveHistory(); renderHistory(); }
        log('公式シャウトアウトを送信しました：' + raid.displayName, 'ok');
        toast('シャウトアウトを送信しました');
        return true;
      }
      return res.text().then(function(t){
        var msg = t;
        try{ msg = JSON.parse(t).message || t; }catch(e){}
        if(res.status === 429){
          log('送信制限中のため待機します（' + msg + '）', 'warn');
          S.lastSoAt = Date.now(); LS.set('lastSoAt', S.lastSoAt);
          return 'retry';
        }
        if(res.status === 400){
          raid.soError = '配信中でないと公式シャウトアウトは送れません（' + msg + '）';
        } else if(res.status === 403){
          raid.soError = '権限が足りません。ログインし直してください（' + msg + '）';
        } else {
          raid.soError = 'エラー ' + res.status + '：' + msg;
        }
        log(raid.soError, 'err');
        return false;
      });
    }).catch(function(e){
      raid.soError = '通信に失敗しました';
      log('シャウトアウト送信に失敗：' + e.message, 'err');
      return false;
    });
  };
  if(raid.userId) return doSend();
  return enrich(raid).then(function(){
    if(!raid.userId){ raid.soError = '相手のユーザーIDを取得できませんでした'; return false; }
    return doSend();
  });
}

/* ---------- ログイン状態の描画 ---------- */

// ログイン中はチャンネル欄を触らせない。
// 別のチャンネルを見ていると、シャウトアウトの送り主と食い違って送信に失敗する
function renderAuth(){
  var on = !!(S.token && S.me);
  var name = on ? (S.me.display_name || S.me.login) : '';

  setDot(el.dAuth, on);
  el.authName.textContent = on ? name : '未ログイン';
  el.meAvSm.hidden = !(on && S.me.avatar);
  if(on && S.me.avatar) el.meAvSm.src = S.me.avatar;

  el.meCard.hidden = !on;
  if(on){
    el.meAv.src = S.me.avatar || AVATAR_BLANK;
    el.meName.textContent = name;
    el.meLogin.textContent = '@' + S.me.login;
    el.inCh.value = S.channel;
  }

  el.inCh.disabled = on;
  el.btnLogin.hidden = on;
  el.btnLogout.hidden = !on;
}

/* ---------- OBSドックへのログイン引き継ぎ ---------- */

// OBSのドックはChromeとは別のブラウザなので、ログインを共有できない。
// 小さなパネルでTwitchのIDとパスワードを打つのは現実的でないため、
// ブラウザ側で済ませたログインをコードにして貼り付けられるようにする
function b64enc(str){
  var bytes = new TextEncoder().encode(str), bin = '';
  bytes.forEach(function(b){ bin += String.fromCharCode(b); });
  return btoa(bin);
}
function b64dec(b64){
  var bin = atob(b64), bytes = new Uint8Array(bin.length);
  for(var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function copyHandoff(){
  if(!S.token){ toast('先にログインしてください'); return; }
  copy('RP1.' + b64enc(JSON.stringify({ t: S.token, c: S.channel })));
  log('引き継ぎコードをコピーしました。ドック側に貼り付けてください', 'ok');
}

function useHandoff(raw){
  var code = String(raw || '').trim();
  if(code.indexOf('RP1.') !== 0){ toast('引き継ぎコードの形式が違います'); return; }
  var data;
  try{ data = JSON.parse(b64dec(code.slice(4))); }
  catch(e){ toast('引き継ぎコードを読めませんでした'); return; }
  if(!data.t){ toast('ログイン情報が入っていません'); return; }
  S.token = data.t; LS.set('token', S.token);
  if(data.c){ S.channel = data.c; LS.set('channel', S.channel); el.inCh.value = S.channel; }
  el.inHandoff.value = '';
  validateToken().then(function(ok){ if(ok && S.channel) ircConnect(); });
}

/* ---------- 描画 ---------- */
function render(){
  var r = S.current;
  el.empty.hidden = !!r;
  el.card.hidden = !r;
  if(!r) return;

  el.cAv.src = r.avatar || AVATAR_BLANK;
  el.cName.textContent = r.displayName;
  el.cCnt.textContent = r.viewers;
  el.cLogin.textContent = r.login;
  el.cTitle.textContent = r.title || '—';
  el.cGame.textContent = r.game || '—';
  el.cDesc.textContent = r.desc || '—';

  var liveTag = el.cName.querySelector('.live');
  if(liveTag) liveTag.remove();
  if(r.live){
    var b = document.createElement('span');
    b.className = 'live'; b.textContent = 'LIVE';
    el.cName.appendChild(b);
  }

  var url = 'https://twitch.tv/' + r.login;
  el.cLink.href = url;
  el.cUrl.textContent = url;

  el.thanks.value = (LS.get('template', CFG.THANKS_TEMPLATE))
    .split('{name}').join(r.displayName)
    .split('{login}').join(r.login)
    .split('{count}').join(String(r.viewers));

  renderSoStatus();
}

function renderSoStatus(){
  var r = S.current;
  if(!r) return;
  var node = el.soStatus;
  node.className = '';
  el.btnSo.disabled = false;

  if(!S.token){
    node.classList.add('warn');
    node.textContent = 'ログインしていないため公式シャウトアウトは送れません。リンクは上のボタンから開けます。';
    el.btnSo.disabled = true;
    return;
  }
  if(r.soDone){
    node.classList.add('ok');
    node.textContent = '✓ 公式シャウトアウト送信済み';
    el.btnSo.disabled = true;
    return;
  }
  if(r.soError){
    node.classList.add('err');
    node.textContent = r.soError + '（手動で送り直せます）';
    return;
  }
  var tw = targetWait(r.login);
  if(tw > 0){
    node.classList.add('warn');
    node.textContent = 'この方には60分以内に送信済みです。あと ' + fmtWait(tw) + ' で再送できます。';
    el.btnSo.disabled = true;
    return;
  }
  var qi = S.queue.indexOf(r);
  var gw = globalWait();
  if(qi >= 0){
    if(gw > 0){
      node.textContent = '自動送信の順番待ち：あと ' + fmtWait(gw) + '（Twitchの2分制限）'
        + (qi > 0 ? ' / 前に ' + qi + ' 件' : '');
    } else {
      node.textContent = 'まもなく自動送信します…';
    }
    return;
  }
  if(gw > 0){
    node.textContent = '前回の送信から ' + fmtWait(gw) + ' 待つ必要があります。';
    el.btnSo.disabled = true;
    return;
  }
  node.textContent = S.auto ? '自動送信の対象外です。ボタンから手動で送れます。' : '手動で送信できます。';
}

function saveHistory(){ LS.set('history', S.history); }

function p2(n){ return String(n).padStart(2, '0'); }
function dayLabel(d){ return d.getFullYear() + '/' + p2(d.getMonth()+1) + '/' + p2(d.getDate()); }

function renderHistory(){
  el.hist.innerHTML = '';
  var lastDay = null;
  var today = dayLabel(new Date());

  S.history.forEach(function(h){
    var d = new Date(h.at);
    var day = dayLabel(d);
    if(day !== lastDay){
      lastDay = day;
      var head = document.createElement('li');
      head.className = 'day';
      head.textContent = (day === today ? '今日' : day);
      el.hist.appendChild(head);
    }

    var li = document.createElement('li');
    var t = document.createElement('span');
    t.className = 't';
    t.textContent = p2(d.getHours()) + ':' + p2(d.getMinutes());

    var n = document.createElement('span');
    n.className = 'n';
    var a = document.createElement('a');
    a.href = 'https://twitch.tv/' + h.login;
    a.target = '_blank'; a.rel = 'noopener';
    a.textContent = h.name || h.login;
    a.title = [h.title, h.game].filter(Boolean).join(' / ');
    n.appendChild(a);
    if(h.so){
      var s2 = document.createElement('span');
      s2.className = 'muted'; s2.textContent = ' SO';
      s2.title = 'シャウトアウト送信済み';
      n.appendChild(s2);
    }

    var v = document.createElement('span');
    v.className = 'muted'; v.textContent = h.viewers + '人';

    li.appendChild(t); li.appendChild(n); li.appendChild(v);
    el.hist.appendChild(li);
  });

  var total = S.history.reduce(function(a, h){ return a + (h.viewers || 0); }, 0);
  el.histNote.textContent = S.history.length
    ? S.history.length + '件 / のべ' + total + '人（最大500件まで残ります）'
    : 'まだ記録はありません。';
}

// Excelでそのまま開けるようにBOMを付ける
function historyCsv(){
  var cell = function(v){
    var t = (v === null || v === undefined) ? '' : String(v);
    return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  var lines = ['日時,レイド主,ID,人数,リンク,シャウトアウト,配信タイトル,カテゴリ'];
  S.history.forEach(function(h){
    var d = new Date(h.at);
    lines.push([
      dayLabel(d) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()),
      h.name, h.login, h.viewers, 'https://twitch.tv/' + h.login,
      h.so ? '送信済み' : '', h.title || '', h.game || ''
    ].map(cell).join(','));
  });
  return '\ufeff' + lines.join('\r\n');
}

function downloadCsv(){
  if(!S.history.length){ toast('書き出す記録がありません'); return; }
  var d = new Date();
  var name = 'raid-log-' + d.getFullYear() + p2(d.getMonth()+1) + p2(d.getDate()) + '.csv';
  var blob = new Blob([historyCsv()], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  log(S.history.length + '件を ' + name + ' に書き出しました', 'ok');
}

/* ---------- 起動 ---------- */
function applyTheme(){
  // 面の色だけを入れ替える2状態。以前の3種類の配色から戻ってきた値も light に寄せる
  S.theme = S.theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', S.theme);
  LS.set(mkey('theme'), S.theme);
}

function boot(){
  applyTheme();

  /* URLフラグメントからトークンを回収 */
  if(location.hash && location.hash.indexOf('access_token') >= 0){
    var p = new URLSearchParams(location.hash.slice(1));
    var t = p.get('access_token');
    if(t){ S.token = t; LS.set('token', t); }
    if(p.get('error')) log('ログイン失敗：' + (p.get('error_description') || p.get('error')), 'err');
    try{ history.replaceState(null, '', location.pathname + location.search); }catch(e){}
  }

  el.inCh.value = S.channel;
  el.cbAuto.checked = !!S.auto;
  el.cbSound.checked = !!S.sound;
  el.cbNotify.checked = !!S.notify;

  if(!CFG.CLIENT_ID){
    el.authNote.textContent = '⚠ config.js の CLIENT_ID が空です。設定するとシャウトアウトが使えます。';
    log('config.js に CLIENT_ID が未設定です（レイド検出とリンク表示だけは動きます）', 'warn');
  }

  el.obsBadge.hidden = !IN_OBS;
  el.btnTheme.textContent = S.theme === 'dark' ? 'ライト' : 'ダーク';

  renderAuth();
  renderHistory();
  validateToken();
  if(S.channel) ircConnect();

  setInterval(pump, 1000);
}

/* ---------- イベント ---------- */
el.btnConnect.onclick = function(){
  S.channel = el.inCh.value.trim().replace(/^#/, '').replace(/^https?:\/\/(www\.)?twitch\.tv\//, '');
  el.inCh.value = S.channel;
  LS.set('channel', S.channel);
  ircConnect();
};
el.btnLogin.onclick = login;
el.btnLogout.onclick = logout;
el.btnToken.onclick = function(){
  var t = el.inToken.value.trim().replace(/^oauth:/, '');
  if(!t) return;
  S.token = t; LS.set('token', t); el.inToken.value = '';
  validateToken();
};
el.btnTheme.onclick = function(){
  S.theme = S.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  el.btnTheme.textContent = S.theme === 'dark' ? 'ライト' : 'ダーク';
};
el.btnTest.onclick = function(){
  onRaid({
    login: 'twitchpresents',
    displayName: 'テスト配信者',
    viewers: 42,
    userId: '',
    avatar: '',
    src: 'テスト'
  });
};
el.btnSo.onclick = function(){
  if(!S.current || !S.token) return;
  var r = S.current;
  r.soError = null;
  el.btnSo.disabled = true;
  S.sending = true;
  sendShoutout(r).then(function(){ S.sending = false; render(); });
};
el.btnCopyUrl.onclick = function(){ if(S.current) copy('https://twitch.tv/' + S.current.login); };
el.btnHandoff.onclick = copyHandoff;
el.btnHandoffUse.onclick = function(){ useHandoff(el.inHandoff.value); };

// OBSのドックはCEFなので、新しいタブを開けないことがある。
// 押した時点でURLはコピーしておき、開けなくても貼り付けで辿り着けるようにする
if(MODE === 'dock'){
  [el.cLink, el.credit].forEach(function(a){
    a.addEventListener('click', function(ev){
      ev.preventDefault();
      var url = a === el.cLink
        ? (S.current ? 'https://twitch.tv/' + S.current.login : '')
        : a.href;
      if(!url) return;
      copy(url);
      var w = null;
      try{ w = window.open(url, '_blank'); }catch(e){}
      toast(w ? '開きました（URLもコピー済み）' : 'URLをコピーしました。ブラウザに貼り付けてください');
    });
  });
}
el.btnCopyThanks.onclick = function(){ copy(el.thanks.value); };
el.thanks.onchange = function(){
  if(!S.current) return;
  var tpl = el.thanks.value
    .split(S.current.displayName).join('{name}')
    .split(S.current.login).join('{login}')
    .split(String(S.current.viewers)).join('{count}');
  LS.set('template', tpl);
  toast('お礼文のひな形を保存しました');
};
el.cbAuto.onchange = function(){ S.auto = el.cbAuto.checked; LS.set('auto', S.auto); renderSoStatus(); };
el.cbSound.onchange = function(){ S.sound = el.cbSound.checked; LS.set(mkey('sound'), S.sound); if(S.sound) beep(); };
el.cbNotify.onchange = function(){
  S.notify = el.cbNotify.checked; LS.set(mkey('notify'), S.notify);
  if(S.notify && 'Notification' in window && Notification.permission === 'default'){
    Notification.requestPermission();
  }
};
el.btnCsv.onclick = downloadCsv;
el.btnClearHist.onclick = function(){
  if(!S.history.length) return;
  if(!confirm(S.history.length + '件のレイド記録を消します。先にCSVへ書き出しておかなくて大丈夫ですか？')) return;
  S.history = []; saveHistory(); renderHistory(); log('履歴を消しました');
};

boot();
})();
