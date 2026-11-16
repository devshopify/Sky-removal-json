# Shopify 资源搬迁分析

把 A 站点的某个 JSON 搬到 B 站点之前，先看清楚它到底牵出了哪些文件。

选中 A 站的一个模板 JSON，工具会顺着 Shopify 的引用结构展开 `template → section → snippet`，
逐个检查 B 站是否已有；同时把 JSON 里 `shopify://` 引用的图片按你给的 CDN 地址拼接下载。
最后给出一个可勾选的表格，确认后才动文件。

**纯前端运行**：所有解析都在浏览器里完成，主题文件不会上传到任何服务器。

## 在线使用

构建产物是纯静态文件，部署到任意静态托管即可（Vercel / Netlify / GitHub Pages / 对象存储）。
打开网址就能用。

## 本地运行

```bash
npm install
npm run dev        # 开发模式 http://localhost:5173
npm run build      # 产出 dist/
npm run preview    # 预览构建结果
```

## 使用步骤

1. **载入 A 站**：点「选择主题文件夹」，或在卡片里拖入主题的 zip。
2. **载入 B 站**：同上。Chrome / Edge 会询问是否允许写入，允许后可直接把文件写进 B 站目录；
   不允许（或拖的是 zip）时，执行结果会打包成一个增量 zip 给你。
3. **填图片来源地址**：例如 `https://es.dreametech.com/cdn/shop/files/`。
   JSON 里 `shopify://shop_images/a2-bg.jpg` 会拼成
   `https://es.dreametech.com/cdn/shop/files/a2-bg.jpg` 然后下载。
4. **选入口 JSON**：左侧列表点选，或搜索框输入路径回车。
5. **看表格、勾选、执行**：缺失和待下载默认勾上，冲突默认不勾（避免误覆盖）。

想看效果可以在首页点「载入示例」。

## 分析范围

默认只关心两类，其余目录（css / js / 字体 / 子 JSON）不纳入：

| 类型 | 处理方式 |
| --- | --- |
| **liquid**（section / snippet / layout） | 顺着 `{% render %}` `{% section %}` 递归展开，逐个比对 B 站 |
| **媒体** | `shopify://` 协议的引用（`shop_images` / `videos` / `files`）进下载清单。A 站 `assets/` 里有同名文件的走文件比对 |

`https://cdn.shopify.com/...` 这类带完整地址的图片本身就能跨站访问，不进下载清单，
只在「其他外部引用」里列出来备查。

**`page_css` 字段单独处理**：它存的是不带扩展名的样式名，支持分号分隔多个——

```
"page_css": "product-s9-pro"                  → product-s9-pro.css
"page_css": "product-s9-pro; product-s9-diff" → product-s9-pro.css + product-s9-diff.css
```

这类样式默认不在范围内，但只要出现在 `page_css` 里就会强制纳入比对。

入口 JSON 自身始终在清单里。

## 四种结果

- **缺失** —— B 站没有，需要搬迁（默认勾选）
- **待下载** —— `shopify://` 引用的图片 / 视频，执行时按 CDN 地址下载并打包
- **冲突** —— B 站有同名文件但内容不同（大小 + SHA-256 判定），默认不勾
- **已存在** —— 内容完全一致，不需要动

另有单独列出、不自动处理的：CDN 完整地址、App 嵌入块、外部链接、
`{% render some_var %}` 这类动态引用。

## 执行后拿到什么

- **B 站目录已授权写入**：文件直接写进去，并自动重新扫描 B 站。
- **拖的是 zip / 未授权写入**：生成 `主题文件-<模板名>-<时间戳>.zip`，解压覆盖到 B 站主题根即可。
- **媒体单独打包**：图片和视频分开成两个 zip，解压后把文件上传到 B 站后台 **Files**，保持同名，
  JSON 里的 `shopify://shop_images/xxx.jpg` 就会直接生效。

导出 ZIP 名称填了自定义值时，会按包的类型追加后缀，方便区分该传哪一批：

| 包 | 文件名 |
| --- | --- |
| 图片 | `<自定义名>-图片.zip` |
| 视频 | `<自定义名>-视频.zip` |
| 主题文件 | 只有这一个包时用 `<自定义名>.zip`，与其它包同时存在时用 `<自定义名>-主题文件.zip` |

## 浏览器要求

| 功能 | Chrome / Edge | Safari | Firefox |
| --- | --- | --- | --- |
| 选择文件夹 | ✅ | 部分版本 | ❌ |
| 拖入 zip | ✅ | ✅ | ✅ |
| 直接写回目录 | ✅ | 部分版本 | ❌ |

不支持目录选择的浏览器会自动降级为 zip 模式。

## 部署到 GitHub Pages

线上地址：**https://devshopify.github.io/Sky-removal-json/**

GitHub Pages 在 Free 计划下只支持公开仓库，所以这个仓库是 public 的（业务仓库和 `data/` 都已 gitignore）。

更新线上版本只要一条命令：

```bash
npm run deploy:gh
```

它做三件事：以 `.env.ghpages` 里的 `VITE_BASE`（当前为 `/Sky-removal-json/`）为 base 构建 → 写入 `.nojekyll` → 强制推送到 `gh-pages` 分支。约 30~60 秒后生效。

改仓库地址的话，设环境变量 `GH_PAGES_REPO` 即可；改子路径改 `.env.ghpages` 里的 `VITE_BASE`。

## 批量下载后台 Files（视频）

网页版是纯前端，拿不到后台登录态；而 `{{ 'videos/xxx.mov' | file_url }}` 这类引用
对应的真实地址是 `cdn.shopify.com/videos/c/vp/<hash>/…`，靠文件名拼不出来。
这时用本地脚本走 Admin API，把 Files 里每个文件的真实地址取回来，按后台原名下载。

1. Shopify 后台 → 设置 → 应用 → **在 Dev Dashboard 中构建应用**（2026-01 之后新建应用只能走这里）
2. Dev Dashboard → **Create app** → 建一个 version：App URL 随便填（如 `http://localhost`），
   权限只勾 `read_files` → **Release**
3. 在该 app 里 **Install app**，选择要读的店铺（同一组织下的店可复选）
4. app → Settings 复制 **Client ID** 与 **Client secret**
5. 复制 `.env.videos.example` 为 `.env.videos`，填进去（该文件已 gitignore）

**注意两点：**

- 脚本里的店铺要用 **myshopify 子域名**（后台地址栏 `admin.shopify.com/store/<handle>` 的 handle），
  不是 `global.dreametech.com` 这种自定义域名 —— Admin API 不认自定义域名。
- 新应用没有静态 token，脚本每次运行时用 Client ID/Secret 现换一个 24 小时有效的 token，
  不需要你手动续。一份凭据可以跑所有已安装该应用的店铺。

```
SHOPIFY_CLIENT_ID=xxx
SHOPIFY_CLIENT_SECRET=shpss_xxx
SHOPIFY_SHOPS=dreame-global,dreame-de
```

```bash
npm run files -- --dry                            # 只列 name → url，先确认能读通
npm run files -- --type video --zip               # 下载全部视频并打包
npm run files -- --type video --names list.txt    # 只下名单里的名字
```

输出在 `data/downloads/`，文件名与后台一致；同时生成 `names-and-urls.txt`，
可以整段粘进网页版的「视频地址补充」，让它和主题文件一起打进 `-视频.zip`。

> **视频下载目前是关闭状态。** `src/core/features.js` 里的 `VIDEO_DOWNLOAD_ENABLED = false`
> 时，网页版只展示视频清单（含「仅展示」标记和复制文件名按钮），「视频地址补充」输入框隐藏。
> 需要恢复把常量改成 `true` 即可，配套逻辑都还在。

### app 和店铺不在同一个组织时（第三方开发）

client credentials 要求 app 与店铺同属一个组织。如果你只是给别家店做开发，
用授权码流程：由店铺管理员授权一次，拿到的是 offline token，不会过期。

1. Dev Dashboard 的 app 里，把 **Allowed redirection URLs** 填成 `http://localhost`
2. 生成授权链接：

   ```bash
   npm run files -- --authorize
   ```

3. 把链接发给店铺管理员（或自己用有「批准应用」权限的账号）打开并授权
4. 授权后浏览器跳到 `http://localhost/?code=xxx`，页面打不开是正常的；
   复制地址栏里 `code=` 后面那段
5. 换 token 并缓存（存在 `.shopify-token.json`，已 gitignore，长期有效）：

   ```bash
   npm run files -- --code <粘贴授权码>
   ```

之后直接 `npm run files -- --type video --zip` 即可，脚本会优先用缓存 token。

## 开发

```
src/core/           纯逻辑，不依赖 Node 或 DOM
  indexer.js        扫描站点、推断主题根、建索引
  resolver.js       依赖图展开（BFS）
  parsers/          json / liquid / css / js 各自的引用解析
  compare.js        A/B 比对（SHA-256）
  downloader.js     CDN 拼接与并发下载
  fsa-reader.js     两种 IO 实现：File System Access / 内存
src/composables/    状态与流程编排
src/components/     界面
server/node-reader.js  Node 环境下的 IO（跑测试用）
```

核心层不直接碰文件系统，读文件统一走 reader 接口，所以同一套解析逻辑在浏览器和 Node 里都能跑。

```bash
npm test    # 用 test/fixtures 里的 A/B 主题跑断言
```

## 已知边界

- `locales/*.schema.json` 里的翻译 key 不在解析范围内。搬的 section 若用了 `"t:"` 翻译，
  记得同步语言文件。
- `settings_data.json` 这类店铺配置不会被分析。
- JS 里拼接太深的路径抓不到——这也是默认不分析 js 的原因之一。
