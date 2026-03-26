import { io, Socket } from 'socket.io-client';

const HUB_URL = import.meta.env.VITE_HUB_URL ?? '';

// Connect to hub — empty string uses the Vite proxy in dev, or same origin in prod
export const socket: Socket = io(HUB_URL, {
  transports: ['polling', 'websocket'],
  reconnectionAttempts: Infinity,
  reconnectionDelay: 2000,
});
