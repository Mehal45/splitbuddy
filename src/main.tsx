import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './index'

// Entry point mounts the main App component to the DOM.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)