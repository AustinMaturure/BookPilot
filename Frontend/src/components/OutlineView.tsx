import { useState } from "react";
import {
  createChapter,
  updateChapter,
  deleteChapter,
  createSection,
  updateSection,
  deleteSection,
  createTalkingPoint,
  updateTalkingPoint,
  deleteTalkingPoint,
} from "../utils/api";
import type { BookOutline } from "./position";
import background2 from "../assets/Branding/Log_in_background.png"

type OutlineViewProps = {
  outline: BookOutline | null;
  bookId?: number;
  onOutlineUpdate?: (outline: BookOutline) => void;
};

export default function OutlineView({
  outline,
  bookId,
  onOutlineUpdate,
}: OutlineViewProps) {
  const [expandedChapters, setExpandedChapters] = useState<Record<number, boolean>>({});
  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({});
  const [editingChapterId, setEditingChapterId] = useState<number | null>(null);
  const [editingSectionId, setEditingSectionId] = useState<number | null>(null);
  const [editingTpId, setEditingTpId] = useState<number | null>(null);
  const [chapterTitles, setChapterTitles] = useState<Record<number, string>>({});
  const [sectionTitles, setSectionTitles] = useState<Record<number, string>>({});
  const [tpTexts, setTpTexts] = useState<Record<number, string>>({});

  if (!outline || !bookId) {
    return (
      <div className="h-full bg-white p-8">
        <div className="text-gray-500">No outline yet. Generate one from the Position tab.</div>
      </div>
    );
  }

  const handleAddChapter = async () => {
    const defaultTitle = "New Chapter";
    const currentChapterCount = outline?.chapters?.length || 0;
    const res = await createChapter(bookId, { title: defaultTitle });
    if (res.success && onOutlineUpdate && res.data) {
      onOutlineUpdate(res.data);
      // Find the newly created chapter (should be the last one or one more than before)
      const chapters = res.data.chapters || [];
      const newChapter = chapters.length > currentChapterCount 
        ? chapters[chapters.length - 1] 
        : chapters.find((ch: any) => ch.title === defaultTitle);
      if (newChapter?.id) {
        setChapterTitles((prev) => ({
          ...prev,
          [newChapter.id!]: defaultTitle,
        }));
        setEditingChapterId(newChapter.id);
        // Expand the new chapter
        setExpandedChapters((prev) => ({
          ...prev,
          [newChapter.id!]: true,
        }));
      }
    }
  };

  const handleRenameChapter = async (chapterId: number, title: string) => {
    const res = await updateChapter(chapterId, { title });
    if (res.success && onOutlineUpdate) {
      onOutlineUpdate(res.data);
    }
  };

  const handleDeleteChapter = async (chapterId: number) => {
    if (!window.confirm("Delete this chapter?")) return;
    const res = await deleteChapter(chapterId);
    if (res.success && onOutlineUpdate) {
      onOutlineUpdate(res.data);
    }
  };

  const handleAddSection = async (chapterId: number) => {
    const defaultTitle = "New Section";
    const currentChapter = outline?.chapters?.find((ch: any) => ch.id === chapterId);
    const currentSectionCount = currentChapter?.sections?.length || 0;
    const res = await createSection(chapterId, { title: defaultTitle });
    if (res.success && onOutlineUpdate && res.data) {
      onOutlineUpdate(res.data);
      // Find the newly created section (should be the last one in the chapter)
      const chapter = res.data.chapters?.find((ch: any) => ch.id === chapterId);
      const sections = chapter?.sections || [];
      const newSection = sections.length > currentSectionCount
        ? sections[sections.length - 1]
        : sections.find((sec: any) => sec.title === defaultTitle);
      if (newSection?.id) {
        setSectionTitles((prev) => ({
          ...prev,
          [newSection.id!]: defaultTitle,
        }));
        setEditingSectionId(newSection.id);
        // Expand the parent chapter and the new section
        setExpandedChapters((prev) => ({
          ...prev,
          [chapterId]: true,
        }));
        setExpandedSections((prev) => ({
          ...prev,
          [newSection.id!]: true,
        }));
      }
    }
  };

  const handleRenameSection = async (sectionId: number, title: string) => {
    const res = await updateSection(sectionId, { title });
    if (res.success && onOutlineUpdate) {
      onOutlineUpdate(res.data);
    }
  };

  const handleDeleteSection = async (sectionId: number) => {
    if (!window.confirm("Delete this section?")) return;
    const res = await deleteSection(sectionId);
    if (res.success && onOutlineUpdate) {
      onOutlineUpdate(res.data);
    }
  };

  const handleAddTalkingPoint = async (sectionId: number) => {
    const defaultText = "New Talking Point";
    // Find current section to get current talking point count
    const currentChapter = outline?.chapters?.find((ch: any) => 
      ch.sections?.some((sec: any) => sec.id === sectionId)
    );
    const currentSection = currentChapter?.sections?.find((sec: any) => sec.id === sectionId);
    const currentTpCount = currentSection?.talking_points?.length || 0;
    
    const res = await createTalkingPoint(sectionId, { text: defaultText });
    if (res.success && onOutlineUpdate && res.data) {
      onOutlineUpdate(res.data);
      // Find the newly created talking point (should be the last one in the section)
      const chapter = res.data.chapters?.find((ch: any) => 
        ch.sections?.some((sec: any) => sec.id === sectionId)
      );
      const section = chapter?.sections?.find((sec: any) => sec.id === sectionId);
      const talkingPoints = section?.talking_points || [];
      const newTp = talkingPoints.length > currentTpCount
        ? talkingPoints[talkingPoints.length - 1]
        : talkingPoints.find((tp: any) => tp.text === defaultText);
      if (newTp?.id) {
        setTpTexts((prev) => ({
          ...prev,
          [newTp.id!]: defaultText,
        }));
        setEditingTpId(newTp.id);
        // Expand the parent chapter and section
        if (chapter?.id) {
          setExpandedChapters((prev) => ({
            ...prev,
            [chapter.id!]: true,
          }));
        }
        setExpandedSections((prev) => ({
          ...prev,
          [sectionId]: true,
        }));
      }
    }
  };

  const handleRenameTalkingPoint = async (tpId: number, text: string) => {
    const res = await updateTalkingPoint(tpId, { text });
    if (res.success && onOutlineUpdate) {
      onOutlineUpdate(res.data);
    }
  };

  const handleDeleteTalkingPoint = async (tpId: number) => {
    if (!window.confirm("Delete this talking point?")) return;
    const res = await deleteTalkingPoint(tpId);
    if (res.success && onOutlineUpdate) {
      onOutlineUpdate(res.data);
    }
  };

  const toggleExpandAll = () => {
    if (!outline?.chapters) return;
    const allExpanded = outline.chapters.every(
      (ch) => expandedChapters[ch.id ?? -1]
    );
    const newState: Record<number, boolean> = {};
    outline.chapters.forEach((ch) => {
      if (ch.id) newState[ch.id] = !allExpanded;
    });
    setExpandedChapters(newState);
  };

  return (
    <div className="h-full bg-gray-50 overflow-y-auto p-8" style={{
      backgroundImage: `url(${background2})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat'
    }}>
      <div className="max-w-6xl mx-auto p-8 bg-gray-100 rounded-lg">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 p-8 ">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Book Outline</h1>
            <p className="text-gray-600">Structure your expertise. Drag to reorder.</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={toggleExpandAll}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium"
            >
              Expand All
            </button>
            <button
              className="px-4 py-2 bg-[#CDF056] text-gray border-black border hover:bg-[#3bc96d] font-medium flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Generate Outline
            </button>
          </div>
        </div>

        {/* Outline List */}
        <div className="space-y-3 p-4 pt-0 ">
          {(outline.chapters || []).map((chapter, ci) => {
            const chapterId = chapter.id ?? -1;
            const isExpanded = expandedChapters[chapterId] ?? false;
            const isEditing = editingChapterId === chapterId;

            return (
              <div
                key={chapterId}
                className="bg-white rounded-xl border border-gray-200 shadow-sm"
              >
                {/* Chapter Header */}
                <div className="flex items-center gap-3 p-4">
                  {/* Drag Handle */}
                  <div className="text-gray-400 cursor-move">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M7 2a2 2 0 11.001 3.999A2 2 0 017 2zm0 6a2 2 0 11.001 3.999A2 2 0 017 8zm0 6a2 2 0 11.001 3.999A2 2 0 017 14zm6-12a2 2 0 11.001 3.999A2 2 0 0113 2zm0 6a2 2 0 11.001 3.999A2 2 0 0113 8zm0 6a2 2 0 11.001 3.999A2 2 0 0113 14z" />
                    </svg>
                  </div>

                  {/* Expand/Collapse Arrow */}
                  <button
                    onClick={() => {
                      const newExpanded = !expandedChapters[chapterId];
                      setExpandedChapters((prev) => ({
                        ...prev,
                        [chapterId]: newExpanded,
                      }));
                      // Auto-expand all sections when chapter expands
                      if (newExpanded && chapter.sections) {
                        const newSectionState: Record<number, boolean> = {};
                        chapter.sections.forEach((sec) => {
                          if (sec.id) newSectionState[sec.id] = true;
                        });
                        setExpandedSections((prev) => ({ ...prev, ...newSectionState }));
                      }
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg
                      className={`w-5 h-5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>

                  {/* Part Label */}
                  <span className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-semibold rounded-sm">
                    PART {ci + 1}
                  </span>

                  {/* Chapter Title */}
                  {isEditing ? (
                    <div className="flex-1 flex items-center gap-2">
                      <input
                        className="flex-1 px-3 py-1 border border-gray-300 rounded-lg focus:outline-none focus:border-[#4ade80]"
                        value={chapterTitles[chapterId] ?? chapter.title}
                        onChange={(e) =>
                          setChapterTitles((prev) => ({
                            ...prev,
                            [chapterId]: e.target.value,
                          }))
                        }
                        onBlur={() => {
                          const title = chapterTitles[chapterId] ?? chapter.title;
                          if (chapterId > 0) {
                            handleRenameChapter(chapterId, title);
                          }
                          setEditingChapterId(null);
                        }}
                        onKeyPress={(e) => {
                          if (e.key === "Enter") {
                            const title = chapterTitles[chapterId] ?? chapter.title;
                            if (chapterId > 0) {
                              handleRenameChapter(chapterId, title);
                            }
                            setEditingChapterId(null);
                          }
                        }}
                        autoFocus
                      />
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setChapterTitles((prev) => ({
                          ...prev,
                          [chapterId]: chapter.title,
                        }));
                        setEditingChapterId(chapterId);
                      }}
                      className="flex-1 text-left font-semibold text-gray-900 hover:text-[#4ade80]"
                    >
                      Part {ci + 1}: {chapter.title}
                    </button>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => chapterId > 0 && handleAddSection(chapterId)}
                      className="px-3 py-1 text-sm text-gray-400 hover:bg-[#4ade80]/10 rounded-lg font-medium"
                    >
                      + Chapter
                    </button>
                    {chapterId > 0 && (
                      <button
                        onClick={() => handleDeleteChapter(chapterId)}
                        className="text-gray-400 hover:text-red-500"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Chapter Content (Sections) */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3">
                    {(chapter.sections || []).map((section, si) => {
                      const sectionId = section.id ?? -1;
                      const isExpandedSection = expandedSections[sectionId] ?? false;
                      const isEditingSection = editingSectionId === sectionId;

                      return (
                        <div key={sectionId} className="bg-gray-50 rounded-lg border border-gray-200">
                          {/* Section Header */}
                          <div className="flex items-center gap-3 p-3">
                            {/* Drag Handle */}
                            <div className="text-gray-400 cursor-move">
                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M7 2a2 2 0 11.001 3.999A2 2 0 017 2zm0 6a2 2 0 11.001 3.999A2 2 0 017 8zm0 6a2 2 0 11.001 3.999A2 2 0 017 14zm6-12a2 2 0 11.001 3.999A2 2 0 0113 2zm0 6a2 2 0 11.001 3.999A2 2 0 0113 8zm0 6a2 2 0 11.001 3.999A2 2 0 0113 14z" />
                              </svg>
                            </div>

                            {/* Expand/Collapse Arrow */}
                            <button
                              onClick={() =>
                                setExpandedSections((prev) => ({
                                  ...prev,
                                  [sectionId]: !prev[sectionId],
                                }))
                              }
                              className="text-gray-400 hover:text-gray-600"
                            >
                              <svg
                                className={`w-5 h-5 transition-transform ${isExpandedSection ? "rotate-90" : ""}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </button>

                            {/* CH Badge */}
                            <span className="px-2 py-1 bg-[#4ade80]/20 text-gray-700 text-xs font-semibold rounded-full">
                              CH {si + 1}
                            </span>

                            {/* Section Title */}
                            {isEditingSection ? (
                              <input
                                className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#4ade80]"
                                value={sectionTitles[sectionId] ?? section.title}
                                onChange={(e) =>
                                  setSectionTitles((prev) => ({
                                    ...prev,
                                    [sectionId]: e.target.value,
                                  }))
                                }
                                onBlur={() => {
                                  const title = sectionTitles[sectionId] ?? section.title;
                                  if (sectionId > 0) {
                                    handleRenameSection(sectionId, title);
                                  }
                                  setEditingSectionId(null);
                                }}
                                onKeyPress={(e) => {
                                  if (e.key === "Enter") {
                                    const title = sectionTitles[sectionId] ?? section.title;
                                    if (sectionId > 0) {
                                      handleRenameSection(sectionId, title);
                                    }
                                    setEditingSectionId(null);
                                  }
                                }}
                                autoFocus
                              />
                            ) : (
                              <button
                                onClick={() => {
                                  setSectionTitles((prev) => ({
                                    ...prev,
                                    [sectionId]: section.title,
                                  }));
                                  setEditingSectionId(sectionId);
                                }}
                                className="flex-1 text-left text-sm font-medium text-gray-700 hover:text-[#4ade80]"
                              >
                                {section.title}
                              </button>
                            )}

                            {/* Actions */}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => sectionId > 0 && handleAddTalkingPoint(sectionId)}
                                className="px-2 py-1 text-xs text-[#4ade80] hover:bg-[#4ade80]/10 rounded font-medium"
                              >
                                + Talking Point
                              </button>
                              {sectionId > 0 && (
                                <button
                                  onClick={() => handleDeleteSection(sectionId)}
                                  className="text-gray-400 hover:text-red-500"
                                >
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Talking Points */}
                          {isExpandedSection && (
                            <div className="px-12 pb-3 space-y-2">
                              {(section.talking_points || []).map((tp) => {
                                const tpId = tp.id ?? -1;
                                const isEditingTp = editingTpId === tpId;

                                return (
                                  <div
                                    key={tpId}
                                    className="bg-white rounded-lg p-2 border border-gray-200"
                                  >
                                    <div className="flex items-center gap-3">
                                      {/* Drag Handle */}
                                      <div className="text-gray-400 cursor-move">
                                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                          <path d="M7 2a2 2 0 11.001 3.999A2 2 0 017 2zm0 6a2 2 0 11.001 3.999A2 2 0 017 8zm0 6a2 2 0 11.001 3.999A2 2 0 017 14zm6-12a2 2 0 11.001 3.999A2 2 0 0113 2zm0 6a2 2 0 11.001 3.999A2 2 0 0113 8zm0 6a2 2 0 11.001 3.999A2 2 0 0113 14z" />
                                        </svg>
                                      </div>

                                      {/* Bullet Point */}
                                      <div className="w-2 h-2 rounded-full bg-gray-400"></div>

                                      {/* Talking Point Text */}
                                      {isEditingTp ? (
                                        <input
                                          className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-[#4ade80]"
                                          value={tpTexts[tpId] ?? tp.text}
                                          onChange={(e) =>
                                            setTpTexts((prev) => ({
                                              ...prev,
                                              [tpId]: e.target.value,
                                            }))
                                          }
                                          onBlur={() => {
                                            const text = tpTexts[tpId] ?? tp.text;
                                            if (tpId > 0) {
                                              handleRenameTalkingPoint(tpId, text);
                                            }
                                            setEditingTpId(null);
                                          }}
                                          onKeyPress={(e) => {
                                            if (e.key === "Enter") {
                                              const text = tpTexts[tpId] ?? tp.text;
                                              if (tpId > 0) {
                                                handleRenameTalkingPoint(tpId, text);
                                              }
                                              setEditingTpId(null);
                                            }
                                          }}
                                          autoFocus
                                        />
                                      ) : (
                                        <>
                                          <span className="flex-1 text-xs text-gray-700">{tp.text}</span>
                                          <button
                                            onClick={() => {
                                              setTpTexts((prev) => ({
                                                ...prev,
                                                [tpId]: tp.text,
                                              }));
                                              setEditingTpId(tpId);
                                            }}
                                            className="text-xs text-[#4ade80] hover:underline"
                                          >
                                            Edit
                                          </button>
                                          {tpId > 0 && (
                                            <button
                                              onClick={() => handleDeleteTalkingPoint(tpId)}
                                              className="text-gray-400 hover:text-red-500"
                                            >
                                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                              </svg>
                                            </button>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                         
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {chapterId > 0 && (
                      <button
                        onClick={() => handleAddSection(chapterId)}
                        className="text-sm text-[#4ade80] hover:underline"
                      >
                        + Section
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Add New Part Button */}
          <button
            onClick={handleAddChapter}
            className="w-full bg-white border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-[#4ade80] hover:bg-[#4ade80]/5 transition-colors"
          >
            <div className="flex items-center justify-center gap-2 text-[#4ade80] font-medium">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Add New Part</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
