import { useCallback, useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { ProductSummary } from "@tienda/shared";
import { api, prefersReducedMotion, STORE_NAME } from "../lib/api";
import { useReveal } from "../lib/useReveal";
import { ProductVisual } from "../components/ProductVisual";
import type { SpinHandle } from "../components/Spin360";
import { ProductCard } from "../components/ProductCard";
import { SplitText } from "../components/SplitText";
import { Price } from "../components/Price";
import { ArrowIcon } from "../components/Icons";

gsap.registerPlugin(ScrollTrigger);

interface FeaturedResponse {
  featured: ProductSummary[];
  latest: ProductSummary[];
}

/** Gira el modelo 3D (si existe) según el progreso del scroll. */
function setOrbit(el: HTMLElement | null | undefined, deg: number, zoom = "auto") {
  if (el && el.tagName === "MODEL-VIEWER") el.setAttribute("camera-orbit", `${deg.toFixed(1)}deg 76deg ${zoom}`);
}

export function HomePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["featured"],
    queryFn: () => api.get<FeaturedResponse>("/api/catalog/featured"),
  });
  const root = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const heroModel = useRef<HTMLElement | null>(null);
  const sceneModels = useRef<(HTMLElement | null)[]>([]);
  // Vistas 360° con fotos: también giran con el scroll
  const heroSpin = useRef<SpinHandle | null>(null);
  const sceneSpins = useRef<(SpinHandle | null)[]>([]);

  const featured = data?.featured ?? [];
  const latest = data?.latest ?? [];
  const hero = featured[0];
  const year = new Date().getFullYear();

  const glitch = useCallback(() => {
    const el = flash.current;
    if (!el || prefersReducedMotion()) return;
    el.classList.remove("is-on");
    void el.offsetWidth; // reinicia la animación
    el.classList.add("is-on");
  }, []);

  useLayoutEffect(() => {
    if (isLoading || !root.current) return;
    const reduced = prefersReducedMotion();
    const ctx = gsap.context(() => {
      // Intro: el título aparece letra por letra
      gsap.from(".hero .split-char", {
        yPercent: 120,
        opacity: 0,
        duration: 1.1,
        ease: "expo.out",
        stagger: 0.035,
        delay: 0.15,
      });
      gsap.from(".hero__stage", { scale: 0.86, opacity: 0, duration: 1.6, ease: "expo.out", delay: 0.1 });
      gsap.from(".hero__meta > *", { y: 20, opacity: 0, duration: 0.8, stagger: 0.08, delay: 0.6 });
      if (reduced) return;

      // Portada fijada: el modelo gira y la cámara se acerca al hacer scroll
      const orbit = { deg: -25 };
      gsap
        .timeline({
          scrollTrigger: { trigger: ".hero", start: "top top", end: "+=110%", scrub: 0.6, pin: true },
        })
        .to(".hero__title", { yPercent: -35, opacity: 0, ease: "none" }, 0)
        .to(".hero__bgword", { xPercent: -18, ease: "none" }, 0)
        .to(".hero__side", { opacity: 0, scale: 0.8, ease: "none" }, 0)
        .to(".hero__stage", { scale: 1.22, yPercent: -4, ease: "none" }, 0)
        .to(orbit, { deg: 160, ease: "none", onUpdate: () => {
              setOrbit(heroModel.current, orbit.deg);
              heroSpin.current?.setAngle(orbit.deg);
            },
          }, 0)
        .to(".hero__beams", { opacity: 0.25, ease: "none" }, 0);

      // Escenas por producto: fijadas, con texto que aparece y modelo girando
      gsap.utils.toArray<HTMLElement>(".scene").forEach((scene, i) => {
        const o = { deg: 210 };
        gsap
          .timeline({
            scrollTrigger: {
              trigger: scene,
              start: "top top",
              end: "+=140%",
              scrub: 0.6,
              pin: true,
              onEnter: glitch,
              onEnterBack: glitch,
            },
          })
          .fromTo(
            scene.querySelectorAll(".scene__tagline .split-char"),
            { opacity: 0, yPercent: 100, filter: "blur(8px)" },
            { opacity: 1, yPercent: 0, filter: "blur(0px)", stagger: 0.015, ease: "power2.out" },
            0,
          )
          .fromTo(scene.querySelector(".scene__name"), { xPercent: 18 }, { xPercent: -18, ease: "none" }, 0)
          .fromTo(scene.querySelector(".scene__stage"), { scale: 0.82 }, { scale: 1.08, ease: "none" }, 0)
          .to(o, { deg: -150, ease: "none", onUpdate: () => {
              setOrbit(sceneModels.current[i], o.deg);
              sceneSpins.current[i]?.setAngle(o.deg);
            },
          }, 0)
          .fromTo(scene.querySelector(".scene__info"), { opacity: 0, y: 40 }, { opacity: 1, y: 0 }, 0.35);
      });

      // Final: texto gigante que se desplaza en direcciones opuestas
      gsap.to(".finale__row--a", { xPercent: -20, ease: "none", scrollTrigger: { trigger: ".finale", scrub: true } });
      gsap.to(".finale__row--b", { xPercent: 20, ease: "none", scrollTrigger: { trigger: ".finale", scrub: true } });
      ScrollTrigger.create({ trigger: ".finale", start: "top 60%", onEnter: glitch, onLeaveBack: glitch });
    }, root);
    return () => ctx.revert();
  }, [isLoading, featured.length, glitch]);

  useReveal(root, [isLoading, latest.length]);

  return (
    <div ref={root} className="home">
      <div ref={flash} className="glitch-flash" aria-hidden onAnimationEnd={(e) => e.currentTarget.classList.remove("is-on")} />

      {/* ───────── PORTADA ───────── */}
      <section className="hero" style={{ "--accent-scene": hero?.accentColor ?? "#ff2a2a" } as React.CSSProperties}>
        <div className="hero__beams" aria-hidden>
          {Array.from({ length: 7 }).map((_, i) => (
            <span key={i} className="beam" style={{ "--b": i } as React.CSSProperties} />
          ))}
        </div>
        <div className="hero__bgword display" aria-hidden>
          {STORE_NAME} {STORE_NAME} {STORE_NAME}
        </div>

        <div className="hero__stage">
          {featured[1] && (
            <Link to={`/zapatilla/${featured[1].slug}`} className="hero__side hero__side--left" tabIndex={-1}>
              <ProductVisual name={featured[1].name} modelUrl={null} images={featured[1].images} />
            </Link>
          )}
          {hero ? (
            <Link to={`/zapatilla/${hero.slug}`} className="hero__main" aria-label={`Ver ${hero.name}`}>
              <ProductVisual
                ref={heroModel}
                spinRef={heroSpin}
                spin={hero.spin}
                name={hero.name}
                modelUrl={hero.modelUrl}
                images={hero.images}
                cameraOrbit="-25deg 76deg auto"
              />
            </Link>
          ) : (
            !isLoading && <div className="hero__placeholder" aria-hidden />
          )}
          {featured[2] && (
            <Link to={`/zapatilla/${featured[2].slug}`} className="hero__side hero__side--right" tabIndex={-1}>
              <ProductVisual name={featured[2].name} modelUrl={null} images={featured[2].images} />
            </Link>
          )}
        </div>

        <div className="hero__content container">
          <h1 className="hero__title display">
            <SplitText text={STORE_NAME} />
          </h1>
          <div className="hero__meta">
            <span className="eyebrow eyebrow--accent">Colección {year} · Drop 01</span>
            <p>
              {hero
                ? "Zapatillas que puedes girar, acercar y explorar en 3D antes de que lleguen a tu puerta."
                : "La primera colección se está preparando. Vuelve pronto."}
            </p>
            <Link to="/catalogo" className="btn btn--primary btn--glitch" data-label="Comprar la colección">
              Comprar la colección <ArrowIcon width={16} />
            </Link>
          </div>
        </div>
        <div className="scroll-cue" aria-hidden>
          <span className="eyebrow">Desliza para explorar</span>
          <span className="scroll-cue__line" />
        </div>
      </section>

      {/* ───────── ESCENAS POR PRODUCTO ───────── */}
      {featured.map((p, i) => (
        <section
          key={p.id}
          className="scene"
          style={{ "--accent-scene": p.accentColor } as React.CSSProperties}
          aria-label={p.name}
        >
          <div className="scene__bg" aria-hidden />
          <div className="scene__name display" aria-hidden>
            {p.name}
          </div>
          <div className="scene__stage">
            <ProductVisual
              ref={(el) => {
                sceneModels.current[i] = el;
              }}
              spinRef={(h) => {
                sceneSpins.current[i] = h;
              }}
              spin={p.spin}
              name={p.name}
              modelUrl={p.modelUrl}
              images={p.images}
              cameraOrbit="210deg 76deg auto"
            />
          </div>
          <div className="scene__tagline display">
            <SplitText text={p.tagline || p.name} />
          </div>
          <div className="scene__info container">
            <div className="scene__card">
              <span className="eyebrow">
                {String(i + 1).padStart(2, "0")} / {String(featured.length).padStart(2, "0")}
                {p.brand ? ` — ${p.brand.name}` : ""}
              </span>
              <h2 className="scene__title">{p.name}</h2>
              <Price priceCents={p.priceCents} finalPriceCents={p.finalPriceCents} discountPercent={p.discountPercent} />
              <span className="muted scene__sizes">
                {p.inStock
                  ? `Tallas: ${p.sizes
                      .filter((s) => s.available)
                      .map((s) => s.label)
                      .join(" · ")}`
                  : "Agotado"}
              </span>
              <Link to={`/zapatilla/${p.slug}`} className="btn btn--light btn--glitch" data-label="Ver zapatilla">
                Ver zapatilla <ArrowIcon width={16} />
              </Link>
            </div>
          </div>
          <div className="scroll-cue scroll-cue--scene" aria-hidden>
            <span className="eyebrow">Desliza para explorar</span>
            <span className="scroll-cue__line" />
          </div>
        </section>
      ))}

      {/* ───────── FINAL (fondo claro) ───────── */}
      {hero && (
        <section className="finale">
          <div className="finale__rows display" aria-hidden>
            {["a", "b", "a"].map((k, i) => (
              <div key={i} className={`finale__row finale__row--${k}`}>
                {Array.from({ length: 6 })
                  .map(() => STORE_NAME)
                  .join(" ")}
              </div>
            ))}
          </div>
          <Link to={`/zapatilla/${hero.slug}`} className="finale__product" aria-label={`Comprar ${hero.name}`}>
            <ProductVisual name={hero.name} modelUrl={null} images={hero.images} />
          </Link>
          <div className="finale__cta">
            <span className="eyebrow">Haz clic en la zapatilla y elige tu talla</span>
            <Link to="/catalogo" className="btn btn--light finale__btn">
              Comprar
            </Link>
          </div>
        </section>
      )}

      {/* ───────── LANZAMIENTOS ───────── */}
      {latest.length > 0 && (
        <section className="latest container">
          <div className="section-head" data-reveal>
            <h2 className="display section-title">
              <span className="glitch" data-text="Lanzamientos">
                Lanzamientos
              </span>
            </h2>
            <Link to="/catalogo" className="btn">
              Ver todo <ArrowIcon width={16} />
            </Link>
          </div>
          <div className="grid">
            {latest.map((p, i) => (
              <ProductCard key={p.id} product={p} index={i} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
