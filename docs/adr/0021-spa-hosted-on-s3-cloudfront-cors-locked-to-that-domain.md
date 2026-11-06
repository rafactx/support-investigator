---
status: accepted
---

# The SPA deploys to S3 + CloudFront; the API's CORS is locked to that domain

`ADR-0016` deferred this exact configuration, since nothing had scoped S3/CloudFront and there was no CloudFront domain yet to lock CORS to. An independent code review named the resulting gap directly: the evidence-timeline SPA was never deployed anywhere, so the demo requirements (a live AWS URL to open during the demo, and an audience that watches the investigation unfold) only held for the API, not the UI — the live demo's UI portion was reduced to a raw `curl` call.

`SupportInvestigatorStack` now provisions a private `S3::Bucket` (all public access blocked) fronted by a `CloudFront::Distribution` reached only through Origin Access Control — the same "no public Function URL, no open door" posture the rest of this stack already holds for the Lambdas. `web/dist` (built with `VITE_API_URL` set to this stack's own, already-known API Gateway domain — the API isn't being replaced, so its domain is stable across an incremental `cdk deploy`, not a genuine circular dependency) uploads via `BucketDeployment` on every deploy, with a CloudFront cache invalidation so a stale build is never served. `HttpApi`'s `corsPreflight` now allows exactly `https://<this-distribution's-own-domain>`, `POST`, and the two headers the SPA actually sends (`content-type`, `x-demo-key`) — built from the distribution's own CDK token, not a value copied in by hand, so it can never point at a stale or wrong domain.
