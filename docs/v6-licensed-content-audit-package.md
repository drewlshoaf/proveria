# V6 Licensed-Content Audit Package

This example shows how to package a rights-holder or publisher review without
turning Proveria into a raw-content disclosure system. The producer commits
dataset inventory and revision receipts, grants a verifier scoped access, then
shares only the receipts, selected lookup results, and an evidence export.

Use the sample package at
`docs/examples/licensed-content-audit-package.json` as the starting point.

## Package Goal

The audit package should answer five questions:

- Which dataset versions were reviewed?
- Which inventory and revision receipts prove the committed state?
- Which licensed or prohibited works were sampled?
- What match or no-match verification result was produced for each sample?
- What evidence can the rights-holder inspect without receiving the full
  private corpus?

## Producer Workflow

1. Create an inventory receipt for the prior dataset version.

   ```bash
   proveria dataset collect ./dataset-2026-06 \
     --output ./dataset-2026-06.json \
     --name "Training Dataset" \
     --version 2026.06 \
     --classification confidential \
     --source-owner "Data Governance" \
     --license-usage-basis "Licensed and internally governed training data." \
     --retention-rule "7 years"

   proveria dataset attest ./dataset-2026-06.json \
     --project ai-dataset-provenance \
     --name "Training Dataset 2026.06 inventory"
   ```

2. Create an inventory receipt for the current dataset version.

   ```bash
   proveria dataset collect ./dataset-2026-07 \
     --output ./dataset-2026-07.json \
     --name "Training Dataset" \
     --version 2026.07 \
     --classification confidential \
     --source-owner "Data Governance" \
     --license-usage-basis "Licensed and internally governed training data." \
     --retention-rule "7 years"

   proveria dataset attest ./dataset-2026-07.json \
     --project ai-dataset-provenance \
     --name "Training Dataset 2026.07 inventory"
   ```

3. Create and attest the revision record.

   ```bash
   proveria dataset revision \
     --base ./dataset-2026-06.json \
     --next ./dataset-2026-07.json \
     --output ./dataset-revision-2026-06-to-2026-07.json

   proveria dataset inspect ./dataset-revision-2026-06-to-2026-07.json

   proveria dataset attest ./dataset-revision-2026-06-to-2026-07.json \
     --project ai-dataset-provenance \
     --name "Training Dataset 2026.06 to 2026.07 revision"
   ```

4. Grant the publisher or auditor private verifier access to the relevant
   inventory or revision attestation.

   ```bash
   proveria access grant <attestation-id> publisher-audit@example-newswire.test \
     --message "Scoped access for NEWSWIRE-TRAINING-2026-Q2 audit."
   ```

5. Ask the rights-holder to submit a small agreed sample of hashes or passages.
   Each lookup produces a signed result package and a public result link that
   can be referenced from the package.

6. Export the evidence for the audit scope.

   ```bash
   proveria export collect \
     --limit 100 \
     --output ./tmp-licensed-content-audit \
     --zip ./tmp-licensed-content-audit.zip \
     --tar ./tmp-licensed-content-audit.tar
   ```

7. Fill `docs/examples/licensed-content-audit-package.json` with the real
   attestation IDs, receipt links, export job ID, lookup package IDs, and any
   agreed redactions.

## Rights-Holder Review Path

The rights-holder should receive:

- the completed audit package JSON;
- public receipt links for the inventory and revision attestations;
- public result links for sampled match and no-match lookups;
- an evidence export bundle if the producer agreed to disclose it.

The rights-holder should not need raw corpus access for the basic receipt and
sample-verification review.

## Privacy Boundary

Stored or shared by default:

- canonical inventory and revision hashes;
- dataset root and revision root hashes;
- summary counts;
- selected verification result packages;
- receipt, event, and evidence export metadata.

Kept private unless separately disclosed:

- raw dataset files;
- complete licensed source documents;
- full path inventories when paths reveal sensitive source information;
- model weights, training logs, and internal review notes.

## Acceptance Checks

- The package references at least one previous inventory receipt, one current
  inventory receipt, and one revision receipt.
- The revision receipt distinguishes new, changed, removed, and unchanged
  records.
- At least one sampled licensed-content lookup is represented.
- At least one sampled prohibited-content no-match lookup is represented when
  the audit includes exclusion claims.
- The disclosure section states what the producer is and is not sharing.
