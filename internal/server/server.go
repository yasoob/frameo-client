package server

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"frameolocal/internal/device"
	"frameolocal/internal/protocol"
	_ "golang.org/x/image/webp"
)

//go:embed ui/*
var frontend embed.FS

type Server struct {
	Manager     *device.Manager
	jobs        Jobs
	cache       imageCache
	token, host string
	mux         *http.ServeMux
	phoneMu     sync.Mutex
	phone       *phoneSession
	imageMu     sync.Mutex
}

func New(ctx context.Context, m *device.Manager, host string) *Server {
	var token [32]byte
	rand.Read(token[:])
	s := &Server{Manager: m, host: host, token: hex.EncodeToString(token[:]), jobs: Jobs{ctx: ctx}, mux: http.NewServeMux()}
	s.routes()
	context.AfterFunc(ctx, func() { s.endPhone("") })
	return s
}
func (s *Server) Wait() { s.jobs.wg.Wait() }
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		http.Error(w, "Cross-site requests are not accepted", http.StatusForbidden)
		return
	}
	if r.Host != s.host {
		http.Error(w, "Invalid host", http.StatusForbidden)
		return
	}
	origin := r.Header.Get("Origin")
	if origin != "" && origin != "http://"+s.host {
		http.Error(w, "Invalid origin", http.StatusForbidden)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
	if strings.HasPrefix(r.URL.Path, "/api/") {
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != "GET" && r.Method != "HEAD" {
			if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Frameo-Token")), []byte(s.token)) != 1 {
				http.Error(w, "Missing session token", http.StatusForbidden)
				return
			}
		}
	}
	s.mux.ServeHTTP(w, r)
}
func respond(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, e error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	json.NewEncoder(w).Encode(map[string]string{"error": e.Error()})
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		return e
	}
	if d.Decode(&struct{}{}) != io.EOF {
		return errors.New("unexpected data after JSON body")
	}
	return nil
}
func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/bootstrap", func(w http.ResponseWriter, r *http.Request) {
		_, name := s.Manager.Store.Identity()
		respond(w, map[string]any{"token": s.token, "name": name, "frames": s.Manager.Store.Frames(), "version": "0.2.2"})
	})
	s.mux.HandleFunc("GET /api/discover", func(w http.ResponseWriter, r *http.Request) {
		frames, e := s.Manager.Discover(r.Context(), true)
		if e != nil {
			fail(w, e)
			return
		}
		if frames == nil {
			frames = []device.Service{}
		}
		respond(w, frames)
	})
	s.mux.HandleFunc("GET /api/frames", func(w http.ResponseWriter, r *http.Request) { respond(w, s.Manager.Store.Frames()) })
	s.mux.HandleFunc("GET /api/jobs", func(w http.ResponseWriter, r *http.Request) { respond(w, s.jobs.List()) })
	s.mux.HandleFunc("DELETE /api/jobs/{id}", func(w http.ResponseWriter, r *http.Request) {
		s.jobs.Cancel(r.PathValue("id"))
		respond(w, map[string]bool{"ok": true})
	})
	s.mux.HandleFunc("POST /api/pair", s.pair)
	s.mux.HandleFunc("GET /api/frames/{peer}/info", func(w http.ResponseWriter, r *http.Request) {
		var info protocol.Info
		ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
		defer cancel()
		e := s.Manager.WithClient(ctx, r.PathValue("peer"), func(c *protocol.Client) error { info = c.Info; return nil })
		if e != nil {
			fail(w, e)
			return
		}
		respond(w, info)
	})
	s.mux.HandleFunc("POST /api/frames/{peer}/permissions", s.permission)
	s.mux.HandleFunc("GET /api/frames/{peer}/media", func(w http.ResponseWriter, r *http.Request) {
		var items []protocol.Media
		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()
		e := s.Manager.WithClient(ctx, r.PathValue("peer"), func(c *protocol.Client) error { var e error; items, e = c.List(); return e })
		if e != nil {
			fail(w, e)
			return
		}
		sort.Slice(items, func(i, j int) bool { return items[i].Received > items[j].Received })
		respond(w, items)
	})
	s.mux.HandleFunc("GET /api/frames/{peer}/media/{id}", s.image)
	s.mux.HandleFunc("POST /api/frames/{peer}/actions", s.action)
	s.mux.HandleFunc("POST /api/frames/{peer}/upload", s.upload)
	s.mux.HandleFunc("POST /api/frames/{peer}/phone", s.startPhone)
	s.mux.HandleFunc("GET /api/phone", s.phoneStatus)
	s.mux.HandleFunc("DELETE /api/phone", func(w http.ResponseWriter, r *http.Request) { s.endPhone(""); respond(w, map[string]bool{"ok": true}) })
	s.mux.HandleFunc("GET /phone", phonePage)
	ui, _ := fs.Sub(frontend, "ui")
	static := http.FileServer(http.FS(ui))
	s.mux.Handle("GET /", static)
}
func (s *Server) pair(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Service device.Service `json:"service"`
		Code    string         `json:"code"`
		Name    string         `json:"name"`
	}
	if e := decode(w, r, &in); e != nil {
		fail(w, e)
		return
	}
	if len(in.Code) > 40 {
		fail(w, errors.New("invalid friend code"))
		return
	}
	job := s.jobs.Start("pair", "", "Connect a frame", func(ctx context.Context, p Progress) error {
		p(.15, "Pairing with your frame…")
		f, e := s.Manager.Pair(ctx, in.Service, in.Code, in.Name)
		if e != nil {
			return e
		}
		p(.7, "Reading frame information…")
		return s.Manager.WithClient(ctx, f.Peer, func(c *protocol.Client) error { return nil })
	})
	respond(w, job)
}
func (s *Server) permission(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Manage bool `json:"manage"`
	}
	if e := decode(w, r, &in); e != nil {
		fail(w, e)
		return
	}
	peer := r.PathValue("peer")
	if _, e := s.Manager.Store.Get(peer); e != nil {
		fail(w, e)
		return
	}
	job := s.jobs.Start("permission", peer, "Photo access", func(ctx context.Context, p Progress) error {
		ctx, cancel := context.WithTimeout(ctx, 150*time.Second)
		defer cancel()
		return s.Manager.WithClient(ctx, peer, func(c *protocol.Client) error {
			if c.Info.Permissions.View && (!in.Manage || c.Info.Permissions.Manage) {
				return nil
			}
			p(.15, "Press Allow on your frame. Keep this window open.")
			return c.RequestPermission(ctx, in.Manage)
		})
	})
	respond(w, job)
}
func (s *Server) action(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Action string   `json:"action"`
		IDs    []string `json:"ids"`
	}
	if e := decode(w, r, &in); e != nil {
		fail(w, e)
		return
	}
	if len(in.IDs) == 0 || len(in.IDs) > 1000 {
		fail(w, errors.New("select between 1 and 1000 photos"))
		return
	}
	if in.Action != "hide" && in.Action != "show" && in.Action != "delete" && in.Action != "display" {
		fail(w, errors.New("unknown action"))
		return
	}
	ids := make([]int64, len(in.IDs))
	for i, id := range in.IDs {
		x, e := strconv.ParseInt(id, 10, 64)
		if e != nil || x == 0 {
			fail(w, errors.New("invalid media ID"))
			return
		}
		ids[i] = x
	}
	peer := r.PathValue("peer")
	job := s.jobs.Start("action", peer, fmt.Sprintf("%s · %d selected", in.Action, len(ids)), func(ctx context.Context, p Progress) error {
		p(.1, "Waiting for the frame…")
		e := s.Manager.WithClient(ctx, peer, func(c *protocol.Client) error { return c.Change(in.Action, ids) })
		if e == nil {
			s.cache.clear()
			if in.Action == "display" {
				p(1, "Display requested; the frame does not report the currently displayed photo.")
			}
		}
		return e
	})
	respond(w, job)
}
func (s *Server) image(w http.ResponseWriter, r *http.Request) {
	peer, idText := r.PathValue("peer"), r.PathValue("id")
	id, e := strconv.ParseInt(idText, 10, 64)
	if e != nil || id == 0 {
		fail(w, errors.New("invalid media ID"))
		return
	}
	size := 400
	if r.URL.Query().Get("full") == "1" {
		size = 0
	}
	key := peer + ":" + idText + ":" + strconv.Itoa(size)
	if _, e = s.Manager.Store.Get(peer); e != nil {
		fail(w, e)
		return
	}
	cached, ok := s.cache.get(key)
	if !ok {
		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		defer cancel()
		var data protocol.Download
		e = s.Manager.WithClient(ctx, peer, func(c *protocol.Client) error { var e error; data, e = c.Download(id, size); return e })
		if e != nil {
			fail(w, e)
			return
		}
		contentType := http.DetectContentType(data.Bytes)
		if contentType != "image/webp" && contentType != "image/jpeg" && contentType != "image/png" {
			fail(w, errors.New("frame returned an unsupported image format"))
			return
		}
		cached = cachedImage{data: data.Bytes, mime: contentType}
		s.cache.put(key, data.Bytes, contentType)
	}
	w.Header().Set("Content-Type", cached.mime)
	if r.URL.Query().Get("download") == "1" {
		ext := ".webp"
		if cached.mime == "image/jpeg" {
			ext = ".jpg"
		} else if cached.mime == "image/png" {
			ext = ".png"
		}
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": "frameo-" + idText + ext}))
	}
	w.Write(cached.data)
}
func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	input, e := readUpload(w, r)
	if e != nil {
		fail(w, e)
		return
	}
	respond(w, s.queueUpload(r.PathValue("peer"), input, false))
}

type uploadInput struct {
	data                  []byte
	name, caption, format string
	fit                   bool
	captured              uint64
}

func readUpload(w http.ResponseWriter, r *http.Request) (uploadInput, error) {
	var input uploadInput
	r.Body = http.MaxBytesReader(w, r.Body, 34<<20)
	if e := r.ParseMultipartForm(1 << 20); e != nil {
		return input, e
	}
	defer r.MultipartForm.RemoveAll()
	file, header, e := r.FormFile("photo")
	if e != nil {
		return input, e
	}
	defer file.Close()
	data, e := io.ReadAll(io.LimitReader(file, (32<<20)+1))
	if e != nil || len(data) > 32<<20 {
		return input, errors.New("photo exceeds 32 MB")
	}
	config, format, e := image.DecodeConfig(bytes.NewReader(data))
	if e != nil || (format != "webp" && format != "png" && format != "jpeg") || config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > 50_000_000 {
		return input, errors.New("send a valid JPEG, PNG or WebP image under 50 megapixels")
	}
	caption := r.FormValue("caption")
	if len(caption) > 2000 {
		return input, errors.New("caption is too long")
	}
	fit := r.FormValue("fit") == "true"
	captured, _ := strconv.ParseUint(r.FormValue("captured"), 10, 64)
	if captured == 0 {
		captured = uint64(time.Now().UnixMilli())
	}
	name := filepath.Base(header.Filename)
	return uploadInput{data: data, name: name, caption: caption, format: format, fit: fit, captured: captured}, nil
}

func (s *Server) queueUpload(peer string, input uploadInput, phone bool) Job {
	name := input.name
	if phone {
		name = "Phone · " + name
	}
	return s.jobs.Start("upload", peer, name, func(ctx context.Context, p Progress) error {
		p(0, "Waiting to send…")
		data := input.data
		if input.format != "webp" {
			p(.02, "Preparing photo on your computer…")
			// Limit decoder/encoder memory pressure when multiple devices upload.
			s.imageMu.Lock()
			if err := ctx.Err(); err != nil {
				s.imageMu.Unlock()
				return err
			}
			var err error
			data, err = ensureWebP(data, input.format)
			s.imageMu.Unlock()
			if err != nil {
				return err
			}
		}
		return s.Manager.WithClient(ctx, peer, func(c *protocol.Client) error {
			id, e := c.Upload(data, input.caption, input.fit, input.captured, func(done, total int) {
				p(.95*float64(done)/float64(total), "Sending to your frame…")
				if done == total {
					p(.95, "Waiting for the frame to confirm…")
				}
			})
			if e == nil {
				p(1, "Received by your frame", id)
			}
			return e
		})
	})
}
