import React from 'react'
import ReactDOM from 'react-dom/client'

import App from './App'
import FloatingLogo from './FloatingLogo'
import QuickChat from './QuickChat'
import './styles.css'

const isQuickWindow = window.location.hash === '#quick'
const isFloatingLogoWindow = window.location.hash === '#floating-logo'
document.documentElement.classList.toggle('quick-window-document', isQuickWindow)
document.documentElement.classList.toggle('floating-logo-document', isFloatingLogoWindow)
document.body.classList.toggle('quick-window-body', isQuickWindow)
document.body.classList.toggle('floating-logo-body', isFloatingLogoWindow)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isFloatingLogoWindow ? <FloatingLogo /> : isQuickWindow ? <QuickChat /> : <App />}
  </React.StrictMode>
)
