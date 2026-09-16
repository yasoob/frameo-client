package protocol

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha512"
	"errors"
	"strings"
	"time"

	"golang.org/x/crypto/curve25519"
	"golang.org/x/crypto/salsa20"
)

func pairingResponse(challenge []byte, code string, client, frame, channel [32]byte, scalar []byte) ([]byte, []byte, error) {
	code = strings.NewReplacer(" ", "", "-", "").Replace(code)
	if len(code) < 7 || len(code) > 20 {
		return nil, nil, errors.New("friend code must contain 7–20 digits")
	}
	for _, c := range code {
		if c < '0' || c > '9' {
			return nil, nil, errors.New("friend code must contain digits only")
		}
	}
	if len(challenge) != 97 || challenge[0] != 3 {
		return nil, nil, errors.New("invalid pairing challenge")
	}
	password := sha512.Sum512(Join([]byte(code), client[:], frame[:]))
	stream := sha512.Sum512(Join(password[:], challenge[33:65]))
	var key [32]byte
	copy(key[:], stream[:32])
	mapping := make([]byte, 32)
	salsa20.XORKeyStream(mapping, challenge[65:], challenge[33:57], &key)
	base, e := curve25519.X25519(channel[:], curve25519.Basepoint)
	if e != nil {
		return nil, nil, e
	}
	mapped, e := curve25519.X25519(mapping, base)
	if e != nil {
		return nil, nil, e
	}
	public, e := curve25519.X25519(scalar, mapped)
	if e != nil {
		return nil, nil, e
	}
	shared, e := curve25519.X25519(scalar, challenge[1:33])
	if e != nil {
		return nil, nil, e
	}
	a := sha512.Sum512(challenge[1:33])
	proof := sha512.Sum512(Join(a[:], shared))
	a = sha512.Sum512(public)
	expected := sha512.Sum512(Join(a[:], shared))
	return Join([]byte{4}, public, proof[:32]), Join([]byte{5}, expected[:32]), nil
}
func (t *Transport) Pair(code string) error {
	versions, ok := t.Metadata["pace_versions"]
	if ok && !bytes.Contains(versions, []byte("1")) {
		return errors.New("frame does not support PACE v1")
	}
	challenge, e := t.Receive(time.Now().Add(12 * time.Second))
	if e != nil {
		return e
	}
	scalar, e := random(32)
	if e != nil {
		return e
	}
	response, expected, e := pairingResponse(challenge, code, t.Public, t.Peer, t.Shared, scalar)
	if e != nil {
		return e
	}
	if e = t.Send(response); e != nil {
		return e
	}
	reply, e := t.Receive(time.Now().Add(12 * time.Second))
	if e != nil {
		return e
	}
	if !hmac.Equal(reply, expected) {
		return errors.New("pairing rejected; check the friend code on the frame")
	}
	return nil
}
