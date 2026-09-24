---
name: Template editor engine compatibility
description: Why Template Studio retains its HTML editing boundary despite evaluating structured editors.
---

Do not convert stored email/postal templates to a structured editor until a representative nested-table fixture proves that imported CSS, token-bearing attributes, image properties, page breaks, and source/visual switching survive import, edits, export, and reopening.

**Why:** An isolated browser probe of default Tiptap and Lexical integrations lost supported formatting and page-break information; Lexical also altered token-bearing links. Their permissive licenses and extensibility do not make default schema serialization lossless. Converting existing templates silently would change delivered content.

**How to apply:** Keep shared template normalization as the authoring/delivery contract. If revisiting the editing engine, add custom nodes/attributes and rerun the complete fixture before replacing the active path; the assessment is documented in the repository.