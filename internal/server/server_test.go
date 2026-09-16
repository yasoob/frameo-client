package server

import (
	"context"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"frameolocal/internal/device"
)

func TestLocalAPIOriginAndTokenBoundaries(t *testing.T) {
	s, e := device.OpenStore(filepath.Join(t.TempDir(), "device.json"))
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	server := New(context.Background(), device.NewManager(s), "127.0.0.1:8766")
	cases := []struct {
		method, path, host, origin, token string
		code                              int
	}{
		{"GET", "/api/bootstrap", "127.0.0.1:8766", "", "", 200},
		{"GET", "/api/bootstrap", "rebind.example:8766", "", "", 403},
		{"GET", "/api/bootstrap", "127.0.0.1:8766", "https://other.example", "", 403},
		{"POST", "/api/pair", "127.0.0.1:8766", "", "", 403},
		{"POST", "/api/pair", "127.0.0.1:8766", "http://127.0.0.1:8766", server.token, 400},
	}
	for _, c := range cases {
		r := httptest.NewRequest(c.method, "http://"+c.host+c.path, strings.NewReader("invalid json"))
		r.Host = c.host
		r.Header.Set("Origin", c.origin)
		r.Header.Set("X-Frameo-Token", c.token)
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		if w.Code != c.code {
			t.Fatalf("%s %s got %d, want %d", c.method, c.path, w.Code, c.code)
		}
		if strings.Contains(w.Body.String(), "private_key") {
			t.Fatal("private key exposed by API")
		}
	}
	r := httptest.NewRequest("GET", "http://127.0.0.1:8766/api/bootstrap", nil)
	r.Header.Set("Sec-Fetch-Site", "cross-site")
	w := httptest.NewRecorder()
	server.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("cross-site subresource request was accepted")
	}
}
