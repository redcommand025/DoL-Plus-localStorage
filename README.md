# Degrees of Lewdity Plus — image version with no-storage fallback

DoL+ v0.778 Vanilla (full image pack) patched so the game can start when localStorage/sessionStorage is null or blocked.

## Changes
- Early storage polyfill (in-memory stub if real storage is unavailable)
- `updateSettings` hardened so a null localStorage cannot abort startup
- **Hunger & Thirst bars** (hunger-thirst.js) — new always-on need bars that rise over time, show in the stat meters, and can be reduced by eating/drinking

## Usage
Open index.html. Images live in the `img/` folder next to it.
On devices with no storage, saves last only for the session — use Export / Copy Text Area to keep them.

Source: Degrees of Lewdity Plus by Frostberg (Vanilla image pack).
