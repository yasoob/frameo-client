// Generate the synthetic fixtures used by the optional live transfer checks.
package main

import (
	"image"
	"image/color"
	"image/png"
	"log"
	"os"
	"path/filepath"

	"github.com/HugoSmits86/nativewebp"
	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
)

func main() {
	dir := filepath.Join("internal", "server", "testdata")
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Fatal(err)
	}
	img := image.NewRGBA(image.Rect(0, 0, 640, 400))
	for y := 0; y < 400; y++ {
		for x := 0; x < 640; x++ {
			img.SetRGBA(x, y, color.RGBA{uint8(40 + x*110/640), uint8(60 + y*110/400), uint8(120 + (x/32+y/32)%2*45), 255})
		}
	}
	d := font.Drawer{Dst: img, Src: image.NewUniform(color.White), Face: basicfont.Face7x13, Dot: fixed.P(28, 45)}
	d.DrawString("Frameo Local - synthetic transfer test")
	for _, ext := range []string{"png", "webp"} {
		f, err := os.Create(filepath.Join(dir, "transfer."+ext))
		if err != nil {
			log.Fatal(err)
		}
		if ext == "png" {
			err = png.Encode(f, img)
		} else {
			err = nativewebp.Encode(f, img, nil)
		}
		closeErr := f.Close()
		if err != nil {
			log.Fatal(err)
		}
		if closeErr != nil {
			log.Fatal(closeErr)
		}
	}
}
