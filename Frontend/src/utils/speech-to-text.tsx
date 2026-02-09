import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';
import { useEffect, useRef } from 'react';
import micIcon from '../assets/mic.svg';
import stopIcon from '../assets/stop.svg';

type Props = {
  onTranscript: (text: string) => void;
  onListeningChange: (listening: boolean) => void;
};

const SpeechToText = ({ onTranscript, onListeningChange }: Props) => {
  const {
    finalTranscript,
    listening,
    browserSupportsSpeechRecognition,
    resetTranscript,
  } = useSpeechRecognition();

  // Keeps track of what we've already emitted
  const lastFinalRef = useRef('');

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
    onListeningChange(listening);
  }, [listening, onListeningChange]);

  if (!browserSupportsSpeechRecognition) return null;

  const toggleListening = () => {
    if (listening) {
      SpeechRecognition.stopListening();
    } else {
      resetTranscript();
      lastFinalRef.current = '';
      SpeechRecognition.startListening({
        continuous: true,
        language: 'en-US',
      });
    }
  };

  return (
    <button
      onClick={toggleListening}
      title={listening ? 'Stop recording' : 'Start recording'}
      className={`shrink-0 w-12 h-12 flex items-center justify-center rounded-xl border-2 transition-all
        ${
          listening
            ? 'border-[#CDF056] bg-[#CDF056]/50 animate-pulse'
            : 'border-gray-300 bg-white hover:border-[#CDF056]'
        }`}
    >
      <img
        src={listening ? stopIcon : micIcon}
        alt="Mic"
        className="w-6 h-6"
      />
    </button>
  );
};

export default SpeechToText;
