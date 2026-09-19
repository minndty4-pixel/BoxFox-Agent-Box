import { useEffect, useState, type KeyboardEvent } from 'react'
import { useCommandsStore } from '../../store/commandsStore'

export function useSlashCompletion(input: string, change: (value: string) => void) {
  const { commands, load } = useCommandsStore()
  const [index, setIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const query = /^\/[\w-]*$/.test(input) ? input.slice(1).toLowerCase() : null
  useEffect(() => { if (query !== null) void load() }, [query === null, load])
  useEffect(() => { setIndex(0); setDismissed(false) }, [input])
  const options = query !== null && !dismissed ? commands.filter(c => c.enabled && c.slug.startsWith(query)).slice(0, 8) : []
  const choose = (slug: string) => { change('/' + slug + ' '); setDismissed(true) }
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return true
    if (!options.length) return false
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(true); return true }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setIndex((index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length); return true
    }
    if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
      event.preventDefault(); choose(options[index % options.length].slug); return true
    }
    return false
  }
  const popup = options.length > 0 && <div id="slash-completions" role="listbox" aria-label="Slash commands" className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-64 overflow-auto rounded-lg border border-line bg-panel p-1 shadow-xl">
    {options.map((c, i) => <button id={`slash-option-${i}`} key={c.slug} role="option" aria-selected={i === index} type="button" onMouseDown={e => e.preventDefault()} onClick={() => choose(c.slug)} className={`block w-full rounded p-2 text-left text-xs ${i === index ? 'bg-panel2 text-brand' : 'text-fg'}`}>
      <span className="font-semibold">/{c.slug}</span><span className="ml-2 text-muted">{c.description}</span>
    </button>)}
  </div>
  return { keyDown, popup, expanded: options.length > 0, activeId: options.length ? `slash-option-${index}` : undefined }
}
