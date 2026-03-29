import { io, Socket } from 'socket.io-client';

const HUB_URL = import.meta.env.VITE_HUB_URL ?? '';

let socket: Socket | null = null;

export function getHubSocket(): Socket {
  if (!socket) {
    socket = io(HUB_URL, {
      autoConnect: false,
      withCredentials: true,
      transports: ['polling', 'websocket'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 5000,
    });
  }

  return socket;
}

export function disconnectHubSocket() {
  if (!socket) {
    return;
  }

  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}
