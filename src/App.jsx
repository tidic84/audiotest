import { useState } from 'react'
import './App.css'
import AudioRecorder from './AudioRecorder'
import Box from '@mui/material/Box';
import OBSNavigator from './OBSNavigator'
import Stack from '@mui/material/Stack'
function App() {

    const [audioUrl, setAudioUrl] = useState('https://cdn.pixabay.com/download/audio/2022/03/14/audio_1bb04cd980.mp3?filename=theme-demo-v02-63144.mp3')
    const [audioPath, setAudioPath] = useState('./audio/')
    const [obs, setObs] = useState([1, 0])
    return (
        <Stack sx={{ width: '100%', height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
            <OBSNavigator max={10} setObs={setObs} obs={obs} />
            <AudioRecorder audioUrl={audioUrl} setAudioUrl={setAudioUrl} audioPath={audioPath} obs={obs} />
        </Stack>
    )
}

export default App
