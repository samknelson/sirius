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

export function TemplateImageTools({ editor, image, execute, disabled }: {
  editor: HTMLDivElement | null;
  image: HTMLImageElement | null;
  execute: (mutation: () => void) => void;
  disabled: boolean;
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
    <Button type="button" size="sm" onClick={save}>{image ? "Update image" : "Insert image"}</Button>
    {image && <Button type="button" size="sm" variant="outline" className="ml-2" onClick={() => execute(() => {
      if (!editor?.contains(image)) return;
      const parent = image.parentElement;
      image.remove();
      if (parent?.tagName === "A" && !parent.childNodes.length) parent.remove();
    })}>Delete image</Button>}
  </fieldset>;
}