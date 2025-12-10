import { useState } from 'react'
import { GoogleOAuthProvider } from '@react-oauth/google';
import Login from './pages/login';
import Navbar from './components/navbar';

function App() {


  return (
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
      <Navbar/>
    </GoogleOAuthProvider>

  )
}

export default App
