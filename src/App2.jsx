import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'

function App() {

    const record = document.querySelector(".record");
    const stop = document.querySelector(".stop");
    const soundClips = document.querySelector(".sound-clips");

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        console.log("getUserMedia supported.");
        navigator.mediaDevices
            .getUserMedia(
                // constraints - only audio needed for this app
                {
                    audio: true,
                },
            )

            // Success callback
            .then((stream) => {
                console.log("stream", stream);
                const mediaRecorder = new MediaRecorder(stream);

                record.onclick = () => {
                    mediaRecorder.start();
                    console.log(mediaRecorder.state);
                    console.log("recorder started");
                    record.style.background = "red";
                    record.style.color = "black";
                };

                let chunks = [];

                mediaRecorder.ondataavailable = (e) => {
                    chunks.push(e.data);
                };
                stop.onclick = () => {
                    mediaRecorder.stop();
                    console.log(mediaRecorder.state);
                    console.log("recorder stopped");
                    record.style.background = "";
                    record.style.color = "";
                };
                mediaRecorder.onstop = (e) => {
                    console.log("recorder stopped");

                    const clipName = prompt("Enter a name for your sound clip");

                    const clipContainer = document.createElement("article");
                    const clipLabel = document.createElement("p");
                    const audio = document.createElement("audio");
                    const deleteButton = document.createElement("button");

                    clipContainer.classList.add("clip");
                    audio.setAttribute("controls", "");
                    deleteButton.textContent = "Delete";
                    clipLabel.textContent = clipName;

                    clipContainer.appendChild(audio);
                    clipContainer.appendChild(clipLabel);
                    clipContainer.appendChild(deleteButton);
                    soundClips.appendChild(clipContainer);

                    const blob = new Blob(chunks, { type: "audio/ogg; codecs=opus" });
                    chunks = [];
                    const audioURL = window.URL.createObjectURL(blob);
                    audio.src = audioURL;

                    deleteButton.onclick = (e) => {
                        let evtTgt = e.target;
                        evtTgt.parentNode.parentNode.removeChild(evtTgt.parentNode);
                    };
                };
            })

            // Error callback
            .catch((err) => {
                console.error(`The following getUserMedia error occurred: ${err}`);
            });
    } else {
        console.log("getUserMedia not supported on your browser!");
    }

    return (
        <div>
            <h1>Hello World</h1>
            <button className="record">Record</button>
            <button className="stop">Stop</button>
            <div className="sound-clips"></div>
        </div>
    )
}

export default App
