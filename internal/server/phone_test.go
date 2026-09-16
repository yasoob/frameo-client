package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func testPhone() (*Server, *phoneSession) {
	s := &Server{jobs: Jobs{ctx: context.Background()}}
	g := &phoneSession{token: strings.Repeat("b", 64), host: "192.168.1.10:54321", peer: strings.Repeat("a", 64), name: "Living room", width: 1280, height: 800, expires: time.Now().Add(time.Minute), active: true, uploads: map[string]string{}}
	return s, g
}
func TestPhoneCannotReachManagementAPI(t *testing.T) {
	s, g := testPhone()
	h := s.phoneHandler(g)
	for _, path := range []string{"/api/bootstrap", "/api/frames", "/api/pair", "/api/jobs", "/api/frames/anything/media"} {
		r := httptest.NewRequest("GET", "http://"+g.host+path, nil)
		r.Header.Set("Authorization", "Bearer "+g.token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 404 {
			t.Fatalf("management route %s was exposed: %d", path, w.Code)
		}
	}
}
func TestPhoneAuthenticationExpiryAndJobScope(t *testing.T) {
	s, g := testPhone()
	s.jobs.entries = []*jobEntry{{Job: Job{ID: "mine", Peer: g.peer, State: "succeeded"}}, {Job: Job{ID: "someone-else", State: "succeeded"}}}
	g.uploads["own-upload"] = "mine"
	h := s.phoneHandler(g)
	for _, token := range []string{"", strings.Repeat("c", 64)} {
		r := httptest.NewRequest("GET", "http://"+g.host+"/phone-api/session", nil)
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 401 {
			t.Fatal("unauthenticated phone request accepted")
		}
	}
	r := httptest.NewRequest("GET", "http://"+g.host+"/phone-api/jobs", nil)
	r.Header.Set("Authorization", "Bearer "+g.token)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	var jobs []Job
	json.Unmarshal(w.Body.Bytes(), &jobs)
	if w.Code != 200 || len(jobs) != 1 || jobs[0].ID != "mine" || jobs[0].Peer != "" {
		t.Fatal("phone job scope leaked", w.Body.String())
	}
	r = httptest.NewRequest("GET", "http://"+g.host+"/phone-api/session", nil)
	r.Header.Set("Authorization", "Bearer "+g.token)
	r.Header.Set("Origin", "https://other.example")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("cross-origin request accepted")
	}
	g.expires = time.Now().Add(-time.Second)
	r.Header.Del("Origin")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 410 {
		t.Fatal("expired phone link accepted")
	}
}
func TestPhoneRetryReturnsSameAcceptedJob(t *testing.T) {
	s, g := testPhone()
	id := strings.Repeat("1", 32)
	g.uploads[id] = "accepted"
	s.jobs.entries = []*jobEntry{{Job: Job{ID: "accepted", State: "succeeded", MediaID: "123"}}}
	r := httptest.NewRequest("POST", "http://"+g.host+"/phone-api/upload", strings.NewReader("not even a multipart body"))
	r.Header.Set("Authorization", "Bearer "+g.token)
	r.Header.Set("X-Upload-ID", id)
	w := httptest.NewRecorder()
	s.phoneHandler(g).ServeHTTP(w, r)
	var job Job
	json.Unmarshal(w.Body.Bytes(), &job)
	if w.Code != 200 || job.ID != "accepted" || len(s.jobs.entries) != 1 {
		t.Fatal("retried upload was not deduplicated", w.Body.String())
	}
}

type onRead struct {
	io.Reader
	fn func()
}

func (r *onRead) Read(p []byte) (int, error) {
	if r.fn != nil {
		f := r.fn
		r.fn = nil
		f()
	}
	return r.Reader.Read(p)
}
func TestEndingPhoneSessionRejectsUploadStillBeingReceived(t *testing.T) {
	s, g := testPhone()
	data, e := os.ReadFile("testdata/sample.webp")
	if e != nil {
		t.Fatal(e)
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, _ := writer.CreateFormFile("photo", "sample.webp")
	part.Write(data)
	writer.Close()
	reader := &onRead{Reader: &body, fn: func() { g.mu.Lock(); g.active = false; g.mu.Unlock() }}
	r := httptest.NewRequest("POST", "http://"+g.host+"/phone-api/upload", reader)
	r.Header.Set("Authorization", "Bearer "+g.token)
	r.Header.Set("X-Upload-ID", strings.Repeat("2", 32))
	r.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	s.phoneHandler(g).ServeHTTP(w, r)
	if w.Code != 410 || len(s.jobs.entries) != 0 {
		t.Fatal("ended session accepted a new upload", w.Body.String())
	}
	if g.busy || len(g.uploads) != 0 {
		t.Fatal("failed upload reservation was not cleaned up")
	}
}
