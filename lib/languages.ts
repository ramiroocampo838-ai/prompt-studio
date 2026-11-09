export interface Language {
  name: string
  voice: string
}

// Default edge-tts voice per language code.
export const LANGUAGES: Record<string, Language> = {
  en: { name: "English", voice: "en-US-GuyNeural" },
  es: { name: "Spanish", voice: "es-MX-JorgeNeural" },
  pt: { name: "Portuguese", voice: "pt-BR-AntonioNeural" },
  fr: { name: "French", voice: "fr-FR-HenriNeural" },
  de: { name: "German", voice: "de-DE-ConradNeural" },
  it: { name: "Italian", voice: "it-IT-DiegoNeural" },
}

export function languageOf(code: string): Language {
  const lang = LANGUAGES[code]
  if (!lang) throw new Error(`Unsupported language '${code}'. Available: ${Object.keys(LANGUAGES).join(", ")}`)
  return lang
}
