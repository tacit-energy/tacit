# Anonymized EnergyOps Copilot Dataset

This folder is an anonymized copy of the live EnergyOps export. The raw export is kept separately for internal comparison.

Anonymization performed:

- remapped sensor IDs, device IDs, diagram IDs, node IDs, edge IDs, and external references
- replaced sensor and diagram labels with generic semantic labels
- preserved energy/medium categories, units, cumulative flags, topology structure, and joins
- preserved source metadata semantics while rewriting and pseudonymizing source area/location/tag values
- added conservative location roles and role-based location groups where source location text is classifiable
- removed import provenance and metadata timestamps
- shifted timestamps to a synthetic time window
- scaled meter values by medium-specific factors to preserve trends without exposing raw magnitudes
- regenerated graph text from anonymized diagrams

Do not use this folder to recover the original source identifiers. Keep raw and anonymized datasets separate when sharing externally.
