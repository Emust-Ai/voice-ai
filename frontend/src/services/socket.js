import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.PROD ? '' : ''

let socket = null

export function getSocket(token) {
  if (socket?.connected) return socket
  socket = io(`${SOCKET_URL}/supervisor`, {
    auth: { token },
    transports: ['polling']
  })
  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
