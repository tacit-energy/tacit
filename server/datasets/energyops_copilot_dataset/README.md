# EnergyOps Copilot Dataset Structure

This dataset is an anonymization-ready full source export for prototyping a topology-aware energy operations copilot. It combines system topology, sensor metadata, external sensor identifiers, flexible source attributes, and hourly time-series values.

The dataset intentionally does **not** expose the source application's `Building` table. In this export, the app-level building row is only an internal database container used by the exporter. Physical building, area, location, or subsystem information is represented as sensor metadata in `sensor_attributes.csv`.

This README describes the data shape without real site names, real sensor labels, meter codes, or sample values.

## Purpose

The dataset supports workflows where an operator selects a technical subsystem and the copilot:

1. Explains the system in human language.
2. Identifies which sensors belong together.
3. Relates sensors to topology and subsystem diagrams.
4. Reviews sensor behavior over time.
5. Produces operator-facing insight cards.

## File Overview

| File | Format | Purpose |
| --- | --- | --- |
| `manifest.json` | JSON | Export metadata, counts, time window, and included file paths. |
| `diagrams/*.json` | JSON | Topology/diagram exports with nodes and edges. |
| `diagrams/*_graph.txt` | Text | LLM-friendly edge-list representation of each diagram. |
| `sensors.csv` | CSV | Core sensor records for the exported source population. |
| `sensor_external_refs.csv` | CSV | Mapping from internal sensor IDs to external source-system identifiers. |
| `sensor_attributes.csv` | CSV | Flexible key/value metadata for each sensor. |
| `sensor_data_hourly.csv` | CSV | Hourly aggregated time-series values for selected sensors. |
| `location_mapping_review.csv` | CSV | Internal raw-to-anonymized review table for source location (`lage`) values. Do not share externally. |

PDFs, original documents, local reference assets, and app-level building records are intentionally not included.

## Conceptual Model

The export has four main entity types:

| Entity | Source File | Main ID |
| --- | --- | --- |
| Diagram | `diagrams/*.json` | `id` |
| Diagram node/edge | inside each diagram JSON | node `id`, edge `id` |
| Sensor | `sensors.csv` | `sensor_id` |
| Sensor reading | `sensor_data_hourly.csv` | `sensor_id` + `timestamp` |

The most important join key is `sensor_id`.

## Relationships

```text
sensors.csv
  sensor_id
  |
  +--> sensor_data_hourly.csv
  |
  +--> sensor_attributes.csv
  |
  +--> sensor_external_refs.csv

diagrams/*.json
  nodes + edges describe topology
  sensors are matched through labels, external references, and metadata
```

Diagram nodes may contain labels, descriptions, and visual layout information. Sensors are connected to topology indirectly through metadata, external references, meter codes, labels, and domain-specific matching logic. Do not assume every diagram node has exactly one sensor or every sensor appears in a diagram.

## Core Files

### `manifest.json`

Export-level metadata.

Important fields:

| Field | Meaning |
| --- | --- |
| `created_at_utc` | Export time. |
| `source` | Source mode, for example database export or generated sample. |
| `diagram_ids` | Diagram identifiers included in the export. |
| `time_window` | Time range for exported sensor data. |
| `counts` | Row/file counts for quick validation. |
| `selection_policy` | Notes about whether the export is a full dataset or a representative subset. |
| `files` | Relative file paths included in the dataset. |

The manifest should not contain source app building IDs.

### `diagrams/*.json`

Each diagram contains:

| Field | Meaning |
| --- | --- |
| `id` | Diagram ID. |
| `name` | Diagram name. Should be anonymized if it reveals a site or subsystem. |
| `type` | Diagram type, for example topology or process diagram. |
| `nodes` | ReactFlow-style node array. |
| `edges` | ReactFlow-style edge array. |

Common node fields:

| Field | Meaning |
| --- | --- |
| `id` | Node ID within the diagram. |
| `type` | Visual/component type. |
| `position` | UI position. |
| `data.label` | Human-readable node label. Should be anonymized. |
| `data.description` | Optional node description. Should be anonymized/reviewed. |

Common edge fields:

| Field | Meaning |
| --- | --- |
| `id` | Edge ID within the diagram. |
| `source` | Source node ID. |
| `target` | Target node ID. |
| `data.description` | Optional connection description. |

### `diagrams/*_graph.txt`

Text representation of diagram edges. This is useful for LLM prompts because it is easier to parse than the full visual JSON.

Shape:

```text
Node A -> Node B
Node B -> Node C [optional edge description]
```

These files should be regenerated or anonymized after node labels are anonymized.

### `sensors.csv`

Core operational sensor table.

| Column | Meaning |
| --- | --- |
| `sensor_id` | Internal sensor ID. Primary join key. |
| `name` | Sensor display name. Must be anonymized. |
| `device_id` | Optional device/controller ID. |
| `unit` | Measurement unit, for example energy or temperature units. |
| `irregular` | Whether the stream is treated as irregular/non-standard in the app. |
| `cumulative` | Whether values are cumulative meter readings. |
| `energy_type` | Energy/medium category, such as heat, cold, electricity, gas, water, or unknown. |
| `source_type` | Source-system category, if available. |
| `protected` | Whether the sensor is protected from normal edits. |
| `created_at` | Source-system creation timestamp. |

Physical building, source location, and subsystem metadata should be read from `sensor_attributes.csv`, not from this file.

### `sensor_external_refs.csv`

Links internal sensors to source-system identities.

| Column | Meaning |
| --- | --- |
| `sensor_id` | Internal sensor ID. |
| `source` | External source namespace/system. |
| `external_id` | External stable identifier. Must be anonymized. |
| `external_key` | Optional external key. Must be anonymized if present. |
| `label` | Source-system label. Must be anonymized if present. |
| `source_import_id` | Import batch reference. |
| `created_at`, `updated_at` | Metadata timestamps. |

### `sensor_attributes.csv`

Flexible metadata table. This is where source-specific metadata lives without adding source-specific columns to `sensors.csv`.

Each row is one attribute value for one sensor.

| Column | Meaning |
| --- | --- |
| `sensor_id` | Internal sensor ID. |
| `namespace` | Attribute namespace. |
| `key` | Attribute key. |
| `label` | Human-readable attribute label. |
| `data_type` | Expected value type: text, number, date, or bool. |
| `value_text` | Normalized text value. |
| `value_number` | Normalized numeric value. |
| `value_date` | Normalized date value. |
| `value_bool` | Normalized boolean value. |
| `raw_value` | Original imported value. Must be reviewed/anonymized. |
| `validation_status` | Whether parsing/normalization succeeded. |
| `validation_message` | Optional parsing warning. |
| `source_import_id` | Import batch reference. |
| `updated_at` | Last metadata update timestamp. |

Expected metadata categories include source tag identity, source tag name, source building/location code, source location category, medium/energy type, unit, and scaling factor. Treat all raw/source label fields as sensitive until anonymized.

### `location_mapping_review.csv`

Internal review table for anonymizing source `lage` values. It is generated during anonymization and intentionally contains raw location text.

| Column | Meaning |
| --- | --- |
| `raw_lage` | Original source location string. Sensitive; do not share externally. |
| `count` | Number of sensors using this source location string. |
| `anonymized_location_group` | Proposed anonymized group, such as `heating_plant_001`. |
| `location_role` | Conservative semantic category, such as `heating_plant`, `technical_center`, or `transformer_station`. |
| `review_status` | Whether the role was automatically mapped or still needs manual review. |

The anonymized dataset contains only `location_mapping_summary.csv`, not raw `raw_lage` values.

### `sensor_data_hourly.csv`

Hourly aggregated time-series table.

| Column | Meaning |
| --- | --- |
| `sensor_id` | Internal sensor ID. |
| `timestamp` | Hour bucket timestamp. |
| `value` | Hourly average of source values in that hour. |
| `sample_count` | Number of raw samples represented by the hourly aggregate. |

Important: for cumulative sensors, `value` is still the average cumulative meter reading in that hour. Consumption/production per hour should be calculated by sorting by `sensor_id`, then `timestamp`, and taking the difference between consecutive values. Negative or extreme differences should be treated as possible resets, rollovers, data-quality issues, or source anomalies.

## Recommended Use In The Copilot

Use the files in this order:

1. Load `manifest.json` to understand scope, counts, and time range.
2. Load available `diagrams/*.json`.
3. Use `diagrams/*_graph.txt` as the initial topology context for LLM reasoning.
4. Load `sensors.csv`, then enrich sensors with `sensor_attributes.csv` and `sensor_external_refs.csv`.
5. Load `sensor_data_hourly.csv` only for selected sensors/subsystems.
6. Generate insight cards from topology context plus sensor behavior.

## Anonymization Checklist

Before sharing outside the trusted team, anonymize or review:

| Area | Action |
| --- | --- |
| Diagram names and labels | Replace site-specific names with stable pseudonyms. |
| Sensor names | Replace source tag names with synthetic but meaningful labels. |
| External references | Hash or replace source-system IDs and keys. |
| Attribute raw values | Review all `raw_value` and `value_text` fields for names, locations, and source identifiers. |
| Source building/location attributes | Replace source building codes and location categories with stable pseudonyms. |
| Timestamps | Consider shifting all timestamps by a fixed offset while preserving intervals. |
| Meter values | Consider scaling energy values by fixed per-medium factors if absolute magnitudes are sensitive. |
| IDs | Optionally remap `diagram_id`, `sensor_id`, and `device_id` to sequential pseudonymous IDs. |

Preserve internal consistency when anonymizing. If a sensor ID is remapped in `sensors.csv`, the same mapping must be applied to `sensor_data_hourly.csv`, `sensor_attributes.csv`, and `sensor_external_refs.csv`.

## Notes For Analysis

- Not every sensor has complete metadata.
- Not every diagram node maps cleanly to one sensor.
- Some sensors are cumulative meters; others may be instantaneous measurements.
- Units and media should be read from both `sensors.csv` and `sensor_attributes.csv`.
- Source building/location context should be read from `sensor_attributes.csv`.
- `sample_count` is useful for spotting sparse or missing data.
- Topology should be treated as partial context, not a guaranteed complete physical model.
