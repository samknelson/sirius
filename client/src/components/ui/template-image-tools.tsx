import { useEffect, useState } from "react";
import { Button } from "./button";
import { Input } from "./input";
import { insertAtSelection } from "./template-table-tools";

export function safeDesignUrl(value: string, image = false): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !/[\s\\]/.test(value) &&
      (image ? url.protocol === "https:" : ["https:", "http:", "mailto:", "tel:"].includes(url.protocol));
  } catch { return false; }
}

/** Resize the displayed image in-place while preserving its natural ratio by default. */
export function resizeImageBy(image: HTMLImageElement, deltaX: number, deltaY: number, corner = "se"): void {
  const rect = image.getBoundingClientRect();
  const horizontal = corner.includes("w") ? -deltaX : deltaX;
  const vertical = corner.includes("n") ? -deltaY : deltaY;
  const current = Number(image.width) || rect.width || 1;
  const next = Math.max(1, Math.min(2000, Math.round(current + (Math.abs(horizontal) >= Math.abs(vertical) ? horizontal : vertical))));
  image.width = next;
  image.style.width = `${next}px`;
  image.style.height = "auto";
}

export function moveImageInFlow(image: HTMLImageElement, target: Node, before = false): void {
  if (image === target || image.contains(target) || target === image.parentNode) return;
  if (before) target.parentNode?.insertBefore(image, target);
  else if (target.parentNode) target.parentNode.insertBefore(image, target.nextSibling);
  else target.appendChild(image);
}

export function TemplateImageTools({ editor, image, execute, disabled, uploadImage }: {
  editor: HTMLDivElement | null;
  image: HTMLImageElement | null;
  execute: (mutation: () => void) => void;
  disabled: boolean;
  /** Host-supplied API adapter; resolves to a persisted HTTPS URL. */
  uploadImage?: (file: File) => Promise<string>;
}) {
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [link, setLink] = useState("");
  const [align, setAlign] = useState("left");
  const [lock, setLock] = useState(true);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    setUrl(image?.getAttribute("src") ?? "");
    setAlt(image?.alt ?? "");
    const dimension = (name: "width" | "height") => {
      const value = image?.getAttribute(name) ?? image?.style[name] ?? "";
      return /^\d+(?:px)?$/.test(value) ? value.replace("px", "") : "";
    };
    setWidth(dimension("width"));
    setHeight(dimension("height"));
    setLink(image?.closest("a")?.getAttribute("href") ?? "");
    setAlign(image?.style.marginLeft === "auto" ? (image.style.marginRight === "auto" ? "center" : "right") : "left");
    setError(image && image.complete && !image.naturalWidth ? "Image unavailable. Check its URL or replace it." : "");
    setPreviewUrl("");
  }, [image]);
  useEffect(() => {
    if (!editor) return;
    const dragStart = (event: DragEvent) => {
      const target = event.target as HTMLElement;
      const selected = target.closest("img") as HTMLImageElement | null;
      if (!selected || !editor.contains(selected)) return;
      event.dataTransfer?.setData("text/template-image", "move");
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      selected.dataset.templateMovingImage = "true";
    };
    const drop = (event: DragEvent) => {
      const selected = editor.querySelector<HTMLImageElement>('[data-template-moving-image="true"]');
      if (!selected) return;
      event.preventDefault();
      const target = event.target as HTMLElement;
      const targetImage = target.closest("img");
      if (targetImage && targetImage !== selected) moveImageInFlow(selected, targetImage, true);
      else {
        const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
        const block = range?.startContainer.nodeType === Node.ELEMENT_NODE
          ? range.startContainer as Element
          : range?.startContainer.parentElement;
        if (block && editor.contains(block) && !block.contains(selected)) block.appendChild(selected);
      }
      delete selected.dataset.templateMovingImage;
      selected.focus?.();
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const dragOver = (event: DragEvent) => {
      if (editor.querySelector('[data-template-moving-image="true"]')) event.preventDefault();
    };
    const dragEnd = () => editor.querySelectorAll('[data-template-moving-image="true"]').forEach(el => delete (el as HTMLElement).dataset.templateMovingImage);
    editor.addEventListener("dragstart", dragStart);
    editor.addEventListener("dragover", dragOver);
    editor.addEventListener("drop", drop);
    editor.addEventListener("dragend", dragEnd);
    return () => {
      editor.removeEventListener("dragstart", dragStart);
      editor.removeEventListener("dragover", dragOver);
      editor.removeEventListener("drop", drop);
      editor.removeEventListener("dragend", dragEnd);
    };
  }, [editor]);
  useEffect(() => {
    if (image) image.draggable = true;
  }, [image]);
  const save = () => {
    if (!editor) return;
    if (!safeDesignUrl(url, true)) { setError("Enter an HTTPS image URL without credentials."); return; }
    if (link && !safeDesignUrl(link)) { setError("Enter a valid http(s), mailto or tel link."); return; }
    if ([width, height].some(value => value && (!/^\d+$/.test(value) || +value < 1 || +value > 2000))) {
      setError("Image dimensions must be whole pixels between 1 and 2000."); return;
    }
    setError("");
    execute(() => {
      const target = image && editor.contains(image) ? image : document.createElement("img");
      target.src = url;
      target.alt = alt;
      target.style.maxWidth = "100%";
      target.style.display = "block";
      target.style.marginLeft = align === "left" ? "0" : "auto";
      target.style.marginRight = align === "right" ? "0" : "auto";
      const w = width ? +width : undefined;
      const h = height ? +height : undefined;
      for (const property of ["width", "height"]) { target.removeAttribute(property); target.style.removeProperty(property); }
      if (w) { target.width = w; target.style.width = `${w}px`; }
      if (lock) {
        // One explicit dimension lets the browser retain the intrinsic ratio,
        // including when replacing the image with a differently shaped resource.
        if (!w && h) { target.height = h; target.style.height = `${h}px`; target.style.width = "auto"; }
        else target.style.height = "auto";
      } else if (h) { target.height = h; target.style.height = `${h}px`; }
      if (!editor.contains(target)) insertAtSelection(editor, target);
      let anchor = target.parentElement?.tagName === "A" ? target.parentElement as HTMLAnchorElement : null;
      if (link) {
        if (!anchor) { anchor = document.createElement("a"); target.replaceWith(anchor); anchor.appendChild(target); }
        anchor.href = link;
      } else if (anchor) anchor.replaceWith(...Array.from(anchor.childNodes));
    });
  };
  return <fieldset disabled={disabled} className="space-y-2">
    <p className="text-xs text-muted-foreground">Click an image in the editor to edit or replace it. HTTPS images only.</p>
    <label className="block text-xs">Image URL<Input aria-label="Image URL" value={url} onChange={e => setUrl(e.target.value)} /></label>
    <label className="block text-xs">Upload image<input aria-label="Upload image" className="mt-1 block w-full text-xs" type="file" accept="image/*" disabled={!uploadImage || uploading} onChange={async e => {
      const file = e.currentTarget.files?.[0];
      if (!file) return;
      const input = e.currentTarget;
      if (!uploadImage) { setError("Image upload is not configured by the host."); return; }
      if (!file.type.startsWith("image/")) { setError("Choose an image file."); return; }
      setUploading(true); setError("");
      try {
        const uploadedUrl = await uploadImage(file);
        if (!safeDesignUrl(uploadedUrl, true)) throw new Error("Upload API must return an HTTPS image URL.");
        setUrl(uploadedUrl);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Image upload failed.");
      } finally {
        setUploading(false);
        input.value = "";
      }
    }} /></label>
    {uploadImage && <p className="text-xs text-muted-foreground">{uploading ? "Uploading…" : "Upload uses the host-provided image API."}</p>}
    <label className="block text-xs">Alternative text<Input aria-label="Image alternative text" value={alt} onChange={e => setAlt(e.target.value)} /></label>
    <div className="flex gap-2">
      <label className="text-xs">Width (px)<Input aria-label="Image width" value={width} onChange={e => setWidth(e.target.value)} /></label>
      <label className="text-xs">Height (px)<Input aria-label="Image height" value={height} onChange={e => setHeight(e.target.value)} disabled={lock && !!width} /></label>
    </div>
    <label className="flex gap-2 text-xs"><input type="checkbox" checked={lock} onChange={e => setLock(e.target.checked)} />Preserve aspect ratio</label>
    <label className="block text-xs">Image alignment<select aria-label="Image alignment" className="ml-2 border rounded bg-background" value={align} onChange={e => setAlign(e.target.value)}><option>left</option><option>center</option><option>right</option></select></label>
    <label className="block text-xs">Link (optional)<Input aria-label="Image link" value={link} onChange={e => setLink(e.target.value)} /></label>
    <Button type="button" size="sm" variant="outline" onClick={() => {
      if (!safeDesignUrl(url, true)) { setError("Enter an HTTPS image URL without credentials."); return; }
      setError(""); setPreviewUrl(url);
    }}>Check image</Button>
    {previewUrl && <img src={previewUrl} alt="Image URL preview" className="max-h-24 max-w-full" onError={() => setError("Image unavailable. Check its URL or replace it. Postal delivery also checks image resource safety.")} onLoad={() => setError("")} />}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {image && <div role="group" aria-label="Image resize handles" className="flex gap-1">
      {(["nw", "ne", "sw", "se"] as const).map(handle => <button key={handle} type="button" aria-label={`Resize image ${handle.toUpperCase()}`} className="h-6 w-6 border bg-background text-[10px] cursor-nwse-resize"
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          const dx = event.key === "ArrowRight" ? 8 : event.key === "ArrowLeft" ? -8 : 0;
          const dy = event.key === "ArrowDown" ? 8 : event.key === "ArrowUp" ? -8 : 0;
          execute(() => resizeImageBy(image, dx, dy, handle));
        }}
        onPointerDown={event => {
          event.preventDefault();
          const startX = event.clientX; const startY = event.clientY;
          const baseWidth = image.width || image.getBoundingClientRect().width || 1;
          const move = (next: PointerEvent) => {
            if (!image.isConnected) return;
            const dx = handle.includes("w") ? startX - next.clientX : next.clientX - startX;
            const dy = handle.includes("n") ? startY - next.clientY : next.clientY - startY;
            const dimension = Math.max(1, Math.min(2000, Math.round(baseWidth + (Math.abs(dx) >= Math.abs(dy) ? dx : dy))));
            image.width = dimension;
            image.style.width = `${dimension}px`;
            image.style.height = "auto";
          };
          const finish = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", finish);
            execute(() => {});
          };
          window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish, { once: true });
        }}>{handle.toUpperCase()}</button>)}
    </div>}
    <Button type="button" size="sm" onClick={save}>{image ? "Update image" : "Insert image"}</Button>
    {image && <Button type="button" size="sm" variant="outline" className="ml-2" onClick={() => execute(() => {
      if (!editor?.contains(image)) return;
      const parent = image.parentElement;
      image.remove();
      if (parent?.tagName === "A" && !parent.childNodes.length) parent.remove();
    })}>Delete image</Button>}
  </fieldset>;
}