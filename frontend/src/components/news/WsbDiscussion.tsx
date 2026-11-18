import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { formatDateTimeWithWeekday } from "../../utils/styleUtils";
import { clearWsbKey, readWsbKey, WSB_UNLOCK_EVENT } from "../../utils/wsbAccess";

type Discussion = {
  title: string;
  url: string;
  published_at: string;
  checked_at: string;
  replies: { id: string; author: string; body: string; published_at: string; url: string }[];
};

type Result = {
  discussion: Discussion | null;
  retry_seconds: number;
};

const REFRESH_MS = 60_000;
const REDDIT_DISCUSSION = "https://www.reddit.com/r/wallstreetbets/about/sticky/?num=1";

export default function WsbDiscussion() {
  const { hash } = useLocation();
  const [key, setKey] = useState(readWsbKey);
  const [open, setOpen] = useState(hash === "#wsb-discussion");
  const [discussion, setDiscussion] = useState<Discussion>();
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "locked">("loading");
  const panel = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const unlock = () => {
      const unlockedKey = readWsbKey();
      if (!unlockedKey) return;
      setKey(unlockedKey);
      setOpen(true);
    };
    window.addEventListener(WSB_UNLOCK_EVENT, unlock);
    if (window.location.hash === "#wsb-discussion") unlock();
    return () => window.removeEventListener(WSB_UNLOCK_EVENT, unlock);
  }, []);

  useEffect(() => {
    if (window.location.hash !== "#wsb-discussion" || !key) return;
    setOpen(true);
    const frame = window.requestAnimationFrame(() => panel.current?.scrollIntoView({ block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [hash, key]);

  useEffect(() => {
    if (!open || !key) return;
    const controller = new AbortController();
    let timer: number | undefined;
    const refresh = async () => {
      let delay = REFRESH_MS;
      try {
        const response = await fetch("/live-news/wsb/discussion", {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 404) {
          setDiscussion(undefined);
          setStatus("locked");
          return;
        }
        if (!response.ok) throw new Error("Discussion request failed");
        const result = await response.json() as Result;
        if (controller.signal.aborted) return;
        delay = Math.max(delay, result.retry_seconds * 1000);
        setDiscussion(result.discussion ?? undefined);
        setStatus(result.discussion ? "ready" : "unavailable");
      } catch {
        if (controller.signal.aborted) return;
        setDiscussion(undefined);
        setStatus("unavailable");
      }
      if (!controller.signal.aborted) timer = window.setTimeout(refresh, delay);
    };
    void refresh();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [key, open]);

  if (!key) return null;

  const liveUrl = discussion ? new URL(discussion.url) : null;
  liveUrl?.searchParams.set("sort", "live");

  return (
    <details
      id="wsb-discussion"
      ref={panel}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="surface-card-strong scroll-mt-24 p-4"
    >
      <summary className="cursor-pointer py-2 font-semibold text-stealth-100 [&::marker]:text-sky-300">
        WSB daily discussion
      </summary>
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <a
            className="text-sm font-semibold text-sky-200 underline underline-offset-4"
            href={liveUrl?.href ?? REDDIT_DISCUSSION}
            target="_blank"
            rel="noopener noreferrer"
          >
            {liveUrl ? "Open Live view on Reddit" : "Open the pinned discussion on Reddit"}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <button
            type="button"
            className="field-button field-button-secondary"
            onClick={() => { clearWsbKey(); setKey(""); setDiscussion(undefined); }}
          >
            Lock this browser
          </button>
        </div>
        {discussion ? (
          <>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-stealth-100">{discussion.title}</p>
              <p className="text-xs text-stealth-300">
                r/wallstreetbets on Reddit · {discussion.replies.length} newest top-level replies · Checked{" "}
                <time dateTime={discussion.checked_at}>{formatDateTimeWithWeekday(discussion.checked_at)} ET</time>
              </p>
            </div>
            {discussion.replies.length > 0 && (
              <div className="data-scroller max-h-[28rem] overflow-y-auto rounded-lg border border-stealth-700" role="region" aria-label="Newest WSB replies" tabIndex={0}>
                <ol className="divide-y divide-stealth-800">
                  {discussion.replies.map((reply) => (
                    <li key={reply.id} className="space-y-1 p-3">
                      <div className="flex flex-wrap items-baseline gap-x-3 text-xs">
                        <a className="font-semibold text-sky-200 hover:underline" href={reply.url} target="_blank" rel="noopener noreferrer">u/{reply.author}</a>
                        <time className="text-stealth-400" dateTime={reply.published_at}>{formatDateTimeWithWeekday(reply.published_at)} ET</time>
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-stealth-100">{reply.body}</p>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-stealth-300" role="status">
            {status === "loading" ? "Loading Reddit replies…"
              : status === "locked" ? "This browser’s key was rejected. Use your current WSB shortcut to unlock it."
                : "Reddit replies are temporarily unavailable."}
          </p>
        )}
      </div>
    </details>
  );
}
