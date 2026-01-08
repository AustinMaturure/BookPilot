import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import Navbar from './components/navbar.tsx';
import Books from './pages/Books.tsx';
import BookDetail from './pages/BookDetail.tsx';
import Login from './pages/Login.tsx';
import Marketing from './pages/Marketing.tsx';
import Repurpose from './pages/Repurpose.tsx';
import Analytics from './pages/Analytics.tsx';
import Settings from './pages/Settings.tsx';
import { getAuthToken, getCurrentUser } from './utils/api';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const token = getAuthToken();
      if (!token) {
        setIsAuthenticated(false);
        setLoading(false);
        return;
      }

      try {
        const result = await getCurrentUser();
        setIsAuthenticated(result.success);
      } catch {
        setIsAuthenticated(false);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID} >
      <BrowserRouter>
        {!isAuthenticated ? (
          <Login />
        ) : (
          <>
            <Navbar/>
            <Routes>
              <Route path="/" element={<Books />} />
              <Route path="/book/:id" element={<BookDetail />} />
              <Route path="/marketing" element={<Marketing />} />
              <Route path="/repurpose" element={<Repurpose />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </>
        )}
      </BrowserRouter>
    </GoogleOAuthProvider>
  )
}

export default App
