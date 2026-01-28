import { useEffect, useState, useRef } from "react";
import { 
  initializePillars, 
  getPillars, 
  getPillarChat, 
  sendPillarMessage, 
  markPillarComplete,
  resetPillar,
  getPositioningBrief,
  createOutline,
  type PositioningPillar,
  type PillarChatMessage,
  type PillarsListResponse,
  type PillarStateEmission,
} from "../utils/api";
import card2 from "../assets/Branding/Card2.png";

// Types
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
  onSwitchTab?: (tab: string) => void;
};

// Pillar icon mapping
const PILLAR_ICONS: Record<string, string> = {
  business_core: "💼",
  avatar: "👤",
  emotional_resonance: "💓",
  north_star: "⭐",
  pain_points: "🎯",
  the_shift: "🔄",
  the_edge: "⚔️",
  the_foundation: "🏗️",
  the_authority: "👑",
};

// Pillar color mapping (for visual distinction)
const PILLAR_COLORS: Record<string, string> = {
  business_core: "#3B82F6", // blue
  avatar: "#8B5CF6", // purple
  emotional_resonance: "#EC4899", // pink
  north_star: "#F59E0B", // amber
  pain_points: "#EF4444", // red
  the_shift: "#10B981", // green
  the_edge: "#6366F1", // indigo
  the_foundation: "#14B8A6", // teal
  the_authority: "#F97316", // orange
};

export default function Position({
  initialOutline = null,
  onOutlineUpdate,
  bookId,
  onSwitchTab,
}: PositionProps) {
  // Pillar state
  const [pillarsData, setPillarsData] = useState<PillarsListResponse | null>(null);
  const [activePillar, setActivePillar] = useState<PositioningPillar | null>(null);
  const [chatMessages, setChatMessages] = useState<PillarChatMessage[]>([]);
  const [userMessage, setUserMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [stateEmission, setStateEmission] = useState<PillarStateEmission | null>(null);
  const [showBriefModal, setShowBriefModal] = useState(false);
  const [briefContent, setBriefContent] = useState<string | null>(null);
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Initialize pillars on mount
  useEffect(() => {
    if (bookId) {
      initializePillarsForBook();
    }
  }, [bookId]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [chatMessages, isTyping]);

  // Focus input when pillar changes
  useEffect(() => {
    if (activePillar && inputRef.current) {
      inputRef.current.focus();
    }
  }, [activePillar]);

  const initializePillarsForBook = async () => {
    if (!bookId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Initialize pillars (idempotent)
      const initResult = await initializePillars(bookId);
      if (initResult.success && initResult.data) {
        setPillarsData(initResult.data);
        
        // Set state emission from response
        setStateEmission({
          current_pillar: initResult.data.current_pillar || "",
          progress_percentage: initResult.data.progress_percentage,
          pillars_completed: initResult.data.pillars_completed,
        });
        
        // Find and load the current active pillar
        const currentPillar = initResult.data.pillars.find(p => p.status === "ACTIVE");
        if (currentPillar) {
          await loadPillarChat(currentPillar);
        } else if (initResult.data.all_pillars_complete) {
          // All complete - show completion state
          setActivePillar(null);
        }
      } else {
        setError(initResult.error || "Failed to initialize pillars");
      }
    } catch (err) {
      setError("Failed to initialize positioning pillars");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadPillarChat = async (pillar: PositioningPillar) => {
    setActivePillar(pillar);
    setChatMessages([]);
    
    try {
      const chatResult = await getPillarChat(pillar.id);
      if (chatResult.success && chatResult.data) {
        setChatMessages(chatResult.data.messages);
        if (chatResult.data.state_emission) {
          setStateEmission(chatResult.data.state_emission);
        }
      }
    } catch (err) {
      console.error("Failed to load pillar chat:", err);
    }
  };

  const handleSelectPillar = async (pillar: PositioningPillar) => {
    if (pillar.status === "LOCKED") {
      return; // Can't select locked pillars
    }
    await loadPillarChat(pillar);
  };

  const sendMessage = async () => {
    const trimmed = userMessage.trim();
    if (!trimmed || isSending || !activePillar) return;

    const userBubble: PillarChatMessage = { role: "user", content: trimmed, state_emission: null };
    setChatMessages(prev => [...prev, userBubble]);
    setUserMessage("");
    setIsSending(true);
    setIsTyping(true);

    try {
      const result = await sendPillarMessage(activePillar.id, trimmed);
      
      if (result.success && result.data) {
        const { message, state_emission, pillar_status } = result.data;
        
        // Add AI response to chat
        setChatMessages(prev => [...prev, message]);
        
        // Update state emission
        if (state_emission) {
          setStateEmission(state_emission);
        }
        
        // If pillar was marked complete, refresh pillars list
        if (pillar_status === "COMPLETE") {
          await refreshPillars();
        }
      } else {
        // Show error in chat
        setChatMessages(prev => [...prev, {
          role: "assistant",
          content: "I apologize, but I encountered an error. Please try again.",
          state_emission: null
        }]);
      }
    } catch (err) {
      console.error("Error sending message:", err);
      setChatMessages(prev => [...prev, {
        role: "assistant",
        content: "I apologize, but I encountered an error. Please try again.",
        state_emission: null
      }]);
    } finally {
      setIsSending(false);
      setIsTyping(false);
    }
  };

  const refreshPillars = async () => {
    if (!bookId) return;
    
    const result = await getPillars(bookId);
    if (result.success && result.data) {
      setPillarsData(result.data);
      setStateEmission({
        current_pillar: result.data.current_pillar || "",
        progress_percentage: result.data.progress_percentage,
        pillars_completed: result.data.pillars_completed,
      });
      
      // If current pillar was completed, switch to next active
      if (activePillar && result.data.pillars.find(p => p.id === activePillar.id)?.status === "COMPLETE") {
        const nextActive = result.data.pillars.find(p => p.status === "ACTIVE");
        if (nextActive) {
          await loadPillarChat(nextActive);
        } else {
          // All complete
          setActivePillar(null);
        }
      }
    }
  };

  const handleMarkComplete = async () => {
    if (!activePillar) return;
    
    const result = await markPillarComplete(activePillar.id);
    if (result.success) {
      await refreshPillars();
    } else {
      setError(result.error || "Could not mark pillar as complete. Need more depth.");
    }
  };

  const handleResetPillar = async () => {
    if (!activePillar) return;
    
    if (!confirm(`Reset "${activePillar.name}"? This will clear all conversation history.`)) {
      return;
    }
    
    const result = await resetPillar(activePillar.id);
    if (result.success) {
      await loadPillarChat(activePillar);
      await refreshPillars();
    }
  };

  const handleViewBrief = async () => {
    if (!bookId) return;
    
    const result = await getPositioningBrief(bookId);
    if (result.success && result.data) {
      setBriefContent(result.data.brief);
      setShowBriefModal(true);
    } else {
      setError(result.error || "Could not load positioning brief");
    }
  };

  const handleGenerateOutline = async () => {
    if (!bookId || !pillarsData?.all_pillars_complete) return;
    
    setIsGeneratingOutline(true);
    setError(null);
    
    try {
      const result = await createOutline({ answers: [], book_id: bookId });
      if (result.success && result.data) {
        onOutlineUpdate?.(result.data);
        onSwitchTab?.("outline");
      } else {
        setError(result.error || "Failed to generate outline");
      }
    } catch (err) {
      setError("Failed to generate outline");
      console.error(err);
    } finally {
      setIsGeneratingOutline(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Calculate progress from state emission or pillars data
  const progress = stateEmission?.progress_percentage || 0;
  const completedPillars = stateEmission?.pillars_completed || [];
  const allComplete = pillarsData?.all_pillars_complete || false;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0a1a2e]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#CDF056] mx-auto mb-4"></div>
          <p className="text-white">Initializing positioning engine...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-[#0a1a2e]">
      {/* Left Sidebar - Pillar Navigation */}
      <div className="w-72 bg-[#1a2a3a] border-r border-[#2d3a4a] flex flex-col mt-10 overflow-hidden">
        {/* Progress Header */}
        <div className="p-4 border-b border-[#2d3a4a]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[#CDF056] text-xs font-semibold uppercase tracking-wide">
              POSITIONING PROGRESS
            </span>
            <span className="text-white text-sm font-bold">{Math.round(progress)}%</span>
          </div>
          <div className="relative w-full h-2 bg-[#2d3a4a] rounded-full overflow-hidden">
            <div 
              className="absolute left-0 top-0 h-full bg-gradient-to-r from-[#CDF056] to-[#4ade80] rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-gray-400 text-xs mt-2">
            {completedPillars.length}/9 pillars complete
          </p>
        </div>
        
        {/* Pillars List */}
        <div className="flex-1 overflow-y-auto p-2">
          {pillarsData?.pillars.map((pillar) => {
            const isActive = activePillar?.id === pillar.id;
            const isComplete = pillar.status === "COMPLETE";
            const isLocked = pillar.status === "LOCKED";
            
            return (
              <button
                key={pillar.id}
                onClick={() => handleSelectPillar(pillar)}
                disabled={isLocked}
                className={`w-full text-left p-3 rounded-lg mb-2 transition-all duration-200 ${
                  isActive 
                    ? "bg-[#CDF056]/20 border-l-4 border-[#CDF056]" 
                    : isComplete
                    ? "bg-green-500/10 hover:bg-green-500/20 border-l-4 border-green-500"
                    : isLocked
                    ? "bg-gray-800/50 opacity-50 cursor-not-allowed"
                    : "bg-[#2d3a4a]/50 hover:bg-[#2d3a4a]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">
                    {isComplete ? "✅" : isLocked ? "🔒" : PILLAR_ICONS[pillar.slug] || "📌"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className={`font-medium text-sm truncate ${
                        isActive ? "text-[#CDF056]" : isComplete ? "text-green-400" : isLocked ? "text-gray-500" : "text-white"
                      }`}>
                        {pillar.name}
                      </span>
                      {pillar.depth_score > 0 && (
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          pillar.depth_score >= 80 ? "bg-green-500/20 text-green-400" :
                          pillar.depth_score >= 50 ? "bg-yellow-500/20 text-yellow-400" :
                          "bg-red-500/20 text-red-400"
                        }`}>
                          {Math.round(pillar.depth_score)}%
                        </span>
                      )}
                    </div>
                    <p className={`text-xs mt-0.5 truncate ${
                      isLocked ? "text-gray-600" : "text-gray-400"
                    }`}>
                      {pillar.description?.slice(0, 50)}...
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        
        {/* All Complete Actions */}
        {allComplete && (
          <div className="p-4 border-t border-[#2d3a4a] space-y-2">
            <button
              onClick={handleViewBrief}
              className="w-full py-2 px-4 bg-[#2d3a4a] hover:bg-[#3d4a5a] text-white rounded-lg text-sm font-medium transition-colors"
            >
              📄 View Positioning Brief
            </button>
            <button
              onClick={handleGenerateOutline}
              disabled={isGeneratingOutline}
              className="w-full py-3 px-4 bg-[#CDF056] hover:bg-[#b8e050] text-[#0a1a2e] rounded-lg font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGeneratingOutline ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin h-4 w-4 border-2 border-[#0a1a2e] border-t-transparent rounded-full"></span>
                  Generating...
                </span>
              ) : (
                "🚀 Generate Book Outline"
              )}
            </button>
          </div>
        )}
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-white rounded-tl-3xl mt-10">
        {/* Chat Header */}
        {activePillar && (
          <div className="border-b border-gray-200 p-4 flex items-center justify-between"
            style={{ borderLeftColor: PILLAR_COLORS[activePillar.slug], borderLeftWidth: "4px" }}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{PILLAR_ICONS[activePillar.slug]}</span>
              <div>
                <h2 className="font-bold text-gray-900">{activePillar.name}</h2>
                <p className="text-sm text-gray-500">{activePillar.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {activePillar.status === "ACTIVE" && (
                <>
                  <button
                    onClick={handleMarkComplete}
                    className="px-3 py-1.5 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg text-sm font-medium transition-colors"
                  >
                    Mark Complete ✓
                  </button>
                  <button
                    onClick={handleResetPillar}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                  >
                    Reset
                  </button>
                </>
              )}
              {activePillar.status === "COMPLETE" && (
                <span className="px-3 py-1.5 bg-green-100 text-green-700 rounded-lg text-sm font-medium">
                  ✅ Complete
                </span>
              )}
            </div>
          </div>
        )}

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* All Complete State */}
          {allComplete && !activePillar && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-6xl mb-4">🎉</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">All Pillars Complete!</h2>
              <p className="text-gray-600 mb-6 max-w-md">
                You've completed all 9 positioning pillars. Your strategic foundation is solid. 
                You can now generate your book outline or review your positioning brief.
              </p>
              <div className="flex gap-4">
                <button
                  onClick={handleViewBrief}
                  className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-900 rounded-xl font-medium transition-colors"
                >
                  View Brief
                </button>
                <button
                  onClick={handleGenerateOutline}
                  disabled={isGeneratingOutline}
                  className="px-6 py-3 bg-[#CDF056] hover:bg-[#b8e050] text-[#0a1a2e] rounded-xl font-bold transition-colors disabled:opacity-50"
                >
                  {isGeneratingOutline ? "Generating..." : "Generate Outline →"}
                </button>
              </div>
            </div>
          )}

          {/* Chat Messages */}
          {activePillar && chatMessages.map((msg, i) => (
            <div
              key={i}
              className={`flex items-start gap-3 ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {msg.role === "assistant" && (
                <div 
                  className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg"
                  style={{ backgroundColor: PILLAR_COLORS[activePillar.slug] + "20" }}
                >
                  {PILLAR_ICONS[activePillar.slug]}
                </div>
              )}
              <div
                className={`max-w-2xl rounded-2xl px-5 py-4 ${
                  msg.role === "user"
                    ? "bg-[#58A4B0] text-white rounded-br-none"
                    : "bg-gray-100 text-gray-900 rounded-bl-none"
                }`}
              >
                {msg.role === "assistant" && (
                  <div className="font-medium text-xs uppercase tracking-wide mb-1 opacity-60">
                    Book Strategist
                  </div>
                )}
                <div className="whitespace-pre-wrap text-[15px] leading-relaxed">
                  {/* Check for completion marker and render it specially */}
                  {msg.content.includes("[") && msg.content.includes(": COMPLETE]") ? (
                    <>
                      {msg.content.split(/\[[\w_]+: COMPLETE\]/)[0]}
                      <div className="mt-3 p-3 bg-green-100 rounded-lg border border-green-200">
                        <span className="text-green-700 font-semibold flex items-center gap-2">
                          ✅ Pillar Complete! Moving to next pillar...
                        </span>
                      </div>
                    </>
                  ) : (
                    msg.content
                  )}
                </div>
                {/* State emission display (for debugging/transparency) */}
                {msg.state_emission && msg.state_emission.is_complete && (
                  <div className="mt-2 text-xs text-green-600 font-medium">
                    Depth Score: {msg.state_emission.depth_score}%
                  </div>
                )}
              </div>
              {msg.role === "user" && (
                <div className="shrink-0 w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center">
                  <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              )}
            </div>
          ))}

          {/* Typing indicator */}
          {isTyping && (
            <div className="flex items-start gap-3 justify-start">
              <div 
                className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg"
                style={{ backgroundColor: activePillar ? PILLAR_COLORS[activePillar.slug] + "20" : "#CDF05620" }}
              >
                {activePillar ? PILLAR_ICONS[activePillar.slug] : "🤖"}
              </div>
              <div className="bg-gray-100 rounded-2xl rounded-bl-none px-5 py-4">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></span>
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></span>
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></span>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Error Display */}
        {error && (
          <div className="mx-6 mb-2 p-3 bg-red-100 border border-red-200 rounded-lg text-red-700 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">✕</button>
          </div>
        )}

        {/* Input Area */}
        {activePillar && activePillar.status === "ACTIVE" && (
          <div className="border-t border-gray-200 p-4">
            <div className="flex items-center gap-3 max-w-4xl mx-auto">
              <div className="flex-1 relative">
                <input
                  ref={inputRef}
                  type="text"
                  value={userMessage}
                  onChange={(e) => setUserMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  disabled={isSending}
                  className="w-full px-5 py-3.5 pr-12 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-[#CDF056] text-gray-900 placeholder-gray-400"
                  placeholder="Share your thoughts..."
                />
                <button
                  onClick={sendMessage}
                  disabled={isSending || !userMessage.trim()}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg bg-[#CDF056] text-[#0a1a2e] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#b8e050] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Complete pillar - read only message */}
        {activePillar && activePillar.status === "COMPLETE" && (
          <div className="border-t border-gray-200 p-4">
            <div className="text-center text-gray-500 text-sm">
              This pillar is complete. Select another pillar from the sidebar or{" "}
              <button 
                onClick={handleResetPillar}
                className="text-[#58A4B0] hover:underline"
              >
                reset to start over
              </button>.
            </div>
          </div>
        )}
      </div>

      {/* Right Sidebar - State Emission & Insights */}
      <div className="w-80 border-l border-[#2d4a5a] overflow-y-auto relative mt-10" style={{
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
        }} />
        
        <div className="relative z-10 p-5">
          {/* Header */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <h3 className="text-yellow-400 font-bold text-sm uppercase tracking-wide">STATE EMISSION</h3>
            </div>
            <h4 className="text-white font-semibold text-md">{initialOutline?.title || "Positioning Engine"}</h4>
          </div>

          {/* Current State Card */}
          <div className="mb-4 backdrop-blur-md bg-white/10 rounded-xl p-4 border border-white/20 shadow-lg" style={{
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%)',
            boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37), inset 0 1px 0 0 rgba(255, 255, 255, 0.2)'
          }}>
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-5 h-5 text-[#CDF056]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="text-gray-300 text-xs font-medium uppercase tracking-wide">CURRENT STATE</span>
            </div>
            
            {/* JSON-like state emission display */}
            <pre className="text-xs font-mono text-gray-200 bg-black/30 rounded-lg p-3 overflow-x-auto">
{JSON.stringify({
  current_pillar: stateEmission?.current_pillar || activePillar?.slug || null,
  progress_percentage: progress,
  pillars_completed: completedPillars,
}, null, 2)}
            </pre>
          </div>

          {/* Completed Pillars */}
          <div className="mb-4 backdrop-blur-md bg-white/10 rounded-xl p-4 border border-white/20 shadow-lg" style={{
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%)',
          }}>
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-5 h-5 text-[#CDF056]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-gray-300 text-xs font-medium uppercase tracking-wide">COMPLETED</span>
            </div>
            
            <div className="space-y-2">
              {completedPillars.length === 0 ? (
                <p className="text-gray-400 text-sm italic">No pillars completed yet</p>
              ) : (
                completedPillars.map(slug => {
                  const pillar = pillarsData?.pillars.find(p => p.slug === slug);
                  return pillar ? (
                    <div key={slug} className="flex items-center gap-2 text-sm">
                      <span className="text-green-400">✓</span>
                      <span className="text-white">{pillar.name}</span>
                    </div>
                  ) : null;
                })
              )}
            </div>
          </div>

          {/* Locked Pillars */}
          <div className="mb-4 backdrop-blur-md bg-white/10 rounded-xl p-4 border border-white/20 shadow-lg" style={{
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%)',
          }}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">🔒</span>
              <span className="text-gray-300 text-xs font-medium uppercase tracking-wide">REMAINING</span>
            </div>
            
            <div className="space-y-2">
              {pillarsData?.pillars.filter(p => p.status === "LOCKED").map(pillar => (
                <div key={pillar.slug} className="flex items-center gap-2 text-sm opacity-60">
                  <span>{PILLAR_ICONS[pillar.slug]}</span>
                  <span className="text-gray-400">{pillar.name}</span>
                </div>
              ))}
              {pillarsData?.pillars.filter(p => p.status === "LOCKED").length === 0 && (
                <p className="text-green-400 text-sm">All pillars unlocked! 🎉</p>
              )}
            </div>
          </div>

          {/* Quote */}
          <div className="backdrop-blur-md bg-white/10 rounded-xl p-4 border border-white/20 shadow-lg" style={{
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%)',
          }}>
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-[#CDF056] shrink-0 mt-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 9.064-9.57V3.055c-3.219.348-5.891 2.789-5.891 6.748v7.285h6.458V21h-9.631zm-14.017 0v-7.391c0-5.704 3.748-9.57 9.069-9.57V3.055c-3.219.348-5.89 2.789-5.89 6.748v7.285h6.453V21H0z" />
              </svg>
              <p className="text-gray-200 text-sm italic leading-relaxed">
                "The clarity of your positioning determines the impact of your book." - BookPilot
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Brief Modal */}
      {showBriefModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-8">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-xl font-bold text-gray-900">📄 Master Positioning Brief</h2>
              <button 
                onClick={() => setShowBriefModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <pre className="whitespace-pre-wrap font-sans text-gray-700 text-sm leading-relaxed">
                {briefContent}
              </pre>
            </div>
            <div className="p-4 border-t flex justify-end gap-3">
              <button
                onClick={() => setShowBriefModal(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setShowBriefModal(false);
                  handleGenerateOutline();
                }}
                disabled={isGeneratingOutline}
                className="px-4 py-2 bg-[#CDF056] hover:bg-[#b8e050] text-[#0a1a2e] rounded-lg font-medium"
              >
                Generate Outline →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
