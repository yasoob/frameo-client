# Documentation screenshots

These images show the app with synthetic frame data and stock photos.
They do not contain user photos, real device identifiers, or active phone links.

| Screenshot | Content |
| --- | --- |
| [Gallery](gallery.png) | Desktop gallery with photo selection and management controls. |
| [Phone transfer](phone-transfer.png) | Desktop QR dialog and phone photo selection page. |

## Regenerate the screenshots

Install the [development tools](../development.md#requirements) first.
From the `web` directory:

```sh
npm ci
npx playwright install chromium
npm run screenshots
```

Set `CHROME_PATH` to use an installed Chromium-based browser.
The capture script needs network access to download the stock images.

The [capture script](../../web/scripts/screenshots.mjs):

1. Starts an isolated app instance with a separate test identity.
2. Replaces API responses with synthetic frame data.
3. Blocks requests to real frames and unapproved external URLs.
4. Replaces photo URLs in the DOM with the stock image URLs.
5. Checks the displayed photos and device links before capture.
6. Saves the screenshots in this directory.

The phone screenshot uses a reserved documentation address and a dummy token.
Its QR code cannot access a live upload session.

## Stock image sources

Stock photography is provided by [Unsplash](https://unsplash.com/).
See the [Unsplash license](https://unsplash.com/license).
Only the app screenshots are included here; source photo files are not stored in the repository.

- [Mountain lake](https://images.unsplash.com/photo-1470770841072-f978cf4d019e)
- [Beach](https://images.unsplash.com/photo-1507525428034-b723cf961d3e)
- [Forest](https://images.unsplash.com/photo-1441974231531-c6227db76b6e)
- [Mountain landscape](https://images.unsplash.com/photo-1464822759023-fed622ff2c3b)
- [Desert road](https://images.unsplash.com/photo-1500530855697-b586d89ba3ee)
- [Lakeside scenery](https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1)
- [Ocean waves](https://images.unsplash.com/photo-1518837695005-2083093ee35b)
- [Mountains under the stars](https://images.unsplash.com/photo-1519681393784-d120267933ba)
