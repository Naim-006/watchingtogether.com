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
  const callParticipants = new Map<string, Set<string>>(); // roomId -> Set of socketIds

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("room:check_lock", ({ roomId }, callback) => {
      const state = roomStates.get(roomId);
      if (callback) callback({ isLocked: !!state?.isLocked });
    });

    socket.on("room:join", async ({ roomId, userId, username }) => {
      try {
        console.log(`[Room] User ${username} (${socket.id}) joining ${roomId}`);
        
        // Check if room is locked
        const state = roomStates.get(roomId);
        if (state?.isLocked) {
          socket.emit("room:error", { message: "Room is locked by host." });
          return;
        }

        socket.join(roomId);
        socketToUser.set(socket.id, { userId, roomId });

        // Update room members and user online status in DB
        try {
          await supabase.from('users').upsert({
            id: userId,
            username: username,
            online: true,
            last_seen: new Date().toISOString()
          });

          await supabase.from('rooms').upsert({
            id: roomId,
            room_code: roomId
          });

          const { data: members } = await supabase.from('room_members').select('role').eq('room_id', roomId);
          const hasHost = members?.some(m => m.role === 'host');

          await supabase.from('room_members').upsert({
            id: `${roomId}:${userId}`,
            room_id: roomId,
            user_id: userId,
            role: hasHost ? 'viewer' : 'host'
          });
        } catch (dbErr) {
          console.error("[Room] DB update error:", dbErr);
        }

        // Notify others
        socket.to(roomId).emit("user:joined", { userId, username, socketId: socket.id });

        // Sync call participants
        const currentCallers = Array.from(callParticipants.get(roomId) || []);
        console.log(`[Call] Syncing ${currentCallers.length} callers to ${username}`);
        socket.emit("call:update", { participants: currentCallers });

        // Full room update
        const { data: allMembers, error: membersError } = await supabase.from('room_members').select('user_id, role, users(username, online, last_seen)').eq('room_id', roomId);
        
        if (!membersError && allMembers) {
          const membersList = allMembers.map((m: any) => ({
            userId: m.user_id,
            username: m.users?.username || 'Unknown',
            role: m.role,
            online: m.users?.online || false,
            lastSeen: m.users?.last_seen
          }));
          io.to(roomId).emit("room:update", { members: membersList });
        }

        // Sync video & chat
        if (roomStates.has(roomId)) socket.emit("video:sync", roomStates.get(roomId));
        if (chatHistory.has(roomId)) socket.emit("chat:history", chatHistory.get(roomId));

      } catch (fatalErr) {
        console.error("[Room] Fatal join error:", fatalErr);
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
      try {
        console.log(`[Chat] React ${emoji} to ${messageId} by ${userId}`);
        const history = chatHistory.get(roomId) || [];
        const msgIdx = history.findIndex(m => m.id === messageId);

        let reactions: Record<string, string[]> = {};

        if (msgIdx > -1) {
          const msg = history[msgIdx];
          reactions = msg.reactions || {};
          if (!reactions[emoji]) reactions[emoji] = [];

          const userIndex = reactions[emoji].indexOf(userId);
          if (userIndex > -1) {
            reactions[emoji].splice(userIndex, 1);
            if (reactions[emoji].length === 0) delete reactions[emoji];
          } else {
            reactions[emoji].push(userId);
          }

          msg.reactions = reactions;
          history[msgIdx] = msg;
          chatHistory.set(roomId, history);
        } else {
          // Fetch current reactions from DB first to avoid wiping data
          const { data: dbMsg, error: fetchErr } = await supabase
            .from('messages')
            .select('reactions')
            .eq('id', messageId)
            .single();
          
          if (fetchErr || !dbMsg) {
            console.error("[Chat] Error fetching reactions for update:", fetchErr);
            return;
          }

          reactions = dbMsg.reactions || {};
          if (!reactions[emoji]) reactions[emoji] = [];
          
          const userIndex = reactions[emoji].indexOf(userId);
          if (userIndex > -1) {
            reactions[emoji].splice(userIndex, 1);
            if (reactions[emoji].length === 0) delete reactions[emoji];
          } else {
            reactions[emoji].push(userId);
          }
        }

        // Broadcast the update immediately
        io.to(roomId).emit("chat:react_update", { messageId, reactions });

        // Persist to DB
        const { error: updateErr } = await supabase
          .from('messages')
          .update({ reactions })
          .eq('id', messageId);

        if (updateErr) console.error("[Chat] Error persisting reactions:", updateErr);
      } catch (err) {
        console.error("[Chat] Fatal reaction error:", err);
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
      console.log(`[Chat] Soft-delete ${messageId}`);
      let history = chatHistory.get(roomId) || [];
      const msgIdx = history.findIndex(m => m.id === messageId);
      
      if (msgIdx > -1) {
        history[msgIdx].content = "This message was deleted";
        history[msgIdx].isDeleted = true;
        history[msgIdx].type = 'text';
        history[msgIdx].fileUrl = undefined;
        chatHistory.set(roomId, history);

        io.to(roomId).emit("chat:delete_update", { 
          messageId, 
          content: "This message was deleted", 
          isDeleted: true 
        });

        try {
          await supabase.from('messages').update({ 
            content: "This message was deleted",
            type: 'text',
            file_url: null,
            is_edited: true // use this as a hack since we don't have is_deleted column
          }).eq('id', messageId);
        } catch (err) {
          console.error("[Chat] Error soft-deleting message:", err);
        }
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

    socket.on("room:kick", async ({ roomId, targetUserId }) => {
      try {
        console.log(`[Room] Kick request for ${targetUserId} in ${roomId}`);
        
        // 1. Verify requester is host
        const { data: requester, error: reqError } = await supabase
          .from('room_members')
          .select('role')
          .eq('room_id', roomId)
          .eq('user_id', socketToUser.get(socket.id)?.userId)
          .single();

        if (reqError || requester?.role !== 'host') {
          console.error("[Room] Unauthorized kick attempt");
          return;
        }

        // 2. Remove from DB
        const { error: deleteError } = await supabase
          .from('room_members')
          .delete()
          .eq('room_id', roomId)
          .eq('user_id', targetUserId);

        if (deleteError) {
          console.error("[Room] DB deletion error:", deleteError);
          return;
        }

        console.log(`[Room] User ${targetUserId} deleted from DB in ${roomId}`);

        // 3. Find all target sockets and emit kicked event
        const targetSocketEntries = Array.from(socketToUser.entries())
          .filter(([_, info]) => info.userId === targetUserId && info.roomId === roomId);

        console.log(`[Room] Found ${targetSocketEntries.length} sockets to kick for user ${targetUserId}`);

        for (const [targetSocketId, _] of targetSocketEntries) {
          const targetSocket = io.sockets.sockets.get(targetSocketId);
          if (targetSocket) {
            targetSocket.emit("room:kicked", { message: "You have been removed from the room by the host." });
            targetSocket.leave(roomId);
            console.log(`[Room] Kicked socket ${targetSocketId}`);
          }
        }

        // 4. Update everyone's member list
        const { data: allMembers, error: fetchError } = await supabase
          .from('room_members')
          .select('user_id, role, users(username, online, last_seen)')
          .eq('room_id', roomId);
        
        if (fetchError) {
          console.error("[Room] Error fetching members after kick:", fetchError);
        }

        const membersList = allMembers?.map((m: any) => ({
          userId: m.user_id,
          username: m.users?.username || 'Unknown',
          role: m.role,
          online: m.users?.online || false,
          lastSeen: m.users?.last_seen
        })) || [];

        io.to(roomId).emit("room:update", { members: membersList });
        
        // Notify others about each disconnected socket
        for (const [sid, _] of targetSocketEntries) {
          io.to(roomId).emit("user:left", { socketId: sid });
        }

      } catch (err) {
        console.error("[Room] Error kicking member:", err);
      }
    });

    socket.on("user:typing", ({ roomId, username, isTyping }) => {
      socket.to(roomId).emit("user:typing", { username, isTyping });
    });

    // WebRTC Signaling
    socket.on("call:join", ({ roomId }) => {
      if (!roomId) return console.error("[Call] Join failed: Missing roomId");
      if (!callParticipants.has(roomId)) {
        callParticipants.set(roomId, new Set());
      }
      callParticipants.get(roomId)?.add(socket.id);
      
      const participants = Array.from(callParticipants.get(roomId) || []);
      console.log(`[Call] User ${socket.id} joined call in ${roomId}. Current callers:`, participants);

      // Notify others in the call that a new person is ready to peer
      socket.to(roomId).emit("call:initiate", { from: socket.id });
      
      // Update everyone in the room about the new caller count
      io.to(roomId).emit("call:update", { participants });
    });

    socket.on("call:get_state", ({ roomId }) => {
      const participants = Array.from(callParticipants.get(roomId) || []);
      socket.emit("call:update", { participants });
    });

    socket.on("call:leave", ({ roomId }) => {
      if (!roomId) return;
      callParticipants.get(roomId)?.delete(socket.id);
      const participants = Array.from(callParticipants.get(roomId) || []);
      console.log(`[Call] User ${socket.id} left call in ${roomId}. Remaining:`, participants);
      io.to(roomId).emit("call:update", { participants });
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
          
          // Cleanup call state
          if (callParticipants.has(room)) {
            callParticipants.get(room)?.delete(socket.id);
            io.to(room).emit("call:update", { participants: Array.from(callParticipants.get(room) || []) });
          }
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
