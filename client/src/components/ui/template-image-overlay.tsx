import { useEffect, useState } from "react";

/** Controls are siblings of the editable surface, never part of its HTML. */
export function TemplateImageOverlay({ image, editor, container, execute }: {
  image: HTMLImageElement;
  editor: HTMLElement;
  container: HTMLElement;
  execute: (mutation: () => void) => void;
}) {
  const [bounds, setBounds] = useState<DOMRect | null>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setBounds(editor.contains(image) ? image.getBoundingClientRect() : null));
    };
    const observer = new ResizeObserver(update);
    observer.observe(image);
    observer.observe(editor);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [image, editor]);
  if (!bounds || !editor.contains(image)) return null;
  const parent = container.getBoundingClientRect();
  const left = bounds.left - parent.left;
  const top = bounds.top - parent.top;
  return <div aria-label="Selected image" className="pointer-events-none absolute z-20 border-2 border-primary"
    style={{ left, top, width: bounds.width, height: bounds.height }}>
    {(["nw", "ne", "sw", "se"] as const).map(corner =>
      <button key={corner} type="button" aria-label={`Resize image ${corner.toUpperCase()}`}
        title={`Resize image ${corner.toUpperCase()} (arrow keys)`}
        className={`pointer-events-auto absolute h-4 w-4 rounded-sm border-2 border-background bg-primary shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring touch-none ${corner.includes("n") ? "-top-2" : "-bottom-2"} ${corner.includes("w") ? "-left-2" : "-right-2"}`}
        style={{ cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize" }}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          const direction = event.key === "ArrowLeft" || event.key === "ArrowRight"
            ? (corner.includes("w") ? -1 : 1) : (corner.includes("n") ? -1 : 1);
          const amount = event.key === "ArrowLeft" ? -8 : event.key === "ArrowRight" ? 8
            : event.key === "ArrowUp" ? -8 : 8;
          const base = image.getBoundingClientRect().width;
          const limit = Math.min(2000, Math.max(32, editor.clientWidth - 24));
          execute(() => {
            const width = Math.round(Math.max(24, Math.min(limit, base + direction * amount)));
            image.width = width;
            image.style.width = `${width}px`;
            image.style.height = "auto";
          });
        }}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          const startX = event.clientX;
          const startY = event.clientY;
          const base = image.getBoundingClientRect().width;
          const originalWidth = image.getAttribute("width");
          const originalStyle = image.getAttribute("style");
          const limit = Math.min(2000, Math.max(32, editor.clientWidth - 24));
          let changed = false;
          const move = (next: PointerEvent) => {
            if (next.pointerId !== event.pointerId || !editor.contains(image)) return;
            const dx = (next.clientX - startX) * (corner.includes("w") ? -1 : 1);
            const dy = (next.clientY - startY) * (corner.includes("n") ? -1 : 1);
            const width = Math.round(Math.max(24, Math.min(limit, base + (Math.abs(dx) >= Math.abs(dy) ? dx : dy))));
            if (Math.abs(width - base) < 1) return;
            changed = true;
            image.width = width;
            image.style.width = `${width}px`;
            image.style.height = "auto";
            updateBounds();
          };
          const updateBounds = () => setBounds(image.getBoundingClientRect());
          const finish = (next: PointerEvent) => {
            if (next.pointerId !== event.pointerId) return;
            cleanup();
            if (next.type === "pointercancel" || !editor.contains(image)) {
              if (originalWidth === null) image.removeAttribute("width"); else image.setAttribute("width", originalWidth);
              if (originalStyle === null) image.removeAttribute("style"); else image.setAttribute("style", originalStyle);
              updateBounds();
            } else if (changed) execute(() => {});
          };
          const cancel = (next: KeyboardEvent) => {
            if (next.key !== "Escape") return;
            next.preventDefault();
            cleanup();
            if (originalWidth === null) image.removeAttribute("width"); else image.setAttribute("width", originalWidth);
            if (originalStyle === null) image.removeAttribute("style"); else image.setAttribute("style", originalStyle);
            updateBounds();
          };
          const cleanup = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", finish);
            window.removeEventListener("pointercancel", finish);
            window.removeEventListener("keydown", cancel, true);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", finish);
          window.addEventListener("pointercancel", finish);
          window.addEventListener("keydown", cancel, true);
        }} />)}
  </div>;
}