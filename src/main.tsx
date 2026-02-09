import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './shared/styles/globals.css'
import { Providers } from './app/providers'
import { Toaster } from 'react-hot-toast'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#111111',
            color: '#e5e5e5',
            border: '1px solid #2a2a2a',
          },
        }}
      />
    </Providers>
  </React.StrictMode>,
)
