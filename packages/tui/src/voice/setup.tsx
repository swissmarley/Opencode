import type { ExperimentalVoiceSetupInput, VoiceTranscriptionStatus } from "@opencode/client/promise"
import { createSignal, onCleanup, Show } from "solid-js"
import { Spinner } from "../component/spinner"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout, useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"

const MODEL_MB = 142
const READY = "Voice input is ready. Hold mic to talk, or click it to start and stop."

/**
 * Picks how speech becomes text when voice input isn't set up, or to change it: whisper.cpp on the server's machine,
 * installed and downloaded here, or an OpenAI API key typed into a form and stored like `/connect` stores it.
 */
export function DialogVoiceSetup(props: { status: VoiceTranscriptionStatus }) {
  const dialog = useDialog()
  const local = localPlan(props.status)
  return (
    <DialogSelect
      title="Set up voice input"
      description={
        props.status.ready
          ? `Voice input uses ${engineName(props.status.engine)} now.`
          : "Choose how your speech is turned into text."
      }
      options={[
        {
          title: "On this computer, English",
          value: "base.en",
          description: local,
          onSelect: () => setupLocal(dialog, props.status, "base.en"),
        },
        {
          title: "On this computer, any language",
          value: "base",
          description: local,
          onSelect: () => setupLocal(dialog, props.status, "base"),
        },
        {
          title: "With an OpenAI API key",
          value: "openai",
          description: props.status.openai ? "connected" : "also connects OpenAI models",
          onSelect: () => dialog.replace(() => <DialogVoiceKey />),
        },
      ]}
    />
  )
}

function setupLocal(
  dialog: ReturnType<typeof useDialog>,
  status: VoiceTranscriptionStatus,
  model: ExperimentalVoiceSetupInput["model"],
) {
  if (!status.whisper && !status.homebrew) {
    dialog.replace(() => <DialogVoiceInstall status={status} />)
    return
  }
  dialog.replace(() => <DialogVoiceProgress model={model} />)
}

/** Installs whisper.cpp when needed and downloads the model on the server, showing its progress. */
function DialogVoiceProgress(props: { model: ExperimentalVoiceSetupInput["model"] }) {
  const client = useClient()
  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme().surface("dialog")
  const [status, setStatus] = createSignal<VoiceTranscriptionStatus>()
  const [error, setError] = createSignal<string>()
  let timer: ReturnType<typeof setInterval> | undefined

  const poll = async () => {
    const next = await client.api.experimental.voice.transcription().catch((cause: unknown) => {
      setError(errorMessage(cause))
      return undefined
    })
    if (!next) return stopPolling()
    setStatus(next)
    if (next.setup) return
    stopPolling()
    if (next.error) return setError(next.error)
    if (!next.ready) return setError("Setup finished, but whisper.cpp or its model still wasn't found.")
    toast.show({ variant: "success", message: READY, duration: 5000 })
    dialog.clear()
  }

  const stopPolling = () => {
    if (timer) clearInterval(timer)
    timer = undefined
  }

  void client.api.experimental.voice
    .setup({ model: props.model })
    .then(() => {
      timer = setInterval(() => void poll(), 500)
      return poll()
    })
    .catch((cause: unknown) => setError(errorMessage(cause)))
  onCleanup(stopPolling)

  return (
    <DialogLayout header={<DialogHeader title="Set up voice input" />}>
      <Show when={error()} fallback={<Spinner>{progressText(status())}</Spinner>}>
        {(message) => <text fg={theme.text.feedback.error.base}>{message()}</text>}
      </Show>
    </DialogLayout>
  )
}

/** Without Homebrew, the server can't install whisper.cpp itself, so this shows how to. */
function DialogVoiceInstall(props: { status: VoiceTranscriptionStatus }) {
  const theme = useTheme().surface("dialog")
  return (
    <DialogLayout header={<DialogHeader title="Install whisper.cpp" />}>
      <box flexDirection="column" gap={1}>
        <text fg={theme.text.base}>
          Voice input runs whisper.cpp's whisper-cli on the machine OpenCode's server runs on. Build or install it from
          github.com/ggml-org/whisper.cpp so whisper-cli is on the PATH, then run /voice-setup again to download a model
          into {props.status.models}.
        </text>
        <text fg={theme.text.muted}>Or choose an OpenAI API key instead.</text>
      </box>
    </DialogLayout>
  )
}

/** A form for an OpenAI API key, stored on the server the same way `/connect` stores one. */
function DialogVoiceKey() {
  const client = useClient()
  const data = useData()
  const dialog = useDialog()
  const toast = useToast()
  const currentLocation = useLocation()
  const theme = useTheme().surface("dialog")
  const [error, setError] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const location = currentLocation.ref ?? data.location.default()

  const save = async (key: string) => {
    setBusy(true)
    setError(undefined)
    const failure = await client.api.integration.connect
      .key({ integrationID: "openai", location: { directory: location.directory }, key })
      .then(
        () => undefined,
        (cause: unknown) => errorMessage(cause),
      )
    const status = failure ? undefined : await client.api.experimental.voice.transcription().catch(() => undefined)
    setBusy(false)
    if (failure) return setError(failure)
    // OpenAI is now connected for models too, so the model picker shows its models.
    data.location.integration.invalidate(location)
    data.location.model.invalidate(location)
    data.location.provider.invalidate(location)
    if (status && !status.ready)
      return setError(`The key was saved, but voice input still uses ${engineName(status.engine)}.`)
    toast.show({ variant: "success", message: READY, duration: 5000 })
    dialog.clear()
  }

  return (
    <DialogPrompt
      title="OpenAI API key"
      placeholder="sk-…"
      busy={busy()}
      busyText="Saving…"
      onConfirm={(value) => {
        const key = value.trim()
        if (key) void save(key)
      }}
      description={() => (
        <box flexDirection="column">
          <text fg={theme.text.muted}>Create one at platform.openai.com/api-keys. It is stored on the server.</text>
          <Show when={error()}>{(message) => <text fg={theme.text.feedback.error.base}>{message()}</text>}</Show>
        </box>
      )}
    />
  )
}

// Short enough to fit beside the option's title.
function localPlan(status: VoiceTranscriptionStatus) {
  const download = status.model ? undefined : `${MODEL_MB} MB download`
  if (status.whisper) return download ?? "ready"
  if (status.homebrew) return ["Homebrew install", download].filter(Boolean).join(" + ")
  return "install whisper.cpp first"
}

function progressText(status: VoiceTranscriptionStatus | undefined) {
  const setup = status?.setup
  if (!setup) return "Starting…"
  if (setup.step === "install") return "Installing whisper.cpp with Homebrew, which can take a few minutes…"
  const received = Math.round((setup.received ?? 0) / 1_000_000)
  if (!setup.total) return `Downloading the model… ${received} MB`
  const total = Math.round(setup.total / 1_000_000)
  return `Downloading the model… ${Math.floor(((setup.received ?? 0) / setup.total) * 100)}% (${received} of ${total} MB)`
}

function engineName(engine: VoiceTranscriptionStatus["engine"]) {
  if (engine === "openai") return "OpenAI"
  if (engine === "endpoint") return "the configured transcription endpoint"
  return "whisper.cpp on this computer"
}
