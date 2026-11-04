export * as ConfigTranscription from "./transcription.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export class Info extends Schema.Class<Info>("ConfigTranscription.Info")({
  provider: Schema.Literals(["openai", "local"]).pipe(optional).annotate({
    description:
      "Where speech is transcribed: 'openai' (default) uses OpenAI's transcription API, or any OpenAI-compatible endpoint set with base_url; 'local' runs a Whisper command on the server",
  }),
  model: Schema.String.pipe(optional).annotate({
    description:
      "For 'openai', the transcription model (default: whisper-1). For 'local', the Whisper model file passed to the command as {model}, such as ~/models/ggml-base.en.bin",
  }),
  language: Schema.String.pipe(optional).annotate({
    description: "Spoken language as an ISO-639-1 code such as 'en'. Detected automatically when omitted",
  }),
  prompt: Schema.String.pipe(optional).annotate({
    description: "Text that guides spelling and style, such as project names and technical terms",
  }),
  base_url: Schema.String.pipe(optional).annotate({
    description:
      "An OpenAI-compatible transcription endpoint for 'openai', such as a local whisper.cpp or faster-whisper server. The OpenAI key is only ever sent to OpenAI's own API",
  }),
  api_key: Schema.String.pipe(optional).annotate({
    description:
      "API key for base_url; use {env:NAME} to read it from the environment. Omit for endpoints without auth",
  }),
  command: Schema.String.pipe(Schema.Array, optional).annotate({
    description:
      "Command for 'local' that prints the transcript on stdout, with {file}, {model}, {language} and {prompt} placeholders. Defaults to whisper.cpp's whisper-cli",
  }),
}) {}
