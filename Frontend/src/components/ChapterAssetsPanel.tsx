import { useState, useEffect, useRef } from "react";
import { uploadChapterAsset, listChapterAssets } from "../utils/api";

type ChapterAsset = {
  id: number;
  filename: string;
  file_type: string;
  created_at: string;
};

type ChapterAssetsPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  bookId: number;
  chapterId: number;
  chapterTitle: string;
  onGenerate: (selectedAssetIds: number[]) => void;
};

export default function ChapterAssetsPanel({
  isOpen,
  onClose,
  bookId,
  chapterId,
  chapterTitle: _chapterTitle,
  onGenerate,
}: ChapterAssetsPanelProps) {
  const [assets, setAssets] = useState<ChapterAsset[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      loadAssets();
    }
  }, [isOpen, bookId, chapterId]);

  const loadAssets = async () => {
    setLoading(true);
    try {
      // Load book-level assets (where talking_point_id is null)
      const result = await listChapterAssets({
        book_id: bookId,
        talking_point_id: undefined,
      });
      if (result.success && result.data.assets) {
        setAssets(result.data.assets);
        // Auto-select all assets by default
        setSelectedAssetIds(new Set(result.data.assets.map((a: ChapterAsset) => a.id)));
      }
    } catch (error) {
      console.error("Error loading assets:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const allowedTypes = ["txt", "pdf", "mp3", "csv", "docx", "doc"];
    const fileExt = file.name.split(".").pop()?.toLowerCase();
    
    if (!fileExt || !allowedTypes.includes(fileExt)) {
      alert(`File type .${fileExt} not allowed. Allowed types: ${allowedTypes.join(", ")}`);
      return;
    }

    setUploading(true);
    try {
      const result = await uploadChapterAsset({
        book_id: bookId,
        talking_point_id: undefined, // Chapter-level assets don't have talking_point_id
        file: file,
      });
      if (result.success) {
        await loadAssets();
      } else {
        alert(result.error || "Failed to upload file");
      }
    } catch (error) {
      console.error("Error uploading file:", error);
      alert("Failed to upload file");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleRecordClick = () => {
    // Placeholder for recording functionality
    alert("Recording functionality coming soon");
  };

  const toggleAssetSelection = (assetId: number) => {
    setSelectedAssetIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(assetId)) {
        newSet.delete(assetId);
      } else {
        newSet.add(assetId);
      }
      return newSet;
    });
  };

  const handleGenerate = () => {
    onGenerate(Array.from(selectedAssetIds));
    onClose();
  };

  const getFileIcon = (fileType: string) => {
    if (fileType === "mp3") {
      return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      );
    }
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="absolute left-0 top-0 h-full w-80 bg-[#0a1a2e] border-r border-[#2d3a4a] flex flex-col shadow-2xl z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#2d3a4a] shrink-0">
        <div className="flex items-center gap-3">
          <svg className="w-6 h-6 text-[#4ade80]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <h2 className="text-white text-sm font-semibold">Chapter Assets</h2>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Action Buttons */}
      <div className="px-6 py-4 flex gap-4 shrink-0">
        <button
          onClick={handleUploadClick}
          disabled={uploading}
          className="flex-1 flex items-center justify-center text-sm gap-2 px-4 py-3 border border-gray-600 rounded-lg text-white hover:bg-[#1a2a3a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          {uploading ? "Uploading..." : "Upload"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.pdf,.mp3,.csv,.docx,.doc"
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          onClick={handleRecordClick}
          className="flex-1 flex items-center text-sm justify-center gap-2 px-4 py-3 border border-gray-600 rounded-lg text-white hover:bg-[#1a2a3a] transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
          Record
        </button>
      </div>

      {/* Available Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <h3 className="text-white text-sm font-semibold mb-4 uppercase">Available Content</h3>
        {loading ? (
          <div className="text-gray-400 text-center py-8">Loading...</div>
        ) : assets.length === 0 ? (
          <div className="text-gray-400 text-center py-8">No files uploaded yet</div>
        ) : (
          <div className="space-y-2">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="flex items-center gap-3 p-3 hover:bg-[#1a2a3a] rounded-lg transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedAssetIds.has(asset.id)}
                  onChange={() => toggleAssetSelection(asset.id)}
                  className="w-4 h-4 text-[#4ade80] bg-gray-700 border-gray-600 rounded focus:ring-[#4ade80]"
                />
                <div className="text-gray-400 shrink-0">
                  {getFileIcon(asset.file_type)}
                </div>
                <span className="text-white text-sm flex-1 truncate">{asset.filename}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Generate Button */}
      <div className="px-6 py-4 border-t border-[#2d3a4a] shrink-0">
        <button
          onClick={handleGenerate}
          disabled={selectedAssetIds.size === 0}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#4ade80] text-white font-semibold rounded-lg hover:bg-[#3bc96d] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
          </svg>
          GENERATE DRAFT
        </button>
      </div>
    </div>
  );
}

