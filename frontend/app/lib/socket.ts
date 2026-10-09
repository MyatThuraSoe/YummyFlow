import { io } from "socket.io-client";

// Replace with your backend URL
const SOCKET_URL = "http://localhost:5000";

export const socket = io(SOCKET_URL, {
  withCredentials: true, // Important if you need to send cookies
  autoConnect: false, // We connect manually in the component
});
