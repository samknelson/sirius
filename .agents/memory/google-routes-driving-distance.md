---
name: Google Routes API for driving distance
description: How/why driving-distance eligibility uses Google Routes with a haversine fallback and the shared Maps key.
---

# Google Routes API for driving distance

The Start Healthnet geographic eligibility criterion measures worker↔facility
distance with real driving distance (Google Routes API, `directions/v2:computeRoutes`,
`X-Goog-Api-Key` + `X-Goog-FieldMask: routes.distanceMeters`, meters/1609.344),
falling back to straight-line haversine (`shared/utils/geocode.distanceInMiles`).

Rules to keep consistent:
- **No new secret.** Resolve the Maps key through
  `addressValidationService.getGoogleMapsApiKey()`, which honors the config-driven
  `google.apiKeyName` (default `GOOGLE_MAPS_API_KEY`). Do NOT read a fresh env var.
- **External calls live in a service**, not the plugin body — `server/services/driving-distance.ts`.
- **Fail soft, never throw.** Any error/quota/timeout/no-route/no-key returns
  `{ status: "unavailable" }` so the caller falls back to haversine. Eligibility must
  never break because routing is down.
- **Reason text must name the method** ("driving distance" vs "straight-line distance")
  in every branch, since methods can differ per site within one run.

**Why:** straight-line underestimates real travel distance, wrongly treating
road-far workers as "close". Requirement was driving distance with an automatic,
clearly-labeled fallback — never a hard failure and never a user toggle.
