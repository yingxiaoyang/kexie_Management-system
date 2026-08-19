import { computed, reactive } from 'vue'
import { apiRequest, setUnauthorizedHandler } from '../services/http'

const state = reactive({
  user: null,
  initialized: false,
})

function persist(user) {
  state.user = user
  state.initialized = true
}

setUnauthorizedHandler(() => persist(null))

export const authStore = {
  state,
  isAuthenticated: computed(() => Boolean(state.user)),
  async login(credentials) {
    const response = await apiRequest('/auth/login', { method: 'POST', body: credentials })
    persist(response.data.user)
    return response.data.user
  },
  async refreshUser() {
    try {
      const response = await apiRequest('/auth/me')
      persist(response.data)
      return response.data
    } catch (error) {
      persist(null)
      throw error
    }
  },
  updateUser(user) {
    persist(user)
  },
  async logout() {
    try {
      await apiRequest('/auth/logout', { method: 'POST' })
    } finally {
      persist(null)
    }
  },
  isSuperAdmin(user = state.user) {
    return user?.role === 'admin' && user?.adminLevel === 'super'
  },
  hasPermission(permissionKey, user = state.user) {
    if (user?.role !== 'admin') return false
    return user.adminLevel === 'super' || (user.adminLevel === 'limited' && user.permissions?.includes(permissionKey))
  },
  homeForRole(role = state.user?.role) {
    if (role === 'admin') return '/admin/dashboard'
    if (role === 'applicant') return '/applicant/applications'
    return '/owner/dashboard'
  },
}
