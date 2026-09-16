package server

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"mime/multipart"
	"net/http/httptest"
	"testing"
)

func TestSafariPNGAndJPEGUploadsBecomeDecodableWebP(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 31, 19))
	for y := 0; y < 19; y++ {
		for x := 0; x < 31; x++ {
			img.SetNRGBA(x, y, color.NRGBA{uint8(x * 7), uint8(y * 11), uint8(x + y), 255})
		}
	}
	for _, format := range []string{"png", "jpeg"} {
		t.Run(format, func(t *testing.T) {
			var original bytes.Buffer
			if format == "png" {
				png.Encode(&original, img)
			} else {
				jpeg.Encode(&original, img, &jpeg.Options{Quality: 90})
			}
			var body bytes.Buffer
			form := multipart.NewWriter(&body)
			part, _ := form.CreateFormFile("photo", "safari-photo."+format)
			part.Write(original.Bytes())
			form.Close()
			r := httptest.NewRequest("POST", "http://localhost/upload", &body)
			r.Header.Set("Content-Type", form.FormDataContentType())
			input, e := readUpload(httptest.NewRecorder(), r)
			if e != nil {
				t.Fatal(e)
			}
			if input.format != format {
				t.Fatal("incorrect input format")
			}
			converted, e := ensureWebP(input.data, input.format)
			if e != nil {
				t.Fatal(e)
			}
			decoded, kind, e := image.Decode(bytes.NewReader(converted))
			if e != nil || kind != "webp" || decoded.Bounds() != img.Bounds() {
				t.Fatal("invalid converted image", kind, e)
			}
			if format == "png" {
				for y := 0; y < 19; y++ {
					for x := 0; x < 31; x++ {
						if color.NRGBAModel.Convert(decoded.At(x, y)) != img.NRGBAAt(x, y) {
							t.Fatal("lossless conversion changed a pixel")
						}
					}
				}
			}
		})
	}
}
