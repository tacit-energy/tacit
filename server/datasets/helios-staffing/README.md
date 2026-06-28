# Helios Logistics — DC Rhein-Main (staffing)

Generated from the track1 warehouse-staffing dataset for the EnergyOps Copilot.
Adapted to the sensor-timeseries shape so all tool features apply: each "sensor"
is a daily metric.

## Series (sensor_data_hourly.csv — daily)
- **950001 Operative staffing need (realized)** — value = realized operative
  person-days, expected_value = optimiser-planned operative total. The plan
  error (deviation_pct) is the core anomaly signal.
- **950002 Total on-site staffing** — includes the constant 8 admin desks.
- **950010/11/12 Volume drivers** — picks / outbound / inbound pallets,
  value = realized, expected_value = forecast.
- **9511xx / 9512xx** — per-activity planned person-days (operative / admin).

## Scoring (cost_model.csv / manifest.cost_model)
Excess cost vs. a perfect plan: overstaffing 230 EUR/surplus
person-day; understaffing the 18% overtime premium PLUS
600 EUR/person-day beyond a 2
tolerance. A small deliberate undershoot beats a safe overshoot — until the tolerance.

## Operator knowledge (annotations.json)
Seeded from the planners' decision log. **Deliberately messy and unverified** —
some notes are durable, some superstition, some stale, some contradictory.
Treat them as claims, not facts.
