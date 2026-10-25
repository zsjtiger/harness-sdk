import { useEffect, useRef, useState } from "react";

// The parts of the Web Speech API this app uses. It is not in the DOM typings, and Chromium exposes it under a
// prefix.
interface Recognition {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionConstructor = new () => Recognition;

interface SpeechWindow {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
}

const RecognitionClass: RecognitionConstructor | undefined =
  typeof window === "undefined"
    ? undefined
    : (window as unknown as SpeechWindow).SpeechRecognition ??
      (window as unknown as SpeechWindow).webkitSpeechRecognition;

interface VoiceHandlers {
  onTranscript(text: string): void;
  onError(message: string): void;
}

// Voice input through the browser's speech recognition. `supported` is false where the API is missing.
export function useVoice(handlers: VoiceHandlers) {
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!RecognitionClass) return;
    const instance = new RecognitionClass();
    instance.lang = navigator.language || "en-US";
    instance.interimResults = false;
    instance.onresult = (event) => handlersRef.current.onTranscript(event.results[0][0].transcript);
    instance.onend = () => setListening(false);
    instance.onerror = (event) => handlersRef.current.onError(`Voice input failed: ${event.error}`);
    recognition.current = instance;
    return () => instance.stop();
  }, []);

  function toggle() {
    const instance = recognition.current;
    if (!instance) return;
    if (listening) {
      instance.stop();
      return;
    }
    setListening(true);
    instance.start();
  }

  return { supported: RecognitionClass !== undefined, listening, toggle };
}
