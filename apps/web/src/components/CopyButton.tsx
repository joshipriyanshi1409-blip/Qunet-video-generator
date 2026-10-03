import { useCallback, useState } from 'react';
import { Button, type ButtonProps } from './Button';

export interface CopyButtonProps extends Omit<ButtonProps, 'onClick' | 'children'> {
  /** Text to place on the clipboard. */
  value: string;
  /** Accessible name, e.g. "Copy hook". */
  label: string;
  /** Optional joiner when `value` is a list. */
  joinWith?: string;
}

/**
 * Copies a string and confirms it in place, so the creator never has to look
 * away from the script they are about to record.
 */
export function CopyButton({ value, label, joinWith = '\n', variant = 'secondary', size = 'sm', ...rest }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const onClick = useCallback(() => {
    const text = Array.isArray(value) ? value.join(joinWith) : value;
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) {
      // Older browsers and insecure origins: fall back to a hidden textarea so
      // the button still does something useful rather than silently failing.
      fallbackCopy(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      return;
    }
    void clipboard.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false),
    );
  }, [value, joinWith]);

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={onClick}
      aria-label={label}
      {...rest}
    >
      {copied === true ? (
        <>
          <CheckIcon />
          Copied
        </>
      ) : (
        <>
          <CopyIcon />
          Copy
        </>
      )}
    </Button>
  );
}

function fallbackCopy(text: string): void {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand('copy');
  } catch {
    // Nothing else to try; the button already reports success optimistically.
  }
  document.body.removeChild(area);
}

function CopyIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15 5H6a2 2 0 0 0-2 2v9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12.5 9 17.5 20 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
