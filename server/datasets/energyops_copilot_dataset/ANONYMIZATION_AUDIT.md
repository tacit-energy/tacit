# Live Dataset Anonymization Audit

This audit describes where the live export still contains source-specific or potentially identifying information. It intentionally avoids listing real source values.

## Summary

The current live export is **not ready to share outside the trusted team**.

The highest-risk data is not the hourly time-series table. The highest-risk data is:

- diagram labels and descriptions
- source tag names and source tag numbers
- external source references
- dynamic sensor attribute values
- optional reference asset names/content if local helper assets are exported
- exact timestamps and absolute cumulative meter magnitudes

The app-level building table has already been abstracted away. Physical building/location context now lives in sensor attributes.

## File-Level Risk

| File / Area | Risk | Why |
| --- | --- | --- |
| `sensor_attributes.csv` | High | Contains source tag IDs, source tag names, source building/location codes, raw imported values, and source-specific metadata. |
| `sensor_external_refs.csv` | High | Contains source namespace, external IDs, external keys, and labels from the source system. |
| `diagrams/*.json` | High | Node labels, descriptions, meter IDs, and some edge metadata reveal source topology names and meter/source codes. |
| `diagrams/*_graph.txt` | High | Text edge lists repeat diagram labels and descriptions in a prompt-friendly form. |
| `sensors.csv` | Medium | Sensor IDs, sensor names, device ID, and creation timestamps remain source-system derived. Units and energy types are generally safe. |
| `sensor_data_hourly.csv` | Medium | No text labels, but exact timestamps, internal sensor IDs, absolute values, and cumulative-meter behavior can reveal operational scale/patterns. |
| `manifest.json` | Medium | Contains diagram IDs, time window, selection policy details, meter-code lists, and source-derived keyword hints. |
| `README.md` | Low | Structural documentation only; keep it generic. |

## Column-Level Findings

### `sensors.csv`

Keep as useful modeling context:

- `unit`
- `irregular`
- `cumulative`
- `energy_type`
- `protected`

Anonymize or transform:

- `sensor_id`: remap to stable pseudonymous IDs.
- `name`: replace source tag names with generated semantic labels.
- `device_id`: remove or remap.
- `created_at`: remove or shift/generalize.

### `sensor_external_refs.csv`

This file should not be shared raw.

Anonymize or transform:

- `sensor_id`: use the same pseudonymous mapping as `sensors.csv`.
- `source`: replace with a generic source namespace.
- `external_id`: replace with generated external IDs.
- `external_key`: replace with generated external keys.
- `label`: regenerate from anonymized sensor labels.
- `source_import_id`: remove unless needed for provenance.
- `created_at`, `updated_at`: remove or shift/generalize.

### `sensor_attributes.csv`

This is the most important metadata table and the most sensitive table.

Keep or normalize:

- source unit attributes can usually be retained after review.
- energy/medium category can be mapped to generic categories.
- numeric scaling factor can usually be retained or normalized if needed.

Anonymize or transform:

- `namespace`: replace source/customer namespace with a generic namespace.
- `sensor_id`: use the same pseudonymous mapping as `sensors.csv`.
- source tag identity keys and values: replace with generated tag IDs.
- source tag name keys and values: replace with generated semantic labels.
- source building/location keys and values: replace with stable pseudonyms, for example `site_area_001` or `location_group_001`.
- `raw_value`: either regenerate from anonymized values or drop if not needed.
- `source_import_id`: remove unless needed for internal provenance.
- `updated_at`: remove or shift/generalize.

Important: if a source building/location attribute is used to group sensors, preserve grouping consistency while changing the actual values.

### `sensor_data_hourly.csv`

No direct text identifiers were found, but the table still needs privacy treatment.

Anonymize or transform:

- `sensor_id`: use the same pseudonymous mapping as all metadata files.
- `timestamp`: shift all timestamps by one fixed offset, or replace with relative time such as `t+0000h`.
- `value`: optionally scale by a fixed per-medium or per-sensor factor if absolute magnitude is sensitive.
- `sample_count`: can usually be retained.

Additional data-quality note:

- Some selected streams are cumulative meters.
- Some streams have decreasing steps, negative values, or large jumps.
- These may be real data-quality issues, rollovers/resets, or source artifacts. Preserve enough behavior for the copilot demo, but avoid exposing exact raw magnitudes if sharing externally.

### `diagrams/*.json`

Anonymize or transform:

- diagram `name`: replace with generic subsystem names.
- node `data.label`: replace with generated semantic labels.
- node `data.description`: regenerate or drop.
- node `data.meterId`: remove or replace with generated meter IDs.
- node `data.nodeId`: remove if source-derived, or replace with generated node IDs.
- edge descriptions/labels: regenerate or drop if source-specific.

Preserve:

- topology structure: nodes, edges, source/target relationships.
- visual positions if they are needed for UI/demo rendering.
- generic node types and edge types.

### `diagrams/*_graph.txt`

These files are derived from diagram JSON. Do not anonymize them independently.

Recommended approach:

1. anonymize diagram JSON
2. regenerate graph text from anonymized diagrams

### Optional `reference_assets/*`

These are not part of the normal shareable export. They are useful internally but risky if exported with the optional local-assets flag.

Recommended approach:

- Keep `reference_assets/` out of the shareable anonymized dataset unless each file is regenerated from anonymized diagrams/mappings.
- If kept, rename files to generic names and strip source labels, source meter IDs, source descriptions, and source node mappings.

### `manifest.json`

Anonymize or remove:

- source connection/provenance string labels
- raw diagram IDs if they are source-system identifiers
- raw meter-code lists
- source-derived keyword lists
- exact time window if timestamps are shifted

Keep:

- row counts
- file list
- high-level selection policy in generic language

## Recommended Anonymized Dataset Contract

Target output should preserve the current structure:

```text
manifest.json
README.md
diagrams/
  diagram_001.json
  diagram_001_graph.txt
sensors.csv
sensor_attributes.csv
sensor_external_refs.csv
sensor_data_hourly.csv
```

Do not include:

- `buildings.json`
- PDFs/documents
- raw optional `reference_assets/`
- source-specific mapping files

## Suggested Pseudonymization Rules

Use deterministic mappings so joins remain valid:

| Original concept | Pseudonym |
| --- | --- |
| `sensor_id` | `sensor_0001`, `sensor_0002`, ... |
| `device_id` | `device_0001`, `device_0002`, ... |
| diagram ID | `diagram_001`, `diagram_002`, ... |
| node ID | keep local stable IDs or remap to `node_0001`, ... |
| external source | `source_system_a` |
| external IDs/keys | `ext_0001`, `key_0001`, ... |
| source building/location values | `site_area_001`, `site_area_002`, ... |
| source tag labels | generated semantic labels such as `Chilled water branch meter 01` |
| timestamps | relative hours or fixed shifted timestamps |
| energy values | scaled values, preserving trends and anomalies |

## Priority Order

1. Keep optional `reference_assets/` out of the shareable export unless regenerated from anonymized data.
2. Pseudonymize all IDs across all CSV/JSON files.
3. Replace diagram labels/descriptions and regenerate graph text.
4. Replace sensor names, external refs, and source attribute values.
5. Shift timestamps and optionally scale values.
6. Rewrite manifest selection metadata in generic terms.
7. Re-run a text scan for source names, source codes, and location hints.
