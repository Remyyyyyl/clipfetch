# Third-party components

ClipFetch does not commit or bundle third-party binaries in this repository. At runtime it downloads them from their official GitHub releases into the user's local app data directory.

| Component | Source | License |
| --- | --- | --- |
| yt-dlp | https://github.com/yt-dlp/yt-dlp-nightly-builds | Unlicense; the official PyInstaller-bundled Windows executable is GPLv3+ because it includes GPLv3+ code |
| FFmpeg / FFprobe | https://github.com/yt-dlp/FFmpeg-Builds (`ffmpeg-master-latest-win64-gpl.zip`) | GPLv3+ build |
| Deno | https://github.com/denoland/deno | MIT |
| Tauri | https://tauri.app | MIT or Apache-2.0 |
| React | https://react.dev | MIT |

If you redistribute an installer that pre-bundles these binaries, you are responsible for complying with their licenses, including providing the corresponding source code and notices where required. This document is not legal advice.
