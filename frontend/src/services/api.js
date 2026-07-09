import axios from 'axios'

const baseURL = import.meta.env.PROD ? '' : ''

export const api = axios.create({ baseURL })

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/supervisor/login'
    }
    return Promise.reject(err)
  }
)
