<template>
  <main class="login-page">
    <section class="login-card compact-card">
      <div class="login-intro">
        <el-tag type="warning" effect="plain">安全要求</el-tag>
        <h1>修改初始密码</h1>
        <p>新密码至少 8 位。修改完成后才可以进入业务页面。</p>
      </div>
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <el-form-item label="当前密码" prop="oldPassword">
          <el-input v-model="form.oldPassword" type="password" show-password autocomplete="current-password" />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input v-model="form.newPassword" type="password" show-password autocomplete="new-password" />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirmPassword">
          <el-input v-model="form.confirmPassword" type="password" show-password autocomplete="new-password" />
        </el-form-item>
        <el-button type="primary" class="login-submit" :loading="loading" @click="submit">保存并进入系统</el-button>
        <el-button class="login-submit" @click="logout">退出登录</el-button>
      </el-form>
    </section>
  </main>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { apiRequest } from '../services/http'
import { authStore } from '../stores/auth'

const router = useRouter()
const formRef = ref()
const loading = ref(false)
const form = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })
const rules = {
  oldPassword: [{ required: true, message: '请输入当前密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, message: '新密码至少 8 位', trigger: 'blur' },
  ],
  confirmPassword: [{
    validator: (_rule, value, callback) => value === form.newPassword ? callback() : callback(new Error('两次输入的新密码不一致')),
    trigger: 'blur',
  }],
}

async function submit() {
  if (!(await formRef.value?.validate().catch(() => false))) return
  loading.value = true
  try {
    await apiRequest('/auth/change-password', { method: 'POST', body: { oldPassword: form.oldPassword, newPassword: form.newPassword } })
    authStore.updateUser({ ...authStore.state.user, passwordResetRequired: false })
    ElMessage.success('密码修改成功')
    await router.replace(authStore.homeForRole())
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    loading.value = false
  }
}

function logout() {
  authStore.logout()
  router.replace('/login')
}
</script>
