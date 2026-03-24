import React, { useState, useEffect, useRef } from 'react';
import ReactPlayer from 'react-player';
import { socket } from '../lib/socket';
import { Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, Maximize, FastForward, Rewind } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';

interface VideoPlayerProps {
  url: string;
  isHost: boolean;
  roomId: string;
  userId: string;
  onToggleFullscreen?: () => void;
}

const Player = (ReactPlayer as any).default || ReactPlayer;

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ url, isHost, roomId, userId, onToggleFullscreen }) => {
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [played, setPlayed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isReady, setIsReady] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showSkipIndicator, setShowSkipIndicator] = useState<{ side: 'left' | 'right', amount: number } | null>(null);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const revealControls = () => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (playing) setShowControls(false);
    }, 3000);
  };

  // When paused always keep controls visible
  useEffect(() => {
    if (!playing) {
      setShowControls(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    } else {
      // restart timer when playback resumes
      hideTimer.current = setTimeout(() => setShowControls(false), 3000);
    }
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [playing]);

  useEffect(() => {
    console.log('VideoPlayer URL:', url);
    setIsReady(false);
  }, [url]);

  // Sync logic
  useEffect(() => {
    const handleAction = ({ action, currentTime, playbackRate: newRate }: any) => {
      if (action === 'play') setPlaying(true);
      if (action === 'pause') setPlaying(false);
      if (action === 'rate' && newRate) setPlaybackRate(newRate);
      if (currentTime !== undefined && playerRef.current) {
        const player = playerRef.current;
        if (typeof player.getCurrentTime === 'function') {
          const currentPos = player.getCurrentTime();
          if (Math.abs(currentPos - currentTime) > 2) {
            player.seekTo(currentTime, 'seconds');
          }
        }
      }
    };

    const handleSync = (state: any) => {
      setPlaying(state.isPlaying);
      setPlaybackRate(state.playbackRate || 1);
      if (state.currentTime !== undefined && playerRef.current) {
        let expectedTime = state.currentTime;
        if (state.isPlaying && state.lastUpdate) {
          expectedTime += (Date.now() - state.lastUpdate) / 1000;
        }
        if (typeof playerRef.current.getCurrentTime === 'function') {
          const currentPos = playerRef.current.getCurrentTime();
          if (Math.abs(currentPos - expectedTime) > 2) {
            playerRef.current.seekTo(expectedTime, 'seconds');
          }
        }
      }
    };

    socket.on('video:action', handleAction);
    socket.on('video:sync', handleSync);
    
    const interval = setInterval(() => {
      if (!playing) return;
      // For drift correction, everyone can request sync, but the server regulates it
      socket.emit('video:request_sync', { roomId });
    }, 3000);

    return () => {
      socket.off('video:action', handleAction);
      socket.off('video:sync', handleSync);
      clearInterval(interval);
    };
  }, [isHost, playing, roomId]);

  const handlePlayPause = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const newPlaying = !playing;
    setPlaying(newPlaying);
    const currentTime = playerRef.current?.getCurrentTime() || 0;
    socket.emit('video:action', { roomId, userId, action: newPlaying ? 'play' : 'pause', currentTime });
  };

  const handleSeekInternal = (amount: number) => {
    handleSkip(amount);
    setShowSkipIndicator({ side: amount > 0 ? 'right' : 'left', amount: Math.abs(amount) });
    setTimeout(() => setShowSkipIndicator(null), 800);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const seekTime = parseFloat(e.target.value) * duration;
    playerRef.current?.seekTo(seekTime, 'seconds');
    socket.emit('video:action', { roomId, userId, action: 'seek', currentTime: seekTime });
  };

  const handleSkip = (amount: number) => {
    if (!playerRef.current || !duration) return;
    const currentTime = playerRef.current.getCurrentTime();
    let newTime = currentTime + amount;
    if (newTime < 0) newTime = 0;
    if (newTime > duration) newTime = duration;
    
    playerRef.current.seekTo(newTime, 'seconds');
    setPlayed(newTime / duration);
    socket.emit('video:action', { roomId, userId, action: 'seek', currentTime: newTime });
  };

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    const currentTime = playerRef.current?.getCurrentTime() || 0;
    socket.emit('video:action', { roomId, userId, action: 'rate', currentTime, playbackRate: rate });
  };

  const handleFullscreen = () => {
    if (onToggleFullscreen) {
      onToggleFullscreen();
      return;
    }
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  const handleDesktopClick = (e: React.MouseEvent, side: 'left' | 'right' | 'center') => {
    e.stopPropagation();
    revealControls();
    
    if (clickTimeoutRef.current) {
      // Double tap detected
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
      if (side === 'left') handleSeekInternal(-10);
      if (side === 'right') handleSeekInternal(10);
      // Center double-tap doesn't need to do anything else since first tap already handled play/pause
    } else {
      // Single tap potential
      if (side === 'center') {
        // Only toggle play/pause immediately if clicking the center
        handlePlayPause();
      }
      
      clickTimeoutRef.current = setTimeout(() => {
        clickTimeoutRef.current = null;
      }, 250);
    }
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ss = secs.toString().padStart(2, '0');
    
    if (hrs > 0) {
      const mm = mins.toString().padStart(2, '0');
      return `${hrs}:${mm}:${ss}`;
    }
    return `${mins}:${ss}`;
  };

  return (
    <div
      ref={containerRef}
      className="relative aspect-video bg-black rounded-xl overflow-hidden shadow-2xl group"
      onMouseMove={revealControls}
      onMouseLeave={() => { if (playing) setShowControls(false); }}
      onClick={(e) => {
        // Check if we didn't click on a controller part
        revealControls();
      }}
    >
      <Player
        ref={playerRef}
        url={url}
        width="100%"
        height="100%"
        playing={playing}
        volume={volume}
        muted={muted}
        playbackRate={playbackRate}
        onProgress={(state: any) => setPlayed(state.played)}
        onDuration={(dur: number) => setDuration(dur)}
        onReady={() => setIsReady(true)}
        config={{
          youtube: { playerVars: { modestbranding: 1, rel: 0 } },
          file: { attributes: { controlsList: 'nodownload' } }
        }}
      />

      {/* Gesture Overlays for Click and Double-Tap */}
      <div className="absolute inset-x-0 top-0 bottom-20 z-10 flex">
        <div className="flex-1 cursor-pointer" onClick={(e) => handleDesktopClick(e, 'left')} />
        <div className="w-1/4 cursor-pointer" onClick={(e) => handleDesktopClick(e, 'center')} />
        <div className="flex-1 cursor-pointer" onClick={(e) => handleDesktopClick(e, 'right')} />
      </div>

      {/* Skip Indicators */}
      <AnimatePresence>
        {showSkipIndicator && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.5 }}
            className={cn(
              "absolute top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-2 pointer-events-none",
              showSkipIndicator.side === 'left' ? "left-[10%] md:left-[20%]" : "right-[10%] md:right-[20%]"
            )}
          >
            <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center">
              {showSkipIndicator.side === 'left' ? <Rewind size={32} className="text-white fill-current" /> : <FastForward size={32} className="text-white fill-current" />}
            </div>
            <span className="text-white font-bold text-lg">{showSkipIndicator.amount}s</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Center Play/Pause Button for Mobile */}
      <div className={cn(
        "absolute inset-0 flex items-center justify-center z-20 pointer-events-none md:hidden transition-opacity duration-300",
        showControls ? "opacity-100" : "opacity-0"
      )}>
        <button 
          onClick={(e) => {
            e.stopPropagation();
            handlePlayPause();
            revealControls();
          }}
          className="pointer-events-auto p-4 rounded-full bg-black/40 text-white hover:bg-emerald-500/80 transition-colors backdrop-blur-md"
        >
          {playing ? <Pause size={48} className="fill-current" /> : <Play size={48} className="fill-current ml-2" />}
        </button>
      </div>

      <div className={cn(
        "absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent flex flex-col gap-2 z-20 transition-all duration-500",
        showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"
      )}>
        <div className="relative w-full h-4 flex items-center group/seeker">
          <input
            type="range" min={0} max={1} step="any"
            value={duration ? played : 0}
            onChange={handleSeek}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
          <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden">
            <div 
              className="h-full bg-emerald-500 rounded-full relative"
              style={{ width: `${played * 100}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg scale-0 group-hover/seeker:scale-100 transition-transform" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <button onClick={() => handleSkip(-10)} className="text-white hover:text-emerald-500 transition-colors">
              <RotateCcw size={20} />
            </button>
            <button onClick={handlePlayPause} className="text-white hover:text-emerald-500 transition-colors">
              {playing ? <Pause size={24} /> : <Play size={24} />}
            </button>
            <button onClick={() => handleSkip(10)} className="text-white hover:text-emerald-500 transition-colors">
              <RotateCw size={20} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Volume2 size={20} className="text-white/60" />
            <input type="range" min={0} max={1} step="any" value={volume} onChange={e => setVolume(parseFloat(e.target.value))} className="w-20 hidden group-hover:block accent-white" />
          </div>
          <div className="ml-auto flex items-center gap-4">
            <select
              value={playbackRate}
              onChange={(e) => handleRateChange(parseFloat(e.target.value))}
              className="bg-transparent text-white/80 hover:text-white text-xs font-mono outline-none cursor-pointer appearance-none"
            >
              <option value="0.5" className="bg-gray-900">0.5x</option>
              <option value="1" className="bg-gray-900">1x</option>
              <option value="1.25" className="bg-gray-900">1.25x</option>
              <option value="1.5" className="bg-gray-900">1.5x</option>
              <option value="2" className="bg-gray-900">2x</option>
            </select>
            <span className="text-xs font-mono text-white/60">
              {formatTime(played * duration)} / {formatTime(duration)}
            </span>
            <button onClick={handleFullscreen} className="text-white hover:text-emerald-500 transition-colors">
              <Maximize size={20} />
            </button>
          </div>
        </div>
      </div>
      
      {!isHost && !playing && !isReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <p className="text-emerald-500 text-sm font-bold animate-pulse">Initializing Sync...</p>
        </div>
      )}
    </div>
  );
};
