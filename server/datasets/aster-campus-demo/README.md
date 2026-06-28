# Aster Medical Campus Demo Dataset

Synthetic dataset optimized for the EnergyOps Copilot product demo.

## Hero story

On 2026-06-03 from 15:00 to 19:00 UTC, a humid demand-response event exposes two
past decisions that were still influencing operations:

- DEC-2026-05-20-CHW-RESET raised chilled-water supply temperature from 7.0 C
  to 8.6 C. It saved energy in mild weather but had a 58 percent OR humidity
  rollback guardrail.
- DEC-2026-05-27-BESS-RESERVE held battery SOC above 88 percent after a relay
  nuisance trip. It was temporary and should have been released before demand
  response.

The interaction causes high OR humidity, low chiller COP, weak battery
discharge, and excess grid import. DEC-2026-06-04-ROLLBACK resolves the issue.

## Demo prompts

- What past decision influenced the June 3 operation?
- Show me why grid import spiked during the demand-response window.
- Did the chilled-water reset still make sense under humid conditions?
- Which prior decision should be recalled before acting on this insight?
