import { forwardRef, useEffect, useState, type CSSProperties } from "react";

/**
 * Visor 3D basado en <model-viewer> (Google): soporta .glb/.gltf, giro con
 * mouse y gestos táctiles, zoom con rueda/pellizco y carga diferida.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;
    }
  }
}

let loader: Promise<unknown> | null = null;
export const loadModelViewer = () => (loader ??= import("@google/model-viewer"));

interface Props {
  src: string;
  alt: string;
  poster?: string;
  /** permite girar y hacer zoom con mouse/táctil */
  interactive?: boolean;
  autoRotate?: boolean;
  cameraOrbit?: string;
  className?: string;
  style?: CSSProperties;
  onError?: () => void;
  onLoad?: () => void;
}

export const ModelViewer = forwardRef<HTMLElement, Props>(function ModelViewer(
  { src, alt, poster, interactive = false, autoRotate = false, cameraOrbit, className, style, onError, onLoad },
  ref,
) {
  const [ready, setReady] = useState(false);
  const [node, setNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let alive = true;
    loadModelViewer()
      .then(() => alive && setReady(true))
      .catch(() => onError?.());
    return () => {
      alive = false;
    };
  }, [onError]);

  useEffect(() => {
    if (!node) return;
    const handleError = () => onError?.();
    const handleLoad = () => onLoad?.();
    node.addEventListener("error", handleError);
    node.addEventListener("load", handleLoad);
    return () => {
      node.removeEventListener("error", handleError);
      node.removeEventListener("load", handleLoad);
    };
  }, [node, onError, onLoad]);

  if (!ready) {
    return (
      <div className={`mv-loading ${className ?? ""}`} style={style}>
        {poster ? <img src={poster} alt={alt} /> : <div className="spinner" />}
      </div>
    );
  }

  // Los atributos booleanos de un custom element se omiten para "false".
  const flags: Record<string, string> = {};
  if (interactive) flags["camera-controls"] = "";
  if (autoRotate) flags["auto-rotate"] = "";

  return (
    <model-viewer
      ref={(el: HTMLElement | null) => {
        setNode(el);
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      class={className}
      style={style}
      src={src}
      alt={alt}
      poster={poster}
      loading="eager"
      reveal="auto"
      shadow-intensity="1.1"
      shadow-softness="0.8"
      exposure="1.05"
      environment-image="neutral"
      interaction-prompt="none"
      touch-action="pan-y"
      camera-orbit={cameraOrbit}
      interpolation-decay={interactive ? "100" : "60"}
      min-camera-orbit="auto auto 40%"
      max-camera-orbit="auto auto 180%"
      auto-rotate-delay="0"
      rotation-per-second="18deg"
      {...flags}
    />
  );
});
