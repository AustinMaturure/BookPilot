import axios from "axios"


export async function googleLogin(data: { code: string }){
    try {
    const response = await axios.post(`${import.meta.env.VITE_API_URL}/accounts/api/google_login/`, data)
    return { success: true, status: response.status, data: response.data };}
    catch (err: unknown) {
        if (err instanceof Error) {
          return { success: false, error: err.message };
        }
        return { success: false, error: "Unknown error" };
      }
}