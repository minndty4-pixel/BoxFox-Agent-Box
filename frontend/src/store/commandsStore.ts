import { create } from 'zustand'
import { agentApi } from '../lib/agentApi'
export interface CommandItem { slug: string; description: string; kind: string; enabled: boolean; reason?: string }
export interface CustomCommand extends CommandItem {
  template: string; skills: string[]; role: string; executor: 'native' | 'claude-code'; revision: number
}
interface State { commands: CommandItem[]; custom: CustomCommand[]; error: string | null; load: () => Promise<void> }
export const useCommandsStore = create<State>(set => ({
  commands: [], custom: [], error: null,
  load: async () => {
    try { set({ ...await agentApi<{ commands: CommandItem[]; custom: CustomCommand[] }>('/commands'), error: null }) }
    catch (error) { set({ commands: [], error: String(error) }) }
  },
}))
