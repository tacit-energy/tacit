# EnergyOps Copilot Sample Dataset

This is a generated, non-production sample for hackathon work. It contains the
fake `UKHD Demo - Kälte Trace` scenario with topology and hourly measurements.

## Scenario

- Scenario: `campus_cooling_branch_spike`
- Window: `2026-06-08` for 45 days
- Hero day: `2026-07-18`
- Hero window: `05:00` to `08:00` UTC
- Narrative: Frühmorgendlicher Mehrverbrauch im INF-Netz. Im Detail zeigt sich die Abweichung vor allem in der Chirurgischen Klinik.

## Files

- `manifest.json`: dataset metadata and scenario notes
- `sensors.csv`: one row per synthetic sensor
- `sensor_data_hourly.csv`: hourly values using the same core columns as the live export
- `sensor_attributes.csv`: flexible key/value metadata using the same columns as the live export
- `sensor_external_refs.csv`: stable fake external references
- `diagrams/cooling_trace.json`: topology graph
- `diagrams/cooling_trace_graph.txt`: readable topology summary

This sample is fake and intentionally not anonymized. Energy meter signals use
cumulative `kWh` readings so consumption can be calculated by differencing
consecutive values. The outside temperature reference is non-cumulative.

`sensor_data_hourly.csv` includes `expected_value`, `deviation_pct`, and
`scenario_event`. For cumulative meters, `expected_value` is also cumulative;
compare hourly deltas of `value` and `expected_value`. The expected baseline is
a synthetic no-spike counterfactual: it equals the measured stream except on the
injected cooling-spike path around `2026-07-18 05:00` to `08:00` UTC.
