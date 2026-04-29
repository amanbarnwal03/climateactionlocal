import { AlertTriangle, CheckCircle2, Leaf, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ClimateAudioCard } from "@/components/ClimateAudioCard";

type AudioItem = {
  id: string;
  src: string;
  mimeType: string;
  source: "base64" | "url" | "binary";
};

type CampaignResult = {
  imageUrl?: string;
  audioItems: AudioItem[];
  rawText?: string;
};

type FormState = {
  state: string;
  language: "" | "Hindi" | "English";
  speaker: "" | "Male" | "Female";
};

const WEBHOOK_URL = import.meta.env.VITE_N8N_WEBHOOK_URL || "http://localhost:5678/webhook/climateaction-local";

const INDIA_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];

const LANGUAGES: FormState["language"][] = ["Hindi", "English"];
const SPEAKERS: FormState["speaker"][] = ["Male", "Female"];

const LOADING_MESSAGES = [
  "Reading local climate signals…",
  "Drafting a state-specific campaign…",
  "Preparing voice and visual assets…",
  "Checking returned media safely…",
];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isAudioUrl = (value: string) => /^(https?:\/\/|blob:|data:audio\/)/i.test(value) || /\.(mp3|wav|ogg|m4a|aac)(\?|#|$)/i.test(value);

const isLikelyBase64Audio = (value: string) => {
  const trimmed = value.trim();
  return /^data:audio\//i.test(trimmed) || (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.replace(/\s/g, "").length > 80);
};

const audioSrcFromBase64 = (value: string, mimeType: string) => {
  const trimmed = value.trim();
  if (/^data:audio\//i.test(trimmed)) return trimmed;
  return `data:${mimeType};base64,${trimmed.replace(/\s/g, "")}`;
};

const collectMedia = (value: unknown, result: CampaignResult, visited = new Set<unknown>()) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (isAudioUrl(trimmed) && !result.audioItems.some((audio) => audio.src === trimmed)) {
      result.audioItems.push({ id: `audio-${result.audioItems.length + 1}`, src: trimmed, mimeType: /^data:audio\/([^;,]+)/i.test(trimmed) ? trimmed.slice(5, trimmed.indexOf(";")) : "audio/mpeg", source: "url" });
    }
    return;
  }

  if (!isRecord(value) && !Array.isArray(value)) return;
  if (visited.has(value)) return;
  visited.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => collectMedia(item, result, visited));
    return;
  }

  const imageValue = value.image_url;
  if (!result.imageUrl && typeof imageValue === "string" && imageValue.trim()) {
    result.imageUrl = imageValue;
  }

  const mimeType = typeof value.audio_myme_type === "string" && value.audio_myme_type.trim() ? value.audio_myme_type.trim() : "audio/mpeg";
  const audioBase64 = value.audio_base64;

  if (typeof audioBase64 === "string" && audioBase64.trim()) {
    const src = isAudioUrl(audioBase64) && !/^data:audio\//i.test(audioBase64.trim()) ? audioBase64.trim() : audioSrcFromBase64(audioBase64, mimeType);
    if (!result.audioItems.some((audio) => audio.src === src)) {
      result.audioItems.push({ id: `audio-${result.audioItems.length + 1}`, src, mimeType, source: src === audioBase64.trim() ? "url" : "base64" });
    }
  }

  Object.values(value).forEach((nested) => collectMedia(nested, result, visited));
};

const parseTextPayload = (text: string): CampaignResult => {
  const result: CampaignResult = { audioItems: [] };
  const trimmed = text.trim();
  if (!trimmed) return result;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    collectMedia(parsed, result);
  } catch {
    if (isAudioUrl(trimmed)) {
      result.audioItems.push({ id: "audio-1", src: trimmed, mimeType: /^data:audio\/([^;,]+)/i.test(trimmed) ? trimmed.slice(5, trimmed.indexOf(";")) : "audio/mpeg", source: "url" });
    } else if (isLikelyBase64Audio(trimmed)) {
      result.audioItems.push({ id: "audio-1", src: audioSrcFromBase64(trimmed, "audio/mpeg"), mimeType: "audio/mpeg", source: "base64" });
    } else {
      result.rawText = trimmed;
    }
  }

  return result;
};

const parseResponse = async (response: Response): Promise<CampaignResult> => {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const result: CampaignResult = { audioItems: [] };
    const json = (await response.json()) as unknown;
    collectMedia(json, result);
    return result;
  }

  if (contentType.startsWith("audio/") || contentType.includes("octet-stream")) {
    const blob = await response.blob();
    return {
      audioItems: [
        {
          id: "audio-1",
          src: URL.createObjectURL(blob),
          mimeType: blob.type || (contentType.includes("octet-stream") ? "audio/mpeg" : contentType),
          source: "binary",
        },
      ],
    };
  }

  return parseTextPayload(await response.text());
};

const getErrorMessage = async (response: Response) => {
  if (response.status === 404) {
    return "n8n webhook not found. For test webhooks, make sure the workflow is listening. For live webhooks, make sure the workflow is active.";
  }

  const details = await response.text().catch(() => "");
  return `The webhook returned ${response.status}. ${details ? details.slice(0, 180) : "Please try again or check the workflow response."}`;
};

const Index = () => {
  const [form, setForm] = useState<FormState>({ state: "", language: "", speaker: "" });
  const [isLoading, setIsLoading] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CampaignResult | null>(null);
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  const canSubmit = Boolean(form.state && form.language && form.speaker && !isLoading);

  const summary = useMemo(() => [form.state, form.language, form.speaker].filter(Boolean).join(" • "), [form]);

  useEffect(() => {
    if (!isLoading) return;
    const timer = window.setInterval(() => setLoadingIndex((current) => (current + 1) % LOADING_MESSAGES.length), 1800);
    return () => window.clearInterval(timer);
  }, [isLoading]);

  useEffect(() => {
    return () => {
      result?.audioItems.forEach((audio) => {
        if (audio.source === "binary") URL.revokeObjectURL(audio.src);
      });
    };
  }, [result]);

  const clearResultMedia = () => {
    result?.audioItems.forEach((audio) => {
      if (audio.source === "binary") URL.revokeObjectURL(audio.src);
    });
  };

  const resetToForm = () => {
    clearResultMedia();
    setResult(null);
    setError(null);
    setActiveAudioId(null);
    setImageFailed(false);
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSubmit) return;

    clearResultMedia();
    setIsLoading(true);
    setLoadingIndex(0);
    setError(null);
    setResult(null);
    setImageFailed(false);
    setActiveAudioId(null);

    try {
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: form.state, language: form.language, speaker: form.speaker }),
      });

      if (!response.ok) throw new Error(await getErrorMessage(response));

      const parsed = await parseResponse(response);
      setResult(parsed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong while generating the campaign. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const hasUsableResult = Boolean(result?.imageUrl || result?.audioItems.length);

  return (
    <main className="climate-shell">
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between gap-4 py-4" aria-label="Application header">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-glow">
              <Leaf className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-extrabold uppercase tracking-[0.18em] text-primary">ClimateAction</p>
              <p className="text-sm font-semibold text-muted-foreground">Local campaign studio</p>
            </div>
          </div>
          <span className="hidden rounded-full border border-border bg-secondary px-4 py-2 text-xs font-bold text-muted-foreground sm:inline-flex">n8n powered</span>
        </header>

        <section className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-[0.95fr_1.05fr] lg:py-12" aria-labelledby="hero-title">
          <div className="space-y-8">
            <div className="space-y-6">
              <span className="hero-badge"><Sparkles className="h-4 w-4" aria-hidden="true" /> Localized climate campaigns</span>
              <div className="space-y-5">
                <h1 id="hero-title" className="max-w-3xl text-5xl font-bold leading-[0.98] text-foreground sm:text-6xl lg:text-7xl">
                  ClimateAction Local
                </h1>
                <p className="max-w-2xl text-lg font-medium leading-8 text-muted-foreground">
                  Generate state-aware campaign visuals and voice messages for Indian communities with a focused, reliable webhook workflow.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3" aria-label="Selection summary">
              <div className="step-card step-card-active">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">State</p>
                <p className="mt-2 truncate text-sm font-semibold text-foreground">{form.state || "Choose region"}</p>
              </div>
              <div className={`step-card ${form.language ? "step-card-active" : ""}`}>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Language</p>
                <p className="mt-2 text-sm font-semibold text-foreground">{form.language || "Pending"}</p>
              </div>
              <div className={`step-card ${form.speaker ? "step-card-active" : ""}`}>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Speaker</p>
                <p className="mt-2 text-sm font-semibold text-foreground">{form.speaker || "Pending"}</p>
              </div>
            </div>
          </div>

          <div className="glass-panel p-5 sm:p-7 lg:p-8">
            {!isLoading && !result && !error ? (
              <form className="space-y-6" onSubmit={submit}>
                <div>
                  <h2 className="text-3xl font-bold text-foreground">Build a campaign</h2>
                  <p className="mt-2 text-sm font-medium text-muted-foreground">Follow the sequence to prepare the exact webhook payload.</p>
                </div>

                <label className="block space-y-2">
                  <span className="text-sm font-bold text-foreground">Indian state</span>
                  <select
                    className="select-field"
                    value={form.state}
                    onChange={(event) => setForm({ state: event.target.value, language: "", speaker: "" })}
                    required
                  >
                    <option value="">Select a state</option>
                    {INDIA_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
                  </select>
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-bold text-foreground">Language</span>
                  <select
                    className="select-field"
                    value={form.language}
                    onChange={(event) => setForm((current) => ({ ...current, language: event.target.value as FormState["language"], speaker: "" }))}
                    disabled={!form.state}
                    required
                  >
                    <option value="">Select language</option>
                    {LANGUAGES.map((language) => <option key={language} value={language}>{language}</option>)}
                  </select>
                </label>

                {form.language ? (
                  <fieldset className="space-y-3">
                    <legend className="text-sm font-bold text-foreground">Speaker</legend>
                    <div className="grid grid-cols-2 gap-3">
                      {SPEAKERS.map((speaker) => (
                        <button
                          key={speaker}
                          type="button"
                          className={`step-card text-left ${form.speaker === speaker ? "step-card-active" : ""}`}
                          onClick={() => setForm((current) => ({ ...current, speaker }))}
                          aria-pressed={form.speaker === speaker}
                        >
                          <span className="text-base font-extrabold text-foreground">{speaker}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ) : null}

                {summary ? <div className="summary-pill" aria-live="polite">{summary}</div> : null}

                <button className="primary-action w-full" type="submit" disabled={!canSubmit}>
                  Generate campaign
                </button>
              </form>
            ) : null}

            {isLoading ? (
              <section className="flex min-h-[430px] flex-col items-center justify-center gap-6 text-center" aria-live="polite" aria-busy="true">
                <div className="loading-leaf" aria-hidden="true" />
                <div>
                  <h2 className="text-3xl font-bold text-foreground">Generating campaign</h2>
                  <p className="mt-3 text-base font-semibold text-muted-foreground">{LOADING_MESSAGES[loadingIndex]}</p>
                </div>
              </section>
            ) : null}

            {error ? (
              <section className="space-y-6" aria-labelledby="error-title">
                <div className="flex items-start gap-4 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
                  <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
                  <div>
                    <h2 id="error-title" className="text-2xl font-bold text-foreground">Campaign could not be generated</h2>
                    <p className="mt-2 text-sm font-semibold leading-6 text-muted-foreground">{error}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button className="primary-action" type="button" onClick={() => void submit()} disabled={!canSubmit}>Retry</button>
                  <button className="secondary-action" type="button" onClick={resetToForm}>Back to form</button>
                </div>
              </section>
            ) : null}

            {result ? (
              <section className="space-y-6" aria-labelledby="result-title">
                <div className="status-panel flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                  <div>
                    <h2 id="result-title" className="text-2xl font-bold text-foreground">Campaign Ready</h2>
                    <p className="mt-1 text-sm font-semibold text-muted-foreground">{summary || "Your localized climate campaign is ready."}</p>
                  </div>
                </div>

                {result.imageUrl && !imageFailed ? (
                  <figure className="image-frame">
                    <img
                      src={result.imageUrl}
                      alt={`Generated climate campaign visual for ${form.state || "selected state"}`}
                      className="h-auto max-h-[520px] w-full object-contain"
                      onError={() => setImageFailed(true)}
                    />
                  </figure>
                ) : result.imageUrl && imageFailed ? (
                  <div className="rounded-xl border border-border bg-muted p-4 text-sm font-semibold text-muted-foreground">The returned image could not be loaded safely.</div>
                ) : null}

                {result.audioItems.length ? (
                  <div className="space-y-3">
                    {result.audioItems.map((audio, index) => (
                      <ClimateAudioCard
                        key={`${audio.id}-${audio.src.slice(0, 24)}`}
                        id={audio.id}
                        src={audio.src}
                        mimeType={audio.mimeType}
                        label={`Campaign audio ${index + 1}`}
                        activeId={activeAudioId}
                        onActivate={setActiveAudioId}
                      />
                    ))}
                  </div>
                ) : null}

                {!hasUsableResult ? (
                  <div className="rounded-xl border border-border bg-muted p-5">
                    <p className="font-bold text-foreground">No playable media was found.</p>
                    <p className="mt-2 text-sm font-medium text-muted-foreground">
                      The webhook responded, but no audio_base64, audio URL, or image_url could be extracted. {result.rawText ? `Response: ${result.rawText.slice(0, 220)}` : "Try adjusting the workflow output."}
                    </p>
                  </div>
                ) : null}

                <button className="secondary-action" type="button" onClick={resetToForm}>
                  <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" /> Create another
                </button>
              </section>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
};

export default Index;
