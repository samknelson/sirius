/**
 * The standard letter page — dependency-free.
 *
 * Every postal letter this system composes from an HTML BODY (a rendered
 * notifier template, a hand-composed letter in the comm screen) is wrapped
 * in this one page before it reaches the postal provider: US letter,
 * one-inch margins, 12pt sans-serif. The body is authored (or rendered)
 * WITHOUT a page shell so that the shell is decided in exactly one place
 * and a letter mailed by a notifier looks like a letter mailed by hand.
 *
 * The body is expected to be sanitized markup already (the delivery
 * shaping step sanitizes rendered template HTML; the compose screen sends
 * what the sanitized-rich-text editor produced). Wrapping neither escapes
 * nor sanitizes — see `./index.ts` for that distinction.
 *
 * DELIBERATELY has no imports: the compose step of the notifier framework
 * runs on the boot path of the lean production image.
 */

/** The page shell; `{{BODY}}` marks where the letter body goes. */
export const LETTER_PAGE_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page {
      size: letter;
      margin: 1in;
    }
    body {
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      font-size: 12pt;
      line-height: 1.5;
      color: #333;
      margin: 0;
      padding: 0;
    }
    p {
      margin: 0 0 1em 0;
    }
    .date {
      margin-bottom: 2em;
    }
    .greeting {
      margin-bottom: 1em;
    }
    .closing {
      margin-top: 2em;
    }
  </style>
</head>
<body>
{{BODY}}
</body>
</html>`;

const BODY_PLACEHOLDER = "{{BODY}}";

/**
 * Wrap a letter body in the standard page. A `split`/`join` rather than
 * `String.replace` so a body containing `$&`-style replacement patterns
 * is inserted verbatim.
 */
export function wrapLetterPage(body: string): string {
  return LETTER_PAGE_HTML.split(BODY_PLACEHOLDER).join(body);
}
