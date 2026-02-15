"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";

// --- Types ---

type RsvpToken =
  | { type: "word"; text: string; sentenceIndex: number }
  | { type: "image"; url: string; sentenceIndex: number };

// --- Markdown-to-tokens parser ---

function parseMarkdownToTokens(markdown: string): RsvpToken[] {
  const images: string[] = [];
  let text = markdown.replace(/!\[[^\]]*\]\(([^)]+)\)/g, (_, url) => {
    const idx = images.length;
    images.push(url);
    return ` __IMG_${idx}__ `;
  });

  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
  text = text.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");
  text = text.replace(/~~([^~]+)~~/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/```[\s\S]*?```/g, "");
  text = text.replace(/^>\s*/gm, "");
  text = text.replace(/^[\s]*[-*+]\s+/gm, "");
  text = text.replace(/^[\s]*\d+\.\s+/gm, "");
  text = text.replace(/^[-*_]{3,}\s*$/gm, "");
  text = text.replace(/<[^>]+>/g, "");

  const words = text.split(/\s+/).filter(Boolean);
  const tokens: RsvpToken[] = [];
  let sentenceIndex = 0;

  for (const word of words) {
    const imgMatch = word.match(/^__IMG_(\d+)__$/);
    if (imgMatch) {
      tokens.push({ type: "image", url: images[parseInt(imgMatch[1])], sentenceIndex });
    } else {
      tokens.push({ type: "word", text: word, sentenceIndex });
      if (/[.!?]["'\u201D\u2019)]*$/.test(word)) {
        sentenceIndex++;
      }
    }
  }

  return tokens;
}

// --- ORP calculation ---

function getOrpIndex(length: number): number {
  if (length <= 1) return 0;
  if (length <= 5) return 1;
  if (length <= 9) return 2;
  if (length <= 13) return 3;
  return 4;
}

// --- Helpers ---

function getWordDelay(word: string, wpm: number): number {
  let delay = 60000 / wpm;
  if (/[.!?]["'\u201D\u2019)]*$/.test(word)) delay *= 2;
  else if (/[,:;]$/.test(word)) delay *= 1.5;
  if (word.length > 8) delay *= 1.2;
  return delay;
}

function formatTime(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `0:${s.toString().padStart(2, "0")}`;
}

// --- Component ---

interface RsvpReaderProps {
  content: string;
  onClose: () => void;
}

export default function RsvpReader({ content, onClose }: RsvpReaderProps) {
  const tokens = useRef(parseMarkdownToTokens(content)).current;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [wpm, setWpm] = useState(300);
  const [imageTimeRemaining, setImageTimeRemaining] = useState(10000);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [wpmFlash, setWpmFlash] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const hasStartedRef = useRef(false);
  const triggerRef = useRef<Element | null>(null);
  const imageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const imageStartRef = useRef<number>(0);
  const progressBarRef = useRef<HTMLDivElement>(null);

  const currentToken = tokens[currentIndex] as RsvpToken | undefined;
  const wordTokenCount = tokens.filter((t) => t.type === "word").length;

  // --- Estimated time remaining ---
  const timeRemaining = useMemo(() => {
    let ms = 0;
    for (let i = currentIndex; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === "word") ms += getWordDelay(t.text, wpm);
      else ms += 10000;
    }
    return ms;
  }, [currentIndex, wpm, tokens]);

  // --- Context words when paused ---
  const contextWords = useMemo(() => {
    if (isPlaying || !currentToken || currentToken.type !== "word") return null;
    const range = 4;
    const before: string[] = [];
    const after: string[] = [];
    for (let i = currentIndex - range; i < currentIndex; i++) {
      if (i >= 0 && tokens[i].type === "word") before.push((tokens[i] as { text: string }).text);
    }
    for (let i = currentIndex + 1; i <= currentIndex + range; i++) {
      if (i < tokens.length && tokens[i].type === "word") after.push((tokens[i] as { text: string }).text);
    }
    return { before, after };
  }, [isPlaying, currentIndex, currentToken, tokens]);

  // --- Focus capture & body scroll lock ---
  useEffect(() => {
    triggerRef.current = document.activeElement;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    };
  }, []);

  // --- Countdown before first play ---
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      setIsPlaying(true);
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => (c !== null ? c - 1 : null)), 600);
    return () => clearTimeout(timer);
  }, [countdown]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      setCountdown(null);
    } else if (countdown !== null) {
      // Cancel countdown
      setCountdown(null);
    } else if (!hasStartedRef.current) {
      hasStartedRef.current = true;
      setCountdown(3);
    } else {
      setIsPlaying(true);
    }
  }, [isPlaying, countdown]);

  // --- Word timing ---
  useEffect(() => {
    if (!isPlaying || !currentToken || currentToken.type === "image") return;

    const delay = getWordDelay(currentToken.text, wpm);
    const timer = setTimeout(() => {
      if (currentIndex < tokens.length - 1) {
        setCurrentIndex((i) => i + 1);
      } else {
        setIsPlaying(false);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [isPlaying, currentIndex, wpm, currentToken, tokens.length]);

  // --- Image timing ---
  const clearImageTimer = useCallback(() => {
    if (imageTimerRef.current) {
      clearInterval(imageTimerRef.current);
      imageTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!currentToken || currentToken.type !== "image") {
      setImageLoaded(false);
      setImageTimeRemaining(10000);
      clearImageTimer();
      return;
    }
    if (!isPlaying || !imageLoaded) {
      clearImageTimer();
      return;
    }

    imageStartRef.current = Date.now();
    const startRemaining = imageTimeRemaining;

    imageTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - imageStartRef.current;
      const remaining = startRemaining - elapsed;
      if (remaining <= 0) {
        clearImageTimer();
        setImageTimeRemaining(10000);
        setImageLoaded(false);
        if (currentIndex < tokens.length - 1) {
          setCurrentIndex((i) => i + 1);
        } else {
          setIsPlaying(false);
        }
      } else {
        setImageTimeRemaining(remaining);
      }
    }, 50);

    return clearImageTimer;
  }, [isPlaying, currentToken, imageLoaded, currentIndex, tokens.length, clearImageTimer, imageTimeRemaining]);

  // --- Sentence navigation ---
  const skipToPrevSentence = useCallback(() => {
    const currentSentence = tokens[currentIndex]?.sentenceIndex ?? 0;
    let i = currentIndex;
    while (i > 0 && tokens[i - 1].sentenceIndex === currentSentence) i--;
    if (i === currentIndex && currentSentence > 0) {
      const prevSentence = currentSentence - 1;
      while (i > 0 && tokens[i - 1].sentenceIndex === prevSentence) i--;
    }
    setCurrentIndex(i);
    setImageTimeRemaining(10000);
    setImageLoaded(false);
  }, [currentIndex, tokens]);

  const skipToNextSentence = useCallback(() => {
    const currentSentence = tokens[currentIndex]?.sentenceIndex ?? 0;
    let i = currentIndex;
    while (i < tokens.length - 1 && tokens[i].sentenceIndex === currentSentence) i++;
    if (i < tokens.length) {
      setCurrentIndex(i);
      setImageTimeRemaining(10000);
      setImageLoaded(false);
    }
  }, [currentIndex, tokens]);

  // --- Progress bar scrubbing ---
  const scrubToPosition = useCallback(
    (clientX: number) => {
      const bar = progressBarRef.current;
      if (!bar || tokens.length === 0) return;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const newIndex = Math.round(ratio * (tokens.length - 1));
      setCurrentIndex(newIndex);
      setImageTimeRemaining(10000);
      setImageLoaded(false);
    },
    [tokens.length]
  );

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => scrubToPosition(e.clientX);
    const handleUp = () => setIsDragging(false);
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
  }, [isDragging, scrubToPosition]);

  // --- WPM flash feedback ---
  const changeWpm = useCallback((delta: number) => {
    setWpm((w) => Math.max(100, Math.min(800, w + delta)));
    setWpmFlash(true);
  }, []);

  useEffect(() => {
    if (!wpmFlash) return;
    const t = setTimeout(() => setWpmFlash(false), 600);
    return () => clearTimeout(t);
  }, [wpmFlash]);

  // --- Keyboard shortcuts ---
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          skipToPrevSentence();
          break;
        case "ArrowRight":
          e.preventDefault();
          skipToNextSentence();
          break;
        case "ArrowUp":
          e.preventDefault();
          changeWpm(25);
          break;
        case "ArrowDown":
          e.preventDefault();
          changeWpm(-25);
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, skipToPrevSentence, skipToNextSentence, togglePlay, changeWpm]);

  // --- Progress ---
  const progress = tokens.length > 0 ? ((currentIndex + 1) / tokens.length) * 100 : 0;

  // --- Render ---
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-white flex flex-col select-none" role="dialog" aria-modal="true" aria-label="Speed Reader">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 shrink-0 border-b border-gray-100">
        <div className="flex items-center gap-4">
          <span className={`text-sm font-semibold tabular-nums transition-colors duration-300 ${wpmFlash ? "text-brand-600" : "text-gray-900"}`}>
            {wpm} <span className="text-gray-400 font-normal">WPM</span>
          </span>
          <span className="text-xs text-gray-400 tabular-nums">
            {formatTime(timeRemaining)} left
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 tabular-nums">
            {currentIndex + 1} / {tokens.length}
          </span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
            aria-label="Close speed reader"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Center: word or image display */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 min-h-0">
        {/* Countdown overlay */}
        {countdown !== null ? (
          <span className="text-8xl sm:text-9xl font-bold text-brand-600 animate-pulse">{countdown}</span>
        ) : currentToken?.type === "image" ? (
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              {!imageLoaded && (
                <div className="w-64 h-48 bg-gray-100 rounded-lg animate-pulse" />
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={currentToken.url}
                alt="Content image"
                className={`max-h-[70vh] object-contain rounded-lg ${imageLoaded ? "" : "absolute opacity-0"}`}
                onLoad={() => setImageLoaded(true)}
              />
            </div>
            {imageLoaded && (
              <div className="w-64 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-600 transition-all duration-75"
                  style={{ width: `${((10000 - imageTimeRemaining) / 10000) * 100}%` }}
                />
              </div>
            )}
          </div>
        ) : currentToken?.type === "word" ? (
          <div className="flex flex-col items-center gap-6 w-full">
            <WordDisplay word={currentToken.text} />
            {/* Context words when paused */}
            {contextWords && (
              <p className="text-sm text-gray-300 max-w-lg text-center leading-relaxed">
                {contextWords.before.length > 0 && (
                  <span>{contextWords.before.join(" ")} </span>
                )}
                <span className="text-gray-900 font-medium">{currentToken.text}</span>
                {contextWords.after.length > 0 && (
                  <span> {contextWords.after.join(" ")}</span>
                )}
              </p>
            )}
          </div>
        ) : null}
      </div>

      {/* Bottom: controls */}
      <div className="shrink-0 px-6 pb-5 pt-3 border-t border-gray-100">
        {/* Scrubbable progress bar */}
        <div
          ref={progressBarRef}
          className="w-full h-5 flex items-center cursor-pointer group mb-3"
          onMouseDown={(e) => {
            setIsDragging(true);
            scrubToPosition(e.clientX);
          }}
          role="slider"
          aria-label="Reading progress"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={-1}
        >
          <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden group-hover:h-2 transition-all relative">
            <div
              className="h-full bg-brand-600 transition-[width] duration-100 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Playback controls */}
        <div className="flex items-center justify-center gap-5 mb-3">
          <button
            onClick={() => {
              setCurrentIndex(0);
              setImageTimeRemaining(10000);
              setImageLoaded(false);
              setIsPlaying(false);
              hasStartedRef.current = false;
            }}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
            aria-label="Restart"
            title="Restart"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M20.015 4.356v4.992m0 0h-4.992m4.993 0l-3.181-3.183a8.25 8.25 0 00-13.803 3.7" />
            </svg>
          </button>
          <button
            onClick={skipToPrevSentence}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
            aria-label="Previous sentence"
            title="Previous sentence"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.5 20V4M4 12l9-8v16l-9-8z" />
            </svg>
          </button>
          <button
            onClick={togglePlay}
            className="p-3.5 bg-brand-600 text-white rounded-full hover:bg-brand-700 transition-colors cursor-pointer shadow-md active:scale-95"
            aria-label={isPlaying || countdown !== null ? "Pause" : "Play"}
          >
            {isPlaying || countdown !== null ? (
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          <button
            onClick={skipToNextSentence}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
            aria-label="Next sentence"
            title="Next sentence"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.5 4v16M20 12l-9-8v16l9-8z" />
            </svg>
          </button>
          {/* WPM control inline */}
          <div className="flex items-center gap-1.5 ml-2">
            <button
              onClick={() => changeWpm(-25)}
              className="p-1.5 rounded hover:bg-gray-100 transition-colors cursor-pointer"
              aria-label="Decrease speed"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
              </svg>
            </button>
            <span className="text-xs font-medium text-gray-500 tabular-nums w-7 text-center">{wpm}</span>
            <button
              onClick={() => changeWpm(25)}
              className="p-1.5 rounded hover:bg-gray-100 transition-colors cursor-pointer"
              aria-label="Increase speed"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Keyboard hints */}
        <p className="text-center text-[11px] text-gray-300">
          space play/pause &middot; &larr;&rarr; skip sentence &middot; &uarr;&darr; speed &middot; esc close
        </p>
      </div>
    </div>,
    document.body
  );
}

// --- Word display with ORP ---

function WordDisplay({ word }: { word: string }) {
  const orpIndex = getOrpIndex(word.length);
  const before = word.slice(0, orpIndex);
  const orp = word[orpIndex] || "";
  const after = word.slice(orpIndex + 1);

  return (
    <div className="relative flex items-center justify-center w-full">
      {/* Fixation guide — thin hairlines above and below */}
      <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none flex flex-col items-center" style={{ height: "calc(100% + 3rem)", top: "-1.5rem" }}>
        <div className="w-px flex-1 bg-gray-200" />
        <div className="h-[1em] shrink-0" style={{ fontSize: "clamp(3.75rem, 8vw, 6rem)" }} />
        <div className="w-px flex-1 bg-gray-200" />
      </div>
      <div className="font-mono font-bold select-none relative flex" style={{ fontSize: "clamp(3.75rem, 8vw, 6rem)", lineHeight: 1 }}>
        <span className="text-right text-gray-900" style={{ width: `${orpIndex}ch` }}>
          {before}
        </span>
        <span className="text-red-500">{orp}</span>
        <span className="text-left text-gray-900">{after}</span>
      </div>
    </div>
  );
}
