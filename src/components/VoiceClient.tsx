import { useState, useRef, useEffect } from "react";
import { Mic, MicOff, Phone, PhoneOff, Settings, Send, AlertTriangle } from "lucide-react";
import { useAgoraVoiceClient } from "@/hooks/useAgoraVoiceClient";
import { useAudioVisualization } from "@/hooks/useAudioVisualization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface EnvStatus {
  configured: Record<string, boolean>;
  ready: boolean;
  missing: string[];
}

export function VoiceClient() {
  const [envStatus, setEnvStatus] = useState<EnvStatus | null>(null);
  const [envLoading, setEnvLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [chatMessage, setChatMessage] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [greeting, setGreeting] = useState("");
  const [connectionTime, setConnectionTime] = useState(0);
  const [channelName, setChannelName] = useState("");
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    isConnected,
    isMuted,
    isAgentSpeaking,
    agentState,
    messages,
    localAudioTrack,
    joinChannel,
    leaveChannel,
    toggleMute,
    setMessages,
  } = useAgoraVoiceClient();

  const frequencyData = useAudioVisualization(
    localAudioTrack,
    isConnected && !isMuted
  );

  // Check env on load
  useEffect(() => {
    const checkEnv = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("check-env");
        if (error) throw error;
        setEnvStatus(data as EnvStatus);
      } catch (err) {
        console.error("Failed to check env:", err);
        setEnvStatus({ configured: {}, ready: false, missing: ["Unable to reach server"] });
      } finally {
        setEnvLoading(false);
      }
    };
    checkEnv();
  }, []);

  // Connection timer
  useEffect(() => {
    if (isConnected) {
      setConnectionTime(0);
      timerRef.current = setInterval(() => {
        setConnectionTime((t) => t + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isConnected]);

  // Auto-scroll
  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const handleConnect = async () => {
    setIsLoading(true);
    try {
      const body: Record<string, string> = {};
      if (prompt.trim()) body.prompt = prompt.trim();
      if (greeting.trim()) body.greeting = greeting.trim();

      const { data, error } = await supabase.functions.invoke("start-agent", {
        body,
      });

      if (error) throw error;
      if (!data.success) throw new Error(JSON.stringify(data));

      setAgentId(data.agentId);
      setChannelName(data.channel);

      // Add greeting message
      if (greeting.trim() || !prompt.trim()) {
        setMessages([
          {
            id: "greeting",
            role: "assistant",
            text: greeting.trim() || "Hi there! How can I help you today?",
            timestamp: Date.now(),
            isFinal: true,
          },
        ]);
      }

      await joinChannel({
        appId: data.appId,
        channel: data.channel,
        token: data.token,
        uid: Number(data.uid),
        agentUid: data.agentUid,
        agentRtmUid: data.agentRtmUid,
      });
    } catch (error) {
      console.error("Failed to connect:", error);
      alert(
        `Connection failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    await leaveChannel();
    if (agentId) {
      try {
        await supabase.functions.invoke("hangup-agent", {
          body: { agentId },
        });
      } catch (err) {
        console.error("Hangup error:", err);
      }
      setAgentId(null);
    }
  };

  const handleSendMessage = () => {
    if (!chatMessage.trim() || !isConnected) return;
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: "user",
        text: chatMessage.trim(),
        timestamp: Date.now(),
        isFinal: true,
      },
    ]);
    setChatMessage("");
  };

  // Loading state
  if (envLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Missing env vars
  if (envStatus && !envStatus.ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full border-destructive/30">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="h-6 w-6 text-destructive" />
              <h2 className="text-lg font-semibold">Configuration Required</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              The following environment variables are missing and need to be set
              in your project&apos;s Environment Variables settings:
            </p>
            <ul className="space-y-1 mb-4">
              {envStatus.missing.map((v) => (
                <li key={v} className="text-sm font-mono text-destructive">
                  • {v}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Pre-connection
  if (!isConnected) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="w-full max-w-md space-y-6">
            {/* Agent orb */}
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <div className="h-24 w-24 rounded-full bg-primary/20 flex items-center justify-center">
                  <div className="h-16 w-16 rounded-full bg-primary/40 flex items-center justify-center">
                    <div className="h-10 w-10 rounded-full bg-primary" />
                  </div>
                </div>
              </div>
              <h1 className="text-2xl font-bold tracking-tight">
                Voice AI Agent
              </h1>
              <p className="text-sm text-muted-foreground text-center">
                Talk to an AI assistant in real-time
              </p>
            </div>

            {/* Connect button */}
            <Button
              onClick={handleConnect}
              disabled={isLoading}
              className="w-full h-12 text-base gap-2"
              size="lg"
            >
              <Phone className="h-5 w-5" />
              {isLoading ? "Connecting..." : "Connect"}
            </Button>

            {/* Settings toggle */}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mx-auto"
            >
              <Settings className="h-4 w-4" />
              {showSettings ? "Hide settings" : "Customize prompt & greeting"}
            </button>

            {showSettings && (
              <div className="space-y-3 rounded-lg border p-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    System Prompt
                  </label>
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="You are a friendly voice assistant..."
                    className="resize-none"
                    rows={3}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    Greeting Message
                  </label>
                  <Input
                    value={greeting}
                    onChange={(e) => setGreeting(e.target.value)}
                    placeholder="Hi there! How can I help you today?"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Connected state
  return (
    <div className="flex h-screen flex-col bg-background overflow-hidden">
      {/* Header */}
      <header className="border-b px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "h-2.5 w-2.5 rounded-full",
              agentState === "talking"
                ? "bg-success animate-pulse"
                : "bg-primary"
            )}
          />
          <span className="text-sm font-medium">
            {channelName && (
              <span className="text-muted-foreground font-mono text-xs mr-2">
                {channelName}
              </span>
            )}
            {formatTime(connectionTime)}
          </span>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleDisconnect}
          className="gap-1.5"
        >
          <PhoneOff className="h-4 w-4" />
          End
        </Button>
      </header>

      {/* Main content */}
      <div className="flex flex-1 min-h-0 overflow-hidden flex-col md:flex-row">
        {/* Left column - Agent visualizer (desktop) */}
        <div className="hidden md:flex md:w-96 flex-col gap-4 p-4 border-r">
          {/* Visualizer orb */}
          <div className="flex-1 flex items-center justify-center">
            <div className="relative">
              <div
                className={cn(
                  "h-48 w-48 rounded-full flex items-center justify-center transition-all duration-500",
                  agentState === "talking"
                    ? "bg-primary/30 scale-110"
                    : "bg-primary/10"
                )}
              >
                <div
                  className={cn(
                    "h-32 w-32 rounded-full flex items-center justify-center transition-all duration-500",
                    agentState === "talking"
                      ? "bg-primary/50 scale-105"
                      : "bg-primary/20"
                  )}
                >
                  <div
                    className={cn(
                      "h-20 w-20 rounded-full transition-all duration-300",
                      agentState === "talking"
                        ? "bg-primary animate-pulse"
                        : "bg-primary/60"
                    )}
                  />
                </div>
              </div>
              {agentState === "talking" && (
                <>
                  <div className="absolute inset-0 rounded-full bg-primary/10 animate-ping" />
                </>
              )}
            </div>
          </div>

          {/* Status label */}
          <div className="text-center text-sm text-muted-foreground capitalize">
            {agentState === "talking"
              ? "Agent Speaking"
              : agentState === "listening"
                ? "Listening..."
                : agentState}
          </div>

          {/* Mic controls */}
          <div className="flex gap-3">
            <Button
              onClick={toggleMute}
              variant={isMuted ? "destructive" : "secondary"}
              className="flex-1 h-12 gap-2"
            >
              {isMuted ? (
                <MicOff className="h-5 w-5" />
              ) : (
                <Mic className="h-5 w-5" />
              )}
              {isMuted ? "Unmute" : "Mute"}
            </Button>
          </div>

          {/* Audio waveform */}
          {!isMuted && (
            <div className="flex items-end justify-center gap-0.5 h-8">
              {frequencyData.slice(0, 24).map((val, i) => (
                <div
                  key={i}
                  className="w-1 bg-primary/60 rounded-full transition-all duration-75"
                  style={{ height: `${Math.max(2, (val / 255) * 32)}px` }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Mobile: compact status bar */}
        <div className="flex md:hidden items-center justify-center gap-3 p-3 border-b">
          <div
            className={cn(
              "h-3 w-3 rounded-full",
              agentState === "talking"
                ? "bg-success animate-pulse"
                : "bg-primary"
            )}
          />
          <span className="text-sm font-medium">
            {agentState === "talking" ? "Agent Speaking" : "Listening"}
          </span>
        </div>

        {/* Right column - Conversation */}
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <p className="text-center text-sm text-muted-foreground mt-8">
                Start talking or type a message...
              </p>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-muted text-foreground rounded-bl-md"
                  )}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            <div ref={conversationEndRef} />
          </div>

          {/* Text input */}
          <div className="border-t p-3 flex gap-2 flex-shrink-0">
            <Input
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="Type a message..."
              className="flex-1"
            />
            <Button
              onClick={handleSendMessage}
              disabled={!chatMessage.trim()}
              size="icon"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>

          {/* Mobile: bottom controls */}
          <div className="flex md:hidden gap-3 p-3 border-t">
            <Button
              onClick={toggleMute}
              variant={isMuted ? "destructive" : "secondary"}
              className="flex-1 h-12"
            >
              {isMuted ? (
                <MicOff className="h-5 w-5" />
              ) : (
                <Mic className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default VoiceClient;
