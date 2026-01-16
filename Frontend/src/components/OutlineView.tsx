import { useState, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  DragOverlay,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
import background2 from "../assets/Branding/Log_in_background.png";

type OutlineViewProps = {
  outline: BookOutline | null;
  bookId?: number;
  onOutlineUpdate?: (outline: BookOutline) => void;
  onSwitchTab?: (tab: string) => void;
};

// Helper functions to detect item types from IDs
const getItemId = (type: "chapter" | "section" | "talkingPoint", id: number): string => {
  return `${type}-${id}`;
};

const parseItemId = (id: string): { type: "chapter" | "section" | "talkingPoint"; id: number } => {
  const [type, idStr] = id.split("-");
  return { type: type as "chapter" | "section" | "talkingPoint", id: parseInt(idStr, 10) };
};

const isChapter = (id: string) => id.startsWith("chapter-");
const isSection = (id: string) => id.startsWith("section-");
const isTalkingPoint = (id: string) => id.startsWith("talkingPoint-");

// Sortable Chapter Component
function SortableChapter({
  chapter,
  index,
  isExpanded,
  isEditing,
  chapterTitle,
  expandedSections,
  editingSectionId,
  sectionTitles,
  editingTpId,
  tpTexts,
  onExpandToggle,
  onEditStart,
  onTitleChange,
  onTitleBlur,
  onTitleKeyPress,
  onAddSection,
  onDeleteChapter,
  onSectionExpandToggle,
  onSectionEditStart,
  onSectionTitleChange,
  onSectionTitleBlur,
  onSectionTitleKeyPress,
  onAddTalkingPoint,
  onDeleteSection,
  onTpEditStart,
  onTpTextChange,
  onTpTextBlur,
  onTpTextKeyPress,
  onDeleteTalkingPoint,
}: {
  chapter: any;
  index: number;
  isExpanded: boolean;
  isEditing: boolean;
  chapterTitle: string;
  expandedSections: Record<number, boolean>;
  editingSectionId: number | null;
  sectionTitles: Record<number, string>;
  editingTpId: number | null;
  tpTexts: Record<number, string>;
  onExpandToggle: () => void;
  onEditStart: () => void;
  onTitleChange: (value: string) => void;
  onTitleBlur: () => void;
  onTitleKeyPress: (e: React.KeyboardEvent) => void;
  onAddSection: () => void;
  onDeleteChapter: () => void;
  onSectionExpandToggle: (sectionId: number) => void;
  onSectionEditStart: (sectionId: number) => void;
  onSectionTitleChange: (sectionId: number, value: string) => void;
  onSectionTitleBlur: (sectionId: number) => void;
  onSectionTitleKeyPress: (sectionId: number, e: React.KeyboardEvent) => void;
  onAddTalkingPoint: (sectionId: number) => void;
  onDeleteSection: (sectionId: number) => void;
  onTpEditStart: (tpId: number) => void;
  onTpTextChange: (tpId: number, value: string) => void;
  onTpTextBlur: (tpId: number) => void;
  onTpTextKeyPress: (tpId: number, e: React.KeyboardEvent) => void;
  onDeleteTalkingPoint: (tpId: number) => void;
}) {
  const chapterId = chapter.id ?? -1;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: getItemId("chapter", chapterId) });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="bg-white rounded-xl border border-gray-200 shadow-sm">
      {/* Chapter Header */}
      <div className="flex items-center gap-3 p-4">
        {/* Drag Handle */}
        <div className="text-gray-400 cursor-move" {...attributes} {...listeners}>
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 2a2 2 0 11.001 3.999A2 2 0 017 2zm0 6a2 2 0 11.001 3.999A2 2 0 017 8zm0 6a2 2 0 11.001 3.999A2 2 0 017 14zm6-12a2 2 0 11.001 3.999A2 2 0 0113 2zm0 6a2 2 0 11.001 3.999A2 2 0 0113 8zm0 6a2 2 0 11.001 3.999A2 2 0 0113 14z" />
          </svg>
        </div>

        {/* Expand/Collapse Arrow */}
        <button onClick={onExpandToggle} className="text-gray-400 hover:text-gray-600">
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
          PART {index + 1}
        </span>

        {/* Chapter Title */}
        {isEditing ? (
          <div className="flex-1 flex items-center gap-2">
            <input
              className="flex-1 px-3 py-1 border border-gray-300 rounded-lg focus:outline-none focus:border-[#CDF056]"
              value={chapterTitle}
              onChange={(e) => onTitleChange(e.target.value)}
              onBlur={onTitleBlur}
              onKeyPress={onTitleKeyPress}
              autoFocus
            />
          </div>
        ) : (
          <button onClick={onEditStart} className="flex-1 text-left font-semibold text-gray-900 hover:text-[#CDF056]">
            {chapter.title}
          </button>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onAddSection}
            className="px-3 py-1 text-sm text-gray-400 hover:bg-[#CDF056]/10 rounded-lg font-medium"
          >
            + Chapter
          </button>
          {chapterId > 0 && (
            <button onClick={onDeleteChapter} className="text-gray-400 hover:text-red-500">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Chapter Content (Sections) */}
      {isExpanded && chapter.sections && chapter.sections.length > 0 && (
        <div className="px-4 pb-4 space-y-3">
          <SortableContext
            items={chapter.sections.map((s: any) => getItemId("section", s.id ?? -1))}
            strategy={verticalListSortingStrategy}
          >
            {chapter.sections.map((section: any, si: number) => (
              <SortableSection
                key={section.id ?? -1}
                section={section}
                sectionIndex={si}
                isExpanded={expandedSections[section.id ?? -1] ?? false}
                isEditing={editingSectionId === section.id}
                sectionTitle={sectionTitles[section.id ?? -1] ?? section.title}
                editingTpId={editingTpId}
                tpTexts={tpTexts}
                onExpandToggle={() => onSectionExpandToggle(section.id ?? -1)}
                onEditStart={() => onSectionEditStart(section.id ?? -1)}
                onTitleChange={(value) => onSectionTitleChange(section.id ?? -1, value)}
                onTitleBlur={() => onSectionTitleBlur(section.id ?? -1)}
                onTitleKeyPress={(e) => onSectionTitleKeyPress(section.id ?? -1, e)}
                onAddTalkingPoint={() => onAddTalkingPoint(section.id ?? -1)}
                onDeleteSection={() => onDeleteSection(section.id ?? -1)}
                onTpEditStart={onTpEditStart}
                onTpTextChange={onTpTextChange}
                onTpTextBlur={onTpTextBlur}
                onTpTextKeyPress={onTpTextKeyPress}
                onDeleteTalkingPoint={onDeleteTalkingPoint}
              />
            ))}
          </SortableContext>
          {chapterId > 0 && (
            <button
              onClick={onAddSection}
              className="text-sm text-[#CDF056] hover:underline"
            >
              + Section
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Sortable Section Component
function SortableSection({
  section,
  sectionIndex,
  isExpanded,
  isEditing,
  sectionTitle,
  editingTpId,
  tpTexts,
  onExpandToggle,
  onEditStart,
  onTitleChange,
  onTitleBlur,
  onTitleKeyPress,
  onAddTalkingPoint,
  onDeleteSection,
  onTpEditStart,
  onTpTextChange,
  onTpTextBlur,
  onTpTextKeyPress,
  onDeleteTalkingPoint,
}: {
  section: any;
  sectionIndex: number;
  isExpanded: boolean;
  isEditing: boolean;
  sectionTitle: string;
  editingTpId: number | null;
  tpTexts: Record<number, string>;
  onExpandToggle: () => void;
  onEditStart: () => void;
  onTitleChange: (value: string) => void;
  onTitleBlur: () => void;
  onTitleKeyPress: (e: React.KeyboardEvent) => void;
  onAddTalkingPoint: () => void;
  onDeleteSection: () => void;
  onTpEditStart: (tpId: number) => void;
  onTpTextChange: (tpId: number, value: string) => void;
  onTpTextBlur: (tpId: number) => void;
  onTpTextKeyPress: (tpId: number, e: React.KeyboardEvent) => void;
  onDeleteTalkingPoint: (tpId: number) => void;
}) {
  const sectionId = section.id ?? -1;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: getItemId("section", sectionId) });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="bg-gray-50 rounded-lg border border-gray-200">
      {/* Section Header */}
      <div className="flex items-center gap-3 p-3">
        {/* Drag Handle */}
        <div className="text-gray-400 cursor-move" {...attributes} {...listeners}>
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 2a2 2 0 11.001 3.999A2 2 0 017 2zm0 6a2 2 0 11.001 3.999A2 2 0 017 8zm0 6a2 2 0 11.001 3.999A2 2 0 017 14zm6-12a2 2 0 11.001 3.999A2 2 0 0113 2zm0 6a2 2 0 11.001 3.999A2 2 0 0113 8zm0 6a2 2 0 11.001 3.999A2 2 0 0113 14z" />
          </svg>
        </div>

        {/* Expand/Collapse Arrow */}
        <button onClick={onExpandToggle} className="text-gray-400 hover:text-gray-600">
          <svg
            className={`w-5 h-5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* CH Badge */}
        <span className="px-2 py-1 bg-[#CDF056]/20 text-gray-700 text-xs font-semibold rounded-full">
          CH {sectionIndex + 1}
        </span>

        {/* Section Title */}
        {isEditing ? (
          <input
            className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-[#CDF056]"
            value={sectionTitle}
            onChange={(e) => onTitleChange(e.target.value)}
            onBlur={onTitleBlur}
            onKeyPress={onTitleKeyPress}
            autoFocus
          />
        ) : (
          <button onClick={onEditStart} className="flex-1 text-left text-sm font-medium text-gray-700 hover:text-[#CDF056]">
            {section.title}
          </button>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onAddTalkingPoint}
            className="px-2 py-1 text-xs text-[#CDF056] hover:bg-[#CDF056]/10 rounded font-medium"
          >
            + Talking Point
          </button>
          {sectionId > 0 && (
            <button onClick={onDeleteSection} className="text-gray-400 hover:text-red-500">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Talking Points */}
      {isExpanded && section.talking_points && section.talking_points.length > 0 && (
        <div className="px-12 pb-3 space-y-2">
          <SortableContext
            items={section.talking_points.map((tp: any) => getItemId("talkingPoint", tp.id ?? -1))}
            strategy={verticalListSortingStrategy}
          >
            {section.talking_points.map((tp: any) => (
              <SortableTalkingPoint
                key={tp.id ?? -1}
                tp={tp}
                isEditing={editingTpId === tp.id}
                tpText={tpTexts[tp.id ?? -1] ?? tp.text}
                onEditStart={() => onTpEditStart(tp.id ?? -1)}
                onTextChange={(value) => onTpTextChange(tp.id ?? -1, value)}
                onTextBlur={() => onTpTextBlur(tp.id ?? -1)}
                onTextKeyPress={(e) => onTpTextKeyPress(tp.id ?? -1, e)}
                onDelete={() => onDeleteTalkingPoint(tp.id ?? -1)}
              />
            ))}
          </SortableContext>
        </div>
      )}
    </div>
  );
}

// Sortable Talking Point Component
function SortableTalkingPoint({
  tp,
  isEditing,
  tpText,
  onEditStart,
  onTextChange,
  onTextBlur,
  onTextKeyPress,
  onDelete,
}: {
  tp: any;
  isEditing: boolean;
  tpText: string;
  onEditStart: () => void;
  onTextChange: (value: string) => void;
  onTextBlur: () => void;
  onTextKeyPress: (e: React.KeyboardEvent) => void;
  onDelete: () => void;
}) {
  const tpId = tp.id ?? -1;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: getItemId("talkingPoint", tpId) });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="bg-white rounded-lg p-2 border border-gray-200">
      <div className="flex items-center gap-3">
        {/* Drag Handle */}
        <div className="text-gray-400 cursor-move" {...attributes} {...listeners}>
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 2a2 2 0 11.001 3.999A2 2 0 017 2zm0 6a2 2 0 11.001 3.999A2 2 0 017 8zm0 6a2 2 0 11.001 3.999A2 2 0 017 14zm6-12a2 2 0 11.001 3.999A2 2 0 0113 2zm0 6a2 2 0 11.001 3.999A2 2 0 0113 8zm0 6a2 2 0 11.001 3.999A2 2 0 0113 14z" />
          </svg>
        </div>

        {/* Bullet Point */}
        <div className="w-2 h-2 rounded-full bg-gray-400"></div>

        {/* Talking Point Text */}
        {isEditing ? (
          <input
            className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-[#CDF056]"
            value={tpText}
            onChange={(e) => onTextChange(e.target.value)}
            onBlur={onTextBlur}
            onKeyPress={onTextKeyPress}
            autoFocus
          />
        ) : (
          <>
            <span className="flex-1 text-xs text-gray-700">{tp.text}</span>
            <button onClick={onEditStart} className="text-xs text-[#CDF056] hover:underline">
              Edit
            </button>
            {tpId > 0 && (
              <button onClick={onDelete} className="text-gray-400 hover:text-red-500">
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
}

export default function OutlineView({
  outline,
  bookId,
  onOutlineUpdate,
  onSwitchTab,
}: OutlineViewProps) {
  // Local state for optimistic updates
  const [localOutline, setLocalOutline] = useState<BookOutline | null>(outline);
  const [expandedChapters, setExpandedChapters] = useState<Record<number, boolean>>({});
  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({});
  const [editingChapterId, setEditingChapterId] = useState<number | null>(null);
  const [editingSectionId, setEditingSectionId] = useState<number | null>(null);
  const [editingTpId, setEditingTpId] = useState<number | null>(null);
  const [chapterTitles, setChapterTitles] = useState<Record<number, string>>({});
  const [sectionTitles, setSectionTitles] = useState<Record<number, string>>({});
  const [tpTexts, setTpTexts] = useState<Record<number, string>>({});
  const [activeId, setActiveId] = useState<string | null>(null);

  // Keep localOutline in sync with prop changes
  useEffect(() => {
    setLocalOutline(outline);
  }, [outline]);

  if (!localOutline || !bookId) {
    return (
      <div className="h-full bg-white p-8">
        <div className="text-gray-500">No outline yet. Generate one from the Position tab.</div>
      </div>
    );
  }

  const handleAddChapter = async () => {
    const defaultTitle = "New Chapter";
    const currentChapterCount = localOutline?.chapters?.length || 0;
    const res = await createChapter(bookId, { title: defaultTitle });
    if (res.success && res.data) {
      setLocalOutline(res.data);
      if (onOutlineUpdate) {
        onOutlineUpdate(res.data);
      }
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
        setExpandedChapters((prev) => ({
          ...prev,
          [newChapter.id!]: true,
        }));
      }
    }
  };

  const handleRenameChapter = async (chapterId: number, title: string) => {
    const res = await updateChapter(chapterId, { title });
    if (res.success && res.data) {
      setLocalOutline(res.data);
      if (onOutlineUpdate) {
        onOutlineUpdate(res.data);
      }
    }
  };

  const handleDeleteChapter = async (chapterId: number) => {
    if (!window.confirm("Delete this chapter?")) return;
    const res = await deleteChapter(chapterId);
    if (res.success && res.data) {
      setLocalOutline(res.data);
      if (onOutlineUpdate) {
        onOutlineUpdate(res.data);
      }
    }
  };

  const handleAddSection = async (chapterId: number) => {
    const defaultTitle = "New Section";
    const currentChapter = localOutline?.chapters?.find((ch: any) => ch.id === chapterId);
    const currentSectionCount = currentChapter?.sections?.length || 0;
    const res = await createSection(chapterId, { title: defaultTitle });
    if (res.success && res.data) {
      setLocalOutline(res.data);
      if (onOutlineUpdate) {
        onOutlineUpdate(res.data);
      }
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
    if (res.success && res.data) {
      setLocalOutline(res.data);
      if (onOutlineUpdate) {
        onOutlineUpdate(res.data);
      }
    }
  };

  const handleDeleteSection = async (sectionId: number) => {
    if (!window.confirm("Delete this section?")) return;
    const res = await deleteSection(sectionId);
    if (res.success && res.data) {
      setLocalOutline(res.data);
      if (onOutlineUpdate) {
        onOutlineUpdate(res.data);
      }
    }
  };

  const handleAddTalkingPoint = async (sectionId: number) => {
    const defaultText = "New Talking Point";
    const currentChapter = localOutline?.chapters?.find((ch: any) => 
      ch.sections?.some((sec: any) => sec.id === sectionId)
    );
    const currentSection = currentChapter?.sections?.find((sec: any) => sec.id === sectionId);
    const currentTpCount = currentSection?.talking_points?.length || 0;
    
    const res = await createTalkingPoint(sectionId, { text: defaultText });
    if (res.success && res.data) {
      setLocalOutline(res.data);
      if (onOutlineUpdate) {
        onOutlineUpdate(res.data);
      }
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
    if (res.success && res.data) {
      setLocalOutline(res.data);
      if (onOutlineUpdate) {
        onOutlineUpdate(res.data);
      }
    }
  };

  const handleDeleteTalkingPoint = async (tpId: number) => {
    if (!window.confirm("Delete this talking point?")) return;
    const res = await deleteTalkingPoint(tpId);
    if (res.success && res.data) {
      setLocalOutline(res.data);
      if (onOutlineUpdate) {
        onOutlineUpdate(res.data);
      }
    }
  };

  const toggleExpandAll = () => {
    if (!localOutline?.chapters) return;
    const allExpanded = localOutline.chapters.every(
      (ch) => expandedChapters[ch.id ?? -1]
    );
    const newState: Record<number, boolean> = {};
    localOutline.chapters.forEach((ch) => {
      if (ch.id) newState[ch.id] = !allExpanded;
    });
    setExpandedChapters(newState);
  };

  // Single drag end handler for all types
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // Reorder chapters
    if (isChapter(activeId) && isChapter(overId)) {
      const chapters = localOutline?.chapters || [];
      const oldIndex = chapters.findIndex((c) => getItemId("chapter", c.id ?? -1) === activeId);
      const newIndex = chapters.findIndex((c) => getItemId("chapter", c.id ?? -1) === overId);

      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        // Optimistically update local state immediately
        const reorderedChapters = arrayMove(chapters, oldIndex, newIndex);
        setLocalOutline((prev) =>
          prev
            ? { ...prev, chapters: reorderedChapters }
            : prev
        );
        
        // Notify parent
        if (onOutlineUpdate && localOutline) {
          onOutlineUpdate({
            ...localOutline,
            chapters: reorderedChapters,
          });
        }
        
        // Update orders via API
        const updatePromises = reorderedChapters
          .filter((chapter) => chapter.id && chapter.id > 0)
          .map((chapter, index) => updateChapter(chapter.id!, { order: index }));

        try {
          const results = await Promise.all(updatePromises);
          const lastResult = results[results.length - 1];
          // Update again with server response to ensure consistency
          if (lastResult?.success && lastResult.data) {
            setLocalOutline(lastResult.data);
            if (onOutlineUpdate) {
              onOutlineUpdate(lastResult.data);
            }
          }
        } catch (error) {
          console.error("Error updating chapter order:", error);
          // Revert on error
          if (localOutline) {
            setLocalOutline(localOutline);
          }
        }
      }
      return;
    }

    // Reorder sections
    if (isSection(activeId) && isSection(overId)) {
      const { id: activeSectionId } = parseItemId(activeId);
      const { id: overSectionId } = parseItemId(overId);

      // Find the chapter containing these sections
      const chapterIndex = localOutline?.chapters?.findIndex((ch) =>
        ch.sections?.some((sec) => sec.id === activeSectionId || sec.id === overSectionId)
      );

      if (chapterIndex !== undefined && chapterIndex !== -1 && localOutline?.chapters) {
        const chapter = localOutline.chapters[chapterIndex];
        if (chapter?.sections) {
          const sections = [...chapter.sections]; // Create a copy
          const oldIndex = sections.findIndex((s) => s.id === activeSectionId);
          const newIndex = sections.findIndex((s) => s.id === overSectionId);

          if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
            // Optimistically update local state immediately
            const reorderedSections = arrayMove(sections, oldIndex, newIndex);
            const updatedChapters = [...localOutline.chapters];
            updatedChapters[chapterIndex] = {
              ...chapter,
              sections: reorderedSections,
            };
            
            setLocalOutline((prev) =>
              prev
                ? { ...prev, chapters: updatedChapters }
                : prev
            );

            // Notify parent
            if (onOutlineUpdate && localOutline) {
              onOutlineUpdate({
                ...localOutline,
                chapters: updatedChapters,
              });
            }

            // Update orders via API
            const updatePromises = reorderedSections
              .filter((section) => section.id && section.id > 0)
              .map((section, index) => updateSection(section.id!, { order: index }));

            try {
              const results = await Promise.all(updatePromises);
              const lastResult = results[results.length - 1];
              // Update again with server response
              if (lastResult?.success && lastResult.data) {
                setLocalOutline(lastResult.data);
                if (onOutlineUpdate) {
                  onOutlineUpdate(lastResult.data);
                }
              }
            } catch (error) {
              console.error("Error updating section order:", error);
              // Revert on error
              if (localOutline) {
                setLocalOutline(localOutline);
              }
            }
          }
        }
      }
      return;
    }

    // Reorder talking points
    if (isTalkingPoint(activeId) && isTalkingPoint(overId)) {
      const { id: activeTpId } = parseItemId(activeId);
      const { id: overTpId } = parseItemId(overId);

      // Find the section containing these talking points
      let chapterIndex = -1;
      let sectionIndex = -1;
      
      if (localOutline?.chapters) {
        for (let ci = 0; ci < localOutline.chapters.length; ci++) {
          const ch = localOutline.chapters[ci];
          if (ch.sections) {
            for (let si = 0; si < ch.sections.length; si++) {
              const sec = ch.sections[si];
              if (sec.talking_points?.some((tp) => tp.id === activeTpId || tp.id === overTpId)) {
                chapterIndex = ci;
                sectionIndex = si;
                break;
              }
            }
            if (sectionIndex !== -1) break;
          }
        }
      }

      if (chapterIndex !== -1 && sectionIndex !== -1 && localOutline?.chapters) {
        const chapter = localOutline.chapters[chapterIndex];
        const section = chapter?.sections?.[sectionIndex];
        
        if (section?.talking_points) {
          const talkingPoints = [...section.talking_points]; // Create a copy
          const oldIndex = talkingPoints.findIndex((tp) => tp.id === activeTpId);
          const newIndex = talkingPoints.findIndex((tp) => tp.id === overTpId);

          if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
            // Optimistically update local state immediately
            const reorderedTalkingPoints = arrayMove(talkingPoints, oldIndex, newIndex);
            const updatedChapters = [...localOutline.chapters];
            const updatedSections = [...(chapter.sections || [])];
            updatedSections[sectionIndex] = {
              ...section,
              talking_points: reorderedTalkingPoints,
            };
            updatedChapters[chapterIndex] = {
              ...chapter,
              sections: updatedSections,
            };
            
            setLocalOutline((prev) =>
              prev
                ? { ...prev, chapters: updatedChapters }
                : prev
            );

            // Notify parent
            if (onOutlineUpdate && localOutline) {
              onOutlineUpdate({
                ...localOutline,
                chapters: updatedChapters,
              });
            }

            // Update orders via API
            const updatePromises = reorderedTalkingPoints
              .filter((tp) => tp.id && tp.id > 0)
              .map((tp, index) => updateTalkingPoint(tp.id!, { order: index }));

            try {
              const results = await Promise.all(updatePromises);
              const lastResult = results[results.length - 1];
              // Update again with server response
              if (lastResult?.success && lastResult.data) {
                setLocalOutline(lastResult.data);
                if (onOutlineUpdate) {
                  onOutlineUpdate(lastResult.data);
                }
              }
            } catch (error) {
              console.error("Error updating talking point order:", error);
              // Revert on error
              if (localOutline) {
                setLocalOutline(localOutline);
              }
            }
          }
        }
      }
      return;
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const chapters = localOutline.chapters || [];
  const activeItem = activeId
    ? (() => {
        if (isChapter(activeId)) {
          const { id } = parseItemId(activeId);
          return chapters.find((c) => c.id === id);
        }
        return null;
      })()
    : null;

  return (
    <div className="h-full bg-gray-50 overflow-y-auto p-8" style={{
      backgroundImage: `url(${background2})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat'
    }}>
      <div className="max-w-6xl mx-auto p-8 bg-gray-100 rounded-lg mt-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 p-8">
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
              onClick={() => {
                if (onSwitchTab) {
                  onSwitchTab("position");
                }
              }}
              className="px-4 py-2 bg-[#CDF056] text-gray border-black border hover:bg-[#3bc96d] font-medium flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Generate Outline
            </button>
          </div>
        </div>

        {/* Outline List with DndContext */}
        <DndContext
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={chapters.map((c) => getItemId("chapter", c.id ?? -1))}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-3 p-4 pt-0">
              {chapters.map((chapter, ci) => {
                const chapterId = chapter.id ?? -1;
                return (
                  <SortableChapter
                    key={chapterId}
                    chapter={chapter}
                    index={ci}
                    isExpanded={expandedChapters[chapterId] ?? false}
                    isEditing={editingChapterId === chapterId}
                    chapterTitle={chapterTitles[chapterId] ?? chapter.title}
                    expandedSections={expandedSections}
                    editingSectionId={editingSectionId}
                    sectionTitles={sectionTitles}
                    editingTpId={editingTpId}
                    tpTexts={tpTexts}
                    onExpandToggle={() => {
                      const newExpanded = !expandedChapters[chapterId];
                      setExpandedChapters((prev) => ({
                        ...prev,
                        [chapterId]: newExpanded,
                      }));
                      if (newExpanded && chapter.sections) {
                        const newSectionState: Record<number, boolean> = {};
                        chapter.sections.forEach((sec) => {
                          if (sec.id) newSectionState[sec.id] = true;
                        });
                        setExpandedSections((prev) => ({ ...prev, ...newSectionState }));
                      }
                    }}
                    onEditStart={() => {
                      setChapterTitles((prev) => ({
                        ...prev,
                        [chapterId]: chapter.title,
                      }));
                      setEditingChapterId(chapterId);
                    }}
                    onTitleChange={(value) =>
                      setChapterTitles((prev) => ({
                        ...prev,
                        [chapterId]: value,
                      }))
                    }
                    onTitleBlur={() => {
                      const title = chapterTitles[chapterId] ?? chapter.title;
                      if (chapterId > 0) {
                        handleRenameChapter(chapterId, title);
                      }
                      setEditingChapterId(null);
                    }}
                    onTitleKeyPress={(e) => {
                      if (e.key === "Enter") {
                        const title = chapterTitles[chapterId] ?? chapter.title;
                        if (chapterId > 0) {
                          handleRenameChapter(chapterId, title);
                        }
                        setEditingChapterId(null);
                      }
                    }}
                    onAddSection={() => handleAddSection(chapterId)}
                    onDeleteChapter={() => chapterId > 0 && handleDeleteChapter(chapterId)}
                    onSectionExpandToggle={(sectionId) =>
                      setExpandedSections((prev) => ({
                        ...prev,
                        [sectionId]: !prev[sectionId],
                      }))
                    }
                    onSectionEditStart={(sectionId) => {
                      const section = chapter.sections?.find((s) => s.id === sectionId);
                      if (section) {
                        setSectionTitles((prev) => ({
                          ...prev,
                          [sectionId]: section.title,
                        }));
                        setEditingSectionId(sectionId);
                      }
                    }}
                    onSectionTitleChange={(sectionId, value) =>
                      setSectionTitles((prev) => ({
                        ...prev,
                        [sectionId]: value,
                      }))
                    }
                    onSectionTitleBlur={(sectionId) => {
                      const section = chapter.sections?.find((s) => s.id === sectionId);
                      if (section) {
                        const title = sectionTitles[sectionId] ?? section.title;
                        if (sectionId > 0) {
                          handleRenameSection(sectionId, title);
                        }
                        setEditingSectionId(null);
                      }
                    }}
                    onSectionTitleKeyPress={(sectionId, e) => {
                      if (e.key === "Enter") {
                        const section = chapter.sections?.find((s) => s.id === sectionId);
                        if (section) {
                          const title = sectionTitles[sectionId] ?? section.title;
                          if (sectionId > 0) {
                            handleRenameSection(sectionId, title);
                          }
                          setEditingSectionId(null);
                        }
                      }
                    }}
                    onAddTalkingPoint={(sectionId) => sectionId > 0 && handleAddTalkingPoint(sectionId)}
                    onDeleteSection={(sectionId) => sectionId > 0 && handleDeleteSection(sectionId)}
                    onTpEditStart={(tpId) => {
                      const section = chapter.sections?.find((s) =>
                        s.talking_points?.some((tp) => tp.id === tpId)
                      );
                      const tp = section?.talking_points?.find((t) => t.id === tpId);
                      if (tp) {
                        setTpTexts((prev) => ({
                          ...prev,
                          [tpId]: tp.text,
                        }));
                        setEditingTpId(tpId);
                      }
                    }}
                    onTpTextChange={(tpId, value) =>
                      setTpTexts((prev) => ({
                        ...prev,
                        [tpId]: value,
                      }))
                    }
                    onTpTextBlur={(tpId) => {
                      const section = chapter.sections?.find((s) =>
                        s.talking_points?.some((tp) => tp.id === tpId)
                      );
                      const tp = section?.talking_points?.find((t) => t.id === tpId);
                      if (tp) {
                        const text = tpTexts[tpId] ?? tp.text;
                        if (tpId > 0) {
                          handleRenameTalkingPoint(tpId, text);
                        }
                        setEditingTpId(null);
                      }
                    }}
                    onTpTextKeyPress={(tpId, e) => {
                      if (e.key === "Enter") {
                        const section = chapter.sections?.find((s) =>
                          s.talking_points?.some((tp) => tp.id === tpId)
                        );
                        const tp = section?.talking_points?.find((t) => t.id === tpId);
                        if (tp) {
                          const text = tpTexts[tpId] ?? tp.text;
                          if (tpId > 0) {
                            handleRenameTalkingPoint(tpId, text);
                          }
                          setEditingTpId(null);
                        }
                      }
                    }}
                    onDeleteTalkingPoint={(tpId) => tpId > 0 && handleDeleteTalkingPoint(tpId)}
                  />
                );
              })}

              {/* Add New Part Button */}
              <button
                onClick={handleAddChapter}
                className="w-full bg-white border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-[#CDF056] hover:bg-[#CDF056]/5 transition-colors"
              >
                <div className="flex items-center justify-center gap-2 text-[#CDF056] font-medium">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>Add New Part</span>
                </div>
              </button>
            </div>
          </SortableContext>

          <DragOverlay>
            {activeItem ? (
              <div className="bg-white rounded-xl border-2 border-[#CDF056] shadow-lg p-4 opacity-90">
                <div className="font-semibold text-gray-900">{activeItem.title}</div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
