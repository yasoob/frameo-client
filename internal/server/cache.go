package server

import "sync"

// A bounded in-memory cache; frame photos are never written to a public directory.
type cachedImage struct {
	data []byte
	mime string
	tick uint64
}
type imageCache struct {
	mu    sync.Mutex
	items map[string]cachedImage
	bytes int
	tick  uint64
}

func (c *imageCache) get(key string) (cachedImage, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	v, ok := c.items[key]
	if ok {
		c.tick++
		v.tick = c.tick
		c.items[key] = v
	}
	return v, ok
}
func (c *imageCache) put(key string, data []byte, mime string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(data) > 16<<20 {
		return
	}
	if c.items == nil {
		c.items = map[string]cachedImage{}
	}
	if old, ok := c.items[key]; ok {
		c.bytes -= len(old.data)
	}
	c.tick++
	c.items[key] = cachedImage{data, mime, c.tick}
	c.bytes += len(data)
	for c.bytes > 64<<20 {
		var oldest string
		tick := ^uint64(0)
		for k, v := range c.items {
			if v.tick < tick {
				oldest = k
				tick = v.tick
			}
		}
		c.bytes -= len(c.items[oldest].data)
		delete(c.items, oldest)
	}
}
func (c *imageCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items = map[string]cachedImage{}
	c.bytes = 0
}
