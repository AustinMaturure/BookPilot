import { useState } from 'react'
import { GoogleOAuthProvider } from '@react-oauth/google';
import Login from './pages/login';

function App() {


  return (
    <GoogleOAuthProvider clientId="332284226702-q2ehoksvf3mvtkh8hv4l9tfajj2h49qi.apps.googleusercontent.com"><Login/></GoogleOAuthProvider>

  )
}

export default App
