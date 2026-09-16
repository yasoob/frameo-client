package device

import (
	"context"
	"sort"
	"time"

	"github.com/grandcat/zeroconf"
)

type Service struct {
	Instance string `json:"instance"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Hostname string `json:"hostname"`
}

func Discover(ctx context.Context) ([]Service, error) {
	r, e := zeroconf.NewResolver(zeroconf.SelectIPTraffic(zeroconf.IPv4))
	if e != nil {
		return nil, e
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	entries := make(chan *zeroconf.ServiceEntry, 32)
	if e = r.Browse(ctx, "_frameo._tcp", "local.", entries); e != nil {
		return nil, e
	}
	found := map[string]Service{}
	for {
		select {
		case entry, ok := <-entries:
			if !ok {
				entries = nil
				continue
			}
			if len(entry.AddrIPv4) > 0 {
				found[entry.Instance] = Service{entry.Instance, entry.AddrIPv4[0].String(), entry.Port, entry.HostName}
			}
		case <-ctx.Done():
			out := make([]Service, 0, len(found))
			for _, x := range found {
				out = append(out, x)
			}
			sort.Slice(out, func(i, j int) bool { return out[i].Instance < out[j].Instance })
			return out, nil
		}
	}
}
