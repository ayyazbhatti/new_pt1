import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './shared/styles/globals.css'
import { Providers } from './app/providers'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      <App />
    </Providers>
  </React.StrictMode>,
)
