# Frameo Local

A small, local-first photo manager for Frameo frames. **One executable per
platform**, with a React interface embedded in a pure-Go backend. Open the binary,
and it opens your browser to a private loopback address. No Python, Node, Android,
cloud account or separate web server is needed at runtime.

## Download and use

Every push to `master` runs the [build workflow](.github/workflows/build.yml).
Open the repository's **Actions** tab, select a successful **Build binaries** run,
and download the artifact for your operating system and CPU. Each platform
artifact contains a single executable and its SHA-256 checksum.

| Platform | Executable |
|---|---|
| macOS, Apple Silicon | `frameo-local-darwin-arm64` |
| macOS, Intel | `frameo-local-darwin-amd64` |
| Windows, Intel/AMD | `frameo-local-windows-amd64.exe` |
| Windows, ARM | `frameo-local-windows-arm64.exe` |
| Linux, Intel/AMD | `frameo-local-linux-amd64` |
| Linux, ARM | `frameo-local-linux-arm64` |

Extract the artifact and run the executable. For example, on Apple Silicon:

```sh
chmod +x frameo-local-darwin-arm64
./frameo-local-darwin-arm64
```

The binary prints its URL and opens your default browser. Leave it running while
using the interface; press **Ctrl+C** in the terminal to quit. An OS/architecture
specific executable is required—one file cannot execute on every operating system.

Useful options:

```sh
./frameo-local-darwin-arm64 --no-open --port 8766
./frameo-local-darwin-arm64 --state /path/to/device.json
```

Windows builds have an `.exe` extension. Linux/macOS builds may need
`chmod +x <downloaded-file>` after downloading. On a fresh installation, use
**Connect a frame**, select the discovered frame, and enter its **Add friend**
code. Then request photo access and press **Allow on the physical frame**.

## Features

- Automatic IPv4 mDNS discovery, with manual address/port entry for pairing.
- Friend-code pairing and persistent sender identity.
- Frame-approved viewing/management permissions with a waiting state and cancel.
- Photo gallery, full-size preview, download, and all/slideshow/hidden filters.
- Date/type/ID search, multi-selection, hide/show, and confirmed deletion.
- Request display of a selected photo on the physical frame.
- Drag-and-drop JPEG/PNG/WebP uploads, captions and fit/crop choice.
- Browser-side EXIF orientation and scaling; WebP encoding in the browser or
  in pure Go when the browser sends PNG/JPEG. Originals stay intact.
- Sequential uploads with real frame acknowledgements and an activity panel.
- QR-code handoff from a phone, with previews, captions and delivery confirmation.
- Responsive layouts, keyboard-accessible dialogs and reduced-motion support.

The UI uses soft surfaces, generous spacing and typography for hierarchy, with
minimal dividing lines. Its assets and fonts are served locally; there are no
analytics or external image/font services.

The gallery header groups Activity, From phone and Add photos in one row. The
sidebar has one connect action, and technical information (including resolution)
is available in Connection details. Search focus follows the rounded field;
Activity can be dismissed by clicking outside it or pressing Escape.

### Send from your phone

1. Select a frame and click **From phone** (also available inside Add photos).
2. Scan the QR code using the phone's camera, or copy the link to the phone.
3. Choose photos, optionally add a caption, and tap **Send**.
4. The phone shows progress to the computer and onward to the frame. It reports
   success only when the frame acknowledges delivery. The desktop Activity panel
   shows the same transfers with a **Phone** label.

The phone and computer must be on the same local network. Keep the app running
and the phone page open during transfer. No mobile app installation or account is
needed. The browser uses WebP where supported. **iOS Safari's PNG/JPEG canvas
output is accepted and converted to lossless WebP by the Go app**, using a pure-Go
encoder with no external library or CGo requirement. There is also an image
decoding fallback for Safari. HEIC availability depends on the phone/browser's decoder or
the photo picker's conversion to JPEG.

Each link lasts **15 minutes**, accepts up to **100 photos**, and is scoped to
uploads to the selected frame. Closing the QR dialog keeps the link active;
**End phone session** revokes it and closes its listener. Already accepted jobs
can finish in the desktop app. A network chooser is available if the computer
has multiple local interfaces. Guest-network isolation, VPNs or a firewall may
prevent the phone from reaching the computer.

The phone receiver is a separate, upload-only HTTP server bound to one selected
private IPv4 interface on a temporary port. It starts only when requested and
stops on expiry, revocation, replacement or application shutdown. It does not
expose the desktop API, photo gallery, management commands or pairing keys.
The QR's random capability token is placed in the URL fragment and then sent in
authorization headers. Retries with the same per-photo upload ID reuse the
accepted job instead of enqueuing a duplicate. Only that session's job statuses
are returned to the phone.

**Transport detail:** the phone-to-computer hop uses local HTTP, not TLS. The
computer-to-frame hop uses the existing encrypted MDG connection. This feature
is intended for a trusted local Wi-Fi network, not an internet-facing deployment.

### Scope

This version works over the **local network**. Remote/cloud routing, full video
transfers, album editing and device settings are not implemented. Video entries
can appear with a frame-provided preview and can be selected for management.
The gallery requires protocol 13 or newer. Integration has been verified with protocol 18.
Pairing currently negotiates PACE v1.

“In slideshow” reflects the frame's visibility flag. The frame does not report
which exact photo is on screen through the recovered messages. **Display** sends
a request; unlike hide/delete, that command has no delivery acknowledgement.

Photo metadata is fetched from the frame. Downloads are the representation
available there, which may be resized/compressed compared with the camera original.
Previews are cached in memory (64 MB maximum), not written to a photo directory.

## Identity and local API

The application stores its private identity and paired-frame information here:

- macOS: `~/Library/Application Support/Frameo Local/device.json`
- Linux: `~/.config/frameo-local/device.json` (or `$XDG_CONFIG_HOME`)
- Windows: `%AppData%\frameo-local\device.json`

Retain this file to retain your pairing. It contains a private key and is created
with owner-only permissions where supported. One process holds the identity
lock at a time; close the app before running another instance with the same store.
The API never returns the private key.

The desktop management server binds **127.0.0.1 only**. It validates Host/Origin and rejects cross-site
requests. Mutation endpoints require the per-run `X-Frameo-Token` returned by
`GET /api/bootstrap`. The token is intended for this local UI or local automation.

| Endpoint | Purpose |
|---|---|
| `GET /api/bootstrap` | Session token, sender name and saved frames |
| `GET /api/discover` | Scan for local frames |
| `POST /api/pair` | Pair with `{service, code, name}`; returns a job |
| `GET /api/frames` | Saved frames, without private credentials |
| `GET /api/frames/{peer}/info` | Live frame info and permissions |
| `POST /api/frames/{peer}/permissions` | Request access with `{manage:true}` |
| `GET /api/frames/{peer}/media` | Live media metadata |
| `GET /api/frames/{peer}/media/{id}` | 400px preview |
| `GET /api/frames/{peer}/media/{id}?full=1&download=1` | Download frame image |
| `POST /api/frames/{peer}/actions` | `{action:"hide"|"show"|"delete"|"display", ids:["..."]}` |
| `POST /api/frames/{peer}/upload` | Multipart `photo` (WebP/PNG/JPEG), `caption`, `fit`, `captured` |
| `GET /api/jobs` | Progress and results; successful uploads include `media_id` |
| `DELETE /api/jobs/{id}` | Cancel a queued/in-progress job |
| `POST /api/frames/{peer}/phone` | Create/reuse phone session; `{renew:true,host:"…"}` optionally replaces it |
| `GET /api/phone` | Current QR session, expiry and connection state |
| `DELETE /api/phone` | Revoke the phone link and stop its listener |

The phone port separately exposes `/phone`, static assets, and bearer-authenticated
`GET /phone-api/session`, `GET /phone-api/jobs`, `POST /phone-api/upload`.
Phone uploads additionally require a 32-hex-character `X-Upload-ID`.

**Media IDs are signed 64-bit decimal strings**, never JavaScript numbers. Each
frame's operations are serialized to avoid interleaving image transfers.
Cancelling an in-flight upload closes the connection; it cannot retract a photo
the frame has already accepted.

## Build

Build-time requirements: Go 1.26+, Node.js 20.19+/22.12+ and npm.

```sh
make build       # frontend + native host binary
make release     # six OS/architecture binaries and SHA256SUMS
```

Targets: macOS, Linux and Windows, each for amd64 and arm64. `CGO_ENABLED=0` means
the binaries do not depend on a system libsodium, Python, Node, or Android library.
The React bundle and 279 public frame-certificate issuer keys are embedded with
`go:embed`. No private identity or photos are included in release binaries.

The GitHub workflow builds the frontend, runs Go and browser tests, then
cross-compiles all six executables in parallel. It can also be started manually
from the Actions tab. CI uses synthetic fixtures and does not require a physical
frame, pairing code, or repository secrets.

To rebuild without Make:

```sh
cd web
npm ci
npm run build
cd ..
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o dist/frameo-local ./cmd/frameo
```

## Verification

```sh
make test                      # Go tests, including race detector
cd web
npx playwright install chromium
npm test                       # browser tests with mocked frame responses
```

Playwright starts an isolated application instance on `127.0.0.1:18766` with a
test identity stored in the ignored `test-results` directory. Set `FRAMEO_URL`
to use an already-running test instance, or `CHROME_PATH` to use an installed
Chromium-based browser instead of Playwright's bundled browser.

The automated checks cover:

- PACE calculations against 20 synthetic native-reference vectors.
- Signed protobuf fields, authentication, replay detection and malformed input.
- Identity persistence, locking and local API access boundaries.
- Discovery/pairing forms, permissions, filtering and deletion confirmation.
- Exact 64-bit media IDs, keyboard dialogs and responsive layouts.
- QR links, expiry, scoped upload access and retry deduplication.
- Safari's canvas PNG fallback and lossless conversion to WebP in Go.

The image fixtures are procedurally generated and contain no personal photos or
metadata. To regenerate them from the repository root:

```sh
go run ./scripts/testimage
```

### Optional live integration checks

These checks require a running application and a paired test frame with photo
management permission. They use the first paired frame and upload/delete only
their own synthetic test image. Set `FRAMEO_URL` to choose an application instance.

```sh
node scripts/live-check.mjs
cd web
node live-ui.mjs
node live-phone.mjs
```

Use `BROWSER=webkit` with `live-phone.mjs` after installing Playwright WebKit to
exercise Safari's engine. Test output and screenshots remain in the ignored
`test-results` directory. The application and these checks are self-contained;
no external research workspace or Android binary is required.

Network transfers, image management and the phone handoff have been verified
with a physical frame on macOS. Other platform builds still benefit from
on-device runtime testing, particularly discovery and firewall behavior.

## Protocol notes

Recovered and confirmed from the original v1.40.5 DEX:

| Message | ID |
|---|---:|
| Frame info request / response / client info | 1 / 2 / 3 |
| Media metadata / segments / receipt | 4 / 5 / 6 |
| Get a media item | 23 |
| Permission request | 27 |
| Multipart envelope | 30 |
| List media metadata / response | 31 / 32 |
| Change visibility | 33 |
| Delete media | 34 |
| Jump to media | 35 |

Media IDs, capture/receive dates, content IDs and multipart IDs are **sint64**
(ZigZag), while receipt IDs are ordinary int64. Media IDs may be negative and are
represented as strings in the JSON API to preserve all 64 bits in JavaScript.

Code map: `internal/protocol` (MDG/PACE/protobuf), `internal/device` (identity,
discovery, serialized connections), `internal/server` (REST/jobs/cache), `web/src`
(React UI).
