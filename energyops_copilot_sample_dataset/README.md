# EnergyOps Copilot Sample Dataset

This is a generated, non-production sample for hackathon work. It contains one
fictional cooling scenario with a small topology and hourly measurements.

## Scenario

- Scenario: `north_branch_spike`
- Window: `2026-06-08` for 21 days
- Hero day: `2026-06-24`
- Hero window: `05:00` to `08:00` UTC
- Narrative: Early-morning excess cooling demand appears on the north branch, driven mainly by the critical zone. The south branch remains close to the expected profile.

## Files

- `manifest.json`: dataset metadata and scenario notes
- `sensors.csv`: one row per synthetic sensor
- `sensor_data_hourly.csv`: hourly actual and expected values
- `sensor_attributes.csv`: small semantic attributes for each sensor
- `sensor_external_refs.csv`: stable fake external references
- `diagrams/cooling_trace.json`: topology graph
- `diagrams/cooling_trace_graph.txt`: readable topology summary

`sensor_data_hourly.value` is an hourly value, not a cumulative meter reading.
