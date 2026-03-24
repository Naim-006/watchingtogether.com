import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Film, Plus, Users, ArrowRight, Crown, Clock, Trash2, LogIn, Search } from 'lucide-react';
import { generateRoomCode, cn } from '../lib/utils';
import { socket } from '../lib/socket';
import { useAlert } from '../components/AlertProvider';

interface RoomHistoryItem {
  roomId: string;
  username: string;
  role: 'host' | 'viewer';
  joinedAt: number;
}

const CREATED_KEY = 'SyncView_created_rooms';
const JOINED_KEY = 'SyncView_joined_rooms';

const loadList = (key: string): RoomHistoryItem[] => {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
};

export const Home: React.FC = () => {
  const [roomCode, setRoomCode] = useState('');
  const [username, setUsername] = useState(() => localStorage.getItem('SyncView_username') || '');
  const [loading, setLoading] = useState(false);
  const [createdRooms, setCreatedRooms] = useState<RoomHistoryItem[]>(() => loadList(CREATED_KEY));
  const [joinedRooms, setJoinedRooms] = useState<RoomHistoryItem[]>(() => loadList(JOINED_KEY));
  const [activeTab, setActiveTab] = useState<'created' | 'joined'>('created');
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [showChoiceModal, setShowChoiceModal] = useState<{ code: string; username: string } | null>(null);
  const navigate = useNavigate();
  const { showAlert, showConfirm } = useAlert();

  useEffect(() => {
    socket.connect();
    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('SyncView_username', username);
  }, [username]);

  const handleCreateRoom = () => {
    if (!username) return showAlert({ message: 'Please enter a username', type: 'warning' });
    setLoading(true);
    const code = generateRoomCode();

    const entry: RoomHistoryItem = { roomId: code, username, role: 'host', joinedAt: Date.now() };
    const updated = [entry, ...createdRooms].slice(0, 20);
    setCreatedRooms(updated);
    localStorage.setItem(CREATED_KEY, JSON.stringify(updated));

    setShowChoiceModal({ code, username });
  };

  const handleJoinRoom = (code?: string) => {
    const targetCode = (code || roomCode);
    if (!username || !targetCode) return showAlert({ message: 'Please enter username and room code', type: 'warning' });

    setLoading(true);
    socket.connect();

    socket.timeout(3000).emit('room:check_lock', { roomId: targetCode }, (err: any, response: any) => {
      setLoading(false);
      if (err || !response?.isLocked) {
        const entry: RoomHistoryItem = { roomId: targetCode, username, role: 'viewer', joinedAt: Date.now() };
        const prev = loadList(JOINED_KEY);
        const deduped = [entry, ...prev.filter(r => r.roomId !== targetCode)].slice(0, 20);
        setJoinedRooms(deduped);
        localStorage.setItem(JOINED_KEY, JSON.stringify(deduped));
        navigate(`/room/${targetCode}?username=${username}&role=viewer`);
      } else {
        showAlert({ message: 'This room is currently locked by the Host.', type: 'error' });
      }
    });
  };

  const removeItem = (key: string, roomId: string, setter: React.Dispatch<React.SetStateAction<RoomHistoryItem[]>>) => {
    const updated = loadList(key).filter(r => r.roomId !== roomId);
    setter(updated);
    localStorage.setItem(key, JSON.stringify(updated));
  };

  const formatTime = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(ts).toLocaleDateString();
  };

  const historyToShow = activeTab === 'created' ? createdRooms : joinedRooms;
  const historyKey = activeTab === 'created' ? CREATED_KEY : JOINED_KEY;
  const historySetter = activeTab === 'created' ? setCreatedRooms : setJoinedRooms;

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center p-6 overflow-hidden relative">
      {/* Background Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[600px] bg-emerald-500/8 blur-[140px] rounded-full pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/4 w-[400px] h-[400px] bg-blue-500/5 blur-[100px] rounded-full pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="z-10 w-full max-w-5xl"
      >
        {/* Header */}
        <div className="text-center mb-10 space-y-3">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="inline-flex p-4 bg-emerald-500/10 rounded-3xl border border-emerald-500/20 mb-4"
          >
            <Film className="w-10 h-10 text-emerald-500" />
          </motion.div>
          <h1 className="text-6xl font-extrabold tracking-tighter bg-gradient-to-b from-white to-zinc-400 bg-clip-text text-transparent">SyncView</h1>
          <p className="text-zinc-400 text-lg">Watch together. Perfectly in sync.</p>
        </div>

        {/* Main content grid */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* Left: Create/Join Card */}
          <div className="lg:col-span-2">
            <div className="bg-zinc-900/60 backdrop-blur-xl border border-white/10 p-7 rounded-3xl shadow-2xl space-y-5 h-full">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500 ml-1">Your Name</label>
                <input
                  type="text"
                  placeholder="Enter your name..."
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateRoom()}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-emerald-500/50 transition-colors text-sm"
                />
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleCreateRoom}
                disabled={loading}
                className={cn(
                  "w-full flex items-center justify-center gap-3 p-4 bg-emerald-600 hover:bg-emerald-500 rounded-2xl transition-all font-semibold text-white shadow-lg shadow-emerald-900/30",
                  loading && "opacity-50 cursor-not-allowed"
                )}
              >
                {loading && !isConnected ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    <span>Waking up server...</span>
                  </div>
                ) : (
                  <>
                    <Plus className="w-5 h-5" />
                    Create New Room
                  </>
                )}
              </motion.button>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-xs text-zinc-500 font-medium">OR JOIN</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500 ml-1">Room Code</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="xxxx"
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleJoinRoom()}
                    className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-emerald-500/50 transition-colors font-mono tracking-widest text-center text-sm"
                    maxLength={4}
                  />
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleJoinRoom()}
                    disabled={loading}
                    className={cn(
                      "px-4 py-3 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 transition-all",
                      loading && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {loading && !isConnected ? (
                      <div className="w-5 h-5 border-2 border-white/20 border-t-emerald-500 rounded-full animate-spin" />
                    ) : (
                      <ArrowRight className="w-5 h-5" />
                    )}
                  </motion.button>
                </div>
              </div>

              <p className="text-center text-[11px] text-zinc-600 pt-2">
                By joining, you agree to our <span className="underline cursor-pointer hover:text-zinc-400 transition-colors">Terms of Service</span>
              </p>
            </div>
          </div>

          {/* Right: History Panel */}
          <div className="lg:col-span-3">
            <div className="bg-zinc-900/60 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden h-full flex flex-col">
              {/* Tabs */}
              <div className="flex border-b border-white/10">
                <button
                  onClick={() => setActiveTab('created')}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-4 text-sm font-semibold transition-colors",
                    activeTab === 'created' ? "text-emerald-400 border-b-2 border-emerald-500" : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  <Crown className="w-4 h-4" />
                  Your Rooms
                  {createdRooms.length > 0 && (
                    <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{createdRooms.length}</span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('joined')}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-4 text-sm font-semibold transition-colors",
                    activeTab === 'joined' ? "text-blue-400 border-b-2 border-blue-500" : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  <Clock className="w-4 h-4" />
                  Joined History
                  {joinedRooms.length > 0 && (
                    <span className="bg-blue-500/20 text-blue-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{joinedRooms.length}</span>
                  )}
                </button>
              </div>

              {/* List */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin scrollbar-thumb-white/10">
                <AnimatePresence mode="popLayout">
                  {historyToShow.length === 0 ? (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex flex-col items-center justify-center h-48 gap-3 text-zinc-600"
                    >
                      {activeTab === 'created' ? <Crown className="w-10 h-10 opacity-30" /> : <Clock className="w-10 h-10 opacity-30" />}
                      <p className="text-sm">{activeTab === 'created' ? 'No rooms created yet' : 'No rooms joined yet'}</p>
                      <p className="text-xs opacity-70">{activeTab === 'created' ? 'Create a room to see it here' : 'Join a room to see it here'}</p>
                    </motion.div>
                  ) : (
                    historyToShow.map((item, i) => (
                      <motion.div
                        key={item.roomId + item.joinedAt}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ delay: i * 0.03 }}
                        className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 hover:bg-white/8 border border-white/5 hover:border-white/10 transition-all group"
                      >
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bold text-sm text-white",
                          item.role === 'host' ? "bg-emerald-600/80" : "bg-blue-600/80"
                        )}>
                          {item.roomId.slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-mono font-bold text-sm tracking-widest">{item.roomId}</p>
                          <p className="text-[11px] text-zinc-500">
                            {item.role === 'host' ? 'Created' : 'Joined'} as <span className="text-zinc-400 font-medium">{item.username}</span> · {formatTime(item.joinedAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <motion.button
                            whileTap={{ scale: 0.9 }}
                            onClick={() => {
                              if (!username) return showAlert({ message: 'Enter your name first', type: 'warning' });
                              if (item.role === 'host') navigate(`/room/${item.roomId}?username=${username}&role=host`);
                              else handleJoinRoom(item.roomId);
                            }}
                            className="p-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 transition-colors"
                            title="Re-join"
                          >
                            <LogIn className="w-3.5 h-3.5" />
                          </motion.button>
                          <motion.button
                            whileTap={{ scale: 0.9 }}
                            onClick={() => {
                              showConfirm('Are you sure you want to remove this room from your history?', () => {
                                removeItem(historyKey, item.roomId, historySetter);
                              });
                            }}
                            className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
                            title="Remove"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </motion.button>
                        </div>
                      </motion.div>
                    ))
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>

        {/* Developer Card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-8 flex items-center justify-center"
        >
          <div className="flex items-center gap-4 bg-zinc-900/50 backdrop-blur-xl border border-white/8 rounded-2xl px-6 py-3 shadow-lg">
            <img
              src="/avatar.jpg"
              alt="Naim Hossain"
              className="w-10 h-10 rounded-xl object-cover object-top border border-white/10 shrink-0"
            />
            <div>
              <p className="text-sm font-semibold text-white leading-tight">Naim Hossain</p>
              <p className="text-[11px] text-zinc-500 leading-tight">Full Stack · Web &amp; Mobile Application Developer</p>
            </div>
            <div className="flex items-center gap-2 ml-2">
              {/* GitHub */}
              <a href="https://github.com/Naim-006" target="_blank" rel="noopener noreferrer"
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                title="GitHub"
              >
                <svg className="w-4 h-4 fill-zinc-400 hover:fill-white transition-colors" viewBox="0 0 24 24">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
              </a>
              {/* Facebook */}
              <a href="https://www.facebook.com/naim.hossain.355d" target="_blank" rel="noopener noreferrer"
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-blue-600/20 transition-colors"
                title="Facebook"
              >
                <svg className="w-4 h-4 fill-zinc-400 hover:fill-blue-400 transition-colors" viewBox="0 0 24 24">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
              </a>
              {/* LinkedIn */}
              <a href="https://www.linkedin.com/in/naimhossain78/" target="_blank" rel="noopener noreferrer"
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-blue-500/20 transition-colors"
                title="LinkedIn"
              >
                <svg className="w-4 h-4 fill-zinc-400 hover:fill-blue-400 transition-colors" viewBox="0 0 24 24">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
              </a>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* Choice Modal */}
      <AnimatePresence>
        {showChoiceModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-zinc-900 border border-white/10 rounded-[32px] p-8 max-w-md w-full shadow-2xl space-y-8"
            >
              <div className="text-center space-y-4">
                <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto border border-emerald-500/20">
                  <Film className="w-8 h-8 text-emerald-500" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-2xl font-bold">Room Created!</h3>
                  <p className="text-zinc-500 text-sm">How would you like to start your session?</p>
                </div>
              </div>

              <div className="space-y-4">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => navigate(`/room/${showChoiceModal.code}?username=${showChoiceModal.username}&role=host`)}
                  className="w-full flex items-center gap-4 p-5 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 transition-all group"
                >
                  <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center group-hover:bg-emerald-500/10 transition-colors">
                    <ArrowRight className="w-6 h-6 text-zinc-400 group-hover:text-emerald-500" />
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-lg">Enter Room</p>
                    <p className="text-xs text-zinc-500">Go directly to the watch room.</p>
                  </div>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => navigate(`/select-video?roomId=${showChoiceModal.code}&username=${showChoiceModal.username}&role=host`)}
                  className="w-full flex items-center gap-4 p-5 bg-emerald-600 hover:bg-emerald-500 rounded-2xl transition-all shadow-lg shadow-emerald-500/20 group"
                >
                  <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                    <Search className="w-6 h-6 text-white" />
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-lg text-white">Select Movies</p>
                    <p className="text-xs text-emerald-100/60">Find some content to watch first.</p>
                  </div>
                </motion.button>
              </div>

              <button 
                onClick={() => setShowChoiceModal(null)}
                className="w-full text-zinc-500 text-xs font-bold uppercase tracking-widest hover:text-white transition-colors"
              >
                Cancel
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
