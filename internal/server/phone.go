package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"io/fs"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const phoneLifetime = 15 * time.Minute

type phoneNetwork struct {
	Host string `json:"host"`
	Name string `json:"name"`
}
type phoneSession struct {
	mu                                     sync.Mutex
	id, token, peer, name, placement, host string
	width, height                          int
	expires                                time.Time
	seen                                   time.Time
	active                                 bool
	busy                                   bool
	uploads                                map[string]string // idempotency key -> job ID; empty means receiving
	networks                               []phoneNetwork
	http                                   *http.Server
	timer                                  *time.Timer
}

func localNetworks() []phoneNetwork {
	var result []phoneNetwork
	interfaces, _ := net.Interfaces()
	for _, i := range interfaces {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, _ := i.Addrs()
		for _, a := range addresses {
			ip, _, e := net.ParseCIDR(a.String())
			if e == nil && ip.To4() != nil && ip.IsPrivate() {
				result = append(result, phoneNetwork{ip.String(), i.Name})
			}
		}
	}
	return result
}

func phonePage(w http.ResponseWriter, r *http.Request) {
	b, e := frontend.ReadFile("ui/index.html")
	if e != nil {
		http.Error(w, "UI unavailable", 500)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(b)
}

func (g *phoneSession) summary() map[string]any {
	g.mu.Lock()
	defer g.mu.Unlock()
	return map[string]any{"id": g.id, "peer": g.peer, "url": "http://" + g.host + "/phone#t=" + g.token, "expires_at": g.expires.UnixMilli(), "connected": !g.seen.IsZero(), "last_seen": g.seen.UnixMilli(), "active": g.active && time.Now().Before(g.expires), "networks": g.networks, "host": strings.Split(g.host, ":")[0]}
}
func (g *phoneSession) close() {
	g.mu.Lock()
	if !g.active {
		g.mu.Unlock()
		return
	}
	g.active = false
	g.mu.Unlock()
	if g.timer != nil {
		g.timer.Stop()
	}
	if g.http != nil {
		g.http.Close()
	}
}
func (s *Server) endPhone(id string) {
	s.phoneMu.Lock()
	g := s.phone
	if g != nil && (id == "" || g.id == id) {
		s.phone = nil
	} else {
		g = nil
	}
	s.phoneMu.Unlock()
	if g != nil {
		g.close()
	}
}
func (s *Server) phoneStatus(w http.ResponseWriter, r *http.Request) {
	s.phoneMu.Lock()
	g := s.phone
	s.phoneMu.Unlock()
	if g == nil {
		respond(w, map[string]bool{"active": false})
		return
	}
	respond(w, g.summary())
}

func (s *Server) startPhone(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Host  string `json:"host"`
		Renew bool   `json:"renew"`
	}
	if e := decode(w, r, &input); e != nil {
		fail(w, e)
		return
	}
	f, e := s.Manager.Store.Get(r.PathValue("peer"))
	if e != nil {
		fail(w, e)
		return
	}
	networks := localNetworks()
	host := input.Host
	if host == "" {
		// UDP dial selects the interface route without transmitting a datagram.
		c, e := net.DialTimeout("udp4", net.JoinHostPort(f.Host, strconv.Itoa(f.Port)), time.Second)
		if e == nil {
			host = c.LocalAddr().(*net.UDPAddr).IP.String()
			c.Close()
		}
	}
	valid := false
	for _, n := range networks {
		if n.Host == host {
			valid = true
		}
	}
	if !valid {
		if input.Host != "" || len(networks) == 0 {
			fail(w, errors.New("connect this computer to Wi-Fi or Ethernet to receive photos from your phone"))
			return
		}
		host = networks[0].Host
	}
	s.phoneMu.Lock()
	defer s.phoneMu.Unlock()
	if s.jobs.ctx.Err() != nil {
		fail(w, errors.New("application is closing"))
		return
	}
	if old := s.phone; old != nil {
		if old.peer == f.Peer && strings.HasPrefix(old.host, host+":") && !input.Renew && time.Now().Before(old.expires) {
			respond(w, old.summary())
			return
		}
		old.close()
		s.phone = nil
	}
	listener, e := net.Listen("tcp4", net.JoinHostPort(host, "0"))
	if e != nil {
		fail(w, e)
		return
	}
	var secret [32]byte
	var id [12]byte
	if _, e = rand.Read(secret[:]); e != nil {
		listener.Close()
		fail(w, e)
		return
	}
	if _, e = rand.Read(id[:]); e != nil {
		listener.Close()
		fail(w, e)
		return
	}
	g := &phoneSession{id: hex.EncodeToString(id[:]), token: hex.EncodeToString(secret[:]), peer: f.Peer, name: f.Name, placement: f.Placement, width: f.Width, height: f.Height, host: listener.Addr().String(), expires: time.Now().Add(phoneLifetime), active: true, uploads: map[string]string{}, networks: networks}
	g.http = &http.Server{Handler: s.phoneHandler(g), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 90 * time.Second, WriteTimeout: 100 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16 << 10}
	g.timer = time.AfterFunc(phoneLifetime, func() { s.endPhone(g.id) })
	s.phone = g
	go g.http.Serve(listener)
	respond(w, g.summary())
}

func (s *Server) phoneHandler(g *phoneSession) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /phone", phonePage)
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/phone", http.StatusTemporaryRedirect)
	})
	assets, _ := fs.Sub(frontend, "ui/assets")
	mux.Handle("GET /assets/", http.StripPrefix("/assets/", http.FileServer(http.FS(assets))))
	mux.HandleFunc("GET /phone-api/session", func(w http.ResponseWriter, r *http.Request) {
		respond(w, map[string]any{"name": g.name, "placement": g.placement, "width": g.width, "height": g.height, "expires_at": g.expires.UnixMilli()})
	})
	mux.HandleFunc("GET /phone-api/jobs", func(w http.ResponseWriter, r *http.Request) {
		g.mu.Lock()
		ids := map[string]bool{}
		for _, id := range g.uploads {
			ids[id] = true
		}
		g.mu.Unlock()
		out := []Job{}
		for _, j := range s.jobs.List() {
			if ids[j.ID] {
				j.Peer = ""
				out = append(out, j)
			}
		}
		respond(w, out)
	})
	mux.HandleFunc("POST /phone-api/upload", func(w http.ResponseWriter, r *http.Request) { s.phoneUpload(g, w, r) })
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		if r.Host != g.host {
			http.Error(w, "Invalid host", 403)
			return
		}
		origin := r.Header.Get("Origin")
		if origin != "" && origin != "http://"+g.host {
			http.Error(w, "Invalid origin", 403)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/phone-api/") {
			if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
				http.Error(w, "Invalid origin", 403)
				return
			}
			if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+g.token)) != 1 {
				http.Error(w, "Scan the QR code again to connect.", 401)
				return
			}
			g.mu.Lock()
			valid := g.active && time.Now().Before(g.expires)
			if valid {
				g.seen = time.Now()
			}
			g.mu.Unlock()
			if !valid {
				http.Error(w, "This phone link has expired. Get a new QR code on your computer.", 410)
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}

func (s *Server) phoneUpload(g *phoneSession, w http.ResponseWriter, r *http.Request) {
	id := r.Header.Get("X-Upload-ID")
	decoded, e := hex.DecodeString(id)
	if e != nil || len(decoded) != 16 {
		fail(w, errors.New("invalid upload ID"))
		return
	}
	g.mu.Lock()
	if jobID, ok := g.uploads[id]; ok && jobID != "" {
		g.mu.Unlock()
		for _, j := range s.jobs.List() {
			if j.ID == jobID {
				j.Peer = ""
				respond(w, j)
				return
			}
		}
		http.Error(w, "Upload status has expired. Check your computer.", 410)
		return
	}
	if g.busy {
		g.mu.Unlock()
		http.Error(w, "Another photo is being received. Try again in a moment.", 429)
		return
	}
	if len(g.uploads) >= 100 {
		g.mu.Unlock()
		http.Error(w, "This link has received 100 photos. Create a new link on your computer.", 429)
		return
	}
	g.busy = true
	g.uploads[id] = ""
	g.mu.Unlock()
	defer func() {
		g.mu.Lock()
		g.busy = false
		if g.uploads[id] == "" {
			delete(g.uploads, id)
		}
		g.mu.Unlock()
	}()
	input, e := readUpload(w, r)
	if e != nil {
		fail(w, e)
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.active || time.Now().After(g.expires) {
		http.Error(w, "This phone link has ended.", 410)
		return
	}
	job := s.queueUpload(g.peer, input, true)
	g.uploads[id] = job.ID
	job.Peer = ""
	respond(w, job)
}
