import React, { useRef, useState } from 'react';
import { useMicrophonePermission } from './getMIcPermission';
const AudioRecorder = () => {
    const [recordedUrl, setRecordedUrl] = useState('');
    const mediaStream = useRef(null);
    const mediaRecorder = useRef(null);
    const chunks = useRef([]);
    const { permissionState, requestMicrophone } = useMicrophonePermission();

    const startRecording = async () => {
        if (permissionState === "denied") {
            console.log("Permission denied");
            requestMicrophone();
            return;
        }
        try {
            console.log("Starting recording, maybe");
            
            const stream = await navigator.mediaDevices.getUserMedia(
                { audio: true }
            );
            console.log("We have a stream");
            mediaStream.current = stream;
            mediaRecorder.current = new MediaRecorder(stream);
            mediaRecorder.current.ondataavailable = (e) => {
                console.log("data available")
                if (e.data.size > 0) {
                    chunks.current.push(e.data);
                }
            };
            mediaRecorder.current.onstop = () => {
                console.log("Event: Recording stopped");
            };
            mediaRecorder.current.start(1000);
        } catch (error) {
            console.error('Error accessing microphone:', error);
        }
    };
    const stopRecording = () => {
        if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
            console.log("Stopping recording ...");
            mediaRecorder.current.stop();
            console.log("Recording stopped");
            const recordedBlob = new Blob(
                chunks.current, { type: 'audio/webm' }
            );
            const url = URL.createObjectURL(recordedBlob);
            console.log("Recording chunks: ", chunks.current);
            console.log("Recording URL: ", url);
            setRecordedUrl(url);
            chunks.current = [];
        }
        if (mediaStream.current) {
            console.log("Stopping stream ...");
            mediaStream.current.getTracks().forEach((track) => {
                track.stop();
            });
        }
    };
    return (
        <div>
            <audio controls src={recordedUrl} />
            <button onClick={startRecording}>Start Recording</button>
            <button onClick={stopRecording}>Stop Recording</button>
        </div>
    );
};
export default AudioRecorder;