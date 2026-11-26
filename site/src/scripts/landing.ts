import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const root = document.documentElement;
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const qa = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];

/* ---------- theme: system / light / dark, remembered ---------- */
type Mode = "system" | "light" | "dark";
const KEY = "tally-theme";
const NEXT: Record<Mode, Mode> = { system: "light", light: "dark", dark: "system" };
const NAME: Record<Mode, string> = { system: "match system", light: "light", dark: "dark" };

function stored(): Mode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* storage blocked: theme just lasts for this visit */
  }
  return "system";
}

const toggle = q<HTMLButtonElement>("[data-theme-toggle]");
const status = q("[data-theme-status]");
function paint(mode: Mode, announce: boolean) {
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
  if (!toggle) return;
  toggle.dataset.mode = mode;
  toggle.setAttribute("aria-label", `Theme: ${NAME[mode]}. Switch to ${NAME[NEXT[mode]]}`);
  if (announce && status) status.textContent = `Theme: ${NAME[mode]}`;
}
let mode = stored();
paint(mode, false);
toggle?.addEventListener("click", () => {
  mode = NEXT[mode];
  try {
    if (mode === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    /* see above */
  }
  paint(mode, true);
});

/* ---------- matchbox labels: tap to flip on touch ---------- */
const hoverDevice = matchMedia("(hover: hover) and (pointer: fine)");
for (const btn of qa<HTMLButtonElement>(".mb__btn")) {
  btn.addEventListener("click", () => {
    if (hoverDevice.matches) return; // hover and focus flip it there
    btn.setAttribute("aria-pressed", btn.getAttribute("aria-pressed") === "true" ? "false" : "true");
  });
}

/* ---------- motion ---------- */
gsap.registerPlugin(ScrollTrigger);
root.setAttribute("data-live", "1");

const mm = gsap.matchMedia();
mm.add("(prefers-reduced-motion: no-preference)", () => {
  /* hero: the conductor's punch, once the reader starts scrolling */
  const ticket = q(".ticket");
  const hole = q(".punch__hole");
  const chad = q(".punch__chad");
  if (ticket && hole && chad) {
    gsap.set(hole, { opacity: 0, scale: 0, svgOrigin: "32 32" });
    const punch = () => {
      const tl = gsap.timeline();
      tl.to(ticket, { y: 4, duration: 0.07, ease: "power2.in" })
        .set(hole, { opacity: 1 }, "<")
        .to(hole, { scale: 1, duration: 0.24, ease: "back.out(3)" }, "<")
        .to(ticket, { y: 0, duration: 0.5, ease: "elastic.out(1, 0.35)" }, ">-0.02")
        .fromTo(chad, { opacity: 1, x: 0, y: 0, rotation: 0, svgOrigin: "32 32" }, { opacity: 0, x: 12, y: 78, rotation: 220, duration: 0.95, ease: "power2.in" }, "<0.04");
    };
    ScrollTrigger.create({ start: 50, end: "max", once: true, onEnter: punch });
  }

  /* the bill writes itself, line by line */
  const lines = qa(".parchi__line");
  if (lines.length) {
    gsap.fromTo(
      lines,
      { clipPath: "inset(0 100% 0 0)" },
      { clipPath: "inset(0 0% 0 0)", duration: 0.6, ease: "power2.out", stagger: 0.24, scrollTrigger: { trigger: ".parchi", start: "top 72%", once: true } },
    );
  }

  /* kolam: scrubbed from tangle to plan */
  const svg = q<SVGSVGElement>(".kolam");
  const grid = q(".kolam__grid");
  const fig = q(".kolam__fig");
  const tangle = q(".kolam__tangle");
  if (svg && grid && fig && tangle) {
    const legs = qa(".leg__line");
    const heads = qa(".leg__head");
    const dots = qa<SVGCircleElement>(".kn__dot");
    const signs = qa(".kn__sign");
    const stick = () => parseFloat(getComputedStyle(fig).top) || 0;
    svg.classList.remove("is-plan");
    svg.parentElement?.classList.add("is-tangle");
    const tl = gsap.timeline({
      defaults: { ease: "none" },
      scrollTrigger: {
        trigger: grid,
        start: () => `top top+=${stick()}`,
        end: () => `bottom top+=${stick() + fig.offsetHeight}`,
        scrub: 0.6,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          const plan = self.progress > 0.56;
          svg.classList.toggle("is-plan", plan);
          svg.parentElement?.classList.toggle("is-tangle", !plan);
        },
      },
    });
    tl.fromTo(tangle, { strokeDashoffset: 1000, opacity: 1 }, { strokeDashoffset: 0, opacity: 1, duration: 3.2 }, 0);
    tl.to({}, { duration: 1.8 }, 3.2);
    tl.to(tangle, { opacity: 0.16, duration: 2.6 }, 5.2);
    for (const dot of dots) {
      const r = Number(dot.parentElement?.getAttribute("data-r") ?? 12);
      tl.fromTo(dot, { attr: { r: 9 } }, { attr: { r }, duration: 2.4 }, 5.2);
    }
    tl.fromTo(signs, { opacity: 0 }, { opacity: 1, duration: 1 }, 7.2);
    legs.forEach((leg, i) => {
      tl.fromTo(leg, { strokeDashoffset: 100 }, { strokeDashoffset: 0, duration: 1.6 }, 6 + i * 0.45);
      tl.fromTo(heads[i]!, { opacity: 0 }, { opacity: 1, duration: 0.25 }, 7.35 + i * 0.45);
    });
    tl.to({}, { duration: 1.2 }, 9.2);
  }

  /* standee: stamps thump down */
  const stamps = qa(".stamp");
  const stage = q(".standee__stage");
  if (stamps.length && stage) {
    const tl = gsap.timeline({ scrollTrigger: { trigger: ".standee", start: "top 68%", once: true } });
    stamps.forEach((s, i) => {
      const rot = parseFloat(getComputedStyle(s).rotate) || 0;
      const at = 0.15 + i * 0.5;
      tl.fromTo(
        s,
        { opacity: 0, scale: 2.5, rotate: rot + 9 },
        { opacity: 0.93, scale: 1, rotate: rot, duration: 0.22, ease: "power4.in" },
        at,
      )
        .to(stage, { x: 3, y: 2, duration: 0.04, yoyo: true, repeat: 5, ease: "none" }, at + 0.22)
        .to(stage, { x: 0, y: 0, duration: 0.05 }, at + 0.5);
    });
  }

  /* matchbox labels slide into the tray */
  const boxes = qa(".mb");
  if (boxes.length) {
    gsap.fromTo(
      boxes,
      { y: 22, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.55, ease: "power3.out", stagger: { each: 0.05 }, clearProps: "transform", scrollTrigger: { trigger: ".boxes", start: "top 88%", once: true } },
    );
  }

  /* luggage tag swings on its string */
  const tag = q(".tag-luggage");
  if (tag) {
    gsap.fromTo(tag, { rotation: -10 }, { rotation: 3, duration: 2.4, ease: "elastic.out(1, 0.22)", scrollTrigger: { trigger: tag, start: "top 82%", once: true } });
  }
});

/* open trails change the page height; keep scrub positions honest */
for (const d of qa<HTMLDetailsElement>(".why")) d.addEventListener("toggle", () => ScrollTrigger.refresh());
document.fonts?.ready.then(() => ScrollTrigger.refresh());
