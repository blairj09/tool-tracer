import { useState } from 'react'
import TemplatePage from './template/TemplatePage'

function readInitialView(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get('view') === 'template'
}

function App() {
  const [showTemplate, setShowTemplate] = useState<boolean>(readInitialView)

  if (showTemplate) {
    return <TemplatePage onBack={() => setShowTemplate(false)} />
  }

  return (
    <>
      <header className="app-header">
        <h1>ToolTrace</h1>
        <div className="actions">
          <button type="button" className="btn" onClick={() => setShowTemplate(true)}>
            Print template
          </button>
        </div>
      </header>

      <main className="app-main">
        <section className="viewer">
          <p>Upload a photo of your tool on the printed template to get started.</p>
        </section>
        <aside className="panel">
          <h2>Tool settings</h2>
          <p>Controls for calibration, outline extraction, and export will appear here.</p>
        </aside>
      </main>
    </>
  )
}

export default App
