package protocol

import (
	"encoding/binary"
	"fmt"
	"math"

	"google.golang.org/protobuf/encoding/protowire"
)

type Value struct {
	Number uint64
	Bytes  []byte
	Type   protowire.Type
}
type Fields map[int][]Value

func Parse(data []byte) (Fields, error) {
	f := Fields{}
	for len(data) > 0 {
		n, t, used := protowire.ConsumeTag(data)
		if used < 0 || n < 1 {
			return nil, fmt.Errorf("invalid protobuf tag")
		}
		data = data[used:]
		v := Value{Type: t}
		switch t {
		case protowire.VarintType:
			v.Number, used = protowire.ConsumeVarint(data)
		case protowire.BytesType:
			v.Bytes, used = protowire.ConsumeBytes(data)
		case protowire.Fixed32Type:
			var x uint32
			x, used = protowire.ConsumeFixed32(data)
			v.Number = uint64(x)
		case protowire.Fixed64Type:
			v.Number, used = protowire.ConsumeFixed64(data)
		default:
			return nil, fmt.Errorf("unsupported protobuf wire type %d", t)
		}
		if used < 0 {
			return nil, fmt.Errorf("truncated protobuf field %d", n)
		}
		f[int(n)] = append(f[int(n)], v)
		data = data[used:]
	}
	return f, nil
}
func (f Fields) Uint(n int) uint64 {
	a := f[n]
	if len(a) == 0 {
		return 0
	}
	return a[len(a)-1].Number
}
func (f Fields) Blob(n int) []byte {
	a := f[n]
	if len(a) == 0 {
		return nil
	}
	return a[len(a)-1].Bytes
}
func (f Fields) Text(n int) string { return string(f.Blob(n)) }
func (f Fields) Has(n int) bool    { return len(f[n]) > 0 }
func Uint(n int, v uint64) []byte {
	return protowire.AppendVarint(protowire.AppendTag(nil, protowire.Number(n), protowire.VarintType), v)
}
func Blob(n int, b []byte) []byte {
	return protowire.AppendBytes(protowire.AppendTag(nil, protowire.Number(n), protowire.BytesType), b)
}
func Text(n int, s string) []byte { return Blob(n, []byte(s)) }
func Float(n int, v float32) []byte {
	return protowire.AppendFixed32(protowire.AppendTag(nil, protowire.Number(n), protowire.Fixed32Type), math.Float32bits(v))
}
func Join(parts ...[]byte) []byte {
	var b []byte
	for _, p := range parts {
		b = append(b, p...)
	}
	return b
}
func Envelope(kind uint32, b []byte) []byte {
	h := make([]byte, 8)
	binary.BigEndian.PutUint32(h, 18)
	binary.BigEndian.PutUint32(h[4:], kind)
	return append(h, b...)
}
func Unenvelope(b []byte) (uint32, uint32, []byte, error) {
	if len(b) < 8 {
		return 0, 0, nil, fmt.Errorf("truncated Frameo message")
	}
	return binary.BigEndian.Uint32(b), binary.BigEndian.Uint32(b[4:]), b[8:], nil
}

// IDs and capture/receive timestamps are sint64 (ZigZag), unlike receipt IDs.
func (f Fields) Sint(n int) int64 { return protowire.DecodeZigZag(f.Uint(n)) }
func Sint(n int, v int64) []byte  { return Uint(n, protowire.EncodeZigZag(v)) }
func PackedIDs(ids []int64) []byte {
	var b []byte
	for _, id := range ids {
		b = protowire.AppendVarint(b, protowire.EncodeZigZag(id))
	}
	return Blob(1, b)
}
