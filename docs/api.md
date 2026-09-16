# Local API reference

Frameo Local provides a desktop API and a separate phone upload API.
The app communicates with the frame through encrypted MDG protocol messages.

For setup, see [Get started](../README.md#get-started).

## Desktop API

The desktop server listens only on `127.0.0.1`.
Use the URL printed in the app's terminal. To use a fixed port, start the app
with `--port`.

The server validates the request host and origin. It rejects cross-site requests.

### Authenticate requests

1. Request `GET /api/bootstrap`.
2. Read the `token` value from the response.
3. For requests that change state, send the token in the `X-Frameo-Token` header.

The token changes when the app restarts. It does not contain the private pairing key.

### Frames and pairing

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/bootstrap` | Get the session token, sender name, and saved frames. |
| `GET` | `/api/discover` | Discover frames on the local network. |
| `GET` | `/api/frames` | List saved frames. |
| `POST` | `/api/pair` | Pair with a frame. |
| `GET` | `/api/frames/{peer}/info` | Get current frame information and permissions. |
| `POST` | `/api/frames/{peer}/permissions` | Request photo access. |

Replace `{peer}` with a frame's full public-key identifier from `/api/frames`.

Pairing requests contain `service`, `code`, and `name` fields.
Use a service object from discovery and a current friend code from the frame.
The `name` field identifies the sender on the frame.

For viewing and management access, send this permission request body:

```json
{
  "manage": true
}
```

The frame owner must approve the request on the frame.
To request viewing access only, set `manage` to `false`.

### Photos

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/frames/{peer}/media` | List current media metadata. |
| `GET` | `/api/frames/{peer}/media/{id}` | Get a preview with requested dimensions of 400 × 400 pixels. |
| `POST` | `/api/frames/{peer}/actions` | Show, hide, delete, or display selected media. |
| `POST` | `/api/frames/{peer}/upload` | Upload a photo. |

Replace `{id}` with a media ID from the metadata response.
A media item can be a photo, video, or greeting.

For the frame's full-size copy, add `?full=1` to the media URL.
For a file download, add `?full=1&download=1`.

**Media IDs are signed 64-bit decimal strings.** Do not convert them to JavaScript
numbers. Negative IDs are valid.

To hide selected media, send an action request like this:

```json
{
  "action": "hide",
  "ids": ["42"]
}
```

Supported actions are `hide`, `show`, `delete`, and `display`.
`display` accepts one ID. Other actions accept up to 1,000 IDs.
Management permission is required.

Photo uploads use `multipart/form-data`:

| Field | Description |
| --- | --- |
| `photo` | Required JPEG, PNG, or WebP file. Maximum size: 32 MiB. Maximum pixel count: 50 million. |
| `caption` | Optional caption. |
| `fit` | Set to `true` to show the whole photo. Otherwise, request a centered crop. |
| `captured` | Optional nonnegative timestamp, in milliseconds since the Unix epoch. The default is the current time. |

Prepare photo orientation and size before uploading through the API.
The browser interface performs these steps automatically.
The server converts JPEG and PNG files to WebP before transfer.

### Transfer jobs

Pairing, permission requests, photo actions, and uploads return a job.
Read the job state to determine when the operation ends.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/jobs` | List job progress and results. |
| `DELETE` | `/api/jobs/{id}` | Request cancellation of a job. |

Job states are `running`, `succeeded`, `failed`, and `cancelled`.
Successful uploads include a `media_id`.

Upload success requires a receipt from the frame.
The `display` action sends a request without a receipt.
Cancellation cannot remove a photo that the frame has already accepted.

### Phone sessions

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/frames/{peer}/phone` | Create or reuse a phone upload session. |
| `GET` | `/api/phone` | Get the active phone link, expiry time, and connection state. |
| `DELETE` | `/api/phone` | End the phone session and close its listener. |

Send `{}` to create or reuse a session.
Set `renew` to `true` to replace it.
The optional `host` field selects a local IPv4 interface.

## Phone upload API

The app starts a separate HTTP listener when the user requests a phone link.
It binds to one private IPv4 interface on a temporary port.
The listener stops when the session expires or ends.

The phone link contains a random token in its URL fragment.
Send it as `Authorization: Bearer TOKEN` to authenticate phone API requests.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/phone-api/session` | Get the selected frame's name, dimensions, and session expiry. |
| `GET` | `/phone-api/jobs` | Get jobs submitted through this phone session. |
| `POST` | `/phone-api/upload` | Upload a photo to the selected frame. |

Uploads use the same multipart fields as the desktop API.
Each upload also requires an `X-Upload-ID` header with 32 hexadecimal characters.
Reuse the upload ID when retrying an interrupted request. The server returns the
existing job instead of adding a duplicate.

Each session lasts 15 minutes and accepts up to 100 photos.
The phone API does not expose pairing keys, gallery content, or management commands.
This connection uses HTTP without TLS. Use it on a trusted local network.

## Frame protocol reference

The following message IDs come from the Android v1.40.5 protocol.
The local API handles their encoding and encrypted transport.

| Message | ID |
| --- | --- |
| Request frame information | 1 |
| Return frame information | 2 |
| Send client information | 3 |
| Send media metadata | 4 |
| Send media data segment | 5 |
| Return receipt | 6 |
| Get media item | 23 |
| Request permission | 27 |
| Send multipart message | 30 |
| Request media metadata list | 31 |
| Return media metadata list | 32 |
| Change media visibility | 33 |
| Delete media | 34 |
| Display selected media | 35 |

Media IDs, capture dates, receive dates, content IDs, and multipart IDs use
protobuf `sint64` with ZigZag encoding. Receipt IDs use ordinary `int64` encoding.
The app processes each frame's operations in sequence to keep media transfers separate.
