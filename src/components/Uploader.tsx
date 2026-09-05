import { useRef, useState } from 'react'

interface UploaderProps {
  file: File | null
  onFile: (file: File) => void
  disabled?: boolean
}

export default function Uploader({ file, onFile, disabled }: UploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const pick = () => inputRef.current?.click()

  return (
    <div
      className={`uploader${dragOver ? ' uploader-drag' : ''}${disabled ? ' uploader-disabled' : ''}`}
      onClick={disabled ? undefined : pick}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (disabled) return
        const dropped = e.dataTransfer.files?.[0]
        if (dropped) onFile(dropped)
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      title="Photograph straight down, all four markers visible, even lighting, no harsh shadows."
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        disabled={disabled}
        onChange={(e) => {
          const chosen = e.target.files?.[0]
          if (chosen) onFile(chosen)
          e.target.value = ''
        }}
      />
      <div className="uploader-icon" aria-hidden="true">
        📷
      </div>
      <div className="uploader-text">
        <div className="uploader-label">Drop a photo or click to choose</div>
        {file && <div className="uploader-filename">{file.name}</div>}
      </div>
    </div>
  )
}
