# Degrees of Lewdity Plus — no-storage / localStorage fallback

Modified DoL+ (v0.778 HTML-only) so the game can start on devices where localStorage/sessionStorage is null or blocked.

## Changes
- Early storage polyfill (in-memory stub if real storage is unavailable)
- `updateSettings` hardened so a null localStorage cannot abort startup

## Usage
Open index.html (or the versioned HTML) in a browser. On devices with no storage, saves last only for the session — use Export / Copy Text Area to keep them.

Source game: Degrees of Lewdity Plus by Frostberg.
