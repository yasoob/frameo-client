package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

type Job struct {
	ID       string  `json:"id"`
	Kind     string  `json:"kind"`
	Peer     string  `json:"peer"`
	Label    string  `json:"label"`
	State    string  `json:"state"`
	Progress float64 `json:"progress"`
	Message  string  `json:"message,omitempty"`
	Error    string  `json:"error,omitempty"`
	MediaID  string  `json:"media_id,omitempty"`
	Created  int64   `json:"created"`
}
type jobEntry struct {
	Job
	cancel context.CancelFunc
}
type Jobs struct {
	mu      sync.Mutex
	entries []*jobEntry
	wg      sync.WaitGroup
	ctx     context.Context
}

type Progress func(float64, string, ...string)

func (j *Jobs) Start(kind, peer, label string, fn func(context.Context, Progress) error) Job {
	var id [12]byte
	rand.Read(id[:])
	ctx, cancel := context.WithTimeout(j.ctx, 4*time.Minute)
	entry := &jobEntry{Job: Job{ID: hex.EncodeToString(id[:]), Kind: kind, Peer: peer, Label: label, State: "running", Created: time.Now().UnixMilli()}, cancel: cancel}
	j.mu.Lock()
	active := 0
	for _, existing := range j.entries {
		if existing.State == "running" {
			active++
		}
	}
	if active >= 16 || j.ctx.Err() != nil {
		entry.State = "failed"
		entry.Error = "Too many queued operations. Wait for the current transfers to finish."
	}
	j.entries = append(j.entries, entry)
	if len(j.entries) > 100 {
		for i, e := range j.entries {
			if e.State != "running" {
				j.entries = append(j.entries[:i], j.entries[i+1:]...)
				break
			}
		}
	}
	snapshot := entry.Job
	if entry.State != "running" {
		j.mu.Unlock()
		cancel()
		return snapshot
	}
	j.wg.Add(1)
	j.mu.Unlock()
	go func() {
		defer j.wg.Done()
		defer cancel()
		e := fn(ctx, func(p float64, s string, mediaID ...string) {
			j.mu.Lock()
			entry.Progress = p
			entry.Message = s
			if len(mediaID) > 0 {
				entry.MediaID = mediaID[0]
			}
			j.mu.Unlock()
		})
		j.mu.Lock()
		defer j.mu.Unlock()
		if e != nil {
			entry.State = "failed"
			entry.Error = e.Error()
			if ctx.Err() == context.Canceled {
				entry.State = "cancelled"
				entry.Error = ""
			}
		} else {
			entry.State = "succeeded"
			entry.Progress = 1
		}
	}()
	return snapshot
}
func (j *Jobs) List() []Job {
	j.mu.Lock()
	defer j.mu.Unlock()
	out := make([]Job, len(j.entries))
	for i, e := range j.entries {
		out[i] = e.Job
	}
	return out
}
func (j *Jobs) Cancel(id string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	for _, e := range j.entries {
		if e.ID == id {
			e.cancel()
		}
	}
}
