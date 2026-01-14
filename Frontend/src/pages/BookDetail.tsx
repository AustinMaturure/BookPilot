import { useState, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fetchBook } from "../utils/api";
import Position, { type BookOutline } from "../components/position";
import OutlineView from "../components/OutlineView";
import Editor from "../components/Editor";
import BookChecks from "./BookChecks";

type BookDetail = BookOutline & {
  core_topic?: string;
  audience?: string;
  user_contexts?: { id: number; text: string; created_at: string }[];
  is_collaboration?: boolean;
  collaborator_role?: "editor" | "viewer" | "commenter" | null;
};

type Tab = "overview" | "position" | "outline" | "editor" | "checks" | "design" | "publish";

export default function BookDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [book, setBook] = useState<BookDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const tabParam = searchParams.get("tab");
    return (tabParam as Tab) || "position";
  });
  const [outline, setOutline] = useState<BookDetail | null>(null);
  const [hasSetInitialTab, setHasSetInitialTab] = useState(() => {
    // Check if URL param exists on initial load
    return !!searchParams.get("tab");
  });
  
  // Handle URL parameters for navigation from checks
  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam && ["overview", "position", "outline", "editor", "checks", "design", "publish"].includes(tabParam)) {
      setActiveTab(tabParam as Tab);
      setHasSetInitialTab(true); // Mark as set if URL param exists
    }
  }, [searchParams]);

  const loadBook = async () => {
    if (!id) return;
    setLoading(true);
    const res = await fetchBook(parseInt(id));
    if (res.success) {
      setBook(res.data);
      setOutline(res.data);
      
      // Set initial tab based on user role and outline status (only if not already set via URL param)
      if (!hasSetInitialTab && !searchParams.get("tab")) {
        const isCollaborator = res.data.is_collaboration && res.data.collaborator_role;
        const hasOutline = res.data.chapters && res.data.chapters.length > 0;
        
        if (isCollaborator) {
          // Collaborators always open editor tab
          setActiveTab("editor");
        } else if (hasOutline) {
          // Owners open editor tab only if outline exists
          setActiveTab("editor");
        } else {
          // Owners without outline open position tab
          setActiveTab("position");
        }
        setHasSetInitialTab(true);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    // Reset flag when book ID changes
    const tabParam = searchParams.get("tab");
    setHasSetInitialTab(!!tabParam);
    loadBook();
  }, [id]);

  const tabs: { id: Tab; label: string; icon: React.ReactElement }[] = [
    {
      id: "overview",
      label: "Overview",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      ),
    },
    {
      id: "position",
      label: "Position",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      id: "outline",
      label: "Outline",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      ),
    },
    {
      id: "editor",
      label: "Editor",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      ),
    },
    {
      id: "checks",
      label: "Checks",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      id: "design",
      label: "Design",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      ),
    },
    {
      id: "publish",
      label: "Publish",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
  ];

  const handleOutlineUpdate = (updatedOutline: BookOutline) => {
    setOutline(updatedOutline);
    setBook(updatedOutline);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a1a2e] flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="min-h-screen bg-[#0a1a2e] flex items-center justify-center">
        <div className="text-gray-400">Book not found</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a1a2e] mt-18 fixed min-w-full">
      {/* Secondary Navigation Bar */}
      <div className="bg-[#002b42] border-b border-[#002A40] px-6 py-2 fixed top-10% left-0 right-0 z-50 ">
        <div className="flex items-center justify-between">
          {/* Left: Back button and book title */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-white text-lg font-semibold line-clamp-1">{book.title}</h2>
          </div>

          {/* Right: Tabs */}
          <div className="flex items-center gap-1">
            {tabs.map((tab) => {
              const isRestrictedTab = ["overview", "position", "outline", "checks", "publish"].includes(tab.id);
              const isViewerOrCommenter = book.collaborator_role === "viewer" || book.collaborator_role === "commenter";
              const isDisabled = isRestrictedTab && isViewerOrCommenter;
              
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    if (isDisabled) return;
                    setActiveTab(tab.id);
                  }}
                  disabled={isDisabled}
                  className={`px-4 py-2 flex items-center gap-2 text-sm font-medium transition-colors ${
                    isDisabled
                      ? "text-gray-600 opacity-50 cursor-not-allowed"
                      : activeTab === tab.id
                      ? "bg-[#004E66] text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                  title={isDisabled ? "Not available for your role" : tab.label}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="h-[calc(100vh-60px)] z-50  ">
        {activeTab === "position" && (
          <Position
            initialOutline={outline}
            onOutlineUpdate={handleOutlineUpdate}
            showInlineOutline={false}
            bookId={book.id}
            bookData={book}
            onSwitchTab={(tab) => setActiveTab(tab as Tab)}
          />
        )}
        {activeTab === "outline" && outline && (
          <OutlineView
            outline={outline}
            bookId={book.id}
            onOutlineUpdate={handleOutlineUpdate}
            onSwitchTab={(tab) => setActiveTab(tab as Tab)}
          />
        )}
        {activeTab === "overview" && (
          <div className="h-full flex items-center justify-center bg-white">
            <div className="text-gray-500">Overview tab - Coming soon</div>
          </div>
        )}
        {activeTab === "editor" && outline && (
          <Editor
            outline={outline}
            bookId={book.id}
            onOutlineUpdate={handleOutlineUpdate}
            isCollaboration={book.is_collaboration}
            collaboratorRole={book.collaborator_role}
          />
        )}
        {activeTab === "checks" && <BookChecks />}
        {activeTab === "design" && (
          <div className="h-full flex items-center justify-center bg-white">
            <div className="text-gray-500">Design tab - Coming soon</div>
          </div>
        )}
        {activeTab === "publish" && (
          <div className="h-full flex items-center justify-center bg-white">
            <div className="text-gray-500">Publish tab - Coming soon</div>
          </div>
        )}
      </div>
    </div>
  );
}
