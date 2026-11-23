---
name: CSV newline quoting
description: csv-stringify needs explicit newline quoting when using CRLF record delimiters.
---

When using `csv-stringify` with `record_delimiter: "\r\n"`, explicitly quote fields containing either `\r` or `\n`, for example with `quoted_match: /[\r\n]/`.

**Why:** Verification with the installed library showed a field containing a lone LF was emitted unquoted when the record delimiter was CRLF. A multiline worker or sheet label could consequently become extra spreadsheet rows despite using a CSV library.

**How to apply:** Whenever creating CRLF exports, exercise lone CR, lone LF, quotes, and commas, independently of formula neutralization.
