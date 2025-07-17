import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')).render(
  <StrictMode sx={{ padding: "2px" }}>
    <App/>
  </StrictMode>,
)
