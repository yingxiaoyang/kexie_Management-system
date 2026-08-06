<template>
  <el-popover trigger="click" placement="bottom-start" :width="620" popper-class="archive-placeholder-popper">
    <template #reference>
      <el-button size="small" plain>{{ buttonText }}</el-button>
    </template>
    <div class="archive-placeholder-picker">
      <div class="placeholder-picker-head">
        <strong>选择命名字段</strong>
        <span>点击字段即可插入，可与固定文字组合使用。</span>
      </div>
      <el-input v-model="keyword" clearable placeholder="搜索字段名称、占位符或示例" />
      <div class="placeholder-picker-groups">
        <section v-for="group in filteredGroups" :key="group.label" class="placeholder-picker-group">
          <div class="placeholder-picker-group-title">{{ group.label }}</div>
          <div class="placeholder-picker-items">
            <button v-for="item in group.items" :key="item.token" type="button" class="placeholder-picker-item" @click="$emit('select', item.token)">
              <span class="placeholder-picker-label">{{ item.label }}</span>
              <code>{{ item.token }}</code>
              <small>示例：{{ item.example }}</small>
            </button>
          </div>
        </section>
        <el-empty v-if="!filteredGroups.length" description="没有匹配的字段" :image-size="52" />
      </div>
    </div>
  </el-popover>
</template>

<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  groups: { type: Array, default: () => [] },
  buttonText: { type: String, default: '选择字段' }
})

defineEmits(['select'])

const keyword = ref('')
const filteredGroups = computed(() => {
  const value = keyword.value.trim().toLowerCase()
  if (!value) return props.groups
  return props.groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => [item.label, item.token, item.example].some((text) => String(text || '').toLowerCase().includes(value)))
  })).filter((group) => group.items.length)
})
</script>
