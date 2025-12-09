import { useGoogleLogin } from "@react-oauth/google";
import { jwtDecode } from "jwt-decode";
import { googleLogin } from "../utils/api";
import { useState } from "react";
import logo from "../assets/image.png"

export default function Login() {
  const [authStatus, setAuthStatus] = useState("Sign in with Google");

  const login = useGoogleLogin({
    flow: "auth-code",
    onSuccess: async (codeResponse) => {
      console.log("Google Auth Code:", codeResponse.code);
      setAuthStatus("Signed In")
      const response = await googleLogin({ code: codeResponse.code });

      console.log("Backend response:", response.data);
    },
    onError: () => {
      console.log("Login failed");
    }
  });
  

  return (
    <button
      onClick={() => login()}
      style={{
        padding: "12px 20px",
   

        fontWeight: "600",
        fontSize: "16px",
        cursor: "pointer"
      }}
      className="flex items-center bg-neutral-100 rounded-3xl"
    >
      <img src={logo} alt="" className="w-8 h-8 text-neutral-900 " />{authStatus}
    </button>
  );
}
