# V6 AI Dataset Provenance Quickstart

This quickstart shows the first V6 dataset provenance workflows: create local
dataset inventory and revision receipts without uploading raw dataset files to
Proveria.

## 1. Configure the CLI

```bash
proveria config set \
  --api-url http://127.0.0.1:3001 \
  --workspace evaluation-workspace \
  --api-key prv_v1_replace_me
```

## 2. Create Or Choose A Project

```bash
proveria projects create ai-dataset-provenance \
  --name "AI Dataset Provenance" \
  --visibility private
```

## 3. Collect A Dataset Inventory

```bash
proveria dataset collect ./dataset \
  --output ./dataset-inventory.json \
  --name "Training Dataset" \
  --version 2026.06 \
  --classification confidential \
  --source-owner "Data Governance" \
  --license-usage-basis "Internal governed dataset approval." \
  --retention-rule "7 years"
```

The CLI recursively hashes files under `./dataset`, sorts paths
deterministically, computes a dataset root hash, and writes a
`dataset_inventory_record`.

Raw dataset bytes stay local.

## 4. Inspect The Inventory

```bash
proveria dataset inspect ./dataset-inventory.json
```

Confirm:

- `record_type` is `dataset_inventory_record`;
- `files` and `total_bytes` match the local folder;
- `dataset_root_hash` is present;
- `canonical_hash` is present.

## 5. Submit The Receipt

```bash
proveria dataset attest ./dataset-inventory.json \
  --project ai-dataset-provenance \
  --name "Training Dataset 2026.06 inventory"
```

The public API receives the canonical inventory hash and summary metadata. It
does not receive raw dataset files.

## 6. Create A Revision Receipt

Collect a second inventory for the next dataset version:

```bash
proveria dataset collect ./dataset-next \
  --output ./dataset-inventory-next.json \
  --name "Training Dataset" \
  --version 2026.07 \
  --classification confidential \
  --source-owner "Data Governance" \
  --license-usage-basis "Internal governed dataset approval." \
  --retention-rule "7 years"
```

Compare the two inventories:

```bash
proveria dataset revision \
  --base ./dataset-inventory.json \
  --next ./dataset-inventory-next.json \
  --output ./dataset-revision.json
```

Inspect the revision summary:

```bash
proveria dataset inspect ./dataset-revision.json
```

Confirm:

- `record_type` is `dataset_revision_record`;
- `new_files`, `changed_files`, `removed_files`, and `unchanged_files` are
  present;
- `previous_dataset_root_hash`, `next_dataset_root_hash`, and
  `revision_root_hash` are present;
- `canonical_hash` is present.

Submit the revision receipt:

```bash
proveria dataset attest ./dataset-revision.json \
  --project ai-dataset-provenance \
  --name "Training Dataset 2026.06 to 2026.07 revision"
```

## 7. Retrieve The Record And Receipt

```bash
proveria records get <attestation-id>
proveria receipt <attestation-id>
```

After validation, the receipt proves the inventory record that was committed:
dataset name, version, file count, total bytes, dataset root hash, and
classification metadata. A revision receipt proves the committed change set
between two inventory root hashes.

## Privacy Boundary

Stored by Proveria:

- canonical dataset inventory hash;
- dataset root hash;
- revision root hash and revision change counts;
- file count and total byte count;
- dataset source metadata supplied in the attestation request;
- receipt and event metadata.

Not uploaded by this workflow:

- raw dataset files;
- dataset file contents;
- model weights or training artifacts.
