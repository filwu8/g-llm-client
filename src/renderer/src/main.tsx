import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App'
import QuickChat from './QuickChat'
import './styles.css'

const isQuickWindow = window.location.hash === '#quick'
document.body.classList.toggle('quick-window-body', isQuickWindow)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isQuickWindow ? <QuickChat /> : <App />}
  </React.StrictMode>
)
