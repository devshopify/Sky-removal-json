<script setup>
import { computed } from 'vue';
import { ui } from '../composables/useMigration.js';
import { parseExtraUrls } from '../core/extras.js';
import { VIDEO_DOWNLOAD_ENABLED } from '../core/features.js';

/** 各站点图片地址速查页，随应用一起发布 */
const sitesUrl = `${import.meta.env.BASE_URL}sites.html`;

const extraCount = computed(() => parseExtraUrls(ui.extraVideos).length);

function onBaseInput(e) {
  ui.mediaBase = e.target.value;
  localStorage.setItem('migrator.media', ui.mediaBase);
}

function onZipInput(e) {
  ui.zipName = e.target.value;
  localStorage.setItem('migrator.zipName', ui.zipName);
}

function onExtraInput(e) {
  ui.extraVideos = e.target.value;
  localStorage.setItem('migrator.extraVideos', ui.extraVideos);
}
</script>

<template>
  <section class="block">
    <div class="block-head">
      <span class="dot dot-media" />
      <h2>图片与导出</h2>
    </div>

    <div class="field-row">
      <label class="field-label">图片来源地址</label>
      <a class="mini-btn" :href="sitesUrl" target="_blank" rel="noopener">地址链接</a>
    </div>
    <input
      :value="ui.mediaBase"
      type="text"
      placeholder="https://es.dreametech.com/cdn/shop/files/"
      spellcheck="false"
      @input="onBaseInput"
    />

    <label class="field-label">导出 ZIP 名称</label>
    <input
      :value="ui.zipName"
      type="text"
      placeholder="留空则自动命名"
      spellcheck="false"
      maxlength="60"
      @input="onZipInput"
    />

    <details v-if="VIDEO_DOWNLOAD_ENABLED" class="extra-videos">
      <summary>
        视频地址补充
        <span v-if="extraCount" class="tag-read">{{ extraCount }}</span>
      </summary>
      <textarea
        :value="ui.extraVideos"
        rows="4"
        spellcheck="false"
        placeholder="粘视频地址，或整页源码：Ctrl+U → Ctrl+A → Ctrl+C"
        @input="onExtraInput"
      />
      <p class="extra-hint">
        支持整页源码 / 控制台输出，会自动抽出里面所有图片和视频地址；
        <b>页面地址本身读不到内容</b>（跨域限制），要贴源码。<br />
        想保住原文件名就这样写：<code>原名.mov | https://…</code>
      </p>
    </details>

    <div class="site-status">
      <span class="muted">shopify:// 的图片拼此地址下载</span>
    </div>
  </section>
</template>
