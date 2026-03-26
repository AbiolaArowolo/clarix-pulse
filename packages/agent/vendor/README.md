# Vendor Files For One-Click Node Bundles

Place the Windows helper binaries for node packaging in this folder before running
`build-node-bundle.ps1`.

Required:

- `nssm.exe`

Recommended for every node bundle, even when UDP starts disabled:

- `ffmpeg.exe`
- `ffprobe.exe`

Recommended workflow:

1. Build `packages/agent/dist/clarix-agent.exe`
2. Place vendor binaries in `packages/agent/vendor/`
3. Run `packages/agent/build-node-bundle.ps1`
4. Copy the generated bundle to the target node
5. Double-click `install.bat` as Administrator

Keeping `ffmpeg.exe` and `ffprobe.exe` in every bundle lets the operator turn UDP inputs on later
from `configure.bat` without having to rebuild or re-copy the node package.
