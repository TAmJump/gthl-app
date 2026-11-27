// GO TO HAPPY LIFE 生活支援アプリ API（Cloudflare Worker + D1）
import catalog from '../../docs/catalog.json';

const CONSENT_VERSION = '2026-11-v1';
const SESSION_DAYS = 30;
const CERT_DAYS = 30;
const CONTRACT_CATEGORIES = ['死後事務', '生活支援', '身元保証', '財産管理', '任意後見', '遺言'];
const REQUEST_STATUS = ['received', 'quoted', 'approved', 'started', 'done', 'cancelled'];

// ---------- 共通 ----------
const now = () => new Date().toISOString();
const addDays = (d) => new Date(Date.now() + d * 864e5).toISOString();
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randToken = (n = 32) => {
  const a = crypto.getRandomValues(new Uint8Array(n));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const uid = (p) => p + '-' + randToken(9);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function corsHeaders(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || allowed.includes('*');
  return {
    'Access-Control-Allow-Origin': ok ? origin : (allowed[0] || ''),
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });

async function body(req) {
  try { return await req.json(); } catch { throw new HttpError(400, 'JSONの形式が正しくありません'); }
}

const str = (v, max = 200) => (v == null ? '' : String(v).trim().slice(0, max));

// ---------- 暗号化（要配慮情報） ----------
async function dataKey(env) {
  if (!env.DATA_KEY) throw new HttpError(500, 'DATA_KEY が未設定です');
  return crypto.subtle.importKey('raw', unb64(env.DATA_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, text) {
  if (text == null || text === '') return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await dataKey(env), enc.encode(String(text)));
  return b64(iv) + '.' + b64(ct);
}
async function open(env, sealed) {
  if (!sealed) return '';
  const [iv, ct] = sealed.split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await dataKey(env), unb64(ct));
  return new TextDecoder().decode(pt);
}

// ---------- パスワード ----------
async function hashPassword(password, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return { hash: b64(bits), salt: b64(salt) };
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- 監査ログ ----------
async function audit(env, actor, action, target = null, detail = null) {
  await env.DB.prepare('INSERT INTO audit_log(at,actor,action,target,detail) VALUES (?,?,?,?,?)')
    .bind(now(), actor, action, target, detail ? JSON.stringify(detail).slice(0, 1000) : null).run();
}

async function nextId(env, name, prefix, width) {
  const row = await env.DB.prepare('UPDATE counters SET value = value + 1 WHERE name = ? RETURNING value').bind(name).first();
  return prefix + String(row.value).padStart(width, '0');
}

// ---------- 認証 ----------
async function rateLimit(env, key, limit = 8, windowMin = 15) {
  const row = await env.DB.prepare('SELECT count, window_start FROM login_attempts WHERE key = ?').bind(key).first();
  const t = Date.now();
  if (!row || t - Date.parse(row.window_start) > windowMin * 6e4) {
    await env.DB.prepare('INSERT OR REPLACE INTO login_attempts(key,count,window_start) VALUES (?,?,?)').bind(key, 1, now()).run();
    return;
  }
  if (row.count >= limit) throw new HttpError(429, 'しばらく時間をおいて再度お試しください');
  await env.DB.prepare('UPDATE login_attempts SET count = count + 1 WHERE key = ?').bind(key).run();
}

async function createSession(env, memberId) {
  const token = randToken(32);
  await env.DB.prepare('INSERT INTO sessions(token_hash,member_id,expires_at,created_at) VALUES (?,?,?,?)')
    .bind(await sha256(token), memberId, addDays(SESSION_DAYS), now()).run();
  return token;
}

async function auth(env, req, roles = null) {
  const h = req.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) throw new HttpError(401, 'ログインしてください');
  const row = await env.DB.prepare(
    `SELECT m.* , s.expires_at FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token_hash = ?`
  ).bind(await sha256(token)).first();
  if (!row || Date.parse(row.expires_at) < Date.now() || row.status !== 'active') throw new HttpError(401, 'ログインの有効期限が切れています');
  if (roles && !roles.includes(row.role)) throw new HttpError(403, 'この操作の権限がありません');
  return row;
}

const publicMember = (m) => ({
  id: m.id, email: m.email, role: m.role, name: m.name, name_kana: m.name_kana, birthdate: m.birthdate,
  phone: m.phone, lang: m.lang, identity_status: m.identity_status, identity_method: m.identity_method,
  identity_at: m.identity_at, created_at: m.created_at,
});

// ---------- ハンドラ ----------
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

route('GET', '/api/health', async () => json({ ok: true, consent_version: CONSENT_VERSION }));

route('POST', '/api/auth/register', async (env, req) => {
  const b = await body(req);
  const email = str(b.email, 200).toLowerCase();
  const password = String(b.password || '');
  const name = str(b.name, 80);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'メールアドレスを確認してください');
  if (password.length < 10) throw new HttpError(400, 'パスワードは10文字以上にしてください');
  if (!name) throw new HttpError(400, '氏名を入力してください');
  if (b.consent !== CONSENT_VERSION) throw new HttpError(400, '利用規約・プライバシーポリシーへの同意が必要です');
  await rateLimit(env, 'reg:' + (req.headers.get('CF-Connecting-IP') || 'x'), 10, 60);
  const exists = await env.DB.prepare('SELECT id FROM members WHERE email = ?').bind(email).first();
  if (exists) throw new HttpError(409, 'このメールアドレスは登録済みです');
  const { hash, salt } = await hashPassword(password);
  const id = await nextId(env, 'member', 'GTHL-', 6);
  const t = now();
  await env.DB.prepare(
    `INSERT INTO members(id,email,pass_hash,pass_salt,name,name_kana,birthdate,phone,lang,consent_version,consent_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, email, hash, salt, name, str(b.name_kana, 80), str(b.birthdate, 10), str(b.phone, 20), str(b.lang, 5) || 'ja',
    CONSENT_VERSION, t, t, t).run();
  await audit(env, id, 'member.register', id);
  const token = await createSession(env, id);
  const m = await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(id).first();
  return json({ token, member: publicMember(m) }, 201);
});

route('POST', '/api/auth/login', async (env, req) => {
  const b = await body(req);
  const email = str(b.email, 200).toLowerCase();
  await rateLimit(env, 'login:' + email);
  const m = await env.DB.prepare('SELECT * FROM members WHERE email = ? AND status = ?').bind(email, 'active').first();
  const { hash } = await hashPassword(String(b.password || ''), m ? m.pass_salt : undefined);
  if (!m || !safeEqual(hash, m.pass_hash)) throw new HttpError(401, 'メールアドレスまたはパスワードが違います');
  await env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind('login:' + email).run();
  await audit(env, m.id, 'auth.login', m.id);
  return json({ token: await createSession(env, m.id), member: publicMember(m) });
});

route('POST', '/api/auth/logout', async (env, req) => {
  const token = (req.headers.get('Authorization') || '').slice(7);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return json({ ok: true });
});

route('GET', '/api/me', async (env, req) => {
  const m = await auth(env, req);
  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM contracts WHERE member_id = ?1) AS contracts,
            (SELECT COUNT(*) FROM requests WHERE member_id = ?1 AND status NOT IN ('done','cancelled')) AS open_requests,
            (SELECT COUNT(*) FROM pets WHERE member_id = ?1) AS pets`
  ).bind(m.id).first();
  return json({
    member: { ...publicMember(m), address: await open(env, m.address_enc), emergency: await open(env, m.emergency_enc) },
    counts,
  });
});

route('PUT', '/api/me', async (env, req) => {
  const m = await auth(env, req);
  const b = await body(req);
  await env.DB.prepare(
    `UPDATE members SET name=?, name_kana=?, birthdate=?, phone=?, lang=?, address_enc=?, emergency_enc=?, updated_at=? WHERE id=?`
  ).bind(str(b.name, 80) || m.name, str(b.name_kana, 80), str(b.birthdate, 10), str(b.phone, 20), str(b.lang, 5) || 'ja',
    await seal(env, str(b.address, 300)), await seal(env, str(b.emergency, 300)), now(), m.id).run();
  await audit(env, m.id, 'member.update', m.id);
  return json({ ok: true });
});

route('POST', '/api/me/withdraw', async (env, req) => {
  const m = await auth(env, req);
  await env.DB.prepare(`UPDATE members SET status='withdrawn', updated_at=? WHERE id=?`).bind(now(), m.id).run();
  await env.DB.prepare(`UPDATE certificates SET revoked_at=? WHERE member_id=? AND revoked_at IS NULL`).bind(now(), m.id).run();
  await env.DB.prepare('DELETE FROM sessions WHERE member_id = ?').bind(m.id).run();
  await audit(env, m.id, 'member.withdraw', m.id);
  return json({ ok: true });
});

// ---------- 証明書 ----------
route('GET', '/api/certificates', async (env, req) => {
  const m = await auth(env, req);
  const { results } = await env.DB.prepare(
    'SELECT id, scope, issued_at, expires_at, revoked_at FROM certificates WHERE member_id = ? ORDER BY issued_at DESC LIMIT 20'
  ).bind(m.id).all();
  return json({ certificates: results });
});

route('POST', '/api/certificates', async (env, req) => {
  const m = await auth(env, req);
  const t = now();
  // 有効な証明書は1枚だけにする（再発行時は旧証明書を失効）
  await env.DB.prepare('UPDATE certificates SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL').bind(t, m.id).run();
  const id = await nextId(env, 'cert', 'C' + t.slice(2, 4) + '-', 7);
  const token = randToken(24);
  await env.DB.prepare('INSERT INTO certificates(id,member_id,token_hash,issued_at,expires_at) VALUES (?,?,?,?,?)')
    .bind(id, m.id, await sha256(token), t, addDays(CERT_DAYS)).run();
  await audit(env, m.id, 'cert.issue', id);
  return json({ id, token, issued_at: t, expires_at: addDays(CERT_DAYS) }, 201);
});

route('POST', '/api/certificates/:id/revoke', async (env, req, p) => {
  const m = await auth(env, req);
  const r = await env.DB.prepare('UPDATE certificates SET revoked_at = ? WHERE id = ? AND member_id = ? AND revoked_at IS NULL')
    .bind(now(), p.id, m.id).run();
  if (!r.meta.changes) throw new HttpError(404, '有効な証明書が見つかりません');
  await audit(env, m.id, 'cert.revoke', p.id);
  return json({ ok: true });
});

// 第三者照会（ログイン不要）。表示は必要最小限。
route('GET', '/api/verify/:token', async (env, req, p) => {
  await rateLimit(env, 'verify:' + (req.headers.get('CF-Connecting-IP') || 'x'), 60, 10);
  const c = await env.DB.prepare(
    `SELECT c.*, m.name, m.identity_status, m.identity_at, m.status AS member_status FROM certificates c
     JOIN members m ON m.id = c.member_id WHERE c.token_hash = ?`
  ).bind(await sha256(p.token)).first();
  if (!c) return json({ valid: false, reason: 'not_found' }, 404);
  let state = 'valid';
  if (c.revoked_at) state = 'revoked';
  else if (Date.parse(c.expires_at) < Date.now()) state = 'expired';
  else if (c.member_status !== 'active') state = 'withdrawn';
  await env.DB.prepare('INSERT INTO cert_lookups(certificate_id,looked_at,result) VALUES (?,?,?)').bind(c.id, now(), state).run();
  const out = { valid: state === 'valid', state, certificate_id: c.id, issued_at: c.issued_at, expires_at: c.expires_at };
  if (state === 'valid') {
    Object.assign(out, {
      name: c.name,
      identity_verified: c.identity_status === 'verified',
      identity_at: c.identity_at,
      registered: true,
      // MVPでは保証・緊急対応・代理権は証明書の対象外
      guarantee: 'none', emergency_contract: 'none', medical_consent_or_agency: 'none',
    });
  }
  return json(out);
});

// ---------- 生活支援の申込 ----------
route('GET', '/api/requests', async (env, req) => {
  const m = await auth(env, req);
  const { results } = await env.DB.prepare(
    `SELECT id, catalog_id, catalog_name, preferred_at, status, quote_amount, quote_note, approved_at, received_at, started_at, done_at
     FROM requests WHERE member_id = ? ORDER BY received_at DESC LIMIT 100`
  ).bind(m.id).all();
  return json({ requests: results });
});

route('POST', '/api/requests', async (env, req) => {
  const m = await auth(env, req);
  const b = await body(req);
  const item = catalog.find((c) => c.id === Number(b.catalog_id));
  if (!item) throw new HttpError(400, '支援項目が見つかりません');
  const id = uid('R');
  const t = now();
  await env.DB.prepare(
    `INSERT INTO requests(id,member_id,catalog_id,catalog_name,note_enc,preferred_at,received_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`
  ).bind(id, m.id, item.id, item.field + '／' + item.name, await seal(env, str(b.note, 2000)), str(b.preferred_at, 40), t, t).run();
  await audit(env, m.id, 'request.create', id, { catalog_id: item.id });
  return json({ id, status: 'received', received_at: t }, 201);
});

route('POST', '/api/requests/:id/approve', async (env, req, p) => {
  const m = await auth(env, req);
  const r = await env.DB.prepare(
    `UPDATE requests SET status='approved', approved_at=?, updated_at=? WHERE id=? AND member_id=? AND status='quoted'`
  ).bind(now(), now(), p.id, m.id).run();
  if (!r.meta.changes) throw new HttpError(409, '見積の確認ができる状態ではありません');
  await audit(env, m.id, 'request.approve', p.id);
  return json({ ok: true });
});

route('POST', '/api/requests/:id/cancel', async (env, req, p) => {
  const m = await auth(env, req);
  const r = await env.DB.prepare(
    `UPDATE requests SET status='cancelled', updated_at=? WHERE id=? AND member_id=? AND status IN ('received','quoted','approved')`
  ).bind(now(), p.id, m.id).run();
  if (!r.meta.changes) throw new HttpError(409, 'この申込は取り消しできません');
  await audit(env, m.id, 'request.cancel', p.id);
  return json({ ok: true });
});

// ---------- ペット ----------
route('GET', '/api/pets', async (env, req) => {
  const m = await auth(env, req);
  const { results } = await env.DB.prepare('SELECT * FROM pets WHERE member_id = ? ORDER BY alive DESC, created_at').bind(m.id).all();
  const pets = [];
  for (const r of results) { const { care_enc, ...rest } = r; pets.push({ ...rest, care: await open(env, care_enc) }); }
  return json({ pets });
});

async function petFields(env, b) {
  return [str(b.name, 60), str(b.species, 40), Number(b.birth_year) || null, b.alive === false || b.alive === 0 ? 0 : 1,
    str(b.vet, 200), await seal(env, str(b.care, 2000)), str(b.caretaker, 200), b.caretaker_consent ? 1 : 0, str(b.after_wish, 1000)];
}

route('POST', '/api/pets', async (env, req) => {
  const m = await auth(env, req);
  const b = await body(req);
  if (!str(b.name)) throw new HttpError(400, '名前を入力してください');
  const id = uid('P');
  const t = now();
  await env.DB.prepare(
    `INSERT INTO pets(id,member_id,name,species,birth_year,alive,vet,care_enc,caretaker,caretaker_consent,after_wish,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, m.id, ...(await petFields(env, b)), t, t).run();
  await audit(env, m.id, 'pet.create', id);
  return json({ id }, 201);
});

route('PUT', '/api/pets/:id', async (env, req, p) => {
  const m = await auth(env, req);
  const b = await body(req);
  const r = await env.DB.prepare(
    `UPDATE pets SET name=?,species=?,birth_year=?,alive=?,vet=?,care_enc=?,caretaker=?,caretaker_consent=?,after_wish=?,updated_at=?
     WHERE id=? AND member_id=?`
  ).bind(...(await petFields(env, b)), now(), p.id, m.id).run();
  if (!r.meta.changes) throw new HttpError(404, '見つかりません');
  await audit(env, m.id, 'pet.update', p.id);
  return json({ ok: true });
});

route('DELETE', '/api/pets/:id', async (env, req, p) => {
  const m = await auth(env, req);
  await env.DB.prepare('DELETE FROM pets WHERE id = ? AND member_id = ?').bind(p.id, m.id).run();
  await audit(env, m.id, 'pet.delete', p.id);
  return json({ ok: true });
});

// ---------- 生前・死後の希望 ----------
route('GET', '/api/wishes', async (env, req) => {
  const m = await auth(env, req);
  const w = await env.DB.prepare('SELECT * FROM wishes WHERE member_id = ?').bind(m.id).first();
  if (!w) return json({ wishes: null });
  return json({
    wishes: {
      medical: await open(env, w.medical_enc), contact: await open(env, w.contact_enc), funeral: w.funeral,
      belongings: w.belongings, message: await open(env, w.message_enc), updated_at: w.updated_at,
    },
  });
});

route('PUT', '/api/wishes', async (env, req) => {
  const m = await auth(env, req);
  const b = await body(req);
  await env.DB.prepare(
    `INSERT INTO wishes(member_id,medical_enc,contact_enc,funeral,belongings,message_enc,updated_at) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(member_id) DO UPDATE SET medical_enc=excluded.medical_enc, contact_enc=excluded.contact_enc,
     funeral=excluded.funeral, belongings=excluded.belongings, message_enc=excluded.message_enc, updated_at=excluded.updated_at`
  ).bind(m.id, await seal(env, str(b.medical, 2000)), await seal(env, str(b.contact, 1000)), str(b.funeral, 2000),
    str(b.belongings, 2000), await seal(env, str(b.message, 3000)), now()).run();
  await audit(env, m.id, 'wishes.update', m.id);
  return json({ ok: true });
});

// ---------- 契約の横断管理（他社契約を含む） ----------
route('GET', '/api/contracts', async (env, req) => {
  const m = await auth(env, req);
  const { results } = await env.DB.prepare('SELECT * FROM contracts WHERE member_id = ? ORDER BY category, created_at').bind(m.id).all();
  const byCat = {};
  results.forEach((c) => (byCat[c.category] = (byCat[c.category] || 0) + 1));
  const overlaps = Object.entries(byCat).filter(([, n]) => n > 1).map(([category, count]) => ({ category, count }));
  return json({ contracts: results, overlaps, categories: CONTRACT_CATEGORIES });
});

route('POST', '/api/contracts', async (env, req) => {
  const m = await auth(env, req);
  const b = await body(req);
  if (!str(b.provider)) throw new HttpError(400, '契約先を入力してください');
  if (!CONTRACT_CATEGORIES.includes(b.category)) throw new HttpError(400, '業務区分を選んでください');
  const id = uid('K');
  const t = now();
  await env.DB.prepare(
    'INSERT INTO contracts(id,member_id,provider,category,signed_on,ends_on,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(id, m.id, str(b.provider, 120), b.category, str(b.signed_on, 10), str(b.ends_on, 10), str(b.note, 1000), t, t).run();
  await audit(env, m.id, 'contract.create', id, { category: b.category });
  return json({ id }, 201);
});

route('DELETE', '/api/contracts/:id', async (env, req, p) => {
  const m = await auth(env, req);
  await env.DB.prepare('DELETE FROM contracts WHERE id = ? AND member_id = ?').bind(p.id, m.id).run();
  await audit(env, m.id, 'contract.delete', p.id);
  return json({ ok: true });
});

// ---------- 任意寄付（Square） ----------
route('POST', '/api/donations', async (env, req) => {
  let member = null;
  try { member = await auth(env, req); } catch { /* 非会員も寄付可 */ }
  const b = await body(req);
  const amount = Math.floor(Number(b.amount));
  const frequency = b.frequency === 'monthly' ? 'monthly' : 'once';
  if (!(amount >= 100 && amount <= 1000000)) throw new HttpError(400, '金額は100円以上で指定してください');
  if (!env.SQUARE_ACCESS_TOKEN || !env.SQUARE_LOCATION_ID) {
    return json({ ready: false, message: '寄付の受付は準備中です' });
  }
  const id = uid('D');
  const base = env.SQUARE_ENV === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
  const payload = {
    idempotency_key: id,
    quick_pay: {
      name: frequency === 'monthly' ? 'GO TO HAPPY LIFE ご支援（毎月・初回）' : 'GO TO HAPPY LIFE ご支援',
      price_money: { amount, currency: 'JPY' },
      location_id: env.SQUARE_LOCATION_ID,
    },
    checkout_options: { redirect_url: (env.APP_URL || '') + '/#/donate?done=1' },
    payment_note: 'donation:' + id,
  };
  const res = await fetch(base + '/v2/online-checkout/payment-links', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.SQUARE_ACCESS_TOKEN, 'Content-Type': 'application/json', 'Square-Version': '2024-10-17' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new HttpError(502, '決済画面の作成に失敗しました');
  await env.DB.prepare('INSERT INTO donations(id,member_id,amount,frequency,provider_ref,created_at) VALUES (?,?,?,?,?,?)')
    .bind(id, member ? member.id : null, amount, frequency, data.payment_link.order_id, now()).run();
  await audit(env, member ? member.id : 'public', 'donation.create', id, { amount, frequency });
  return json({ ready: true, url: data.payment_link.url });
});

// Square Webhook。同一Squareアカウントの他アプリの決済も届くため、application_id で絞り込む。
route('POST', '/api/square/webhook', async (env, req) => {
  const raw = await req.text();
  const sig = req.headers.get('x-square-hmacsha256-signature') || '';
  if (!env.SQUARE_WEBHOOK_KEY || !env.SQUARE_WEBHOOK_URL) throw new HttpError(503, 'not configured');
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SQUARE_WEBHOOK_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = b64(await crypto.subtle.sign('HMAC', key, enc.encode(env.SQUARE_WEBHOOK_URL + raw)));
  if (!safeEqual(mac, sig)) throw new HttpError(401, 'invalid signature');
  const ev = JSON.parse(raw);
  const pay = ev?.data?.object?.payment;
  if (!pay) return json({ ignored: true });
  if (env.SQUARE_APPLICATION_ID && pay.application_details?.application_id !== env.SQUARE_APPLICATION_ID) return json({ ignored: 'other_app' });
  if (pay.status === 'COMPLETED' && pay.order_id) {
    const r = await env.DB.prepare(`UPDATE donations SET status='paid', paid_at=? WHERE provider_ref=? AND status='pending'`)
      .bind(now(), pay.order_id).run();
    if (r.meta.changes) await audit(env, 'system', 'donation.paid', pay.order_id);
  }
  return json({ ok: true });
});

// ---------- 職員 ----------
route('GET', '/api/staff/summary', async (env, req) => {
  await auth(env, req, ['staff', 'admin']);
  const r = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM members WHERE role='member' AND status='active') AS members,
            (SELECT COUNT(*) FROM members WHERE role='member' AND identity_status='verified') AS verified,
            (SELECT COUNT(*) FROM requests WHERE status IN ('received','quoted','approved','started')) AS open_requests,
            (SELECT COUNT(*) FROM requests WHERE status='received') AS new_requests,
            (SELECT COUNT(*) FROM certificates WHERE revoked_at IS NULL AND expires_at > ?) AS active_certs,
            (SELECT COALESCE(SUM(amount),0) FROM donations WHERE status='paid') AS donations_paid`
  ).bind(now()).first();
  return json(r);
});

route('GET', '/api/staff/requests', async (env, req) => {
  const s = await auth(env, req, ['staff', 'admin']);
  const status = new URL(req.url).searchParams.get('status');
  const where = status && REQUEST_STATUS.includes(status) ? 'WHERE r.status = ?' : `WHERE r.status NOT IN ('done','cancelled')`;
  const stmt = env.DB.prepare(
    `SELECT r.*, m.name AS member_name, m.phone AS member_phone FROM requests r JOIN members m ON m.id = r.member_id
     ${where} ORDER BY r.received_at DESC LIMIT 200`
  );
  const { results } = await (status && REQUEST_STATUS.includes(status) ? stmt.bind(status) : stmt).all();
  const out = [];
  for (const r of results) { const { note_enc, ...rest } = r; out.push({ ...rest, note: await open(env, note_enc) }); }
  await audit(env, s.id, 'staff.requests.list', null, { status });
  return json({ requests: out });
});

route('PATCH', '/api/staff/requests/:id', async (env, req, p) => {
  const s = await auth(env, req, ['staff', 'admin']);
  const b = await body(req);
  const r = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(p.id).first();
  if (!r) throw new HttpError(404, '見つかりません');
  const t = now();
  const sets = ['updated_at = ?'];
  const vals = [t];
  if (['done', 'cancelled'].includes(r.status) && (b.status || b.quote_amount != null)) throw new HttpError(409, '終了済みの申込です');
  if (b.status === 'done' && r.status !== 'started') throw new HttpError(409, '着手後に完了にしてください');
  if (b.quote_amount != null) {
    if (!['received', 'quoted'].includes(r.status)) throw new HttpError(409, '本人の同意後は見積を変更できません');
    const q = Math.floor(Number(b.quote_amount));
    if (!(q >= 0)) throw new HttpError(400, '見積額を確認してください');
    sets.push("quote_amount = ?", "quote_note = ?", "status = 'quoted'");
    vals.push(q, str(b.quote_note, 500));
  }
  if (b.status) {
    if (!['started', 'done', 'cancelled'].includes(b.status)) throw new HttpError(400, '状態の指定が正しくありません');
    if (b.status === 'started' && r.status !== 'approved' && !(r.quote_amount === 0 && r.status === 'quoted'))
      throw new HttpError(409, '本人の見積確認後に着手してください');
    sets.push('status = ?'); vals.push(b.status);
    if (b.status === 'started') { sets.push('started_at = ?'); vals.push(t); }
    if (b.status === 'done') { sets.push('done_at = ?'); vals.push(t); }
  }
  if (b.assignee != null) { sets.push('assignee = ?'); vals.push(str(b.assignee, 60)); }
  await env.DB.prepare(`UPDATE requests SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, p.id).run();
  await audit(env, s.id, 'staff.request.update', p.id, b);
  return json({ ok: true });
});

route('GET', '/api/staff/members', async (env, req) => {
  const s = await auth(env, req, ['staff', 'admin']);
  const q = str(new URL(req.url).searchParams.get('q'), 60);
  const like = '%' + q + '%';
  const { results } = await env.DB.prepare(
    `SELECT id, name, name_kana, email, phone, identity_status, identity_method, identity_at, status, created_at FROM members
     WHERE role = 'member' AND (?1 = '' OR id LIKE ?2 OR name LIKE ?2 OR name_kana LIKE ?2 OR email LIKE ?2)
     ORDER BY created_at DESC LIMIT 100`
  ).bind(q, like).all();
  await audit(env, s.id, 'staff.members.list', null, { q });
  return json({ members: results });
});

// 本人確認（JPKI導入までは職員による対面・書類確認を記録）
route('POST', '/api/staff/members/:id/identity', async (env, req, p) => {
  const s = await auth(env, req, ['staff', 'admin']);
  const b = await body(req);
  const verified = b.verified !== false;
  await env.DB.prepare('UPDATE members SET identity_status=?, identity_method=?, identity_at=?, updated_at=? WHERE id=? AND role=?')
    .bind(verified ? 'verified' : 'unverified', verified ? 'staff_check' : null, verified ? now() : null, now(), p.id, 'member').run();
  await audit(env, s.id, 'staff.identity', p.id, { verified, method: 'staff_check', memo: str(b.memo, 200) });
  return json({ ok: true });
});

route('GET', '/api/staff/audit', async (env, req) => {
  await auth(env, req, ['admin']);
  const { results } = await env.DB.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 300').all();
  return json({ audit: results });
});

route('POST', '/api/staff/role', async (env, req) => {
  const s = await auth(env, req, ['admin']);
  const b = await body(req);
  if (!['member', 'staff', 'admin'].includes(b.role)) throw new HttpError(400, '権限の指定が正しくありません');
  if (b.member_id === s.id) throw new HttpError(400, '自分の権限は変更できません');
  await env.DB.prepare('UPDATE members SET role=?, updated_at=? WHERE id=?').bind(b.role, now(), str(b.member_id, 20)).run();
  await audit(env, s.id, 'staff.role', b.member_id, { role: b.role });
  return json({ ok: true });
});

// ---------- エントリ ----------
export default {
  async fetch(req, env) {
    const cors = corsHeaders(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (m) {
          const res = await r.fn(env, req, m.groups || {});
          Object.entries(cors).forEach(([k, v]) => res.headers.set(k, v));
          return res;
        }
      }
      return json({ error: 'not found' }, 404, cors);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e && e.stack ? e.stack : e);
      return json({ error: status === 500 ? 'サーバーエラーが発生しました' : e.message }, status, cors);
    }
  },
};
