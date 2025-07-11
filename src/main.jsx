import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AudioRecorder from './AudioRecorder.jsx'
import App2 from './App2.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AudioRecorder />
    {/* <App2 /> */}
  </StrictMode>,
)
