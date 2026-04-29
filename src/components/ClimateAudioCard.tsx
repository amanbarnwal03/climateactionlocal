import { Download, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type ClimateAudioCardProps = {
  id: string;
  src: string;
  mimeType: string;
  label: string;
  activeId: string | null;
  onActivate: (id: string | null) => void;
};

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remaining}`;
};

export const ClimateAudioCard = ({ id, src, mimeType, label, activeId, onActivate }: ClimateAudioCardProps) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (activeId !== id && !audio.paused) {
      audio.pause();
      setIsPlaying(false);
    }
  }, [activeId, id]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setHasError(false);
  }, [src]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || hasError) return;

    if (audio.paused) {
      try {
        onActivate(id);
        await audio.play();
        setIsPlaying(true);
      } catch {
        setHasError(true);
        onActivate(null);
      }
    } else {
      audio.pause();
      setIsPlaying(false);
      onActivate(null);
    }
  };

  const seek = (value: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(duration)) return;
    audio.currentTime = value;
    setCurrentTime(value);
  };

  return (
    <article className="audio-card">
      <audio
        ref={audioRef}
        preload="metadata"
        src={src}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onEnded={() => {
          setIsPlaying(false);
          onActivate(null);
        }}
        onError={() => setHasError(true)}
      >
        <source src={src} type={mimeType} />
      </audio>

      <div className="flex items-center gap-4">
        <button
          type="button"
          className="audio-button"
          onClick={togglePlayback}
          aria-label={isPlaying ? `Pause ${label}` : `Play ${label}`}
          disabled={hasError}
        >
          {isPlaying ? <Pause className="h-5 w-5" aria-hidden="true" /> : <Play className="h-5 w-5" aria-hidden="true" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-semibold text-foreground">{label}</p>
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
          <input
            className="audio-range mt-3"
            type="range"
            min="0"
            max={Number.isFinite(duration) && duration > 0 ? duration : 0}
            value={Math.min(currentTime, Number.isFinite(duration) ? duration : 0)}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label={`Seek ${label}`}
            disabled={hasError || duration <= 0}
          />
        </div>

        <a className="audio-download" href={src} download={`climate-campaign-${id}.mp3`} aria-label={`Download ${label}`}>
          <Download className="h-5 w-5" aria-hidden="true" />
        </a>
      </div>

      {hasError ? <p className="mt-4 text-sm text-destructive">This audio could not be played. Try downloading it instead.</p> : null}
    </article>
  );
};
