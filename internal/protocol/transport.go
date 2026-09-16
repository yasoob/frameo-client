// Package protocol implements the Frameo MDG LAN protocol without Android or CGo.
package protocol

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	_ "embed"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"time"

	"golang.org/x/crypto/curve25519"
	"golang.org/x/crypto/nacl/box"
	"golang.org/x/crypto/nacl/secretbox"
)

//go:embed issuers.json
var issuerJSON []byte
var magic = []byte("🐟")

type Transport struct {
	Conn                          net.Conn
	Private, Public, Peer, Shared [32]byte
	Issuer                        string
	Metadata                      map[string][]byte
	tx, rx                        uint64
	hasRX                         bool
	stop                          func() bool
}

func DecodeKey(s string) ([32]byte, error) {
	var k [32]byte
	b, e := hex.DecodeString(s)
	if e != nil || len(b) != 32 {
		return k, errors.New("invalid 32-byte identity key")
	}
	copy(k[:], b)
	return k, nil
}
func nonce(prefix string, seq uint64) *[24]byte {
	var n [24]byte
	copy(n[:16], prefix)
	binary.BigEndian.PutUint64(n[16:], seq)
	return &n
}
func random(n int) ([]byte, error) { b := make([]byte, n); _, e := rand.Read(b); return b, e }
func encodeMetadata(m map[string][]byte) []byte {
	b := []byte{byte(len(m))}
	for k, v := range m {
		b = append(b, byte(len(k)))
		b = append(b, k...)
		b = binary.BigEndian.AppendUint16(b, uint16(len(v)))
		b = append(b, v...)
	}
	return b
}
func decodeMetadata(b []byte) (map[string][]byte, error) {
	if len(b) == 0 {
		return nil, errors.New("missing handshake metadata")
	}
	count := int(b[0])
	b = b[1:]
	m := map[string][]byte{}
	for i := 0; i < count; i++ {
		if len(b) < 1 {
			return nil, io.ErrUnexpectedEOF
		}
		n := int(b[0])
		b = b[1:]
		if n == 0 || len(b) < n+2 {
			return nil, io.ErrUnexpectedEOF
		}
		k := string(b[:n])
		size := int(binary.BigEndian.Uint16(b[n:]))
		b = b[n+2:]
		if len(b) < size {
			return nil, io.ErrUnexpectedEOF
		}
		if _, ok := m[k]; ok {
			return nil, errors.New("duplicate handshake metadata")
		}
		m[k] = append([]byte(nil), b[:size]...)
		b = b[size:]
	}
	if len(b) != 0 {
		return nil, errors.New("trailing handshake metadata")
	}
	return m, nil
}
func (t *Transport) Close() {
	if t.stop != nil {
		t.stop()
	}
	if t.Conn != nil {
		t.Conn.Close()
	}
}
func (t *Transport) write(b []byte) error {
	if len(b) < 8 || len(b) > 65535 {
		return errors.New("invalid MDG record length")
	}
	b = append(binary.BigEndian.AppendUint16(nil, uint16(len(b))), b...)
	for len(b) > 0 {
		n, e := t.Conn.Write(b)
		if e != nil {
			return e
		}
		if n == 0 {
			return io.ErrUnexpectedEOF
		}
		b = b[n:]
	}
	return nil
}
func (t *Transport) read() ([]byte, error) {
	var h [2]byte
	if _, e := io.ReadFull(t.Conn, h[:]); e != nil {
		return nil, e
	}
	size := int(binary.BigEndian.Uint16(h[:]))
	if size < 8 {
		return nil, errors.New("invalid MDG record length")
	}
	b := make([]byte, size)
	_, e := io.ReadFull(t.Conn, b)
	return b, e
}
func (t *Transport) decrypt(b []byte, marker, prefix string) ([]byte, error) {
	if len(b) < 32 || !bytes.Equal(b[:8], append(append([]byte(nil), magic...), marker...)) {
		return nil, fmt.Errorf("expected %s record", marker)
	}
	s := binary.BigEndian.Uint64(b[8:16])
	if t.hasRX && s <= t.rx {
		return nil, errors.New("replayed MDG record")
	}
	plain, ok := secretbox.Open(nil, b[16:], nonce(prefix, s), &t.Shared)
	if !ok {
		return nil, errors.New("MDG authentication failed")
	}
	t.hasRX = true
	t.rx = s
	return plain, nil
}
func Dial(ctx context.Context, host string, port int, private [32]byte, protocol, peer, issuer string) (t *Transport, err error) {
	d := net.Dialer{Timeout: 8 * time.Second}
	c, e := d.DialContext(ctx, "tcp", net.JoinHostPort(host, fmt.Sprint(port)))
	if e != nil {
		return nil, fmt.Errorf("connect to frame: %w", e)
	}
	t = &Transport{Conn: c, Private: private}
	t.stop = context.AfterFunc(ctx, func() { c.Close() })
	stop := t.stop
	defer func() {
		if err != nil {
			stop()
			c.Close()
		}
	}()
	c.SetDeadline(time.Now().Add(12 * time.Second))
	public, e := curve25519.X25519(private[:], curve25519.Basepoint)
	if e != nil {
		return nil, e
	}
	copy(t.Public[:], public)
	if e = t.write(append(append([]byte(nil), magic...), "TELL"...)); e != nil {
		return nil, e
	}
	welcome, e := t.read()
	if e != nil {
		return nil, e
	}
	if len(welcome) != 40 || string(welcome[:8]) != "🐟WELC" {
		return nil, errors.New("invalid frame identity response")
	}
	copy(t.Peer[:], welcome[8:])
	if peer != "" && hex.EncodeToString(t.Peer[:]) != peer {
		return nil, errors.New("frame identity differs from saved pairing")
	}
	ephPub, ephPriv, e := box.GenerateKey(rand.Reader)
	if e != nil {
		return nil, e
	}
	hello := Join([]byte("🐟HELO"), ephPub[:], binary.BigEndian.AppendUint64(nil, 0), box.Seal(nil, make([]byte, 64), nonce("CurveCP-client-H", 0), &t.Peer, ephPriv))
	t.tx = 1
	if e = t.write(hello); e != nil {
		return nil, e
	}
	cookie, e := t.read()
	if e != nil {
		return nil, e
	}
	if len(cookie) != 168 || string(cookie[:8]) != "🐟COOK" {
		return nil, errors.New("invalid cookie response")
	}
	var cn [24]byte
	copy(cn[:], "CurveCPK")
	copy(cn[8:], cookie[8:24])
	plain, ok := box.Open(nil, cookie[24:], &cn, &t.Peer, ephPriv)
	if !ok || len(plain) != 128 {
		return nil, errors.New("cookie authentication failed")
	}
	var serverEph [32]byte
	copy(serverEph[:], plain[:32])
	box.Precompute(&t.Shared, &serverEph, ephPriv)
	vnBytes, e := random(16)
	if e != nil {
		return nil, e
	}
	var vn [24]byte
	copy(vn[:], "CurveCPV")
	copy(vn[8:], vnBytes)
	vouch := box.Seal(nil, ephPub[:], &vn, &t.Peer, &private)
	m := map[string][]byte{"protocol": []byte(protocol)}
	if protocol == "<pairing>" {
		m["pace_versions"] = []byte("1")
	}
	body := Join(t.Public[:], vn[8:], vouch, encodeMetadata(m))
	voucher := Join([]byte("🐟VOCH"), plain[32:], binary.BigEndian.AppendUint64(nil, t.tx), secretbox.Seal(nil, body, nonce("CurveCP-client-I", t.tx), &t.Shared))
	t.tx++
	if e = t.write(voucher); e != nil {
		return nil, e
	}
	ready, e := t.read()
	if e != nil {
		return nil, e
	}
	plain, e = t.decrypt(ready, "REDY", "CurveCP-server-R")
	if e != nil {
		return nil, e
	}
	t.Metadata, e = decodeMetadata(plain)
	if e != nil {
		return nil, e
	}
	cert := t.Metadata["certificate"]
	if len(cert) != 128 || !bytes.Equal(cert[96:], t.Peer[:]) || !ed25519.Verify(cert[:32], cert[96:], cert[32:96]) {
		return nil, errors.New("invalid frame certificate")
	}
	t.Issuer = hex.EncodeToString(cert[:32])
	if issuer != "" {
		if t.Issuer != issuer {
			return nil, errors.New("frame certificate issuer changed")
		}
	} else {
		var trusted []string
		if e = json.Unmarshal(issuerJSON, &trusted); e != nil {
			return nil, e
		}
		found := false
		for _, s := range trusted {
			found = found || s == t.Issuer
		}
		if !found {
			return nil, errors.New("unrecognized frame certificate issuer")
		}
	}
	c.SetDeadline(time.Time{})
	return t, nil
}
func (t *Transport) Send(b []byte) error {
	if len(b) > 16416 {
		return errors.New("application message exceeds 16416 bytes")
	}
	t.Conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
	payload := Join(binary.BigEndian.AppendUint16(nil, uint16(len(b))), b)
	record := Join([]byte("🐟MESG"), binary.BigEndian.AppendUint64(nil, t.tx), secretbox.Seal(nil, payload, nonce("CurveCP-client-M", t.tx), &t.Shared))
	t.tx++
	return t.write(record)
}
func (t *Transport) Receive(deadline time.Time) ([]byte, error) {
	t.Conn.SetReadDeadline(deadline)
	b, e := t.read()
	if e != nil {
		return nil, e
	}
	b, e = t.decrypt(b, "MESG", "CurveCP-server-M")
	if e != nil {
		return nil, e
	}
	if len(b) < 2 || int(binary.BigEndian.Uint16(b)) != len(b)-2 {
		return nil, errors.New("invalid application message length")
	}
	return b[2:], nil
}
