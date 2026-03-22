import React, { useState, useEffect, useRef } from 'react';
import ReactPlayer from 'react-player';
import { socket } from '../lib/socket';
import { Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, Maximize } from 'lucide-react';
import { cn } from '../lib/utils';

interface VideoPlayerProps {
  url: string;
  isHost: boolean;
  roomId: string;
  userId: string;
}

const Player = (ReactPlayer as any).default || ReactPlayer;

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ url, isHost, roomId, userId }) => {
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

  const handlePlayPause = () => {
    const newPlaying = !playing;
    setPlaying(newPlaying);
    const currentTime = playerRef.current?.getCurrentTime() || 0;
    socket.emit('video:action', { roomId, userId, action: newPlaying ? 'play' : 'pause', currentTime });
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
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '0:00';
    const date = new Date(seconds * 1000);
    const mm = date.getUTCMinutes();
    const ss = date.getUTCSeconds().toString().padStart(2, '0');
    return `${mm}:${ss}`;
  };

  return (
    <div
      ref={containerRef}
      className="relative aspect-video bg-black rounded-xl overflow-hidden shadow-2xl"
      onMouseMove={revealControls}
      onMouseLeave={() => { if (playing) setShowControls(false); }}
      onClick={revealControls}
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
      <div className="absolute inset-x-0 top-0 bottom-20 flex z-10">
        <div className="flex-1" onDoubleClick={() => handleSkip(-10)} onClick={handlePlayPause} />
        <div className="w-1/4" onClick={handlePlayPause} />
        <div className="flex-1" onDoubleClick={() => handleSkip(10)} onClick={handlePlayPause} />
      </div>

      <div className={cn(
        "absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent flex flex-col gap-2 z-20 transition-all duration-500",
        showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"
      )}>
        <input
          type="range" min={0} max={1} step="any"
          value={duration ? played : 0}
          onChange={handleSeek}
          className="w-full accent-emerald-500 cursor-pointer"
        />
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
