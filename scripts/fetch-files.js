#!/usr/bin/env node
/**
 * 从 Shopify 后台 Files 批量下载文件，保留后台里的原始文件名。
 *
 * 为什么需要它：
 *   网页版工具是纯前端，拿不到后台登录态，也绕不过跨域；而主题里
 *   `{{ 'videos/xxx.mov' | file_url }}` 这类引用对应的真实 CDN 地址是哈希路径，
 *   靠文件名拼不出来。Admin API 能直接把 name -> url 的真实对应关系取回来。
 *
 * 用法（Dev Dashboard 应用，一个 app 可覆盖同组织多个店铺）：
 *   node scripts/fetch-files.js --type video --zip
 *   .env.videos 里写 SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET / SHOPIFY_SHOPS
 *
 * 旧的 legacy 应用仍可用静态 token：
 *   node scripts/fetch-files.js --shop xxx.myshopify.com --token shpat_xxx --type video
 *
 * 参数：
 *   --shop    店铺域名（xxx.myshopify.com 或自定义域名都行）
 *   --token   legacy 应用的 Admin API access token
 *   --client-id / --client-secret / --shops   Dev Dashboard 应用的凭据与店铺列表
 *   --type    video | image | audio | all，默认 video
 *   --names   只下这些文件（文本文件，一行一个名字，例如失败清单里的名字）
 *   --out     输出目录，默认 data/downloads
 *   --zip     下载完顺手打成一个 zip
 *   --dry     只列出 name -> url，不下载
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// Shopify 只保留近 12 个月的 API 版本，默认用一年内的稳定版，可用环境变量覆盖
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';

/* ---------------- 参数 ---------------- */

function loadEnv() {
  const file = path.join(ROOT, '.env.videos');
  if (!fs.existsSync(file)) return {};
  const out = {};
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
  return out;
}

function parseArgs(argv) {
  const env = loadEnv();
  const args = {
    shop: env.SHOPIFY_SHOP || '',
    token: env.SHOPIFY_ADMIN_TOKEN || '',
    clientId: env.SHOPIFY_CLIENT_ID || '',
    clientSecret: env.SHOPIFY_CLIENT_SECRET || '',
    shops: env.SHOPIFY_SHOPS || '',
    type: 'video',
    names: '',
    out: env.SHOPIFY_OUT || path.join(ROOT, 'data', 'downloads'),
    zip: false,
    dry: false,
    authorize: false,
    code: '',
    redirect: env.SHOPIFY_REDIRECT_URI || 'http://localhost',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--shop') args.shop = argv[++i];
    else if (a === '--token') args.token = argv[++i];
    else if (a === '--client-id') args.clientId = argv[++i];
    else if (a === '--client-secret') args.clientSecret = argv[++i];
    else if (a === '--shops') args.shops = argv[++i];
    else if (a === '--type') args.type = argv[++i];
    else if (a === '--names') args.names = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--authorize') args.authorize = true;
    else if (a === '--code') args.code = argv[++i];
    else if (a === '--redirect') args.redirect = argv[++i];
    else if (a === '--zip') args.zip = true;
    else if (a === '--dry') args.dry = true;
  }

  return args;
}

/* ---------------- Admin API ---------------- */

function normalizeShop(shop) {
  let s = String(shop || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!s) return '';
  if (!s.includes('.')) s += '.myshopify.com';
  return s;
}

/**
 * Admin API 只认 xxx.myshopify.com，自定义域名（global.dreametech.com）会碰到
 * 店铺前台的机器人验证，返回 403 的 HTML 页面。
 */
function isMyshopify(shop) {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop);
}

async function api(shop, token, endpoint) {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `https://${shop}/admin/api/${API_VERSION}/${endpoint.replace(/^\/+/, '')}`;

  const res = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': token,
      Accept: 'application/json',
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(`授权失败（HTTP ${res.status}）：token 不对，或应用缺少 read_files 权限`);
  }
  if (res.status === 404) {
    throw new Error('接口 404：店铺域名可能写错了（应为 xxx.myshopify.com）');
  }
  if (!res.ok) {
    throw new Error(`请求失败 HTTP ${res.status}：${(await res.text()).slice(0, 200)}`);
  }

  const link = res.headers.get('link') || '';
  const next = link.split(',').map((s) => s.trim()).find((s) => /rel="next"/.test(s));
  const nextUrl = next ? (next.match(/<([^>]+)>/) || [])[1] : null;

  return { json: await res.json(), nextUrl };
}

async function listFiles(shop, token) {
  const out = [];
  let endpoint = `files.json?limit=250`;

  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { json, nextUrl } = await api(shop, token, endpoint);
    (json.files || []).forEach((f) => out.push(f));
    if (!nextUrl) break;
    endpoint = nextUrl;
    // REST 限速约 2 次/秒，翻页时歇一下
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 600));
  }

  return out;
}

/**
 * 用 Dev Dashboard 应用的 Client ID / Secret 换 access token（client credentials grant）。
 * token 24 小时过期，所以每次运行现换，不落地保存。
 */
async function mintToken(shop, clientId, clientSecret) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    let hint = '';
    if (res.status === 404) {
      hint = '\n  → 店铺不存在：myshopify handle 写错了（不是自定义域名）';
    } else if (/shop_not_permitted/i.test(text)) {
      hint = '\n  → app 与店铺不在同一个组织。改用授权码流程：npm run files -- --authorize';
    } else if (/invalid_client/i.test(text)) {
      hint = '\n  → Client ID / Secret 不对，去 Dev Dashboard 的 app → Settings 里重新复制';
    }
    throw new Error(`换取 token 失败（HTTP ${res.status}）：${text.slice(0, 200)}${hint}`);
  }

  const json = JSON.parse(text);
  if (!json.access_token) throw new Error(`token 响应异常：${text.slice(0, 200)}`);
  return { token: json.access_token, scope: json.scope || '', expiresIn: json.expires_in || 86400 };
}

/**
 * 用授权码换 token（Authorization Code Grant）。
 * 适合「app 在 A 组织、店铺在 B 组织」的第三方开发场景：
 * 由店铺管理员授权一次，拿到的是 offline token，不会过期（除非卸载应用）。
 */
async function exchangeCode(shop, clientId, clientSecret, code) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });

  const text = await res.text();
  if (!res.ok) {
    let hint = '';
    if (/invalid_code|code was already used|expired/i.test(text)) {
      hint = '\n  → 授权码只能用一次，且几分钟内失效。重新打开授权链接拿一个新的';
    } else if (/invalid_client/i.test(text)) {
      hint = '\n  → Client ID / Secret 不对，去 Dev Dashboard 的 app → Settings 重新复制';
    } else if (/redirect_uri/i.test(text)) {
      hint = '\n  → 回调地址和 app 里配置的不一致，检查 Allowed redirection URLs';
    }
    throw new Error(`用授权码换 token 失败（HTTP ${res.status}）：${text.slice(0, 200)}${hint}`);
  }

  const json = JSON.parse(text);
  if (!json.access_token) throw new Error(`token 响应异常：${text.slice(0, 200)}`);
  return { token: json.access_token, scope: json.scope || '' };
}

/* ---------------- token 缓存（本地，已 gitignore） ---------------- */

const TOKEN_FILE = path.join(ROOT, '.shopify-token.json');

function readTokenCache() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveTokenCache(cache) {
  fs.writeFileSync(TOKEN_FILE, `${JSON.stringify(cache, null, 2)}\n`);
}

/* ---------------- 本地处理 ---------------- */

const EXT_TYPE = {
  video: /\.(mp4|webm|mov|m4v|ogv)$/i,
  image: /\.(jpg|jpeg|png|gif|webp|avif|bmp|svg)$/i,
  audio: /\.(mp3|wav|ogg|m4a|flac|aac)$/i,
};

function nameOf(file) {
  if (file.filename) return String(file.filename);
  const clean = urlOf(file).split('?')[0];
  const base = clean.split('/').filter(Boolean).pop() || '';
  try {
    return decodeURIComponent(base);
  } catch (e) {
    return base;
  }
}

/**
 * 不同资源类型返回的字段不一样：
 *   图片/普通文件 -> url
 *   视频          -> sources[].url
 * 这里统一取一个可下载的地址。
 */
function urlOf(file) {
  if (file.url) return String(file.url);
  if (file.image && file.image.src) return String(file.image.src);
  if (Array.isArray(file.sources) && file.sources.length) return String(file.sources[0].url || '');
  return '';
}

function typeOf(file) {
  const ct = String(file.content_type || '');
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('audio/')) return 'audio';
  const name = nameOf(file);
  for (const [type, re] of Object.entries(EXT_TYPE)) if (re.test(name)) return type;
  return 'other';
}

function safeName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_');
}

function humanSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/* ---------------- 主流程 ---------------- */

/**
 * 一个 token 只对应一个店铺，所以多店铺就写多组：
 *   SHOPIFY_SHOP_1=global.myshopify.com
 *   SHOPIFY_TOKEN_1=shpat_xxx
 *
 * 或者用 Dev Dashboard 应用的一份凭据覆盖多个店（推荐，同一组织下）：
 *   SHOPIFY_CLIENT_ID=...
 *   SHOPIFY_CLIENT_SECRET=...
 *   SHOPIFY_SHOPS=dreame-global,dreame-de
 */
function resolveStores(args, env) {
  const clientId = env.SHOPIFY_CLIENT_ID || args.clientId || '';
  const clientSecret = env.SHOPIFY_CLIENT_SECRET || args.clientSecret || '';
  const shopList = String(env.SHOPIFY_SHOPS || args.shops || '')
    .split(/[,\s]+/)
    .map((s) => normalizeShop(s))
    .filter(Boolean);

  if (clientId && clientSecret && shopList.length) {
    return shopList.map((shop) => ({ shop, clientId, clientSecret }));
  }

  const stores = [];
  const idx = Object.keys(env)
    .map((k) => (k.match(/^SHOPIFY_SHOP_(\d+)$/) || [])[1])
    .filter(Boolean)
    .sort((a, b) => Number(a) - Number(b));

  idx.forEach((i) => {
    const shop = normalizeShop(env[`SHOPIFY_SHOP_${i}`]);
    const token = env[`SHOPIFY_TOKEN_${i}`];
    if (shop && token) stores.push({ shop, token });
  });

  if (!stores.length && args.shop && args.token) {
    stores.push({ shop: normalizeShop(args.shop), token: args.token });
  }

  return stores;
}

async function runStore(store, args, wanted, multi) {
  const tag = multi ? `【${store.shop}】` : '';
  console.log(`\n▸ ${tag}读取 Files 列表…`);

  const files = await listFiles(store.shop, store.token);
  console.log(`  共 ${files.length} 个文件`);

  let picked = files.filter((f) => {
    const t = typeOf(f);
    return args.type === 'all' ? t !== 'other' : t === args.type;
  });

  if (wanted) {
    const before = picked.length;
    picked = picked.filter((f) => wanted.has(nameOf(f)));
    console.log(`  按名单过滤：${before} → ${picked.length}（名单 ${wanted.size} 条）`);
  }

  if (!picked.length) {
    console.log('  没有匹配的文件：类型可能选错，或 Files 里确实没有。');
    return { ok: 0, fail: 0 };
  }

  console.log('');
  console.log('名称\t大小\t地址');
  console.log('-'.repeat(80));
  picked.forEach((f) => {
    console.log(`${nameOf(f)}\t${humanSize(f.size)}\t${urlOf(f)}`);
  });

  if (args.dry) {
    console.log('  （--dry：只列清单，不下载）');
    return { ok: 0, fail: 0 };
  }

  fs.mkdirSync(args.out, { recursive: true });
  const saved = {};
  let ok = 0;
  let fail = 0;

  for (const f of picked) {
    const name = safeName(nameOf(f));
    const target = path.join(args.out, name);
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(urlOf(f), { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // eslint-disable-next-line no-await-in-loop
      const buf = new Uint8Array(await res.arrayBuffer());
      fs.writeFileSync(target, buf);
      saved[name] = buf;
      ok += 1;
      process.stdout.write(`  ✓ ${name}  ${humanSize(buf.length)}\n`);
    } catch (e) {
      fail += 1;
      process.stdout.write(`  ✗ ${name}  ${e.message}\n`);
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 120));
  }

  console.log(`\n  完成：${ok} 个成功，${fail} 个失败 → ${args.out}`);

  if (args.zip && ok) {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const suffix = multi ? `-${store.shop.split('.')[0]}` : '';
    const zipName = path.join(args.out, `files-${args.type}${suffix}-${stamp}.zip`);
    fs.writeFileSync(zipName, zipSync(saved, { level: 0 }));
    console.log(`  已打包：${zipName}`);
  }

  // 顺手给网页版工具留一份「原名 | 地址」清单，粘进去就能进 zip
  const txt = path.join(args.out, 'names-and-urls.txt');
  fs.writeFileSync(txt, picked.map((f) => `${nameOf(f)} | ${urlOf(f)}`).join('\n'));
  console.log(`  对照清单：${txt}`);

  return { ok, fail };
}

function authorizeUrl(shop, clientId, redirect) {
  const state = Math.random().toString(36).slice(2, 10);
  const q = `client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirect)}&state=${state}`;
  return `https://${shop}/admin/oauth/authorize?${q}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const stores = resolveStores(args, env);

  if (!stores.length) {
    console.error('缺少凭据：需要一个店铺域名 + 访问凭据。');
    console.error('');
    console.error('2026-01 之后新建的应用在 Dev Dashboard，没有可直接复制的静态 token：');
    console.error('  SHOPIFY_CLIENT_ID=...        # app → Settings 里的 Client ID');
    console.error('  SHOPIFY_CLIENT_SECRET=...    # Client secret');
    console.error('  SHOPIFY_SHOPS=dreame-global,dreame-de   # myshopify 子域名，逗号分隔');
    console.error('');
    console.error('只有 2026-01-01 之前建的 legacy 应用才用静态 token：');
    console.error('  SHOPIFY_SHOP=xxx.myshopify.com');
    console.error('  SHOPIFY_ADMIN_TOKEN=shpat_...');
    process.exit(1);
  }

  // 凭据补到每个店铺上，后面授权/换 token 都要用
  stores.forEach((s) => {
    s.clientId = s.clientId || args.clientId;
    s.clientSecret = s.clientSecret || args.clientSecret;
  });

  let wanted = null;
  if (args.names) {
    wanted = new Set(
      fs.readFileSync(path.resolve(ROOT, args.names), 'utf8')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }

  // Admin API 必须用 myshopify 域名，自定义域名会被前台机器人验证挡掉
  const bad = stores.filter((s) => !isMyshopify(s.shop));
  if (bad.length) {
    console.error('这些店铺不是 myshopify 域名，Admin API 只认 xxx.myshopify.com：');
    bad.forEach((s) => console.error(`  - ${s.shop}`));
    console.error('');
    console.error('去 Shopify 后台看地址栏 admin.shopify.com/store/<handle>，');
    console.error('<handle> 就是前缀；或 设置 → 域名 里能看到 xxx.myshopify.com。');
    process.exit(1);
  }

  /* 打印授权链接：app 与店铺不同组织时走这条路 */
  if (args.authorize) {
    const store = stores[0];
    if (!store.clientId) {
      console.error('缺 Client ID：在 .env.videos 里填 SHOPIFY_CLIENT_ID');
      process.exit(1);
    }
    console.log('1) 用店铺管理员账号打开这个链接并授权：\n');
    console.log(`   ${authorizeUrl(store.shop, store.clientId, args.redirect)}`);
    console.log('\n2) 授权后浏览器会跳到 ' + args.redirect + '/?code=xxx —— 页面打不开是正常的，');
    console.log('   把地址栏里 code= 后面那一整段（到 & 为止）复制出来');
    console.log('\n3) 回到终端执行：');
    console.log(`   npm run files -- --code <刚才复制的那段>`);
    return;
  }

  const multi = stores.length > 1;
  console.log(`▸ 共 ${stores.length} 个店铺：${stores.map((s) => s.shop).join('、')}`);

  let ok = 0;
  let fail = 0;

  for (const store of stores) {
    if (args.code) {
      if (!store.clientId || !store.clientSecret) {
        throw new Error('用授权码换 token 需要 SHOPIFY_CLIENT_ID 与 SHOPIFY_CLIENT_SECRET');
      }
      // eslint-disable-next-line no-await-in-loop
      const got = await exchangeCode(store.shop, store.clientId, store.clientSecret, args.code);
      store.token = got.token;
      args.code = ''; // 授权码只能用一次

      const cache = readTokenCache();
      cache[store.shop] = { token: got.token, scope: got.scope, savedAt: new Date().toISOString() };
      saveTokenCache(cache);
      console.log(`  【${store.shop}】授权成功（scope: ${got.scope || '—'}），token 已缓存，长期有效`);
    } else if (!store.token) {
      const cache = readTokenCache();
      if (cache[store.shop] && cache[store.shop].token) {
        store.token = cache[store.shop].token;
        console.log(`  【${store.shop}】使用本地缓存的 token`);
      } else if (store.clientId && store.clientSecret) {
        // 同组织时最省事：client credentials 换 24 小时 token
        // eslint-disable-next-line no-await-in-loop
        const minted = await mintToken(store.shop, store.clientId, store.clientSecret);
        store.token = minted.token;
        console.log(`  【${store.shop}】token 已获取（scope: ${minted.scope || '—'}，24 小时内有效）`);
      } else {
        throw new Error(`没有可用凭据：先运行 npm run files -- --authorize 走授权流程`);
      }
    }
    // 多店铺时按域名分目录，避免同名文件互相覆盖
    const out = multi ? path.join(args.out, store.shop.replace(/\./g, '_')) : args.out;
    // eslint-disable-next-line no-await-in-loop
    const r = await runStore(store, { ...args, out }, wanted, multi);
    ok += r.ok;
    fail += r.fail;
  }

  if (multi) {
    console.log(`\n全部完成：${ok} 个成功，${fail} 个失败 → ${args.out}`);
  }
}

main().catch((e) => {
  console.error(`\n出错：${e.message}`);
  process.exit(1);
});
