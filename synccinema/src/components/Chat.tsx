import React, { useState, useEffect, useRef, useCallback } from 'react';
import Draggable from 'react-draggable';
import { socket } from '../lib/socket';
import { Send, Image as ImageIcon, Mic, X, MessageSquare, Check, CheckCheck, Maximize2, Minimize2, GripVertical, Smile, Edit2, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';

import { uploadToCloudinary } from '../lib/cloudinary';

interface Message {
  id: string;
  senderId: string;
  username: string;
  content: string;
  type: 'text' | 'image' | 'voice';
  timestamp: number;
  fileUrl?: string;
  replyTo?: {
    id: string;
    username: string;
    content: string;
  };
  seenBy?: string[];
  reactions?: Record<string, string[]>;
  isEdited?: boolean;
}

interface ChatProps {
  roomId: string;
  userId: string;
  username: string;
}

export const Chat: React.FC<ChatProps> = ({ roomId, userId, username }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isOpen, setIsOpen] = useState(true); // Start expanded by default
  const [isTyping, setIsTyping] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [onlineCount, setOnlineCount] = useState(1);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chatSize, setChatSize] = useState({ w: 320, h: 500 });
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  
  const isMobile = () => window.innerWidth < 768;

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draggableRef = useRef<HTMLDivElement>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const resizeStartRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  const isOpenRef = useRef(isOpen);
  useEffect(() => {
    isOpenRef.current = isOpen;
    if (isOpen) setUnreadCount(0);
  }, [isOpen]);

  // Virtual keyboard detection
  useEffect(() => {
    const vv = (window as any).visualViewport;
    if (!vv) return;
    const handler = () => {
      const offset = window.innerHeight - vv.height - vv.offsetTop;
      setKeyboardOffset(Math.max(0, offset));
    };
    vv.addEventListener('resize', handler);
    vv.addEventListener('scroll', handler);
    return () => { vv.removeEventListener('resize', handler); vv.removeEventListener('scroll', handler); };
  }, []);

  // Resize handle logic
  const startResize = useCallback((e: React.MouseEvent | React.TouchEvent, direction: string) => {
    e.preventDefault();
    e.stopPropagation();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    resizeStartRef.current = { x: clientX, y: clientY, w: chatSize.w, h: chatSize.h };

    const onMove = (ev: MouseEvent | TouchEvent) => {  
      if (!resizeStartRef.current) return;  
      const cx = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;  
      const cy = 'touches' in ev ? ev.touches[0].clientY : ev.clientY;  
      const r = resizeStartRef.current;  
      const dx = cx - r.x;  
      const dy = cy - r.y;  

      let newW = r.w;  
      let newH = r.h;  

      if (direction.includes('e')) newW = r.w + dx;  
      if (direction.includes('w')) newW = r.w - dx;  
      if (direction.includes('s')) newH = r.h + dy;  
      if (direction.includes('n')) newH = r.h - dy;  

      setChatSize({  
        w: Math.max(280, Math.min(800, newW)),  
        h: Math.max(300, Math.min(window.innerHeight * 0.9, newH))  
      });  
    };  
    const onUp = () => {  
      resizeStartRef.current = null;  
      window.removeEventListener('mousemove', onMove);  
      window.removeEventListener('touchmove', onMove);  
      window.removeEventListener('mouseup', onUp);  
      window.removeEventListener('touchend', onUp);  
    };  
    window.addEventListener('mousemove', onMove);  
    window.addEventListener('touchmove', onMove, { passive: false });  
    window.addEventListener('mouseup', onUp);  
    window.addEventListener('touchend', onUp);
  }, [chatSize]);

  // Initial History Load
  useEffect(() => {
    const fetchHistory = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true });

      if (data && !error) {  
        const history: Message[] = data.map(d => {  
          const replyRef = d.reply_to ? data.find(m => m.id === d.reply_to) : null;  
          return {  
            id: d.id,  
            senderId: d.user_id,  
            username: d.username,  
            content: d.content,  
            type: d.type as any,  
            timestamp: new Date(d.created_at).getTime(),  
            fileUrl: d.file_url,  
            replyTo: replyRef ? {  
              id: replyRef.id,  
              username: replyRef.username,  
              content: replyRef.content.substring(0, 50) + (replyRef.content.length > 50 ? '...' : '')  
            } : undefined,  
            seenBy: d.seen_by || [],  
            reactions: d.reactions || {},  
            isEdited: d.is_edited || false  
          };  
        });  
        setMessages(history);  
      }  
    };  
    fetchHistory();
  }, [roomId]);

  useEffect(() => {
    socket.on('chat:history', (serverHistory: Message[]) => {
      setMessages(prev => {
        const merged = [...prev, ...serverHistory];
        return Array.from(new Map(merged.map(item => [item.id, item])).values())
          .sort((a, b) => a.timestamp - b.timestamp);
      });
    });

    socket.on('chat:message', (msg: Message) => {  
      setMessages(prev => {  
        if (prev.some(m => m.id === msg.id)) return prev;  
        return [...prev, msg];  
      });  

      if (!isOpenRef.current && msg.senderId !== userId) {  
        setUnreadCount(prev => prev + 1);  
        try {  
          const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');  
          audio.volume = 0.5;  
          audio.play().catch(() => { });  
        } catch (e) { }  
      }  
    });  

    socket.on('chat:react_update', ({ messageId, reactions }) => {  
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));  
    });  

    socket.on('chat:edit_update', ({ messageId, newContent, isEdited }) => {  
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, content: newContent, isEdited } : m));  
    });  

    socket.on('chat:delete_update', ({ messageId }) => {  
      setMessages(prev => prev.filter(m => m.id !== messageId));  
    });  

    socket.on('chat:seen_update', ({ messageId, seenBy }) => {  
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, seenBy } : m));  
    });  

    socket.on('user:typing', ({ username: typingUser, isTyping: typing }) => {  
      setTypingUsers(prev => {  
        const next = new Set(prev);  
        if (typing) next.add(typingUser);  
        else next.delete(typingUser);  
        return next;  
      });  
    });  

    socket.on('room:update', (data) => {  
      if (data.members) {  
        setOnlineCount(data.members.length);  
      }  
    });  

    return () => {  
      socket.off('chat:history');  
      socket.off('chat:message');  
      socket.off('chat:seen_update');  
      socket.off('user:typing');  
      socket.off('room:update');  
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() && !replyTo) return;

    const message: Message = {  
      id: Math.random().toString(36).substr(2, 9),  
      senderId: userId,  
      username,  
      content: input,  
      type: 'text',  
      timestamp: Date.now(),  
      replyTo: replyTo ? {  
        id: replyTo.id,  
        username: replyTo.username,  
        content: replyTo.content.substring(0, 50) + (replyTo.content.length > 50 ? '...' : '')  
      } : undefined  
    };  

    socket.emit('chat:send', { roomId, message });  
    setInput('');  
    setReplyTo(null);  
    handleTyping(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {  
      setIsUploading(true);  
      const { uploadToCloudinary } = await import('../lib/cloudinary');  
      const url = await uploadToCloudinary(file, 'image');  

      const message: Message = {  
        id: Math.random().toString(36).substr(2, 9),  
        senderId: userId,  
        username,  
        content: 'Sent an image',  
        type: 'image',  
        fileUrl: url,  
        timestamp: Date.now(),  
      };  

      socket.emit('chat:send', { roomId, message });  
    } catch (error) {  
      console.error('Upload failed:', error);  
    } finally {  
      setIsUploading(false);  
      if (fileInputRef.current) fileInputRef.current.value = '';  
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];

      mediaRecorder.current.ondataavailable = (e) => {  
        audioChunks.current.push(e.data);  
      };  

      mediaRecorder.current.onstop = async () => {  
        const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });  

        try {  
          setIsUploading(true);  
          const { uploadToCloudinary } = await import('../lib/cloudinary');  
          const url = await uploadToCloudinary(audioBlob, 'video');  

          const message: Message = {  
            id: Math.random().toString(36).substr(2, 9),  
            senderId: userId,  
            username,  
            content: 'Voice message',  
            type: 'voice',  
            fileUrl: url,  
            timestamp: Date.now(),  
          };  

          socket.emit('chat:send', { roomId, message });  
        } catch (err) {  
          console.error('Voice upload failed:', err);  
        } finally {  
          setIsUploading(false);  
        }  
      };  

      mediaRecorder.current.start();  
      setIsRecording(true);  
    } catch (err) {  
      console.error('Could not start recording:', err);  
    }
  };

  const stopRecording = () => {
    mediaRecorder.current?.stop();
    setIsRecording(false);
    mediaRecorder.current?.stream.getTracks().forEach(track => track.stop());
  };

  const handleTyping = (typing: boolean) => {
    if (isTyping !== typing) {
      setIsTyping(typing);
      socket.emit('user:typing', { roomId, username, isTyping: typing });
    }
  };

  // Handle close button with proper event handling for mobile
  const handleClose = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(false);
  }, []);

  // Handle open button
  const handleOpen = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(true);
  }, []);

  // Handle fullscreen toggle
  const handleFullscreenToggle = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsFullscreen(prev => !prev);
  }, []);

  const MessageItem = ({ msg }: { msg: Message }) => {
    const itemRef = useRef<HTMLDivElement>(null);

    useEffect(() => {  
      if (msg.senderId === userId) return;  

      const observer = new IntersectionObserver(([entry]) => {  
        if (entry.isIntersecting) {  
          socket.emit('chat:seen', { roomId, messageId: msg.id, userId });  
          observer.disconnect();  
        }  
      }, { threshold: 1.0 });  

      if (itemRef.current) observer.observe(itemRef.current);  
      return () => observer.disconnect();  
    }, [msg.id]);  

    const handleReact = (emoji: string) => {  
      socket.emit('chat:react', { roomId, messageId: msg.id, emoji, userId });  
      setShowReactions(false);  
    };  

    const handleDelete = () => {  
      if (confirm('Delete this message?')) {  
        socket.emit('chat:delete', { roomId, messageId: msg.id });  
      }  
    };  

    const startEdit = () => {  
      setEditingMessageId(msg.id);  
      setEditContent(msg.content);  
    };  

    const saveEdit = (e: React.FormEvent) => {  
      e.preventDefault();  
      if (editContent.trim() && editContent !== msg.content) {  
        socket.emit('chat:edit', { roomId, messageId: msg.id, newContent: editContent });  
      }  
      setEditingMessageId(null);  
    };  

    const [showReactions, setShowReactions] = useState(false);  
    const [showActions, setShowActions] = useState(false);  
    const timeoutRef = useRef<any>(null);  

    const handlePressStart = () => {  
      if (timeoutRef.current) clearTimeout(timeoutRef.current);  
      timeoutRef.current = setTimeout(() => {  
        setShowActions(true);  
        if (window.navigator.vibrate) window.navigator.vibrate(40);  
      }, 500);  
    };  

    const handlePressEnd = () => {  
      if (timeoutRef.current) clearTimeout(timeoutRef.current);  
    };  

    useEffect(() => {  
      if (!showActions && !showReactions) return;  
      const handler = () => {  
        setShowActions(false);  
        setShowReactions(false);  
      };  
      window.addEventListener('mousedown', handler);  
      window.addEventListener('touchstart', handler);  
      return () => {  
        window.removeEventListener('mousedown', handler);  
        window.removeEventListener('touchstart', handler);  
      };  
    }, [showActions, showReactions]);  

    return (  
      <div  
        ref={itemRef}  
        onMouseDown={handlePressStart}  
        onMouseUp={handlePressEnd}  
        onMouseLeave={handlePressEnd}  
        onTouchStart={handlePressStart}  
        onTouchEnd={handlePressEnd}  
        className={cn(  
          "flex flex-col max-w-[90%] group relative mb-2 select-none",  
          msg.senderId === userId ? "ml-auto items-end" : "items-start"  
        )}  
        onDoubleClick={() => setReplyTo(msg)}  
      >  
        <div className="flex items-center gap-2 mb-1 px-1">  
          <span className="text-[10px] opacity-40">{msg.username} • {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>  
          {msg.isEdited && <span className="text-[9px] opacity-30 italic">(edited)</span>}  
        </div>  

        {msg.replyTo && (  
          <div className="text-[10px] bg-white/5 border-l-2 border-emerald-500 p-1 mb-1 rounded opacity-60 truncate w-full max-w-[200px]">  
            <span className="font-bold">{msg.replyTo.username}:</span> {msg.replyTo.content}  
          </div>  
        )}  

        <div className="relative group/bubble flex items-center gap-2">  
          <AnimatePresence>  
            {showActions && (  
              <motion.div  
                initial={{ opacity: 0, scale: 0.9, y: 10 }}  
                animate={{ opacity: 1, scale: 1, y: 0 }}  
                exit={{ opacity: 0, scale: 0.9, y: 10 }}  
                className={cn(  
                  "no-drag absolute -top-12 z-[70] bg-zinc-900 border border-white/10 rounded-2xl p-1 flex items-center gap-1 shadow-2xl backdrop-blur-2xl",  
                  msg.senderId === userId ? "right-2" : "left-2"  
                )}  
                onClick={(e) => e.stopPropagation()}  
              >  
                <button  
                  onClick={() => { setShowReactions(true); setShowActions(false); }}  
                  className="p-2 hover:bg-white/10 rounded-xl text-zinc-300 hover:text-white transition-colors"  
                >  
                  <Smile className="w-4 h-4" />  
                </button>  
                {msg.senderId === userId && (  
                  <>  
                    <button  
                      onClick={() => { startEdit(); setShowActions(false); }}  
                      className="p-2 hover:bg-white/10 rounded-xl text-zinc-300 hover:text-white transition-colors"  
                    >  
                      <Edit2 className="w-4 h-4" />  
                    </button>  
                    <button  
                      onClick={() => { handleDelete(); setShowActions(false); }}  
                      className="p-2 hover:bg-white/10 rounded-xl text-zinc-300 hover:text-red-500 transition-colors"  
                    >  
                      <Trash2 className="w-4 h-4" />  
                    </button>  
                  </>  
                )}  
              </motion.div>  
            )}  
          </AnimatePresence>  

          <div className={cn(  
            "px-3 py-2 rounded-2xl text-sm overflow-hidden backdrop-blur-sm shadow-sm transition-transform active:scale-95",  
            msg.senderId === userId  
              ? "bg-emerald-600/80 text-white rounded-tr-none"  
              : "bg-white/10 text-white rounded-tl-none border border-white/5"  
          )}>  
            {editingMessageId === msg.id ? (  
              <form onSubmit={saveEdit} className="no-drag flex flex-col gap-2 min-w-[180px]">  
                <textarea  
                  value={editContent}  
                  onChange={(e) => setEditContent(e.target.value)}  
                  className="bg-black/20 border border-white/10 rounded-lg p-2 text-sm outline-none focus:border-emerald-500/50 resize-none text-white"  
                  rows={2}  
                  autoFocus  
                />  
                <div className="flex justify-end gap-2">  
                  <button type="button" onClick={() => setEditingMessageId(null)} className="text-[10px] hover:underline">Cancel</button>  
                  <button type="submit" className="text-[10px] text-emerald-500 font-bold hover:underline">Save</button>  
                </div>  
              </form>  
            ) : msg.type === 'image' ? (  
              <img src={msg.fileUrl} alt="Shared" className="max-w-full rounded-lg" />  
            ) : msg.type === 'voice' ? (  
              <audio src={msg.fileUrl} controls className="h-8 w-40 filter invert" />  
            ) : (  
              msg.content  
            )}  
          </div>  

          <AnimatePresence>  
            {showReactions && (  
              <motion.div  
                initial={{ scale: 0.8, opacity: 0, y: 10 }}  
                animate={{ scale: 1, opacity: 1, y: 0 }}  
                exit={{ scale: 0.8, opacity: 0, y: 10 }}  
                className={cn(  
                  "no-drag absolute -top-10 z-[80] bg-zinc-900 border border-white/10 rounded-full px-2 py-1 flex gap-2 shadow-2xl backdrop-blur-xl",  
                  msg.senderId === userId ? "right-2" : "left-2"  
                )}  
              >  
                {['❤️', '😂', '😮', '😢', '🔥', '👍'].map(emoji => (  
                  <button key={emoji} onClick={(e) => { e.stopPropagation(); handleReact(emoji); }} className="hover:scale-125 transition-transform text-xs p-1">{emoji}</button>  
                ))}  
              </motion.div>  
            )}  
          </AnimatePresence>  
        </div>  

        {msg.reactions && Object.keys(msg.reactions).length > 0 && (  
          <div className="flex flex-wrap gap-1 px-1 -mt-1.5 z-10 relative">  
            {Object.entries(msg.reactions).map(([emoji, users]) => (  
              <button  
                key={emoji}  
                onClick={(e) => { e.stopPropagation(); handleReact(emoji); }}  
                className={cn(  
                  "flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] transition-all no-drag hover:scale-110 active:scale-95",  
                  users.includes(userId) ? "bg-emerald-500/80 border border-emerald-400 text-white shadow-lg" : "bg-zinc-800/90 backdrop-blur-md border border-white/10 text-zinc-300 hover:bg-zinc-700"  
                )}  
              >  
                <span>{emoji}</span>  
                <span className="opacity-60">{users.length}</span>  
              </button>  
            ))}  
          </div>  
        )}  

        {msg.senderId === userId && (  
          <div className="flex justify-end mt-1 mr-1">  
            {msg.seenBy && msg.seenBy.length > 0 ? (  
              <CheckCheck className="w-3.5 h-3.5 text-blue-500" />  
            ) : (  
              <Check className="w-3.5 h-3.5 text-zinc-500" />  
            )}  
          </div>  
        )}  
      </div>  
    );
  };

  return (
    <>
      {/* Fullscreen backdrop */}
      {isFullscreen && <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setIsFullscreen(false)} />}

      <Draggable  
        nodeRef={draggableRef}  
        cancel=".no-drag, .drag-cancel, button, input, textarea, [role='button'], .react-draggable-cancel"  
        disabled={isFullscreen}  
        onStart={() => setIsDragging(true)}  
        onStop={() => setIsDragging(false)}  
      >  
        <div  
          ref={draggableRef}  
          className={cn(  
            "fixed z-50 flex flex-col",  
            !isDragging && "transition-all duration-200",  
            isFullscreen  
              ? "inset-2 sm:inset-4"  
              : isOpen  
                ? "bottom-4 right-4"  
                : "bottom-4 right-4 w-14 h-14"  
          )}  
          style={isFullscreen || !isOpen ? undefined : {  
            width: isMobile() ? `calc(100vw - 2rem)` : `${chatSize.w}px`,  
            bottom: keyboardOffset > 0 ? `${keyboardOffset + 8}px` : undefined,  
          }}  
        >  
          <AnimatePresence mode="wait">
            {isOpen ? (  
              <motion.div  
                key="chat-open"
                initial={{ opacity: 0, scale: 0.9, y: 20 }}  
                animate={{ opacity: 1, scale: 1, y: 0 }}  
                exit={{ opacity: 0, scale: 0.9, y: 20 }}  
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="bg-black/40 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)] flex flex-col group/chat relative overflow-hidden"  
                style={{ height: isFullscreen ? '100%' : isMobile() ? '70vh' : `${chatSize.h}px` }}  
              >  
                {/* 8-Directional Resize Handles */}  
                {!isMobile() && !isFullscreen && (  
                  <>  
                    <div onMouseDown={(e) => startResize(e, 'n')} className="absolute top-0 inset-x-4 h-1 cursor-ns-resize z-50" />  
                    <div onMouseDown={(e) => startResize(e, 's')} className="absolute bottom-0 inset-x-4 h-1 cursor-ns-resize z-50" />  
                    <div onMouseDown={(e) => startResize(e, 'e')} className="absolute right-0 inset-y-4 w-1 cursor-ew-resize z-50" />  
                    <div onMouseDown={(e) => startResize(e, 'w')} className="absolute left-0 inset-y-4 w-1 cursor-ew-resize z-50" />  
                    <div onMouseDown={(e) => startResize(e, 'nw')} className="absolute top-0 left-0 w-4 h-4 cursor-nw-resize z-50" />  
                    <div onMouseDown={(e) => startResize(e, 'ne')} className="absolute top-0 right-0 w-4 h-4 cursor-ne-resize z-50" />  
                    <div onMouseDown={(e) => startResize(e, 'sw')} className="absolute bottom-0 left-0 w-4 h-4 cursor-sw-resize z-50" />  
                    <div onMouseDown={(e) => startResize(e, 'se')} className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-50" />  
                  </>  
                )}  

                {/* Header - all interactive buttons have drag-cancel class */}  
                <div   
                  ref={headerRef}  
                  className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-white/5 shrink-0"  
                >  
                  <div className="flex items-center gap-3 cursor-move drag-handle">  
                    <MessageSquare className="w-4 h-4 text-emerald-500" />  
                    <div className="flex flex-col">  
                      <span className="font-semibold text-sm leading-tight">Room Chat</span>  
                      <span className="text-[10px] text-emerald-500 font-medium leading-tight">{onlineCount} Online</span>  
                    </div>  
                  </div>  
                  <div className="flex items-center gap-1">  
                    <button  
                      onClick={handleFullscreenToggle}  
                      onTouchEnd={handleFullscreenToggle}
                      type="button"
                      className="drag-cancel p-1.5 hover:bg-white/10 rounded-lg transition-colors active:bg-white/20"  
                      title={isFullscreen ? 'Minimize' : 'Fullscreen'}  
                    >  
                      {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}  
                    </button>  
                    <button   
                      onClick={handleClose}  
                      onTouchEnd={handleClose}
                      type="button"
                      className="drag-cancel p-1.5 hover:bg-white/10 rounded-lg transition-colors active:bg-white/20"  
                    >  
                      <X className="w-3.5 h-3.5" />  
                    </button>  
                  </div>  
                </div>  

                <div ref={scrollRef} className="no-drag flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-white/10">  
                  {messages.map((msg) => (  
                    <MessageItem key={msg.id} msg={msg} />  
                  ))}  
                  {typingUsers.size > 0 && (  
                    <div className="text-[10px] italic opacity-40 animate-pulse">  
                      {Array.from(typingUsers).join(', ')} typing...  
                    </div>  
                  )}  
                </div>  

                {replyTo && (  
                  <div className="drag-cancel px-4 py-2 bg-emerald-500/10 border-t border-emerald-500/20 flex items-center justify-between">  
                    <div className="text-[10px] truncate">  
                      Replying to <span className="font-bold">{replyTo.username}</span>  
                    </div>  
                    <button onClick={() => setReplyTo(null)} type="button" className="drag-cancel p-1 hover:bg-white/10 rounded"><X className="w-3 h-3" /></button>  
                  </div>  
                )}  

                <form onSubmit={sendMessage} className="no-drag p-4 bg-white/5 border-t border-white/10">  
                  <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" className="hidden" />  
                  <div className="flex items-center gap-2 bg-black/40 rounded-xl px-3 py-2 border border-white/5 focus-within:border-emerald-500/50 transition-colors">  
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="drag-cancel p-1 hover:text-emerald-500">  
                      <ImageIcon className="w-4 h-4" />  
                    </button>  
                    <button  
                      type="button"  
                      onMouseDown={startRecording}  
                      onMouseUp={stopRecording}  
                      onMouseLeave={isRecording ? stopRecording : undefined}  
                      onTouchStart={startRecording}  
                      onTouchEnd={stopRecording}  
                      className={cn("drag-cancel p-1 transition-colors", isRecording ? "text-red-500 animate-pulse" : "hover:text-emerald-500")}  
                    >  
                      <Mic className="w-4 h-4" />  
                    </button>  
                    <input  
                      value={input}  
                      onChange={(e) => { setInput(e.target.value); handleTyping(true); }}  
                      onBlur={() => handleTyping(false)}  
                      placeholder={isRecording ? "Recording..." : "Type a message..."}  
                      className="flex-1 bg-transparent outline-none text-sm"  
                      disabled={isRecording}  
                    />  
                    <button type="submit" className="drag-cancel p-1 text-emerald-500">  
                      <Send className="w-4 h-4" />  
                    </button>  
                  </div>  
                </form>  
              </motion.div>  
            ) : (  
              <motion.button
                key="chat-closed"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ type: "spring", damping: 20 }}
                onClick={handleOpen}  
                onTouchEnd={handleOpen}
                type="button"
                className="drag-cancel w-14 h-14 bg-emerald-600 rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-transform relative"  
              >  
                <MessageSquare className="w-6 h-6 text-white" />  
                {unreadCount > 0 && (  
                  <span className="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 bg-red-500 rounded-full text-[10px] font-bold text-white shadow-lg border-2 border-[#050505] animate-bounce">  
                    {unreadCount}  
                  </span>  
                )}  
              </motion.button>  
            )}  
          </AnimatePresence>  
        </div>  
      </Draggable>  
    </>
  );
};
