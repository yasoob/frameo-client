package protocol

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"os"
	"testing"
	"time"

	"golang.org/x/crypto/nacl/secretbox"
)

func TestPACEOriginalNativeVectors(t *testing.T) {
	b, e := os.ReadFile("testdata/pace.json")
	if e != nil {
		t.Fatal(e)
	}
	var vectors []map[string]string
	if e = json.Unmarshal(b, &vectors); e != nil {
		t.Fatal(e)
	}
	for i, v := range vectors {
		decode := func(k string) []byte {
			b, e := hex.DecodeString(v[k])
			if e != nil {
				t.Fatal(e)
			}
			return b
		}
		client, _ := DecodeKey(v["client"])
		frame, _ := DecodeKey(v["frame"])
		channel, _ := DecodeKey(v["channel"])
		reply, proof, e := pairingResponse(decode("challenge"), "12 34 56 78 90", client, frame, channel, decode("scalar"))
		if e != nil {
			t.Fatal(e)
		}
		if !bytes.Equal(reply, decode("response")) || !bytes.Equal(proof, decode("proof")) {
			t.Fatalf("native vector %d differs", i)
		}
	}
}
func TestSignedMediaFieldsAndUnsignedReceipts(t *testing.T) {
	for _, id := range []int64{42, -42, 9_007_199_254_740_993} {
		f, e := Parse(Join(Sint(1, id), Sint(4, 1_700_000_000_000), Uint(16, 150)))
		if e != nil {
			t.Fatal(e)
		}
		if f.Sint(1) != id || f.Sint(4) != 1_700_000_000_000 || f.Uint(16) != 150 {
			t.Fatal("signed field or receipt changed")
		}
	}
	if !bytes.Equal(Sint(1, -1), []byte{8, 1}) {
		t.Fatal("incorrect ZigZag encoding")
	}
	for _, bad := range [][]byte{{0}, {8, 128}, {10, 5, 'a'}, {13, 1}, {11}} {
		if _, e := Parse(bad); e == nil {
			t.Fatalf("accepted malformed wire data %x", bad)
		}
	}
}
func TestAuthenticatedReceiveRejectsTamperAndReplay(t *testing.T) {
	x := &Transport{}
	for i := range x.Shared {
		x.Shared[i] = byte(i)
	}
	n := nonce("CurveCP-server-M", 0)
	if len(n) != 24 || string(n[:16]) != "CurveCP-server-M" {
		t.Fatal("incorrect nonce")
	}
	b := Join([]byte("🐟MESG"), make([]byte, 8), secretbox.Seal(nil, []byte("hello"), n, &x.Shared))
	tampered := append([]byte(nil), b...)
	tampered[len(tampered)-1] ^= 1
	if _, e := x.decrypt(tampered, "MESG", "CurveCP-server-M"); e == nil {
		t.Fatal("tampering accepted")
	}
	if x.hasRX {
		t.Fatal("failed authentication advanced sequence")
	}
	plain, e := x.decrypt(b, "MESG", "CurveCP-server-M")
	if e != nil || string(plain) != "hello" {
		t.Fatal(e)
	}
	if _, e = x.decrypt(b, "MESG", "CurveCP-server-M"); e == nil {
		t.Fatal("replay accepted")
	}
}
func TestBadHandshakeClosesCleanly(t *testing.T) {
	l, e := net.Listen("tcp4", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	defer l.Close()
	done := make(chan struct{})
	go func() {
		defer close(done)
		c, e := l.Accept()
		if e != nil {
			return
		}
		defer c.Close()
		c.SetDeadline(time.Now().Add(2 * time.Second))
		io.ReadFull(c, make([]byte, 10))
		c.Write(Join(binary.BigEndian.AppendUint16(nil, 8), []byte("badhello")))
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, e = Dial(ctx, "127.0.0.1", l.Addr().(*net.TCPAddr).Port, [32]byte{1}, "<pairing>", "", "")
	if e == nil {
		t.Fatal("bad greeting accepted")
	}
	<-done
}
func TestFrameErrorsAreNotEmptyLibraries(t *testing.T) {
	f, e := Parse(Blob(2, Uint(1, 5)))
	if e != nil {
		t.Fatal(e)
	}
	if e = frameError(f, 2); e == nil {
		t.Fatal("missing permission treated as success")
	}
	if e = frameError(Fields{}, 2); e != nil {
		t.Fatal(e)
	}
}
