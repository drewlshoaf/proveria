# V6 Model-Card Provenance Attachment

This example shows how to attach verifiable provenance to a model card without
turning the model card into a dump of private evidence. The attachment points
to receipts, hashes, policy decisions, and audit packages that can be verified
separately.

Use the sample attachment at
`docs/examples/model-card-provenance-attachment.json` as the starting point.

## Attachment Goal

A model-card provenance attachment should answer:

- Which model card and model version does this describe?
- Which model release receipt commits the release claim?
- Which dataset inventory and revision receipts support the training-data
  section?
- Which evaluation, risk, policy, and approval evidence was reviewed?
- Which audit packages, if any, are related to this model release?
- Which fields are public and which remain private behind scoped access?

## Producer Workflow

1. Complete or update the model card.

   Hash the model card file locally:

   ```bash
   proveria hash ./model-card.md
   ```

2. Create the model release provenance record.

   ```bash
   proveria model-release init --output ./model-release.json
   ```

   Fill the release record with:

   - `artifacts.model_card_hash` from the model card hash;
   - `data_provenance.dataset_manifest_hash` or the relevant dataset inventory
     hash;
   - `evaluation.evaluation_report_hash`;
   - `evaluation.risk_review_hash` if production or regulated use applies;
   - policy and approval fields.

3. Attest the model release record.

   ```bash
   proveria model-release attest ./model-release.json \
     --project ai-dataset-provenance \
     --name "Graduation Model 2026.06 release"
   ```

4. Add the related dataset receipts.

   Reference the inventory and revision receipts that support the model card's
   training-data section:

   - training inventory receipt;
   - evaluation inventory receipt, if separate;
   - dataset revision receipt;
   - licensed-content audit package, if the release includes rights-holder
     review.

5. Fill `docs/examples/model-card-provenance-attachment.json` with real
   attestation IDs, receipt links, hashes, policy decisions, and disclosure
   settings.

6. Hash the completed attachment and store that hash in the model card,
   model-release record, or compliance evidence package.

   ```bash
   proveria hash ./model-card-provenance-attachment.json
   ```

## Model Card Language

Add a short provenance section to the model card:

```md
## Provenance

This model card is accompanied by a Proveria provenance attachment. The
attachment references the model release receipt, training dataset inventory
receipt, dataset revision receipt, evaluation evidence hashes, and any
licensed-content audit packages associated with this release.
```

For public model cards, avoid embedding private evidence directly. Link to the
public receipt pages and describe how auditors can request scoped evidence
access.

## Public Review Path

A public reviewer should be able to verify:

- the model release receipt exists and matches the named model version;
- the model card hash in the release record matches the published card;
- dataset inventory and revision receipt links resolve;
- policy decision and approval metadata are present;
- private evidence is clearly marked as private.

## Private Auditor Path

A private auditor may additionally receive:

- scoped verifier access to receipt or lookup pages;
- evidence export bundles;
- redacted evaluation and risk reports;
- licensed-content audit packages;
- approval records.

## Privacy Boundary

Public by default:

- model name, version, type, and release stage;
- model release receipt link;
- dataset receipt labels and links;
- policy ID, policy version, and policy decision;
- hash references for model card, evaluation report, and approval record.

Private unless separately disclosed:

- raw training data;
- licensed source documents;
- complete risk review;
- full evaluation report;
- model weights and internal deployment details.

## Acceptance Checks

- The attachment references a model release receipt.
- The attachment references at least one dataset inventory receipt.
- The attachment references a dataset revision receipt when the model card
  discusses a dataset update.
- The attachment includes evaluation, policy, and approval evidence hashes.
- The attachment states public and private fields clearly.
- The completed attachment is hashed and referenced from the model card or
  model release record.
