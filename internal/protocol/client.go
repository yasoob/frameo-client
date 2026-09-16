package protocol

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"strconv"
	"time"
)

type Permissions struct {
	SharePairing bool `json:"share_pairing"`
	Backup       bool `json:"backup"`
	View         bool `json:"view_photos"`
	Manage       bool `json:"manage_photos"`
}
type Info struct {
	Name        string      `json:"name"`
	Placement   string      `json:"placement"`
	Width       int         `json:"width"`
	Height      int         `json:"height"`
	Version     uint32      `json:"protocol_version"`
	Permissions Permissions `json:"permissions"`
}
type Media struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Visible  bool   `json:"visible"`
	Captured int64  `json:"captured"`
	Received int64  `json:"received"`
}
type Download struct {
	Bytes     []byte
	Extension string
	Caption   string
}
type Client struct {
	T                           *Transport
	Name                        string
	Info                        Info
	multipart                   []byte
	partID, partSize, partIndex uint64
}

func NewClient(t *Transport, name string) *Client { return &Client{T: t, Name: name} }
func (c *Client) send(kind uint32, b []byte) error {
	message := Envelope(kind, b)
	if len(message) <= 16416 {
		return c.T.Send(message)
	}
	id := nextID()
	for offset, index := 0, uint64(0); offset < len(message); index++ {
		end := min(offset+16316, len(message))
		part := Join(Sint(1, int64(id)), Uint(2, uint64(len(message))), Uint(3, index), Blob(4, message[offset:end]))
		if e := c.T.Send(Envelope(30, part)); e != nil {
			return e
		}
		offset = end
	}
	return nil
}
func nextID() uint64 {
	var b [8]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic(e)
	}
	return binary.BigEndian.Uint64(b[:])&0x7fffffffffffffff | 1
}
func (c *Client) receive(deadline time.Time) (uint32, Fields, error) {
	for {
		b, e := c.T.Receive(deadline)
		if e != nil {
			return 0, nil, e
		}
		version, kind, body, e := Unenvelope(b)
		if e != nil {
			return 0, nil, e
		}
		f, e := Parse(body)
		if e != nil {
			return 0, nil, e
		}
		if kind == 30 {
			id, size, index := f.Uint(1), f.Uint(2), f.Uint(3)
			if size < 8 || size > 32<<20 {
				return 0, nil, errors.New("invalid multipart size")
			}
			if index == 0 {
				c.multipart = nil
				c.partID = id
				c.partSize = size
				c.partIndex = 0
			}
			if id != c.partID || size != c.partSize || index != c.partIndex {
				return 0, nil, errors.New("out-of-order multipart segment")
			}
			c.multipart = append(c.multipart, f.Blob(4)...)
			c.partIndex++
			if uint64(len(c.multipart)) > size {
				return 0, nil, errors.New("multipart overflow")
			}
			if uint64(len(c.multipart)) < size {
				continue
			}
			version, kind, body, e = Unenvelope(c.multipart)
			if e != nil {
				return 0, nil, e
			}
			f, e = Parse(body)
			c.multipart = nil
			if e != nil {
				return 0, nil, e
			}
		}
		if kind == 1 {
			if e = c.send(3, Text(1, c.Name)); e != nil {
				return 0, nil, e
			}
		}
		if kind == 2 {
			c.Info = Info{Name: f.Text(1), Placement: f.Text(2), Width: int(f.Uint(3)), Height: int(f.Uint(4)), Version: version, Permissions: Permissions{f.Uint(5) != 0, f.Uint(6) != 0, f.Uint(8) != 0, f.Uint(9) != 0}}
		}
		if kind == 10 && f.Uint(16) != 0 {
			if e = c.send(6, Uint(1, f.Uint(16))); e != nil {
				return 0, nil, e
			}
		}
		return kind, f, nil
	}
}
func (c *Client) GetInfo() (Info, error) {
	if e := c.send(1, nil); e != nil {
		return Info{}, e
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		kind, _, e := c.receive(deadline)
		if e != nil {
			return Info{}, e
		}
		if kind == 2 {
			return c.Info, nil
		}
	}
}
func frameError(f Fields, field int) error {
	if !f.Has(field) {
		return nil
	}
	x, e := Parse(f.Blob(field))
	if e != nil {
		return e
	}
	code := x.Uint(1)
	names := map[uint64]string{0: "unspecified error", 1: "unauthorized", 2: "frame error", 3: "bad request", 4: "operation failed", 5: "permission required on the frame", 6: "photo no longer exists", 7: "frame could not send this photo", 8: "not found", 9: "request declined", 12: "frame limit reached"}
	s := names[code]
	if s == "" {
		s = "unknown error"
	}
	return fmt.Errorf("%s (frame code %d)", s, code)
}
func (c *Client) List() ([]Media, error) {
	if !c.Info.Permissions.View {
		return nil, errors.New("photo access has not been granted; request permission on the frame")
	}
	if c.Info.Version < 13 {
		return nil, errors.New("update the frame firmware to use this media gallery")
	}
	if e := c.send(31, nil); e != nil {
		return nil, e
	}
	deadline := time.Now().Add(30 * time.Second)
	for {
		kind, f, e := c.receive(deadline)
		if e != nil {
			return nil, e
		}
		if kind != 32 {
			continue
		}
		if e = frameError(f, 2); e != nil {
			return nil, e
		}
		result := make([]Media, 0, len(f[1]))
		for _, v := range f[1] {
			item, e := Parse(v.Bytes)
			if e != nil {
				return nil, e
			}
			types := []string{"photo", "video", "greeting"}
			typ := "unknown"
			if item.Uint(2) < 3 {
				typ = types[item.Uint(2)]
			}
			result = append(result, Media{strconv.FormatInt(item.Sint(1), 10), typ, item.Uint(3) != 0, item.Sint(4), item.Sint(5)})
		}
		return result, nil
	}
}
func (c *Client) Download(id int64, size int) (Download, error) {
	if !c.Info.Permissions.View {
		return Download{}, errors.New("photo access has not been granted")
	}
	b := Sint(1, id)
	if size > 0 {
		b = Join(b, Uint(2, uint64(size)), Uint(3, uint64(size)))
	}
	if e := c.send(23, b); e != nil {
		return Download{}, e
	}
	deadline := time.Now().Add(45 * time.Second)
	var out Download
	expected := -1
	for {
		kind, f, e := c.receive(deadline)
		if e != nil {
			return out, e
		}
		switch kind {
		case 4:
			if f.Sint(6) != id {
				return out, errors.New("unexpected photo ID in response")
			}
			if e = frameError(f, 11); e != nil {
				return out, e
			}
			if f.Uint(1) > 64<<20 {
				return out, errors.New("photo exceeds download limit")
			}
			expected = int(f.Uint(1))
			out.Extension = f.Text(5)
			out.Caption = f.Text(2)
			if expected == 0 {
				return out, errors.New("frame returned an empty photo")
			}
		case 5:
			if expected < 0 {
				return out, errors.New("photo data arrived before metadata")
			}
			out.Bytes = append(out.Bytes, f.Blob(1)...)
			if len(out.Bytes) > expected {
				return out, errors.New("photo exceeded its announced size")
			}
			if receipt := f.Uint(16); receipt != 0 {
				if e = c.send(6, Uint(1, receipt)); e != nil {
					return out, e
				}
			}
			if len(out.Bytes) == expected {
				return out, nil
			}
		}
	}
}
func (c *Client) waitReceipt(id uint64) error {
	deadline := time.Now().Add(120 * time.Second)
	for {
		kind, f, e := c.receive(deadline)
		if e != nil {
			return e
		}
		if kind == 6 && f.Uint(1) == id {
			return frameError(f, 2)
		}
	}
}
func (c *Client) Change(action string, ids []int64) error {
	if !c.Info.Permissions.Manage {
		return errors.New("management permission has not been granted")
	}
	if len(ids) == 0 || len(ids) > 1000 {
		return errors.New("select between 1 and 1000 photos")
	}
	for _, id := range ids {
		if id == 0 {
			return errors.New("invalid photo ID")
		}
	}
	if action == "display" {
		if len(ids) != 1 {
			return errors.New("select one photo to display")
		}
		return c.send(35, Sint(1, ids[0]))
	}
	receipt := nextID()
	b := Join(PackedIDs(ids), Uint(16, receipt))
	kind := uint32(33)
	switch action {
	case "hide":
		b = Join(b, Uint(2, 0))
	case "show":
		b = Join(b, Uint(2, 1))
	case "delete":
		kind = 34
	default:
		return errors.New("unknown photo action")
	}
	if e := c.send(kind, b); e != nil {
		return e
	}
	return c.waitReceipt(receipt)
}
func (c *Client) RequestPermission(ctx context.Context, manage bool) error {
	typ := uint64(1)
	if manage {
		typ = 3
	}
	if e := c.send(27, Uint(1, typ)); e != nil {
		return e
	}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		info, e := c.GetInfo()
		if e != nil {
			return e
		}
		if info.Permissions.View && (!manage || info.Permissions.Manage) {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
func (c *Client) Upload(data []byte, caption string, fit bool, captured uint64, progress func(int, int)) (string, error) {
	if len(data) == 0 || len(data) > 32<<20 {
		return "", errors.New("photo must be between 1 byte and 32 MB")
	}
	id, receipt := nextID(), nextID()
	hash := sha256.Sum256(data)
	scale := uint64(2)
	if fit {
		scale = 1
	}
	metadata := Join(Uint(1, uint64(len(data))), Text(2, caption), Float(3, .5), Float(4, .5), Text(5, "webp"), Sint(6, int64(id)), Sint(9, int64(captured)), Sint(10, int64(binary.BigEndian.Uint64(hash[:8])&0x7fffffffffffffff)), Uint(12, scale))
	if e := c.send(4, metadata); e != nil {
		return "", e
	}
	chunk := 16316
	if c.Info.Version < 4 {
		chunk = 924
	}
	for offset := 0; offset < len(data); {
		end := min(offset+chunk, len(data))
		b := Blob(1, data[offset:end])
		if end == len(data) {
			b = Join(b, Uint(16, receipt))
		}
		if e := c.send(5, b); e != nil {
			return "", e
		}
		offset = end
		if progress != nil {
			progress(offset, len(data))
		}
	}
	if e := c.waitReceipt(receipt); e != nil {
		return "", e
	}
	return strconv.FormatUint(id, 10), nil
}
