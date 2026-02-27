import { useState, useCallback, useEffect, useRef } from "react";
import type AgoraRTC from "agora-rtc-sdk-ng";
import type {
  IAgoraRTCClient,
  IMicrophoneAudioTrack,
  IRemoteAudioTrack,
  IAgoraRTCRemoteUser,
} from "agora-rtc-sdk-ng";
import type RTM from "agora-rtm";

export interface VoiceClientConfig {
  appId: string;
  channel: string;
  token: string | null;
  uid: number;
  agentUid: string;
  agentRtmUid: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  isFinal: boolean;
}

export function useAgoraVoiceClient() {
  const [client, setClient] = useState<IAgoraRTCClient | null>(null);
  const [localAudioTrack, setLocalAudioTrack] =
    useState<IMicrophoneAudioTrack | null>(null);
  const [remoteAudioTrack, setRemoteAudioTrack] =
    useState<IRemoteAudioTrack | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agentState, setAgentState] = useState<
    "not-joined" | "joining" | "listening" | "talking" | "disconnected"
  >("not-joined");

  const volumeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const agoraRTCRef = useRef<typeof AgoraRTC | null>(null);
  const rtmClientRef = useRef<InstanceType<typeof RTM.RTM> | null>(null);
  const transcriptCallbackRef = useRef<((msg: Record<string, unknown>) => void) | null>(null);
  const channelRef = useRef<string>("");
  const agentRtmUidRef = useRef<string>("");
  const messageCacheRef = useRef<Map<string, { part_idx: number; content: string }[]>>(new Map());

  // Monitor remote audio volume
  useEffect(() => {
    if (!remoteAudioTrack) {
      if (volumeIntervalRef.current) {
        clearInterval(volumeIntervalRef.current);
        volumeIntervalRef.current = null;
      }
      return;
    }

    const volumes: number[] = [];
    volumeIntervalRef.current = setInterval(() => {
      if (remoteAudioTrack && typeof remoteAudioTrack.getVolumeLevel === "function") {
        const volume = remoteAudioTrack.getVolumeLevel();
        volumes.push(volume);
        if (volumes.length > 3) volumes.shift();

        const isAllZero = volumes.length >= 2 && volumes.every((v) => v === 0);
        const hasSound = volumes.length >= 2 && volumes.some((v) => v > 0);

        if (isAllZero) {
          setIsAgentSpeaking(false);
          setAgentState("listening");
        } else if (hasSound) {
          setIsAgentSpeaking(true);
          setAgentState("talking");
        }
      }
    }, 100);

    return () => {
      if (volumeIntervalRef.current) {
        clearInterval(volumeIntervalRef.current);
        volumeIntervalRef.current = null;
      }
    };
  }, [remoteAudioTrack]);

  const joinChannel = useCallback(
    async (config: VoiceClientConfig) => {
      setAgentState("joining");

      try {
        // Dynamic import - Agora SDK requires browser
        const AgoraRTCModule = await import("agora-rtc-sdk-ng");
        const AgoraRTCInstance = AgoraRTCModule.default;
        agoraRTCRef.current = AgoraRTCInstance;

        const rtcClient = AgoraRTCInstance.createClient({
          mode: "rtc",
          codec: "vp8",
        });

        // Listen for agent audio
        rtcClient.on(
          "user-published",
          async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
            if (mediaType === "audio") {
              await rtcClient.subscribe(user, mediaType);
              user.audioTrack?.play();
              setRemoteAudioTrack(user.audioTrack || null);
              setIsAgentSpeaking(true);
              setAgentState("talking");
            }
          }
        );

        rtcClient.on(
          "user-unpublished",
          (_user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
            if (mediaType === "audio") {
              setRemoteAudioTrack(null);
              setIsAgentSpeaking(false);
              setAgentState("listening");
            }
          }
        );

        rtcClient.on("user-left", () => {
          setRemoteAudioTrack(null);
          setIsAgentSpeaking(false);
        });

        rtcClient.on("stream-message", (_uid: number, data: Uint8Array) => {
          try {
            const raw = new TextDecoder().decode(data);
            const parts = raw.split("|");

            if (parts.length === 4) {
              // v2 chunked format: messageId|partIdx|partSum|base64data
              const [msgId, partIdxStr, partSumStr, partData] = parts;
              const partIdx = parseInt(partIdxStr, 10);
              const partSum = partSumStr === "???" ? -1 : parseInt(partSumStr, 10);
              const cache = messageCacheRef.current;

              if (!cache.has(msgId)) cache.set(msgId, []);
              const chunks = cache.get(msgId)!;
              chunks.push({ part_idx: partIdx, content: partData });
              chunks.sort((a, b) => a.part_idx - b.part_idx);

              if (partSum !== -1 && chunks.length === partSum) {
                const base64 = chunks.map((c) => c.content).join("");
                const decoded = atob(base64);
                const msg = JSON.parse(decoded);
                cache.delete(msgId);
                if (msg.object && msg.text !== undefined) {
                  transcriptCallbackRef.current?.(msg);
                }
              }
            } else if (raw.startsWith("{")) {
              // Fallback: raw JSON (non-chunked)
              const msg = JSON.parse(raw);
              if (msg.object && msg.text !== undefined) {
                transcriptCallbackRef.current?.(msg);
              }
            }
          } catch {
            /* ignore malformed data */
          }
        });

        await rtcClient.join(
          config.appId,
          config.channel,
          config.token,
          config.uid
        );

        const audioTrack = await AgoraRTCInstance.createMicrophoneAudioTrack({
          encoderConfig: "high_quality_stereo",
          AEC: true,
          ANS: true,
          AGC: true,
        });

        await rtcClient.publish(audioTrack);

        // Connect RTM for text messaging
        channelRef.current = config.channel;
        agentRtmUidRef.current = config.agentRtmUid;
        try {
          const AgoraRTM = await import("agora-rtm");
          const rtm = new AgoraRTM.default.RTM(config.appId, String(config.uid));
          await rtm.login({ token: config.token ?? undefined });
          rtmClientRef.current = rtm;
        } catch (err) {
          console.warn("RTM connection failed (text messaging unavailable):", err);
        }

        setClient(rtcClient);
        setLocalAudioTrack(audioTrack);
        setIsConnected(true);
        setAgentState("listening");
      } catch (error) {
        console.error("Error joining channel:", error);
        setAgentState("disconnected");
        throw error;
      }
    },
    []
  );

  const leaveChannel = useCallback(async () => {
    try {
      if (rtmClientRef.current) {
        try {
          await rtmClientRef.current.logout();
        } catch {
          /* ignore RTM logout errors */
        }
        rtmClientRef.current = null;
      }
      if (localAudioTrack) {
        localAudioTrack.close();
      }
      if (client) {
        await client.leave();
      }

      channelRef.current = "";
      agentRtmUidRef.current = "";
      setClient(null);
      setLocalAudioTrack(null);
      setRemoteAudioTrack(null);
      setIsConnected(false);
      setIsMuted(false);
      setIsAgentSpeaking(false);
      setMessages([]);
      setAgentState("disconnected");
    } catch (error) {
      console.error("Error leaving channel:", error);
    }
  }, [client, localAudioTrack]);

  const setTranscriptCallback = useCallback(
    (cb: ((msg: Record<string, unknown>) => void) | null) => {
      transcriptCallbackRef.current = cb;
    },
    []
  );

  const sendTextMessage = useCallback(
    async (text: string) => {
      const rtm = rtmClientRef.current;
      const agentRtmUid = agentRtmUidRef.current;
      if (!rtm || !agentRtmUid) {
        console.warn("RTM not connected, cannot send text message");
        return;
      }
      try {
        const payload = JSON.stringify({ message: text.trim(), priority: "APPEND" });
        await rtm.publish(agentRtmUid, payload, {
          customType: "user.transcription",
          channelType: "USER",
        });
      } catch (err) {
        console.error("Failed to send RTM message:", err);
      }
    },
    []
  );

  const toggleMute = useCallback(async () => {
    if (!localAudioTrack) return;

    try {
      await localAudioTrack.setEnabled(isMuted);
      setIsMuted(!isMuted);
    } catch (error) {
      console.error("Error toggling mute:", error);
    }
  }, [localAudioTrack, isMuted]);

  return {
    isConnected,
    isMuted,
    isAgentSpeaking,
    agentState,
    messages,
    localAudioTrack,
    remoteAudioTrack,
    joinChannel,
    leaveChannel,
    toggleMute,
    setMessages,
    setTranscriptCallback,
    sendTextMessage,
  };
}
