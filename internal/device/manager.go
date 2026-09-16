package device

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"frameolocal/internal/protocol"
)

type Manager struct {
	Store      *Store
	mu         sync.Mutex
	locks      map[string]chan struct{}
	discovered []Service
	scanned    time.Time
}

func NewManager(s *Store) *Manager { return &Manager{Store: s, locks: map[string]chan struct{}{}} }
func (m *Manager) acquire(ctx context.Context, peer string) (func(), error) {
	m.mu.Lock()
	ch := m.locks[peer]
	if ch == nil {
		ch = make(chan struct{}, 1)
		m.locks[peer] = ch
	}
	m.mu.Unlock()
	select {
	case ch <- struct{}{}:
		return func() { <-ch }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
func (m *Manager) Discover(ctx context.Context, force bool) ([]Service, error) {
	m.mu.Lock()
	if !force && time.Since(m.scanned) < 20*time.Second {
		r := append([]Service(nil), m.discovered...)
		m.mu.Unlock()
		return r, nil
	}
	m.mu.Unlock()
	r, e := Discover(ctx)
	if e == nil {
		m.mu.Lock()
		m.discovered = r
		m.scanned = time.Now()
		m.mu.Unlock()
	}
	return r, e
}
func (m *Manager) endpoint(ctx context.Context, f Frame, force bool) (Frame, error) {
	services, e := m.Discover(ctx, force)
	if e == nil {
		for _, s := range services {
			if s.Instance == f.Peer || s.Instance == f.Peer[:63] {
				f.Host = s.Host
				f.Port = s.Port
				return f, nil
			}
		}
	}
	if f.Host == "" || f.Port == 0 {
		return f, errors.New("frame not found on this network")
	}
	return f, nil
}
func (m *Manager) WithClient(ctx context.Context, peer string, fn func(*protocol.Client) error) error {
	if _, e := protocol.DecodeKey(peer); e != nil {
		return e
	}
	release, e := m.acquire(ctx, peer)
	if e != nil {
		return e
	}
	defer release()
	f, e := m.Store.Get(peer)
	if e != nil {
		return e
	}
	f, e = m.endpoint(ctx, f, false)
	if e != nil {
		return e
	}
	key, name := m.Store.Identity()
	t, e := protocol.Dial(ctx, f.Host, f.Port, key, "framedump_local", peer, f.Issuer)
	if e != nil && ctx.Err() == nil {
		f, e = m.endpoint(ctx, f, true)
		if e != nil {
			return e
		}
		t, e = protocol.Dial(ctx, f.Host, f.Port, key, "framedump_local", peer, f.Issuer)
	}
	if e != nil {
		return fmt.Errorf("could not reach frame: %w", e)
	}
	defer t.Close()
	c := protocol.NewClient(t, name)
	info, e := c.GetInfo()
	if e != nil {
		return e
	}
	f.Info = info
	if e = m.Store.Put(f); e != nil {
		return e
	}
	if e = fn(c); e != nil {
		return e
	}
	f.Info = c.Info
	return m.Store.Put(f)
}
func (m *Manager) Pair(ctx context.Context, service Service, code, name string) (Frame, error) {
	var f Frame
	if service.Host == "" || service.Port < 1 || service.Port > 65535 {
		return f, errors.New("choose a frame or enter its address and port")
	}
	if strings.TrimSpace(name) == "" || len(name) > 100 {
		return f, errors.New("enter a sender name (up to 100 characters)")
	}
	release, e := m.acquire(ctx, "pairing")
	if e != nil {
		return f, e
	}
	defer release()
	key, _ := m.Store.Identity()
	t, e := protocol.Dial(ctx, service.Host, service.Port, key, "<pairing>", "", "")
	if e != nil {
		return f, e
	}
	defer t.Close()
	peer := hex.EncodeToString(t.Peer[:])
	if service.Instance != "" && !strings.HasPrefix(peer, service.Instance) {
		return f, errors.New("frame identity does not match discovery")
	}
	if e = t.Pair(code); e != nil {
		return f, e
	}
	f = Frame{Peer: peer, Host: service.Host, Port: service.Port, Issuer: t.Issuer}
	f.Name = "New frame"
	if e = m.Store.Put(f); e != nil {
		return f, e
	}
	if e = m.Store.SetName(strings.TrimSpace(name)); e != nil {
		return f, e
	}
	return f, nil
}
