import { useEffect, useRef, useState } from "react";

/** Copy button state. `copied` holds the text last copied successfully, so the
 *  "Copied" label is true only for the link on screen and resets after 2s. A
 *  failed write (no clipboard permission, insecure context) shows nothing. */
export function useCopied() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2000);
  };

  return { copied, copy };
}
