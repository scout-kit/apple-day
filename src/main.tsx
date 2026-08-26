import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { EventProvider } from './lib/eventContext'
import { SectionsProvider } from './lib/sections'
import { SessionProvider } from './lib/session'
import { ThemeProvider } from './lib/theme'
import { ErrorBoundary } from './ui/ErrorBoundary'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root')

createRoot(root).render(
  <StrictMode>
    {/* The boundary is outside everything, because a provider throwing on startup is the
        case that otherwise leaves nothing on screen at all. The theme is next: what a page
        looks like does not depend on who is signed in, and a volunteer's pass, which has no
        shell and no session, needs it just the same. */}
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <SessionProvider>
            <EventProvider>
              <SectionsProvider>
                <App />
              </SectionsProvider>
            </EventProvider>
          </SessionProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
