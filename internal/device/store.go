package device

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	"frameolocal/internal/protocol"
	"github.com/gofrs/flock"
)

type Frame struct {
	protocol.Info
	Peer   string `json:"peer_id,omitempty"`
	Host   string `json:"host"`
	Port   int    `json:"port"`
	Issuer string `json:"issuer"`
}
type state struct {
	Key    string           `json:"private_key"`
	Name   string           `json:"name"`
	Frames map[string]Frame `json:"frames"`
}
type Store struct {
	mu   sync.Mutex
	data state
	path string
	lock *flock.Flock
}

func DefaultPath() string {
	base, e := os.UserConfigDir()
	if e != nil {
		base = "."
	}
	folder := "frameo-local"
	if runtime.GOOS == "darwin" {
		folder = "Frameo Local"
	}
	return filepath.Join(base, folder, "device.json")
}
func OpenStore(path string) (*Store, error) {
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return nil, e
	}
	lock := flock.New(path + ".lock")
	ok, e := lock.TryLock()
	if e != nil {
		return nil, e
	}
	if !ok {
		return nil, errors.New("Frameo Local is already using this identity; close the other instance first")
	}
	s := &Store{path: path, lock: lock}
	b, e := os.ReadFile(path)
	if errors.Is(e, os.ErrNotExist) {
		var key [32]byte
		if _, e = rand.Read(key[:]); e != nil {
			lock.Unlock()
			return nil, e
		}
		s.data = state{hex.EncodeToString(key[:]), "My computer", map[string]Frame{}}
		e = s.save()
	} else if e == nil {
		e = json.Unmarshal(b, &s.data)
	}
	if e == nil {
		_, e = protocol.DecodeKey(s.data.Key)
	}
	if e != nil {
		lock.Unlock()
		return nil, e
	}
	if s.data.Frames == nil {
		s.data.Frames = map[string]Frame{}
	}
	return s, nil
}
func (s *Store) Close() { s.lock.Unlock() }
func (s *Store) save() error {
	b, e := json.MarshalIndent(s.data, "", "  ")
	if e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(s.path), ".device-*")
	if e != nil {
		return e
	}
	name := f.Name()
	defer os.Remove(name)
	if e = f.Chmod(0600); e == nil {
		_, e = f.Write(append(b, '\n'))
	}
	if e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e != nil {
		return e
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(name, s.path)
}
func (s *Store) Identity() ([32]byte, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key, _ := protocol.DecodeKey(s.data.Key)
	return key, s.data.Name
}
func (s *Store) SetName(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	old := s.data.Name
	s.data.Name = name
	if e := s.save(); e != nil {
		s.data.Name = old
		return e
	}
	return nil
}
func (s *Store) Frames() []Frame {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Frame, 0, len(s.data.Frames))
	for k, f := range s.data.Frames {
		f.Peer = k
		out = append(out, f)
	}
	return out
}
func (s *Store) Get(peer string) (Frame, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, ok := s.data.Frames[peer]
	if !ok {
		return f, errors.New("frame is not paired with this computer")
	}
	f.Peer = peer
	return f, nil
}
func (s *Store) Put(f Frame) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.Frames[f.Peer] = f
	return s.save()
}
