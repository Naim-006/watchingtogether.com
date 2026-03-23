import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  const PORT = parseInt(process.env.PORT || '3000', 10);
  
  // Handle favicon to avoid 404s
  app.get('/favicon.ico', (req, res) => res.status(204).end());

  // Health check for Render
  app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' }));

  // Room state management
  const roomStates = new Map();
  const socketToUser = new Map<string, { userId: string, roomId: string }>();
  const chatHistory = new Map<string, any[]>(); // Persistent in-memory fallback

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("room:check_lock", ({ roomId }, callback) => {
      const state = roomStates.get(roomId);
      if (callback) callback({ isLocked: !!state?.isLocked });
    });

    socket.on("room:join", async ({ roomId, userId, username }) => {
      // Check if room is locked
      const state = roomStates.get(roomId);
      if (state?.isLocked) {
        socket.emit("room:error", { message: "Room is locked by host." });
        return;
      }

      socket.join(roomId);
      socketToUser.set(socket.id, { userId, roomId });
      console.log(`${username} joined room ${roomId}`);
      
      // Update room members and user online status in DB
      try {
        // Ensure user exists first
        await supabase.from('users').upsert({
          id: userId,
          username: username,
          online: true,
          last_seen: new Date().toISOString()
        });

        // Ensure room exists
        await supabase.from('rooms').upsert({
          id: roomId,
          room_code: roomId
        });

        // Check if room has a host, if not make this user host (if role was host)
        const { data: members } = await supabase.from('room_members').select('role').eq('room_id', roomId);
        const hasHost = members?.some(m => m.role === 'host');

        await supabase.from('room_members').upsert({
          id: `${roomId}:${userId}`,
          room_id: roomId,
          user_id: userId,
          role: hasHost ? 'viewer' : 'host' 
        });
      } catch (err) {
        console.error("Error updating member/user status:", err);
      }
      
      // Notify others and send full room state
      socket.to(roomId).emit("user:joined", { userId, username, socketId: socket.id });
      
      const { data: allMembers } = await supabase.from('room_members').select('user_id, role, users(username, online, last_seen)').eq('room_id', roomId);
      const membersList = allMembers?.map((m: any) => ({
        userId: m.user_id,
        username: m.users.username,
        role: m.role,
        online: m.users.online,
        lastSeen: m.users.last_seen
      }));
      
      io.to(roomId).emit("room:update", { members: membersList });

      // Send current video state if exists
      if (roomStates.has(roomId)) {
        socket.emit("video:sync", roomStates.get(roomId));
      }

      // Send current chat memory history if exists
      if (chatHistory.has(roomId)) {
        socket.emit("chat:history", chatHistory.get(roomId));
      }
    });

    socket.on("video:set", async ({ roomId, videoData }) => {
      roomStates.set(roomId, { ...videoData, lastUpdate: Date.now() });
      
      // Persist to DB
      try {
        await supabase.from('room_videos').insert({
          room_id: roomId,
          video_type: videoData.type || 'youtube', // Default or from data
          video_url: videoData.url,
          set_by: videoData.userId // Host ID
        });
      } catch (err) {
        console.error("Error saving video:", err);
      }
      
      io.to(roomId).emit("video:sync", roomStates.get(roomId));
    });

    socket.on("video:action", async ({ roomId, action, currentTime, playbackRate, userId }) => {
      const state = roomStates.get(roomId) || {};
      const newState = { 
        ...state, 
        isPlaying: action === 'play' ? true : action === 'pause' ? false : state.isPlaying,
        currentTime,
        playbackRate: playbackRate || state.playbackRate || 1,
        lastUpdate: Date.now()
      };
      roomStates.set(roomId, newState);
      
      // Broadcast to everyone except sender
      socket.to(roomId).emit("video:action", { action, currentTime, playbackRate });
    });

    socket.on("video:request_sync", ({ roomId }) => {
      if (roomStates.has(roomId)) {
        socket.emit("video:sync", roomStates.get(roomId));
      }
    });

    socket.on("chat:send", async ({ roomId, message }) => {
      console.log(`[Chat] Message from ${message.username} in ${roomId}`);
      try {
        // 1. Persist to DB using the provided string ID
        const { data: dbMsg, error } = await supabase.from('messages').insert({
          id: message.id, // Now valid since primary key is TEXT
          room_id: roomId,
          sender_id: message.senderId,
          content: message.content,
          type: message.type || 'text',
          file_url: message.fileUrl || null,
          reply_to: message.replyTo?.id || null
        }).select().single();

        if (error) throw error;

        // 2. Broadcast the message (using the DB provided state if possible)
        const finalMessage = {
          ...message,
          id: dbMsg?.id || message.id,
          timestamp: dbMsg?.created_at ? new Date(dbMsg.created_at).getTime() : message.timestamp,
          seenBy: []
        };

        // 3. Update RAM History with the correct ID
        const history = chatHistory.get(roomId) || [];
        history.push(finalMessage);
        if (history.length > 200) history.shift();
        chatHistory.set(roomId, history);

        // 4. Broadcast the message with the correct ID to everyone
        io.to(roomId).emit("chat:message", finalMessage);
      } catch (err) {
        console.error("[Chat] Error saving message:", err);
        // Fallback: broadcast with temp ID if DB fails (limited functionality)
        io.to(roomId).emit("chat:message", { ...message, seenBy: [] });
      }
    });

    socket.on("chat:seen", async ({ roomId, messageId, userId }) => {
      // RAM update for instant broadcast
      const history = chatHistory.get(roomId) || [];
      const msg = history.find(m => m.id === messageId);
      let seenArray = [userId];
      if (msg) {
        const seenSet = new Set(msg.seenBy || []);
        seenSet.add(userId);
        seenArray = Array.from(seenSet);
        msg.seenBy = seenArray;
      }
      
      socket.to(roomId).emit("chat:seen_update", { messageId, seenBy: seenArray });

      // DB attempt
      try {
        const { data: msg } = await supabase
          .from('messages')
          .select('seen_by')
          .eq('id', messageId)
          .single();
        
        if (msg) {
          const seenBy = new Set(msg.seen_by || []);
          seenBy.add(userId);
          await supabase
            .from('messages')
            .update({ seen_by: Array.from(seenBy) })
            .eq('id', messageId);
        }
      } catch (err) {
        console.error("Error updating seen status:", err);
      }
    });

    socket.on("chat:react", async ({ roomId, messageId, emoji, userId }) => {
      console.log(`[Chat] React ${emoji} to ${messageId} by ${userId}`);
      const history = chatHistory.get(roomId) || [];
      const msgIdx = history.findIndex(m => m.id === messageId);
      
      let reactions = {};

      if (msgIdx > -1) {
        const msg = history[msgIdx];
        if (!msg.reactions) msg.reactions = {};
        if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
        
        const userIndex = msg.reactions[emoji].indexOf(userId);
        if (userIndex > -1) {
          msg.reactions[emoji].splice(userIndex, 1);
          if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
        } else {
          msg.reactions[emoji].push(userId);
        }
        
        reactions = msg.reactions;
        history[msgIdx] = msg;
        chatHistory.set(roomId, history);
        
        io.to(roomId).emit("chat:react_update", { messageId, reactions });
      } else {
        // If not in RAM (stale or after refresh), we still need to handle it
        try {
          const { data: dbMsg } = await supabase.from('messages').select('reactions').eq('id', messageId).single();
          if (dbMsg) {
            reactions = dbMsg.reactions || {};
            if (!reactions[emoji]) reactions[emoji] = [];
            const userIndex = reactions[emoji].indexOf(userId);
            if (userIndex > -1) {
              reactions[emoji].splice(userIndex, 1);
              if (reactions[emoji].length === 0) delete reactions[emoji];
            } else {
              reactions[emoji].push(userId);
            }
            io.to(roomId).emit("chat:react_update", { messageId, reactions });
          }
        } catch (e) {}
      }

      // Final DB persist
      try {
        await supabase.from('messages').update({ reactions }).eq('id', messageId);
      } catch (err) {
        console.error("Error updating reactions in DB:", err);
      }
    });

    socket.on("chat:edit", async ({ roomId, messageId, newContent }) => {
      console.log(`[Chat] Edit ${messageId} to "${newContent}"`);
      const history = chatHistory.get(roomId) || [];
      const msgIdx = history.findIndex(m => m.id === messageId);
      
      if (msgIdx > -1) {
        history[msgIdx].content = newContent;
        history[msgIdx].isEdited = true;
        chatHistory.set(roomId, history);
      }
      
      // Always broadcast and persist
      io.to(roomId).emit("chat:edit_update", { messageId, newContent, isEdited: true });

      try {
        await supabase.from('messages').update({ content: newContent, is_edited: true }).eq('id', messageId);
      } catch (err) {
        console.error("[Chat] Error editing message:", err);
      }
    });

    socket.on("chat:delete", async ({ roomId, messageId }) => {
      console.log(`[Chat] Delete ${messageId}`);
      let history = chatHistory.get(roomId) || [];
      history = history.filter(m => m.id !== messageId);
      chatHistory.set(roomId, history);
      
      io.to(roomId).emit("chat:delete_update", { messageId });

      try {
        await supabase.from('messages').delete().eq('id', messageId);
      } catch (err) {
        console.error("[Chat] Error deleting message:", err);
      }
    });

    socket.on("room:toggle_lock", async ({ roomId, isLocked }) => {
      const state = roomStates.get(roomId) || {};
      roomStates.set(roomId, { ...state, isLocked });
      io.to(roomId).emit("room:update", { isLocked });
    });

    socket.on("room:transfer_host", async ({ roomId, targetUserId }) => {
      try {
        // Demote current host
        await supabase.from('room_members').update({ role: 'viewer' }).eq('room_id', roomId).eq('role', 'host');
        // Promote new host
        await supabase.from('room_members').update({ role: 'host' }).eq('room_id', roomId).eq('user_id', targetUserId);
        
        // Fetch new members list
        const { data: allMembers } = await supabase.from('room_members').select('user_id, role, users(username, online, last_seen)').eq('room_id', roomId);
        const membersList = allMembers?.map((m: any) => ({
          userId: m.user_id,
          username: m.users.username,
          role: m.role,
          online: m.users.online,
          lastSeen: m.users.last_seen
        }));
        
        io.to(roomId).emit("room:update", { members: membersList });
      } catch (err) {
        console.error("Error transferring host:", err);
      }
    });

    socket.on("user:typing", ({ roomId, username, isTyping }) => {
      socket.to(roomId).emit("user:typing", { username, isTyping });
    });

    // WebRTC Signaling
    socket.on("call:initiate", ({ roomId }) => {
      socket.to(roomId).emit("call:initiate", { from: socket.id });
    });

    socket.on("call:offer", ({ roomId, offer, to }) => {
      socket.to(to).emit("call:offer", { offer, from: socket.id });
    });

    socket.on("call:answer", ({ roomId, answer, to }) => {
      socket.to(to).emit("call:answer", { answer, from: socket.id });
    });

    socket.on("call:ice", ({ roomId, candidate, to }) => {
      socket.to(to).emit("call:ice", { candidate, from: socket.id });
    });

    socket.on("disconnecting", () => {
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          socket.to(room).emit("user:left", { socketId: socket.id });
        }
      }
    });

    socket.on("disconnect", async () => {
      console.log("User disconnected:", socket.id);
      const user = socketToUser.get(socket.id);
      if (user) {
        try {
          await supabase.from('users').update({ online: false, last_seen: new Date().toISOString() }).eq('id', user.userId);
        } catch (err) {
          console.error("Error updating offline status:", err);
        }
        socketToUser.delete(socket.id);
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
