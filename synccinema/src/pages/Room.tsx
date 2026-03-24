import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { socket } from '../lib/socket';
import { VideoPlayer } from '../components/VideoPlayer';
import { Chat } from '../components/Chat';
import { Call, CallHandle } from '../components/Call';
import { supabase } from '../lib/supabase';
import {
  Users,
  Settings,
  Share2,
  LogOut,
  Lock,
  Unlock,
  Monitor,
  Youtube,
  Upload,
  Link as LinkIcon,
  Clock,
  PlayCircle,
  Menu,
  Phone
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';

interface Member {
  userId: string;
  username: string;
  socketId: string;
  role: 'host' | 'viewer';
  online: boolean;
  lastSeen?: string;
}

interface VideoHistoryItem {
  id: string;
  video_url: string;
  video_type: 'youtube' | 'mp4' | 'upload';
  added_by: string;
  created_at: string;
  users?: { username: string };
}

export const Room: React.FC = () => {
  const { roomId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const username = searchParams.get('username') || 'Guest';
  const roleFromUrl = searchParams.get('role') as 'host' | 'viewer' || 'viewer';
  const [userId] = useState(() => {
    let id = localStorage.getItem('synccinema_userId');
    if (!id) {
      id = Math.random().toString(36).substr(2, 9);
      localStorage.setItem('synccinema_userId', id);
    }
    return id;
  });

  const [videoUrl, setVideoUrl] = useState('https://www.youtube.com/watch?v=ysz5S6PUM-U');
  const [videoInput, setVideoInput] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [isLocked, setIsLocked] = useState(false);
  const [userRole, setUserRole] = useState<'host' | 'viewer'>(roleFromUrl);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [videoHistory, setVideoHistory] = useState<VideoHistoryItem[]>([]);
  const [currentVideoAddedBy, setCurrentVideoAddedBy] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [participantsCount, setParticipantsCount] = useState(0);
  const callRef = useRef<CallHandle>(null);
  const videoFileRef = useRef<HTMLInputElement>(null);
  
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFSChange = () => {
      const isFS = !!document.fullscreenElement;
      setIsFullscreen(isFS);

      // Auto-orientation for mobile
      if (window.innerWidth < 768 && (window as any).screen?.orientation?.lock) {
        if (isFS) {
          (window as any).screen.orientation.lock('landscape').catch(() => {});
        } else {
          (window as any).screen.orientation.lock('portrait').catch(() => {});
          // Unlock after a brief delay to allow user freedom
          setTimeout(() => {
            (window as any).screen.orientation.unlock?.();
          }, 1000);
        }
      }
    };
    document.addEventListener('fullscreenchange', handleFSChange);
    return () => document.removeEventListener('fullscreenchange', handleFSChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      fullscreenContainerRef.current?.requestFullscreen().catch(err => console.error(err));
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    socket.connect();

    socket.on('room:error', ({ message }) => {
      alert(message);
      navigate('/');
    });

    socket.emit('room:join', { roomId, userId, username });

    socket.on('user:joined', (user: Member) => {
      setMembers(prev => {
        const exists = prev.find(m => m.userId === user.userId);
        if (exists) return prev;
        return [...prev, { ...user, online: true }];
      });
    });

    socket.on('user:left', ({ socketId }) => {
      setMembers(prev => prev.filter(m => m.socketId !== socketId));
    });

    socket.on('video:sync', (state) => {
      if (state.url) setVideoUrl(state.url);
      if (state.username) setCurrentVideoAddedBy(state.username);
    });

    socket.on('room:update', (data) => {
      if (data.isLocked !== undefined) setIsLocked(data.isLocked);
      if (data.members) setMembers(data.members);
    });

    const fetchHistory = async () => {
      if (!roomId) return;
      const { data, error } = await supabase
        .from('room_videos')
        .select(`*`)
        .eq('room_id', roomId)
        .order('created_at', { ascending: false });

      if (error) console.error("History fetch error:", error);
      if (data) setVideoHistory(data as VideoHistoryItem[]);
    };

    fetchHistory();

    const channel = supabase.channel(`room_videos_${roomId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'room_videos', filter: `room_id=eq.${roomId}` },
        () => fetchHistory()
      ).subscribe();

    return () => {
      socket.disconnect();
      supabase.removeChannel(channel);
    };
  }, [roomId, userId, username]);

  const syncNewVideo = async (url: string, type?: string) => {
    const videoType = type || (url.includes('youtube.com') || url.includes('youtu.be') ? 'youtube' : 'mp4');
    setVideoUrl(url);
    socket.emit('video:set', {
      roomId,
      videoData: {
        url,
        isPlaying: false,
        currentTime: 0,
        userId,
        username,
        type: videoType
      }
    });
    setCurrentVideoAddedBy(username);

    // Save to history explicitly from the frontend to bypass backend column mismatches
    if (roomId) {
      const { error } = await supabase.from('room_videos').insert({
        room_id: roomId,
        video_type: videoType,
        video_url: url,
        added_by: userId
      });
      if (error) console.error("History save error:", error);
      else {
        setVideoHistory(prev => [{
          id: Math.random().toString(),
          video_url: url,
          video_type: videoType as any,
          added_by: userId,
          created_at: new Date().toISOString(),
          users: { username }
        }, ...prev]);
      }
    }
  };

  const handleSetVideo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoInput.trim()) return;
    syncNewVideo(videoInput);
    setVideoInput('');
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploadingVideo(true);
      const { uploadToCloudinary } = await import('../lib/cloudinary');
      const url = await uploadToCloudinary(file, 'video');
      syncNewVideo(url, 'upload');
    } catch (err) {
      console.error('Video upload failed:', err);
      alert('Upload failed. Please try again.');
    } finally {
      setIsUploadingVideo(false);
      if (videoFileRef.current) videoFileRef.current.value = '';
    }
  };

  const handleTransferHost = (targetUserId: string) => {
    if (userRole !== 'host') return;
    socket.emit('room:transfer_host', { roomId, targetUserId });
  };

  const toggleLock = async () => {
    if (userRole !== 'host') return;
    const newLockState = !isLocked;

    // Optimistically update UI instantly
    setIsLocked(newLockState);

    socket.emit('room:toggle_lock', { roomId, isLocked: newLockState });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="h-14 md:h-16 border-b border-white/5 bg-black/40 backdrop-blur-xl px-3 md:px-6 flex items-center justify-between z-40 fixed top-0 w-full">
        <div className="flex items-center gap-2 md:gap-4">
          {/* Sidebar toggle on mobile */}
          <button
            className="md:hidden p-2 hover:bg-white/10 rounded-lg transition-colors"
            onClick={() => setSidebarOpen(o => !o)}
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="hidden md:flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center font-black text-sm shadow-lg shadow-emerald-500/20">SC</div>
            <h2 className="font-bold text-lg tracking-tight">SyncCinema</h2>
          </div>
          <div className="hidden md:block h-6 w-px bg-white/10 mx-2" />
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-full border border-white/10 hover:bg-white/10 transition-colors cursor-pointer group" onClick={() => {
            const link = `${window.location.origin}/room/${roomId}?username=${username}&role=viewer`;
            navigator.clipboard.writeText(link);
            alert('Room link copied!');
          }}>
            <span className="text-xs font-mono text-emerald-500 font-bold">{roomId}</span>
            <Share2 className="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity" />
          </div>
          {/* Connection Status Indicator */}
          <div className="ml-2 hidden sm:flex items-center gap-2 px-2.5 py-1 bg-white/5 rounded-md border border-white/5">
            <div className={cn("w-1.5 h-1.5 rounded-full transition-all duration-500", socket.connected ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] animate-ping")} />
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              {socket.connected ? "Live Sync" : "Connection Lost"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-6">
          <div className="flex -space-x-2">
            {members.slice(0, 3).map((m, i) => (
              <div key={i} className="w-8 h-8 rounded-full bg-zinc-800 border-2 border-[#0a0a0a] flex items-center justify-center text-[10px] font-bold uppercase relative group" title={m.username}>
                {m.username[0]}
              </div>
            ))}
            {members.length > 3 && <div className="w-8 h-8 rounded-full bg-zinc-900 border-2 border-[#0a0a0a] flex items-center justify-center text-[10px] font-bold">+{members.length - 3}</div>}
          </div>
          <button onClick={() => navigate('/')} className="p-2 hover:bg-red-500/10 hover:text-red-500 rounded-xl transition-all border border-transparent hover:border-red-500/20">
            <LogOut className="w-4 h-4 md:w-5 md:h-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 flex pt-14 md:pt-16 overflow-hidden">
        {/* Mobile Sidebar Overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-30 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Left Sidebar */}
        <aside className={cn(
          "fixed md:relative top-14 md:top-0 left-0 h-[calc(100vh-3.5rem)] md:h-auto w-72 md:w-80 border-r border-white/5 bg-[#0d0d0d] md:bg-black/20 backdrop-blur-md p-4 md:p-6 flex flex-col gap-6 md:gap-8 overflow-y-auto z-40 transition-transform duration-300 md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}>
          <div className="space-y-5">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Member List</h3>
            <div className="space-y-1">
              {members.map(m => (
                <div key={m.userId} className="flex items-center justify-between p-2 rounded-xl hover:bg-white/5 transition-colors group">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-xs font-bold uppercase border border-white/5">
                      {m.username[0]}
                      <div className={cn("absolute w-2 h-2 rounded-full border border-black", m.online ? "bg-emerald-500" : "bg-zinc-600")} style={{ transform: 'translate(10px, 10px)' }} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{m.username} {m.userId === userId && <span className="text-emerald-500">(You)</span>}</p>
                      <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-tighter">
                        {m.role} • {m.online ? (
                          <span className="text-emerald-500">Online</span>
                        ) : m.lastSeen ? (
                          <span>Last seen: {new Date(m.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        ) : (
                          <span>Offline</span>
                        )}
                      </p>
                    </div>
                  </div>
                  {userRole === 'host' && m.userId !== userId && (
                    <button onClick={() => handleTransferHost(m.userId)} className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-emerald-500/10 hover:text-emerald-500 rounded-lg transition-all" title="Transfer Host">
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-5">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Video Source</h3>
            <form onSubmit={handleSetVideo} className="space-y-3">
              <div className="relative">
                <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  value={videoInput}
                  onChange={(e) => setVideoInput(e.target.value)}
                  placeholder="Enter URL..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:border-emerald-500/50 transition-all"
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-600/10">
                  <Youtube className="w-4 h-4" /> Sync URL
                </button>
                <button
                  type="button"
                  onClick={() => videoFileRef.current?.click()}
                  disabled={isUploadingVideo}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
                >
                  <Upload className={cn("w-4 h-4 text-emerald-500", isUploadingVideo && "animate-spin")} />
                  {isUploadingVideo ? 'Uploading...' : 'Upload File'}
                </button>
                <input
                  type="file"
                  ref={videoFileRef}
                  className="hidden"
                  accept="video/*"
                  onChange={handleVideoUpload}
                />
              </div>
            </form>
          </div>

          <div className="space-y-5">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2">
              <Clock className="w-3 h-3" /> History & Library
            </h3>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
              {videoHistory.length === 0 ? (
                <p className="text-xs text-zinc-600 font-medium text-center py-4 border border-dashed border-white/10 rounded-xl">No history yet.</p>
              ) : (
                videoHistory.map((video) => (
                  <div
                    key={video.id}
                    onClick={() => syncNewVideo(video.video_url, video.video_type)}
                    className={cn(
                      "p-3 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 transition-all flex items-start gap-3 flex-col cursor-pointer"
                    )}
                  >
                    <div className="flex items-center gap-2 w-full">
                      {video.video_type === 'youtube' ? <Youtube className="w-4 h-4 text-red-500 shrink-0" /> : <PlayCircle className="w-4 h-4 text-emerald-500 shrink-0" />}
                      <span className="text-xs truncate text-zinc-300 font-medium" title={video.video_url}>
                        {video.video_url.replace(/^https?:\/\//, '')}
                      </span>
                    </div>
                    <div className="flex justify-between w-full text-[9px] text-zinc-500 font-bold uppercase mt-1">
                      <span>{video.users?.username || (video.added_by ? `User ${video.added_by.substring(0, 4)}` : 'Guest')}</span>
                      <span>{new Date(video.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="space-y-5">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Room Security</h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={toggleLock}
                disabled={userRole !== 'host'}
                className={cn(
                  "flex flex-col items-center gap-3 p-4 rounded-2xl border transition-all",
                  isLocked ? "bg-red-500/10 border-red-500/20 text-red-500" : "bg-emerald-500/5 border-emerald-500/10 text-emerald-500 hover:bg-emerald-500/10",
                  userRole !== 'host' && "opacity-50 cursor-not-allowed"
                )}
              >
                {isLocked ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
                <span className="text-[9px] font-black uppercase tracking-widest">{isLocked ? 'Locked' : 'Open'}</span>
              </button>
              <button className="flex flex-col items-center gap-3 p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all">
                <Monitor className="w-5 h-5 opacity-40" />
                <span className="text-[9px] font-black uppercase tracking-widest opacity-40">Cast</span>
              </button>
            </div>
          </div>

          <div className="space-y-5">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Voice & Video Call</h3>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
               <button 
                 onClick={() => callRef.current?.startCall()}
                 className="w-full flex items-center justify-between p-3.5 bg-emerald-600 hover:bg-emerald-500 rounded-xl transition-all shadow-lg shadow-emerald-600/20 group animate-in fade-in slide-in-from-bottom-2"
               >
                 <div className="flex items-center gap-3">
                   <Phone className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                   <span className="text-xs font-black uppercase tracking-widest text-white">
                     {participantsCount > 0 ? 'Join Active Call' : 'Start Room Call'}
                   </span>
                 </div>
                 {participantsCount > 0 && (
                   <span className="bg-white/20 px-2.5 py-1 rounded-lg text-[10px] font-black text-white">
                     {participantsCount}
                   </span>
                 )}
               </button>
            </div>
          </div>
        </aside>

        {/* Center Content */}
        <section className="flex-1 p-3 md:p-10 flex flex-col items-center justify-center relative overflow-y-auto">
          <div className="absolute inset-0 bg-gradient-radial from-emerald-500/5 via-transparent to-transparent pointer-events-none" />

          <div className="w-full max-w-5xl z-10">
            <div ref={fullscreenContainerRef} className={cn("transition-all duration-300 relative w-full", isFullscreen && "bg-black w-screen h-screen flex flex-row items-center justify-center")}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={videoUrl}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={cn("shadow-[0_0_100px_-20px_rgba(16,185,129,0.15)] overflow-hidden transition-all duration-300", isFullscreen ? "flex-1 h-full flex flex-col items-center justify-center rounded-none" : "rounded-2xl w-full")}
                >
                  <div className={cn("transition-all duration-300 relative max-h-[100vh]", isFullscreen ? "w-full max-w-[177vh] max-h-screen aspect-video" : "w-full aspect-video")}>
                    <VideoPlayer url={videoUrl} isHost={userRole === 'host'} roomId={roomId || ''} userId={userId} onToggleFullscreen={toggleFullscreen} />
                  </div>
                </motion.div>
              </AnimatePresence>

              {/* Chat is rendered natively inside the fullscreen wrapper to guarantee exact native layering */}
              <Chat roomId={roomId || ''} userId={userId} username={username} isRoomFullscreen={isFullscreen} />
            </div>

            <div className="mt-4 md:mt-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
              <div>
                <h1 className="text-xl md:text-3xl font-black tracking-tight bg-gradient-to-r from-white to-white/40 bg-clip-text text-transparent italic">NOW PLAYING</h1>
                <p className="text-zinc-500 text-xs md:text-sm font-medium mt-1 truncate max-w-xs md:max-w-lg">{videoUrl}</p>
                {currentVideoAddedBy && (
                  <p className="text-xs text-emerald-500 mt-2 font-bold uppercase tracking-widest flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 display-inline-block" />
                    Added by: {currentVideoAddedBy}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-4">

              </div>
            </div>
          </div>
        </section>
      </main>

      <Call 
        ref={callRef}
        roomId={roomId || ''} 
        userId={userId} 
        username={username} 
        members={members}
        showFloatingTrigger={false}
        onParticipantsChange={setParticipantsCount}
      />
    </div>
  );
};
