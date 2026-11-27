(() => {
'use strict';
const API = window.GTHL_API;
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dt = (s) => (s ? new Date(s).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const mins = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 6e4) + '分' : '—');
// 職員のログイン情報は端末に残さない（タブを閉じると破棄）
let token = sessionStorage.getItem('gthl-staff');
let me = null;
let tab = 'requests';
const LABEL = { received: '受付', quoted: '見積提示', approved: '本人同意', started: '対応中', done: '完了', cancelled: '取消' };

function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
async function api(path, opt = {}) {
  const res = await fetch(API + path, { method: opt.method || 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: opt.body ? JSON.stringify(opt.body) : undefined });
  let data = {}; try { data = await res.json(); } catch {}
  if (res.status === 401) { token = null; sessionStorage.removeItem('gthl-staff'); render(); }
  if (!res.ok) throw new Error(data.error || '通信に失敗しました');
  return data;
}

function login() {
  view.innerHTML = `
  <div style="max-width:420px;margin:8vh auto" class="card stack">
    <span class="eyebrow">Operations console</span><h2>職員管理画面</h2>
    <form id="f" class="stack">
      <label class="f">メールアドレス<input type="email" name="email" required></label>
      <label class="f">パスワード<input type="password" name="password" required></label>
      <button class="btn" type="submit">ログイン</button>
    </form>
    <p class="small muted" style="margin:0">職員・管理者の権限があるアカウントのみ利用できます。</p>
  </div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const o = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: o });
      if (!['staff', 'admin'].includes(r.member.role)) { toast('職員権限がありません'); return; }
      token = r.token; sessionStorage.setItem('gthl-staff', token); render();
    } catch (err) { toast(err.message); }
  };
}

async function render() {
  if (!token) return login();
  try { me = (await api('/api/me')).member; } catch { return; }
  if (!['staff', 'admin'].includes(me.role)) { token = null; sessionStorage.removeItem('gthl-staff'); return login(); }
  const s = await api('/api/staff/summary');
  view.innerHTML = `
  <div class="row" style="justify-content:space-between;margin-bottom:20px">
    <div><b style="font:600 24px/1 var(--latin)">115<i style="font-style:normal;color:var(--coral)">en.</i></b> <span class="small muted">職員管理画面</span></div>
    <div class="row"><span class="small muted">${esc(me.name)}（${me.role === 'admin' ? '管理者' : '職員'}）</span><button class="btn sm ghost" id="out">ログアウト</button></div>
  </div>
  <div class="grid3" style="grid-template-columns:repeat(5,minmax(0,1fr));margin-bottom:22px">
    ${[['登録会員', s.members], ['本人確認済', s.verified], ['新規の申込', s.new_requests], ['対応中', s.open_requests], ['有効な証明書', s.active_certs]].map(([k, v]) => `<div class="card stat"><b>${Number(v).toLocaleString()}</b><small>${k}</small></div>`).join('')}
  </div>
  <div class="segs" style="max-width:${me.role === 'admin' ? 480 : 320}px;grid-template-columns:repeat(${me.role === 'admin' ? 3 : 2},1fr)" id="tabs">
    <button data-t="requests" class="${tab === 'requests' ? 'on' : ''}">申込</button>
    <button data-t="members" class="${tab === 'members' ? 'on' : ''}">会員</button>
    ${me.role === 'admin' ? `<button data-t="audit" class="${tab === 'audit' ? 'on' : ''}">監査ログ</button>` : ''}
  </div>
  <div id="pane"></div>
  <p class="small muted" style="margin-top:20px">閲覧・操作はすべて監査ログに記録。必要な範囲の情報だけを閲覧してください。</p>`;
  $('#out').onclick = () => { api('/api/auth/logout', { method: 'POST' }).catch(() => {}); token = null; sessionStorage.removeItem('gthl-staff'); render(); };
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) { tab = b.dataset.t; render(); } };
  ({ requests: paneRequests, members: paneMembers, audit: paneAudit })[tab]();
}

async function paneRequests(status = '') {
  const r = await api('/api/staff/requests' + (status ? '?status=' + status : ''));
  $('#pane').innerHTML = `
  <div class="row" style="margin:6px 0 12px"><select id="st" style="max-width:220px"><option value="">未完了すべて</option>${Object.entries(LABEL).map(([k, v]) => `<option value="${k}" ${k === status ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
  <div class="card scroll"><table class="t">
    <tr><th>受付</th><th>会員</th><th>項目・内容</th><th>状態</th><th>受付→着手</th><th>担当</th><th>操作</th></tr>
    ${r.requests.map((x) => `<tr>
      <td class="small">${dt(x.received_at)}</td>
      <td>${esc(x.member_name)}<div class="small muted">${esc(x.member_id)}<br>${esc(x.member_phone || '')}</div></td>
      <td><b>${esc(x.catalog_name)}</b>${x.note ? `<div class="small" style="white-space:pre-wrap">${esc(x.note)}</div>` : ''}${x.preferred_at ? `<div class="small muted">希望 ${esc(x.preferred_at)}</div>` : ''}${x.quote_amount != null ? `<div class="small muted">見積 ${Number(x.quote_amount).toLocaleString()}円 ${esc(x.quote_note || '')}</div>` : ''}</td>
      <td><span class="pill ${x.status === 'received' ? 'ng' : x.status === 'approved' ? 'warn' : x.status === 'done' ? 'ok' : ''}">${LABEL[x.status]}</span></td>
      <td class="small">${mins(x.received_at, x.started_at)}</td>
      <td><input type="text" value="${esc(x.assignee || '')}" data-as="${x.id}" style="min-width:90px;padding:6px 8px"></td>
      <td><div class="row">
        ${['received', 'quoted'].includes(x.status) ? `<button class="btn sm ghost" data-q="${x.id}">見積</button>` : ''}
        ${x.status === 'approved' || (x.status === 'quoted' && Number(x.quote_amount) === 0) ? `<button class="btn sm" data-s="started" data-id="${x.id}">着手</button>` : ''}
        ${x.status === 'started' ? `<button class="btn sm coral" data-s="done" data-id="${x.id}">完了</button>` : ''}
        ${!['done', 'cancelled'].includes(x.status) ? `<button class="btn sm ghost" data-s="cancelled" data-id="${x.id}">取消</button>` : ''}
      </div></td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">該当なし</div></td></tr>'}
  </table></div>`;
  $('#st').onchange = (e) => paneRequests(e.target.value);
  const reload = () => paneRequests(status);
  $('#pane').querySelectorAll('[data-q]').forEach((b) => (b.onclick = async () => {
    const amt = prompt('見積額（円・税込、実費別）', '0'); if (amt == null) return;
    const note = prompt('見積の内訳・条件（本人に表示されます）', '') || '';
    try { await api('/api/staff/requests/' + b.dataset.q, { method: 'PATCH', body: { quote_amount: Number(amt), quote_note: note } }); toast('見積を提示'); reload(); } catch (e) { toast(e.message); }
  }));
  $('#pane').querySelectorAll('[data-s]').forEach((b) => (b.onclick = async () => {
    if (b.dataset.s === 'cancelled' && !confirm('この申込を取り消しますか。')) return;
    try { await api('/api/staff/requests/' + b.dataset.id, { method: 'PATCH', body: { status: b.dataset.s } }); reload(); } catch (e) { toast(e.message); }
  }));
  $('#pane').querySelectorAll('[data-as]').forEach((i) => (i.onchange = async () => {
    try { await api('/api/staff/requests/' + i.dataset.as, { method: 'PATCH', body: { assignee: i.value } }); toast('担当を更新'); } catch (e) { toast(e.message); }
  }));
}

async function paneMembers(q = '') {
  const r = await api('/api/staff/members?q=' + encodeURIComponent(q));
  $('#pane').innerHTML = `
  <div class="row" style="margin:6px 0 12px"><input type="text" id="mq" placeholder="会員ID・氏名・メールで検索" value="${esc(q)}" style="max-width:340px"><button class="btn sm" id="ms">検索</button></div>
  <div class="card scroll"><table class="t">
    <tr><th>会員ID</th><th>氏名</th><th>連絡先</th><th>本人確認</th><th>登録</th><th></th></tr>
    ${r.members.map((m) => `<tr>
      <td class="latin">${esc(m.id)}</td><td>${esc(m.name)}<div class="small muted">${esc(m.name_kana || '')}</div></td>
      <td class="small">${esc(m.email)}<br>${esc(m.phone || '')}</td>
      <td>${m.identity_status === 'verified' ? `<span class="pill ok">確認済</span><div class="small muted">${dt(m.identity_at)}</div>` : '<span class="pill warn">未確認</span>'}</td>
      <td class="small">${dt(m.created_at)}${m.status !== 'active' ? '<br><span class="pill">退会</span>' : ''}</td>
      <td>${m.identity_status === 'verified' ? `<button class="btn sm ghost" data-v="0" data-id="${m.id}">確認を取消</button>` : `<button class="btn sm" data-v="1" data-id="${m.id}">本人確認済にする</button>`}</td>
    </tr>`).join('') || '<tr><td colspan="6"><div class="empty">該当なし</div></td></tr>'}
  </table></div>
  <p class="small muted">JPKI（デジタル庁認証API）の導入までは、面談・本人確認書類での確認結果を記録。確認書類の写しはこの画面には保存しません。</p>`;
  $('#ms').onclick = () => paneMembers($('#mq').value);
  $('#mq').onkeydown = (e) => { if (e.key === 'Enter') paneMembers(e.target.value); };
  $('#pane').querySelectorAll('[data-v]').forEach((b) => (b.onclick = async () => {
    const yes = b.dataset.v === '1';
    const memo = yes ? prompt('確認方法のメモ（例：面談・運転免許証）') : '';
    if (yes && memo == null) return;
    try { await api(`/api/staff/members/${b.dataset.id}/identity`, { method: 'POST', body: { verified: yes, memo } }); paneMembers(q); } catch (e) { toast(e.message); }
  }));
}

async function paneAudit() {
  const r = await api('/api/staff/audit');
  $('#pane').innerHTML = `<div class="card scroll"><table class="t"><tr><th>日時</th><th>実行者</th><th>操作</th><th>対象</th><th>詳細</th></tr>
    ${r.audit.map((a) => `<tr><td class="small">${dt(a.at)}</td><td class="latin small">${esc(a.actor)}</td><td class="small">${esc(a.action)}</td><td class="latin small">${esc(a.target || '')}</td><td class="small muted">${esc(a.detail || '')}</td></tr>`).join('')}
  </table></div>`;
}

render();
})();
