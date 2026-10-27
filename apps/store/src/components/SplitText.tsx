/** Divide un texto en letras para animarlas una a una (aparición de textos). */
export function SplitText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className} aria-label={text}>
      {text.split(" ").map((word, w) => (
        <span className="split-word" key={w} aria-hidden>
          {[...word].map((ch, i) => (
            <span className="split-char" key={i}>
              {ch}
            </span>
          ))}
          {" "}
        </span>
      ))}
    </span>
  );
}
