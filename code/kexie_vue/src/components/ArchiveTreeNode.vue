<template>
  <div class="archive-tree-node">
    <div
      class="archive-node-row"
      :class="[{ 'is-selected': selectedId === node.id }, `is-${node.type}`]"
      draggable="true"
      @click="$emit('select', node.id)"
      @dragstart="startDrag"
      @dragover.prevent
      @drop.stop="dropOnNode"
    >
      <el-icon class="archive-node-icon"><FolderOpened v-if="node.type === 'folder'" /><Document v-else /></el-icon>
      <div class="archive-node-copy">
        <strong>{{ node.type === 'folder' ? node.nameRule : node.fileTaskName }}</strong>
        <span v-if="node.type === 'task'">{{ node.materialTaskName }}</span>
      </div>
      <div class="archive-node-actions" @click.stop>
        <el-tooltip v-if="node.type === 'folder'" content="新建子文件夹" placement="top">
          <el-button circle text aria-label="新建子文件夹" @click="$emit('add-folder', node.id)"><el-icon><FolderAdd /></el-icon></el-button>
        </el-tooltip>
        <el-tooltip content="上移" placement="top"><el-button circle text :disabled="index === 0" aria-label="上移" @click="$emit('move', node.id, -1)"><el-icon><ArrowUp /></el-icon></el-button></el-tooltip>
        <el-tooltip content="下移" placement="top"><el-button circle text :disabled="index === count - 1" aria-label="下移" @click="$emit('move', node.id, 1)"><el-icon><ArrowDown /></el-icon></el-button></el-tooltip>
        <el-tooltip content="移除" placement="top"><el-button circle text type="danger" aria-label="移除" @click="$emit('remove', node.id)"><el-icon><Delete /></el-icon></el-button></el-tooltip>
      </div>
    </div>
    <div
      v-if="node.type === 'folder'"
      class="archive-node-children"
      :class="{ 'is-empty': !node.children.length }"
      @dragover.prevent
      @drop.stop="dropIntoFolder"
    >
      <ArchiveTreeNode
        v-for="(child, childIndex) in node.children"
        :key="child.id"
        :node="child"
        :index="childIndex"
        :count="node.children.length"
        :selected-id="selectedId"
        @select="$emit('select', $event)"
        @add-folder="$emit('add-folder', $event)"
        @move="(id, offset) => $emit('move', id, offset)"
        @remove="$emit('remove', $event)"
        @drop-node="$emit('drop-node', $event)"
      />
      <div v-if="!node.children.length" class="archive-empty-folder">拖入子任务或文件夹</div>
    </div>
  </div>
</template>

<script setup>
defineOptions({ name: 'ArchiveTreeNode' })
const props = defineProps({
  node: { type: Object, required: true },
  index: { type: Number, required: true },
  count: { type: Number, required: true },
  selectedId: { type: String, default: '' },
})
const emit = defineEmits(['select', 'add-folder', 'move', 'remove', 'drop-node'])

function startDrag(event) {
  event.dataTransfer.effectAllowed = 'move'
  const payload = JSON.stringify({ kind: 'node', nodeId: props.node.id })
  event.dataTransfer.setData('application/x-archive-node', payload)
  event.dataTransfer.setData('text/plain', payload)
}

function dragPayload(event) {
  const raw = event.dataTransfer.getData('application/x-archive-node') || event.dataTransfer.getData('text/plain')
  try { return JSON.parse(raw) } catch { return null }
}

function dropOnNode(event) {
  const payload = dragPayload(event)
  if (!payload || payload.nodeId === props.node.id) return
  emit('drop-node', { payload, targetId: props.node.id, mode: props.node.type === 'folder' ? 'inside' : 'before' })
}

function dropIntoFolder(event) {
  const payload = dragPayload(event)
  if (!payload || payload.nodeId === props.node.id) return
  emit('drop-node', { payload, targetId: props.node.id, mode: 'inside' })
}
</script>
