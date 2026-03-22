import React, { useState, useEffect, useRef } from 'react';
import Draggable from 'react-draggable';
import { socket } from '../lib/socket';
import { Send, Image as ImageIcon, Mic, X, MessageSquare, Check, CheckCheck } from 'lucide-react';
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
}

interface ChatProps {
  roomId: string;
  userId: string;
  username: string;
}

export const Chat: React.FC<ChatProps> = ({ roomId, userId, username }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isOpen, setIsOpen] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [onlineCount, setOnlineCount] = useState(1);
  const [unreadCount, setUnreadCount] = useState(0);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draggableRef = useRef<HTMLDivElement>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  
  const isOpenRef = useRef(isOpen);
  useEffect(() => { 
    isOpenRef.current = isOpen; 
    if (isOpen) setUnreadCount(0);
  }, [isOpen]);

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
            seenBy: d.seen_by || []
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
          audio.play().catch(() => {});
        } catch (e) {}
      }
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

    return (
      <div 
        ref={itemRef}
        className={cn(
          "flex flex-col max-w-[85%] group relative",
          msg.senderId === userId ? "ml-auto items-end" : "items-start"
        )}
        onDoubleClick={() => setReplyTo(msg)}
      >
        <span className="text-[10px] opacity-40 mb-1 px-1">{msg.username} • {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        
        {msg.replyTo && (
          <div className="text-[10px] bg-white/5 border-l-2 border-emerald-500 p-1 mb-1 rounded opacity-60 truncate w-full">
            <span className="font-bold">{msg.replyTo.username}:</span> {msg.replyTo.content}
          </div>
        )}

        <div className={cn(
          "px-3 py-2 rounded-2xl text-sm overflow-hidden",
          msg.senderId === userId 
            ? "bg-emerald-600 text-white rounded-tr-none" 
            : "bg-white/10 text-white rounded-tl-none"
        )}>
          {msg.type === 'image' ? (
            <img src={msg.fileUrl} alt="Shared" className="max-w-full rounded-lg" />
          ) : msg.type === 'voice' ? (
            <audio src={msg.fileUrl} controls className="h-8 w-40 filter invert" />
          ) : (
            msg.content
          )}
        </div>
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
    <Draggable nodeRef={draggableRef} handle=".chat-handle" bounds="parent">
      <div ref={draggableRef} className={cn(
        "fixed bottom-6 right-6 w-80 z-50 flex flex-col transition-all duration-300",
        !isOpen && "w-14 h-14"
      )}>
        <AnimatePresence>
          {isOpen ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-zinc-900/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl flex flex-col h-[500px] overflow-hidden"
            >
              <div className="chat-handle p-4 border-b border-white/10 flex items-center justify-between cursor-move bg-white/5">
                <div className="flex items-center gap-3">
                  <MessageSquare className="w-5 h-5 text-emerald-500" />
                  <div className="flex flex-col">
                    <span className="font-semibold text-sm leading-tight">Room Chat</span>
                    <span className="text-[10px] text-emerald-500 font-medium leading-tight">{onlineCount} Online</span>
                  </div>
                </div>
                <button onClick={() => setIsOpen(false)} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-white/10">
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
                <div className="px-4 py-2 bg-emerald-500/10 border-t border-emerald-500/20 flex items-center justify-between">
                  <div className="text-[10px] truncate">
                    Replying to <span className="font-bold">{replyTo.username}</span>
                  </div>
                  <button onClick={() => setReplyTo(null)}><X className="w-3 h-3" /></button>
                </div>
              )}

              <form onSubmit={sendMessage} className="p-4 bg-white/5 border-t border-white/10">
                <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" className="hidden" />
                <div className="flex items-center gap-2 bg-black/40 rounded-xl px-3 py-2 border border-white/5 focus-within:border-emerald-500/50 transition-colors">
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="p-1 hover:text-emerald-500">
                    <ImageIcon className="w-4 h-4" />
                  </button>
                  <button 
                    type="button" 
                    onMouseDown={startRecording}
                    onMouseUp={stopRecording}
                    onMouseLeave={isRecording ? stopRecording : undefined}
                    className={cn("p-1 transition-colors", isRecording ? "text-red-500 animate-pulse" : "hover:text-emerald-500")}
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
                  <button type="submit" className="p-1 text-emerald-500">
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </form>
            </motion.div>
          ) : (
            <button
              onClick={() => setIsOpen(true)}
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
  );
};
