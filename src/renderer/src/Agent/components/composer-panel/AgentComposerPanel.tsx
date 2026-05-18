import ChatComposer from './ChatComposer'

export interface AgentComposerPanelProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void | Promise<void>
  onAbort: () => void | Promise<void>
  sending: boolean
}

/** 右侧下半区：输入与发送 */
export default function AgentComposerPanel({
  value,
  onChange,
  onSend,
  onAbort,
  sending
}: AgentComposerPanelProps) {
  return (
    <div className="shrink-0 pb-6 pt-4 pr-2 md:pr-4">
      <div className="mx-auto max-w-3xl px-2 md:px-4">
        <ChatComposer
          value={value}
          onChange={onChange}
          onSend={() => void onSend()}
          onAbort={() => void onAbort()}
          sending={sending}
        />
      </div>
    </div>
  )
}
