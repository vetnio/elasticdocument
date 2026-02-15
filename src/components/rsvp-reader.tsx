"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// --- Types ---

type RsvpToken =
  | { type: "word"; text: string; sentenceIndex: number }
  | { type: "image"; url: string; sentenceIndex: number };

// --- Markdown-to-tokens parser ---

function parseMarkdownToTokens(markdown: string): RsvpToken[] {
  // 1. Extract images, replace with placeholders
  const images: string[] = [];
  let text = markdown.replace(/!\[[^\]]*\]\(([^)]+)\)/g, (_, url) => {
    const idx = images.length;
    images.push(url);
    return ` __IMG_${idx}__ `;
  });

  // 2. Strip markdown syntax
  // Links: [text](url) → text
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Headings
  text = text.replace(/^#{1,6}\s+/gm, "");
  // Bold/italic
  text = text.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
  text = text.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");
  // Strikethrough
  text = text.replace(/~~([^~]+)~~/g, "$1");
  // Inline code
  text = text.replace(/`([^`]+)`/g, "$1");
  // Code blocks
  text = text.replace(/```[\s\S]*?```/g, "");
  // Blockquotes
  text = text.replace(/^>\s*/gm, "");
  // List markers
  text = text.replace(/^[\s]*[-*+]\s+/gm, "");
  text = text.replace(/^[\s]*\d+\.\s+/gm, "");
  // Horizontal rules
  text = text.replace(/^[-*_]{3,}\s*$/gm, "");
  // HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // 3. Split into words
  const words = text.split(/\s+/).filter(Boolean);

  // 4. Build tokens with sentence tracking
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
  const triggerRef = useRef<Element | null>(null);
  const imageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const imageStartRef = useRef<number>(0);

  const currentToken = tokens[currentIndex] as RsvpToken | undefined;

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

  // --- Word timing ---
  useEffect(() => {
    if (!isPlaying || !currentToken || currentToken.type === "image") return;

    let delay = 60000 / wpm;
    const word = currentToken.text;

    if (/[.!?]["'\u201D\u2019)]*$/.test(word)) {
      delay *= 2;
    } else if (/[,:;]$/.test(word)) {
      delay *= 1.5;
    }
    if (word.length > 8) {
      delay *= 1.2;
    }

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

    // Start or resume the image timer
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

  // Save remaining time when pausing on image
  useEffect(() => {
    if (!isPlaying && currentToken?.type === "image" && imageLoaded) {
      // imageTimeRemaining is already updated by the interval
    }
  }, [isPlaying, currentToken, imageLoaded]);

  // --- Sentence navigation ---
  const skipToPrevSentence = useCallback(() => {
    const currentSentence = tokens[currentIndex]?.sentenceIndex ?? 0;
    // Find start of current sentence
    let i = currentIndex;
    while (i > 0 && tokens[i - 1].sentenceIndex === currentSentence) i--;
    // If we're already at the start, go to previous sentence
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

  // --- Keyboard shortcuts ---
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case " ":
          e.preventDefault();
          setIsPlaying((p) => !p);
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
          setWpm((w) => Math.min(800, w + 25));
          break;
        case "ArrowDown":
          e.preventDefault();
          setWpm((w) => Math.max(100, w - 25));
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, skipToPrevSentence, skipToNextSentence]);

  // --- Progress ---
  const progress = tokens.length > 0 ? ((currentIndex + 1) / tokens.length) * 100 : 0;

  // --- Render ---
  return (
    <div className="fixed inset-0 z-[60] bg-white flex flex-col" role="dialog" aria-modal="true" aria-label="Speed Reader">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 shrink-0">
        <span className="text-sm font-medium text-gray-500">{wpm} WPM</span>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
          aria-label="Close speed reader"
        >
          <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Center: word or image display */}
      <div className="flex-1 flex items-center justify-center px-6">
        {currentToken?.type === "image" ? (
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
          <WordDisplay word={currentToken.text} />
        ) : null}
      </div>

      {/* Bottom: controls */}
      <div className="shrink-0 px-6 pb-6 pt-2">
        {/* Overall progress bar */}
        <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden mb-4">
          <div
            className="h-full bg-brand-600 transition-all duration-150"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Playback controls */}
        <div className="flex items-center justify-center gap-6 mb-4">
          <button
            onClick={skipToPrevSentence}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
            aria-label="Previous sentence"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.5 20V4M4 12l9-8v16l-9-8z" />
            </svg>
          </button>
          <button
            onClick={() => setIsPlaying((p) => !p)}
            className="p-3 bg-brand-600 text-white rounded-full hover:bg-brand-700 transition-colors cursor-pointer shadow-sm"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
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
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.5 4v16M20 12l-9-8v16l9-8z" />
            </svg>
          </button>
        </div>

        {/* WPM slider */}
        <div className="flex items-center justify-center gap-3 mb-3">
          <span className="text-xs text-gray-400 w-8 text-right">100</span>
          <input
            type="range"
            min={100}
            max={800}
            step={25}
            value={wpm}
            onChange={(e) => setWpm(Number(e.target.value))}
            className="w-48 accent-brand-600 cursor-pointer"
            aria-label="Words per minute"
          />
          <span className="text-xs text-gray-400 w-8">800</span>
        </div>

        {/* Keyboard hints */}
        <p className="text-center text-xs text-gray-400">
          Space: play/pause &nbsp;|&nbsp; &larr;&rarr;: skip &nbsp;|&nbsp; &uarr;&darr;: speed &nbsp;|&nbsp; Esc: close
        </p>
      </div>
    </div>
  );
}

// --- Word display with ORP ---

function WordDisplay({ word }: { word: string }) {
  const orpIndex = getOrpIndex(word.length);
  const before = word.slice(0, orpIndex);
  const orp = word[orpIndex] || "";
  const after = word.slice(orpIndex + 1);

  return (
    <div className="flex flex-col items-center">
      {/* Fixation guide line */}
      <div className="relative w-full flex items-center justify-center">
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-gray-200 -translate-x-1/2 pointer-events-none" style={{ height: "calc(100% + 2rem)", top: "-1rem" }} />
        <div className="font-mono text-6xl sm:text-7xl md:text-8xl font-bold select-none relative flex">
          <span className="text-right text-gray-900" style={{ width: `${orpIndex}ch` }}>
            {before}
          </span>
          <span className="text-red-500">{orp}</span>
          <span className="text-left text-gray-900">{after}</span>
        </div>
      </div>
    </div>
  );
}
