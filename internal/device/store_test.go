package device

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestIdentityPersistsAndConcurrentInstanceIsRejected(t *testing.T) {
	path := filepath.Join(t.TempDir(), "device.json")
	s, e := OpenStore(path)
	if e != nil {
		t.Fatal(e)
	}
	key, _ := s.Identity()
	if _, e = OpenStore(path); e == nil {
		t.Fatal("second process acquired the same identity")
	}
	if e = s.SetName("Test sender"); e != nil {
		t.Fatal(e)
	}
	s.Close()
	s, e = OpenStore(path)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	again, name := s.Identity()
	if again != key || name != "Test sender" {
		t.Fatal("identity did not persist")
	}
	if runtime.GOOS != "windows" {
		info, _ := os.Stat(path)
		if info.Mode().Perm() != 0600 {
			t.Fatal("private key file permissions are not 0600")
		}
	}
}
