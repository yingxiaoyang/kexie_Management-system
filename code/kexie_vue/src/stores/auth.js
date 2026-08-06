import { computed, reactive } from 'vue'
import { apiRequest } from '../services/http'

const TOKEN_KEY = 'kexie_token'
const USER_KEY = 'kexie_user'

function storedUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null')
  } catch {
    return null
  }
}

const state = reactive({
  token: localStorage.getItem(TOKEN_KEY),
  user: storedUser(),
})

function persist(token, user) {
  state.token = token
  state.user = user
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
  else localStorage.removeItem(USER_KEY)
}

export const authStore = {
  state,
  isAuthenticated: computed(() => Boolean(state.token && state.user)),
  async login(credentials) {
    const response = await apiRequest('/auth/login', { method: 'POST', body: credentials })
    persist(response.data.token, response.data.user)
    return response.data.user
  },
  async refreshUser() {
    if (!state.token) return null
    const response = await apiRequest('/auth/me')
    persist(state.token, response.data)
    return response.data
  },
  updateUser(user) {
    persist(state.token, user)
  },
  logout() {
    persist(null, null)
  },
  homeForRole(role = state.user?.role) {
    return role === 'admin' ? '/admin/dashboard' : '/owner/dashboard'
  },
}
