package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"time"

	"frameolocal/internal/device"
	"frameolocal/internal/server"
)

func main() {
	state := flag.String("state", device.DefaultPath(), "path to the private identity/pairing file")
	port := flag.Int("port", 0, "local UI port (0 selects an available port)")
	noOpen := flag.Bool("no-open", false, "print the URL without opening a browser")
	flag.Parse()
	store, e := device.OpenStore(*state)
	if e != nil {
		log.Fatal(e)
	}
	defer store.Close()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	listener, e := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", *port))
	if e != nil {
		log.Fatal(e)
	}
	handler := server.New(ctx, device.NewManager(store), listener.Addr().String())
	httpServer := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	url := "http://" + listener.Addr().String()
	fmt.Printf("\n  Frameo Local\n  %s\n\n  Press Ctrl+C to quit.\n\n", url)
	if !*noOpen {
		var cmd *exec.Cmd
		switch runtime.GOOS {
		case "darwin":
			cmd = exec.Command("open", url)
		case "windows":
			cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
		default:
			cmd = exec.Command("xdg-open", url)
		}
		if e = cmd.Start(); e != nil {
			fmt.Println("Open the URL above in your browser.")
		} else {
			go cmd.Wait()
		}
	}
	go func() {
		<-ctx.Done()
		shutdown, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		httpServer.Shutdown(shutdown)
	}()
	if e = httpServer.Serve(listener); e != nil && e != http.ErrServerClosed {
		log.Print(e)
	}
	cancel()
	handler.Wait()
}
