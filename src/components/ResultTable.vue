<script setup>
import {
  groupedRows, ui, selected, toggleRow, toggleGroup, toast, STATUS_META, ICON,
} from '../composables/useMigration.js';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hl(text, kw) {
  const safe = esc(text);
  const k = (kw || '').trim();
  if (!k) return safe;
  const pattern = esc(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return safe.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>');
  } catch {
    return safe;
  }
}

function humanSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function groupState(g) {
  const keys = g.rows.filter((r) => !r.locked).map((r) => r.key);
  const sel = keys.filter((k) => selected.value.has(k)).length;
  return { checked: sel === keys.length && keys.length > 0, indeterminate: sel > 0 && sel < keys.length };
}

function groupKeys(g) {
  return g.rows.filter((r) => !r.locked).map((r) => r.key);
}

/** 只取文件名：videos/x.mov → x.mov、assets/y.mp4 → y.mp4 */
function baseName(row) {
  const raw = row.name || row.rel || row.display || '';
  return String(raw).split('/').filter(Boolean).pop() || String(raw);
}

/** 复制媒体文件名，方便去 Shopify 后台 Files 里按名字找 */
async function copyName(row) {
  const text = baseName(row);
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(`已复制：${text}`);
}

function toggleCollapse(key) {
  const set = new Set(ui.collapsed);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  ui.collapsed = [...set];
}

function onHeadClick(e, key) {
  if (e.target.closest('input')) return;
  toggleCollapse(key);
}

function meta(row) {
  return STATUS_META[row.status] || STATUS_META.missing;
}

function viaText(row) {
  if (row.rowType === 'media') {
    return `${row.refFrom || ''}${row.refKey ? ` · ${row.refKey}` : ''}`;
  }
  return row.via ? `${row.via}${row.refKey && row.refKey !== 'entry' ? ` · ${row.refKey}` : ''}` : '入口文件';
}
</script>

<template>
  <div class="table-wrap">
    <div v-if="!groupedRows.length" class="empty-hint" style="padding: 40px">当前筛选条件下没有内容</div>

    <div v-for="g in groupedRows" :key="g.key" class="grp" :class="{ collapsed: ui.collapsed.includes(g.key) }">
      <div class="grp-head" @click="onHeadClick($event, g.key)">
        <span class="grp-caret">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6" /></svg>
        </span>
        <input
          type="checkbox"
          class="grp-check"
          :checked="groupState(g).checked"
          :indeterminate.prop="groupState(g).indeterminate"
          :disabled="!groupKeys(g).length"
          @change="toggleGroup(groupKeys(g), $event.target.checked)"
        />
        <span class="grp-title">{{ g.label }}</span>
        <span class="grp-count">{{ g.total }}</span>
        <span class="grp-tags">
          <span v-if="g.cnt.missing">缺失 {{ g.cnt.missing }}</span>
          <span v-if="g.cnt.download - g.locked > 0">待下载 {{ g.cnt.download - g.locked }}</span>
          <span v-if="g.locked">仅展示 {{ g.locked }}</span>
          <span v-if="g.cnt.modified">冲突 {{ g.cnt.modified }}</span>
          <span v-if="g.cnt.identical">已存在 {{ g.cnt.identical }}</span>
        </span>
      </div>

      <div class="grp-body">
        <div v-if="!g.rows.length" class="group-empty">
          没有识别到视频引用（模板里既没有 shopify://videos，也没有 .mp4 / .mov 地址）
        </div>
        <div
          v-for="row in g.rows"
          :key="row.key"
          class="row"
          :class="{ dup: row.status === 'identical', locked: row.locked }"
        >
          <span v-if="row.locked" class="row-lock" title="视频下载已暂时关闭，仅展示">—</span>
          <input v-else type="checkbox" :checked="selected.has(row.key)" @change="toggleRow(row.key)" />
          <span class="ico" :class="'g-' + row.group">{{ ICON[row.group] || '?' }}</span>
          <div class="row-main">
            <div class="row-path" :title="row.display" v-html="hl(row.display, ui.search)" />
            <div class="row-via" :title="viaText(row)"><b>←</b> {{ viaText(row) }}</div>
          </div>
          <div class="row-size">{{ row.rowType === 'media' && row.status === 'download' ? '—' : humanSize(row.size) }}</div>
          <div>
            <span v-if="row.locked" class="badge locked">仅展示</span>
            <span v-else class="badge" :class="meta(row).cls">{{ meta(row).label }}</span>
          </div>
          <div class="row-bsize" title="B 站当前大小">
            <span v-if="row.rowType === 'media' && row.status === 'download'" class="src-tag">CDN</span>
            <template v-else>{{ humanSize(row.b && row.b.size) }}</template>
          </div>
          <div class="row-copy">
            <button
              v-if="row.group === 'media-video'"
              class="btn-copy-name"
              :title="`复制文件名：${baseName(row)}`"
              @click.stop="copyName(row)"
            >
              复制视频文件名
            </button>
          </div>
        </div>
        <div v-if="g.total > g.rows.length" class="empty-hint" style="padding: 10px">
          为性能只显示前 {{ g.rows.length }} 项，共 {{ g.total }} 项 —— 用搜索框缩小范围
        </div>
      </div>
    </div>
  </div>
</template>
