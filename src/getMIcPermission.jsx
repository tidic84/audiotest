import { useEffect, useState } from "react";


export function useMicrophonePermission() {
  const [permissionState, setPermissionState] =
    useState("loading");

  useEffect(() => {
    window.navigator.permissions
      .query({ name: "microphone" })
      .then(function (result) {
        setPermissionState(result.state);
      });
  }, []);

  const requestMicrophone = () => {
    window.navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(() => {
        setPermissionState("granted");
      })
      .catch(function (err) {
        console.error("Microphone access error:", err);
        setPermissionState("denied");
      });
  };

  return {
    permissionState,
    requestMicrophone,
  };
}