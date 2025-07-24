import { useState } from 'react'
import './App.css'
import AudioRecorder from './AudioRecorder'
import Box from '@mui/material/Box';
import OBSNavigator from './OBSNavigator'
import Stack from '@mui/material/Stack'

import './App.css'

function App() {

    const [audioUrl, setAudioUrl] = useState('https://cdn.pixabay.com/download/audio/2022/03/14/audio_1bb04cd980.mp3?filename=theme-demo-v02-63144.mp3')
    const [audioPath, setAudioPath] = useState('./audio/')
    const [obs, setObs] = useState([1, 0])
    const metadata = {
        local_path: '_local_/_local_/MOBS/',
    }
    return (
        <Stack sx={{ width: '100%', height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
            <OBSNavigator max={10} setObs={setObs} obs={obs} />
            <Box sx={{ display: 'flex', flexDirection: 'row', gap: 2, width: '100%', height: '100%' }}>
                <AudioRecorder audioUrl={audioUrl} setAudioUrl={setAudioUrl} audioPath={audioPath} obs={obs} metadata={metadata}/>
                {/* <AudioRecorder audioUrl={audioUrl} setAudioUrl={setAudioUrl} audioPath={audioPath} obs={obs} metadata={metadata}/> */}
            </Box>
        </Stack>
    )
}

export default App
