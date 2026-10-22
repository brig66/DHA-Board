"use client";

import { useEffect, useRef, useState } from "react";

/** Shows the finished email exactly as it is sent, walled off from the rest of the page. */
export default function EmailPreview({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(400);
  const fit = () => {
    const doc = ref.current?.contentDocument;
    if (doc?.body) setHeight(Math.max(200, doc.documentElement.scrollHeight));
  };
  useEffect(() => {
    const doc = ref.current?.contentDocument;
    if (!doc) return;
    // re-measure once pictures finish loading
    const imgs = Array.from(doc.images);
    imgs.forEach((i) => i.addEventListener("load", fit));
    return () => imgs.forEach((i) => i.removeEventListener("load", fit));
  });
  return (
    <iframe
      ref={ref}
      title="Email preview"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={html.replace("<head>", '<head><base target="_blank">')}
      onLoad={fit}
      className={className ?? "block w-full border-0"}
      style={{ height }}
    />
  );
}
