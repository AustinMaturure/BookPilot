import { useState } from 'react'
import { GoogleOAuthProvider } from '@react-oauth/google';
import Login from './components/google-login.tsx';
import Navbar from './components/navbar.tsx';
import Books from './pages/Books.tsx';

function App() {


  return (
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID} >
      <Navbar/>
      <Books/>
    </GoogleOAuthProvider>

  )
}

export default App
