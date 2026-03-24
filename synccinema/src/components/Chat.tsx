import React, { useState, useEffect, useRef, useCallback } from 'react';
import Draggable from 'react-draggable';
import { socket } from '../lib/socket';
import { Send, Image as ImageIcon, Mic, X, MessageSquare, Check, CheckCheck, Maximize2, Minimize2, GripVertical, Smile, Edit2, Trash2, Play, Pause } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { uploadToCloudinary } from '../lib/cloudinary';
import { useVirtualizer } from '@tanstack/react-virtual';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import debounce from 'lodash/debounce';

const VoiceMessage = ({ url }: { url: string }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0);
    const onEnded = () => { setIsPlaying(false); setProgress(0); };
    const onLoadedMetadata = () => setDuration(audio.duration);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, []);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (audioRef.current) {
      if (isPlaying) audioRef.current.pause();
      else audioRef.current.play();
      setIsPlaying(!isPlaying);
    }
  };

  const formatDuration = (secs: number) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const currentT = audioRef.current?.currentTime || 0;

  return (
    <div className="flex items-center gap-3 bg-black/20 rounded-full py-2 px-3 min-w-[180px]">
      <button onClick={togglePlay} className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-md hover:scale-105 transition-transform shrink-0">
        {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
      </button>
      <div className="flex-1 flex flex-col gap-1 justify-center">
        <div className="h-1.5 bg-black/40 rounded-full overflow-hidden relative cursor-pointer group" onClick={(e) => {
          e.stopPropagation();
          if (!audioRef.current || !duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          audioRef.current.currentTime = p * duration;
          setProgress(p * 100);
        }}>
          <div className="absolute top-0 left-0 h-full bg-emerald-500 rounded-full transition-all group-hover:bg-emerald-400" style={{ width: `${progress}%` }} />
        </div>
        <div className="text-[10px] opacity-70 font-mono flex justify-between tracking-tight">
          <span>{formatDuration(currentT)}</span>
          <span>{formatDuration(duration)}</span>
        </div>
      </div>
      <audio ref={audioRef} src={url} preload="metadata" className="hidden" />
    </div>
  );
};

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
  tempId?: string;
}

interface ChatProps {
  roomId: string;
  userId: string;
  username: string;
  isRoomFullscreen?: boolean;
}

export const Chat: React.FC<ChatProps> = ({ roomId, userId, username, isRoomFullscreen }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isOpen, setIsOpen] = useState(false);
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
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const isMobile = () => window.innerWidth < 768;
  const [mobile, setMobile] = React.useState(() => window.innerWidth < 768);

  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draggableRef = useRef<HTMLDivElement>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const resizeStartRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  const isOpenRef = useRef(isOpen);
  useEffect(() => {
    isOpenRef.current = isOpen;
    if (isOpen) setUnreadCount(0);
  }, [isOpen]);

  // Virtual keyboard detection
  useEffect(() => {
    const vv = (window as any).visualViewport;
    if (!vv) return;
    const handler = debounce(() => {
      const offset = window.innerHeight - vv.height - vv.offsetTop;
      setKeyboardOffset(Math.max(0, offset));
    }, 100);
    vv.addEventListener('resize', handler);
    vv.addEventListener('scroll', handler);
    return () => {
      vv.removeEventListener('resize', handler);
      vv.removeEventListener('scroll', handler);
      handler.cancel();
    };
  }, []);

  // Resize handle logic
  const startResize = useCallback((e: React.MouseEvent | React.TouchEvent, direction: string) => {
    e.stopPropagation();

    if (isRoomFullscreen) {
      if (direction !== 'w') return;
    } else {
      // Allow only north ('n') resize on mobile to act as a bottom sheet puller
      if (mobile && direction !== 'n') return;
    }

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    resizeStartRef.current = { x: clientX, y: clientY, w: chatSize.w, h: chatSize.h };

    const onMove = (ev: MouseEvent | TouchEvent) => {
      if (!resizeStartRef.current) return;
      // Prevent browser scroll takeover during active drag
      if ('touches' in ev && ev.cancelable) ev.preventDefault();
      
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
        w: Math.max(280, Math.min(mobile || isRoomFullscreen ? window.innerWidth * 0.8 : 800, newW)),
        h: Math.max(300, Math.min(mobile ? window.innerHeight - 50 : window.innerHeight * 0.9, newH))
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
  }, [chatSize, mobile]);

  // Initial History Load
  useEffect(() => {
    const fetchHistory = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[Chat] History fetch error:', error);
        return;
      }

      if (data) {
        const history = data.map((d: any) => {
          // Find the reply relative to the full history
          const replyRef = data.find((m: any) => m.id === d.reply_to);
          return {
            id: d.id,
            senderId: d.sender_id,
            username: d.users?.username || 'User',
            content: d.content,
            type: d.type || 'text',
            fileUrl: d.file_url,
            timestamp: new Date(d.created_at).getTime(),
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
      } else {
        console.warn('[Chat] No history found for room:', roomId);
      }
    };
    fetchHistory();
  }, [roomId, supabase]);

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
        // If we receive a message that corresponds to one of our optimistic updates
        if (msg.tempId) {
          const index = prev.findIndex(m => m.id === msg.tempId);
          if (index !== -1) {
            const newMessages = [...prev];
            newMessages[index] = msg;
            return newMessages;
          }
        }

        // Final check to avoid duplicates by UUID
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

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 70,
    overscan: 10,
  });

  useEffect(() => {
    if (isOpen && messages.length > 0) {
      setTimeout(() => {
        rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
      }, 50);
    }
  }, [messages.length, isOpen, rowVirtualizer]);

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
          const url = await uploadToCloudinary(audioBlob, 'video'); // Cloudinary treats audio as video resource-type usually or auto

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

  const handleCloseChat = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(false);
  };

  const MessageItem: React.FC<{ msg: Message }> = ({ msg }) => {
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
          "flex flex-col max-w-[90%] group relative select-none",
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
              <div
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
              </div>
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
              <img
                src={msg.fileUrl}
                alt="Shared"
                className="max-w-full rounded-lg cursor-zoom-in hover:opacity-90 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  setFullscreenImage(msg.fileUrl!);
                }}
              />
            ) : msg.type === 'voice' ? (
              <VoiceMessage url={msg.fileUrl!} />
            ) : (
              msg.content
            )}
          </div>

          <AnimatePresence>
            {showReactions && (
              <div
                className={cn(
                  "no-drag absolute -top-10 z-[80] bg-zinc-900 border border-white/10 rounded-full px-2 py-1 flex gap-2 shadow-2xl backdrop-blur-xl",
                  msg.senderId === userId ? "right-2" : "left-2"
                )}
              >
                {['❤️', '😂', '😮', '😢', '🔥', '👍'].map(emoji => (
                  <button key={emoji} onClick={(e) => { e.stopPropagation(); handleReact(emoji); }} className="hover:scale-125 transition-transform text-xs p-1">{emoji}</button>
                ))}
              </div>
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

      {/* Img Viewer Backdrop */}
      <AnimatePresence>
        {fullscreenImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4 cursor-zoom-out"
            onClick={() => setFullscreenImage(null)}
          >
            <motion.img
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              src={fullscreenImage}
              alt="Fullscreen"
              className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <Draggable
        nodeRef={draggableRef}
        cancel=".no-drag, .chat-header-buttons button"
        disabled={isFullscreen || (mobile && !isRoomFullscreen) || (isRoomFullscreen && isOpen)}
        onStart={() => setIsDragging(true)}
        onStop={() => setIsDragging(false)}
      >
        <div
          ref={draggableRef}
          className={cn(
            "z-50 flex flex-col",
            isRoomFullscreen && isOpen ? "justify-start !transform-none" : "justify-end",
            !isDragging && "transition-all duration-200",
            isFullscreen
              ? "fixed inset-2 sm:inset-4"
              : isRoomFullscreen
                ? isOpen
                  ? "relative flex-shrink-0 h-full right-0"
                  : "fixed bottom-4 right-4 w-14 h-14 cursor-move"
                : isOpen
                  ? (mobile ? "fixed inset-x-0 top-0 !transform-none" : "fixed bottom-4 right-4")
                  : "fixed bottom-4 right-4 w-14 h-14"
          )}
          style={isFullscreen || !isOpen ? undefined : {
            width: isRoomFullscreen ? `${chatSize.w}px` : (mobile ? undefined : `${chatSize.w}px`),
            bottom: isRoomFullscreen ? undefined : (mobile ? `${keyboardOffset}px` : (keyboardOffset > 0 && !isRoomFullscreen ? `${keyboardOffset + 8}px` : undefined))
          }}
        >
          <AnimatePresence>
            {isOpen ? (
              <motion.div
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 40 }}
                transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                className={cn(
                  "border border-white/10 shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)] flex flex-col group/chat relative overflow-hidden",
                  isRoomFullscreen ? "bg-black/95 backdrop-blur-3xl rounded-none border-y-0" : mobile ? "bg-black/30 backdrop-blur-xl rounded-t-3xl border-b-0" : "bg-black/50 backdrop-blur-2xl rounded-3xl"
                )}
                style={{ height: isRoomFullscreen ? (mobile ? `calc(100vh - ${keyboardOffset}px)` : '100%') : isFullscreen ? '100%' : mobile ? (keyboardOffset > 0 ? `min(100vh, calc(100vh - ${keyboardOffset}px))` : `${chatSize.h}px`) : `${chatSize.h}px`, width: '100%' }}
              >
                {/* Fullscreen Resizer */}
                {isRoomFullscreen && isOpen && (
                  <div
                    onTouchStart={(e) => startResize(e, 'w')}
                    onMouseDown={(e) => startResize(e, 'w')}
                    className="absolute -left-4 inset-y-0 w-8 flex items-center justify-center cursor-ew-resize z-[200] touch-none group/resizer"
                  >
                    <div className="h-12 w-1.5 bg-white/20 group-hover/resizer:bg-white/60 transition-colors rounded-full" />
                  </div>
                )}

                {/* Mobile Top Drag Handle for Resizing */}
                {mobile && !isFullscreen && !isRoomFullscreen && (
                  <div
                    onTouchStart={(e) => startResize(e, 'n')}
                    onMouseDown={(e) => startResize(e, 'n')}
                    className="absolute top-0 inset-x-0 h-6 flex items-center justify-center cursor-ns-resize z-50 pt-1 touch-none"
                  >
                    <div className="w-12 h-1 bg-white/40 rounded-full" />
                  </div>
                )}
                {/* 8-Directional Resize Handles - Only show on desktop */}
                {!isFullscreen && !mobile && !isRoomFullscreen && (
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

                {/* Header */}
                <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-white/5 shrink-0">
                  <div className="flex items-center gap-3 cursor-move">
                    <MessageSquare className="w-4 h-4 text-emerald-500" />
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm leading-tight">Room Chat</span>
                      <span className="text-[10px] text-emerald-500 font-medium leading-tight">{onlineCount} Online</span>
                    </div>
                  </div>
                  <div className="chat-header-buttons flex items-center gap-1">

                    <button
                      onClick={handleCloseChat}
                      onTouchEnd={handleCloseChat}
                      className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                      title="Close chat"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div ref={scrollRef} className="no-drag flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-white/10 relative">
                  <div
                    style={{
                      height: `${rowVirtualizer.getTotalSize()}px`,
                      width: '100%',
                      position: 'relative',
                    }}
                  >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const msg = messages[virtualRow.index];
                      return (
                        <div
                          key={msg.id}
                          data-index={virtualRow.index}
                          ref={rowVirtualizer.measureElement}
                          className="absolute top-0 left-0 w-full"
                          style={{
                            transform: `translateY(${virtualRow.start}px)`,
                            paddingBottom: '8px'
                          }}
                        >
                          <MessageItem msg={msg} />
                        </div>
                      )
                    })}
                  </div>
                  {typingUsers.size > 0 && (
                    <div className="text-[10px] italic opacity-40 animate-pulse mt-2">
                      {Array.from(typingUsers).join(', ')} typing...
                    </div>
                  )}
                </div>

                {replyTo && (
                  <div className="px-4 py-2 bg-emerald-500/10 border-t border-emerald-500/20 flex items-center justify-between">
                    <div className="text-[10px] truncate">
                      Replying to <span className="font-bold">{replyTo.username}</span>
                    </div>
                    <button onClick={() => setReplyTo(null)}><X className="w-3 h-3" /></button>
                  </div>
                )}

                <form onSubmit={sendMessage} className="no-drag p-4 bg-white/5 border-t border-white/10 relative shrink-0">
                  <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" className="hidden" />

                  <AnimatePresence>
                    {showEmojiPicker && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="absolute bottom-full right-4 mb-2 z-[100] drop-shadow-2xl"
                      >
                        <EmojiPicker
                          theme={Theme.DARK}
                          onEmojiClick={(emojiData) => setInput(prev => prev + emojiData.emoji)}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="flex items-center gap-2 bg-black/40 rounded-xl px-3 py-2 border border-white/5 focus-within:border-emerald-500/50 transition-colors">
                    <button type="button" onClick={() => setShowEmojiPicker(p => !p)} className={cn("p-1 transition-colors", showEmojiPicker ? "text-emerald-500" : "hover:text-emerald-500")}>
                      <Smile className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="p-1 hover:text-emerald-500">
                      <ImageIcon className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onMouseDown={startRecording}
                      onMouseUp={stopRecording}
                      onMouseLeave={isRecording ? stopRecording : undefined}
                      onTouchStart={startRecording}
                      onTouchEnd={stopRecording}
                      className={cn("p-1 transition-colors", isRecording ? "text-red-500 animate-pulse" : "hover:text-emerald-500")}
                    >
                      <Mic className="w-4 h-4" />
                    </button>
                    <input
                      value={input}
                      onChange={(e) => { setInput(e.target.value); handleTyping(true); }}
                      onBlur={() => handleTyping(false)}
                      placeholder={isRecording ? "Recording..." : "Type a message..."}
                      className="flex-1 bg-transparent outline-none text-sm w-full"
                      disabled={isRecording}
                    />
                    <button type="submit" className="p-1 text-emerald-500">
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              </motion.div>
            ) : (
              <button
                onClick={() => { if (!isDragging) setIsOpen(true); }}
                onTouchEnd={(e) => {
                  if (!isDragging) {
                    e.preventDefault();
                    setIsOpen(true);
                  }
                }}
                className="w-14 h-14 bg-emerald-600 rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-transform relative"
              >
                <MessageSquare className="w-6 h-6 text-white" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 bg-red-500 rounded-full text-[10px] font-bold text-white shadow-lg border-2 border-[#050505] animate-bounce">
                    {unreadCount}
                  </span>
                )}
              </button>
            )}
          </AnimatePresence>
        </div>
      </Draggable>
    </>
  );
};