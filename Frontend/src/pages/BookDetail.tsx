import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchBook } from "../utils/api";
import Position, { type BookOutline } from "../components/position";
import OutlineView from "../components/OutlineView";
import Editor from "../components/Editor";

type BookDetail = BookOutline & {
  core_topic?: string;
  audience?: string;
  user_contexts?: { id: number; text: string; created_at: string }[];
};

type Tab = "overview" | "position" | "outline" | "editor" | "checks" | "design" | "publish";

export default function BookDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [book, setBook] = useState<BookDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("position");
  const [outline, setOutline] = useState<BookDetail | null>(null);

  const loadBook = async () => {
    if (!id) return;
    setLoading(true);
    const res = await fetchBook(parseInt(id));
    if (res.success) {
      setBook(res.data);
      setOutline(res.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadBook();
  }, [id]);

  const tabs: { id: Tab; label: string; icon: JSX.Element }[] = [
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
    <div className="min-h-screen bg-[#0a1a2e]">
      {/* Secondary Navigation Bar */}
      <div className="bg-[#011b2d] border-b border-[#2d3a4a] px-6 py-2">
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
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-[#2d4a3e] text-[#4ade80] border border-[#4ade80]"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="h-[calc(100vh-140px)]">
        {activeTab === "position" && (
          <Position
            initialOutline={outline}
            onOutlineUpdate={handleOutlineUpdate}
            showInlineOutline={false}
            bookId={book.id}
            bookData={book}
          />
        )}
        {activeTab === "outline" && outline && (
          <OutlineView
            outline={outline}
            bookId={book.id}
            onOutlineUpdate={handleOutlineUpdate}
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
          />
        )}
        {activeTab === "checks" && (
          <div className="h-full flex items-center justify-center bg-white">
            <div className="text-gray-500">Checks tab - Coming soon</div>
          </div>
        )}
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
