(() => {
'use strict';
const API = window.GTHL_API;
const CONSENT = window.GTHL_CONSENT;
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yen = (n) => Number(n || 0).toLocaleString('ja-JP') + '円';
const dt = (s) => (s ? new Date(s).toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const d = (s) => (s ? new Date(s).toLocaleDateString('ja-JP') : '—');
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
let token = store.get('gthl-token');
let me = null;
let catalog = null;

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

async function api(path, opt = {}) {
  const res = await fetch(API + path, {
    method: opt.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && token && !opt.noLogout) { signOut(true); throw new Error(data.error || 'ログインしてください'); }
  if (!res.ok) throw new Error(data.error || '通信に失敗しました');
  return data;
}

function signOut(silent) {
  if (token && !silent) api('/api/auth/logout', { method: 'POST', noLogout: true }).catch(() => {});
  token = null; me = null;
  store.del('gthl-token'); store.del('gthl-cert');
  location.hash = '#/';
  render();
}

async function loadCatalog() {
  if (!catalog) catalog = await (await fetch('catalog.json')).json();
  return catalog;
}

function formData(form) {
  const o = {};
  new FormData(form).forEach((v, k) => (o[k] = v));
  form.querySelectorAll('input[type=checkbox]').forEach((c) => (o[c.name] = c.checked));
  return o;
}

function bindSubmit(form, fn) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    if (btn) btn.disabled = true;
    try { await fn(formData(form)); } catch (err) { toast(err.message); } finally { if (btn) btn.disabled = false; }
  });
}

function modal(html, onMount) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="sheet" role="dialog">${html}</div>`;
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) m.remove(); });
  document.body.appendChild(m);
  if (onMount) onMount(m);
  return m;
}

const head = (eyebrow, title, lead = '') =>
  `<div class="topbrand"><b>115<i>en.</i></b><span class="small muted">GO TO HAPPY LIFE</span></div>
   <div class="pagehead"><span class="eyebrow">${eyebrow}</span><h1>${title}</h1>${lead ? `<p class="muted" style="margin:0">${lead}</p>` : ''}</div>`;

// ---------------- 未ログイン ----------------
function renderAuth(mode = 'register') {
  document.body.classList.add('guest');
  view.innerHTML = `
  <div class="topbrand"><b>115<i>en.</i></b><span class="small muted">GO TO HAPPY LIFE</span></div>
  <section class="hero">
    <div class="stack">
      <span class="eyebrow">Life without barriers</span>
      <h1>家族の有無に<br>かかわらず、<br>必要なときに必要な支援を。</h1>
      <p class="muted">本人登録と事実の証明書は無料。実際の支援が必要なときだけ、内容と料金に同意してから申し込む仕組み。</p>
      <div class="grid3 keep">
        <div class="stat"><b>0<span class="small">円</span></b><small>基本登録・証明書</small></div>
        <div class="stat"><b>240</b><small>生活課題の支援項目</small></div>
        <div class="stat"><b>21</b><small>分野（ペットを含む）</small></div>
      </div>
    </div>
    <div class="block"><div class="card">
      <div class="segs"><button type="button" data-m="register" class="${mode === 'register' ? 'on' : ''}">無料登録</button><button type="button" data-m="login" class="${mode === 'login' ? 'on' : ''}">ログイン</button></div>
      ${mode === 'register' ? `
      <form id="f" class="stack">
        <label class="f">氏名<input type="text" name="name" required autocomplete="name"></label>
        <label class="f">ふりがな<input type="text" name="name_kana"></label>
        <div class="grid2">
          <label class="f">生年月日<input type="date" name="birthdate"></label>
          <label class="f">電話番号<input type="tel" name="phone" autocomplete="tel"></label>
        </div>
        <label class="f">メールアドレス<input type="email" name="email" required autocomplete="email"></label>
        <label class="f">パスワード（10文字以上）<input type="password" name="password" required minlength="10" autocomplete="new-password"></label>
        <label class="check"><input type="checkbox" name="agree" required><span><a href="terms.html" target="_blank">利用規約</a>・<a href="privacy.html" target="_blank">プライバシーポリシー</a>に同意する</span></label>
        <p class="small muted" style="margin:0">マイナンバー（12桁の個人番号）やカード番号は登録しません。</p>
        <button class="btn coral" type="submit">無料で登録する</button>
      </form>` : `
      <form id="f" class="stack">
        <label class="f">メールアドレス<input type="email" name="email" required autocomplete="email"></label>
        <label class="f">パスワード<input type="password" name="password" required autocomplete="current-password"></label>
        <button class="btn" type="submit">ログイン</button>
      </form>`}
    </div></div>
  </section>`;
  view.querySelectorAll('.segs button').forEach((b) => (b.onclick = () => renderAuth(b.dataset.m)));
  bindSubmit($('#f'), async (o) => {
    const path = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
    if (mode === 'register') o.consent = CONSENT;
    const r = await api(path, { method: 'POST', body: o });
    token = r.token; store.set('gthl-token', token);
    me = r.member;
    location.hash = '#/';
    render();
  });
}

// ---------------- ホーム ----------------
async function renderHome() {
  const r = await api('/api/me');
  me = r.member;
  const c = r.counts;
  const verified = me.identity_status === 'verified';
  view.innerHTML = `
  ${head('Your life, your way', '')}
  <section class="welcome">
    <div class="msg stack">
      <span class="small muted">${esc(me.id)}</span>
      <h1>${esc(me.name)} さん</h1>
      <p class="muted" style="margin:0">必要なときに、必要な支援を。</p>
      <div class="row"><a class="btn" href="#/cert">証明書を表示</a><a class="btn ghost" href="#/support">支援を探す</a></div>
    </div>
    <div class="card stack">
      <div class="row" style="justify-content:space-between"><span class="eyebrow">Membership</span><span class="pill">基本会員 FREE</span></div>
      <div class="grid3 keep">
        <div class="stat"><b>${verified ? '済' : '未'}</b><small>本人確認</small></div>
        <div class="stat"><b>${c.open_requests}</b><small>対応中の申込</small></div>
        <div class="stat"><b>${c.contracts}</b><small>登録した契約</small></div>
      </div>
      ${verified ? '' : '<div class="note">本人確認は未完了。マイナンバーカードによるオンライン確認は導入準備中のため、当面は面談・書類で確認します。</div>'}
    </div>
  </section>
  <h3 style="margin:30px 0 12px">Quick access</h3>
  <div class="quick">
    <a href="#/support" style="--c:var(--coral)"><b>生活支援</b><small>240項目から探して申込</small></a>
    <a href="#/pets" style="--c:var(--plum)"><b>マイペット</b><small>${c.pets}件登録</small></a>
    <a href="#/wishes" style="--c:var(--teal)"><b>生前・死後の希望</b><small>無料で登録</small></a>
    <a href="#/donate" style="--c:var(--gold)"><b>活動を支援</b><small>任意の寄付</small></a>
  </div>`;
}

// ---------------- 証明書 ----------------
function verifyUrl(t) {
  const base = location.href.split('#')[0].replace(/index\.html$/, '').replace(/[^/]*$/, '');
  return base + 'verify.html#' + t;
}
function qrSvg(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

async function renderCert() {
  const [r, mine] = await Promise.all([api('/api/certificates'), api('/api/me')]);
  me = mine.member;
  const local = store.get('gthl-cert');
  const active = r.certificates.find((c) => !c.revoked_at && Date.parse(c.expires_at) > Date.now());
  const usable = active && local && local.id === active.id;
  const verified = me.identity_status === 'verified';
  view.innerHTML = `
  ${head('Digital identity', 'デジタル証明書', '本人確認・登録の事実だけを示す無料の証明書。照会用QRは期限付きで、再発行すると前の証明書は失効します。')}
  <div class="grid2">
    <div class="cert">
      <div class="head"><div><div class="eyebrow">115en. / Member certificate</div><div class="no">本人確認・登録証明書</div></div><span class="no">${active ? esc(active.id) : '未発行'}</span></div>
      <div class="nm">${esc(me.name)}</div>
      <div class="no">${esc(me.id)}</div>
      <dl>
        <dt>本人確認</dt><dd>${verified ? `<span class="pill ok">確認済</span> <span class="small muted">${d(me.identity_at)}</span>` : '<span class="pill warn">未確認</span>'}</dd>
        <dt>登録</dt><dd><span class="pill ok">有効</span></dd>
        <dt>債務保証</dt><dd>なし</dd>
        <dt>緊急対応契約</dt><dd>なし</dd>
        <dt>医療同意・代理権</dt><dd>なし</dd>
        <dt>有効期限</dt><dd>${active ? d(active.expires_at) : '—'}</dd>
      </dl>
      <div class="qr">${usable ? qrSvg(verifyUrl(local.token)) : '<div class="empty" style="width:120px;height:120px;padding:8px;font-size:11px;display:flex;align-items:center">この端末に照会QRなし</div>'}
        <div class="small muted">提示先がQRを読み取ると、証明書の有効性を確認できます。住所や連絡先は表示されません。</div>
      </div>
      ${active ? '' : '<div class="void">未発行</div>'}
    </div>
    <div class="stack">
      <div class="card stack">
        <h3>${active ? '再発行・失効' : '証明書を発行'}</h3>
        <p class="small muted" style="margin:0">${active && !usable ? '別の端末で発行した証明書が有効。この端末でQRを表示するには再発行（前の証明書は失効）が必要。' : '発行は無料。有効期間は30日。'}</p>
        <div class="row">
          <button class="btn coral" id="issue">${active ? '再発行する' : '発行する'}</button>
          ${active ? '<button class="btn ghost" id="revoke">失効させる</button>' : ''}
          ${usable ? '<button class="btn ghost" id="copy">照会URLをコピー</button>' : ''}
        </div>
      </div>
      <div class="note">この証明書は人格・信用・債務・将来の行動を保証するものではなく、公的証明書でもありません。受け入れるかどうかは提示先の判断になります。</div>
      <div class="card"><h3 style="margin-bottom:8px">発行履歴</h3>
        ${r.certificates.length ? `<table class="t"><tr><th>証明番号</th><th>発行</th><th>状態</th></tr>${r.certificates.map((c) =>
          `<tr><td class="latin">${esc(c.id)}</td><td>${d(c.issued_at)}</td><td>${c.revoked_at ? '<span class="pill">失効</span>' : Date.parse(c.expires_at) < Date.now() ? '<span class="pill">期限切れ</span>' : '<span class="pill ok">有効</span>'}</td></tr>`).join('')}</table>` : '<div class="empty">発行履歴なし</div>'}
      </div>
    </div>
  </div>`;
  $('#issue').onclick = async () => {
    try {
      const c = await api('/api/certificates', { method: 'POST' });
      store.set('gthl-cert', { id: c.id, token: c.token });
      toast('証明書を発行');
      renderCert();
    } catch (e) { toast(e.message); }
  };
  if ($('#revoke')) $('#revoke').onclick = async () => {
    if (!confirm('この証明書を失効させますか。提示先での照会ができなくなります。')) return;
    try { await api(`/api/certificates/${active.id}/revoke`, { method: 'POST' }); store.del('gthl-cert'); renderCert(); } catch (e) { toast(e.message); }
  };
  if ($('#copy')) $('#copy').onclick = () => navigator.clipboard.writeText(verifyUrl(local.token)).then(() => toast('コピー済み'));
}

// ---------------- 生活支援 ----------------
const REQ_LABEL = { received: '受付', quoted: '見積提示', approved: '見積に同意', started: '対応中', done: '完了', cancelled: '取消' };
const REQ_STEP = { received: 1, quoted: 2, approved: 3, started: 4, done: 5, cancelled: 0 };
let supportState = { field: '', q: '' };

async function renderSupport() {
  const [cat, r] = await Promise.all([loadCatalog(), api('/api/requests')]);
  const fields = [...new Set(cat.map((c) => c.field))];
  const counts = {}; cat.forEach((c) => (counts[c.field] = (counts[c.field] || 0) + 1));
  const open = r.requests.filter((x) => !['done', 'cancelled'].includes(x.status));
  const past = r.requests.filter((x) => ['done', 'cancelled'].includes(x.status));
  view.innerHTML = `
  ${head('How can we help?', '生活支援', '21分野・240項目から探して申し込み。申込後に担当者が内容を確認し、見積に同意してから対応を始めます。')}
  ${open.length ? `<h3 style="margin-bottom:10px">対応中の申込</h3><div class="reqs" style="margin-bottom:28px">${open.map(reqRow).join('')}</div>` : ''}
  <div class="card stack">
    <input type="text" id="q" placeholder="キーワードで探す（例：入院、通訳、散歩）" value="${esc(supportState.q)}">
    <div class="chips" id="chips">
      <button class="chip ${supportState.field ? '' : 'on'}" data-f="">すべて<em>${cat.length}</em></button>
      ${fields.map((f) => `<button class="chip ${supportState.field === f ? 'on' : ''}" data-f="${esc(f)}">${esc(f)}<em>${counts[f]}</em></button>`).join('')}
    </div>
    <div class="small muted" id="cnt"></div>
    <div class="items" id="items"></div>
  </div>
  ${past.length ? `<details style="margin-top:24px"><summary class="muted">完了・取消の履歴（${past.length}件）</summary><div class="reqs" style="margin-top:10px">${past.map(reqRow).join('')}</div></details>` : ''}
  <p class="small muted" style="margin-top:18px">緊急時は119番・110番を優先。医療判断・代理同意・法律判断は行いません。資格や許可が必要な業務は提携先が担当します。</p>`;

  const draw = () => {
    const q = supportState.q.toLowerCase();
    if (!supportState.field && !q) { $('#cnt').textContent = ''; $('#items').innerHTML = '<div class="empty" style="width:100%">分野を選ぶか、キーワードで探してください</div>'; return; }
    const list = cat.filter((c) => (!supportState.field || c.field === supportState.field) && (!q || (c.field + c.name + c.how).toLowerCase().includes(q)));
    const shown = list.slice(0, 60);
    $('#cnt').textContent = `${list.length}件${list.length > 60 ? '（上位60件を表示。キーワードで絞り込み）' : ''}`;
    $('#items').innerHTML = shown.map((c) => `<button class="item" data-id="${c.id}">${supportState.field ? '' : `<small>${esc(c.field)}</small>`}<b>${esc(c.name)}</b></button>`).join('') || '<div class="empty">該当なし</div>';
  };
  draw();
  $('#q').oninput = (e) => { supportState.q = e.target.value; draw(); };
  $('#chips').onclick = (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    supportState.field = b.dataset.f;
    view.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  };
  $('#items').onclick = (e) => { const b = e.target.closest('.item'); if (b) openItem(cat.find((c) => c.id === Number(b.dataset.id))); };
  view.querySelectorAll('[data-approve]').forEach((b) => (b.onclick = async () => {
    try { await api(`/api/requests/${b.dataset.approve}/approve`, { method: 'POST' }); toast('見積に同意'); renderSupport(); } catch (e) { toast(e.message); }
  }));
  view.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = async () => {
    if (!confirm('この申込を取り消しますか。')) return;
    try { await api(`/api/requests/${b.dataset.cancel}/cancel`, { method: 'POST' }); renderSupport(); } catch (e) { toast(e.message); }
  }));
}

function reqRow(x) {
  const step = REQ_STEP[x.status];
  return `<div class="req">
    <div><b>${esc(x.catalog_name)}</b>
      <div class="meta">受付 ${dt(x.received_at)}${x.preferred_at ? '／希望 ' + esc(x.preferred_at) : ''}${x.started_at ? '／着手 ' + dt(x.started_at) : ''}${x.done_at ? '／完了 ' + dt(x.done_at) : ''}</div>
      ${x.status === 'quoted' ? `<div class="note" style="margin-top:8px">見積 ${yen(x.quote_amount)}（実費別）${x.quote_note ? '：' + esc(x.quote_note) : ''}</div>` : ''}
      ${x.status !== 'cancelled' ? `<div class="steps">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>` : ''}
    </div>
    <div class="row" style="justify-content:flex-end">
      <span class="pill ${x.status === 'done' ? 'ok' : x.status === 'quoted' ? 'warn' : x.status === 'cancelled' ? '' : ''}">${REQ_LABEL[x.status]}</span>
      ${x.status === 'quoted' ? `<button class="btn sm coral" data-approve="${x.id}">見積に同意</button>` : ''}
      ${['received', 'quoted', 'approved'].includes(x.status) ? `<button class="btn sm ghost" data-cancel="${x.id}">取消</button>` : ''}
    </div></div>`;
}

function openItem(c) {
  modal(`
    <span class="eyebrow">${esc(c.field)} / No.${String(c.id).padStart(3, '0')}</span>
    <h2 style="margin:8px 0 14px">${esc(c.name)}</h2>
    <div class="kv"><span>対応</span><span>${esc(c.how)}</span><span>費用の負担</span><span>${esc(c.payer)}</span><span>備考</span><span>${esc(c.note)}</span></div>
    <form id="rf" class="stack" style="margin-top:18px">
      <label class="f">ご相談内容（任意）<textarea name="note" maxlength="2000" placeholder="状況や希望をご記入ください。病名など詳しい情報は面談時で構いません。"></textarea></label>
      <label class="f">希望日時（任意）<input type="text" name="preferred_at" placeholder="例：12月3日 午前"></label>
      <p class="small muted" style="margin:0">申込の時点では料金は発生しません。担当者が見積を提示し、同意をいただいてから対応します。</p>
      <div class="row"><button class="btn coral" type="submit">申し込む</button><button class="btn ghost" type="button" data-close>閉じる</button></div>
    </form>`, (m) => {
    bindSubmit($('#rf', m), async (o) => {
      await api('/api/requests', { method: 'POST', body: { ...o, catalog_id: c.id } });
      m.remove(); toast('申込を受付'); renderSupport();
    });
  });
}

// ---------------- ペット ----------------
async function renderPets() {
  const r = await api('/api/pets');
  view.innerHTML = `
  ${head('My companions', 'マイペット', '飼い主の入院・死亡時の引取先や、以前のペットの遺骨・供養の希望まで登録できます。')}
  <div class="row" style="margin-bottom:18px"><button class="btn coral" id="add">ペットを登録</button></div>
  <div class="grid2">${r.pets.map((p) => `
    <div class="card pet ${p.alive ? '' : 'past'}">
      <div class="mono">${esc((p.name || '?').slice(0, 1))}</div>
      <div>
        <div class="row" style="justify-content:space-between"><h3>${esc(p.name)}</h3>${p.alive ? '' : '<span class="pill">以前のペット</span>'}</div>
        <div class="small muted">${esc(p.species || '')}${p.birth_year ? '・' + p.birth_year + '年生まれ' : ''}</div>
        <div class="kv">
          <span>かかりつけ</span><span>${esc(p.vet || '未登録')}</span>
          <span>緊急引取先</span><span>${p.caretaker ? esc(p.caretaker) + (p.caretaker_consent ? ' <span class="pill ok">同意済</span>' : ' <span class="pill warn">同意未確認</span>') : '未登録'}</span>
          <span>${p.alive ? '飼い主死亡時' : '遺骨・供養'}</span><span>${esc(p.after_wish || '未設定')}</span>
        </div>
        <div class="row" style="margin-top:12px"><button class="btn sm ghost" data-edit="${p.id}">編集</button></div>
      </div>
    </div>`).join('') || '<div class="empty">まだ登録がありません</div>'}</div>
  <p class="small muted" style="margin-top:18px">緊急時の入室は、事前に登録した鍵・入室権限と引取先の同意が前提。無断での入室は行いません。</p>`;
  $('#add').onclick = () => petForm(null);
  view.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => petForm(r.pets.find((p) => p.id === b.dataset.edit))));
}

function petForm(p) {
  const v = p || { alive: 1 };
  modal(`
    <h2 style="margin-bottom:14px">${p ? 'ペット情報を編集' : 'ペットを登録'}</h2>
    <form id="pf" class="stack">
      <div class="grid2"><label class="f">名前<input type="text" name="name" required value="${esc(v.name)}"></label>
      <label class="f">種類<input type="text" name="species" placeholder="犬、猫など" value="${esc(v.species)}"></label></div>
      <div class="grid2"><label class="f">生まれ年<input type="number" name="birth_year" min="1980" max="2100" value="${esc(v.birth_year)}"></label>
      <label class="f">状態<select name="alive"><option value="1" ${v.alive ? 'selected' : ''}>一緒に暮らしている</option><option value="0" ${v.alive ? '' : 'selected'}>以前のペット（遺骨・供養）</option></select></label></div>
      <label class="f">かかりつけ動物病院<input type="text" name="vet" value="${esc(v.vet)}"></label>
      <label class="f">食事・投薬の指示<textarea name="care">${esc(v.care)}</textarea></label>
      <label class="f">緊急時の引取先<input type="text" name="caretaker" placeholder="氏名・連絡先" value="${esc(v.caretaker)}"></label>
      <label class="check"><input type="checkbox" name="caretaker_consent" ${v.caretaker_consent ? 'checked' : ''}>引取先から引き受けの同意を得ている</label>
      <label class="f">飼い主死亡時の希望／遺骨・供養の希望<textarea name="after_wish">${esc(v.after_wish)}</textarea></label>
      <div class="row"><button class="btn coral" type="submit">保存</button><button class="btn ghost" type="button" data-close>閉じる</button>
      ${p ? '<button class="btn ghost" type="button" id="del" style="margin-left:auto">削除</button>' : ''}</div>
    </form>`, (m) => {
    bindSubmit($('#pf', m), async (o) => {
      o.alive = o.alive === '1';
      await api(p ? `/api/pets/${p.id}` : '/api/pets', { method: p ? 'PUT' : 'POST', body: o });
      m.remove(); toast('保存済み'); renderPets();
    });
    const del = $('#del', m);
    if (del) del.onclick = async () => { if (!confirm('削除しますか。')) return; await api(`/api/pets/${p.id}`, { method: 'DELETE' }); m.remove(); renderPets(); };
  });
}

// ---------------- 希望 ----------------
async function renderWishes() {
  const r = await api('/api/wishes');
  const w = r.wishes || {};
  view.innerHTML = `
  ${head('My wishes', '生前・死後の希望', '希望の登録は無料。登録内容は法的な契約や代理権ではなく、実行には別途の契約・権限・資金の確保が必要です。')}
  <form id="wf" class="grid2">
    <div class="card stack">
      <h3>医療・連絡</h3>
      <label class="f">医療・延命治療についての希望<textarea name="medical" placeholder="ご本人の意思の記録（代理同意ではありません）">${esc(w.medical)}</textarea></label>
      <label class="f">もしものときに連絡してほしい人<textarea name="contact">${esc(w.contact)}</textarea></label>
    </div>
    <div class="card stack">
      <h3>葬儀・住まい</h3>
      <label class="f">葬儀・納骨の希望<textarea name="funeral">${esc(w.funeral)}</textarea></label>
      <label class="f">遺品・住まいの希望<textarea name="belongings">${esc(w.belongings)}</textarea></label>
    </div>
    <div class="card stack" style="grid-column:1/-1">
      <label class="f">伝えたいこと（任意）<textarea name="message">${esc(w.message)}</textarea></label>
      <div class="row" style="justify-content:space-between"><span class="small muted">${w.updated_at ? '最終更新 ' + dt(w.updated_at) : '未登録'}</span><button class="btn coral" type="submit">保存</button></div>
    </div>
  </form>
  <div class="card row" style="margin-top:18px;justify-content:space-between">
    <div><b>死後事務委任契約</b><div class="small muted">葬儀・届出・住まいの整理などの実行には個別の契約が必要</div></div>
    <a class="btn ghost" href="#/support">相談する</a>
  </div>`;
  bindSubmit($('#wf'), async (o) => { await api('/api/wishes', { method: 'PUT', body: o }); toast('保存済み'); renderWishes(); });
}

// ---------------- 契約の管理 ----------------
async function renderContracts() {
  const r = await api('/api/contracts');
  view.innerHTML = `
  ${head('Contract desk', '契約の管理', '当法人・他社を問わず、結んでいる契約を一か所に。同じ業務区分の契約が重なっていないかを確認できます。')}
  ${r.overlaps.length ? `<div class="note" style="margin-bottom:16px">業務区分が重なっている契約：${r.overlaps.map((o) => `${esc(o.category)}（${o.count}件）`).join('、')}。二重の支払いや手続きの重複がないか、担当者・専門家と確認を。</div>` : ''}
  <div class="grid2">
    <div class="card stack">
      <h3>契約を登録</h3>
      <form id="kf" class="stack">
        <label class="f">契約先<input type="text" name="provider" required placeholder="事業者名・専門家名"></label>
        <label class="f">業務区分<select name="category">${r.categories.map((c) => `<option>${c}</option>`).join('')}</select></label>
        <div class="grid2"><label class="f">締結日<input type="date" name="signed_on"></label><label class="f">終了日<input type="date" name="ends_on"></label></div>
        <label class="f">メモ<input type="text" name="note"></label>
        <button class="btn coral" type="submit">登録</button>
      </form>
    </div>
    <div class="card"><h3 style="margin-bottom:8px">登録済みの契約</h3>
      ${r.contracts.length ? `<table class="t"><tr><th>区分</th><th>契約先</th><th>期間</th><th></th></tr>${r.contracts.map((k) =>
        `<tr><td><span class="pill ${r.overlaps.some((o) => o.category === k.category) ? 'warn' : ''}">${esc(k.category)}</span></td><td>${esc(k.provider)}${k.note ? `<div class="small muted">${esc(k.note)}</div>` : ''}</td><td class="small">${esc(k.signed_on || '—')}〜${esc(k.ends_on || '')}</td><td><button class="btn sm ghost" data-del="${k.id}">削除</button></td></tr>`).join('')}</table>` : '<div class="empty">登録なし</div>'}
    </div>
  </div>
  <p class="small muted" style="margin-top:18px">他社の契約を自動で照会することはありません。他社サービスの併用や遺言の変更は本人の自由です。</p>`;
  bindSubmit($('#kf'), async (o) => { await api('/api/contracts', { method: 'POST', body: o }); toast('登録済み'); renderContracts(); });
  view.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { if (!confirm('削除しますか。')) return; await api(`/api/contracts/${b.dataset.del}`, { method: 'DELETE' }); renderContracts(); }));
}

// ---------------- 寄付 ----------------
async function renderDonate() {
  const done = location.hash.includes('done=1');
  let amount = 300, freq = 'once';
  view.innerHTML = `
  ${head('Keep it free', '活動を支援', 'この仕組みを、これからも無料で。寄付は任意で、寄付の有無によって基本機能に差はありません。')}
  ${done ? '<div class="note" style="margin-bottom:16px">ご支援ありがとうございます。</div>' : ''}
  <div class="grid2">
    <div class="card stack">
      <label class="f">頻度</label>
      <div class="segs" id="freq"><button type="button" data-v="once" class="on">今回のみ</button><button type="button" data-v="monthly">毎月</button></div>
      <label class="f">金額</label>
      <div class="amounts" id="amt">${[100, 300, 500, 1000].map((a) => `<button type="button" data-v="${a}" class="${a === amount ? 'on' : ''}">${a.toLocaleString()}</button>`).join('')}</div>
      <label class="f">その他の金額（円）<input type="number" id="other" min="100" step="100" placeholder="100円から"></label>
      <button class="btn coral" id="go">決済画面へ進む</button>
      <p class="small muted" style="margin:0" id="fnote">決済はSquareの画面で行います。カード番号は当法人には保存されません。</p>
    </div>
    <div class="card stack">
      <h3>寄付の使い道</h3>
      <table class="t"><tr><th>財源</th><th>使途</th></tr>
        <tr><td>一般寄付</td><td>無料の基盤（登録・証明書・システム）の維持</td></tr>
        <tr><td>指定寄付・遺贈</td><td>指定された目的に従う</td></tr>
        <tr><td>有料サービス</td><td>実際の支援の原価・人件費</td></tr>
      </table>
      <p class="small muted" style="margin:0">収支・寄付の使途は定期的に公開します。寄付控除は認定NPO等の要件を満たす場合に限ります。</p>
    </div>
  </div>`;
  $('#freq').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; freq = b.dataset.v; $('#freq').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); $('#fnote').textContent = freq === 'monthly' ? '毎月の寄付は初回の決済後、継続の設定をご案内します。停止はいつでも可能です。' : '決済はSquareの画面で行います。カード番号は当法人には保存されません。'; };
  $('#amt').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; amount = Number(b.dataset.v); $('#other').value = ''; $('#amt').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); };
  $('#other').oninput = (e) => { if (e.target.value) { amount = Number(e.target.value); $('#amt').querySelectorAll('button').forEach((x) => x.classList.remove('on')); } };
  $('#go').onclick = async () => {
    try {
      const r = await api('/api/donations', { method: 'POST', body: { amount, frequency: freq } });
      if (r.ready) location.href = r.url; else toast(r.message);
    } catch (e) { toast(e.message); }
  };
}

// ---------------- アカウント ----------------
async function renderAccount() {
  const r = await api('/api/me');
  const m = r.member;
  view.innerHTML = `
  ${head('Account', 'アカウント')}
  <div class="grid2">
    <form id="af" class="card stack">
      <h3>登録情報</h3>
      <div class="small muted">会員ID ${esc(m.id)}／${esc(m.email)}</div>
      <label class="f">氏名<input type="text" name="name" value="${esc(m.name)}" required></label>
      <label class="f">ふりがな<input type="text" name="name_kana" value="${esc(m.name_kana)}"></label>
      <div class="grid2"><label class="f">生年月日<input type="date" name="birthdate" value="${esc(m.birthdate)}"></label><label class="f">電話番号<input type="tel" name="phone" value="${esc(m.phone)}"></label></div>
      <label class="f">住所<input type="text" name="address" value="${esc(m.address)}"></label>
      <label class="f">緊急連絡先<input type="text" name="emergency" value="${esc(m.emergency)}" placeholder="氏名・続柄・電話番号"></label>
      <label class="f">表示言語<select name="lang"><option value="ja">日本語</option></select></label>
      <button class="btn coral" type="submit">保存</button>
    </form>
    <div class="stack">
      <div class="card stack"><h3>ログアウト</h3><button class="btn ghost" id="out">ログアウト</button></div>
      <div class="card stack"><h3>退会</h3><p class="small muted" style="margin:0">退会すると証明書は失効します。有料の契約がある場合は、契約ごとの解約・精算の手続きが別途必要です。</p><button class="btn ghost" id="wd">退会する</button></div>
    </div>
  </div>`;
  bindSubmit($('#af'), async (o) => { await api('/api/me', { method: 'PUT', body: o }); toast('保存済み'); });
  $('#out').onclick = () => signOut();
  $('#wd').onclick = async () => {
    if (!confirm('退会しますか。証明書は失効し、ログインできなくなります。')) return;
    try { await api('/api/me/withdraw', { method: 'POST' }); signOut(true); toast('退会の手続き完了'); } catch (e) { toast(e.message); }
  };
}

function renderMenu() {
  view.innerHTML = `${head('Menu', 'その他')}
  <div class="quick" style="grid-template-columns:1fr 1fr">
    <a href="#/pets" style="--c:var(--plum)"><b>マイペット</b><small>登録・引取先</small></a>
    <a href="#/contracts" style="--c:var(--teal)"><b>契約の管理</b><small>重複の確認</small></a>
    <a href="#/donate" style="--c:var(--gold)"><b>活動を支援</b><small>任意の寄付</small></a>
    <a href="#/account" style="--c:var(--coral)"><b>アカウント</b><small>登録情報・退会</small></a>
  </div>`;
}

// ---------------- ルーター ----------------
const ROUTES = { home: renderHome, cert: renderCert, support: renderSupport, pets: renderPets, wishes: renderWishes, contracts: renderContracts, donate: renderDonate, account: renderAccount, menu: renderMenu };

async function render() {
  const key = (location.hash.replace(/^#\/?/, '').split(/[?/]/)[0]) || 'home';
  const nav = [$('#rail'), $('#tabbar')];
  if (!token) {
    nav.forEach((n) => n.classList.add('hidden'));
    $('.app').style.display = 'block';
    return renderAuth();
  }
  $('.app').style.display = '';
  nav.forEach((n) => n.classList.remove('hidden'));
  document.querySelectorAll('[data-r]').forEach((a) => a.classList.toggle('active', a.dataset.r === key));
  try {
    await (ROUTES[key] || renderHome)();
    window.scrollTo(0, 0);
  } catch (e) {
    if (token) view.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

window.addEventListener('hashchange', render);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
render();
})();
