import React, { useState, useEffect, useRef, useMemo } from 'react';
import { socket } from '../lib/socket';
import Draggable from 'react-draggable';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, Users, ChevronDown, ChevronUp, Move } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import { useAlert } from './AlertProvider';

interface CallProps {
  roomId: string;
  userId: string;
  username: string;
  members: any[];
  showFloatingTrigger?: boolean;
  onParticipantsChange?: (count: number) => void;
}

export interface CallHandle {
  startCall: () => Promise<void>;
  isInCall: boolean;
  participantsCount: number;
}

export const Call = React.forwardRef<CallHandle, CallProps>(({ 
  roomId, 
  userId, 
  username, 
  members,
  showFloatingTrigger = true,
  onParticipantsChange 
}, ref) => {
  const [isInCall, setIsInCall] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  
  React.useImperativeHandle(ref, () => ({
    startCall,
    isInCall,
    participantsCount: participants.length
  }));
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(true);
  const [participants, setParticipants] = useState<string[]>([]);
  const { showAlert } = useAlert();
  const [remoteStreams, setRemoteStreams] = useState<{ [socketId: string]: MediaStream }>({});
  
  const peerConnections = useRef<{ [socketId: string]: RTCPeerConnection }>({});
  const localStream = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const draggableRef = useRef<HTMLDivElement>(null);

  // Polite Peer Logic: We are polite if our socket ID is lexicographically "greater" than the remote side
  const isPolite = (remoteId: string) => socket.id > remoteId;

  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  const getUsername = (socketId: string) => {
    return members.find(m => m.socketId === socketId)?.username || 'User';
  };

  useEffect(() => {
    // Initial sync
    if (socket.connected && roomId) {
      socket.emit('call:get_state', { roomId }); // Get current callers list
    }

    socket.on('connect', () => {
      console.log('[Call] Socket connected, re-syncing...');
      if (isInCall) socket.emit('call:join', { roomId });
      else socket.emit('call:get_state', { roomId }); 
    });

    socket.on('call:update', ({ participants }) => {
      console.log('[Call] Participants updated:', participants);
      const uniqueParticipants = Array.from(new Set(participants || []));
      setParticipants(uniqueParticipants);
      onParticipantsChange?.(uniqueParticipants.length);
    });

    socket.on('call:initiate', async ({ from }) => {
      if (!isInCall) return;
      console.log(`[Call] Initiating with ${from}. I am polite: ${isPolite(from)}`);
      await makeOffer(from);
    });

    socket.on('call:offer', async ({ offer, from }) => {
      if (!isInCall) return;
      const pc = getOrCreatePC(from);
      
      const collision = pc.signalingState !== 'stable';
      if (collision && !isPolite(from)) {
        console.log(`[Call] Collision detected, ignoring offer from ${from} (I am impolite)`);
        return;
      }

      console.log(`[Call] Handling offer from ${from}`);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('call:answer', { roomId, answer, to: from });
    });

    socket.on('call:answer', async ({ answer, from }) => {
      const pc = peerConnections.current[from];
      if (pc) {
        console.log(`[Call] Handling answer from ${from}`);
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socket.on('call:ice', async ({ candidate, from }) => {
      const pc = peerConnections.current[from];
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error('[Call] ICE error', e);
        }
      }
    });

    socket.on('user:left', ({ socketId }) => {
      cleanupPeer(socketId);
    });

    return () => {
      socket.off('call:update');
      socket.off('call:initiate');
      socket.off('call:offer');
      socket.off('call:answer');
      socket.off('call:ice');
      socket.off('user:left');
    };
  }, [roomId, isInCall]);

  const getOrCreatePC = (targetId: string) => {
    if (peerConnections.current[targetId]) return peerConnections.current[targetId];

    const pc = new RTCPeerConnection(configuration);
    peerConnections.current[targetId] = pc;

    if (localStream.current) {
      localStream.current.getTracks().forEach(track => {
        pc.addTrack(track, localStream.current!);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('call:ice', { roomId, candidate: event.candidate, to: targetId });
      }
    };

    pc.ontrack = (event) => {
      setRemoteStreams(prev => ({ ...prev, [targetId]: event.streams[0] }));
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        cleanupPeer(targetId);
      }
    };

    return pc;
  };

  const makeOffer = async (targetId: string) => {
    const pc = getOrCreatePC(targetId);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('call:offer', { roomId, offer, to: targetId });
    } catch (err) {
      console.error('[Call] Error creating offer', err);
    }
  };

  const cleanupPeer = (socketId: string) => {
    if (peerConnections.current[socketId]) {
      peerConnections.current[socketId].close();
      delete peerConnections.current[socketId];
    }
    setRemoteStreams(prev => {
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
  };

  const startCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true, 
        video: isVideoOff ? false : { width: 1280, height: 720 }
      });
      
      localStream.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      
      setIsInCall(true);
      socket.emit('call:join', { roomId });
    } catch (err) {
      console.error('Call media error:', err);
      showAlert({ message: 'Camera/Mic permission denied.', type: 'error' });
    }
  };

  const endCall = () => {
    socket.emit('call:leave', { roomId });
    localStream.current?.getTracks().forEach(track => track.stop());
    Object.values(peerConnections.current as Record<string, RTCPeerConnection>).forEach(pc => pc.close());
    peerConnections.current = {};
    setRemoteStreams({});
    setIsInCall(false);
    localStream.current = null;
  };

  const toggleMic = () => {
    if (localStream.current) {
      const track = localStream.current.getAudioTracks()[0];
      if (track) {
        track.enabled = isMuted;
        setIsMuted(!isMuted);
      }
    }
  };

  const toggleVideo = async () => {
    if (!isInCall) {
      setIsVideoOff(!isVideoOff);
      return;
    }
    
    if (isVideoOff) {
      // Turn video ON
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
        const videoTrack = videoStream.getVideoTracks()[0];
        
        if (localStream.current) {
          localStream.current.addTrack(videoTrack);
          if (localVideoRef.current) localVideoRef.current.srcObject = localStream.current;
          
          Object.values(peerConnections.current as Record<string, RTCPeerConnection>).forEach(pc => {
            const senders = pc.getSenders();
            const sender = senders.find(s => s.track?.kind === 'video');
            if (sender) {
              sender.replaceTrack(videoTrack);
            } else {
              pc.addTrack(videoTrack, localStream.current!);
              // Adding a new track requires renegotiation, so we create a new offer
              makeOffer(Object.keys(peerConnections.current).find(key => peerConnections.current[key] === pc) as string);
            }
          });
        }
        setIsVideoOff(false);
      } catch (err) {
        console.error('[Call] Error turning on video:', err);
      }
    } else {
      // Turn video OFF
      if (localStream.current) {
        const videoTrack = localStream.current.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.stop();
          localStream.current.removeTrack(videoTrack);
          setIsVideoOff(true);
        }
      }
    }
  };

  const callCount = participants.length;

  return (
    <div className="fixed bottom-6 right-6 z-[60] flex flex-col items-end gap-3 pointer-events-none">
      {/* Active Call UI */}
      <AnimatePresence>
        {isInCall && (
          <Draggable
            nodeRef={draggableRef}
            handle=".drag-handle"
            bounds="parent"
          >
            <motion.div
              ref={draggableRef}
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.9 }}
              className={cn(
                "bg-black/80 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden pointer-events-auto transition-all duration-300",
                isMinimized ? "w-48" : "w-[320px] md:w-[400px]"
              )}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-3 border-b border-white/5 bg-white/5 drag-handle cursor-move">
                <div className="flex items-center gap-2">
                  <Move size={14} className="text-emerald-500 opacity-60" />
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-black uppercase tracking-widest opacity-80">Call Live • {callCount}</span>
                </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setIsMinimized(!isMinimized)} className="p-1 px-2 hover:bg-white/10 rounded-lg transition-colors">
                  {isMinimized ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
            </div>

            {!isMinimized && (
              <>
                {/* Video Grid */}
                <div className={cn(
                  "p-2 grid gap-2 overflow-y-auto custom-scrollbar",
                  Object.keys(remoteStreams).length === 0 ? "grid-cols-1" : "grid-cols-2",
                  "max-h-[400px]"
                )}>
                  {/* Local */}
                  <div className="aspect-video bg-zinc-900 rounded-xl overflow-hidden relative border border-white/5">
                    {isVideoOff ? (
                      <div className="w-full h-full flex items-center justify-center bg-zinc-900">
                        <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500 font-bold text-lg">
                          {username[0]?.toUpperCase()}
                        </div>
                      </div>
                    ) : (
                      <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover scale-x-[-1]" />
                    )}
                    <span className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/60 rounded text-[9px] font-bold">You {isMuted && '🔇'}</span>
                  </div>

                  {/* Remotes */}
                  {Object.entries(remoteStreams).map(([id, stream]) => (
                    <div key={id} className="aspect-video bg-zinc-900 rounded-xl overflow-hidden relative border border-white/5">
                      <video 
                        autoPlay playsInline 
                        ref={el => { if (el) el.srcObject = stream; }} 
                        className="w-full h-full object-cover" 
                      />
                      <span className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/60 rounded text-[9px] font-bold truncate max-w-[80%]">
                        {getUsername(id)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Controls */}
                <div className="p-4 flex items-center justify-center gap-3">
                  <button onClick={toggleMic} className={cn("p-3 rounded-xl transition-all", isMuted ? "bg-red-500/20 text-red-500" : "bg-white/10 text-white hover:bg-white/20")}>
                    {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                  </button>
                  <button onClick={toggleVideo} className={cn("p-3 rounded-xl transition-all", isVideoOff ? "bg-zinc-800 text-zinc-500" : "bg-white/10 text-white hover:bg-white/20")}>
                    {isVideoOff ? <VideoOff size={18} /> : <Video size={18} />}
                  </button>
                  <button onClick={endCall} className="p-3 bg-red-600 hover:bg-red-500 rounded-xl text-white transition-all shadow-lg shadow-red-500/20">
                    <PhoneOff size={18} />
                  </button>
                </div>
              </>
            )}
          </motion.div>
          </Draggable>
        )}
      </AnimatePresence>

      {/* Join Bubble */}
      {!isInCall && showFloatingTrigger && (
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={startCall}
          className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 pointer-events-auto transition-all group border border-emerald-400/20"
        >
          <div className="relative">
             <Phone size={20} className="group-hover:rotate-12 transition-transform" />
             {participants.length > 0 && (
               <span className="absolute -top-2 -right-2 bg-red-500 text-[8px] font-black px-1 rounded-full animate-bounce">
                 {participants.length}
               </span>
             )}
          </div>
          <span className="font-black text-xs uppercase tracking-widest">
            {participants.length > 0 ? 'Join Active Call' : 'Start Room Call'}
          </span>
        </motion.button>
      )}
    </div>
  );
});
