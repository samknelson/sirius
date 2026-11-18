# Alternate Tax IDs in worker imports

The SSN column accepts either a structurally valid SSN or a usable, worker-specific
Alternate Tax ID. This is **not** verification that an SSN was issued, belongs to
a person, or that an unmatched person is new.

## Matching and normalization

- Valid SSNs keep the existing numeric parsing and structural validation.
- Invalid but usable tax identifiers match only the system Alternate Tax ID
  type in the existing worker ID system. Other ID types are not fallbacks.
- Trim surrounding whitespace. For identifiers containing only digits and
  spaces, hyphens, dots or slashes, remove those separators. Preserve leading
  zeros; do not pad alternate values. Thus `000-12-3456`, `000.12.3456` and
  `000123456` refer to the same alternate identifier.
- Preserve letters, case and punctuation in alphanumeric identifiers.
  `A001-23` and `a001-23` remain different identifiers. Accepted alternate
  values are 3–64 characters, begin with a letter or digit, contain a digit,
  and otherwise contain only letters, digits, spaces, dots, underscores,
  hyphens or slashes.
- Use text cells in spreadsheets for identifiers. Existing spreadsheet display
  formatting is preserved in identifier columns, but zeros already lost from
  both the underlying number and its display cannot be recovered.
- Blank values; N/A, none, null, unknown, not available, not applicable,
  pending, TBD, missing, dummy and test (case/separator insensitive);
  strings consisting only of X, `*`, `?`, `#` or hyphens; repeated-digit
  numeric values including all zeros; and unusable values require correction.
  These are explicit shared-placeholder rules, not an exhaustive fraud check.

## Create, update and conflicts

Create/upsert imports create a contact, a worker with **no SSN**, and the alternate
ID atomically when unmatched. Update-only imports report no match instead.
An alternate-ID match never overwrites or clears an existing valid SSN.

The same rules apply to shared SSN worker feeds, HTA, and Legal validation,
preview and processing. Local26 also retains Person Number matching. A submitted
placeholder never silently falls back to Person Number. Conflicting tax and
payroll matches, or contradictory rows sharing an identity, require correction
before those rows can write worker-dependent records.

## Correction workflow

1. Open the upload's existing validation errors. They identify the row and
   correction needed, without repeating the sensitive identifier.
2. Check the original source and worker IDs with appropriately authorized staff.
   Do not resolve a placeholder by guessing, a name-only match, or a merge.
3. Correct the source file, upload it again, and run validation. For Legal,
   review and approve the new estimate before processing.
4. Staff with SSN access (or administrators) can manage Alternate Tax IDs in the
   worker's existing IDs editor. The ID type itself is system-managed.
5. If a corrected valid SSN becomes available, enter it in the worker's SSN
   field. The existing alternate ID stays attached. A later **SSN-only** import
   cannot establish a link to an alternate-only worker; staff must establish
   that relationship on the correct worker first.

Alternate values are omitted from ordinary worker lists, searches and contact
exports. Audit snapshots, response previews, import errors, results files and
completion summaries do not repeat their raw values. Other alternate-ID types
retain their normal behavior.

There is no historical bulk conversion, fuzzy matching, automatic merge, new
review queue, or fallback matching added to the configurable ratings importer.
