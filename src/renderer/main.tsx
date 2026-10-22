import '@fontsource-variable/inter'
import '@fontsource-variable/sora'
import './styles/tokens.css'
import './styles/base.css'
import './styles/app.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setApi } from './api'
import { App } from './App'

async function boot(): Promise<void> {
  // No app, a ponte vem do preload. Sem ela (navegador comum, só em desenvolvimento) usa o simulador.
  if (window.leaguesense) setApi(window.leaguesense)
  else if (import.meta.env.DEV) setApi((await import('./dev/mock-api')).createMockApi())
  else throw new Error('Ponte com o processo principal indisponível')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
void boot()
