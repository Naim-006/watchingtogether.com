import React, { useState, useEffect, useRef, useCallback } from 'react';
import Draggable from 'react-draggable';
import { socket } from '../lib/socket';
import { Send, Image as ImageIcon, Mic, X, MessageSquare, Check, CheckCheck, Maximize2, Minimize2, GripVertical, Smile, Edit2, Trash2, Play, Pause, MoreVertical, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { uploadToCloudinary } from '../lib/cloudinary';
import { useVirtualizer } from '@tanstack/react-virtual';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import debounce from 'lodash/debounce';
import { useAlert } from './AlertProvider';

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
  isDeleted?: boolean;
  tempId?: string;
}

interface ChatProps {
  roomId: string;
  userId: string;
  username: string;
  isRoomFullscreen?: boolean;
}

const VirtualKeyboard: React.FC<{
  onKey: (k: string) => void;
  onBackspace: () => void;
  onEnter: () => void;
  onHide: () => void;
  height: number;
  onResize: (e: React.MouseEvent | React.TouchEvent) => void;
  className?: string;
}> = ({ onKey, onBackspace, onEnter, onHide, height, onResize, className }) => {
  const [layout, setLayout] = useState<'alpha' | 'symbols'>('alpha');
  const [isShift, setIsShift] = useState(false);

  const keys = {
    alpha: [
      ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
      ['Shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '⌫'],
      ['?123', 'Space', 'Done']
    ],
    symbols: [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
      ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
      ['.', ',', '?', '!', "'", '#', '%', '^', '⌫'],
      ['ABC', 'Space', 'Done']
    ]
  };

  const handleKey = (key: string) => {
    if (key === 'Shift') {
      setIsShift(!isShift);
    } else if (key === '⌫') {
      onBackspace();
    } else if (key === 'Space') {
      onKey(' ');
    } else if (key === 'Done' || key === 'Enter') {
      onEnter();
      onHide();
    } else if (key === '?123') {
      setLayout('symbols');
    } else if (key === 'ABC') {
      setLayout('alpha');
    } else {
      onKey(isShift ? key.toUpperCase() : key.toLowerCase());
      if (isShift) setIsShift(false);
    }
  };

  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 20, opacity: 0 }}
      className={cn("bg-black/80 backdrop-blur-3xl border-t border-white/10 select-none no-drag touch-none flex flex-col", className)}
      style={{ height: `${height}px` }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Keyboard Resize Handle */}
      <div
        onMouseDown={onResize}
        onTouchStart={onResize}
        className="h-4 w-full flex items-center justify-center cursor-ns-resize group/kb-handle active:bg-white/5 shrink-0 touch-none"
      >
        <div className="w-12 h-0.5 bg-white/20 group-hover/kb-handle:bg-white/40 rounded-full transition-colors" />
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        <div className="flex flex-col gap-1 max-w-xl mx-auto py-1">
          {keys[layout].map((row, i) => (
            <div key={i} className="flex justify-center gap-1">
              {row.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleKey(key)}
                  className={cn(
                    "h-8 rounded-lg flex items-center justify-center font-medium transition-all active:scale-95 active:bg-white/20 shadow-sm",
                    key === 'Space' ? "flex-[4] bg-white/10" :
                      (key === 'Shift' || key === '⌫' || key === 'Done' || key === '?123' || key === 'ABC') ? "flex-[1.5] bg-white/5 text-[10px] uppercase font-bold" :
                        "flex-1 bg-white/10 hover:bg-white/20 text-xs"
                  )}
                >
                  {key === 'Shift' ? (isShift ? '⬆' : '⇧') : (isShift && key.length === 1 ? key.toUpperCase() : key)}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
};

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
  const [showVirtualKeyboard, setShowVirtualKeyboard] = useState(false);
  const [kbHeight, setKbHeight] = useState(240);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [mobile, setMobile] = React.useState(false);
  const { showAlert, showConfirm } = useAlert();

  useEffect(() => {
    const handler = () => {
      const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isNarrow = window.innerWidth < 1024; // Accommodate landscape phones
      setMobile(isTouch && isNarrow);
    };
    handler();
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
      if (direction !== 'w' && direction !== 'kb') return;
    } else {
      // Allow only north ('n') resize on mobile to act as a bottom sheet puller
      if (mobile && direction !== 'n') return;
    }

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    resizeStartRef.current = { x: clientX, y: clientY, w: chatSize.w, h: chatSize.h };
    const initialKbHeight = kbHeight;

    const onMove = (ev: MouseEvent | TouchEvent) => {
      if (!resizeStartRef.current) return;
      // Prevent browser scroll takeover during active drag
      if ('touches' in ev && ev.cancelable) ev.preventDefault();

      const cx = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;
      const cy = 'touches' in ev ? ev.touches[0].clientY : ev.clientY;
      const r = resizeStartRef.current;
      const dx = cx - r.x;
      const dy = cy - r.y;

      if (direction === 'kb') {
        const newKbH = initialKbHeight - dy;
        setKbHeight(Math.max(180, Math.min(window.innerHeight * 0.7, newKbH)));
        return;
      }

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
  }, [chatSize, mobile, isRoomFullscreen, kbHeight]);

  // Initial History Load
  useEffect(() => {
    const fetchHistory = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*, users(username, avatar_url)')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[Chat] History fetch error:', error);
        return;
      }

      if (data) {
        const history = (data as any[]).map((d: any) => {
          // Find the reply relative to the full history
          const replyRef = (data as any[]).find((m: any) => m.id === d.reply_to);
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
              username: replyRef.username || 'User',
              content: (replyRef.content || '').substring(0, 50) + ((replyRef.content || '').length > 50 ? '...' : '')
            } : undefined,
            seenBy: d.seen_by || [],
            reactions: d.reactions || {},
            isEdited: d.is_edited || false,
            isDeleted: d.content?.trim() === "This message was deleted"
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

    socket.on('chat:delete_update', ({ messageId, content, isDeleted }) => {
      setMessages(prev => prev.map(m => 
        m.id === messageId ? { ...m, content, isDeleted, type: 'text', fileUrl: undefined } : m
      ));
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
    if ((isOpen || showVirtualKeyboard) && messages.length > 0) {
      setTimeout(() => {
        rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
      }, 100);
    }
  }, [messages.length, isOpen, showVirtualKeyboard, rowVirtualizer]);

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
      socket.emit('chat:delete', { roomId, messageId: msg.id });
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
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [swipeX, setSwipeX] = useState(0);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastClickTime = useRef<number>(0);

    const handlePressEnd = () => {
      // Logic removed to favor visible menu button
    };

    useEffect(() => {
      if (!showActions && !showReactions) return;
      const handler = (e: any) => {
        // Prevent closing if we click inside the menu or its reactions
        if (itemRef.current?.contains(e.target)) return;

        setShowActions(false);
        setShowReactions(false);
      };
      document.addEventListener('mousedown', handler);
      document.addEventListener('touchstart', handler);
      return () => {
        document.removeEventListener('mousedown', handler);
        document.removeEventListener('touchstart', handler);
      };
    }, [showActions, showReactions]);

    const toggleActions = (e?: React.MouseEvent | React.TouchEvent) => {
      e?.stopPropagation();
      e?.preventDefault();
      setShowReactions(false);
      setConfirmingDelete(false);
      setShowActions(prev => !prev);
    };

    if (msg.isDeleted) {
      return (
        <div ref={itemRef} className={cn("flex flex-col max-w-[90%] group relative select-none mb-1", msg.senderId === userId ? "ml-auto items-end" : "items-start")}>
          <div className="flex items-center gap-2 mb-1 px-1">
            <span className="text-[10px] opacity-40">{msg.username} • {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div className={cn("px-3 py-2 rounded-2xl text-[11px] text-white/30 italic border border-white/5 bg-white/5", msg.senderId === userId ? "rounded-tr-none" : "rounded-tl-none")}>
            This message was deleted
          </div>
        </div>
      );
    }

    const handleTouchStart = () => {
      longPressTimer.current = setTimeout(() => {
        toggleActions();
        if (navigator.vibrate) navigator.vibrate(50);
      }, 500);
    };

    const handleTouchEnd = () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    };

    const handleDoubleClick = (e: React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation();
      handleReact('❤️');
      if (navigator.vibrate) navigator.vibrate([30, 30]);
    };

    const handleClick = (e: React.MouseEvent | React.TouchEvent) => {
      const now = Date.now();
      if (now - lastClickTime.current < 300) {
        handleDoubleClick(e);
        lastClickTime.current = 0;
      } else {
        lastClickTime.current = now;
      }
    };

    return (
      <div
        ref={itemRef}
        className={cn(
          "flex flex-col max-w-[90%] group relative select-none",
          msg.senderId === userId ? "ml-auto items-end" : "items-start"
        )}
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

        <div className="relative group/bubble flex items-center min-h-[32px]">
          {/* Reply Icon (visible during swipe) */}
          <div 
            className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center justify-center transition-opacity"
            style={{ opacity: Math.min(1, swipeX / 60), transform: `translateX(${Math.min(0, (swipeX - 40))}px)` }}
          >
            <div className="bg-emerald-500/20 p-1.5 rounded-full border border-emerald-500/20 text-emerald-500">
               <RotateCcw className="w-4 h-4 -scale-x-100" />
            </div>
          </div>

          <motion.div 
            drag="x"
            dragConstraints={{ left: 0, right: 100 }}
            dragElastic={0.2}
            onDrag={(e, info) => setSwipeX(info.offset.x)}
            onDragEnd={(e, info) => {
              if (info.offset.x > 60) {
                setReplyTo(msg);
                if (navigator.vibrate) navigator.vibrate(30);
              }
              setSwipeX(0);
            }}
            className="relative"
            style={{ x: swipeX }}
          >
            {/* Action Menu Button (Desktop) */}
            <button
              onClick={toggleActions}
              onMouseDown={(e) => e.stopPropagation()} 
              className={cn(
                "absolute top-1/2 -translate-y-1/2 p-2 opacity-0 group-hover/bubble:opacity-100 transition-all hover:bg-white/10 rounded-full z-10 hidden md:block",
                msg.senderId === userId ? "-left-10" : "-right-10"
              )}
            >
              <MoreVertical className="w-4 h-4 text-zinc-400 hover:text-white transition-colors" />
            </button>

            <div className="relative">
                    <AnimatePresence mode="wait">
                    {showActions && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        className={cn(
                          "no-drag absolute -top-14 z-[100] bg-zinc-900 border border-white/15 rounded-2xl p-1.5 flex items-center gap-1.5 shadow-2xl backdrop-blur-xl",
                          msg.senderId === userId ? "right-0" : "left-0"
                        )}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {confirmingDelete ? (
                          // Inline confirmation row
                          <>
                            <span className="text-[10px] text-zinc-400 px-1 whitespace-nowrap">Delete?</span>
                            <button
                              onClick={() => setConfirmingDelete(false)}
                              className="px-2.5 py-1.5 text-[10px] font-bold rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 transition-colors"
                            >No</button>
                            <button
                              onClick={() => { handleDelete(); setShowActions(false); setConfirmingDelete(false); }}
                              className="px-2.5 py-1.5 text-[10px] font-bold rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors"
                            >Yes</button>
                          </>
                        ) : (
                          // Normal action buttons
                          <>
                            <button
                              onClick={() => { setShowReactions(true); setShowActions(false); }}
                              className="p-2.5 hover:bg-white/10 rounded-xl text-zinc-300 hover:text-white transition-colors flex items-center gap-2"
                              title="React"
                            >
                              <Smile className="w-4 h-4" />
                            </button>
                            {msg.senderId === userId && (
                              <>
                                <button
                                  onClick={() => { startEdit(); setShowActions(false); }}
                                  className="p-2.5 hover:bg-white/10 rounded-xl text-zinc-300 hover:text-white transition-colors"
                                  title="Edit"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => setConfirmingDelete(true)}
                                  className="p-2.5 hover:bg-white/10 rounded-xl text-zinc-300 hover:text-red-500 transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </motion.div>
                    )}
                    </AnimatePresence>

              <AnimatePresence>
                {showReactions && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 10 }}
                    className={cn(
                      "no-drag absolute -top-14 z-[80] bg-zinc-900 border border-white/10 rounded-full px-2 py-1 flex gap-2 shadow-2xl backdrop-blur-xl",
                      msg.senderId === userId ? "right-0" : "left-0"
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {['❤️', '😂', '😮', '😢', '🔥', '👍'].map(emoji => (
                      <button
                        key={emoji}
                        onClick={(e) => { e.stopPropagation(); handleReact(emoji); }}
                        className="hover:scale-125 transition-transform text-xs p-1.5"
                      >
                        {emoji}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <div 
                onMouseDown={handleTouchStart}
                onMouseUp={handleTouchEnd}
                onMouseLeave={handleTouchEnd}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onClick={handleClick}
                className={cn(
                  "px-3 py-2 rounded-2xl text-sm overflow-hidden backdrop-blur-sm shadow-sm transition-all active:scale-[0.98] cursor-pointer touch-manipulation",
                  msg.senderId === userId
                    ? "bg-emerald-600/80 text-white rounded-tr-none"
                    : "bg-white/10 text-white rounded-tl-none border border-white/5"
                )}
              >
                {editingMessageId === msg.id ? (
                  <form onSubmit={saveEdit} className="no-drag flex flex-col gap-2 min-w-[200px] py-1">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="bg-black/40 border border-white/10 rounded-xl p-3 text-xs outline-none focus:border-emerald-500/50 resize-none text-white w-full"
                      rows={2}
                      autoFocus
                    />
                    <div className="flex justify-end gap-3 px-1">
                      <button type="button" onClick={() => setEditingMessageId(null)} className="text-[10px] font-bold text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
                      <button type="submit" className="text-[10px] text-emerald-500 font-black uppercase tracking-widest hover:text-emerald-400 transition-colors">Save Changes</button>
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
              
              {msg.isDeleted && (
                <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] rounded-2xl flex items-center px-3">
                  <span className="text-[10px] text-white/40 italic font-medium flex items-center gap-1.5 ring-1 ring-white/5 py-1 px-2 rounded-full">
                    <Trash2 className="w-2.5 h-2.5 opacity-40" />
                    This message was deleted
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        </div>

        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
          <div className="flex flex-wrap gap-1 px-1 -mt-1.5 z-10 relative">
            {(Object.entries(msg.reactions) as [string, string[]][]).map(([emoji, users]) => (
              <button
                key={emoji}
                onClick={(e) => { e.stopPropagation(); handleReact(emoji); }}
                className={cn(
                  "flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] transition-all no-drag hover:scale-110 active:scale-95",
                  (users as string[]).includes(userId) ? "bg-emerald-500/80 border border-emerald-400 text-white shadow-lg" : "bg-zinc-800/90 backdrop-blur-md border border-white/10 text-zinc-300 hover:bg-zinc-700"
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
                  "border border-white/10 shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)] flex flex-col group/chat relative",
                  isRoomFullscreen ? "bg-black/95 backdrop-blur-3xl rounded-none border-y-0" : mobile ? "bg-black/30 backdrop-blur-xl rounded-t-3xl border-b-0" : "bg-black/50 backdrop-blur-2xl rounded-3xl"
                )}
                style={{ height: isRoomFullscreen ? (mobile ? (showVirtualKeyboard ? '100%' : `calc(100vh - ${keyboardOffset}px)`) : '100%') : isFullscreen ? '100%' : mobile ? (keyboardOffset > 0 ? `min(100vh, calc(100vh - ${keyboardOffset}px))` : `${chatSize.h}px`) : `${chatSize.h}px`, width: '100%' }}
              >
                {/* Fullscreen Resizer */}
                {isRoomFullscreen && isOpen && (
                  <div
                    onTouchStart={(e) => startResize(e, 'w')}
                    onMouseDown={(e) => startResize(e, 'w')}
                    className="absolute -left-4 inset-y-0 w-8 flex items-center justify-center cursor-ew-resize z-[200] group/resizer touch-none"
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

                {/* Header - Hide in compact landscape mode to save space */}
                {!(mobile && isRoomFullscreen && showVirtualKeyboard) && (
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
                )}

                <div
                  ref={scrollRef}
                  className="no-drag flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-white/10 relative"
                  onClick={() => setShowVirtualKeyboard(false)}
                >
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

                <form
                  onSubmit={sendMessage}
                  className={cn(
                    "no-drag bg-white/5 border-t border-white/10 relative shrink-0 transition-all",
                    mobile && isRoomFullscreen && showVirtualKeyboard ? "p-2" : "p-4"
                  )}
                >
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
                      onFocus={() => {
                        if (mobile && isRoomFullscreen) {
                          setShowVirtualKeyboard(true);
                        }
                      }}
                      onChange={(e) => { setInput(e.target.value); handleTyping(true); }}
                      onBlur={() => {
                        // Small delay to allow clicking keyboard keys
                        setTimeout(() => handleTyping(false), 200);
                      }}
                      inputMode={mobile && isRoomFullscreen ? 'none' : 'text'}
                      enterKeyHint="send"
                      placeholder={isRecording ? "Recording..." : "Type a message..."}
                      className="flex-1 bg-transparent outline-none text-sm w-full"
                      disabled={isRecording}
                    />
                    <button type="submit" className="p-1 text-emerald-500">
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                  <AnimatePresence>
                    {showVirtualKeyboard && (
                      <VirtualKeyboard
                        onKey={(k) => setInput(prev => prev + k)}
                        onBackspace={() => setInput(prev => prev.slice(0, -1))}
                        onEnter={sendMessage}
                        onHide={() => setShowVirtualKeyboard(false)}
                        height={kbHeight}
                        onResize={(e) => startResize(e as any, 'kb')}
                        className="mt-4"
                      />
                    )}
                  </AnimatePresence>
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