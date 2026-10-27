import { Fragment } from "react";

/** Divide un texto en letras para animarlas una a una (aparición de textos). */
export function SplitText({ text, className }: { text: string; className?: string }) {
  const words = text.split(" ");
  return (
    <span className={className} aria-label={text}>
      {words.map((word, w) => (
        <Fragment key={w}>
          <span className="split-word" aria-hidden>
            {[...word].map((ch, i) => (
              <span className="split-char" key={i}>
                {ch}
              </span>
            ))}
          </span>
          {w < words.length - 1 && " "}
        </Fragment>
      ))}
    </span>
  );
}
