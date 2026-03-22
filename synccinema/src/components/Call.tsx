import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../lib/socket';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { cn } from '../lib/utils';

interface CallProps {
  roomId: string;
  userId: string;
  username: string;
}

export const Call: React.FC<CallProps> = ({ roomId, userId, username }) => {
  const [isInCall, setIsInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(true);
  const [remoteStreams, setRemoteStreams] = useState<{ [id: string]: MediaStream }>({});
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnections = useRef<{ [id: string]: RTCPeerConnection }>({});
  const localStream = useRef<MediaStream | null>(null);

  const configuration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  useEffect(() => {
    socket.on('call:initiate', async ({ from }) => {
      // New user joined, we send them an offer
      const pc = createPeerConnection(from);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('call:offer', { roomId, offer, to: from });
    });

    socket.on('call:offer', async ({ offer, from }) => {
      const pc = createPeerConnection(from);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('call:answer', { roomId, answer, to: from });
    });

    socket.on('call:answer', async ({ answer, from }) => {
      const pc = peerConnections.current[from];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socket.on('call:ice', async ({ candidate, from }) => {
      const pc = peerConnections.current[from];
      if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    return () => {
      socket.off('call:offer');
      socket.off('call:answer');
      socket.off('call:ice');
    };
  }, [roomId]);

  const createPeerConnection = (targetId: string) => {
    const pc = new RTCPeerConnection(configuration);
    peerConnections.current[targetId] = pc;

    localStream.current?.getTracks().forEach(track => {
      pc.addTrack(track, localStream.current!);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('call:ice', { roomId, candidate: event.candidate, to: targetId });
      }
    };

    pc.ontrack = (event) => {
      setRemoteStreams(prev => ({
        ...prev,
        [targetId]: event.streams[0]
      }));
    };

    return pc;
  };

  const startCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: !isVideoOff });
      localStream.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      
      setIsInCall(true);

      // In this simple mesh implementation, we signal all existing room members
      // (Normally we'd use a room state to know who to call)
      socket.emit('call:initiate', { roomId });
    } catch (err) {
      console.error('Error accessing media devices:', err);
    }
  };

  const endCall = () => {
    localStream.current?.getTracks().forEach(track => track.stop());
    Object.values(peerConnections.current).forEach(pc => pc.close());
    peerConnections.current = {};
    setRemoteStreams({});
    setIsInCall(false);
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
  };

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Voice & Video</h3>
      
      <div className="bg-zinc-900/50 border border-white/10 rounded-2xl p-4 space-y-4">
        {isInCall && (
          <div className="grid grid-cols-2 gap-2">
            <div className="aspect-video bg-black rounded-xl overflow-hidden relative border border-white/5">
              <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
              <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/60 rounded text-[10px]">You</div>
            </div>
            {Object.entries(remoteStreams).map(([id, stream]) => (
              <div key={id} className="aspect-video bg-black rounded-xl overflow-hidden relative border border-white/5">
                <video 
                  autoPlay 
                  playsInline 
                  ref={el => { if (el) el.srcObject = stream; }} 
                  className="w-full h-full object-cover" 
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-center gap-2">
          {!isInCall ? (
            <button 
              onClick={startCall}
              className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold text-sm transition-all shadow-lg shadow-emerald-500/20"
            >
              <Phone className="w-4 h-4" /> Join Call
            </button>
          ) : (
            <>
              <button 
                onClick={() => setIsMuted(!isMuted)}
                className={cn(
                  "p-3 rounded-xl border transition-all",
                  isMuted ? "bg-red-500/10 border-red-500/20 text-red-500" : "bg-white/5 border-white/10 hover:bg-white/10"
                )}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
              <button 
                onClick={() => setIsVideoOff(!isVideoOff)}
                className={cn(
                  "p-3 rounded-xl border transition-all",
                  isVideoOff ? "bg-red-500/10 border-red-500/20 text-red-500" : "bg-white/5 border-white/10 hover:bg-white/10"
                )}
              >
                {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
              </button>
              <button onClick={endCall} className="p-3 bg-red-600 hover:bg-red-500 rounded-xl text-white transition-all shadow-lg shadow-red-500/20">
                <PhoneOff className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
