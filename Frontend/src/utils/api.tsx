import axios from "axios"


export async function googleLogin(data: { code: string }){
    try {
    const response = await axios.post(`${import.meta.env.VITE_API_URL}accounts/api/google_login/`, data)
    return { success: true, status: response.status, data: response.data };}
    catch (err: unknown) {
        if (err instanceof Error) {
          return { success: false, error: err.message };
        }
        return { success: false, error: "Unknown error" };
      }
}

export async function createOutline(data: {
  answers: { question: string; answer: string }[];
  book_id?: number;
}) {
  try {
    const response = await axios.post(
      `${import.meta.env.VITE_API_URL}pilot/api/create_outline/`,
      data
    );
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
    const response = await axios.get(`${import.meta.env.VITE_API_URL}pilot/api/books/`);
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
    const response = await axios.post(`${import.meta.env.VITE_API_URL}pilot/api/books/create/`, data);
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
    const response = await axios.get(`${import.meta.env.VITE_API_URL}pilot/api/books/${id}/`);
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
    const response = await axios.post(
      `${import.meta.env.VITE_API_URL}pilot/api/books/${bookId}/chapters/`,
      data
    );
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
    const response = await axios.patch(
      `${import.meta.env.VITE_API_URL}pilot/api/chapters/${chapterId}/`,
      data
    );
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
    const response = await axios.delete(
      `${import.meta.env.VITE_API_URL}pilot/api/chapters/${chapterId}/delete/`
    );
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
    const response = await axios.post(
      `${import.meta.env.VITE_API_URL}pilot/api/chapters/${chapterId}/sections/`,
      data
    );
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
    const response = await axios.patch(
      `${import.meta.env.VITE_API_URL}pilot/api/sections/${sectionId}/`,
      data
    );
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
    const response = await axios.delete(
      `${import.meta.env.VITE_API_URL}pilot/api/sections/${sectionId}/delete/`
    );
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
    const response = await axios.post(
      `${import.meta.env.VITE_API_URL}pilot/api/sections/${sectionId}/talking_points/`,
      data
    );
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
  data: { text?: string; order?: number }
) {
  try {
    const response = await axios.patch(
      `${import.meta.env.VITE_API_URL}pilot/api/talking_points/${tpId}/`,
      data
    );
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
    const response = await axios.delete(
      `${import.meta.env.VITE_API_URL}pilot/api/talking_points/${tpId}/delete/`
    );
    return { success: true, status: response.status, data: response.data };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Unknown error" };
  }
}

