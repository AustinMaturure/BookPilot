import axios from "axios"

// Configure axios to include auth token in requests
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
});

// Add token to requests if available
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("auth_token");
  if (token) {
    config.headers.Authorization = `Token ${token}`;
  }
  return config;
});

export async function emailSignup(data: { email: string; password: string }) {
  try {
    const response = await api.post("accounts/api/email_signup/", data);
    if (response.data.token) {
      localStorage.setItem("auth_token", response.data.token);
    }
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function emailLogin(data: { email: string; password: string }) {
  try {
    const response = await api.post("accounts/api/email_login/", data);
    if (response.data.token) {
      localStorage.setItem("auth_token", response.data.token);
    }
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function getCurrentUser() {
  try {
    const response = await api.get("accounts/api/current_user/");
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export function logout() {
  localStorage.removeItem("auth_token");
}

export function getAuthToken() {
  return localStorage.getItem("auth_token");
}

export async function googleLogin(data: { code: string }){
    try {
    const response = await api.post("accounts/api/google_login/", data)
    if (response.data.token) {
      localStorage.setItem("auth_token", response.data.token);
    }
    return { success: true, status: response.status, data: response.data };}
    catch (err: unknown) {
        if (err instanceof Error) {
          return { success: false, error: err.message };
        }
        return { success: false, error: "Unknown error" };
      }
}

export async function generateFollowupQuestion(data: {
  question: string;
  answer: string;
  context?: { question: string; answer: string }[];
}) {
  try {
    const response = await api.post("pilot/api/generate_followup/", data);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function createOutline(data: {
  answers: { question: string; answer: string; key?: string }[];
  book_id?: number;
}) {
  try {
    const response = await api.post("pilot/api/create_outline/", data);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function fetchBooks() {
  try {
    const response = await api.get("pilot/api/books/");
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function createBook(data: { title: string }) {
  try {
    const response = await api.post("pilot/api/books/create/", data);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function fetchBook(id: number) {
  try {
    const response = await api.get(`pilot/api/books/${id}/`);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function createChapter(bookId: number, data: { title: string; order?: number }) {
  try {
    const response = await api.post(`pilot/api/books/${bookId}/chapters/`, data);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function updateChapter(
  chapterId: number,
  data: { title?: string; order?: number }
) {
  try {
    const response = await api.patch(`pilot/api/chapters/${chapterId}/`, data);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function deleteChapter(chapterId: number) {
  try {
    const response = await api.delete(`pilot/api/chapters/${chapterId}/delete/`);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function createSection(
  chapterId: number,
  data: { title: string; order?: number }
) {
  try {
    const response = await api.post(`pilot/api/chapters/${chapterId}/sections/`, data);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function updateSection(
  sectionId: number,
  data: { title?: string; order?: number }
) {
  try {
    const response = await api.patch(`pilot/api/sections/${sectionId}/`, data);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function deleteSection(sectionId: number) {
  try {
    const response = await api.delete(`pilot/api/sections/${sectionId}/delete/`);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function createTalkingPoint(
  sectionId: number,
  data: { text: string; order?: number }
) {
  try {
    const response = await api.post(`pilot/api/sections/${sectionId}/talking_points/`, data);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function updateTalkingPoint(
  tpId: number,
  data: { text?: string; order?: number; content?: string }
) {
  try {
    const response = await api.patch(`pilot/api/talking_points/${tpId}/`, data);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function deleteTalkingPoint(tpId: number) {
  try {
    const response = await api.delete(`pilot/api/talking_points/${tpId}/delete/`);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function generateTextFromTalkingPoint(data: {
  talking_point_id: number;
  talking_point_name: string;
  book_id: number;
  asset_ids?: number[];
}) {
  try {
    const response = await api.post("pilot/api/generate_text/", data);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function addUserContext(data: {
  book_id: number;
  context_text: string;
  talking_point_id?: number;
}) {
  try {
    const response = await api.post("pilot/api/user_context/", data);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function uploadChapterAsset(data: {
  book_id: number;
  talking_point_id?: number;
  file: File;
}) {
  try {
    const formData = new FormData();
    formData.append("book_id", data.book_id.toString());
    formData.append("file", data.file);
    if (data.talking_point_id) {
      formData.append("talking_point_id", data.talking_point_id.toString());
    }
    
    const response = await api.post("pilot/api/assets/upload/", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function listChapterAssets(data: {
  book_id: number;
  talking_point_id?: number;
}) {
  try {
    const params = new URLSearchParams({ book_id: data.book_id.toString() });
    if (data.talking_point_id) {
      params.append("talking_point_id", data.talking_point_id.toString());
    }
    
    const response = await api.get(`pilot/api/assets/?${params.toString()}`);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function askChatQuestion(data: {
  book_id: number;
  talking_point_id: number;
  question: string;
  highlighted_text?: string;
}) {
  try {
    const response = await api.post("pilot/api/chat/", data);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function chatWithChanges(data: {
  book_id: number;
  talking_point_id: number;
  question: string;
  highlighted_text?: string;
  apply_changes?: boolean;
}) {
  try {
    const response = await api.post("pilot/api/chat/with-changes/", data);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export type CommentType = {
  id: number;
  talking_point: number;
  user?: number;
  user_name?: string;
  user_email?: string;
  text: string;
  comment_type: "ai" | "user" | "collaborator";
  suggested_replacement?: string;
  created_at: string;
  updated_at: string;
};

export async function getComments(talking_point_id: number) {
  try {
    const response = await api.get(`pilot/api/comments/?talking_point_id=${talking_point_id}`);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function createComment(data: {
  talking_point_id: number;
  text: string;
  comment_type?: "ai" | "user" | "collaborator";
  suggested_replacement?: string;
}) {
  try {
    const response = await api.post("pilot/api/comments/", data);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function updateComment(comment_id: number, data: {
  text?: string;
  suggested_replacement?: string;
}) {
  try {
    const response = await api.put(`pilot/api/comments/${comment_id}/`, data);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function deleteComment(comment_id: number) {
  try {
    const response = await api.delete(`pilot/api/comments/${comment_id}/`);
    return { success: true, status: response.status };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function quickTextAction(data: {
  book_id: number;
  talking_point_id: number;
  selected_text: string;
  action: "shorten" | "strengthen" | "clarify";
}) {
  try {
    const response = await api.post("pilot/api/quick-action/", data);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export type Collaborator = {
  id: number;
  user_id: number;
  user_email: string;
  user_name: string;
  role: "editor" | "viewer" | "commenter";
  invited_by?: string;
  created_at: string;
};

export async function getBookCollaborators(book_id: number) {
  try {
    const response = await api.get(`pilot/api/books/${book_id}/collaborators/`);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function inviteCollaborator(data: {
  book_id: number;
  email: string;
  role?: "editor" | "viewer" | "commenter";
}) {
  try {
    const response = await api.post(`pilot/api/books/${data.book_id}/collaborators/`, {
      email: data.email,
      role: data.role || "commenter",
    });
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function removeCollaborator(book_id: number, collaborator_id: number) {
  try {
    const response = await api.delete(`pilot/api/books/${book_id}/collaborators/${collaborator_id}/`);
    return { success: true, status: response.status };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export type ContentChange = {
  id: number;
  talking_point: number;
  user: number;
  user_name: string;
  user_email: string;
  step_json: any; // Array of step.toJSON() objects - the ONLY source of truth
  comment: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
  approved_by: number | null;
  approved_by_name: string | null;
  approved_at: string | null;
};

export async function getContentChanges(talking_point_id: number, status?: "pending" | "approved" | "rejected") {
  try {
    const params = status ? { status } : {};
    const response = await api.get(`pilot/api/talking_points/${talking_point_id}/changes/`, { params });
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

/**
 * createContentChange - Creates a suggestion using ProseMirror steps
 * 
 * HARD CONSTRAINTS:
 * - step_json is REQUIRED (array of step.toJSON() objects)
 * - NO text diffs, NO position calculations, NO legacy fields
 * - Backend stores step_json only - never touches content
 */
export async function createContentChange(data: {
  talking_point_id: number;
  step_json: any; // REQUIRED - array of step.toJSON() objects
  comment?: string;
}) {
  try {
    const payload: any = {
      step_json: data.step_json, // REQUIRED - steps are the ONLY source of truth
    };
    
    if (data.comment) {
      payload.comment = data.comment;
    }
    
    const response = await api.post(`pilot/api/talking_points/${data.talking_point_id}/changes/`, payload);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function approveContentChange(change_id: number) {
  try {
    const response = await api.patch(`pilot/api/changes/${change_id}/`, { status: "approved" });
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function rejectContentChange(change_id: number) {
  try {
    const response = await api.patch(`pilot/api/changes/${change_id}/`, { status: "rejected" });
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function deleteContentChange(change_id: number) {
  try {
    const response = await api.delete(`pilot/api/changes/${change_id}/`);
    return { success: true, status: response.status };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export type BookCheckFinding = {
  book_id: number;
  chapter_id: number;
  chapter_title: string;
  section_id: number;
  section_title: string;
  talking_point_id: number;
  talking_point_text: string;
  category: "editorial" | "legal" | "platform";
  status: "passed" | "warning" | "critical";
  code: string;
  title: string;
  message: string;
  recommendation?: string;
  affected_ranges?: { from: number; to: number };
};

export type BookCheckCategory = {
  status: "passed" | "warning" | "critical";
  findings_count: number;
  findings: BookCheckFinding[];
  checks: string[];
};

export type BookCheckResults = {
  book_id: number;
  categories: {
    editorial: BookCheckCategory;
    legal: BookCheckCategory;
    platform: BookCheckCategory;
  };
  all_findings: BookCheckFinding[];
};

export async function runBookChecks(book_id: number): Promise<{ success: boolean; data?: BookCheckResults; error?: string }> {
  try {
    const response = await api.post(`pilot/api/books/${book_id}/checks/`);
    return { success: true, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function applyAllApprovedChanges(talking_point_id: number) {
  try {
    const response = await api.post(`pilot/api/talking_points/${talking_point_id}/apply-changes/`);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

export async function getCollaborationState(talking_point_id: number) {
  try {
    const response = await api.get(`pilot/api/talking_points/${talking_point_id}/collab/state/`);
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

