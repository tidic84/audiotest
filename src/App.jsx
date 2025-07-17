import { useState } from 'react'
import './App.css'
import AudioRecorder from './AudioRecorder'
import { Box } from '@mui/material'

function App() {

    const [audioUrl, setAudioUrl] = useState('https://cdn.pixabay.com/download/audio/2022/03/14/audio_1bb04cd980.mp3?filename=theme-demo-v02-63144.mp3')

    return (
        <Box sx={{ width: '100%', height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
            <AudioRecorder audioUrl={audioUrl} setAudioUrl={setAudioUrl} />
        </Box>
    )
}

export default App
