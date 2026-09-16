package server

import (
	"bytes"
	"errors"
	"fmt"
	"image"

	"github.com/HugoSmits86/nativewebp"
)

// Browsers prepare orientation/size; browsers without a canvas WebP encoder
// (notably iOS Safari) send PNG or JPEG. This conversion is pure Go/CGo-free.
func ensureWebP(data []byte, format string) ([]byte, error) {
	if format == "webp" {
		return data, nil
	}
	if format != "png" && format != "jpeg" {
		return nil, errors.New("unsupported photo format")
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("could not decode photo: %w", err)
	}
	var output bytes.Buffer
	if err = nativewebp.Encode(&output, img, nil); err != nil {
		return nil, fmt.Errorf("could not convert photo: %w", err)
	}
	if output.Len() > 32<<20 {
		return nil, errors.New("converted photo exceeds 32 MB; choose a smaller photo")
	}
	return output.Bytes(), nil
}
