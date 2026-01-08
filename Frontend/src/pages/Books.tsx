import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchBooks, createBook, fetchBook } from "../utils/api";
import Background1 from "../assets/Branding/Background1.png"

type BookSummary = { 
  id: number; 
  title: string;
  chapters?: any[];
};

type BookCardProps = {
  book: BookSummary;
  onSelect: (id: number) => void;
};

function BookCard({ book, onSelect }: BookCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  
  // Calculate progress based on chapters (placeholder logic)
  const calculateProgress = () => {
    if (!book.chapters || book.chapters.length === 0) return 0;
    // Simple calculation: if there are chapters, assume some progress
    // In a real app, this would be based on actual completion status
    return Math.min(book.chapters.length * 10, 100);
  };

  const progress = calculateProgress();
  const status = progress > 0 ? "Drafting" : "Planning";
  
  // Default values for fields not yet in backend
  const subtitle = "No subtitle"; // Placeholder
  const goal = "AUTHORITY BUILDING"; // Placeholder
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  };

  return (
    <div 
      className="bg-[#1a2a3a] rounded-xl p-5 border border-[#2d3a4a] hover:border-[#4ade80]/30 transition-all cursor-pointer relative"
      onClick={() => onSelect(book.id)}
    >
      {/* Options Menu */}
      <div className="absolute top-4 right-4">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className="text-gray-400 hover:text-white p-1"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
          </svg>
        </button>
        {showMenu && (
          <div className="absolute right-0 mt-2 w-48 bg-[#2d3a4a] rounded-lg shadow-lg border border-[#3a4a5a] z-10">
            <button className="w-full text-left px-4 py-2 text-sm text-white hover:bg-[#3a4a5a] rounded-t-lg">
              Edit
            </button>
            <button className="w-full text-left px-4 py-2 text-sm text-white hover:bg-[#3a4a5a]">
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Book Icon */}
      <div className="mb-4">
        <div className="w-12 h-12 bg-[#4ade80] rounded-lg flex items-center justify-center">
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        </div>
      </div>

      {/* Title */}
      <h3 className="text-white font-bold text-lg mb-1">{book.title}</h3>
      
      {/* Subtitle */}
      <p className="text-gray-400 text-sm mb-4">{subtitle}</p>

      {/* Goal */}
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <span className="text-gray-400 text-xs font-medium">GOAL:</span>
        <span className="text-white text-xs font-semibold">{goal}</span>
      </div>

      {/* Progress */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-gray-400 text-xs font-medium">{status}</span>
          <span className="text-white text-xs font-semibold">{progress}%</span>
        </div>
        <div className="w-full bg-[#2d3a4a] rounded-full h-2">
          <div 
            className="bg-[#4ade80] h-2 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Due Date */}
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-gray-400 text-xs">{formatDate(dueDate)}</span>
      </div>
    </div>
  );
}

export default function Books() {
  const navigate = useNavigate();
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const loadBooks = async () => {
    setLoading(true);
    const res = await fetchBooks();
    if (res.success) {
      // Fetch full details for each book to get chapters
      const booksWithDetails = await Promise.all(
        res.data.map(async (book: BookSummary) => {
          const bookRes = await fetchBook(book.id);
          if (bookRes.success) {
            return bookRes.data;
          }
          return book;
        })
      );
      setBooks(booksWithDetails);
    }
    setLoading(false);
  };

  const handleCreateBook = async () => {
    const title = window.prompt("Book title", "New Book Project");
    if (title === null) return;
    const res = await createBook({ title });
    if (res.success) {
      await loadBooks();
    }
  };

  useEffect(() => {
    loadBooks();
  }, []);

  return (
    <div className="min-h-screen bg-[#0a1a2e] relative">
      {/* Background Pattern */}
      <img src={Background1} alt="Background" className="fixed inset-0 h-full opacity-25 pointer-events-none" />

      <div className="relative z-10 px-8 py-8">
        {/* Header Section */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">My Books</h1>
            <p className="text-gray-400 text-sm">Manage your current projects and ideas.</p>
          </div>
          <button
            onClick={handleCreateBook}
            className="bg-[#fbbf24] hover:bg-[#f59e0b] text-[#0a1a2e] font-semibold px-6 py-3 rounded-lg flex items-center gap-2 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>New Book</span>
          </button>
        </div>

        {/* Books Grid */}
        {loading ? (
          <div className="text-center text-gray-400 py-12">Loading books...</div>
        ) : books.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            <p className="mb-4">No books yet. Create your first book to get started!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {books.map((book) => (
              <BookCard key={book.id} book={book} onSelect={(id) => {
                navigate(`/book/${id}`);
              }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
