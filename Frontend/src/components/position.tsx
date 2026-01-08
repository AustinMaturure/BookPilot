import { useEffect, useState } from "react";
import { createOutline, generateFollowupQuestion } from "../utils/api";
import card2 from "../assets/Branding/Card2.png"

type Message = { from: "AI" | "user"; text: string };
type TalkingPoint = { id?: number; text: string; order?: number; content?: string };
type Section = { id?: number; title: string; order?: number; talking_points: TalkingPoint[] };
type Chapter = { id?: number; title: string; order?: number; sections: Section[] };
export type BookOutline = { id?: number; title: string; chapters: Chapter[] };

type PositionProps = {
  initialOutline?: BookOutline | null;
  onOutlineUpdate?: (outline: BookOutline) => void;
  showInlineOutline?: boolean;
  bookId?: number;
  bookData?: { core_topic?: string; audience?: string } | null;
};

export default function Position({
  initialOutline = null,
  onOutlineUpdate,
  bookId,
  bookData = null,
}: PositionProps) {
  type QuestionConfig = {
    question: string;
    minLength: number;
    key: string;
  };

  const questionConfigs: QuestionConfig[] = [
    {
      question: "Hi! I'm your BookPilot coach. Let's start with the basics. What is the core topic you want to write about?",
      minLength: 20,
      key: "core_topic"
    },
    {
      question: "That's interesting! Why does this topic matter to you personally? What's your connection to it?",
      minLength: 30,
      key: "personal_connection"
    },
    {
      question: "Got it. Now, who is your ideal reader? Be as specific as possible - think about their age, profession, challenges, and goals.",
      minLength: 40,
      key: "ideal_reader"
    },
    {
      question: "What is the biggest challenge or problem your ideal reader is facing right now related to this topic?",
      minLength: 30,
      key: "main_challenge"
    },
    {
      question: "What are the common misconceptions or mistakes people have about this topic?",
      minLength: 30,
      key: "misconceptions"
    },
    {
      question: "Why haven't existing solutions or approaches worked for your readers so far?",
      minLength: 30,
      key: "existing_solutions"
    },
    {
      question: "What is your unique approach or solution to this problem? What makes your perspective different?",
      minLength: 40,
      key: "unique_approach"
    },
    {
      question: "If your reader could only take away one key insight or transformation from your book, what would it be?",
      minLength: 30,
      key: "key_insight"
    },
    {
      question: "Let's think about structure. What are the 3-5 main parts or sections your book will cover? Think about the journey you want to take your reader on.",
      minLength: 50,
      key: "book_structure"
    }
  ];

  const [messages, setMessages] = useState<Message[]>([
    { from: "AI", text: questionConfigs[0].question }
  ]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [userMessage, setUserMessage] = useState("");
  const [answers, setAnswers] = useState<{ question: string; answer: string; key: string }[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [needsFollowUp, setNeedsFollowUp] = useState(false);

  // Extract insights from answers or use saved book data
  const coreTopic = bookData?.core_topic || answers.find(a => a.key === "core_topic")?.answer || "Not yet defined";
  const audienceAnswers = answers.filter(a => a.key === "ideal_reader").map(a => a.answer);
  const audience = bookData?.audience 
    ? bookData.audience.split(";").map(a => a.trim()).filter(a => a.length > 0)
    : audienceAnswers;
  const goal = "50k words"; // Placeholder


  useEffect(() => {
    if (!isGenerating) {
      setIsTyping(false);
    }
  }, [messages, isGenerating]);

  const validateAnswer = (answer: string, config: QuestionConfig): boolean => {
    return answer.trim().length >= config.minLength;
  };

  const sendMessage = async () => {
    const trimmed = userMessage.trim();
    if (!trimmed || isGenerating) return;

    const currentConfig = questionConfigs[questionIndex];
    const isValid = validateAnswer(trimmed, currentConfig);

    const userBubble: Message = { from: "user", text: trimmed };
    const newMessages: Message[] = [...messages, userBubble];
    setUserMessage("");

    // If answer is too short and we haven't asked follow-up yet, generate a dynamic follow-up question
    if (!isValid && !needsFollowUp) {
      // Save the initial answer first (even if short)
      const initialAnswer = { question: currentConfig.question, answer: trimmed, key: currentConfig.key };
      setAnswers([...answers, initialAnswer]);
      setNeedsFollowUp(true);
      
      // Add user's message to the chat first - use functional update to ensure it's added
      setMessages((prev) => [...prev, userBubble]);
      
      // Small delay to ensure user message is rendered before showing typing indicator
      setTimeout(() => {
        setIsTyping(true);
        
        // Generate follow-up question using AI
        generateFollowupQuestion({
          question: currentConfig.question,
          answer: trimmed,
          context: answers.map(a => ({ question: a.question, answer: a.answer }))
        }).then((followupResult) => {
          if (followupResult.success && followupResult.data.followup_question) {
            setTimeout(() => {
              setMessages((prev) => [...prev, { from: "AI", text: "..." }]);
              setTimeout(() => {
                setMessages((prev) => {
                  const trimmedPrev = prev.filter((m, idx) => !(idx === prev.length - 1 && m.text === "..."));
                  return [...trimmedPrev, { from: "AI", text: followupResult.data.followup_question }];
                });
                setIsTyping(false);
              }, 1200);
            }, 800);
          } else {
            // Fallback if AI generation fails
            setMessages((prev) => [...prev, { from: "AI", text: "Can you tell me a bit more about that? I'd love to understand this better." }]);
            setIsTyping(false);
          }
        }).catch((_error) => {
          // Fallback on error
          setMessages((prev) => [...prev, { from: "AI", text: "Can you elaborate a bit more? I'd like to understand this better." }]);
          setIsTyping(false);
        });
      }, 100);
      return;
    }

    // Save the answer (combine with previous if follow-up)
    const existingAnswer = answers.find(a => a.key === currentConfig.key);
    let finalAnswer = trimmed;
    if (existingAnswer && needsFollowUp) {
      // Combine the follow-up answer with the initial answer
      finalAnswer = `${existingAnswer.answer} ${trimmed}`;
    }

    const updatedAnswers = existingAnswer
      ? answers.map(a => a.key === currentConfig.key ? { ...a, answer: finalAnswer } : a)
      : [...answers, { question: currentConfig.question, answer: finalAnswer, key: currentConfig.key }];
    
    setAnswers(updatedAnswers);
    
    // Check if combined answer is now valid
    const combinedIsValid = validateAnswer(finalAnswer, currentConfig);
    
    // If still not valid after follow-up, ask another follow-up
    if (!combinedIsValid && needsFollowUp) {
      // Add user's follow-up answer to messages first - use functional update
      setMessages((prev) => [...prev, userBubble]);
      
      // Small delay to ensure user message is rendered
      setTimeout(() => {
        setIsTyping(true);
        generateFollowupQuestion({
          question: currentConfig.question,
          answer: finalAnswer,
          context: updatedAnswers.map(a => ({ question: a.question, answer: a.answer }))
        }).then((followupResult) => {
          if (followupResult.success && followupResult.data.followup_question) {
            setTimeout(() => {
              setMessages((prev) => [...prev, { from: "AI", text: "..." }]);
              setTimeout(() => {
                setMessages((prev) => {
                  const trimmedPrev = prev.filter((m, idx) => !(idx === prev.length - 1 && m.text === "..."));
                  return [...trimmedPrev, { from: "AI", text: followupResult.data.followup_question }];
                });
                setIsTyping(false);
              }, 1200);
            }, 800);
          } else {
            setMessages((prev) => [...prev, { from: "AI", text: "I'd love to hear a bit more detail on this. Can you expand on that?" }]);
            setIsTyping(false);
          }
        }).catch((_error) => {
          setMessages((prev) => [...prev, { from: "AI", text: "Can you provide a bit more detail?" }]);
          setIsTyping(false);
        });
      }, 100);
      return;
    }
    
    setNeedsFollowUp(false);

    // Move to next question or generate outline
    if (questionIndex < questionConfigs.length - 1) {
      setMessages(newMessages);
      setIsTyping(true);
      const nextIndex = questionIndex + 1;
      const nextQuestion = questionConfigs[nextIndex].question;
      setTimeout(() => {
        setMessages((prev) => [...prev, { from: "AI", text: "..." }]);
        setTimeout(() => {
          setMessages((prev) => {
            const trimmedPrev = prev.filter((m, idx) => !(idx === prev.length - 1 && m.text === "..."));
            return [...trimmedPrev, { from: "AI", text: nextQuestion }];
          });
          setIsTyping(false);
        }, 1200);
      }, 800);
      setQuestionIndex(nextIndex);
      return;
    }

    // All questions answered - generate outline
    setMessages([...newMessages, { from: "AI", text: "Perfect! I have all the information I need. Generating your comprehensive book outline now..." }]);
    setIsGenerating(true);
    setIsTyping(false);

    try {
      const result = await createOutline({ answers: updatedAnswers, book_id: bookId });
      if (!result.success) {
        throw new Error(result.error || "Failed to generate outline");
      }

      onOutlineUpdate?.(result.data);
      setMessages((prev) => [...prev, { from: "AI", text: "Here's your outline! You can now view and edit it in the Outline tab." }]);
    } catch (error) {
      setMessages([
        ...newMessages,
        { from: "AI", text: "Sorry, I couldn't generate the outline. Please try again." }
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Calculate progress based on question index
  const progress = Math.min(((questionIndex + 1) / questionConfigs.length) * 100, 100);
  const currentStep = Math.min(Math.ceil((questionIndex + 1) / 2), 5);

  return (
    <div className="flex h-full bg-[#0a1a2e]">
      {/* Left Sidebar - Progress */}
      <div className="w-20 bg-[#1a2a3a] border-r border-[#2d3a4a] flex flex-col items-center py-6 justify-center">
        <div className="mb-6 flex flex-col items-center justify-center">
          <div className="text-[#4ade80] text-xs font-semibold mb-2 text-center" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
            PROGRESS
          </div>
          <div className="relative w-4 h-64 bg-[#2d3a4a] rounded-full">
            <div 
              className="absolute bottom-0 w-full bg-[#4ade80] rounded-full transition-all duration-300"
              style={{ height: `${progress}%` }}
            />
          </div>
          <div className="text-white text-sm font-bold mt-2 text-center">{Math.round(progress)}%</div>
        </div>
        
        {/* Step Indicators */}
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4, 5].map((step) => (
            <div
              key={step}
              className={`w-3 h-3 rounded-full ${
                step <= currentStep ? "bg-[#4ade80]" : "bg-[#2d3a4a]"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-white rounded-tl-3xl">
        <div className="flex-1 overflow-y-auto p-8 space-y-4">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex items-start gap-3 ${
                msg.from === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {msg.from === "AI" && (
                <div className="shrink-0 w-10 h-10 rounded-full bg-[#4ade80] flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              )}
              <div
                className={`max-w-2xl rounded-3xl px-6 py-4 ${
                  msg.from === "user"
                    ? "bg-[#58A4B0] text-white rounded-br-none"
                    : "bg-gray-100 text-gray-900 rounded-bl-none"
                }`}
              >
                <div className="font-medium mb-1">{msg.from === "AI" ? "BookPilot coach" : ""}</div>
                <div className="whitespace-pre-wrap">{msg.text}</div>
              </div>
              {msg.from === "user" && (
                <div className="shrink-0 w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center">
                  <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              )}
            </div>
          ))}
          {isTyping && (
            <div className="flex items-start gap-3 justify-start">
              <div className="shrink-0 w-10 h-10 rounded-full bg-[#4ade80] flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="bg-gray-100 rounded-3xl rounded-bl-none px-6 py-4">
                <span className="inline-flex gap-1">
                  <span className="w-2 h-2 bg-gray-500 rounded-full animate-pulse"></span>
                  <span className="w-2 h-2 bg-gray-500 rounded-full animate-pulse delay-150"></span>
                  <span className="w-2 h-2 bg-gray-500 rounded-full animate-pulse delay-300"></span>
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="border-t border-gray-200 p-6">
          <div className="flex items-center gap-4 max-w-4xl mx-auto">
            {/* Voice Button */}
            <button
              className="shrink-0 w-16 h-16 rounded-full bg-[#4ade80] flex items-center justify-center shadow-lg hover:shadow-xl transition-shadow relative"
              style={{
                boxShadow: "0 0 20px rgba(74, 222, 128, 0.5)"
              }}
            >
              <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            </button>

            {/* Text Input */}
            <div className="flex-1 relative">
              <input
                type="text"
                value={userMessage}
                onChange={(e) => setUserMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={isGenerating}
                className="w-full px-6 py-4 pr-12 border-2 border-gray-300 rounded-2xl focus:outline-none focus:border-[#4ade80] text-gray-900"
                placeholder="Or type your answer here..."
              />
              <button
                onClick={sendMessage}
                disabled={isGenerating || !userMessage.trim()}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4ade80] hover:text-[#3bc96d] disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right Sidebar - Live Insights */}
      <div className="w-80 border-l border-[#2d4a5a] overflow-y-auto relative" style={{
        backgroundImage: `url(${card2})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }}>
        {/* Pattern overlay */}
        <div className="absolute inset-0 opacity-30" style={{
          backgroundImage: `
            radial-gradient(circle at 20% 30%, rgba(79, 209, 197, 0.3) 0%, transparent 50%),
            radial-gradient(circle at 80% 70%, rgba(79, 209, 197, 0.2) 0%, transparent 50%),
            linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px),
            linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px)
          `,
          backgroundSize: '100% 100%, 100% 100%, 20px 20px, 20px 20px',
          backgroundPosition: '0 0, 0 0, 0 0, 0 0'
        }} />
        
        <div className="relative z-10 p-6 relative">
          {/* Header with green background */}
          <div className=" rounded-t-xl  mb-6">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <h3 className="text-yellow-400 font-bold text-sm uppercase tracking-wide">LIVE INSIGHTS</h3>
            </div>
            <h4 className="text-white font-semibold text-md">{initialOutline?.title || "Book Bible"}</h4>
            
          </div>
         
          

          {/* Goal Card - Glossy Bubble */}
          <div className="mb-4 backdrop-blur-md bg-white/10 rounded-xl p-4 border border-white/20 shadow-lg" style={{
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%)',
            boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37), inset 0 1px 0 0 rgba(255, 255, 255, 0.2)'
          }}>
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-5 h-5 text-[#4ade80]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-gray-300 text-xs font-medium uppercase tracking-wide">GOAL</span>
            </div>
            <div className="text-white text-4xl font-bold mb-2">{goal}</div>
            <div className="w-full bg-white/10 rounded-full h-2 backdrop-blur-sm">
              <div className="bg-[#4ade80] h-2 rounded-full shadow-lg" style={{ width: "20%" }} />
            </div>
          </div>

          {/* Core Topic Card - Glossy Bubble */}
          <div className="mb-4 backdrop-blur-md bg-white/10 rounded-xl p-4 border border-white/20 shadow-lg" style={{
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%)',
            boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37), inset 0 1px 0 0 rgba(255, 255, 255, 0.2)'
          }}>
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-5 h-5 text-[#4ade80]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <span className="text-gray-300 text-xs font-medium uppercase tracking-wide">CORE TOPIC</span>
            </div>
            <p className="text-white text-sm leading-relaxed">{coreTopic}</p>
          </div>

          {/* Audience Card - Glossy Bubble */}
          <div className="mb-4 backdrop-blur-md bg-white/10 rounded-xl p-4 border border-white/20 shadow-lg" style={{
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%)',
            boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37), inset 0 1px 0 0 rgba(255, 255, 255, 0.2)'
          }}>
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-5 h-5 text-[#4ade80]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <span className="text-gray-300 text-xs font-medium uppercase tracking-wide">AUDIENCE</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {audience.length > 0 ? (
                audience.map((aud, idx) => (
                  <span
                    key={idx}
                    className={`px-3 py-2 rounded-lg text-xs font-medium backdrop-blur-sm ${
                      idx === 0
                        ? "bg-[#4ade80] text-[#0a1a2e] shadow-lg"
                        : "bg-white/10 text-gray-200 border border-white/20"
                    }`}
                  >
                    {aud.charAt(0).toUpperCase() + aud.slice(1)}
                  </span>
                ))
              ) : (
                <span className="text-gray-400 text-sm">Not yet defined</span>
              )}
            </div>
          </div>

          {/* Quote Card - Glossy Bubble */}
          <div className="backdrop-blur-md bg-white/10 rounded-xl p-4 border border-white/20 shadow-lg" style={{
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%)',
            boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37), inset 0 1px 0 0 rgba(255, 255, 255, 0.2)'
          }}>
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-[#4ade80] shrink-0 mt-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 9.064-9.57V3.055c-3.219.348-5.891 2.789-5.891 6.748v7.285h6.458V21h-9.631zm-14.017 0v-7.391c0-5.704 3.748-9.57 9.069-9.57V3.055c-3.219.348-5.89 2.789-5.89 6.748v7.285h6.453V21H0z" />
              </svg>
              <p className="text-gray-200 text-sm italic leading-relaxed">
                "The garden that is finished is dead." - H.E. Bates
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
