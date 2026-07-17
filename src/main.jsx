import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { PermissionsProvider } from './contexts/PermissionsContext'
import { NotificationsProvider } from './contexts/NotificationsContext'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <PermissionsProvider>
          <NotificationsProvider>
            <App />
          </NotificationsProvider>
        </PermissionsProvider>
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>
)
