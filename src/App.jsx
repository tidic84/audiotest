import { useState, useRef } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { i18nContext } from "pankosmia-rcl";
import AudioRecorder from "./AudioRecorder";
import OBSNavigator from "./OBSNavigator";
import "./App.css";

const translations = {
  "pages:core-local-workspace:tooltip_play_pause": "Play/Pause",
  "pages:core-local-workspace:tooltip_record": "Enregistrer",
  "pages:core-local-workspace:tooltip_restore": "Annuler",
  "pages:core-local-workspace:tooltip_paste": "Coller",
  "pages:core-local-workspace:tooltip_copy": "Copier",
  "pages:core-local-workspace:tooltip_delete": "Supprimer la sélection",
  "pages:core-local-workspace:tooltip_confirm_renaming": "Confirmer",
  "pages:core-local-workspace:tooltip_cancel_renaming": "Annuler",
  "pages:core-local-workspace:tooltip_switch_with_maintrack":
    "Échanger avec la piste principale",
  "pages:core-local-workspace:tooltip_rename_track": "Renommer la piste",
  "pages:core-local-workspace:tooltip_delete_track": "Supprimer la piste",
  "pages:core-local-workspace:tooltip_play_track": "Lire la piste",
  "pages:core-local-workspace:delete_track": "Supprimer la piste",
  "pages:core-local-workspace:play_track": "Lire la piste",
  "pages:core-local-workspace:main_track": "Piste principale",
  "pages:core-local-workspace:empty_track": "Piste vide",
  "pages:core-local-workspace:recording_in_progress":
    "Enregistrement en cours",
};

function App() {
  const [audioUrl, setAudioUrl] = useState(
    "https://cdn.pixabay.com/download/audio/2022/03/14/audio_1bb04cd980.mp3?filename=theme-demo-v02-63144.mp3",
  );
  const [audioPath, setAudioPath] = useState("./audio/");
  const [obs, setObs] = useState([1, 0]);
  const metadata = {
    local_path: "_local_/_local_/obst/",
  };

  const i18nRef = useRef(translations);

  return (
    <i18nContext.Provider value={{ i18nRef }}>
      <Stack
        sx={{
          width: "100%",
          height: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <OBSNavigator max={10} setObs={setObs} obs={obs} />
        <Box
          sx={{
            display: "flex",
            flexDirection: "row",
            gap: 2,
            width: "100%",
            height: "100%",
          }}
        >
          <AudioRecorder
            audioUrl={audioUrl}
            setAudioUrl={setAudioUrl}
            audioPath={audioPath}
            obs={obs}
            metadata={metadata}
          />
        </Box>
      </Stack>
    </i18nContext.Provider>
  );
}

export default App;
