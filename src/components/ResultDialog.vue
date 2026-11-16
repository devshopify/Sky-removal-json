<script setup>
import { computed } from 'vue';
import { ui, siteB, exportSiteZip } from '../composables/useMigration.js';
import { BUNDLE_LABEL } from '../core/bundle.js';

const res = computed(() => ui.result);

const failedDownloads = computed(() => (res.value && res.value.downloads ? res.value.downloads.results.filter((r) => !r.ok) : []));
const originalCount = computed(() => {
  const d = res.value && res.value.downloads;
  if (!d) return 0;
  return d.results.filter((r) => r.ok && r.resolvedName && r.resolvedName !== r.name).length;
});
const hasMediaZip = computed(() => Boolean(res.value && res.value.zips.some((z) => z.kind !== 'theme')));
const hasThemeZip = computed(() => Boolean(res.value && res.value.zips.some((z) => z.kind === 'theme')));
const notFoundCount = computed(() => failedDownloads.value.filter((d) => /404/.test(String(d.reason || ''))).length);
const convTargets = computed(() => {
  const stat = {};
  ((res.value && res.value.conversions) || []).forEach((c) => {
    stat[c.to] = (stat[c.to] || 0) + 1;
  });
  return Object.entries(stat);
});

function humanSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function close() {
  ui.result = null;
}
</script>

<template>
  <div v-if="res" class="modal" @click.self="close">
    <div class="modal-box narrow">
      <div class="modal-head">
        <h3>{{ res.failed.length || (res.downloads && res.downloads.failed) ? '执行完成（有失败项）' : '执行完成' }}</h3>
        <button class="btn-icon" @click="close">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>

      <div class="modal-body">
        <div class="res-section-title">主题文件</div>
        <div class="stat-line"><span>成功</span><b class="ok">{{ res.copied.length }}</b></div>
        <div class="stat-line"><span>失败</span><b :class="{ danger: res.failed.length }">{{ res.failed.length }}</b></div>
        <div v-for="f in res.failed" :key="f.rel" class="stat-line">
          <span class="mono-small">{{ f.rel }}</span><b class="danger">{{ f.reason }}</b>
        </div>

        <template v-if="res.downloads">
          <div class="res-section-title">媒体下载</div>
          <div class="stat-line"><span>成功</span><b class="ok">{{ res.downloads.success }}</b></div>
          <div class="stat-line"><span>失败</span><b :class="{ danger: res.downloads.failed }">{{ res.downloads.failed }}</b></div>
          <div class="stat-line"><span>总大小</span><b>{{ humanSize(res.downloads.totalSize) }}</b></div>
          <div v-if="originalCount" class="stat-line">
            <span>其中取原图（已去掉尺寸后缀）</span><b class="ok">{{ originalCount }}</b>
          </div>
          <div v-for="d in failedDownloads" :key="d.name" class="stat-line">
            <span class="mono-small">{{ d.name }}</span><b class="danger">{{ d.reason }}</b>
          </div>
          <p v-if="notFoundCount" class="zip-tip">
            有 {{ notFoundCount }} 个文件按名字拼出的地址不存在（404）。Shopify 托管的视频地址形如
            <code>/cdn/shop/videos/c/vp/…</code>，由哈希构成、无法从文件名推导；
            这类需要到页面上右键复制真实地址后手工下载。
          </p>
        </template>

        <template v-if="res.conversions && res.conversions.length">
          <div class="res-section-title">按 JSON 扩展名转码</div>
          <div v-for="[to, n] in convTargets" :key="to" class="stat-line">
            <span>转成 {{ to }}</span><b class="ok">{{ n }} 个</b>
          </div>
          <p class="zip-tip">
            这些文件的原始内容是 PNG / JPEG，已按 JSON 里写的扩展名重新编码，
            保证上传后文件名不变、主题引用能对上。
          </p>
        </template>

        <template v-if="res.zips.length">
          <div class="res-section-title">已下载到浏览器</div>
          <div v-for="z in res.zips" :key="z.name" class="zip-row">
            <div class="zip-name" :title="z.name">{{ z.name }}</div>
            <div class="zip-meta">
              {{ BUNDLE_LABEL[z.kind] || z.kind }} · {{ z.count }} 个 · {{ humanSize(z.size) }}
            </div>
          </div>
          <p class="zip-tip">
            <template v-if="hasMediaZip">图片和视频包分别解压后，把文件传到 B 站后台 <b>Files</b>（保持同名），JSON 里的 shopify:// 引用即可生效。</template>
            <template v-if="originalCount">
              有 {{ originalCount }} 个文件的引用名带尺寸后缀（如 <code>_1600x</code>），下载时已改取原图，
              但<b>文件名保持原样</b>，这样上传到 Files 后引用才能直接对上。
            </template>
            <template v-if="hasThemeZip">theme 包解压覆盖到 B 站主题根目录。</template>
          </p>
        </template>

        <div v-if="res.savedTo === 'target'" class="path-box">主题文件已直接写入目标站点的主题目录。</div>
      </div>

      <div class="modal-foot">
        <span class="muted">{{ ui.mediaBase }}</span>
        <div class="row-gap">
          <button v-if="siteB && siteB.reader.kind === 'memory'" class="btn-ghost" @click="exportSiteZip">
            导出整个站点 zip
          </button>
          <button class="btn-primary" @click="close">知道了</button>
        </div>
      </div>
    </div>
  </div>
</template>
