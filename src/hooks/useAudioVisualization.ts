import { useState, useEffect, useRef } from "react";
import type { IMicrophoneAudioTrack } from "agora-rtc-sdk-ng";

export function useAudioVisualization(
  audioTrack: IMicrophoneAudioTrack | null,
  isActive: boolean
): number[] {
  const [frequencyData, setFrequencyData] = useState<number[]>(
    new Array(32).fill(0)
  );
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!audioTrack || !isActive) {
      setFrequencyData(new Array(32).fill(0));
      return;
    }

    try {
      const mediaStreamTrack = audioTrack.getMediaStreamTrack();
      if (!mediaStreamTrack) return;

      const stream = new MediaStream([mediaStreamTrack.clone()]);
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const update = () => {
        analyser.getByteFrequencyData(dataArray);
        setFrequencyData(Array.from(dataArray));
        animFrameRef.current = requestAnimationFrame(update);
      };

      update();
    } catch (err) {
      console.error("Audio visualization error:", err);
    }

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
      analyserRef.current = null;
    };
  }, [audioTrack, isActive]);

  return frequencyData;
}
