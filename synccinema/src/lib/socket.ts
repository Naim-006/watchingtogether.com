import { io } from 'socket.io-client';

// In dev:    connects to http://localhost:3001 (or wherever Vite proxies)
// In prod:   connects to VITE_SOCKET_URL (your Render backend URL)
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;

export const socket = io(SOCKET_URL, {
  autoConnect: false,
  transports: ['polling', 'websocket'], // polling first for maximum compatibility
});
