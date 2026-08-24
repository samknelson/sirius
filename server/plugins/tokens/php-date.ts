/**
 * Minimal PHP-style date formatter used by the `date` token segment
 * (e.g. format="l, F j, Y" → "Friday, April 17, 2026"). Supports the
 * common subset: d j D l N w F M m n t Y y a A g G h H i s U.
 * Backslash escapes the next character.
 */
const DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatPhpDate(date: Date, format: string): string {
  let out = "";
  for (let i = 0; i < format.length; i++) {
    const c = format[i];
    if (c === "\\") {
      if (i + 1 < format.length) {
        out += format[i + 1];
        i++;
      }
      continue;
    }
    switch (c) {
      case "d": out += pad(date.getDate()); break;
      case "j": out += String(date.getDate()); break;
      case "D": out += DAYS[date.getDay()].slice(0, 3); break;
      case "l": out += DAYS[date.getDay()]; break;
      case "N": out += String(date.getDay() === 0 ? 7 : date.getDay()); break;
      case "w": out += String(date.getDay()); break;
      case "F": out += MONTHS[date.getMonth()]; break;
      case "M": out += MONTHS[date.getMonth()].slice(0, 3); break;
      case "m": out += pad(date.getMonth() + 1); break;
      case "n": out += String(date.getMonth() + 1); break;
      case "t": out += String(new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()); break;
      case "Y": out += String(date.getFullYear()); break;
      case "y": out += String(date.getFullYear()).slice(-2); break;
      case "a": out += date.getHours() < 12 ? "am" : "pm"; break;
      case "A": out += date.getHours() < 12 ? "AM" : "PM"; break;
      case "g": out += String(date.getHours() % 12 || 12); break;
      case "G": out += String(date.getHours()); break;
      case "h": out += pad(date.getHours() % 12 || 12); break;
      case "H": out += pad(date.getHours()); break;
      case "i": out += pad(date.getMinutes()); break;
      case "s": out += pad(date.getSeconds()); break;
      case "U": out += String(Math.floor(date.getTime() / 1000)); break;
      default: out += c;
    }
  }
  return out;
}

/** Legacy "Apr 17, 2026" formatting used by dob/cardcheck/today leaves. */
export function fmtDateShort(v: string | Date | null | undefined): string {
  if (v == null || v === "") return "";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return formatPhpDate(d, "M j, Y");
}
