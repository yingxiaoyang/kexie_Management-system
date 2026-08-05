<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">材料提交</h2>
        <p class="page-desc">查看截止时间、提交状态和退回原因，后续接入真实上传接口。</p>
      </div>
      <el-button type="primary" @click="dialogVisible = true">
        <el-icon><Upload /></el-icon>
        上传材料
      </el-button>
    </div>

    <div class="panel">
      <el-table :data="ownerTasks" style="width: 100%">
        <el-table-column prop="name" label="材料任务" min-width="160" />
        <el-table-column prop="project" label="所属项目" min-width="220" show-overflow-tooltip />
        <el-table-column prop="deadline" label="截止时间" width="130" />
        <el-table-column prop="status" label="提交状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="退回原因" min-width="180" show-overflow-tooltip />
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button text @click="dialogVisible = true">
              <el-icon><UploadFilled /></el-icon>
              {{ row.status === '退回' ? '重新提交' : '提交' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" title="上传材料" width="520px">
      <el-form label-width="92px">
        <el-form-item label="材料类别">
          <el-select model-value="中期检查材料" style="width: 100%">
            <el-option label="中期检查材料" value="中期检查材料" />
            <el-option label="研究日志汇总" value="研究日志汇总" />
            <el-option label="阶段报销凭证" value="阶段报销凭证" />
          </el-select>
        </el-form-item>
        <el-form-item label="上传文件">
          <el-upload drag action="#" :auto-upload="false">
            <el-icon size="30"><UploadFilled /></el-icon>
            <div>拖拽文件到此处，或点击选择</div>
          </el-upload>
        </el-form-item>
        <el-form-item label="备注">
          <el-input type="textarea" :rows="3" placeholder="可填写本次提交说明" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="dialogVisible = false">保存提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ownerTasks } from '../../data/mock'

const dialogVisible = ref(false)

function statusType(status) {
  if (status === '已提交') return 'success'
  if (status === '退回') return 'danger'
  return 'warning'
}
</script>
