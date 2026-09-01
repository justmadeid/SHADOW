# OSINT Industries Connector Plan

**Checked against provider documentation:** 2026-08-31

Official references:
- API search POST: https://docs.osint.industries/reference/search-1
- API keys: https://docs.osint.industries/docs/api-keys
- Credits: https://docs.osint.industries/docs/your-credits
- API Terms of Use: https://docs.osint.industries/page/terms-of-use
- API Security Policy: https://docs.osint.industries/page/tos

## Documented API shape

Provider-recommended endpoint:

```text
POST https://api.osint.industries/v2/request
```

Authentication header:

```text
api-key: <secret>
```

Documented input types:

```text
email
phone
username
name
wallet
```

The current Platform use case focuses on:

```text
email
phone
username
name
```

Documented request options include:
- `timeout`: default 60 seconds, documented minimum 25 and maximum 80;
- `exact_match`: especially relevant to name searches;
- `premium`;
- `premium_modules_only` on the POST endpoint.

The provider documentation states one search consumes one credit, with additional premium-module cost where applicable.

## Proposed platform capabilities

One connector can support multiple semantic capabilities:

```text
IDENTIFIER_ENRICHMENT(email)
IDENTIFIER_ENRICHMENT(phone)
IDENTIFIER_ENRICHMENT(username)
PERSON_DISCOVERY_BY_NAME
```

Do not create source-specific business Nodes such as `OSINTIndustriesEmailSearch` unless a provider-specific user experience is intentionally required.

## Credential handling

Environment/config reference only:

```text
OSINT_INDUSTRIES_API_KEY
```

Rules:
- connector worker only;
- never browser;
- never queue payload;
- never Outbox payload;
- never logs/traces;
- use secret manager in non-development environments;
- rotate immediately if exposed.

## Important contractual/data-retention gate

Current provider Terms of Use contain material constraints that must be reviewed before production integration. Among other things, the terms describe use for lawful internal OSINT research/investigation and include restrictions against creating permanent copies of API Data.

Therefore the default architecture policy is:

```text
rawResponsePersistence = DISABLED
```

and:

```text
normalizedDerivedPersistence = PENDING_LEGAL_AND_CONTRACT_REVIEW
```

Do not implement permanent raw response archival merely because the general Evidence architecture supports raw artifacts.

Before enabling production storage, record an ADR/data-source policy answering:

1. Is the intended organizational use permitted by the subscription/terms?
2. What API Data may be retained, if any?
3. Is a normalized Observation considered a permitted case-management record?
4. What attribution/provider notices are required?
5. What deletion/retention policy applies?
6. Can results be exported into reports?
7. Are commercial/internal-use restrictions compatible with the deployment?

## Request policy

Suggested safe defaults once implementation begins:

```text
method = POST
timeout = 60
exact_match = true for initial name lookup
premium = false by default
premium_modules_only = false
```

Premium usage should be an explicit connector configuration because it affects credits/cost.

## Result handling

Because provider results can aggregate multiple modules/sources, do not flatten everything directly into Person fields.

Preferred flow:

```text
OSINT Industries response
→ provider response schema validation
→ module/result normalization
→ SourceRecord metadata
→ Observation(s)
→ Candidate / Evidence processing
```

Each observation should preserve which provider module/source produced the value when available.

## Identity rule

```text
OSINT Industries returned value X for query Y
≠
X is canonical identity truth
```

For identity attribution:

```text
provider output
→ MatchingSignal / Candidate evidence
→ human or policy-governed Resolution
```

## Cost/credit observability

Connector metrics should eventually include:

```text
search_count
premium_search_count
credit_cost_when_available
provider_latency
provider_error
provider_timeout
empty_result
```

Do not use searched identifier values as metric labels.

## Testing

Use synthetic fixtures for contract tests.

Do not commit live API responses containing personal data.

A live smoke test, if required, must:
- use an approved non-sensitive test query/account;
- be opt-in;
- require the API key from environment/secret storage;
- never run automatically on untrusted PRs.
