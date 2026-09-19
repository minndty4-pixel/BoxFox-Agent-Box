import { useEffect, useState } from 'react'
import { agentApi } from '../../lib/agentApi'
import { useCommandsStore, type CustomCommand } from '../../store/commandsStore'
import { useSkillsStore } from '../../store/skillsStore'

const blank = (): CustomCommand => ({ slug: '', description: '', kind: 'custom', enabled: true, template: '$ARGUMENTS', skills: [], role: 'build', executor: 'native', revision: 0 })
const field = 'w-full rounded-md border border-line bg-panel2 p-2 text-sm text-fg'
export function CommandsView() {
  const { custom, load, error } = useCommandsStore()
  const skills = useSkillsStore(s => s.skills)
  const [draft, setDraft] = useState(blank)
  const [editing, setEditing] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [sample, setSample] = useState('')
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { void load() }, [load])
  const save = async () => {
    setBusy(true); setMessage('')
    try {
      const saved = await agentApi<CustomCommand>(editing ? `/commands/${editing}` : '/commands', draft, editing ? 'PUT' : 'POST')
      setDraft(saved); setEditing(saved.slug); await load(); setMessage('Saved')
    } catch (err) { setMessage(String(err)) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!editing) return
    setBusy(true)
    try { await agentApi(`/commands/${editing}`, { revision: draft.revision }, 'DELETE'); setDraft(blank()); setEditing(null); await load() }
    catch (err) { setMessage(String(err)) } finally { setBusy(false) }
  }
  return <section className="space-y-4" aria-label="Custom commands">
    <p className="text-sm text-muted">Combine a task prompt, skills, specialist and executor. $ARGUMENTS inserts your message as text.</p>
    <div className="flex flex-wrap gap-2">
      <button className={field + ' w-auto'} onClick={() => { setDraft(blank()); setEditing(null); setMessage(''); setPreview('') }}>New command</button>
      {custom.map(c => <button className={field + ' w-auto'} key={c.slug} onClick={() => { setDraft(c); setEditing(c.slug); setMessage(''); setPreview('') }}>/{c.slug}{!c.enabled && ' (disabled)'}</button>)}
    </div>
    <form className="grid gap-3 md:grid-cols-2" onSubmit={e => { e.preventDefault(); void save() }}>
      <label className="text-sm">Command name<input className={field} required value={draft.slug} disabled={!!editing} placeholder="fix-with-claude" onChange={e => setDraft({ ...draft, slug: e.target.value })} /></label>
      <label className="text-sm">Description<input className={field} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
      <label className="text-sm">Specialist<select className={field} value={draft.role} onChange={e => setDraft({ ...draft, role: e.target.value })}>{['explore', 'plan', 'design', 'build', 'debug', 'review', 'simplify', 'testing', 'research'].map(r => <option key={r}>{r}</option>)}</select></label>
      <label className="text-sm">Executor<select className={field} value={draft.executor} onChange={e => setDraft({ ...draft, executor: e.target.value as CustomCommand['executor'] })}><option value="native">BoxFox native</option><option value="claude-code">Claude Code CLI (sandbox login required)</option></select></label>
      <label className="text-sm md:col-span-2">Prompt template<textarea className={field} rows={5} required value={draft.template} onChange={e => setDraft({ ...draft, template: e.target.value })} /></label>
      <fieldset className="md:col-span-2 max-h-48 overflow-y-auto border border-line rounded-lg p-3"><legend>Skills</legend>
        {skills.map(s => <label key={s.id} className="flex gap-2 text-sm py-1"><input type="checkbox" checked={draft.skills.includes(s.id)} onChange={e => setDraft({ ...draft, skills: e.target.checked ? [...draft.skills, s.id] : draft.skills.filter(id => id !== s.id) })} />{s.name}{!s.enabled && ' (disabled)'}</label>)}
      </fieldset>
      <label className="flex gap-2"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />Enabled</label>
      <div className="flex gap-2"><button disabled={busy} className={field} type="submit">Save command</button>{editing && <button disabled={busy} className={field} type="button" onClick={() => void remove()}>Delete command</button>}</div>
    </form>
    <label className="block text-sm">Preview a saved command<input className={field} value={sample} placeholder="/fix-with-claude fix the failing test" onChange={e => setSample(e.target.value)} /></label>
    <button className={field} onClick={() => { void agentApi('/commands/resolve', { prompt: sample }).then(r => setPreview(JSON.stringify(r, null, 2))).catch(e => setPreview(String(e))) }}>Preview resolution (no execution)</button>
    {preview && <pre className="whitespace-pre-wrap break-words rounded-lg bg-panel2 p-3 text-xs">{preview}</pre>}
    {(message || error) && <p role="status" className="text-sm">{message || error}</p>}
  </section>
}
