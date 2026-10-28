import { forwardRef, useEffect, useRef, useState, type CSSProperties } from "react";
import { usePageVisible, useReducedMotion } from "../lib/motion";

/**
 * Visor 3D basado en <model-viewer> (Google, usa Three.js por dentro): carga
 * .glb/.gltf, gira con mouse y gestos táctiles, zoom con rueda/pellizco y
 * carga diferida. Deja de dibujar solo cuando sale de la pantalla.
 *
 * Giro automático:
 *  - lento y constante; se detiene al instante mientras el usuario lo mueve y
 *    vuelve 3 s después de soltarlo (antes de tocarlo arranca sin espera);
 *  - se apaga si el sistema pide reducir el movimiento (el control manual sigue);
 *  - se pausa mientras la pestaña está oculta.
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

const RESUME_AFTER_INTERACTION_MS = 3000;

interface Props {
  src: string;
  alt: string;
  poster?: string;
  /** permite girar y hacer zoom con mouse/táctil */
  interactive?: boolean;
  autoRotate?: boolean;
  /** velocidad del giro automático (p. ej. "12deg" = una vuelta cada 30 s) */
  rotationSpeed?: string;
  cameraOrbit?: string;
  className?: string;
  style?: CSSProperties;
  onError?: () => void;
  onLoad?: () => void;
  /** primera vez que el usuario lo gira o acerca */
  onInteract?: () => void;
}

export const ModelViewer = forwardRef<HTMLElement, Props>(function ModelViewer(
  {
    src,
    alt,
    poster,
    interactive = false,
    autoRotate = false,
    rotationSpeed = "12deg",
    cameraOrbit,
    className,
    style,
    onError,
    onLoad,
    onInteract,
  },
  ref,
) {
  const [ready, setReady] = useState(false);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [interacted, setInteracted] = useState(false);
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;

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

  useEffect(() => {
    if (!node || !interactive || interacted) return;
    const handleCamera = (e: Event) => {
      if ((e as CustomEvent<{ source?: string }>).detail?.source !== "user-interaction") return;
      setInteracted(true);
      onInteractRef.current?.();
    };
    node.addEventListener("camera-change", handleCamera);
    return () => node.removeEventListener("camera-change", handleCamera);
  }, [node, interactive, interacted]);

  if (!ready) {
    return (
      <div className={`mv-loading ${className ?? ""}`} style={style}>
        {poster ? <img src={poster} alt={alt} /> : <div className="spinner" />}
      </div>
    );
  }

  // Los atributos booleanos de un custom element se omiten para "false".
  const flags: Record<string, string> = {};
  if (interactive) {
    flags["camera-controls"] = "";
    // Solo girar y acercar: la zapatilla siempre queda centrada
    flags["disable-pan"] = "";
    flags["disable-tap"] = "";
  }
  if (autoRotate && !reduced && visible) flags["auto-rotate"] = "";

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
      shadow-intensity="1"
      shadow-softness="1"
      exposure="1"
      environment-image="neutral"
      interaction-prompt="none"
      touch-action="pan-y"
      camera-orbit={cameraOrbit}
      interpolation-decay={interactive ? "100" : "60"}
      min-camera-orbit="auto auto 40%"
      max-camera-orbit="auto auto 180%"
      auto-rotate-delay={interacted ? String(RESUME_AFTER_INTERACTION_MS) : "0"}
      rotation-per-second={rotationSpeed}
      {...flags}
    />
  );
});
