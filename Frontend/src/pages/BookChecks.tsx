import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { runBookChecks, type BookCheckResults, type BookCheckFinding } from "../utils/api";

type CategoryKey = "editorial" | "legal" | "platform";

export default function BookChecks() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [results, setResults] = useState<BookCheckResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runChecks = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const res = await runBookChecks(parseInt(id));
    if (res.success && res.data) {
      setResults(res.data);
    } else {
      setError(res.error || "Failed to run checks");
    }
    setLoading(false);
  };

  useEffect(() => {
    runChecks();
  }, [id]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "passed":
        return "bg-green-500/20 text-green-400 border-green-500/30";
      case "warning":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "critical":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    }
  };

  const getStatusLabel = (status: string) => {
    return status.toUpperCase();
  };

  const getCategoryIconBgColor = (category: CategoryKey) => {
    switch (category) {
      case "editorial":
        return "bg-yellow-400/20"; // Light see-through yellow
      case "legal":
        return "bg-green-400/20"; // Light green
      case "platform":
        return "bg-red-400/20"; // Light red
    }
  };

  const getCategoryIcon = (category: CategoryKey) => {
    switch (category) {
      case "editorial":
        return (
          <svg className="w-8 h-8 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        );
      case "legal":
        return (
          <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
          </svg>
        );
      case "platform":
        return (
          <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
        );
    }
  };

  const getCategoryTitle = (category: CategoryKey) => {
    switch (category) {
      case "editorial":
        return "Editorial Quality Checks";
      case "legal":
        return "Legal / Ethical / Attribution";
      case "platform":
        return "Platform Compliance (POD / EPUB)";
    }
  };

  const getCategoryDescription = (category: CategoryKey) => {
    switch (category) {
      case "editorial":
        return "Evaluates structure, clarity, flow, and consistency.";
      case "legal":
        return "Checks sources, citations, and plagiarism.";
      case "platform":
        return "Ensures print and ebook technical readiness.";
    }
  };

  const handleJumpToTalkingPoint = (finding: BookCheckFinding) => {
    // Navigate to editor tab with URL parameters
    // The BookDetail component will handle switching tabs and Editor will handle navigation
    navigate(`/book/${id}?tab=editor&chapter=${finding.chapter_id}&section=${finding.section_id}&tp=${finding.talking_point_id}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a1a2e] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#4ade80] mx-auto mb-4"></div>
          <div className="text-gray-400">Running checks...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a1a2e] flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 mb-4">{error}</div>
          <button
            onClick={runChecks}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="min-h-screen bg-[#0a1a2e] flex items-center justify-center">
        <div className="text-gray-400">No results available</div>
      </div>
    );
  }

  const categories: CategoryKey[] = ["editorial", "legal", "platform"];

  return (
    <div className="min-h-screen bg-[#011B2C] text-white p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Whole-Book Checks</h1>
        <p className="text-gray-400">Automated evaluation of your manuscript's quality, legality, and compliance.</p>
      </div>

      {/* Category Cards */}
      {!selectedCategory && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {categories.map((category) => {
            const categoryData = results.categories[category];
            const status = categoryData.status;
            
            return (
              <div
                key={category}
                className="bg-[#002b42] border border-[#2d3a4a] rounded-lg p-6 cursor-pointer hover:border-[#4ade80]/50 transition-colors flex flex-col justify-between"
                onClick={() => setSelectedCategory(category)}
              >
                 <div className="flex items-center justify-between mb-4">
                   <div className={`flex items-center gap-3 ${getCategoryIconBgColor(category)} rounded-md p-2`}>
                      {getCategoryIcon(category)}
                    
                   </div>
                  <div className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(status)}`}>
                    {getStatusLabel(status)}
                  </div>
                </div>
                <div>
                      <h3 className="text-lg font-semibold text-white">{getCategoryTitle(category)}</h3>
                    </div>
                
                <p className="text-gray-400 text-sm mb-4">{getCategoryDescription(category)}</p>
                
                <div className="space-y-2 mb-4">
                  {categoryData.checks.slice(0, 3).map((check, idx) => (
                    <div key={idx} className="text-sm text-gray-300">• {check}</div>
                  ))}
                  {categoryData.checks.length > 3 && (
                    <div className="text-sm text-gray-400">+{categoryData.checks.length - 3} more checks</div>
                  )}
                </div>
                
                <div className="flex items-center justify-between pt-4 border-t border-[#2d3a4a]">
                  <div className={`text-sm font-medium ${
                    status === "passed" ? "text-green-400" :
                    status === "warning" ? "text-yellow-400" :
                    status === "critical" ? "text-red-400" :
                    "text-gray-400"
                  }`}>
                    {status === "passed" ? "No Issues Found" : `${categoryData.findings_count} Finding${categoryData.findings_count !== 1 ? 's' : ''}`}
                  </div>
                  <div className="text-sm text-white hover:text-[#4ade80] transition-colors">
                    View Details →
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Category Detail View */}
      {selectedCategory && (
        <div>
          <button
            onClick={() => setSelectedCategory(null)}
            className="mb-6 text-gray-400 hover:text-white flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Overview
          </button>

          <div className="bg-[#1a2a3a] border border-[#2d3a4a] rounded-lg p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {getCategoryIcon(selectedCategory)}
                <div>
                  <h2 className="text-2xl font-semibold text-white">{getCategoryTitle(selectedCategory)}</h2>
                  <p className="text-gray-400 text-sm mt-1">{getCategoryDescription(selectedCategory)}</p>
                </div>
              </div>
              <div className={`px-4 py-2 rounded-full text-sm font-semibold border ${getStatusColor(results.categories[selectedCategory].status)}`}>
                {getStatusLabel(results.categories[selectedCategory].status)}
              </div>
            </div>

            <div className="space-y-2 mb-6">
              {results.categories[selectedCategory].checks.map((check, idx) => (
                <div key={idx} className="text-sm text-gray-300">• {check}</div>
              ))}
            </div>
          </div>

          {/* Findings List */}
          {results.categories[selectedCategory].findings.length === 0 ? (
            <div className="bg-[#1a2a3a] border border-[#2d3a4a] rounded-lg p-8 text-center">
              <div className="text-green-400 text-lg font-semibold mb-2">No Issues Found</div>
              <div className="text-gray-400">All checks passed for this category.</div>
            </div>
          ) : (
            <div className="space-y-4 p-8">
              {results.categories[selectedCategory].findings.map((finding, idx) => (
                <div
                  key={idx}
                  className="bg-[#002b42] border border-[#2d3a4a] rounded-lg p-6"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex-3 border-r-[1px] border-gray-700 pl-4 pr-4">
                        
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`px-2 py-1 rounded text-xs font-semibold ${getStatusColor(finding.status)}`}>
                          {getStatusLabel(finding.status)}
                        </div>
                        <h3 className="text-lg font-semibold text-white">{finding.title}</h3>
                      </div>
                      <p className="text-gray-300 mb-2">{finding.message}</p>
                      <div className="bg-[#011B2C] rounded-md p-4 pl-2 border-l-amber-300 border-l-2 ">
                      <p className="text-sm mb-4">RECOMMENDED FIX</p>
                      {finding.recommendation && (
                        <p className="text-gray-400 text-sm italic mb-4">💡 {finding.recommendation}</p>
                      )}</div></div>
                      <div className="flex-1 flex-col items-center justify-between p-4">
                      <div className="text-sm text-gray-500">
                        <p>Found in:</p> <span className="text-gray-300">{finding.chapter_title} – {finding.section_title}</span>
                        <br />

                        
                      </div>
                      <button
                    onClick={() => handleJumpToTalkingPoint(finding)}
                    className="px-4 py-2 bg-[#1A3A4A] text-white rounded hover:bg-blue-700 text-sm mt-4"
                  >
                    Jump to Chapter
                  </button>
                  </div>
                    
                  </div>
                 
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

