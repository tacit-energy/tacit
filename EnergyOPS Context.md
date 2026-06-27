We are building an **EnergyOps Copilot** for a hackathon. The goal is to help operators of complex technical energy systems — such as large campuses, hospitals, factories, airports, or district heating networks — understand their systems, make better operational decisions from sensor data, and **learn from past decisions** so that both operators and the AI improve over time.

The first focus is **system understanding**. The copilot should combine **time-series data, metadata, and system topology** to reconstruct an understandable view of the selected subsystem: which sensors belong together, what each part likely represents, how energy flows through the system, which units/media are involved, and where the data may be incomplete or inconsistent.

System understanding is not just a static explanation. Complex real-world topologies — with hundreds of sensors, redundant paths, and incomplete documentation — should be **simplified by the agent** into views the operator can actually reason about: key components, dominant flow paths, likely bottlenecks, and the sensors that matter most for the current question. The agent should be able to zoom in on a subsystem, collapse irrelevant detail, and highlight what is known vs. inferred vs. missing.

We have access to a real anonymized campus-energy dataset with around **2,000 sensor streams over four weeks**, including metadata such as energy type, medium, unit, location category, and partial topology. For demos, use only a safe representative subset.

## Understanding agent and widgets

The **understanding agent** is the first step in the workflow. Rather than returning only text, it should assemble **widgets** that make the system tangible:

- **Simplified topology views** — reduced graphs of the selected subsystem, with components grouped or collapsed where appropriate
- **State summaries** — current operating mode, key setpoints, on/off or load states, and notable deviations from normal
- **Charts and traces** — time-series for the most relevant sensors, aligned to the topology or insight being discussed
- **Data-quality and anomaly highlights** — gaps, stale sensors, inconsistent units, or signals that do not match expected relationships

The operator should also have a **text input (or similar capture)** to add explanations, corrections, or **planned decisions** — for example: “Pump P3 was manually overridden yesterday,” “We are switching to summer cooling mode next week,” or “Check valve V12 before acting on this alert.” These notes are inserted as **agent memory** and carried into the next step, so later analysis and recommendations build on operator knowledge rather than starting from scratch.

We can also imagine a **visualization refinement agent**: the user points at an existing widget (topology, chart, summary) and asks for changes — “show only the cooling loop,” “add return temperature for these three nodes,” “group by building wing” — and the agent updates that view without rebuilding the entire analysis from zero.

## Intended workflow

1. User selects a subsystem or topology area.
2. The understanding agent explains the system in human language and assembles the relevant widgets.
3. It identifies relevant sensors and relationships, including a simplified topology where the full graph would be overwhelming.
4. It creates an understandable system view from the available data.
5. It detects suspicious patterns, data-quality issues, or unusual operating behavior.
6. The operator adds context, corrections, or planned decisions; this becomes memory for subsequent steps.
7. It generates practical **insight cards** for the operator.
8. Over time, **past decisions and outcomes** (what was tried, what worked, what was rejected and why) feed back into the copilot so recommendations and explanations get sharper.

The insight cards should answer questions like: What should be checked? Is this likely a data-quality issue? Which signal is unusual? What operational decision should come next? Have we seen a similar situation before, and what did we do then?

## Human-AI loop and learning from decisions

A key part is the **human-AI loop**: the operator can add context the model does not know, such as maintenance, known sensor defects, manual overrides, special operation, or intended next actions. That context should be stored and used to improve the next analysis.

The second strategic focus is **decision memory and learning**. Operators in large facilities rarely make one-off choices; they iterate, compare options, and rely on experience. The copilot should support that by:

- Recording **decisions and rationale** — what the operator chose, why, and under what system conditions
- Linking decisions to **sensor context and topology state** at the time, so similar situations can be retrieved later
- Surfacing **prior outcomes** when new anomalies or choices appear — not as rigid automation, but as reviewable precedent
- Letting the AI refine its understanding when the operator confirms or rejects a recommendation

Together, this turns the copilot from a one-shot analyzer into a system that **accumulates operational knowledge** — human judgment plus machine pattern-finding — across shifts, maintenance events, and seasons.

The positioning is not “generic chat with data.” It is a topology-aware AI copilot that first makes complex energy systems understandable through explorable widgets and simplified views, then turns that understanding into reviewable operational insights, better decisions, and **learning from what was decided before**. The impact argument is that in large technical facilities, even a small operational improvement, such as 3%, can mean hundreds of thousands of euros per year — and compounding that with institutional memory reduces repeated mistakes and shortens time-to-action.
