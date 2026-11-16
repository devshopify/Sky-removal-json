<script setup>
import { computed } from 'vue';
import { analysis } from '../composables/useMigration.js';
import { mediaBundleKind } from '../core/bundle.js';
import { VIDEO_DOWNLOAD_ENABLED } from '../core/features.js';
import { SECTION_LIMIT } from '../core/template.js';

const cells = computed(() => {
  const res = analysis.value;
  if (!res) return [];
  const c = res.counts;

  // 待下载的媒体按图片 / 视频分开计数，和表格分组保持一致
  const pending = { image: 0, video: 0, other: 0 };
  let videoTotal = 0;
  (res.media || []).forEach((m) => {
    const kind = mediaBundleKind(m.kind);
    if (kind === 'video') videoTotal += 1;
    if (m.status === 'download') pending[kind] += 1;
  });

  const sectionTotal = typeof res.sections === 'number' ? res.sections : null;
  const sectionOver = sectionTotal !== null && sectionTotal > SECTION_LIMIT;

  return [
    {
      label: sectionOver ? '模板模块 · 超上限' : '模板模块',
      value: sectionTotal === null ? '—' : sectionTotal,
      cls: sectionOver ? 'over' : '',
      hint: sectionTotal === null
        ? '没读到入口 JSON 的 sections：入口可能是 section group，或读取失败（控制台有 warn）'
        : `非 Plus 店铺每个 JSON 模板最多 ${SECTION_LIMIT} 个 section`,
    },
    { label: '依赖文件', value: c.total, cls: '' },
    { label: '缺失文件 · 需搬迁', value: c.missing, cls: 'missing' },
    { label: '冲突 · 内容不同', value: c.modified, cls: 'modified' },
    { label: '已存在 · 相同', value: c.identical, cls: 'identical' },
    { label: '图片 · 待下载', value: pending.image, cls: 'download' },
    VIDEO_DOWNLOAD_ENABLED
      ? { label: '视频 · 待下载', value: pending.video, cls: 'download' }
      : { label: '视频 · 仅展示', value: videoTotal, cls: '' },
    ...(pending.other ? [{ label: '其他媒体 · 待下载', value: pending.other, cls: 'download' }] : []),
    { label: '未解析引用', value: res.unresolved.length, cls: 'external' },
  ];
});
</script>

<template>
  <div class="summary">
    <div
      v-for="c in cells"
      :key="c.label"
      class="sum-cell"
      :class="[c.cls, { zero: !c.value }]"
      :title="c.hint || ''"
    >
      <div class="sum-label">{{ c.label }}</div>
      <div class="sum-value">{{ c.value }}</div>
    </div>
  </div>
</template>
