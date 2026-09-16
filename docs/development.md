# Build and test Frameo Local

This guide covers source builds, automated tests, and executable distribution.
For normal use, see [Get started](../README.md#get-started).

## Requirements

Install these tools before building:

- Go 1.26 or later.
- Node.js 20.19 or later in version 20, or Node.js 22.12 or later.
- npm.
- Make and a POSIX shell, if you use the Makefile.

Downloaded executables do not require these tools.

## Build an executable

From the repository root, build for the current operating system and processor:

```sh
make build
```

The command builds the frontend and writes `dist/frameo-local`.

To build all supported targets:

```sh
make release
```

This command writes six executables and `SHA256SUMS` to `dist/`.
The targets are macOS, Windows, and Linux, each for `amd64` and `arm64`.

### Build without Make

These commands use a POSIX shell.

1. Build the browser interface:

   ```sh
   cd web
   npm ci
   npm run build
   ```

2. Return to the repository root:

   ```sh
   cd ..
   ```

3. Build the executable:

   ```sh
   CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o dist/frameo-local ./cmd/frameo
   ```

The frontend build writes files to `internal/server/ui/`.
Build these files before compiling or testing the Go server.

## Run automated tests

The tests use synthetic data. They do not require a physical frame or pairing code.

1. From the repository root, build the frontend and run the Go tests:

   ```sh
   make test
   ```

2. Check the Go source:

   ```sh
   go vet ./...
   ```

3. Install the browser used for testing:

   ```sh
   cd web
   npx playwright install chromium
   ```

4. Run the browser tests:

   ```sh
   npm test
   ```

Playwright starts a separate app instance on `127.0.0.1:18766`.
It stores the test identity in the ignored `test-results` directory.

| Variable | Purpose |
| --- | --- |
| `FRAMEO_URL` | Use an existing app instance instead of starting the test server. |
| `CHROME_PATH` | Use an installed Chromium-based browser. |

The tests check:

- PACE pairing calculations against 20 synthetic reference vectors.
- Signed protobuf fields and authentication failures.
- Replay detection and malformed input.
- Identity storage and file locking.
- Local API access restrictions.
- Pairing forms, permissions, photo filters, and deletion confirmation.
- Keyboard interaction and layouts at different screen sizes.
- Phone link expiry, upload retries, and access restrictions.
- Safari image conversion and lossless PNG-to-WebP conversion.

## Run live integration checks

These checks require a running app and a paired test frame with management permission.
They use the first paired frame. Each check uploads and deletes its own synthetic
test photo.

From the repository root:

```sh
node scripts/live-check.mjs
```

For browser and phone checks, use the `web` directory:

```sh
cd web
node live-ui.mjs
node live-phone.mjs
```

Set `FRAMEO_URL` to select another app instance.
To test Safari's engine, install Playwright WebKit and set `BROWSER=webkit`:

```sh
npx playwright install webkit
BROWSER=webkit node live-phone.mjs
```

Test output and screenshots stay in the ignored `test-results` directory.
To regenerate the synthetic image files, use the repository root:

```sh
go run ./scripts/testimage
```

Automated builds cover macOS, Windows, and Linux.
Live frame checks cover macOS.

## Capture documentation screenshots

From the `web` directory, generate the screenshots used in the user guide:

```sh
npm run screenshots
```

The script uses synthetic device data and stock images. It does not connect to a real frame.
See [capture instructions and image sources](screenshots/README.md).

## Continuous integration

The [build workflow](../.github/workflows/build.yml) runs on pushes to `master`
and tags that start with `v`. You can also start it from the **Actions** tab.

The workflow:

1. Builds the frontend.
2. Runs Go checks, race detection, and browser tests.
3. Builds all six executable targets in parallel.
4. Verifies the binary checksums and publishes the release assets.

CI uses synthetic data. Publishing uses the built-in GitHub token; no custom
repository secrets are required. Only the publishing job has `contents: write`.

### Development releases

A successful build of the current `master` commit updates the `development` tag
and the **Latest development build** prerelease. The download URLs stay the same.
Retries of older commits do not replace a newer development build.

The release stays in draft while its files are updated. It is published after
all six binaries, their checksum files, and `SHA256SUMS` have been uploaded.
A failed upload leaves a draft that the next run can resume.

The development tag and assets are intentionally mutable. Repository release
immutability must allow updates to this channel.

### Versioned releases

To publish a fixed version, push a version tag. Replace `v0.2.2` with the version
you want to publish.

1. Tag the release commit:

   ```sh
   git tag -a v0.2.2 -m "Release v0.2.2"
   ```

2. Push the tag:

   ```sh
   git push origin v0.2.2
   ```

The workflow publishes a release for that tag after all checks and builds pass.
Tags such as `v0.3.0-rc.1` produce prereleases. Stable version tags are eligible
for GitHub's **Latest** release link; the development channel is not.

Published versioned releases are not overwritten on reruns. Use a new version
tag for changed files. Release notes compare with the previous versioned release,
when available.

CI embeds the version tag in the executable. Development builds report
`development-` followed by the commit's short SHA.

To test the publishing logic without calling GitHub:

```sh
node --test scripts/publish-release.test.mjs
```

## Source layout

| Directory | Responsibility |
| --- | --- |
| `cmd/frameo` | Command-line entry point and server startup. |
| `internal/protocol` | MDG transport, PACE pairing, and protobuf messages. |
| `internal/device` | Identity storage, discovery, and connection management. |
| `internal/server` | HTTP APIs, transfer jobs, photo conversion, and caching. |
| `web/src` | React interface for the desktop and phone. |
| `scripts` | Executable builds and integration checks. |

The build embeds the frontend and public certificate issuer keys with `go:embed`.
`CGO_ENABLED=0` removes the need for system C libraries at runtime.
The executable does not contain a private identity or user photos.
