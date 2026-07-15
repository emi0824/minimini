const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');

const PORT = Number(process.env.PORT || 3000);
const PROXY_TARGET = process.env.PROXY_TARGET;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ENV_FILE = '/etc/gangwa/gangwa.env';
const MAX_BODY_SIZE = 16 * 1024;
const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000;
const GROUP_VERIFY_TTL = 30 * 24 * 60 * 60 * 1000;
const BEIJING_OFFSET = 8 * 60 * 60 * 1000;
const SUBSCRIBE_TEMPLATE_IDS = {
  squadMemberChanged: 'lsmPbz6F-1use0Ej3i5rFucq75PZhWNhJKb2AQdxES0',
  squadStatusChanged: 'm_8t4Gz308eRqgkBF0u1voEpiFkFbgsavi2skoL_FDg'
};
const SUBSCRIBE_TEMPLATE_ID_SET = new Set(Object.values(SUBSCRIBE_TEMPLATE_IDS));
const SQUAD_TAGS = ['接受分差', '不接受分差', '排位车', '匹配车', '晨练车', '破冰专属'];
const SQUAD_TAG_SET = new Set(SQUAD_TAGS);

const loadEnvFile = () => {
  try {
    if (!fs.existsSync(ENV_FILE)) return;
    fs.readFileSync(ENV_FILE, 'utf8').split('\n').forEach((line) => {
      const next = line.trim();
      if (!next || next.startsWith('#')) return;
      const index = next.indexOf('=');
      if (index <= 0) return;
      const key = next.slice(0, index).trim();
      const value = next.slice(index + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    });
  } catch (error) {
    if (error.code !== 'EACCES') throw error;
  }
};

loadEnvFile();

if (PROXY_TARGET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('生产环境禁止启用 PROXY_TARGET 代理模式');
  }

  const proxyBaseUrl = new URL(PROXY_TARGET);
  if (!['http:', 'https:'].includes(proxyBaseUrl.protocol)) {
    throw new Error('PROXY_TARGET 仅支持 http 或 https');
  }

  const proxyServer = http.createServer((req, res) => {
    if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: '代理请求地址格式错误' }));
      return;
    }
    const targetUrl = new URL(req.url, proxyBaseUrl);
    if (targetUrl.origin !== proxyBaseUrl.origin) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: '代理请求目标不允许' }));
      return;
    }
    const { authorization, cookie, ...proxyHeaders } = req.headers;
    const transport = targetUrl.protocol === 'https:' ? https : http;
    const proxyReq = transport.request(targetUrl, { method: req.method, headers: proxyHeaders }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (error) => {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: error.message || '代理请求失败' }));
    });
    req.pipe(proxyReq);
  });
  proxyServer.listen(PORT, '127.0.0.1', () => {
    console.log(`GangWa proxy listening on http://localhost:${PORT} -> ${PROXY_TARGET}`);
  });
  return;
}

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET 未配置或长度不足');
}

const allowGuestLogin = process.env.ALLOW_GUEST_LOGIN === 'true';
const adminOpenids = new Set((process.env.ADMIN_OPENIDS || '').split(',').map((item) => item.trim()).filter(Boolean));
const sessionKeyCache = new Map();

const initialData = {
  users: [],
  squads: [
    {
      id: 1,
      title: '排位复健车',
      code: '排位集结',
      creatorOpenid: 'mock_user_002',
      creatorName: '老张',
      departTime: '21:30:00',
      capacity: 5,
      note: '缺辅助，语音开黑，别鸽。',
      tags: ['接受分差', '排位车'],
      status: 'recruiting',
      passengers: [
        { id: 1, openid: 'mock_user_002', nickname: '老张', role: '队长', isLeader: true },
        { id: 2, openid: 'mock_user_003', nickname: '阿强', role: '补位', note: '21:40 到' }
      ]
    },
    {
      id: 2,
      title: '夜猫娱乐车',
      code: '夜猫行动',
      creatorOpenid: 'mock_user_004',
      creatorName: '阿坤',
      departTime: '22:40:00',
      capacity: 5,
      note: '快乐局，输赢随缘，主打一个不红温。',
      tags: ['不接受分差', '匹配车'],
      status: 'recruiting',
      passengers: [
        { id: 4, openid: 'mock_user_004', nickname: '阿坤', role: '队长', isLeader: true }
      ]
    }
  ],
  settings: {}
};

const rateLimitBuckets = new Map();

const isTrustedProxy = (remoteAddress) => (
  remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1'
);

const getClientIp = (req) => {
  const remoteAddress = req.socket.remoteAddress || 'unknown';
  const forwarded = req.headers['x-forwarded-for'];
  if (isTrustedProxy(remoteAddress) && typeof forwarded === 'string' && forwarded) {
    const forwardedIps = forwarded.split(',').map((item) => item.trim()).filter((item) => net.isIP(item));
    if (forwardedIps.length > 0) return forwardedIps[forwardedIps.length - 1];
  }
  return remoteAddress;
};

const checkRateLimit = (req, bucketName, limit, windowMs) => {
  const key = `${bucketName}:${getClientIp(req)}`;
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);
  if (bucket.count > limit) throw Object.assign(new Error('操作过于频繁，请稍后再试'), { status: 429 });
};

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (now > bucket.resetAt) rateLimitBuckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

const ensureData = () => {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
  }
};

const readData = () => {
  ensureData();
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  data.users = Array.isArray(data.users) ? data.users : [];
  data.users.forEach((user) => { delete user.sessionKey; });
  data.squads = Array.isArray(data.squads) ? data.squads : [];
  data.settings = data.settings || {};
  return data;
};

const writeData = (data) => {
  if (Array.isArray(data.users)) data.users.forEach((user) => { delete user.sessionKey; });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

let writeQueue = Promise.resolve();

const withWriteLock = async (handler) => {
  const task = writeQueue.then(async () => {
    const data = readData();
    const result = await handler(data);
    writeData(data);
    return result;
  });
  writeQueue = task.catch(() => undefined);
  return task;
};

const base64url = (value) => Buffer.from(value).toString('base64url');
const hmac = (value) => crypto.createHmac('sha256', process.env.SESSION_SECRET).update(value).digest('base64url');

const createToken = (userOpenid) => {
  const payload = base64url(JSON.stringify({ openid: userOpenid, exp: Date.now() + TOKEN_TTL }));
  return `${payload}.${hmac(payload)}`;
};

const verifyToken = (token) => {
  if (!token || typeof token !== 'string') throw Object.assign(new Error('请先登录'), { status: 401 });
  const [payload, signature] = token.split('.');
  if (!payload || !signature || hmac(payload) !== signature) throw Object.assign(new Error('登录已失效'), { status: 401 });
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!data.openid || Date.now() > data.exp) throw Object.assign(new Error('登录已过期'), { status: 401 });
  return data.openid;
};

const getAuthOpenid = (req) => {
  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return verifyToken(match?.[1]);
};

const wxRequest = (url, payload) => new Promise((resolve, reject) => {
  const target = new URL(url);
  const body = payload ? JSON.stringify(payload) : undefined;
  const request = https.request(target, {
    method: body ? 'POST' : 'GET',
    headers: body ? {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body)
    } : undefined
  }, (response) => {
    let responseBody = '';
    response.on('data', (chunk) => { responseBody += chunk; });
    response.on('end', () => {
      try {
        resolve(JSON.parse(responseBody));
      } catch (error) {
        reject(new Error('微信接口响应格式错误'));
      }
    });
  });
  request.on('error', reject);
  if (body) request.write(body);
  request.end();
});

let accessTokenCache = { token: '', expiresAt: 0 };

const getWechatAccessToken = async () => {
  if (!process.env.WECHAT_APP_ID || !process.env.WECHAT_APP_SECRET) throw new Error('微信接口配置缺失');
  if (accessTokenCache.token && Date.now() < accessTokenCache.expiresAt) return accessTokenCache.token;
  const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
  url.searchParams.set('grant_type', 'client_credential');
  url.searchParams.set('appid', process.env.WECHAT_APP_ID);
  url.searchParams.set('secret', process.env.WECHAT_APP_SECRET);
  const result = await wxRequest(url);
  if (!result.access_token) throw new Error(result.errmsg || '获取微信 access_token 失败');
  accessTokenCache = { token: result.access_token, expiresAt: Date.now() + Math.max(Number(result.expires_in || 7200) - 300, 60) * 1000 };
  return accessTokenCache.token;
};

const code2Session = async (code) => {
  if (!process.env.WECHAT_APP_ID || !process.env.WECHAT_APP_SECRET) throw new Error('微信登录配置缺失');
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', process.env.WECHAT_APP_ID);
  url.searchParams.set('secret', process.env.WECHAT_APP_SECRET);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');
  const result = await wxRequest(url);
  if (!result.openid) throw new Error(result.errmsg || '微信登录失败');
  return { openid: result.openid, sessionKey: result.session_key };
};

const decryptWechatData = (sessionKey, encryptedData, iv) => {
  const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from(sessionKey, 'base64'), Buffer.from(iv, 'base64'));
  decipher.setAutoPadding(true);
  const decoded = Buffer.concat([decipher.update(Buffer.from(encryptedData, 'base64')), decipher.final()]);
  const result = JSON.parse(decoded.toString('utf8'));
  if (result.watermark?.appid && result.watermark.appid !== process.env.WECHAT_APP_ID) throw new Error('微信群数据来源不匹配');
  if (!result.openGId) throw new Error('未获取到微信群标识');
  return result.openGId;
};

const text = (value, field, maxLength, { required = true } = {}) => {
  if (typeof value !== 'string') {
    if (!required && value == null) return '';
    throw new Error(`${field}格式错误`);
  }
  const next = value.trim();
  if (required && !next) throw new Error(`请填写${field}`);
  if (next.length > maxLength) throw new Error(`${field}不能超过${maxLength}个字符`);
  return next;
};

const nickname = (value) => text(value || '未命名成员', '昵称', 20);
const getBeijingDate = () => new Date(Date.now() + BEIJING_OFFSET).toISOString().slice(0, 10);
const departDate = (value) => {
  const next = text(value || getBeijingDate(), '发车日期', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) throw new Error('发车日期格式应为 YYYY-MM-DD');
  return next;
};
const departTime = (value) => {
  const next = text(value, '发车时间', 8);
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(next)) return `${next}:00`;
  if (!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(next)) throw new Error('发车时间格式应为 HH:mm:ss');
  return next;
};
const capacity = (value) => {
  const next = Number(value);
  if (!Number.isInteger(next) || next < 2 || next > 10) throw new Error('队伍人数必须是 2 到 10 的整数');
  return next;
};
const tags = (value) => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => text(String(item), '标签', 12, { required: false })).filter((item) => SQUAD_TAG_SET.has(item)))).slice(0, 6);
};

const normalizeSquad = (squad) => {
  const passengers = Array.isArray(squad.passengers) ? squad.passengers : [];
  const squadTags = Array.isArray(squad.tags) ? squad.tags : [];
  const squadCapacity = capacity(squad.capacity || 5);
  return {
    ...squad,
    passengers,
    tags: squadTags,
    departDate: squad.departDate || getBeijingDate(),
    capacity: squadCapacity,
    status: passengers.length >= squadCapacity ? 'ready' : 'recruiting'
  };
};

const publicDepartTime = (value) => String(value || '--:--').slice(0, 5);

const publicSquad = (squad, viewerOpenid = '') => {
  const normalized = normalizeSquad(squad);
  const { creatorOpenid, ...rest } = normalized;
  return {
    ...rest,
    departTime: publicDepartTime(rest.departTime),
    isCreator: Boolean(viewerOpenid && creatorOpenid === viewerOpenid),
    isJoined: Boolean(viewerOpenid && normalized.passengers.some((passenger) => passenger.openid === viewerOpenid)),
    passengers: normalized.passengers.map(({ openid, ...passenger }) => ({
      ...passenger,
      isSelf: Boolean(viewerOpenid && openid === viewerOpenid)
    }))
  };
};

const publicUser = (user) => {
  const { sessionKey, ...rest } = user;
  return {
    ...rest,
    role: isAdmin(user) ? 'admin' : (user.role || 'member'),
    isRootAdmin: adminOpenids.has(user.openid)
  };
};

const send = (res, status, payload) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization'
  });
  res.end(JSON.stringify(payload));
};

const ok = (res, data) => send(res, 200, { ok: true, data });
const fail = (res, status, message) => send(res, status, { ok: false, message });

const serveStaticAsset = (req, res, pathname) => {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname.replace(/^\/assets\//, 'assets/'));
  } catch {
    fail(res, 400, '资源路径格式错误');
    return true;
  }
  const filePath = path.resolve(PUBLIC_DIR, relativePath);
  const relativeToPublic = path.relative(PUBLIC_DIR, filePath);
  if (relativeToPublic.startsWith('..') || path.isAbsolute(relativeToPublic) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;

  const ext = path.extname(filePath).toLowerCase();
  const contentType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : 'application/octet-stream';
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': fs.statSync(filePath).size,
    'cache-control': 'public, max-age=31536000, immutable'
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  fs.createReadStream(filePath).pipe(res);
  return true;
};

const parseBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > MAX_BODY_SIZE) {
      reject(new Error('请求体过大'));
      req.destroy();
    }
  });
  req.on('end', () => {
    if (!body) {
      resolve({});
      return;
    }
    try {
      resolve(JSON.parse(body));
    } catch (error) {
      reject(new Error('请求体格式错误'));
    }
  });
  req.on('error', reject);
});

const getOrCreateUser = (data, userOpenid, userNickname = '未命名成员') => {
  let user = data.users.find((item) => item.openid === userOpenid);
  if (!user) {
    user = { openid: userOpenid, nickname: userNickname, joinedSquadIds: [], createdSquadIds: [], disabled: false };
    data.users.push(user);
  }
  if (user.disabled == null) user.disabled = false;
  return user;
};

const findSquad = (data, squadId) => data.squads.find((item) => item.id === squadId);
const getAllowedGroupOpenGid = (data) => process.env.ALLOWED_GROUP_OPEN_GID || data.settings?.allowedGroupOpenGid || '';
const clearGroupAccessData = (data) => {
  delete data.settings.allowedGroupOpenGid;
  delete data.settings.allowedGroupBoundAt;
  delete data.settings.allowedGroupBoundBy;
  data.squads = [];
  data.users = data.users.filter((user) => isAdmin(user)).map((user) => {
    const { groupOpenGid, groupVerified, groupVerifiedAt, subscribedTemplateIds, ...rest } = user;
    return {
      ...rest,
      joinedSquadIds: [],
      createdSquadIds: []
    };
  });
};
const getGroupBindingState = (data) => {
  const allowedGroupOpenGid = getAllowedGroupOpenGid(data);
  return {
    isBound: Boolean(allowedGroupOpenGid),
    allowedGroupOpenGid,
    boundAt: data.settings?.allowedGroupBoundAt || 0,
    boundBy: data.settings?.allowedGroupBoundBy || ''
  };
};
const isAdmin = (userOrOpenid) => {
  if (typeof userOrOpenid === 'string') return adminOpenids.has(userOrOpenid);
  return adminOpenids.has(userOrOpenid.openid) || userOrOpenid.role === 'admin';
};

const isGroupVerified = (data, user) => {
  const allowedGroupOpenGid = getAllowedGroupOpenGid(data);
  if (isAdmin(user)) return true;
  if (!allowedGroupOpenGid) return false;
  if (user.groupOpenGid !== allowedGroupOpenGid || user.groupVerified !== true) return false;
  return Date.now() - Number(user.groupVerifiedAt || 0) <= GROUP_VERIFY_TTL;
};

const requireActiveUser = (req, data, { requireGroup = true } = {}) => {
  const user = getOrCreateUser(data, getAuthOpenid(req));
  if (user.disabled) throw Object.assign(new Error(user.disabledReason || '账号已被管理员禁用'), { status: 403 });
  if (requireGroup && !getAllowedGroupOpenGid(data) && !isAdmin(user)) throw Object.assign(new Error('管理员尚未绑定准入微信群'), { status: 403 });
  if (requireGroup && !isGroupVerified(data, user)) throw Object.assign(new Error('请从指定微信群进入完成准入验证'), { status: 403 });
  return user;
};

const requireAdmin = (req, data) => {
  const user = requireActiveUser(req, data, { requireGroup: false });
  if (!isAdmin(user)) throw Object.assign(new Error('需要管理员权限'), { status: 403 });
  return user;
};

const requireRootAdmin = (req, data) => {
  const user = requireAdmin(req, data);
  if (!adminOpenids.has(user.openid)) throw Object.assign(new Error('需要根管理员权限'), { status: 403 });
  return user;
};

const syncUserNicknameInSquads = (data, userOpenid, nextNickname) => {
  data.squads.forEach((squad) => {
    if (squad.creatorOpenid === userOpenid) squad.creatorName = nextNickname;
    squad.passengers = squad.passengers.map((passenger) => (
      passenger.openid === userOpenid ? { ...passenger, nickname: nextNickname } : passenger
    ));
  });
};

const getNicknameFromSquads = (data, userOpenid) => {
  for (const squad of data.squads) {
    const passenger = squad.passengers.find((item) => item.openid === userOpenid && item.nickname && item.nickname !== '未命名成员');
    if (passenger) return passenger.nickname;
    if (squad.creatorOpenid === userOpenid && squad.creatorName && squad.creatorName !== '未命名成员') return squad.creatorName;
  }
  return '';
};

const hasSubscription = (data, userOpenid, templateId) => {
  const user = data.users.find((item) => item.openid === userOpenid);
  return Array.isArray(user?.subscribedTemplateIds) && user.subscribedTemplateIds.includes(templateId);
};

const removeSubscription = async (userOpenid, templateId) => withWriteLock((data) => {
  const user = data.users.find((item) => item.openid === userOpenid);
  if (user?.subscribedTemplateIds) {
    user.subscribedTemplateIds = user.subscribedTemplateIds.filter((item) => item !== templateId);
  }
});

const sendSubscribeMessage = async ({ dataSnapshot, touser, templateId, page, data }) => {
  try {
    if (!touser || !templateId) return;
    if (!hasSubscription(dataSnapshot, touser, templateId)) return;
    if (String(touser).startsWith('guest_') || String(touser).startsWith('mock_')) return;
    const accessToken = await getWechatAccessToken();
    const url = new URL('https://api.weixin.qq.com/cgi-bin/message/subscribe/send');
    url.searchParams.set('access_token', accessToken);
    const result = await wxRequest(url, { touser, template_id: templateId, page, data });
    if (result.errcode) {
      console.warn('[Subscribe] send failed', { errcode: result.errcode, errmsg: result.errmsg, templateId, touser });
      if (result.errcode === 43101) await removeSubscription(touser, templateId);
    }
  } catch (error) {
    console.warn('[Subscribe] send skipped', error.message || error);
  }
};

const notifyMemberChanged = (dataSnapshot, squad, operatorNickname, actionText) => sendSubscribeMessage({
  dataSnapshot,
  touser: squad.creatorOpenid,
  templateId: SUBSCRIBE_TEMPLATE_IDS.squadMemberChanged,
  page: `/pages/detail/index?id=${squad.id}`,
  data: {
    thing78: { value: `${squad.passengers.length}/${squad.capacity}`.slice(0, 20) },
    thing63: { value: `${operatorNickname}${actionText}`.slice(0, 20) }
  }
});

const notifyStatusChanged = (dataSnapshot, userOpenid, squad, thing) => sendSubscribeMessage({
  dataSnapshot,
  touser: userOpenid,
  templateId: SUBSCRIBE_TEMPLATE_IDS.squadStatusChanged,
  page: `/pages/detail/index?id=${squad.id}`,
  data: {
    phrase21: { value: thing.slice(0, 20) },
    thing1: { value: squad.title.slice(0, 20) }
  }
});

const loginResponse = async (userOpenid, userNickname, sessionKey) => withWriteLock((data) => {
  const user = getOrCreateUser(data, userOpenid, userNickname);
  if (userNickname && userNickname !== '未命名成员') {
    user.nickname = userNickname;
    syncUserNicknameInSquads(data, user.openid, userNickname);
  } else if (!user.nickname || user.nickname === '未命名成员') {
    const recoveredNickname = getNicknameFromSquads(data, user.openid);
    if (recoveredNickname) user.nickname = recoveredNickname;
  }
  delete user.sessionKey;
  if (sessionKey) sessionKeyCache.set(user.openid, { sessionKey, expiresAt: Date.now() + TOKEN_TTL });
  return { token: createToken(user.openid), user: publicUser(user) };
});

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    send(res, 200, { ok: true });
    return;
  }

  try {
    if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')) {
      throw Object.assign(new Error('请求地址格式错误'), { status: 400 });
    }
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if ((req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith('/assets/') && serveStaticAsset(req, res, pathname)) return;

    if (req.method === 'GET' && pathname === '/api/health') {
      ok(res, { status: 'ok' });
      return;
    }

    if (pathname === '/api/home' && req.method === 'GET') {
      const data = readData();
      const user = requireActiveUser(req, data);
      ok(res, {
        user: publicUser(user),
        squads: data.squads.map((squad) => publicSquad(squad, user.openid))
      });
      return;
    }

    if (pathname === '/api/auth/guest-login' && req.method === 'POST') {
      checkRateLimit(req, 'guest-login', 10, 60 * 1000);
      if (!allowGuestLogin) throw Object.assign(new Error('访客登录未开放'), { status: 403 });
      const body = await parseBody(req);
      ok(res, await loginResponse(`guest_${crypto.randomUUID()}`, nickname(body.nickname)));
      return;
    }

    if (pathname === '/api/auth/wechat-login' && req.method === 'POST') {
      checkRateLimit(req, 'wechat-login', 20, 60 * 1000);
      const body = await parseBody(req);
      const session = await code2Session(text(body.code, '微信登录 code', 256));
      ok(res, await loginResponse(session.openid, nickname(body.nickname), session.sessionKey));
      return;
    }

    if (pathname === '/api/users/me' && req.method === 'GET') {
      const data = readData();
      ok(res, publicUser(requireActiveUser(req, data, { requireGroup: false })));
      return;
    }

    if (pathname === '/api/users/me' && req.method === 'PUT') {
      checkRateLimit(req, 'write', 30, 60 * 1000);
      const body = await parseBody(req);
      const user = await withWriteLock((data) => {
        const current = requireActiveUser(req, data, { requireGroup: false });
        const nextNickname = nickname(body.nickname);
        current.nickname = nextNickname;
        syncUserNicknameInSquads(data, current.openid, nextNickname);
        return publicUser(current);
      });
      ok(res, user);
      return;
    }

    if (pathname === '/api/users/me/group-verify' && req.method === 'POST') {
      checkRateLimit(req, 'write', 30, 60 * 1000);
      const body = await parseBody(req);
      const result = await withWriteLock((data) => {
        const user = requireActiveUser(req, data, { requireGroup: false });
        const session = sessionKeyCache.get(user.openid);
        if (!session || Date.now() > session.expiresAt) throw Object.assign(new Error('请重新登录后验证微信群'), { status: 400 });
        const groupOpenGid = decryptWechatData(session.sessionKey, text(body.encryptedData, '群加密数据', 4096), text(body.iv, '群加密向量', 256));
        const allowedGroupOpenGid = getAllowedGroupOpenGid(data);
        if (allowedGroupOpenGid && groupOpenGid !== allowedGroupOpenGid) throw Object.assign(new Error('不在允许的微信群内'), { status: 403 });
        user.groupOpenGid = groupOpenGid;
        user.groupVerified = true;
        user.groupVerifiedAt = Date.now();
        return { user: publicUser(user), groupOpenGid };
      });
      ok(res, result);
      return;
    }

    if (pathname === '/api/users/me/subscriptions' && req.method === 'POST') {
      checkRateLimit(req, 'write', 30, 60 * 1000);
      const body = await parseBody(req);
      const user = await withWriteLock((data) => {
        const current = requireActiveUser(req, data, { requireGroup: false });
        const tmplIds = Array.isArray(body.tmplIds)
          ? Array.from(new Set(body.tmplIds.filter((item) => typeof item === 'string' && SUBSCRIBE_TEMPLATE_ID_SET.has(item)))).slice(0, 2)
          : [];
        if (tmplIds.length === 0) throw Object.assign(new Error('没有有效的订阅模板'), { status: 400 });
        current.subscribedTemplateIds = Array.from(new Set([...(current.subscribedTemplateIds || []), ...tmplIds])).filter((item) => SUBSCRIBE_TEMPLATE_ID_SET.has(item)).slice(0, 2);
        return publicUser(current);
      });
      ok(res, user);
      return;
    }

    if (pathname === '/api/admin/users' && req.method === 'GET') {
      const data = readData();
      const admin = requireAdmin(req, data);
      ok(res, data.users.filter((user) => user.openid !== admin.openid && !adminOpenids.has(user.openid) && user.nickname !== '未命名成员').map(publicUser));
      return;
    }

    const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/(disable|enable|promote|demote)$/);
    if (adminUserMatch && req.method === 'POST') {
      checkRateLimit(req, 'admin-write', 60, 60 * 1000);
      const body = await parseBody(req);
      const targetOpenid = decodeURIComponent(adminUserMatch[1]);
      const action = adminUserMatch[2];
      const user = await withWriteLock((data) => {
        const admin = action === 'promote' || action === 'demote' ? requireRootAdmin(req, data) : requireAdmin(req, data);
        const target = getOrCreateUser(data, targetOpenid);
        if (target.openid === admin.openid) throw Object.assign(new Error('不能操作当前管理员自己'), { status: 400 });
        if (action === 'demote' && adminOpenids.has(target.openid)) throw Object.assign(new Error('不能取消根管理员权限'), { status: 400 });
        if (action === 'disable') {
          target.disabled = true;
          target.disabledAt = Date.now();
          target.disabledBy = admin.openid;
          target.disabledReason = text(body.reason || '管理员禁用', '禁用原因', 80, { required: false }) || '管理员禁用';
        } else if (action === 'enable') {
          target.disabled = false;
          target.enabledAt = Date.now();
          target.enabledBy = admin.openid;
          target.disabledReason = '';
        } else if (action === 'promote') {
          target.role = 'admin';
          target.promotedAt = Date.now();
          target.promotedBy = admin.openid;
          target.disabled = false;
          target.disabledReason = '';
        } else {
          target.role = 'member';
          target.demotedAt = Date.now();
          target.demotedBy = admin.openid;
        }
        return publicUser(target);
      });
      ok(res, user);
      return;
    }

    if (pathname === '/api/admin/group/binding' && req.method === 'GET') {
      const data = readData();
      requireAdmin(req, data);
      ok(res, getGroupBindingState(data));
      return;
    }

    if (pathname === '/api/admin/group/bind' && req.method === 'POST') {
      checkRateLimit(req, 'admin-write', 60, 60 * 1000);
      const body = await parseBody(req);
      const result = await withWriteLock((data) => {
        const admin = requireAdmin(req, data);
        if (getAllowedGroupOpenGid(data)) throw Object.assign(new Error('已绑定准入微信群，请先解绑后再绑定'), { status: 400 });
        const session = sessionKeyCache.get(admin.openid);
        if (!session || Date.now() > session.expiresAt) throw Object.assign(new Error('请重新登录后绑定微信群'), { status: 400 });
        const groupOpenGid = decryptWechatData(session.sessionKey, text(body.encryptedData, '群加密数据', 4096), text(body.iv, '群加密向量', 256));
        data.settings.allowedGroupOpenGid = groupOpenGid;
        data.settings.allowedGroupBoundAt = Date.now();
        data.settings.allowedGroupBoundBy = admin.openid;
        admin.groupOpenGid = groupOpenGid;
        admin.groupVerified = true;
        admin.groupVerifiedAt = Date.now();
        return getGroupBindingState(data);
      });
      ok(res, result);
      return;
    }

    if (pathname === '/api/admin/group/unbind' && req.method === 'POST') {
      checkRateLimit(req, 'admin-write', 60, 60 * 1000);
      const result = await withWriteLock((data) => {
        requireAdmin(req, data);
        clearGroupAccessData(data);
        return getGroupBindingState(data);
      });
      ok(res, result);
      return;
    }

    if (pathname === '/api/squads' && req.method === 'GET') {
      const data = readData();
      const user = requireActiveUser(req, data);
      ok(res, data.squads.map((squad) => publicSquad(squad, user.openid)));
      return;
    }

    if (pathname === '/api/squads' && req.method === 'POST') {
      checkRateLimit(req, 'write', 30, 60 * 1000);
      const body = await parseBody(req);
      const squadTitle = text(body.title, '车队名称', 30);
      const squadDepartDate = departDate(body.departDate);
      const squadDepartTime = departTime(body.departTime);
      const squadCapacity = capacity(body.capacity || 5);
      const squadNote = text(body.note || '无备注', '备注', 120, { required: false }) || '无备注';
      const squadTags = tags(body.tags);
      const { squad, viewerOpenid } = await withWriteLock((data) => {
        const user = requireActiveUser(req, data);
        const id = Math.max(0, ...data.squads.map((item) => item.id)) + 1;
        const nextSquad = normalizeSquad({
          id,
          title: squadTitle,
          code: '自定义车队',
          creatorOpenid: user.openid,
          creatorName: user.nickname,
          departDate: squadDepartDate,
          departTime: squadDepartTime,
          capacity: squadCapacity,
          note: squadNote,
          tags: squadTags,
          status: 'recruiting',
          passengers: [{ id: Date.now(), openid: user.openid, nickname: user.nickname, role: '队长', isLeader: true }]
        });
        data.squads.unshift(nextSquad);
        return { squad: nextSquad, viewerOpenid: user.openid };
      });
      ok(res, publicSquad(squad, viewerOpenid));
      return;
    }

    const squadMatch = pathname.match(/^\/api\/squads\/(\d+)$/);
    if (squadMatch && req.method === 'GET') {
      const data = readData();
      const user = requireActiveUser(req, data);
      const squad = findSquad(data, Number(squadMatch[1]));
      if (!squad) return fail(res, 404, '车队不存在');
      ok(res, publicSquad(squad, user.openid));
      return;
    }

    if (squadMatch && req.method === 'PUT') {
      checkRateLimit(req, 'write', 30, 60 * 1000);
      const body = await parseBody(req);
      const squadTitle = text(body.title, '车队名称', 30);
      const squadDepartDate = departDate(body.departDate);
      const squadDepartTime = departTime(body.departTime);
      const squadCapacity = capacity(body.capacity || 5);
      const squadNote = text(body.note || '无备注', '备注', 120, { required: false }) || '无备注';
      const squadTags = tags(body.tags);
      const { squad, viewerOpenid } = await withWriteLock((data) => {
        const user = requireActiveUser(req, data);
        const nextSquad = findSquad(data, Number(squadMatch[1]));
        if (!nextSquad) throw Object.assign(new Error('车队不存在'), { status: 404 });
        if (nextSquad.creatorOpenid !== user.openid) throw Object.assign(new Error('只有队长可以修改车队信息'), { status: 403 });
        if (nextSquad.passengers.some((passenger) => passenger.openid !== user.openid)) {
          throw Object.assign(new Error('车队已有成员，不支持修改信息'), { status: 400 });
        }
        Object.assign(nextSquad, {
          title: squadTitle,
          departDate: squadDepartDate,
          departTime: squadDepartTime,
          capacity: squadCapacity,
          note: squadNote,
          tags: squadTags
        });
        return { squad: normalizeSquad(nextSquad), viewerOpenid: user.openid };
      });
      ok(res, publicSquad(squad, viewerOpenid));
      return;
    }

    if (squadMatch && req.method === 'DELETE') {
      checkRateLimit(req, 'write', 30, 60 * 1000);
      const { dismissedSquad, dataSnapshot, userOpenid } = await withWriteLock((data) => {
        const user = requireActiveUser(req, data);
        const squadId = Number(squadMatch[1]);
        const squad = findSquad(data, squadId);
        if (!squad) throw Object.assign(new Error('车队不存在'), { status: 404 });
        if (squad.creatorOpenid !== user.openid) throw Object.assign(new Error('只有发起人可以解散车队'), { status: 403 });
        const snapshot = normalizeSquad({ ...squad, passengers: [...squad.passengers] });
        const dataSnapshot = JSON.parse(JSON.stringify(data));
        data.squads = data.squads.filter((item) => item.id !== squadId);
        return { dismissedSquad: snapshot, dataSnapshot, userOpenid: user.openid };
      });
      dismissedSquad.passengers.filter((item) => item.openid !== userOpenid).forEach((item) => {
        notifyStatusChanged(dataSnapshot, item.openid, dismissedSquad, '车队已解散');
      });
      ok(res, null);
      return;
    }

    const joinMatch = pathname.match(/^\/api\/squads\/(\d+)\/join$/);
    if (joinMatch && req.method === 'POST') {
      checkRateLimit(req, 'write', 30, 60 * 1000);
      const body = await parseBody(req);
      const userRole = text(body.role || '补位', '角色', 16, { required: false }) || '补位';
      const userNote = text(body.note || '', '备注', 80, { required: false });
      const { squad, dataSnapshot, operatorNickname, viewerOpenid } = await withWriteLock((data) => {
        const user = requireActiveUser(req, data);
        const nextSquad = findSquad(data, Number(joinMatch[1]));
        if (!nextSquad) throw Object.assign(new Error('车队不存在'), { status: 404 });
        if (nextSquad.passengers.some((item) => item.openid === user.openid)) throw Object.assign(new Error('你已在车队中'), { status: 400 });
        if (nextSquad.passengers.length >= nextSquad.capacity) throw Object.assign(new Error('车队已满员'), { status: 400 });
        nextSquad.passengers.push({ id: Date.now(), openid: user.openid, nickname: user.nickname, role: userRole, note: userNote || undefined });
        return { squad: normalizeSquad(nextSquad), dataSnapshot: JSON.parse(JSON.stringify(data)), operatorNickname: user.nickname, viewerOpenid: user.openid };
      });
      notifyMemberChanged(dataSnapshot, squad, operatorNickname, '加入车队');
      ok(res, publicSquad(squad, viewerOpenid));
      return;
    }

    const leaveMatch = pathname.match(/^\/api\/squads\/(\d+)\/leave$/);
    if (leaveMatch && req.method === 'POST') {
      checkRateLimit(req, 'write', 30, 60 * 1000);
      const { squad, dataSnapshot, operatorNickname, viewerOpenid } = await withWriteLock((data) => {
        const user = requireActiveUser(req, data);
        const nextSquad = findSquad(data, Number(leaveMatch[1]));
        if (!nextSquad) throw Object.assign(new Error('车队不存在'), { status: 404 });
        if (nextSquad.creatorOpenid === user.openid) throw Object.assign(new Error('发起人不能下车，请解散车队'), { status: 400 });
        const passenger = nextSquad.passengers.find((item) => item.openid === user.openid);
        if (!passenger) throw Object.assign(new Error('你不在该车队中'), { status: 400 });
        nextSquad.passengers = nextSquad.passengers.filter((item) => item.openid !== user.openid);
        return { squad: normalizeSquad(nextSquad), dataSnapshot: JSON.parse(JSON.stringify(data)), operatorNickname: passenger.nickname, viewerOpenid: user.openid };
      });
      notifyMemberChanged(dataSnapshot, squad, operatorNickname, '退出车队');
      ok(res, publicSquad(squad, viewerOpenid));
      return;
    }

    const passengerMeMatch = pathname.match(/^\/api\/squads\/(\d+)\/passengers\/me$/);
    if (passengerMeMatch && req.method === 'PUT') {
      checkRateLimit(req, 'write', 30, 60 * 1000);
      const body = await parseBody(req);
      const nextNickname = text(body.nickname, '昵称', 20);
      const nextNote = text(body.note || '', '备注', 80, { required: false });
      const result = await withWriteLock((data) => {
        const user = requireActiveUser(req, data);
        const squad = findSquad(data, Number(passengerMeMatch[1]));
        if (!squad) throw Object.assign(new Error('车队不存在'), { status: 404 });
        if (!squad.passengers.some((passenger) => passenger.openid === user.openid)) {
          throw Object.assign(new Error('你不在该车队中'), { status: 403 });
        }

        user.nickname = nextNickname;
        syncUserNicknameInSquads(data, user.openid, nextNickname);
        const passenger = squad.passengers.find((item) => item.openid === user.openid);
        if (nextNote) passenger.note = nextNote;
        else delete passenger.note;

        return {
          user: publicUser(user),
          squad: publicSquad(normalizeSquad(squad), user.openid)
        };
      });
      ok(res, result);
      return;
    }

    fail(res, 404, '接口不存在');
  } catch (error) {
    console.error('[Server] request failed', error);
    fail(res, error.status || 400, error.message || '服务器错误');
  }
});

server.listen(PORT, () => {
  console.log(`GangWa server listening on http://localhost:${PORT}`);
});
