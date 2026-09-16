import { useEffect, useRef } from 'react'
import { Globe, Terminal } from 'lucide-react'
import { useUiStore } from '../../store/uiStore'
import { SettingsSidebar } from './SettingsSidebar'
import { HarnessList } from './HarnessList'
import { HarnessEditor } from './HarnessEditor'
import { ScheduledSessionsView } from './ScheduledSessionsView'
import { AutomationsView } from './AutomationsView'
import { SecretsView } from './SecretsView'
import { BrowserView } from './BrowserView'
import { PullRequestsView } from './PullRequestsView'
import { AppearanceView } from './AppearanceView'
import { AccountView } from './AccountView'
import { NotificationsView } from './NotificationsView'
import { UsageView } from './UsageView'
import { ReferralsView } from './ReferralsView'
import { ProviderView } from './ProviderView'
import { SupportView } from './SupportView'

export function SettingsModal() {
  const isSettingsOpen = useUiStore((s) => s.isSettingsOpen)
  const settingsTab = useUiStore((s) => s.settingsTab)
  const editingHarnessId = useUiStore((s) => s.editingHarnessId)
  const providerInitialTab = useUiStore((s) => s.providerInitialTab)
  const closeSettings = useUiStore((s) => s.closeSettings)
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isSettingsOpen) return
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeSettings() }
      if (event.key !== 'Tab') return
      const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]') ?? [])].filter(el => el.getClientRects().length)
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('keydown', key); previous?.focus() }
  }, [isSettingsOpen, closeSettings])

  if (!isSettingsOpen) return null

  const renderContent = () => {
    if (editingHarnessId) {
      return <HarnessEditor harnessId={editingHarnessId} />
    }

    switch (settingsTab) {
      case 'harness':
        return <HarnessList />
      case 'instructions':
        return (
          <div className="p-8 max-w-4xl select-text">
            <h1 className="text-lg font-semibold mb-1 text-fg">Custom Instructions</h1>
            <p className="text-xs text-muted mb-4">
              Add global behavioral rules and system constraints for all agent sessions.
            </p>
            <textarea
              rows={8}
              placeholder="Enter instructions (e.g. Always write clean TypeScript code with strict checks)..."
              className="w-full rounded-md border border-line bg-panel p-3 text-xs text-fg outline-hidden focus:border-brand font-mono"
            />
          </div>
        )
      case 'skills':
        return (
          <div className="p-8 max-w-4xl select-text">
            <h1 className="text-lg font-semibold mb-1 text-fg">Skills & Capabilities</h1>
            <p className="text-xs text-muted mb-4">
              Manage custom toolkits and reusable skill packages.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg border border-line bg-panel">
                <div className="flex items-center gap-2 mb-1 text-blue-400">
                  <Globe className="size-4" />
                  <span className="font-medium text-fg text-xs">Web Search & Fetch</span>
                </div>
                <p className="text-xs text-muted">Fetch web page markdown and search queries.</p>
              </div>
              <div className="p-4 rounded-lg border border-line bg-panel">
                <div className="flex items-center gap-2 mb-1 text-emerald-400">
                  <Terminal className="size-4" />
                  <span className="font-medium text-fg text-xs">Sandbox Docker Shell</span>
                </div>
                <p className="text-xs text-muted">Isolated command execution with security leases.</p>
              </div>
            </div>
          </div>
        )
      case 'llm_api_keys':
        return <ProviderView initialTab="api" />
      case 'router':
        return <ProviderView initialTab="router" />
      case 'provider':
        return <ProviderView initialTab={providerInitialTab} />
      case 'scheduled_sessions':
        return <ScheduledSessionsView />
      case 'automations':
        return <AutomationsView />
      case 'secrets':
        return <SecretsView />
      case 'browser':
        return <BrowserView />
      case 'pull_requests':
        return <PullRequestsView />
      case 'appearance':
        return <AppearanceView />
      case 'account':
        return <AccountView />
      case 'notifications':
        return <NotificationsView />
      case 'usage':
        return <UsageView />
      case 'referrals':
        return <ReferralsView />
      case 'support':
        return <SupportView />
      default:
        return (
          <div className="p-8 max-w-4xl select-text">
            <h1 className="text-lg font-semibold mb-1 text-fg capitalize">
              {settingsTab.replace(/_/g, ' ')}
            </h1>
            <p className="text-xs text-muted">
              Configure parameters and integrations for this section.
            </p>
          </div>
        )
    }
  }

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Settings" className="fixed inset-0 z-50 flex bg-black/90 backdrop-blur-xs text-fg animate-in fade-in duration-150">
      <div className="flex h-full w-full flex-col overflow-hidden bg-bg sm:flex-row">
        <SettingsSidebar />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-bg">{renderContent()}</main>
      </div>
    </div>
  )
}
