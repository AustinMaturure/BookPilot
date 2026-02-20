import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';
import { useEffect, useRef, useState } from 'react';
import micIcon from '../assets/mic.svg';
import stopIcon from '../assets/stop.svg';

type Props = {
  onTranscript: (text: string) => void;
  onListeningChange: (listening: boolean) => void;
  onError?: (message: string) => void;
};

const SpeechToText = ({ onTranscript, onListeningChange, onError }: Props) => {
  const {
    finalTranscript,
    listening,
    browserSupportsSpeechRecognition,
    resetTranscript,
  } = useSpeechRecognition();

  const lastFinalRef = useRef('');
  const [userRequestedStop, setUserRequestedStop] = useState(false);

  useEffect(() => {
    if (!finalTranscript) return;

    // Get only the NEW part
    const newText = finalTranscript.replace(lastFinalRef.current, '');

    if (newText.trim()) {
      onTranscript(newText.trim());
      lastFinalRef.current = finalTranscript;
    }
  }, [finalTranscript, onTranscript]);

  useEffect(() => {
    onListeningChange(userRequestedStop ? false : listening);
  }, [listening, userRequestedStop, onListeningChange]);

  useEffect(() => {
    if (!listening) setUserRequestedStop(false);
  }, [listening]);

  // Stop recording when user leaves the tab (switches tab, minimizes, etc.)
  useEffect(() => {
    const stopRecording = async () => {
      if (!listening) return;
      setUserRequestedStop(true);
      onListeningChange(false);
      try {
        if (SpeechRecognition.abortListening) {
          await SpeechRecognition.abortListening();
        } else {
          const recognition = SpeechRecognition.getRecognition?.();
          recognition?.abort?.();
        }
      } catch {
        try {
          const recognition = SpeechRecognition.getRecognition?.();
          recognition?.abort?.();
          recognition?.stop?.();
        } catch {
          // Ignore
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && listening) {
        stopRecording();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [listening, onListeningChange]);

  // Optimistic display: show stopped immediately when user clicks, don't wait for API
  const displayListening = listening && !userRequestedStop;

  // Web Speech API requires secure context (HTTPS) in production
  const isSecureContext = typeof window !== 'undefined' && window.isSecureContext;
  const canUseSpeech = browserSupportsSpeechRecognition && isSecureContext;

  if (!canUseSpeech) return null;

  const toggleListening = async () => {
    if (displayListening) {
      setUserRequestedStop(true);
      onListeningChange(false);
      try {
        // Must await - abortListening is async; without await, recording may not stop in production
        if (SpeechRecognition.abortListening) {
          await SpeechRecognition.abortListening();
        } else {
          const recognition = SpeechRecognition.getRecognition?.();
          if (recognition?.abort) {
            recognition.abort();
          }
        }
      } catch {
        // Fallback: try raw recognition abort/stop
        try {
          const recognition = SpeechRecognition.getRecognition?.();
          if (recognition) {
            recognition.abort?.();
            recognition.stop?.();
          }
        } catch {
          // Ignore - UI already shows stopped
        }
      }
    } else {
      setUserRequestedStop(false);
      resetTranscript();
      lastFinalRef.current = '';
      try {
        await SpeechRecognition.startListening({
          continuous: true,
          language: 'en-US',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Speech recognition failed';
        onError?.(msg);
      }
    }
  };

  return (
    <button
      onClick={toggleListening}
      title={displayListening ? 'Stop recording' : 'Start recording'}
      className={`shrink-0 w-12 h-12 flex items-center justify-center rounded-xl border-2 transition-all
        ${
          displayListening
            ? 'border-[#CDF056] bg-[#CDF056]/50 animate-pulse'
            : 'border-gray-300 bg-white hover:border-[#CDF056]'
        }`}
    >
      <img
        src={displayListening ? stopIcon : micIcon}
        alt="Mic"
        className="w-6 h-6"
      />
    </button>
  );
};

export default SpeechToText;
